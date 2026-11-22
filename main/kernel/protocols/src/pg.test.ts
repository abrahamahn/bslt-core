// main/kernel/protocols/src/pg.test.ts
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createPgPool } from './pg';

function backendFrame(typeChar: string, payload: Buffer): Buffer {
  const buf = Buffer.allocUnsafe(5 + payload.byteLength);
  buf[0] = typeChar.charCodeAt(0);
  buf.writeInt32BE(4 + payload.byteLength, 1);
  payload.copy(buf, 5);
  return buf;
}

function authOkFrame(): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeInt32BE(0, 0);
  return backendFrame('R', payload);
}

function backendKeyFrame(pid: number, secret: number): Buffer {
  const payload = Buffer.alloc(8);
  payload.writeInt32BE(pid, 0);
  payload.writeInt32BE(secret, 4);
  return backendFrame('K', payload);
}

function readyFrame(status: 'I' | 'T' | 'E' = 'I'): Buffer {
  return backendFrame('Z', Buffer.from([status.charCodeAt(0)]));
}

function errorResponseFrame(fields: Readonly<Record<string, string>>): Buffer {
  const parts: Buffer[] = [];
  for (const [code, text] of Object.entries(fields)) {
    parts.push(Buffer.from(code, 'ascii'), Buffer.from(text, 'utf8'), Buffer.from([0]));
  }
  parts.push(Buffer.from([0]));
  return backendFrame('E', Buffer.concat(parts));
}

function rowDescriptionFrame(
  cols: readonly { readonly name: string; readonly oid: number }[],
): Buffer {
  const header = Buffer.alloc(2);
  header.writeInt16BE(cols.length, 0);
  const parts: Buffer[] = [header];
  for (const col of cols) {
    const meta = Buffer.alloc(18);
    meta.writeInt32BE(0, 0); // table oid
    meta.writeInt16BE(0, 4); // attr num
    meta.writeInt32BE(col.oid, 6);
    meta.writeInt16BE(-1, 10); // size
    meta.writeInt32BE(-1, 12); // typmod
    meta.writeInt16BE(0, 16); // text format
    parts.push(Buffer.from(`${col.name}\0`, 'utf8'), meta);
  }
  return backendFrame('T', Buffer.concat(parts));
}

function dataRowFrame(values: readonly (string | null)[]): Buffer {
  const header = Buffer.alloc(2);
  header.writeInt16BE(values.length, 0);
  const parts: Buffer[] = [header];
  for (const val of values) {
    if (val === null) {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(-1, 0);
      parts.push(lenBuf);
    } else {
      const bytes = Buffer.from(val, 'utf8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(bytes.byteLength, 0);
      parts.push(lenBuf, bytes);
    }
  }
  return backendFrame('D', Buffer.concat(parts));
}

function commandCompleteFrame(tag: string): Buffer {
  return backendFrame('C', Buffer.from(`${tag}\0`, 'utf8'));
}

const activeServers: Server[] = [];

async function startWireServer(onConnection: (socket: Socket) => void): Promise<number> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  activeServers.push(server);
  server.on('close', () => {
    for (const s of sockets) s.destroy();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  return typeof addr === 'object' && addr !== null ? addr.port : 0;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop();
    if (srv !== undefined) {
      srv.close();
    }
  }
});

