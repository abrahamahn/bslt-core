// main/kernel/protocols/src/ws.test.ts
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  computeWebSocketAccept,
  encodeWsFrame,
  upgradeWebSocket,
  WS_OPCODES,
  WS_READY_STATES,
  WsConnection,
} from './ws';

const MASK = new Uint8Array([0x37, 0xfa, 0x21, 0x3d]);

interface DuplexHarness {
  readonly clientToServer: PassThrough;
  readonly serverToClient: PassThrough;
  readonly conn: WsConnection;
  readonly sentFrames: Buffer[];
}

/**
 * Create an in-memory bidirectional stream pair around `WsConnection` so every
 * RFC 6455 / Autobahn framing edge case can be driven byte-by-byte.
 */
function createFrameHarness(options: { maxPayloadBytes?: number } = {}): DuplexHarness {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const sentFrames: Buffer[] = [];

  serverToClient.on('data', (chunk: Buffer) => {
    sentFrames.push(Buffer.from(chunk));
  });

  const fakeSocket = {
    write: (chunk: string | Uint8Array): boolean => serverToClient.write(chunk),
    end: (): void => {
      serverToClient.end();
    },
    destroy: (): void => {
      clientToServer.destroy();
      serverToClient.destroy();
    },
    on: clientToServer.on.bind(clientToServer),
    get writableLength(): number {
      return serverToClient.writableLength;
    },
  };

  const conn = new WsConnection(fakeSocket, options);
  return { clientToServer, serverToClient, conn, sentFrames };
}

function parseSingleServerFrame(buf: Buffer): {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
} {
  const b0 = buf[0] ?? 0;
  const b1 = buf[1] ?? 0;
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  return {
    fin,
    opcode,
    payload: buf.subarray(offset, offset + len),
  };
}

function parseServerCloseCode(frames: readonly Buffer[]): number | null {
  const combined = Buffer.concat(frames);
  let cursor = 0;
  while (cursor + 2 <= combined.byteLength) {
    const b0 = combined[cursor] ?? 0;
    const b1 = combined[cursor + 1] ?? 0;
    const opcode = b0 & 0x0f;
    let len = b1 & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      len = combined.readUInt16BE(cursor + 2);
      headerLen = 4;
    } else if (len === 127) {
      len = Number(combined.readBigUInt64BE(cursor + 2));
      headerLen = 10;
    }
    const payload = combined.subarray(cursor + headerLen, cursor + headerLen + len);
    if (opcode === WS_OPCODES.CLOSE) {
      return payload.byteLength >= 2 ? payload.readUInt16BE(0) : 1005;
    }
    cursor += headerLen + len;
  }
  return null;
}

const activeServers: Server[] = [];
const activeSockets: Socket[] = [];

afterEach(async () => {
  while (activeSockets.length > 0) {
    activeSockets.pop()?.destroy();
  }
  while (activeServers.length > 0) {
    const srv = activeServers.pop();
    if (srv !== undefined) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  }
});

