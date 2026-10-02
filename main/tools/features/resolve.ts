// main/tools/features/resolve.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readArchive } from './archive';
import { loadCatalog, releaseBytes, selectRelease, type CatalogOptions } from './catalog';
import { checkFeatures, coreVersion, installFeature } from './install';
import { sha256 } from './manifest';

export async function installNamedFeature(
  root: string,
  name: string,
  options: CatalogOptions = {},
  expectedHash?: string,
): Promise<Awaited<ReturnType<typeof installFeature>>> {
  checkFeatures(root);
  const loaded = await loadCatalog(root, options);
  const release = selectRelease(loaded.catalog, name, coreVersion(root));
  if (expectedHash !== undefined && expectedHash !== release.sha256)
    throw new Error('Requested checksum does not match the catalog release.');
  const bytes = await releaseBytes(release, loaded, options);
  if (sha256(bytes) !== release.sha256)
    throw new Error('Feature download SHA-256 does not match the catalog.');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'bslt-feature-download-'));
  try {
    const archive = path.join(directory, 'feature.tar.gz');
    writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 });
    const pack = await readArchive(archive, release.sha256);
    if (
      pack.manifest.id !== release.id ||
      pack.manifest.version !== release.version ||
      pack.manifest.coreVersion !== release.coreVersion
    )
      throw new Error('Downloaded feature identity/version does not match the catalog.');
    return await installFeature(root, archive, release.sha256);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
