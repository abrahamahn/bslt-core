// main/tools/scripts/deploy/backup.test.ts
import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  BackupError,
  archiveWalSegment,
  decryptBackupPayload,
  downloadDecryptedArtifact,
  encryptBackupPayload,
  formatBackupFreshnessMetrics,
  parseBackupMasterKey,
  restoreWalSegment,
  uploadEncryptedArtifact,
  validateWalSegmentName,
} from './backup';

import type { S3ProtocolClient } from '@bslt/protocols/s3';

function createInMemoryS3(
  options: { corruptHeadSize?: boolean; dropPut?: boolean } = {},
): S3ProtocolClient {
  const objects = new Map<string, Uint8Array>();
  return {
    putObject: vi.fn(async ({ bucket, key, body }) => {
      if (!options.dropPut) {
        const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : new Uint8Array(body);
        objects.set(`${bucket}/${key}`, bytes);
      }
      return { etag: '"etag-1"' };
    }),
    getObject: vi.fn(async ({ bucket, key }) => {
      const found = objects.get(`${bucket}/${key}`);
      if (found === undefined) {
        throw new Error(`NoSuchKey: ${bucket}/${key}`);
      }
      return { body: found, contentLength: found.byteLength };
    }),
    headObject: vi.fn(async ({ bucket, key }) => {
      const found = objects.get(`${bucket}/${key}`);
      if (found === undefined) {
        return { exists: false as const };
      }
      return {
        exists: true as const,
        contentLength: options.corruptHeadSize ? found.byteLength - 1 : found.byteLength,
      };
    }),
  } as unknown as S3ProtocolClient;
}

