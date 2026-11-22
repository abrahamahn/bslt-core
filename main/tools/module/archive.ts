// main/tools/module/archive.ts
/**
 * Deterministic, zero-dependency POSIX UStar `.tar.gz` packer and hardened
 * in-memory extractor for BSLT optional module packs.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { compareText } from '../snapshot/snapshot-file';

const TAR_BLOCK_BYTES = 512;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

export interface ArchiveFileEntry {
  readonly path: string;
  readonly content: Buffer;
}

export interface ExtractArchiveOptions {
  readonly expectedSha256?: string | undefined;
  readonly maxUncompressedBytes?: number | undefined;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateSafeRelativeArchivePath(rawPath: string): string {
  if (
    rawPath.length === 0 ||
    rawPath.includes('\0') ||
    rawPath.includes('\\') ||
    rawPath.startsWith('/') ||
    rawPath.startsWith('./')
  ) {
    throw new Error(`Unsafe archive path "${rawPath}"`);
  }
  const trimmed = rawPath.replace(/\/+$/u, '');
  if (trimmed.length === 0) {
    throw new Error(`Unsafe archive path "${rawPath}"`);
  }
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..' || seg === '.git') {
      throw new Error(`Unsafe archive path "${rawPath}"`);
    }
  }
  return segments.join('/');
}

function splitUstarNameAndPrefix(safePath: string): {
  readonly name: string;
  readonly prefix: string;
} {
  if (Buffer.byteLength(safePath, 'utf8') <= 100) {
    return { name: safePath, prefix: '' };
  }
  const segments = safePath.split('/');
  for (let splitIdx = segments.length - 1; splitIdx >= 1; splitIdx -= 1) {
    const prefix = segments.slice(0, splitIdx).join('/');
    const name = segments.slice(splitIdx).join('/');
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Unsafe archive path "${safePath}": exceeds 255-byte POSIX UStar path limit`);
}

function buildUstarFileHeader(safePath: string, sizeBytes: number): Buffer {
  const { name, prefix } = splitUstarNameAndPrefix(safePath);
  const header = Buffer.alloc(TAR_BLOCK_BYTES, 0);

  header.write(name, 0, Buffer.byteLength(name, 'utf8'), 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${sizeBytes.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (prefix.length > 0) {
    header.write(prefix, 345, Buffer.byteLength(prefix, 'utf8'), 'utf8');
  }

  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK_BYTES; i += 1) {
    checksum += header[i] ?? 0;
  }
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

export function createDeterministicTarGz(entries: readonly ArchiveFileEntry[]): Buffer {
  const seen = new Set<string>();
  const normalized = entries
    .map((entry) => {
      const safePath = validateSafeRelativeArchivePath(entry.path);
      if (seen.has(safePath)) {
        throw new Error(`Duplicate archive entry path "${safePath}"`);
      }
      seen.add(safePath);
      return { path: safePath, content: entry.content };
    })
    .sort((a, b) => compareText(a.path, b.path));

  const chunks: Buffer[] = [];
  for (const entry of normalized) {
    chunks.push(buildUstarFileHeader(entry.path, entry.content.length));
    if (entry.content.length > 0) {
      chunks.push(entry.content);
      const pad = (TAR_BLOCK_BYTES - (entry.content.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
      if (pad > 0) {
        chunks.push(Buffer.alloc(pad, 0));
      }
    }
  }
  // Two 512-byte zero blocks terminate the TAR stream
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2, 0));

  const gzipped = Buffer.from(gzipSync(Buffer.concat(chunks), { level: 9 }));
  // Normalize gzip header mtime (bytes 4..7 = 0) and OS byte (byte 9 = 255) for cross-host reproducibility
  if (gzipped.length >= 10) {
    gzipped.writeUInt32LE(0, 4);
    gzipped[9] = 0xff;
  }
  return gzipped;
}

function readNullTerminatedString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const zeroIdx = slice.indexOf(0);
  const end = zeroIdx === -1 ? slice.length : zeroIdx;
  return slice.subarray(0, end).toString('utf8');
}

function parseOctalField(buf: Buffer, offset: number, length: number, label: string): number {
  const raw = readNullTerminatedString(buf, offset, length).trim();
  if (raw === '') return 0;
  if (!/^[0-7]+$/u.test(raw)) {
    throw new Error(`Invalid octal TAR header field "${label}": "${raw}"`);
  }
  return Number.parseInt(raw, 8);
}

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== 0) return false;
  }
  return true;
}

function verifyHeaderChecksum(header: Buffer): void {
  const stored = parseOctalField(header, 148, 8, 'checksum');
  let unsignedSum = 0;
  for (let i = 0; i < TAR_BLOCK_BYTES; i += 1) {
    unsignedSum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  }
  if (stored !== unsignedSum) {
    throw new Error(
      `Invalid TAR header checksum: expected ${String(stored)}, computed ${String(unsignedSum)}`,
    );
  }
}

export function extractTarGzToMemory(
  archiveBytes: Uint8Array,
  options: ExtractArchiveOptions = {},
): Map<string, Buffer> {
  if (options.expectedSha256 !== undefined) {
    const actualSha = sha256Hex(archiveBytes);
    if (actualSha !== options.expectedSha256.toLowerCase()) {
      throw new Error(
        `Archive SHA-256 checksum mismatch: expected ${options.expectedSha256}, got ${actualSha}`,
      );
    }
  }

  const maxBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  let tarBuffer: Buffer;
  try {
    tarBuffer = gunzipSync(archiveBytes, { maxOutputLength: maxBytes });
  } catch (error) {
    if (
      error instanceof Error &&
      ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ||
        /larger than/iu.test(error.message))
    ) {
      throw new Error(
        `Archive uncompressed payload exceeds maximum allowed size (${String(maxBytes)} bytes)`,
        { cause: error },
      );
    }
    throw error;
  }
  if (tarBuffer.length % TAR_BLOCK_BYTES !== 0) {
    throw new Error('Corrupt TAR stream: length is not a multiple of 512 bytes');
  }

  const files = new Map<string, Buffer>();
  let offset = 0;
  let totalPayloadBytes = 0;

  while (offset + TAR_BLOCK_BYTES <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + TAR_BLOCK_BYTES);
    offset += TAR_BLOCK_BYTES;
    if (isZeroBlock(header)) {
      break;
    }

    verifyHeaderChecksum(header);

    const typeflagByte = header[156] ?? 0;
    const typeflag = typeflagByte === 0 ? '0' : String.fromCharCode(typeflagByte);
    if (typeflag !== '0' && typeflag !== '5') {
      throw new Error(
        `Unsupported TAR entry type "${typeflag}" (only regular files and directories are permitted)`,
      );
    }

    const name = readNullTerminatedString(header, 0, 100);
    const magic = readNullTerminatedString(header, 257, 6);
    const prefix = magic.startsWith('ustar') ? readNullTerminatedString(header, 345, 155) : '';
    const combined = prefix.length > 0 ? `${prefix}/${name}` : name;
    const safePath = validateSafeRelativeArchivePath(combined);

    const size = parseOctalField(header, 124, 12, 'size');
    totalPayloadBytes += size;
    if (totalPayloadBytes > maxBytes) {
      throw new Error(`Archive payload exceeds maximum allowed size (${String(maxBytes)} bytes)`);
    }

    const paddedSize = Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    if (offset + paddedSize > tarBuffer.length) {
      throw new Error(`Truncated TAR entry "${safePath}"`);
    }

    if (typeflag === '0') {
      if (files.has(safePath)) {
        throw new Error(`Duplicate archive path "${safePath}"`);
      }
      files.set(safePath, Buffer.from(tarBuffer.subarray(offset, offset + size)));
    }
    offset += paddedSize;
  }

  return files;
}
