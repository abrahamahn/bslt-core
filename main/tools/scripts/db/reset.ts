// main/tools/scripts/db/reset.ts
/**
 * `pnpm bslt db reset [--force]`: drop every table and build the database
 * again from the baselines, then insert the development users.
 *
 * This is what the runner asks for when a baseline was edited after it was
 * applied (`run: pnpm bslt db reset`): until foundation-v1 the baselines are
 * edited in place and a database is rebuilt, not repaired.
 *
 * DEVELOPMENT ONLY: every row is lost. `resetDatabase` refuses to run with
 * NODE_ENV=production.
 */

import { createInterface } from 'node:readline';

import { resetDatabase } from '@bslt/db';
import { initEnv } from '@bslt/server-system/config';

import { seed } from './seed';

/** Ask on the terminal; true only for `y`. */
async function confirmOnTerminal(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export interface ResetOptions {
  /** Skip the confirmation. */
  readonly force?: boolean;
  /** How to ask for confirmation. Default: the terminal. */
  readonly confirm?: (message: string) => Promise<boolean>;
}

/**
 * Reset the database: drop everything, migrate, seed the development users.
 *
 * @throws {Error} In production, and when the rebuild or the seed fails.
 */
export async function reset(options: ResetOptions = {}): Promise<void> {
  await initEnv();

  if (options.force !== true) {
    const confirm = options.confirm ?? confirmOnTerminal;
    if (!(await confirm('\nThis will DROP every table and all data of the database. Continue?'))) {
      console.log('Aborted.');
      return;
    }
  }

  await resetDatabase();
  await seed({ closeConnection: true });
  console.log('\nDatabase reset.');
}
