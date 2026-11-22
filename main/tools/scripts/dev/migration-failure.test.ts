// main/tools/scripts/dev/migration-failure.test.ts
import { describe, expect, it } from 'vitest';

import { migrationFailureLines } from './migration-failure';

describe('migrationFailureLines', () => {
  it('returns what the runner said, from the failure line on, without the noise before it', () => {
    const error = Object.assign(new Error('Command failed: pnpm db:migrate'), {
      stdout: Buffer.from('> bslt db migrate\n\nMigrating the database...\n'),
      stderr: Buffer.from(
        [
          ' WARN  Unsupported engine',
          '❌ Migration failed: This database cannot be migrated forward:',
          '  - billing/0001_billing.sql changed after it was applied',
          'run: pnpm bslt db reset',
          '',
        ].join('\n'),
      ),
    });

    expect(migrationFailureLines(error)).toEqual([
      '❌ Migration failed: This database cannot be migrated forward:',
      '  - billing/0001_billing.sql changed after it was applied',
      'run: pnpm bslt db reset',
    ]);
  });

  it('falls back to the last lines of the output when no failure line is there', () => {
    const error = Object.assign(new Error('Command failed'), {
      stdout: 'one\ntwo\n',
      stderr: 'three\nfour\nfive\nsix\nseven\n',
    });

    expect(migrationFailureLines(error, 3)).toEqual(['five', 'six', 'seven']);
  });

  it('returns the message of an error that carries no output', () => {
    expect(migrationFailureLines(new Error('spawn pnpm ENOENT'))).toEqual(['spawn pnpm ENOENT']);
    expect(migrationFailureLines('nope')).toEqual(['nope']);
  });
});
