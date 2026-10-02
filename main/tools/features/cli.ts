// main/tools/features/cli.ts
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import { loadCatalog, selectRelease, type CatalogOptions } from './catalog';
import { checkFeatures, coreVersion, installFeature, removeFeature } from './install';
import { installNamedFeature } from './resolve';

const USAGE =
  'Usage: pnpm features:add [name[@version] | archive.tar.gz] [--catalog <path-or-url>] [--sha256 <checksum>]';
function argumentsFor(
  args: string[],
  available: boolean,
): { source?: string; digest?: string; options: CatalogOptions } {
  const options: CatalogOptions = {};
  if (process.env['BSLT_FEATURE_CATALOG']) options.catalog = process.env['BSLT_FEATURE_CATALOG'];
  if (process.env['BSLT_FEATURE_TOKEN']) options.token = process.env['BSLT_FEATURE_TOKEN'];
  let source: string | undefined, digest: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--catalog' || (arg === '--sha256' && !available)) {
      const value = args[++i];
      if (seen.has(arg) || !value || value.startsWith('--')) throw new Error(USAGE);
      seen.add(arg);
      if (arg === '--catalog') options.catalog = value;
      else {
        if (!/^[a-f0-9]{64}$/.test(value))
          throw new Error('Expected a lowercase SHA-256 checksum.');
        digest = value;
      }
    } else if (available || arg.startsWith('--') || source !== undefined)
      throw new Error(
        available ? 'Usage: pnpm features:available [--catalog <path-or-url>]' : USAGE,
      );
    else source = arg;
  }
  return {
    ...(source === undefined ? {} : { source }),
    ...(digest === undefined ? {} : { digest }),
    options,
  };
}
export async function run(args: string[], root = process.cwd()): Promise<void> {
  const [command, ...rest] = args;
  if (command === 'list' || command === 'check') {
    if (rest.length !== 0) throw new Error(`Usage: pnpm features:${command}`);
    const state = checkFeatures(root);
    console.log(
      state.features.length === 0
        ? 'No feature packs installed.'
        : state.features.map((m) => `${m.id}@${m.version} — ${m.name}`).join('\n'),
    );
    return;
  }
  if (command === 'available') {
    const { options } = argumentsFor(rest, true);
    const version = coreVersion(root);
    const { catalog } = await loadCatalog(root, options);
    const ids = [
      ...new Set(
        catalog.features.filter((item) => item.coreVersion === version).map((item) => item.id),
      ),
    ].sort();
    console.log(
      ids.length === 0
        ? `No packs in this catalog support Core ${version}.`
        : ids
            .map((id) => {
              const release = selectRelease(catalog, id, version);
              return `${release.id}@${release.version} — ${release.name}`;
            })
            .join('\n'),
    );
    return;
  }
  if (command === 'remove') {
    if (rest.length !== 1 || rest[0] === undefined)
      throw new Error('Usage: pnpm features:remove <id>');
    await removeFeature(root, rest[0]);
    console.log(`Removed ${rest[0]}. Restart development servers, or rebuild before deploying.`);
    return;
  }
  if (command !== 'add')
    throw new Error(
      'Use features:add [name | archive.tar.gz], features:available, features:list, features:check, or features:remove <id>.',
    );
  const parsed = argumentsFor(rest, false);
  let source = parsed.source;
  if (source === undefined) {
    if (!process.stdin.isTTY)
      throw new Error(
        'Pass a feature name or archive path when running without an interactive terminal.',
      );
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      source = (await prompt.question('Feature name or path to downloaded .tar.gz: ')).trim();
    } finally {
      prompt.close();
    }
  }
  if (!source) throw new Error('A feature name or archive path is required.');
  const archive =
    source.includes('/') ||
    source.includes('\\') ||
    source.startsWith('.') ||
    /\.(tar\.gz|tgz)$/i.test(source);
  const state = archive
    ? await installFeature(root, path.resolve(root, source), parsed.digest)
    : await installNamedFeature(root, source, parsed.options, parsed.digest);
  console.log(
    `Installed features: ${state.features.map((m) => `${m.id}@${m.version}`).join(', ')}.\nRoutes and navigation are connected. Run pnpm type-check && pnpm build, then restart the app.`,
  );
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
