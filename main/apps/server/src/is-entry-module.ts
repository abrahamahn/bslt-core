// main/apps/server/src/is-entry-module.ts
/**
 * Main-module guard for the container entry (`node dist/src/bootstrap-roles.js`),
 * which tests also import.
 *
 * Usage: `if (isEntryModule(import.meta.url)) { main(); }`
 *
 * Node sets `process.argv[1]` to the absolute form of the path it was given,
 * but loads the entry module from its real path, so a plain
 * `file://${argv[1]}` comparison misses symlinked entries and paths that need
 * percent-encoding. This compares URLs: first the entry path as given
 * (`--preserve-symlinks-main`), then its real path.
 *
 * `bootstrap-roles.js` runs as a dist entry point in the server image, which
 * ships without the repository tooling; the migrate entry of `@bslt/db`
 * (main/server/db/src/migrate/entry.ts) has the same guard. Repository scripts
 * run through `bslt`.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isEntryModule(
  moduleUrl: string,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (entryArg === undefined || entryArg === '') {
    return false;
  }
  if (moduleUrl === pathToFileURL(entryArg).href) {
    return true;
  }
  try {
    return moduleUrl === pathToFileURL(realpathSync(entryArg)).href;
  } catch {
    // The entry path does not exist (an eval, a REPL, a removed file): not this module.
    return false;
  }
}
