// main/tools/features/archive.ts
import { lstatSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { Parser } from 'tar';

import { manifest, sha256, sourcePath, type FeatureManifest } from './manifest';

const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_SOURCE = 32 * 1024 * 1024;
export interface FeatureArchive {
  manifest: FeatureManifest;
  files: Map<string, Buffer>;
  digest: string;
}
/** Parse into bounded memory. No archive member is ever extracted to the filesystem. */
export async function readArchive(file: string, expectedHash?: string): Promise<FeatureArchive> {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE)
    throw new Error('Expected a regular archive under 8 MiB.');
  return readArchiveBytes(readFileSync(file), expectedHash);
}
/** Parse an uploaded archive once; callers can retain the verified result for installation. */
export async function readArchiveBytes(
  compressed: Buffer,
  expectedHash?: string,
): Promise<FeatureArchive> {
  if (compressed.length > MAX_ARCHIVE) throw new Error('Archive exceeds 8 MiB.');
  const digest = sha256(compressed);
  if (expectedHash !== undefined && digest !== expectedHash)
    throw new Error('Archive SHA-256 does not match.');
  const input = gunzipSync(compressed, { maxOutputLength: MAX_SOURCE });
  const files = new Map<string, Buffer>();
  const names = new Set<string>();
  let failure: Error | undefined;
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({
      strict: true,
      onReadEntry(entry) {
        const chunks: Buffer[] = [];
        try {
          if (entry.type !== 'File')
            throw new Error(`Only regular files are allowed: ${entry.path}`);
          if (entry.path !== 'feature.json') sourcePath(entry.path);
          if (names.has(entry.path.toLowerCase()))
            throw new Error(`Duplicate archive path: ${entry.path}`);
          names.add(entry.path.toLowerCase());
          total += entry.size;
          if (names.size > 201 || entry.size > 2 * 1024 * 1024 || total > MAX_SOURCE)
            throw new Error('Feature archive exceeds source limits.');
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
        entry.on('data', (chunk: Buffer) => {
          if (failure === undefined) chunks.push(chunk);
        });
        entry.on('end', () => {
          if (failure === undefined) files.set(entry.path, Buffer.concat(chunks));
        });
        entry.on('error', reject);
      },
    });
    parser.on('error', reject);
    parser.on('end', () => (failure === undefined ? resolve() : reject(failure)));
    parser.end(input);
  });
  const metadata = files.get('feature.json');
  if (metadata === undefined)
    throw new Error('Missing feature.json. Use a BSLT feature pack, not a full edition archive.');
  const m = manifest(JSON.parse(metadata.toString('utf8')));
  files.delete('feature.json');
  if (files.size !== Object.keys(m.files).length) throw new Error('Archive inventory mismatch.');
  for (const [name, hash] of Object.entries(m.files)) {
    const data = files.get(name);
    if (data === undefined || sha256(data) !== hash)
      throw new Error(`Feature integrity mismatch: ${name}`);
  }
  return { manifest: m, files, digest };
}