describe('@bslt/protocols/pg (PostgreSQL wire v3.0)', () => {
  // --- Adversarial / Protocol Fault-Injection Cases (8 / 11 = 72.7%) ---

  it('rejects malformed or non-postgres connection strings', () => {
    expect(() => createPgPool('')).toThrow(/connection string/iu);
    expect(() => createPgPool('http://localhost:5432/db')).toThrow(/protocol|scheme/iu);
  });

  it('rejects with code CONNECT_TIMEOUT when the server accepts TCP and stays silent', async () => {
    const port = await startWireServer(() => {
      // Never write a byte
    });
    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      connect_timeout: 0.2,
      max: 1,
      ssl: false,
    });
    try {
      const err = await sql`SELECT 1`.then(
        () => undefined,
        (reason: unknown) => reason as { code?: string },
      );
      expect(err?.code).toBe('CONNECT_TIMEOUT');
    } finally {
      await sql.end();
    }
  });

  it('rejects when ssl="require" and the server declines SSLRequest with "N"', async () => {
    const port = await startWireServer((socket) => {
      socket.once('data', () => {
        socket.write(Buffer.from('N', 'ascii'));
      });
    });
    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: 'require',
      max: 1,
      connect_timeout: 2,
    });
    try {
      await expect(sql`SELECT 1`).rejects.toThrow(/ssl|tls/iu);
    } finally {
      await sql.end();
    }
  });

  it('rejects SCRAM-SHA-256 authentication failure (SQLSTATE 28P01) and tampered server signatures', async () => {
    // 1. Server returns 28P01 on SASLResponse
    const portBadPw = await startWireServer((socket) => {
      let step = 0;
      socket.on('data', (chunk: Buffer) => {
        if (step === 0) {
          step = 1;
          // AuthenticationSASL (10) offering SCRAM-SHA-256
          const sasl = Buffer.alloc(4 + 'SCRAM-SHA-256\0\0'.length);
          sasl.writeInt32BE(10, 0);
          sasl.write('SCRAM-SHA-256\0\0', 4, 'utf8');
          socket.write(backendFrame('R', sasl));
        } else if (step === 1) {
          step = 2;
          // Extract client nonce r=... from SASLInitialResponse
          const text = chunk.toString('utf8');
          const match = /r=([A-Za-z0-9+/=]+)/u.exec(text);
          const clientNonce = match?.[1] ?? '';
          const serverFirst = `r=${clientNonce}srvnonce,s=${Buffer.from('saltsalt').toString('base64')},i=4096`;
          const cont = Buffer.alloc(4 + Buffer.byteLength(serverFirst));
          cont.writeInt32BE(11, 0);
          cont.write(serverFirst, 4, 'utf8');
          socket.write(backendFrame('R', cont));
        } else {
          socket.write(
            errorResponseFrame({
              S: 'FATAL',
              C: '28P01',
              M: 'password authentication failed for user "u"',
            }),
          );
          socket.end();
        }
      });
    });

    const sqlBadPw = createPgPool(`postgres://u:wrong@127.0.0.1:${String(portBadPw)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      const err = await sqlBadPw`SELECT 1`.then(
        () => undefined,
        (e: unknown) => e as { code?: string },
      );
      expect(err?.code).toBe('28P01');
    } finally {
      await sqlBadPw.end();
    }

    // 2. Forged SCRAM server-final signature -> client MUST reject mutual auth!
    const portBadServerSig = await startWireServer((socket) => {
      let step = 0;
      socket.on('data', (chunk: Buffer) => {
        if (step === 0) {
          step = 1;
          const sasl = Buffer.alloc(4 + 'SCRAM-SHA-256\0\0'.length);
          sasl.writeInt32BE(10, 0);
          sasl.write('SCRAM-SHA-256\0\0', 4, 'utf8');
          socket.write(backendFrame('R', sasl));
        } else if (step === 1) {
          step = 2;
          const match = /r=([A-Za-z0-9+/=]+)/u.exec(chunk.toString('utf8'));
          const clientNonce = match?.[1] ?? '';
          const serverFirst = `r=${clientNonce}srv,s=${Buffer.from('12345678').toString('base64')},i=4096`;
          const cont = Buffer.alloc(4 + Buffer.byteLength(serverFirst));
          cont.writeInt32BE(11, 0);
          cont.write(serverFirst, 4, 'utf8');
          socket.write(backendFrame('R', cont));
        } else {
          const fakeFinal = `v=${randomBytes(32).toString('base64')}`;
          const fin = Buffer.alloc(4 + Buffer.byteLength(fakeFinal));
          fin.writeInt32BE(12, 0);
          fin.write(fakeFinal, 4, 'utf8');
          socket.write(Buffer.concat([backendFrame('R', fin), authOkFrame(), readyFrame('I')]));
        }
      });
    });

    const sqlMitm = createPgPool(`postgres://u:secret@127.0.0.1:${String(portBadServerSig)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      await expect(sqlMitm`SELECT 1`).rejects.toThrow(/signature|scram/iu);
    } finally {
      await sqlMitm.end();
    }
  });

  it('rejects in-flight query on mid-query socket drop and recovers on the next query', async () => {
    let connCount = 0;
    const port = await startWireServer((socket) => {
      connCount += 1;
      const myConn = connCount;
      let started = false;
      socket.on('data', () => {
        if (!started) {
          started = true;
          socket.write(
            Buffer.concat([authOkFrame(), backendKeyFrame(100 + myConn, 999), readyFrame('I')]),
          );
          return;
        }
        if (myConn === 1) {
          // Drop TCP abruptly mid-query!
          socket.destroy();
        } else {
          socket.write(
            Buffer.concat([
              rowDescriptionFrame([{ name: 'ok', oid: 23 }]),
              dataRowFrame(['1']),
              commandCompleteFrame('SELECT 1'),
              readyFrame('I'),
            ]),
          );
        }
      });
    });

    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      await expect(sql.unsafe('SELECT 1')).rejects.toThrow(/closed|terminated|reset|eof/iu);
      // Next query opens connection #2 and succeeds cleanly
      const rows = await sql.unsafe<{ ok: number }[]>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it('sends a wire CancelRequest (80877102 + pid + secretKey) when AbortSignal fires and keeps the connection alive', async () => {
    let cancelReceived: { pid: number; secret: number } | undefined;
    let queryConnSocket: Socket | undefined;

    const port = await startWireServer((socket) => {
      socket.once('data', (firstChunk: Buffer) => {
        if (firstChunk.byteLength === 16 && firstChunk.readInt32BE(4) === 80877102) {
          cancelReceived = {
            pid: firstChunk.readInt32BE(8),
            secret: firstChunk.readInt32BE(12),
          };
          socket.end();
          // Main connection emits Postgres's native 57014 ErrorResponse + ReadyForQuery('I')
          queryConnSocket?.write(
            Buffer.concat([
              errorResponseFrame({
                S: 'ERROR',
                C: '57014',
                M: 'canceling statement due to user request',
              }),
              readyFrame('I'),
            ]),
          );
          return;
        }

        queryConnSocket = socket;
        socket.write(
          Buffer.concat([authOkFrame(), backendKeyFrame(4242, 777777), readyFrame('I')]),
        );
        let queryNum = 0;
        socket.on('data', () => {
          queryNum += 1;
          if (queryNum === 1) {
            // Hang until CancelRequest arrives!
            return;
          }
          socket.write(
            Buffer.concat([
              rowDescriptionFrame([{ name: 'alive', oid: 16 }]),
              dataRowFrame(['t']),
              commandCompleteFrame('SELECT 1'),
              readyFrame('I'),
            ]),
          );
        });
      });
    });

    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      const err = await sql
        .unsafe('SELECT pg_sleep(10)')
        .signal(AbortSignal.timeout(80))
        .then(
          () => undefined,
          (e: unknown) => e as { code?: string; message?: string },
        );

      expect(cancelReceived).toEqual({ pid: 4242, secret: 777777 });
      expect(err?.code).toBe('57014');
      expect(err?.message).toMatch(/user request/iu);

      // Connection stays alive and serves the next query
      const next = await sql.unsafe<{ alive: boolean }[]>('SELECT true AS alive');
      expect(next[0]?.alive).toBe(true);
    } finally {
      await sql.end();
    }
  });

  it('parses SQLSTATE, constraint, table, and detail fields on ErrorResponse and rolls back failed transactions', async () => {
    const receivedQueries: string[] = [];
    const port = await startWireServer((socket) => {
      let ready = false;
      socket.on('data', (chunk: Buffer) => {
        if (!ready) {
          ready = true;
          socket.write(Buffer.concat([authOkFrame(), backendKeyFrame(1, 2), readyFrame('I')]));
          return;
        }
        const sqlText = chunk.subarray(5, chunk.length - 1).toString('utf8');
        receivedQueries.push(sqlText);
        if (sqlText.startsWith('BEGIN')) {
          socket.write(Buffer.concat([commandCompleteFrame('BEGIN'), readyFrame('T')]));
        } else if (sqlText.startsWith('ROLLBACK')) {
          socket.write(Buffer.concat([commandCompleteFrame('ROLLBACK'), readyFrame('I')]));
        } else {
          socket.write(
            Buffer.concat([
              errorResponseFrame({
                S: 'ERROR',
                C: '23505',
                M: 'duplicate key value violates unique constraint "users_email_key"',
                D: 'Key (email)=(a@b.io) already exists.',
                n: 'users_email_key',
                t: 'identity_users',
              }),
              readyFrame('E'),
            ]),
          );
        }
      });
    });

    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      const failure = await sql
        .begin(async (tx) => {
          await tx.unsafe('INSERT INTO identity_users VALUES (1)');
        })
        .then(
          () => undefined,
          (e: unknown) =>
            e as { code?: string; constraint?: string; table?: string; detail?: string },
        );

      expect(failure?.code).toBe('23505');
      expect(failure?.constraint).toBe('users_email_key');
      expect(failure?.table).toBe('identity_users');
      expect(failure?.detail).toContain('already exists');
      expect(receivedQueries).toEqual([
        'BEGIN',
        'INSERT INTO identity_users VALUES (1)',
        'ROLLBACK',
      ]);
    } finally {
      await sql.end();
    }
  });

  it('rolls back failed savepoints without aborting the enclosing transaction', async () => {
    const receivedQueries: string[] = [];
    const port = await startWireServer((socket) => {
      let ready = false;
      socket.on('data', (chunk: Buffer) => {
        if (!ready) {
          ready = true;
          socket.write(Buffer.concat([authOkFrame(), backendKeyFrame(1, 2), readyFrame('I')]));
          return;
        }
        const sqlText = chunk.subarray(5, chunk.length - 1).toString('utf8');
        receivedQueries.push(sqlText);
        if (sqlText === 'FAIL_INSIDE_SP') {
          socket.write(
            Buffer.concat([
              errorResponseFrame({ S: 'ERROR', C: '23503', M: 'fk restrict' }),
              readyFrame('E'),
            ]),
          );
        } else {
          const status = sqlText === 'COMMIT' ? 'I' : 'T';
          socket.write(Buffer.concat([commandCompleteFrame('OK'), readyFrame(status)]));
        }
      });
    });

    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      await sql.begin('isolation level read committed', async (tx) => {
        await expect(
          tx.savepoint(async (sp) => {
            await sp.unsafe('FAIL_INSIDE_SP');
          }),
        ).rejects.toMatchObject({ code: '23503' });
        await tx.unsafe('SELECT 1');
      });

      expect(receivedQueries[0]).toBe('BEGIN isolation level read committed');
      expect(receivedQueries[1]).toMatch(/^SAVEPOINT sp_/u);
      expect(receivedQueries[2]).toBe('FAIL_INSIDE_SP');
      expect(receivedQueries[3]).toMatch(/^ROLLBACK TO SAVEPOINT sp_/u);
      expect(receivedQueries[4]).toMatch(/^RELEASE SAVEPOINT sp_/u);
      expect(receivedQueries[5]).toBe('SELECT 1');
      expect(receivedQueries[6]).toBe('COMMIT');
    } finally {
      await sql.end();
    }
  });

  // --- Positive Protocol Ceremonies (3 / 11 tests) ---

  it('completes full mutual SCRAM-SHA-256 authentication and decodes Postgres scalar, JSONB, bytea, timestamp, and array OIDs', async () => {
    const password = 'correct-horse-battery-staple';
    const salt = Buffer.from('0123456789abcdef', 'utf8');
    const iterations = 4096;
    const saltedPw = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
    const serverKey = createHmac('sha256', saltedPw).update('Server Key').digest();

    const port = await startWireServer((socket) => {
      let step = 0;
      let clientFirstBare = '';
      let serverFirstMsg = '';
      socket.on('data', (chunk: Buffer) => {
        if (step === 0) {
          step = 1;
          const sasl = Buffer.alloc(4 + 'SCRAM-SHA-256\0\0'.length);
          sasl.writeInt32BE(10, 0);
          sasl.write('SCRAM-SHA-256\0\0', 4, 'utf8');
          socket.write(backendFrame('R', sasl));
        } else if (step === 1) {
          step = 2;
          const body = chunk.toString('utf8');
          const idx = body.indexOf('n,,');
          clientFirstBare = body.slice(idx + 3);
          const nonce = clientFirstBare.split('r=')[1] ?? '';
          serverFirstMsg = `r=${nonce}servernonce,s=${salt.toString('base64')},i=${String(iterations)}`;
          const cont = Buffer.alloc(4 + Buffer.byteLength(serverFirstMsg));
          cont.writeInt32BE(11, 0);
          cont.write(serverFirstMsg, 4, 'utf8');
          socket.write(backendFrame('R', cont));
        } else if (step === 2) {
          step = 3;
          const clientFinal = chunk.subarray(5).toString('utf8');
          const withoutProof = clientFinal.split(',p=')[0] ?? '';
          const authMsg = `${clientFirstBare},${serverFirstMsg},${withoutProof}`;
          const serverSig = createHmac('sha256', serverKey).update(authMsg).digest('base64');
          const finText = `v=${serverSig}`;
          const fin = Buffer.alloc(4 + Buffer.byteLength(finText));
          fin.writeInt32BE(12, 0);
          fin.write(finText, 4, 'utf8');
          socket.write(
            Buffer.concat([
              backendFrame('R', fin),
              authOkFrame(),
              backendKeyFrame(9, 9),
              readyFrame('I'),
            ]),
          );
        } else {
          socket.write(
            Buffer.concat([
              rowDescriptionFrame([
                { name: 'flag', oid: 16 },
                { name: 'small', oid: 23 },
                { name: 'big', oid: 20 },
                { name: 'price', oid: 1700 },
                { name: 'doc', oid: 3802 },
                { name: 'raw', oid: 17 },
                { name: 'ts', oid: 1184 },
                { name: 'tags', oid: 1009 },
                { name: 'nums', oid: 1016 },
                { name: 'empty_col', oid: 25 },
              ]),
              dataRowFrame([
                't',
                '42',
                '9007199254740993',
                '19.99',
                '{"ok":true}',
                '\\xdeadbeef',
                '2026-03-15 10:20:30.500+00',
                '{"alpha","b\\"quote",NULL}',
                '{9007199254740993,-1}',
                null,
              ]),
              commandCompleteFrame('UPDATE 3'),
              readyFrame('I'),
            ]),
          );
        }
      });
    });

    const sql = createPgPool(`postgres://alice:${password}@127.0.0.1:${String(port)}/app`, {
      ssl: false,
      max: 1,
      types: {
        bigint: {
          to: 20,
          from: [20],
          serialize: (v: bigint) => v.toString(),
          parse: (text: string) => BigInt(text),
        },
      },
    });
    try {
      const result = await sql.unsafe<Record<string, unknown>[]>('SELECT *');
      expect(result.count).toBe(3);
      expect(result[0]).toEqual({
        flag: true,
        small: 42,
        big: 9_007_199_254_740_993n,
        price: '19.99',
        doc: { ok: true },
        raw: Buffer.from('deadbeef', 'hex'),
        ts: new Date('2026-03-15T10:20:30.500Z'),
        tags: ['alpha', 'b"quote', null],
        nums: [9_007_199_254_740_993n, -1n],
        empty_col: null,
      });
    } finally {
      await sql.end();
    }
  });

  it('pipelines sql.batch([q1, q2]) in a single Sync round-trip and invokes debug hooks in order', async () => {
    const frameTypesSeen: string[][] = [];
    const debugLog: string[] = [];

    const port = await startWireServer((socket) => {
      let started = false;
      socket.on('data', (chunk: Buffer) => {
        if (!started) {
          started = true;
          socket.write(Buffer.concat([authOkFrame(), backendKeyFrame(1, 1), readyFrame('I')]));
          return;
        }
        // Parse frontend message types in this single write
        const types: string[] = [];
        let pos = 0;
        while (pos + 5 <= chunk.byteLength) {
          types.push(String.fromCharCode(chunk[pos] ?? 0));
          const len = chunk.readInt32BE(pos + 1);
          pos += 1 + len;
        }
        frameTypesSeen.push(types);

        // Reply to 2 pipelined Parse+Bind+Describe+Execute sequences + 1 ReadyForQuery
        socket.write(
          Buffer.concat([
            backendFrame('1', Buffer.alloc(0)), // ParseComplete 1
            backendFrame('2', Buffer.alloc(0)), // BindComplete 1
            rowDescriptionFrame([{ name: 'set_config', oid: 25 }]),
            dataRowFrame(['authenticated']),
            commandCompleteFrame('SELECT 1'),
            backendFrame('1', Buffer.alloc(0)), // ParseComplete 2
            backendFrame('2', Buffer.alloc(0)), // BindComplete 2
            rowDescriptionFrame([{ name: 'id', oid: 23 }]),
            dataRowFrame(['7']),
            commandCompleteFrame('SELECT 1'),
            readyFrame('I'),
          ]),
        );
      });
    });

    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
      debug: (_conn, q) => debugLog.push(q),
    });
    try {
      const [r1, r2] = await sql.batch([
        sql.unsafe("SELECT set_config('role', $1, true)", ['authenticated']),
        sql.unsafe('SELECT $1::int AS id', [7]),
      ]);

      // Exactly ONE Sync ('S') at the end of the pipeline!
      expect(frameTypesSeen).toEqual([['P', 'B', 'D', 'E', 'P', 'B', 'D', 'E', 'S']]);
      expect(debugLog).toEqual(["SELECT set_config('role', $1, true)", 'SELECT $1::int AS id']);
      expect(r1).toEqual([{ set_config: 'authenticated' }]);
      expect(r2).toEqual([{ id: 7 }]);
    } finally {
      await sql.end();
    }
  });

  it('delivers asynchronous NotificationResponse frames on dedicated LISTEN sessions and supports MD5 auth', async () => {
    const md5 = (s: string | Buffer): string => createHash('md5').update(s).digest('hex');
    const salt = Buffer.from([0x11, 0x22, 0x33, 0x44]);

    const port = await startWireServer((socket) => {
      let step = 0;
      socket.on('data', (chunk: Buffer) => {
        if (step === 0) {
          step = 1;
          const md5Req = Buffer.alloc(8);
          md5Req.writeInt32BE(5, 0);
          salt.copy(md5Req, 4);
          socket.write(backendFrame('R', md5Req));
        } else if (step === 1) {
          step = 2;
          const pwMsg = chunk.subarray(5, chunk.length - 1).toString('utf8');
          const expected = `md5${md5(Buffer.concat([Buffer.from(md5('pwuser'), 'ascii'), salt]))}`;
          if (pwMsg !== expected) {
            socket.write(errorResponseFrame({ S: 'FATAL', C: '28P01', M: 'bad md5' }));
            socket.end();
            return;
          }
          socket.write(Buffer.concat([authOkFrame(), backendKeyFrame(55, 66), readyFrame('I')]));
        } else {
          // Reply to LISTEN and immediately push an async NotificationResponse ('A')!
          const pidBuf = Buffer.alloc(4);
          pidBuf.writeInt32BE(55, 0);
          const notifyFrame = backendFrame(
            'A',
            Buffer.concat([
              pidBuf,
              Buffer.from('bslt_outbox\0', 'utf8'),
              Buffer.from('{"wake":1}\0', 'utf8'),
            ]),
          );
          socket.write(
            Buffer.concat([commandCompleteFrame('LISTEN'), readyFrame('I'), notifyFrame]),
          );
        }
      });
    });

    const payloads: string[] = [];
    const sql = createPgPool(`postgres://user:pw@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
      idle_timeout: 0,
    });
    try {
      await sql.listen('bslt_outbox', (payload) => {
        payloads.push(payload);
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(payloads).toEqual(['{"wake":1}']);
    } finally {
      await sql.end();
    }
  });

  it('preserves unsolicited FATAL 25P03 ErrorResponse emitted while idle in transaction', async () => {
    const port = await startWireServer((socket) => {
      let step = 0;
      socket.on('data', () => {
        step += 1;
        if (step === 1) {
          socket.write(Buffer.concat([authOkFrame(), backendKeyFrame(1, 1), readyFrame('I')]));
        } else if (step === 2) {
          // BEGIN
          socket.write(Buffer.concat([commandCompleteFrame('BEGIN'), readyFrame('T')]));
          // Server kills idle transaction asynchronously with 25P03 and closes TCP!
          setTimeout(() => {
            socket.write(
              errorResponseFrame({
                S: 'FATAL',
                C: '25P03',
                M: 'terminating connection due to idle-in-transaction timeout',
              }),
              () => socket.end(),
            );
          }, 15);
        }
      });
    });

    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      const err = await sql
        .begin(async (tx) => {
          await new Promise((r) => setTimeout(r, 40));
          await tx.unsafe('SELECT 1');
        })
        .then(
          () => undefined,
          (e: unknown) => e as { code?: string },
        );
      expect(err?.code).toBe('25P03');
    } finally {
      await sql.end();
    }
  });

  it('serializes concurrent Promise.all queries on the same transaction connection without clobbering handlers', async () => {
    const port = await startWireServer((socket) => {
      let started = false;
      let counter = 0;
      socket.on('data', (chunk: Buffer) => {
        if (!started) {
          started = true;
          socket.write(Buffer.concat([authOkFrame(), backendKeyFrame(1, 1), readyFrame('I')]));
          return;
        }
        const sqlText = chunk.subarray(5, chunk.length - 1).toString('utf8');
        if (sqlText.startsWith('BEGIN')) {
          socket.write(Buffer.concat([commandCompleteFrame('BEGIN'), readyFrame('T')]));
        } else if (sqlText === 'COMMIT') {
          socket.write(Buffer.concat([commandCompleteFrame('COMMIT'), readyFrame('I')]));
        } else {
          counter += 1;
          const n = String(counter);
          setTimeout(() => {
            socket.write(
              Buffer.concat([
                rowDescriptionFrame([{ name: 'n', oid: 23 }]),
                dataRowFrame([n]),
                commandCompleteFrame('SELECT 1'),
                readyFrame('T'),
              ]),
            );
          }, 5);
        }
      });
    });

    const sql = createPgPool(`postgres://u:p@127.0.0.1:${String(port)}/db`, {
      ssl: false,
      max: 1,
    });
    try {
      const results = await sql.begin(async (tx) =>
        Promise.all([
          tx.unsafe<{ n: number }[]>('SELECT 1'),
          tx.unsafe<{ n: number }[]>('SELECT 2'),
          tx.unsafe<{ n: number }[]>('SELECT 3'),
        ]),
      );
      expect(results.map((r) => r[0]?.n)).toEqual([1, 2, 3]);
    } finally {
      await sql.end();
    }
  });
});
