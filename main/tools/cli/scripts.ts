// main/tools/cli/scripts.ts
/**
 * `bslt` subcommands that run a repository script through its exported entry.
 *
 * Scripts have no main-module guard: nothing executes them by path, so a
 * script module only defines functions, and this table is the one place that
 * calls them. Modules load on demand, so `bslt gate` never imports the
 * database client, the dev server or the TypeScript compiler it does not need.
 */

export type Handler = (argv: readonly string[]) => Promise<number>;

/**
 * Exit code for commands that keep running after their entry returns (dev
 * servers, watchers): the `bslt` bin leaves the process alive for them, and
 * exits with the code every other command returns.
 */
export const KEEP_RUNNING = -1;

export interface Subcommand {
  readonly usage: string;
  readonly run: Handler;
}

/** Runs a promise-returning script; a rejection prints its message and exits 1. */
async function guarded(label: string, work: () => Promise<number>): Promise<number> {
  try {
    return await work();
  } catch (error) {
    // Message only: a database error can carry a connection string.
    console.error(`❌ ${label} failed:`, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** Runs a starter tool: an argument error prints the message and its usage. */
function withUsage(run: () => void, usage: () => string): number {
  try {
    run();
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error('');
    console.error(usage());
    return 1;
  }
}

export const DB_COMMANDS: Readonly<Record<string, Subcommand>> = {
  migrate: {
    usage: 'apply the pending migrations and required seeds (as the owner role)',
    run: () =>
      guarded('Migration', async () => {
        await (await import('../scripts/db/migrate')).migrate();
        return 0;
      }),
  },
  seed: {
    usage:
      'insert development test users [--demo for plans, workspace, flags, tasks] (refuses in production)',
    run: (argv) =>
      guarded('Seed', async () => {
        await (
          await import('../scripts/db/seed')
        ).seed({ closeConnection: true, demo: argv.includes('--demo') });
        return 0;
      }),
  },
  reset: {
    usage: 'drop every table and rebuild from the baselines, then seed [--force]',
    run: (argv) =>
      guarded('Reset', async () => {
        await (await import('../scripts/db/reset')).reset({ force: argv.includes('--force') });
        return 0;
      }),
  },
  bootstrap: {
    usage: 'seed a development database (pnpm db:bootstrap)',
    run: () =>
      guarded('Bootstrap', async () => {
        (await import('../scripts/dev/bootstrap')).bootstrap();
        return 0;
      }),
  },
  'bootstrap-admin': {
    usage: 'create the first admin user',
    run: () =>
      guarded('Bootstrap', async () => {
        const result = await (await import('../scripts/db/bootstrap-admin')).bootstrapAdmin();
        return result.created ? 0 : 1;
      }),
  },
  'bootstrap-roles': {
    usage: 'create the bslt_owner, bslt_app and bslt_worker roles',
    run: () =>
      guarded('Role bootstrap', async () => {
        await (await import('../scripts/db/bootstrap-roles')).bootstrapRoles();
        console.log('✅ Database roles bootstrapped.');
        return 0;
      }),
  },
  'backfill-totp': {
    usage: 'encrypt legacy plaintext TOTP secrets [--dry-run]',
    run: (argv) =>
      guarded('TOTP backfill', async () => {
        const { backfillTotpSecrets } = await import('../scripts/db/backfill-totp-secrets');
        await backfillTotpSecrets(argv.includes('--dry-run'));
        return 0;
      }),
  },
  catalog: {
    usage: 'compute the database catalog on a scratch database and write it; --check compares',
    run: async (argv) => (await import('../catalog/command')).catalogCommand(argv),
  },
  audit: {
    usage: 'audit the committed catalog; --db also compares the connected database',
    run: async (argv) => {
      const { run } = await import('../catalog/audit');
      const result = await run({ db: argv.includes('--db') });
      (result.ok ? console.log : console.error)(result.summary);
      for (const problem of result.problems ?? []) console.error(`  - ${problem}`);
      return result.ok ? 0 : 1;
    },
  },
};

export const SCRIPT_COMMANDS: Readonly<Record<string, Subcommand>> = {
  dev: {
    usage: 'start the dev servers and sync watchers [server|web] [--with-postgres]',
    run: async (argv) => {
      await (await import('../scripts/dev/main')).main(argv);
      return KEEP_RUNNING;
    },
  },
  setup: {
    usage: 'write the local env files (pnpm bootstrap)',
    run: async (argv) => {
      await (await import('../scripts/dev/setup')).main(argv);
      return 0;
    },
  },
  postgres: {
    usage: 'run the Docker Postgres sidecar in the foreground',
    run: async () => {
      (await import('../scripts/dev/postgres')).main();
      return KEEP_RUNNING;
    },
  },
  'maintain-caches': {
    usage: 'prune local caches when the toolchain changed (pre-push hook)',
    run: async () => {
      (await import('../scripts/dev/maintain-local-caches')).main();
      return 0;
    },
  },
  rename: {
    usage:
      'rename the app: bslt rename <app-name> [--slug] [--domain] [--scope] [--apply]; bslt rename scope <@scope> [--from] [--apply]',
    run: async (argv) => {
      if (argv[0] === 'scope') {
        const scope = await import('../scripts/starter/scope-rename');
        return withUsage(() => scope.runScopeRenameCli(argv.slice(1)), scope.usage);
      }
      const rename = await import('../scripts/starter/rename');
      return withUsage(() => rename.runStarterRenameCli(argv), rename.usage);
    },
  },
  'web-icons': {
    usage: 'generate the web app icons',
    run: async () => {
      (await import('../scripts/build/generate-web-icons')).run();
      return 0;
    },
  },
  'workflow-dump': {
    usage: 'save a GitHub Actions run and its logs for review',
    run: async (argv) => {
      (await import('../scripts/dev/workflow-dump')).main(argv);
      return 0;
    },
  },
  'run-tests': {
    usage: 'run every package test suite with a summary [--verbose]',
    run: async (argv) => {
      (await import('../scripts/dev/run-tests')).main(argv);
      return 0;
    },
  },
  doctor: {
    usage:
      'verify Node version, config, migration checksums, secrets, OAuth, and Postgres [--json]',
    run: async (argv) => (await import('../scripts/dev/doctor')).runDoctorCli(argv),
  },
  export: {
    usage:
      'bslt export core [--out <dir>] [--verify] | errors | logger | server-main | server-all | server-config | server-db | server-db-clean | server-engine | server-system | server-and-system-source',
    run: async (argv) => {
      if (argv[0] === 'core') {
        return guarded('Export core', async () =>
          (await import('../scripts/export/core')).runExportCoreCli(argv.slice(1)),
        );
      }
      const exporters: Readonly<Record<string, () => Promise<unknown>>> = {
        errors: async () => (await import('../scripts/export/errors')).exportErrors(),
        logger: async () => (await import('../scripts/export/logger')).exportLogger(),
        'server-main': async () =>
          (await import('../scripts/export/server-main')).exportServerMain(),
        'server-all': async () => (await import('../scripts/export/server/server-all')).run(),
        'server-config': async () =>
          (await import('../scripts/export/server/server-config')).exportServerConfig(),
        'server-db': async () => (await import('../scripts/export/server/server-db')).run(),
        'server-db-clean': async () =>
          (await import('../scripts/export/server/server-db-clean')).run(),
        'server-engine': async () => (await import('../scripts/export/server/server-engine')).run(),
        'server-system': async () => (await import('../scripts/export/server/server-system')).run(),
        'server-and-system-source': async () =>
          (await import('../scripts/export/server/server-and-system-source')).run(),
      };
      const exporter = argv[0] === undefined ? undefined : exporters[argv[0]];
      if (exporter === undefined) {
        console.error(`bslt export: one of ${Object.keys(exporters).join(', ')}`);
        return 1;
      }
      return guarded('Export', async () => {
        await exporter();
        return 0;
      });
    },
  },
};
