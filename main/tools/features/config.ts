// main/tools/features/config.ts
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { json, object } from './manifest';

export const CONFIG_FILE = '.bslt-features.json';
export function inputPath(value: string): string {
  const trimmed = value.trim();
  const unquoted = /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
  return unquoted.startsWith('~/') || unquoted.startsWith('~\\')
    ? path.join(os.homedir(), unquoted.slice(2))
    : unquoted;
}
function regularConfig(root: string): string {
  const file = path.join(root, CONFIG_FILE);
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024)
      throw new Error(`Invalid ${CONFIG_FILE}. Use a regular file under 16 KiB.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return file;
}
export function savedCatalog(root: string): string | undefined {
  const file = regularConfig(root);
  if (!existsSync(file)) return undefined;
  try {
    const config = object(JSON.parse(readFileSync(file, 'utf8')));
    if (
      Object.keys(config).sort().join(',') !== 'catalog,schemaVersion' ||
      config['schemaVersion'] !== 1 ||
      typeof config['catalog'] !== 'string' ||
      !config['catalog']
    )
      throw new Error();
    return config['catalog'];
  } catch {
    throw new Error(
      `Invalid ${CONFIG_FILE}. Run pnpm features:setup <catalog-path-or-url> to replace it.`,
    );
  }
}
/** Persist only a stable source address, never a bearer token or signed URL. */
export function catalogAddress(root: string, source: string): string {
  source = inputPath(source);
  if (!source) throw new Error('Provide a catalog path or HTTPS URL.');
  if (/^https?:\/\//i.test(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error('Invalid catalog URL.');
    }
    if (url.username || url.password || url.search || url.hash)
      throw new Error(
        'Save a stable catalog URL without credentials or query parameters. Use BSLT_FEATURE_TOKEN for access, or --catalog for a temporary signed URL.',
      );
    return url.href;
  }
  if (/^[a-z]+:\/\//i.test(source)) throw new Error('Use a local catalog path or HTTPS URL.');
  return path.relative(root, path.resolve(root, source)) || '.';
}
export function saveCatalog(root: string, source: string): void {
  const file = regularConfig(root);
  const data = json({ schemaVersion: 1, catalog: catalogAddress(root, source) });
  if (Buffer.byteLength(data) > 16 * 1024) throw new Error('Catalog address is too long.');
  const temporary = mkdtempSync(path.join(root, '.bslt-feature-setup-'));
  try {
    const next = path.join(temporary, 'config.json');
    writeFileSync(next, data, { mode: 0o600, flag: 'wx' });
    regularConfig(root);
    renameSync(next, file);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
