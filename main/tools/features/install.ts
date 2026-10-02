// main/tools/features/install.ts
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { readArchive, type FeatureArchive } from './archive';
import {
  destination,
  featureId,
  json,
  manifest,
  object,
  registries,
  sha256,
  sameFeature,
  STATE_PATH,
  type FeatureManifest,
} from './manifest';

export type State = { schemaVersion: 1; features: FeatureManifest[] };
const LOCK = '.bslt-feature-install';
/** Refuse symlinks at every existing parent, including dangling links and linked files. */
function safePath(root: string, relative: string): string {
  if (
    path.isAbsolute(relative) ||
    relative.split('/').some((part) => !part || part === '..' || part === '.') ||
    relative.includes('\\')
  )
    throw new Error(`Unsafe destination: ${relative}`);
  let current = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (
      stat.isSymbolicLink() ||
      (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() && !stat.isDirectory()) ||
      (stat.isFile() && stat.nlink !== 1)
    )
      throw new Error(`Linked or unsafe destination: ${relative}`);
  }
  return current;
}
function read(root: string, relative: string): Buffer | null {
  const file = safePath(root, relative);
  return existsSync(file) ? readFileSync(file) : null;
}
function workspace(root: string): { root: string; version: string } {
  root = realpathSync(root);
  const edition = object(JSON.parse(read(root, 'edition.json')?.toString('utf8') ?? '{}'));
  const pkg = object(JSON.parse(read(root, 'package.json')?.toString('utf8') ?? '{}'));
  if (
    edition['edition'] !== 'core' ||
    edition['version'] !== pkg['version'] ||
    typeof edition['version'] !== 'string'
  )
    throw new Error('Run feature installation from a current BSLT Core source distribution.');
  return { root, version: edition['version'] };
}
export function coreVersion(root: string): string {
  return workspace(root).version;
}
function readState(root: string): State {
  const state = object(JSON.parse(read(root, STATE_PATH)?.toString('utf8') ?? '{}'));
  if (state['schemaVersion'] !== 1 || !Array.isArray(state['features']))
    throw new Error('Missing/invalid features.lock.json. Update Core first.');
  const features = state['features'].map(manifest);
  if (new Set(features.map((m) => m.id)).size !== features.length)
    throw new Error('Duplicate installed feature.');
  return { schemaVersion: 1, features };
}
function filesIn(root: string, relative: string): string[] {
  const full = safePath(root, relative);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = `${relative}/${entry.name}`;
    safePath(root, child);
    return entry.isDirectory() ? filesIn(root, child) : [child];
  });
}
function checkState(root: string, state: State, version: string | undefined): void {
  for (const m of state.features) {
    const owned = new Set(Object.keys(m.files).map((file) => destination(m.id, file)));
    for (const side of ['web', 'server']) {
      for (const file of filesIn(root, `main/apps/${side}/src/extensions/packs/${m.id}`)) {
        if (!owned.has(file))
          throw new Error(
            `Unmanaged file inside feature: ${file}. Move custom code outside the pack before changing it.`,
          );
      }
    }
    if (version !== undefined && m.coreVersion !== version)
      throw new Error(
        `Feature ${m.id} requires Core ${m.coreVersion}; installed Core is ${version}.`,
      );
    for (const [source, hash] of Object.entries(m.files)) {
      const data = read(root, destination(m.id, source));
      if (data === null || sha256(data) !== hash)
        throw new Error(
          `Locally changed/missing feature file: ${destination(m.id, source)}. Back up and reconcile edits first.`,
        );
    }
  }
  for (const [relative, expected] of Object.entries(registries(state.features))) {
    if (read(root, relative)?.toString('utf8') !== expected)
      throw new Error(
        `Changed extension registry: ${relative}. Reconcile local edits before installing features.`,
      );
  }
}
/** Read installed versions even when a Core update has made them incompatible. */
export function listFeatures(directory: string): State {
  return readState(workspace(directory).root);
}
function checkLock(root: string): void {
  if (existsSync(safePath(root, LOCK)))
    throw new Error(
      `Another install is running or was interrupted. Inspect ${LOCK}/backup.json before continuing.`,
    );
}
export function checkFeatures(directory: string, requireCompatible = true): State {
  const { root, version } = workspace(directory);
  checkLock(root);
  const state = readState(root);
  checkState(root, state, requireCompatible ? version : undefined);
  return state;
}
/** Preflight every destination, keep an on-disk undo journal, and roll back ordinary I/O failures. */
function transaction(root: string, changes: Map<string, Buffer | null>): void {
  const before = new Map<string, Buffer | null>();
  for (const file of changes.keys()) before.set(file, read(root, file));
  const lock = safePath(root, LOCK);
  writeFileSync(
    path.join(lock, 'backup.json'),
    json(
      Object.fromEntries(
        [...before].map(([file, data]) => [file, data?.toString('base64') ?? null]),
      ),
    ),
    { flag: 'wx', mode: 0o600 },
  );
  const applied: string[] = [];
  const write = (file: string, data: Buffer | null): void => {
    const full = safePath(root, file);
    if (data === null) {
      rmSync(full, { force: true });
      return;
    }
    mkdirSync(path.dirname(full), { recursive: true });
    const temporary = path.join(lock, 'next');
    writeFileSync(temporary, data, { mode: 0o644 });
    renameSync(temporary, full);
  };
  try {
    for (const [file, data] of changes) {
      applied.push(file);
      write(file, data);
    }
  } catch (error) {
    for (const file of applied.reverse()) write(file, before.get(file) ?? null);
    rmSync(path.join(lock, 'backup.json'));
    throw error;
  }
  rmSync(path.join(lock, 'backup.json'));
}
async function modify(
  directory: string,
  action: (root: string, version: string, state: State) => Promise<State>,
  requireCompatible = true,
  dryRun = false,
): Promise<State> {
  const { root, version } = workspace(directory);
  checkLock(root);
  if (dryRun) {
    const state = readState(root);
    checkState(root, state, requireCompatible ? version : undefined);
    return action(root, version, state);
  }
  const lock = safePath(root, LOCK);
  mkdirSync(lock); // Exclusive writer lock; never remove a lock owned by another process.
  try {
    const state = readState(root);
    checkState(root, state, requireCompatible ? version : undefined);
    return await action(root, version, state);
  } finally {
    // A failed rollback or interrupted process leaves its undo journal in place.
    if (!existsSync(path.join(lock, 'backup.json'))) rmSync(lock, { recursive: true });
  }
}
export interface FeatureChangeOptions {
  update?: boolean;
  dryRun?: boolean;
}
/** Download/validation must finish before acquiring the writer lock or replacing the old release. */
export async function applyFeature(
  directory: string,
  pack: FeatureArchive,
  options: FeatureChangeOptions = {},
): Promise<State> {
  return modify(
    directory,
    async (root, version, state) => {
      const m = pack.manifest;
      if (m.coreVersion !== version)
        throw new Error(`Feature requires Core ${m.coreVersion}; installed Core is ${version}.`);
      const existing = state.features.find((f) => f.id === m.id);
      if (options.update && existing === undefined)
        throw new Error(`${m.id} is not installed. Run pnpm features:add ${m.id} first.`);
      if (existing !== undefined) {
        if (sameFeature(existing, m)) return state;
        if (!options.update)
          throw new Error(
            `${m.id}@${existing.version} is already installed. Use pnpm features:update ${m.id} to replace it safely.`,
          );
        if (existing.version === m.version && existing.coreVersion === m.coreVersion)
          throw new Error(
            'The installed release has different contents. Ask the distributor for a new version; existing releases cannot be replaced in place.',
          );
      } else {
        for (const side of ['web', 'server']) {
          if (filesIn(root, `main/apps/${side}/src/extensions/packs/${m.id}`).length > 0)
            throw new Error(`Refusing to overwrite an unmanaged feature directory: ${m.id}`);
        }
      }
      const owned = new Set(
        Object.keys(existing?.files ?? {}).map((source) => destination(m.id, source)),
      );
      const changes = new Map<string, Buffer | null>();
      for (const file of owned) changes.set(file, null);
      for (const [source, data] of pack.files) {
        const dest = destination(m.id, source);
        if (read(root, dest) !== null && !owned.has(dest))
          throw new Error(`Refusing to overwrite an unmanaged file: ${dest}`);
        changes.set(dest, data);
      }
      const next: State = {
        schemaVersion: 1,
        features: [...state.features.filter((item) => item.id !== m.id), m].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      };
      for (const [file, contents] of Object.entries(registries(next.features)))
        changes.set(file, Buffer.from(contents));
      changes.set(STATE_PATH, Buffer.from(json(next)));
      // Preview runs the same file checks and computes the same replacement without application writes.
      if (options.dryRun) {
        for (const file of changes.keys()) read(root, file);
      } else transaction(root, changes);
      return next;
    },
    !options.update,
    options.dryRun,
  );
}
export async function installFeature(
  directory: string,
  archive: string,
  expectedHash?: string,
  options: FeatureChangeOptions = {},
): Promise<State> {
  return applyFeature(directory, await readArchive(path.resolve(archive), expectedHash), options);
}
export async function removeFeature(directory: string, id: string): Promise<State> {
  featureId(id);
  return modify(
    directory,
    async (root, _version, state) => {
      const m = state.features.find((f) => f.id === id);
      if (m === undefined) throw new Error(`Feature is not installed: ${id}`);
      const changes = new Map<string, Buffer | null>();
      for (const source of Object.keys(m.files)) changes.set(destination(id, source), null);
      const next: State = { schemaVersion: 1, features: state.features.filter((f) => f.id !== id) };
      for (const [file, contents] of Object.entries(registries(next.features)))
        changes.set(file, Buffer.from(contents));
      changes.set(STATE_PATH, Buffer.from(json(next)));
      transaction(root, changes);
      return next;
    },
    false,
  );
}
