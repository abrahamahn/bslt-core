// main/tools/features/resolve.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readArchive } from './archive';
import {
  compareVersions,
  loadCatalog,
  parseFeatureName,
  releaseBytes,
  selectRelease,
  type CatalogOptions,
} from './catalog';
import {
  applyFeature,
  checkFeatures,
  coreVersion,
  type FeatureChangeOptions,
  type State,
} from './install';
import { sha256 } from './manifest';

export async function installNamedFeature(
  root: string,
  name: string,
  options: CatalogOptions = {},
  expectedHash?: string,
  change: FeatureChangeOptions = {},
): Promise<State> {
  const state = checkFeatures(root, !change.update);
  const requested = parseFeatureName(name);
  const installed = state.features.find((item) => item.id === requested.id);
  if (change.update && installed === undefined)
    throw new Error(
      `${requested.id} is not installed. Run pnpm features:add ${requested.id} first.`,
    );
  const loaded = await loadCatalog(root, options);
  const release = selectRelease(loaded.catalog, name, coreVersion(root));
  if (
    change.update &&
    requested.version === undefined &&
    installed !== undefined &&
    compareVersions(installed.version, release.version) > 0
  )
    throw new Error(
      `Installed ${installed.id}@${installed.version} is newer than this catalog. Use an exact version to request a downgrade.`,
    );
  options.onProgress?.(
    `Selected ${release.id}@${release.version} for Core ${release.coreVersion}.`,
  );
  if (expectedHash !== undefined && expectedHash !== release.sha256)
    throw new Error('Requested checksum does not match the catalog release.');
  options.onProgress?.('Reading and verifying the feature archive…');
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
    return await applyFeature(root, pack, change);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
