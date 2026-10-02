// main/tools/features/cli.ts
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import {
  compatibleReleases,
  loadCatalog,
  type CatalogOptions,
  type FeatureRelease,
} from './catalog';
import { catalogAddress, CONFIG_FILE, inputPath, saveCatalog } from './config';
import {
  checkFeatures,
  coreVersion,
  installFeature,
  listFeatures,
  removeFeature,
  type State,
} from './install';
import { destination, sameFeature, type FeatureManifest } from './manifest';
import { installNamedFeature } from './resolve';

const HELP = `BSLT Core features

  pnpm features                            Choose a feature interactively
  pnpm features:setup [catalog-path-or-url] Save a catalog for this checkout
  pnpm features:available [search]          Browse compatible features and installed versions
  pnpm features:add [name | archive]        Install a feature; no argument opens the picker
  pnpm features:update [name | archive]     Safely replace an installed feature
  pnpm features:list                       List installed versions, including incompatible packs
  pnpm features:check                      Check compatibility and installed file integrity
  pnpm features:remove <id>                 Remove an unmodified pack

Use name@1.2.3 to choose an exact release. Add --dry-run to add/update to preview changes.
Add/update accept --sha256 <checksum>. Add/update/available accept --catalog <path-or-url>.
Catalog priority: --catalog, BSLT_FEATURE_CATALOG, saved setup, features.catalog.json.
Set BSLT_FEATURE_TOKEN in your environment for private downloads; tokens are never saved.
After changes, run pnpm type-check && pnpm build, then restart the app.`;
export interface FeatureUI {
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  log: (message: string) => void;
}
async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  prompt.once('SIGINT', () => controller.abort());
  prompt.once('close', () => controller.abort());
  try {
    return await prompt
      .question(question, { signal: controller.signal })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return '';
        throw error;
      });
  } finally {
    prompt.close();
  }
}
function argumentsFor(
  args: string[],
  command: string,
): { source?: string; digest?: string; dryRun: boolean; options: CatalogOptions } {
  const options: CatalogOptions = {};
  if (process.env['BSLT_FEATURE_CATALOG']) options.catalog = process.env['BSLT_FEATURE_CATALOG'];
  if (process.env['BSLT_FEATURE_TOKEN']) options.token = process.env['BSLT_FEATURE_TOKEN'];
  let source: string | undefined,
    digest: string | undefined,
    dryRun = false;
  const seen = new Set<string>();
  const changes = command === 'add' || command === 'update';
  const usage = `Usage: pnpm features:${command}${changes ? ' [name | archive] [--dry-run] [--catalog <path-or-url>] [--sha256 <checksum>]' : command === 'setup' ? ' [catalog-path-or-url]' : ' [search] [--catalog <path-or-url>]'}`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--dry-run' && changes && !seen.has(arg)) {
      dryRun = true;
      seen.add(arg);
    } else if ((arg === '--catalog' && command !== 'setup') || (arg === '--sha256' && changes)) {
      const value = args[++i];
      if (seen.has(arg) || !value || value.startsWith('--')) throw new Error(usage);
      seen.add(arg);
      if (arg === '--catalog') options.catalog = inputPath(value);
      else {
        if (!/^[a-f0-9]{64}$/.test(value))
          throw new Error('Expected a lowercase SHA-256 checksum.');
        digest = value;
      }
    } else if (arg.startsWith('-') || source !== undefined) throw new Error(usage);
    else source = inputPath(arg);
  }
  return {
    ...(source === undefined ? {} : { source }),
    ...(digest === undefined ? {} : { digest }),
    dryRun,
    options,
  };
}
function releaseLabel(release: FeatureRelease, installed: FeatureManifest | undefined): string {
  const status =
    installed === undefined
      ? ''
      : installed.version === release.version && installed.coreVersion === release.coreVersion
        ? ' [installed]'
        : ` [installed ${installed.version} for Core ${installed.coreVersion}]`;
  return `${release.id}@${release.version} — ${release.name}${status}`;
}
async function choose(
  root: string,
  command: string,
  options: CatalogOptions,
  ui: FeatureUI,
): Promise<string> {
  if (!ui.interactive)
    throw new Error(
      `Pass a feature name or archive path: pnpm features:${command} <name-or-path>. Use --help for options.`,
    );
  let releases: FeatureRelease[] = [];
  const installed = listFeatures(root).features;
  try {
    const { catalog } = await loadCatalog(root, options);
    releases = compatibleReleases(catalog, coreVersion(root)).filter(
      (release) => command !== 'update' || installed.some((item) => item.id === release.id),
    );
    if (releases.length === 0)
      ui.log('No matching features in this catalog. You can enter a downloaded archive path.');
    releases.forEach((release, index) =>
      ui.log(
        `${index + 1}. ${releaseLabel(
          release,
          installed.find((item) => item.id === release.id),
        )}`,
      ),
    );
  } catch (error) {
    ui.log(error instanceof Error ? error.message : String(error));
    ui.log(
      'You can still install a downloaded archive. Configure named installs with pnpm features:setup.',
    );
  }
  for (;;) {
    const input = inputPath(
      await ui.ask('Choose a number, feature name, or archive path (Enter to cancel): '),
    );
    if (!/^\d+$/.test(input)) return input;
    const selected = releases[Number(input) - 1];
    if (selected !== undefined) return `${selected.id}@${selected.version}`;
    ui.log('Choose one of the listed numbers, enter a name/path, or press Enter to cancel.');
  }
}
function result(before: State, after: State, dryRun: boolean, ui: FeatureUI): void {
  const changed = after.features.filter((item) => {
    const previous = before.features.find((old) => old.id === item.id);
    return previous === undefined || !sameFeature(item, previous);
  });
  if (changed.length === 0) {
    ui.log('The requested release is already installed. No files changed.');
    return;
  }
  for (const item of changed) {
    const previous = before.features.find((old) => old.id === item.id);
    ui.log(
      `${dryRun ? 'Preview: ' : ''}${previous === undefined ? 'Install' : 'Update'} ${item.name}: ${previous === undefined ? '' : previous.version + ' → '}${item.version} (Core ${item.coreVersion}).`,
    );
    const files = new Set([...Object.keys(previous?.files ?? {}), ...Object.keys(item.files)]);
    const changes = [...files].sort().flatMap((file) => {
      if (previous?.files[file] === item.files[file]) return [];
      return [
        `${item.files[file] === undefined ? '-' : previous?.files[file] === undefined ? '+' : '~'} ${destination(item.id, file)}`,
      ];
    });
    ui.log(
      `${changes.length} source file change(s); feature registries and features.lock.json updated${dryRun ? ' on installation' : ''}.`,
    );
    if (dryRun) changes.forEach((line) => ui.log(line));
    if (item.files['web/index.tsx']) ui.log(`Page after signing in: /extensions/${item.id}`);
    if (item.files['server/index.ts']) ui.log(`Protected API: /api/extensions/${item.id}`);
  }
  ui.log(
    dryRun
      ? 'Preview complete. No application files changed. Run again without --dry-run to apply.'
      : 'Run pnpm type-check && pnpm build, then restart the app.',
  );
}
export async function run(
  args: string[],
  root = process.cwd(),
  ui: FeatureUI = {
    interactive: Boolean(process.stdin.isTTY),
    ask,
    log: (message) => console.log(message),
  },
): Promise<void> {
  const [requested = 'add', ...rest] = args;
  if (
    requested === 'help' ||
    requested === '--help' ||
    requested === '-h' ||
    rest.includes('--help') ||
    rest.includes('-h')
  ) {
    ui.log(HELP);
    return;
  }
  if (requested === 'list' || requested === 'check') {
    if (rest.length !== 0) throw new Error(`Usage: pnpm features:${requested}`);
    const state = requested === 'check' ? checkFeatures(root) : listFeatures(root);
    const version = coreVersion(root);
    ui.log(
      state.features.length === 0
        ? 'No feature packs installed. Run pnpm features:add to choose one.'
        : state.features
            .map(
              (m) =>
                `${m.id}@${m.version} — ${m.name}${m.coreVersion === version ? '' : ` [requires Core ${m.coreVersion}; current Core ${version}. Run pnpm features:update ${m.id}.]`}`,
            )
            .join('\n'),
    );
    if (requested === 'check')
      ui.log('Installed feature integrity and compatibility checks passed.');
    return;
  }
  if (requested === 'remove') {
    if (rest.length !== 1 || rest[0] === undefined)
      throw new Error('Usage: pnpm features:remove <id>');
    await removeFeature(root, rest[0]);
    ui.log(`Removed ${rest[0]}. Restart development servers, or rebuild before deploying.`);
    return;
  }
  if (!['setup', 'available', 'add', 'update'].includes(requested))
    throw new Error('Unknown feature command. Run pnpm features --help.');
  const parsed = argumentsFor(rest, requested);
  parsed.options.onProgress = ui.log;
  if (requested === 'setup') {
    coreVersion(root);
    let source = parsed.source;
    if (source === undefined) {
      if (!ui.interactive) throw new Error('Usage: pnpm features:setup <catalog-path-or-url>');
      source = inputPath(await ui.ask('Catalog file path or HTTPS URL (Enter to cancel): '));
    }
    if (!source) {
      ui.log('Setup cancelled. No files changed.');
      return;
    }
    const address = catalogAddress(root, source);
    const { catalog } = await loadCatalog(root, { ...parsed.options, catalog: address });
    saveCatalog(root, address);
    ui.log(
      `Catalog saved for this checkout in ${CONFIG_FILE}. ${compatibleReleases(catalog, coreVersion(root)).length} compatible feature(s). Run pnpm features to choose one.`,
    );
    if (process.env['BSLT_FEATURE_CATALOG'])
      ui.log(
        'BSLT_FEATURE_CATALOG is set and overrides saved setup. Unset it to use this catalog.',
      );
    return;
  }
  if (requested === 'available') {
    const version = coreVersion(root);
    const { catalog } = await loadCatalog(root, parsed.options);
    const installed = listFeatures(root).features;
    const search = parsed.source?.toLowerCase() ?? '';
    const releases = compatibleReleases(catalog, version).filter((item) =>
      `${item.id} ${item.name}`.toLowerCase().includes(search),
    );
    ui.log(
      releases.length === 0
        ? `No ${search ? 'matching ' : ''}packs in this catalog support Core ${version}.`
        : releases
            .map((release) =>
              releaseLabel(
                release,
                installed.find((item) => item.id === release.id),
              ),
            )
            .join('\n'),
    );
    return;
  }
  const source = parsed.source ?? (await choose(root, requested, parsed.options, ui));
  if (!source) {
    ui.log('Installation cancelled. No files changed.');
    return;
  }
  if (/\.zip$/i.test(source))
    throw new Error(
      'Unzip the download first, then select its .tar.gz feature pack. Keep features.catalog.json beside the archive.',
    );
  if (/\.json$/i.test(source))
    throw new Error(
      'That looks like a catalog file. Run pnpm features:setup <catalog-path>, then pnpm features to choose a pack.',
    );
  const before = listFeatures(root);
  const change = { update: requested === 'update', dryRun: parsed.dryRun };
  const archive =
    source.includes('/') ||
    source.includes('\\') ||
    source.startsWith('.') ||
    /\.(tar\.gz|tgz)$/i.test(source);
  if (archive) ui.log('Reading and verifying the feature archive…');
  const state = archive
    ? await installFeature(root, path.resolve(root, source), parsed.digest, change)
    : await installNamedFeature(root, source, parsed.options, parsed.digest, change);
  result(before, state, parsed.dryRun, ui);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(
      code === 'ENOENT'
        ? 'A required file was not found. Check the archive/catalog path and run from a BSLT Core checkout.'
        : error instanceof Error
          ? error.message
          : String(error),
    );
    process.exitCode = 1;
  });
}
