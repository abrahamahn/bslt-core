// main/tools/features/catalog.ts
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { savedCatalog } from './config';
import { featureId, object } from './manifest';

export const CATALOG_FILE = 'features.catalog.json';
export const CATALOG_LIMIT = 256 * 1024;
export const ARCHIVE_LIMIT = 8 * 1024 * 1024;
export interface FeatureRelease {
  id: string;
  name: string;
  version: string;
  coreVersion: string;
  sha256: string;
  archive: string;
}
export interface FeatureCatalog {
  schemaVersion: 1;
  features: FeatureRelease[];
}
export interface CatalogOptions {
  catalog?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (message: string) => void;
}
export interface LoadedCatalog {
  catalog: FeatureCatalog;
  base: URL;
  authOrigin: string;
}
export function parseCatalog(value: unknown): FeatureCatalog {
  const raw = object(value);
  if (
    raw['schemaVersion'] !== 1 ||
    !Array.isArray(raw['features']) ||
    raw['features'].length > 1000 ||
    Object.keys(raw).sort().join(',') !== 'features,schemaVersion'
  )
    throw new Error('Invalid feature catalog. Expected schemaVersion 1 and a features array.');
  const seen = new Set<string>();
  const features = raw['features'].map((value: unknown): FeatureRelease => {
    const item = object(value);
    if (Object.keys(item).sort().join(',') !== 'archive,coreVersion,id,name,sha256,version')
      throw new Error('Invalid feature catalog release fields.');
    featureId(item['id']);
    if (
      typeof item['name'] !== 'string' ||
      !item['name'].trim() ||
      item['name'].length > 80 ||
      [...item['name']].some((char) => char.charCodeAt(0) < 32)
    )
      throw new Error('Invalid feature catalog name.');
    for (const field of ['version', 'coreVersion']) {
      if (typeof item[field] !== 'string' || !/^\d+\.\d+\.\d+$/.test(item[field]))
        throw new Error(`Invalid catalog ${field}.`);
    }
    if (
      typeof item['sha256'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item['sha256']) ||
      typeof item['archive'] !== 'string' ||
      !item['archive'] ||
      item['archive'].length > 8192
    )
      throw new Error('Catalog releases require an archive address and SHA-256 checksum.');
    const key = `${item['id']}@${item['version']}:${item['coreVersion']}`;
    if (seen.has(key)) throw new Error(`Duplicate feature release: ${key}`);
    seen.add(key);
    return item as unknown as FeatureRelease;
  });
  return { schemaVersion: 1, features };
}
export function parseFeatureName(input: string): { id: string; version?: string } {
  const [id, version, ...extra] = input.split('@');
  featureId(id);
  if (extra.length > 0 || (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)))
    throw new Error('Use a feature name or name@1.2.3 with an exact version.');
  return { id, ...(version === undefined ? {} : { version }) };
}
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(BigInt),
    right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if ((left[i] ?? 0n) < (right[i] ?? 0n)) return -1;
    if ((left[i] ?? 0n) > (right[i] ?? 0n)) return 1;
  }
  return 0;
}
export function compatibleReleases(catalog: FeatureCatalog, coreVersion: string): FeatureRelease[] {
  const ids = [
    ...new Set(
      catalog.features.filter((item) => item.coreVersion === coreVersion).map((item) => item.id),
    ),
  ].sort();
  return ids.map((id) => selectRelease(catalog, id, coreVersion));
}
export function selectRelease(
  catalog: FeatureCatalog,
  name: string,
  coreVersion: string,
): FeatureRelease {
  const requested = parseFeatureName(name);
  const releases = catalog.features.filter(
    (item) =>
      item.id === requested.id &&
      item.coreVersion === coreVersion &&
      (requested.version === undefined || item.version === requested.version),
  );
  releases.sort((a, b) => compareVersions(b.version, a.version));
  const selected = releases[0];
  if (selected === undefined && !catalog.features.some((item) => item.id === requested.id)) {
    const names = [...new Set(catalog.features.map((item) => item.id))].sort().slice(0, 8);
    throw new Error(
      `Unknown feature "${requested.id}". ${names.length ? `Available names: ${names.join(', ')}. ` : ''}Run pnpm features:available.`,
    );
  }
  if (selected === undefined)
    throw new Error(
      `No release of ${name} supports Core ${coreVersion}. Run pnpm features:available to list compatible packs.`,
    );
  return selected;
}
function downloadUrl(url: URL): void {
  const localHttp =
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.hash)
    throw new Error(
      'Feature downloads require HTTPS without URL credentials (HTTP is allowed on loopback for local development).',
    );
}
/** Read bounded responses with manual redirects. Bearer tokens stay on the configured catalog origin. */
export async function download(
  url: URL,
  limit: number,
  authOrigin: string,
  options: CatalogOptions,
): Promise<{ data: Buffer; url: URL }> {
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  const signal = AbortSignal.timeout(30_000);
  const token = options.token;
  if (
    token !== undefined &&
    [...token].some((char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126)
  )
    throw new Error('Invalid BSLT_FEATURE_TOKEN format.');
  for (let redirects = 0; redirects <= 5; redirects++) {
    downloadUrl(url);
    const response = await fetcher(url, {
      redirect: 'manual',
      credentials: 'omit',
      signal,
      headers: token && url.origin === authOrigin ? { authorization: `Bearer ${token}` } : {},
    }).catch(() => {
      throw new Error('Feature download failed or timed out.');
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 5)
        throw new Error('Invalid or excessive feature download redirects.');
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new Error('Invalid feature redirect address.');
      }
      if (url.protocol === 'https:' && next.protocol !== 'https:')
        throw new Error('Insecure feature download redirect.');
      url = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403)
        throw new Error(
          'Feature access denied. Set BSLT_FEATURE_TOKEN to a download token issued by your distributor.',
        );
      throw new Error(`Feature download returned HTTP ${response.status}.`);
    }
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new Error('Feature download exceeds the size limit.');
    }
    if (response.body === null) throw new Error('Empty feature download response.');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read().catch(() => {
          throw new Error('Feature download was interrupted or timed out.');
        });
        if (result.done) break;
        size += result.value.byteLength;
        if (size > limit) throw new Error('Feature download exceeds the size limit.');
        chunks.push(Buffer.from(result.value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return { data: Buffer.concat(chunks), url };
  }
  throw new Error('Too many feature download redirects.');
}
export function localBytes(file: string, limit: number): Buffer {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > limit)
    throw new Error('Expected a regular feature file within the size limit.');
  const bytes = readFileSync(file);
  if (bytes.length > limit) throw new Error('Feature file exceeds the size limit.');
  return bytes;
}
export async function loadCatalog(
  root: string,
  options: CatalogOptions = {},
): Promise<LoadedCatalog> {
  const source = options.catalog ?? savedCatalog(root) ?? CATALOG_FILE;
  options.onProgress?.('Reading the feature catalog…');
  let data: Buffer,
    base: URL,
    authOrigin = '';
  if (/^https?:\/\//i.test(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error('Invalid feature catalog URL.');
    }
    authOrigin = url.origin;
    const result = await download(url, CATALOG_LIMIT, authOrigin, options);
    data = result.data;
    base = result.url;
  } else {
    if (/^[a-z]+:\/\//i.test(source))
      throw new Error('Use a local catalog path or an HTTPS catalog URL.');
    const file = path.resolve(root, source);
    try {
      data = localBytes(file, CATALOG_LIMIT);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(
          'No feature catalog found. Run pnpm features:setup <catalog-path-or-url>, place features.catalog.json in Core, or set BSLT_FEATURE_CATALOG.',
        );
      throw error;
    }
    base = pathToFileURL(file);
  }
  let value: unknown;
  try {
    value = JSON.parse(data.toString('utf8'));
  } catch {
    throw new Error('Feature catalog must be valid JSON.');
  }
  return { catalog: parseCatalog(value), base, authOrigin };
}
export async function releaseBytes(
  release: FeatureRelease,
  loaded: LoadedCatalog,
  options: CatalogOptions,
): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(release.archive, loaded.base);
  } catch {
    throw new Error('Invalid feature archive address.');
  }
  if (url.protocol === 'file:') {
    if (loaded.base.protocol !== 'file:')
      throw new Error('Remote feature catalogs cannot read local files.');
    return localBytes(fileURLToPath(url), ARCHIVE_LIMIT);
  }
  if (loaded.base.protocol === 'https:' && url.protocol !== 'https:')
    throw new Error('An HTTPS catalog must use HTTPS archives.');
  return (await download(url, ARCHIVE_LIMIT, loaded.authOrigin, options)).data;
}
