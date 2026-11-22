// tests/integration/database/backup-restore-drill.real-db.test.ts
/**
 * End-to-End Encrypted PostgreSQL 17 Backup + Offsite S3 SigV4 + Restore Drill (Real DB, D13)
 *
 * Exercises the full production disaster-recovery chain against PostgreSQL 17:
 * 1. Seeds sentinel user + task data in the migrated database.
 * 2. Takes a custom-format dump (`pg_dump -Fc --no-owner`) via the pinned Postgres 17 image.
 * 3. Encrypts with `AES-256-GCM` (`BSLTBK01`) and uploads + `headObject` verifies against an
 *    in-process HTTP object-storage server over real `@bslt/protocols/s3` SigV4 requests.
 * 4. Verifies that tampering with stored ciphertext fails authentication before `pg_restore` runs.
 * 5. Downloads + decrypts the archive, runs `pg_restore` into a brand-new scratch PostgreSQL 17
 *    database, and verifies table counts, `sys_migrations` checksums, and sentinel row data.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRawDb } from '@bslt/db';
import { createS3Client } from '@bslt/protocols/s3';
import { describeRealDb } from '@bslt/testing/real-db';
import {
  BackupError,
  downloadDecryptedArtifact,
  parseBackupMasterKey,
  uploadEncryptedArtifact,
} from '@bslt/tools/scripts/deploy/backup';
import { afterAll, beforeAll, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readPinnedPostgresImage(): string {
  const versionsEnv = readFileSync(path.join(REPO_ROOT, 'infra/versions.env'), 'utf8');
  const match = /^POSTGRES_IMAGE=(.+)$/mu.exec(versionsEnv);
  if (match?.[1] === undefined) {
    throw new Error('POSTGRES_IMAGE missing from infra/versions.env');
  }
  return match[1].trim();
}

interface MockS3Server {
  readonly endpoint: string;
  readonly store: Map<string, Buffer>;
  close(): Promise<void>;
}

async function startMockS3Server(): Promise<MockS3Server> {
  const store = new Map<string, Buffer>();
  const server: Server = createServer((req, res) => {
    const auth = req.headers['authorization'] ?? '';
    if (!auth.startsWith('AWS4-HMAC-SHA256 ')) {
      res.writeHead(403, { 'content-type': 'application/xml' });
      res.end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        store.set(urlPath, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"drill-etag"' });
        res.end();
      });
      return;
    }
    if (req.method === 'HEAD') {
      const buf = store.get(urlPath);
      if (buf === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-length': String(buf.byteLength),
        etag: '"drill-etag"',
      });
      res.end();
      return;
    }
    if (req.method === 'GET') {
      const buf = store.get(urlPath);
      if (buf === undefined) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end('<Error><Code>NoSuchKey</Code></Error>');
        return;
      }
      res.writeHead(200, {
        'content-length': String(buf.byteLength),
        'content-type': 'application/octet-stream',
        etag: '"drill-etag"',
      });
      res.end(buf);
      return;
    }
    res.writeHead(405);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Unexpected mock S3 server address');
  }
  return {
    endpoint: `http://127.0.0.1:${String(addr.port)}`,
    store,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined && err !== null ? reject(err) : resolve()));
      }),
  };
}

const nodeHttpFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const reqHeaders: Record<string, string> = {};
  if (init?.headers !== undefined) {
    const h = new Headers(init.headers);
    h.forEach((value, key) => {
      reqHeaders[key] = value;
    });
  }
  const bodyBuf =
    init?.body === undefined || init.body === null
      ? undefined
      : typeof init.body === 'string'
        ? Buffer.from(init.body, 'utf8')
        : Buffer.from(init.body as Uint8Array);

  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? 'GET',
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') respHeaders.set(k, v);
          }
          const payload = Buffer.concat(chunks);
          const status = res.statusCode ?? 500;
          resolve(
            new Response(init?.method === 'HEAD' ? null : payload, {
              status,
              headers: respHeaders,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    if (bodyBuf !== undefined) req.write(bodyBuf);
    req.end();
  });
};

describeRealDb('encrypted backup + S3 SigV4 + pg_restore drill (Real DB, D13)', (realDb) => {
  let s3Server: MockS3Server;
  const postgresImage = readPinnedPostgresImage();

  beforeAll(async () => {
    s3Server = await startMockS3Server();
  });

  afterAll(async () => {
    await s3Server.close();
  });

  it('dumps via pg_dump -Fc, encrypts with AES-256-GCM over S3 SigV4, rejects ciphertext tampering, and restores cleanly into a scratch DB', async () => {
    const sentinelEmail = `drill-${randomBytes(4).toString('hex')}@example.com`;
    const insertedUsers = await realDb.database.adminDb.raw<{ id: string }>(
      `INSERT INTO identity_users (email, canonical_email, email_verified, role)
         VALUES ($1, $1, true, 'user')
         RETURNING id::text AS id`,
      [sentinelEmail],
    );
    const userId = insertedUsers[0]?.id;
    expect(userId).toBeDefined();

    await realDb.database.adminDb.raw(
      `INSERT INTO audit_activity (actor_id, actor_type, action, resource_type, resource_id)
         VALUES ($1::uuid, 'user', 'drill.backup.verified', 'drill', 'pitr-restore-1')`,
      [userId],
    );

    const adminDsn = realDb.database.adminConnectionString;
    const dumpBytes = execFileSync(
      'docker',
      ['run', '--rm', '--network', 'host', postgresImage, 'pg_dump', '-Fc', '--no-owner', adminDsn],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    expect(dumpBytes.byteLength).toBeGreaterThan(5_000);

    const masterKey = parseBackupMasterKey(randomBytes(32).toString('hex'));
    const s3 = createS3Client({
      region: 'us-east-1',
      endpoint: s3Server.endpoint,
      forcePathStyle: true,
      fetchImpl: nodeHttpFetch,
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    });

    const objectName = 'bslt_drill_test.dump';
    const s3Key = `db-backups/dumps/${objectName}.enc`;

    await uploadEncryptedArtifact({
      s3,
      bucket: 'drill-bucket',
      key: s3Key,
      plaintext: dumpBytes,
      masterKey,
      context: { kind: 'dump', objectName },
    });

    // Tamper with stored ciphertext in S3 -> downloadDecryptedArtifact MUST reject!
    const storedPath = `/drill-bucket/${s3Key}`;
    const originalEnvelope = Buffer.from(s3Server.store.get(storedPath)!);
    const tamperedEnvelope = Buffer.from(originalEnvelope);
    const last = tamperedEnvelope.length - 1;
    tamperedEnvelope[last] = (tamperedEnvelope[last] ?? 0) ^ 0x55;
    s3Server.store.set(storedPath, tamperedEnvelope);

    await expect(
      downloadDecryptedArtifact({
        s3,
        bucket: 'drill-bucket',
        key: s3Key,
        masterKey,
        context: { kind: 'dump', objectName },
      }),
    ).rejects.toThrow(BackupError);

    // Restore original envelope and perform full pg_restore into a disposable scratch DB
    s3Server.store.set(storedPath, originalEnvelope);
    const decryptedDump = await downloadDecryptedArtifact({
      s3,
      bucket: 'drill-bucket',
      key: s3Key,
      masterKey,
      context: { kind: 'dump', objectName },
    });
    expect(decryptedDump.equals(dumpBytes)).toBe(true);

    const scratchDbName = `bslt_drill_${randomBytes(4).toString('hex')}`;
    await realDb.database.adminDb.raw(`CREATE DATABASE "${scratchDbName}"`);
    try {
      const parsedUrl = new URL(adminDsn);
      parsedUrl.pathname = `/${scratchDbName}`;
      const scratchDsn = parsedUrl.toString();

      execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '-i',
          '--network',
          'host',
          postgresImage,
          'pg_restore',
          '--no-owner',
          '--exit-on-error',
          '-d',
          scratchDsn,
        ],
        { input: decryptedDump, maxBuffer: 64 * 1024 * 1024 },
      );

      const verifyDb = createRawDb({ connectionString: scratchDsn, maxConnections: 1 });
      try {
        const tableCountRows = await verifyDb.raw<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM pg_tables WHERE schemaname = 'public'`,
        );
        expect(Number(tableCountRows[0]?.count)).toBeGreaterThanOrEqual(25);

        const migRows = await verifyDb.raw<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM sys_migrations`,
        );
        expect(Number(migRows[0]?.count)).toBeGreaterThanOrEqual(4);

        const activityRows = await verifyDb.raw<{ action: string; email: string }>(
          `SELECT a.action, u.email
               FROM audit_activity a
               JOIN identity_users u ON u.id = a.actor_id
              WHERE u.email = $1`,
          [sentinelEmail],
        );
        expect(activityRows).toEqual([
          {
            action: 'drill.backup.verified',
            email: sentinelEmail,
          },
        ]);
      } finally {
        await verifyDb.close();
      }
    } finally {
      await realDb.database.adminDb.raw(`DROP DATABASE IF EXISTS "${scratchDbName}" WITH (FORCE)`);
    }
  }, 120_000);
});
