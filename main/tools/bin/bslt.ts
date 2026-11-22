#!/usr/bin/env -S node --conditions=source --import tsx
// main/tools/bin/bslt.ts
/**
 * `bslt`: the repository CLI (`@bslt/tools` bin). Commands live in `cli/main.ts`.
 *
 * It exits with the command's code once the command returns, so an open
 * database pool or a stray timer cannot hang it; dev servers and watchers
 * return `KEEP_RUNNING` and stay up.
 */
import { main } from '../cli/main';
import { KEEP_RUNNING } from '../cli/scripts';

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== KEEP_RUNNING) process.exit(code);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  },
);