describe('encrypted backup & PITR WAL archive engine (D13)', () => {
  const validHexKey = randomBytes(32).toString('hex');
  const otherHexKey = randomBytes(32).toString('hex');

  it('rejects empty, short, or malformed master keys', () => {
    expect(() => parseBackupMasterKey('')).toThrow(BackupError);
    expect(() => parseBackupMasterKey('001122')).toThrow(BackupError);
    expect(() => parseBackupMasterKey('zz'.repeat(32))).toThrow(BackupError);
    expect(parseBackupMasterKey(validHexKey).byteLength).toBe(32);
  });

  it('detects tampering, truncation, wrong key, and AAD context replay on AES-256-GCM envelopes', () => {
    const key = parseBackupMasterKey(validHexKey);
    const wrongKey = parseBackupMasterKey(otherHexKey);
    const plaintext = Buffer.from('PGDMP-custom-archive-payload-bytes', 'utf8');

    const envelope = encryptBackupPayload(plaintext, key, {
      kind: 'dump',
      objectName: 'bslt_20261121_030000Z.dump',
    });

    // Truncated envelope
    expect(() =>
      decryptBackupPayload(envelope.subarray(0, 20), key, {
        kind: 'dump',
        objectName: 'bslt_20261121_030000Z.dump',
      }),
    ).toThrow(BackupError);

    // Wrong magic header
    const badMagic = Buffer.from(envelope);
    badMagic[0] = 0x00;
    expect(() =>
      decryptBackupPayload(badMagic, key, {
        kind: 'dump',
        objectName: 'bslt_20261121_030000Z.dump',
      }),
    ).toThrow(BackupError);

    // Wrong key
    expect(() =>
      decryptBackupPayload(envelope, wrongKey, {
        kind: 'dump',
        objectName: 'bslt_20261121_030000Z.dump',
      }),
    ).toThrow(BackupError);

    // Flipped ciphertext byte
    const flipped = Buffer.from(envelope);
    const lastIdx = flipped.length - 1;
    flipped[lastIdx] = (flipped[lastIdx] ?? 0) ^ 0xff;
    expect(() =>
      decryptBackupPayload(flipped, key, {
        kind: 'dump',
        objectName: 'bslt_20261121_030000Z.dump',
      }),
    ).toThrow(BackupError);

    // Context replay (renaming one backup / WAL segment over another)
    expect(() =>
      decryptBackupPayload(envelope, key, {
        kind: 'dump',
        objectName: 'bslt_20260101_000000Z.dump',
      }),
    ).toThrow(BackupError);
    expect(() =>
      decryptBackupPayload(envelope, key, {
        kind: 'wal',
        objectName: 'bslt_20261121_030000Z.dump',
      }),
    ).toThrow(BackupError);

    // Valid round-trip
    const decrypted = decryptBackupPayload(envelope, key, {
      kind: 'dump',
      objectName: 'bslt_20261121_030000Z.dump',
    });
    expect(Buffer.from(decrypted).equals(plaintext)).toBe(true);
  });

  it('fails upload when S3 read-back headObject is missing or truncated, and round-trips valid artifacts', async () => {
    const key = parseBackupMasterKey(validHexKey);
    const payload = Buffer.from('logical-dump-bytes', 'utf8');

    const droppingS3 = createInMemoryS3({ dropPut: true });
    await expect(
      uploadEncryptedArtifact({
        s3: droppingS3,
        bucket: 'backups',
        key: 'db-backups/bslt_1.dump.enc',
        plaintext: payload,
        masterKey: key,
        context: { kind: 'dump', objectName: 'bslt_1.dump' },
      }),
    ).rejects.toThrow(BackupError);

    const corruptSizeS3 = createInMemoryS3({ corruptHeadSize: true });
    await expect(
      uploadEncryptedArtifact({
        s3: corruptSizeS3,
        bucket: 'backups',
        key: 'db-backups/bslt_1.dump.enc',
        plaintext: payload,
        masterKey: key,
        context: { kind: 'dump', objectName: 'bslt_1.dump' },
      }),
    ).rejects.toThrow(BackupError);

    const healthyS3 = createInMemoryS3();
    const uploaded = await uploadEncryptedArtifact({
      s3: healthyS3,
      bucket: 'backups',
      key: 'db-backups/bslt_1.dump.enc',
      plaintext: payload,
      masterKey: key,
      context: { kind: 'dump', objectName: 'bslt_1.dump' },
    });
    expect(uploaded.encryptedBytes).toBeGreaterThan(payload.byteLength);

    const restored = await downloadDecryptedArtifact({
      s3: healthyS3,
      bucket: 'backups',
      key: 'db-backups/bslt_1.dump.enc',
      masterKey: key,
      context: { kind: 'dump', objectName: 'bslt_1.dump' },
    });
    expect(Buffer.from(restored).equals(payload)).toBe(true);
  });

  it('rejects path traversal in PITR WAL segment names and round-trips valid WAL segments + Prometheus metrics', async () => {
    expect(() => validateWalSegmentName('../etc/passwd')).toThrow(BackupError);
    expect(() => validateWalSegmentName('000000010000000000000001;rm -rf /')).toThrow(BackupError);
    expect(() => validateWalSegmentName('lowercase000000000000001')).toThrow(BackupError);

    const walName = '00000001000000000000004A';
    expect(validateWalSegmentName(walName)).toBe(walName);
    expect(validateWalSegmentName('00000002.history')).toBe('00000002.history');

    const s3 = createInMemoryS3();
    const key = parseBackupMasterKey(validHexKey);
    const walBytes = randomBytes(4096);

    await archiveWalSegment({
      s3,
      bucket: 'backups',
      prefix: 'pitr',
      segmentName: walName,
      walBytes,
      masterKey: key,
    });

    const fetchedWal = await restoreWalSegment({
      s3,
      bucket: 'backups',
      prefix: 'pitr',
      segmentName: walName,
      masterKey: key,
    });
    expect(Buffer.from(fetchedWal).equals(walBytes)).toBe(true);

    const prom = formatBackupFreshnessMetrics({
      timestampSeconds: 1_700_000_000,
      encryptedBytes: 123_456,
      durationSeconds: 4.25,
    });
    expect(prom).toContain('bslt_backup_last_success_timestamp_seconds 1700000000');
    expect(prom).toContain('bslt_backup_last_size_bytes 123456');
    expect(prom).toContain('bslt_backup_last_duration_seconds 4.25');
  });
});
