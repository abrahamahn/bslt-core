// main/tools/scripts/deploy/backup.ts
/**
 * In-network encrypted PostgreSQL logical backup (`pg_dump -Fc`) and PITR WAL
 * archive/restore primitives (`@bslt/protocols/s3` + `AES-256-GCM`, owner decision D13).
 *
 * Binary envelope layout (`BSLTBK01`):
 * - `[0..8)`:   ASCII magic `BSLTBK01`
 * - `[8..24)`:  16-byte random HKDF-SHA256 salt
 * - `[24..36)`: 12-byte random AES-256-GCM IV
 * - `[36..52)`: 16-byte AES-256-GCM authentication tag
 * - `[52..)`:   Ciphertext (authenticated with AAD `BSLTBK01|<kind>:<objectName>`)
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { createS3Client, type S3ProtocolClient } from '@bslt/protocols/s3';

const MAGIC = Buffer.from('BSLTBK01', 'ascii');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.byteLength + SALT_LEN + IV_LEN + TAG_LEN; // 52 bytes
const HKDF_INFO = Buffer.from('bslt-backup-aes-256-gcm-v1', 'utf8');
const HEX_KEY_RE = /^[0-9a-fA-F]{64,}$/u;
const WAL_SEGMENT_RE = /^(?:[0-9A-F]{24}(?:\.[0-9A-F]{8}\.backup)?|[0-9A-F]{8}\.history)$/u;

export interface BackupEnvelopeContext {
  readonly kind: 'dump' | 'wal';
  readonly objectName: string;
}

export class BackupError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'BackupError';
  }
}

export function parseBackupMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new BackupError('BACKUP_ENCRYPTION_KEY is empty (expected 32-byte hex key)');
  }
  if (!HEX_KEY_RE.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new BackupError(
      'BACKUP_ENCRYPTION_KEY must be at least 64 hex characters (openssl rand -hex 32)',
    );
  }
  const key = Buffer.from(trimmed, 'hex');
  if (key.byteLength < 32) {
    throw new BackupError('BACKUP_ENCRYPTION_KEY decoded to fewer than 32 bytes');
  }
  return key;
}

function buildAad(context: BackupEnvelopeContext): Buffer {
  if (context.objectName.trim() === '' || context.objectName.includes('/')) {
    throw new BackupError(`Invalid backup objectName "${context.objectName}"`);
  }
  return Buffer.from(`BSLTBK01|${context.kind}:${context.objectName}`, 'utf8');
}

function deriveDataKey(masterKey: Uint8Array, salt: Uint8Array): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, HKDF_INFO, 32));
}

export function encryptBackupPayload(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  context: BackupEnvelopeContext,
): Buffer {
  if (masterKey.byteLength < 32) {
    throw new BackupError('Master key must be at least 32 bytes');
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const dataKey = deriveDataKey(masterKey, salt);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(buildAad(context));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
}

export function decryptBackupPayload(
  envelope: Uint8Array,
  masterKey: Uint8Array,
  context: BackupEnvelopeContext,
): Buffer {
  if (envelope.byteLength < HEADER_LEN) {
    throw new BackupError(
      `Encrypted backup envelope is truncated (${String(envelope.byteLength)} bytes < ${String(HEADER_LEN)})`,
    );
  }
  if (masterKey.byteLength < 32) {
    throw new BackupError('Master key must be at least 32 bytes');
  }
  const buf = Buffer.from(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  if (!buf.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new BackupError('Invalid backup envelope magic header (expected BSLTBK01)');
  }
  const salt = buf.subarray(8, 24);
  const iv = buf.subarray(24, 36);
  const tag = buf.subarray(36, 52);
  const ciphertext = buf.subarray(52);

  try {
    const dataKey = deriveDataKey(masterKey, salt);
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
    decipher.setAAD(buildAad(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new BackupError(
      'Encrypted backup authentication failed (wrong key or tampered data)',
      err,
    );
  }
}

export async function uploadEncryptedArtifact(params: {
  readonly s3: S3ProtocolClient;
  readonly bucket: string;
  readonly key: string;
  readonly plaintext: Uint8Array;
  readonly masterKey: Uint8Array;
  readonly context: BackupEnvelopeContext;
}): Promise<{
  readonly plaintextSha256: string;
  readonly ciphertextSha256: string;
  readonly encryptedBytes: number;
}> {
  const plaintextSha256 = createHash('sha256').update(params.plaintext).digest('hex');
  const envelope = encryptBackupPayload(params.plaintext, params.masterKey, params.context);
  const ciphertextSha256 = createHash('sha256').update(envelope).digest('hex');

  await params.s3.putObject({
    bucket: params.bucket,
    key: params.key,
    body: envelope,
    contentType: 'application/octet-stream',
    metadata: {
      'plaintext-sha256': plaintextSha256,
      'ciphertext-sha256': ciphertextSha256,
    },
  });

  const head = await params.s3.headObject({
    bucket: params.bucket,
    key: params.key,
  });
  if (!head.exists) {
    throw new BackupError(
      `Offsite upload verification failed: s3://${params.bucket}/${params.key} missing on headObject`,
    );
  }
  if (head.contentLength !== envelope.byteLength) {
    throw new BackupError(
      `Offsite upload size mismatch for s3://${params.bucket}/${params.key}: expected ${String(envelope.byteLength)}, got ${String(head.contentLength)}`,
    );
  }

  return {
    plaintextSha256,
    ciphertextSha256,
    encryptedBytes: envelope.byteLength,
  };
}

export async function downloadDecryptedArtifact(params: {
  readonly s3: S3ProtocolClient;
  readonly bucket: string;
  readonly key: string;
  readonly masterKey: Uint8Array;
  readonly context: BackupEnvelopeContext;
}): Promise<Buffer> {
  const fetched = await params.s3.getObject({
    bucket: params.bucket,
    key: params.key,
  });
  return decryptBackupPayload(fetched.body, params.masterKey, params.context);
}

export function validateWalSegmentName(segmentName: string): string {
  if (!WAL_SEGMENT_RE.test(segmentName)) {
    throw new BackupError(`Invalid PostgreSQL WAL segment name: "${segmentName}"`);
  }
  return segmentName;
}

export async function archiveWalSegment(params: {
  readonly s3: S3ProtocolClient;
  readonly bucket: string;
  readonly prefix: string;
  readonly segmentName: string;
  readonly walBytes: Uint8Array;
  readonly masterKey: Uint8Array;
}): Promise<{ readonly s3Key: string; readonly encryptedBytes: number }> {
  const validName = validateWalSegmentName(params.segmentName);
  const cleanPrefix = params.prefix.replace(/^\/+|\/+$/gu, '');
  const s3Key = `${cleanPrefix}/wal/${validName}.enc`;
  const uploaded = await uploadEncryptedArtifact({
    s3: params.s3,
    bucket: params.bucket,
    key: s3Key,
    plaintext: params.walBytes,
    masterKey: params.masterKey,
    context: { kind: 'wal', objectName: validName },
  });
  return { s3Key, encryptedBytes: uploaded.encryptedBytes };
}

export async function restoreWalSegment(params: {
  readonly s3: S3ProtocolClient;
  readonly bucket: string;
  readonly prefix: string;
  readonly segmentName: string;
  readonly masterKey: Uint8Array;
}): Promise<Buffer> {
  const validName = validateWalSegmentName(params.segmentName);
  const cleanPrefix = params.prefix.replace(/^\/+|\/+$/gu, '');
  const s3Key = `${cleanPrefix}/wal/${validName}.enc`;
  return downloadDecryptedArtifact({
    s3: params.s3,
    bucket: params.bucket,
    key: s3Key,
    masterKey: params.masterKey,
    context: { kind: 'wal', objectName: validName },
  });
}

export function formatBackupFreshnessMetrics(input: {
  readonly timestampSeconds: number;
  readonly encryptedBytes: number;
  readonly durationSeconds: number;
}): string {
  return [
    '# HELP bslt_backup_last_success_timestamp_seconds Unix timestamp of the last verified encrypted offsite backup.',
    '# TYPE bslt_backup_last_success_timestamp_seconds gauge',
    `bslt_backup_last_success_timestamp_seconds ${String(Math.floor(input.timestampSeconds))}`,
    '# HELP bslt_backup_last_size_bytes Encrypted byte size of the last verified offsite backup.',
    '# TYPE bslt_backup_last_size_bytes gauge',
    `bslt_backup_last_size_bytes ${String(input.encryptedBytes)}`,
    '# HELP bslt_backup_last_duration_seconds Wall-clock duration of the last verified backup in seconds.',
    '# TYPE bslt_backup_last_duration_seconds gauge',
    `bslt_backup_last_duration_seconds ${String(input.durationSeconds)}`,
    '',
  ].join('\n');
}

export function createBackupS3ClientFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly s3: S3ProtocolClient; readonly bucket: string; readonly prefix: string } {
  const bucket = env['BACKUP_S3_BUCKET']?.trim() ?? '';
  const accessKeyId = env['AWS_ACCESS_KEY_ID']?.trim() ?? '';
  const secretAccessKey = env['AWS_SECRET_ACCESS_KEY']?.trim() ?? '';
  if (bucket === '' || accessKeyId === '' || secretAccessKey === '') {
    throw new BackupError(
      'BACKUP_S3_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY are required',
    );
  }
  const region = env['BACKUP_S3_REGION']?.trim() || 'us-east-1';
  const endpoint = env['BACKUP_S3_ENDPOINT']?.trim();
  const prefix = (env['BACKUP_S3_PREFIX']?.trim() || 'db-backups').replace(/^\/+|\/+$/gu, '');
  const s3 = createS3Client({
    region,
    ...(endpoint !== undefined && endpoint !== '' ? { endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId, secretAccessKey },
  });
  return { s3, bucket, prefix };
}

export async function runBackupCli(argv: readonly string[], env = process.env): Promise<void> {
  const [subcommand, ...rest] = argv;
  const keyRaw = env['BACKUP_ENCRYPTION_KEY'] ?? '';
  const masterKey = parseBackupMasterKey(keyRaw);

  if (subcommand === 'upload-dump') {
    const [localDumpPath, objectName, metricsOutPath] = rest;
    if (localDumpPath === undefined || objectName === undefined) {
      throw new BackupError('Usage: upload-dump <localDumpPath> <objectName> [metricsOutPath]');
    }
    const startedAt = Date.now();
    const plaintext = readFileSync(localDumpPath);
    const { s3, bucket, prefix } = createBackupS3ClientFromEnv(env);
    const s3Key = `${prefix}/dumps/${objectName}.enc`;
    const res = await uploadEncryptedArtifact({
      s3,
      bucket,
      key: s3Key,
      plaintext,
      masterKey,
      context: { kind: 'dump', objectName },
    });
    if (metricsOutPath !== undefined && metricsOutPath !== '') {
      writeFileSync(
        metricsOutPath,
        formatBackupFreshnessMetrics({
          timestampSeconds: Math.floor(Date.now() / 1000),
          encryptedBytes: res.encryptedBytes,
          durationSeconds: Math.round(((Date.now() - startedAt) / 1000) * 100) / 100,
        }),
      );
    }
    return;
  }

  if (subcommand === 'download-dump') {
    const [objectName, outputDumpPath] = rest;
    if (objectName === undefined || outputDumpPath === undefined) {
      throw new BackupError('Usage: download-dump <objectName> <outputDumpPath>');
    }
    const { s3, bucket, prefix } = createBackupS3ClientFromEnv(env);
    const plaintext = await downloadDecryptedArtifact({
      s3,
      bucket,
      key: `${prefix}/dumps/${objectName}.enc`,
      masterKey,
      context: { kind: 'dump', objectName },
    });
    writeFileSync(outputDumpPath, plaintext);
    return;
  }

  if (subcommand === 'wal-push') {
    const [walPath, segmentName] = rest;
    if (walPath === undefined || segmentName === undefined) {
      throw new BackupError('Usage: wal-push <walPath> <segmentName>');
    }
    const { s3, bucket, prefix } = createBackupS3ClientFromEnv(env);
    await archiveWalSegment({
      s3,
      bucket,
      prefix,
      segmentName,
      walBytes: readFileSync(walPath),
      masterKey,
    });
    return;
  }

  if (subcommand === 'wal-fetch') {
    const [segmentName, targetWalPath] = rest;
    if (segmentName === undefined || targetWalPath === undefined) {
      throw new BackupError('Usage: wal-fetch <segmentName> <targetWalPath>');
    }
    const { s3, bucket, prefix } = createBackupS3ClientFromEnv(env);
    const bytes = await restoreWalSegment({
      s3,
      bucket,
      prefix,
      segmentName,
      masterKey,
    });
    writeFileSync(targetWalPath, bytes);
    return;
  }

  throw new BackupError(`Unknown backup subcommand: "${String(subcommand)}"`);
}
