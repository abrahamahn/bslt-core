// main/tools/features/cli.ts
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import { checkFeatures, installFeature, removeFeature } from './install';

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
  if (command === 'remove') {
    if (rest.length !== 1 || rest[0] === undefined)
      throw new Error('Usage: pnpm features:remove <id>');
    await removeFeature(root, rest[0]);
    console.log(`Removed ${rest[0]}. Restart development servers, or rebuild before deploying.`);
    return;
  }
  if (command !== 'add')
    throw new Error(
      'Use features:add [archive.tar.gz], features:list, features:check, or features:remove <id>.',
    );
  let archive = rest[0];
  let digest: string | undefined;
  if (rest.length > 1) {
    if (rest.length !== 3 || rest[1] !== '--sha256' || !/^[a-f0-9]{64}$/.test(rest[2] ?? ''))
      throw new Error(
        'Usage: pnpm features:add <archive.tar.gz> [--sha256 <trusted-download-checksum>]',
      );
    digest = rest[2];
  }
  if (archive === undefined) {
    if (!process.stdin.isTTY)
      throw new Error(
        'Pass the feature archive path when running without an interactive terminal.',
      );
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      archive = (await prompt.question('Path to your downloaded feature .tar.gz: ')).trim();
    } finally {
      prompt.close();
    }
  }
  if (!archive) throw new Error('An archive path is required.');
  const state = await installFeature(root, archive, digest);
  console.log(
    `Installed features: ${state.features.map((m) => m.id).join(', ')}.\nRoutes and navigation are connected. Run pnpm type-check && pnpm build, then restart the app.`,
  );
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