describe('RFC 6455 handshake and computeWebSocketAccept', () => {
  it('computes the exact RFC 6455 section 4.2.2 Sec-WebSocket-Accept vector', () => {
    expect(computeWebSocketAccept('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it.each([
    ['empty key', ''],
    ['short base64 key (8 bytes)', randomBytes(8).toString('base64')],
    ['long base64 key (24 bytes)', randomBytes(24).toString('base64')],
    ['non-base64 characters', 'not-valid-base64-key!!!!'],
  ])('rejects invalid Sec-WebSocket-Key (%s)', (_label, badKey) => {
    expect(() => computeWebSocketAccept(badKey)).toThrow(TypeError);
  });

  it('upgrades valid HTTP/1.1 requests over node:http and exchanges text frames', async () => {
    const serverMessages: string[] = [];
    const httpServer = createServer();
    activeServers.push(httpServer);

    httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
      activeSockets.push(socket as Socket);
      const ws = upgradeWebSocket(req, socket, head, {
        selectProtocol: (protocols) => (protocols.includes('v1.realtime') ? 'v1.realtime' : null),
      });
      if (ws === null) return;
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          const text = typeof data === 'string' ? data : data.toString('utf8');
          serverMessages.push(text);
          ws.send(`ack:${text}`);
        }
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;

    const clientSocket = connect({ host: '127.0.0.1', port });
    activeSockets.push(clientSocket);

    const key = randomBytes(16).toString('base64');
    const responseBuffer = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      clientSocket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const merged = Buffer.concat(chunks);
        const headerEnd = merged.indexOf('\r\n\r\n');
        if (headerEnd !== -1 && merged.byteLength > headerEnd + 4) {
          resolve(merged);
        } else if (headerEnd !== -1 && merged.subarray(0, headerEnd).includes('101')) {
          clientSocket.write(
            encodeWsFrame(WS_OPCODES.TEXT, Buffer.from('hello-rfc6455', 'utf8'), { maskKey: MASK }),
          );
        }
      });
      clientSocket.write(
        [
          'GET /ws HTTP/1.1',
          `Host: 127.0.0.1:${String(port)}`,
          'Upgrade: websocket',
          'Connection: keep-alive, Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Protocol: v1.realtime, other',
          '',
          '',
        ].join('\r\n'),
      );
    });

    const headerEnd = responseBuffer.indexOf('\r\n\r\n');
    const headerText = responseBuffer.subarray(0, headerEnd).toString('ascii');
    expect(headerText).toContain('HTTP/1.1 101 Switching Protocols');
    expect(headerText).toContain(`Sec-WebSocket-Accept: ${computeWebSocketAccept(key)}`);
    expect(headerText).toContain('Sec-WebSocket-Protocol: v1.realtime');

    const replyFrame = parseSingleServerFrame(responseBuffer.subarray(headerEnd + 4));
    expect(replyFrame.opcode).toBe(WS_OPCODES.TEXT);
    expect(replyFrame.payload.toString('utf8')).toBe('ack:hello-rfc6455');
    expect(serverMessages).toEqual(['hello-rfc6455']);
  });

  it.each([
    [
      'missing Upgrade header',
      {
        connection: 'Upgrade',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
      '400',
    ],
    [
      'unsupported Sec-WebSocket-Version 8',
      {
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-version': '8',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
      '426',
    ],
    [
      'invalid Sec-WebSocket-Key',
      {
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'bad-key',
      },
      '400',
    ],
  ])('rejects malformed HTTP upgrade (%s)', (_label, headers, expectedStatus) => {
    const written: string[] = [];
    let destroyed = false;
    const fakeSocket = {
      write(chunk: string | Uint8Array) {
        written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
      destroy() {
        destroyed = true;
      },
    } as unknown as PassThrough;

    const req = {
      method: 'GET',
      url: '/ws',
      headers,
    } as unknown as IncomingMessage;

    expect(upgradeWebSocket(req, fakeSocket, Buffer.alloc(0))).toBeNull();
    expect(destroyed).toBe(true);
    expect(written.join('')).toContain(expectedStatus);
  });
});

describe('RFC 6455 / Autobahn framing, fragmentation, ping/pong, UTF-8, and close-code conformance', () => {
  it('decodes 7-bit, 16-bit (126..65535), and 64-bit (>=65536) masked payloads and fragmented messages with interleaved ping', () => {
    const { clientToServer, conn, sentFrames } = createFrameHarness({ maxPayloadBytes: 200_000 });
    const received: Array<{ data: string | Buffer; isBinary: boolean }> = [];
    conn.on('message', (data, isBinary) => {
      received.push({ data, isBinary });
    });

    // 16-bit length (300 bytes)
    const medium = 'm'.repeat(300);
    clientToServer.write(
      encodeWsFrame(WS_OPCODES.TEXT, Buffer.from(medium, 'utf8'), { maskKey: MASK }),
    );

    // 64-bit length (70,000 bytes binary)
    const largeBin = Buffer.alloc(70_000, 0xab);
    clientToServer.write(encodeWsFrame(WS_OPCODES.BINARY, largeBin, { maskKey: MASK }));

    // Fragmented UTF-8 text split mid-character ("안녕" = EC 95 88 EB 85 95) with interleaved PING!
    const utf8Bytes = Buffer.from('안녕', 'utf8');
    clientToServer.write(
      encodeWsFrame(WS_OPCODES.TEXT, utf8Bytes.subarray(0, 2), { fin: false, maskKey: MASK }),
    );
    clientToServer.write(
      encodeWsFrame(WS_OPCODES.PING, Buffer.from('hb', 'ascii'), { fin: true, maskKey: MASK }),
    );
    clientToServer.write(
      encodeWsFrame(WS_OPCODES.CONTINUATION, utf8Bytes.subarray(2), { fin: true, maskKey: MASK }),
    );

    expect(received).toHaveLength(3);
    expect(received[0]).toEqual({ data: medium, isBinary: false });
    expect(received[1]?.isBinary).toBe(true);
    expect((received[1]?.data as Buffer).equals(largeBin)).toBe(true);
    expect(received[2]).toEqual({ data: '안녕', isBinary: false });

    // Interleaved PING must have produced an unmasked PONG with identical payload 'hb'.
    expect(sentFrames.length).toBeGreaterThanOrEqual(1);
    const pong = parseSingleServerFrame(sentFrames[0] ?? Buffer.alloc(0));
    expect(pong.opcode).toBe(WS_OPCODES.PONG);
    expect(pong.payload.toString('ascii')).toBe('hb');
    expect(conn.readyState).toBe(WS_READY_STATES.OPEN);
    expect(typeof conn.bufferedAmount).toBe('number');
  });

  it.each([
    ['unmasked client text frame', Buffer.from([0x81, 0x02, 0x68, 0x69]), 1002],
    ['non-zero RSV1 bit', Buffer.from([0xc1, 0x80, 0x01, 0x02, 0x03, 0x04]), 1002],
    ['unknown reserved opcode 0x03', Buffer.from([0x83, 0x80, 0x01, 0x02, 0x03, 0x04]), 1002],
    [
      'fragmented PING control frame (FIN=0)',
      encodeWsFrame(WS_OPCODES.PING, Buffer.from('x'), { fin: false, maskKey: MASK }),
      1002,
    ],
    [
      'oversized PING control frame (126 bytes)',
      (() => {
        const payload = Buffer.alloc(126, 0x41);
        const header = Buffer.from([0x89, 0xfe, 0x00, 0x7e, 0x00, 0x00, 0x00, 0x00]);
        return Buffer.concat([header, payload]);
      })(),
      1002,
    ],
    [
      'orphan CONTINUATION frame with no active message',
      encodeWsFrame(WS_OPCODES.CONTINUATION, Buffer.from('orphan'), { fin: true, maskKey: MASK }),
      1002,
    ],
    [
      'new TEXT opcode before fragmented message finishes',
      Buffer.concat([
        encodeWsFrame(WS_OPCODES.TEXT, Buffer.from('part1'), { fin: false, maskKey: MASK }),
        encodeWsFrame(WS_OPCODES.TEXT, Buffer.from('illegal'), { fin: true, maskKey: MASK }),
      ]),
      1002,
    ],
    [
      'invalid UTF-8 bytes in TEXT frame',
      encodeWsFrame(WS_OPCODES.TEXT, Buffer.from([0xff, 0xfe, 0xfd]), { fin: true, maskKey: MASK }),
      1007,
    ],
    [
      '1-byte CLOSE frame payload',
      encodeWsFrame(WS_OPCODES.CLOSE, Buffer.from([0x03]), { fin: true, maskKey: MASK }),
      1002,
    ],
    [
      'reserved CLOSE code 1005 on the wire',
      (() => {
        const p = Buffer.alloc(2);
        p.writeUInt16BE(1005, 0);
        return encodeWsFrame(WS_OPCODES.CLOSE, p, { fin: true, maskKey: MASK });
      })(),
      1002,
    ],
    [
      'reserved CLOSE code 1006 on the wire',
      (() => {
        const p = Buffer.alloc(2);
        p.writeUInt16BE(1006, 0);
        return encodeWsFrame(WS_OPCODES.CLOSE, p, { fin: true, maskKey: MASK });
      })(),
      1002,
    ],
    [
      'out-of-range CLOSE code 5000',
      (() => {
        const p = Buffer.alloc(2);
        p.writeUInt16BE(5000, 0);
        return encodeWsFrame(WS_OPCODES.CLOSE, p, { fin: true, maskKey: MASK });
      })(),
      1002,
    ],
    [
      'invalid UTF-8 in CLOSE reason',
      (() => {
        const p = Buffer.from([0x03, 0xe8, 0xff, 0xfe]);
        return encodeWsFrame(WS_OPCODES.CLOSE, p, { fin: true, maskKey: MASK });
      })(),
      1007,
    ],
  ])('closes with RFC 6455 status %i on %s', (_label, wire, expectedCloseCode) => {
    const { clientToServer, sentFrames } = createFrameHarness();
    clientToServer.write(wire);
    expect(parseServerCloseCode(sentFrames)).toBe(expectedCloseCode);
  });

  it('closes with 1009 (Message Too Big) when a single or fragmented message exceeds maxPayloadBytes', () => {
    const single = createFrameHarness({ maxPayloadBytes: 32 });
    single.clientToServer.write(
      encodeWsFrame(WS_OPCODES.TEXT, Buffer.alloc(33, 0x61), { maskKey: MASK }),
    );
    expect(parseServerCloseCode(single.sentFrames)).toBe(1009);

    const frag = createFrameHarness({ maxPayloadBytes: 32 });
    frag.clientToServer.write(
      encodeWsFrame(WS_OPCODES.BINARY, Buffer.alloc(20, 1), { fin: false, maskKey: MASK }),
    );
    frag.clientToServer.write(
      encodeWsFrame(WS_OPCODES.CONTINUATION, Buffer.alloc(20, 1), { fin: true, maskKey: MASK }),
    );
    expect(parseServerCloseCode(frag.sentFrames)).toBe(1009);
  });
});

describe('the ./ws export', () => {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));

  const resolveWs = (conditions: readonly string[]): string =>
    spawnSync(
      process.execPath,
      [
        ...conditions.map((condition) => `--conditions=${condition}`),
        '--input-type=module',
        '--eval',
        "console.log(import.meta.resolve('@bslt/protocols/ws'))",
      ],
      { cwd: packageRoot, encoding: 'utf8', env: {} },
    ).stdout.trim();

  it('exposes only `types` and `node` conditions in package.json', () => {
    const { exports } = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8')) as {
      readonly exports: Record<string, object>;
    };
    expect(Object.keys(exports['./ws'] ?? {})).toEqual(['types', 'node']);
    expect(resolveWs(['source'])).toMatch(/\/main\/kernel\/protocols\/src\/ws\.ts$/u);
  });
});
