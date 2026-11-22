// main/tools/scripts/audit/compose-database-roles.test.ts
/**
 * The database role split, as the compose files deliver it.
 *
 * Row-level security binds only a role that is neither a superuser nor a table
 * owner, so the split is worth nothing if the long-running API container can
 * still read the superuser password or the owner URL from its environment.
 * `env_file` passes a whole env file into a container, so "the compose file
 * does not mention it" is not the same as "the container does not have it":
 * these tests render each file the way an operator runs it and read the
 * resulting environment.
 *
 * What is pinned, per stack:
 *
 *   - production (the app server): the API gets the two runtime role URLs and
 *     no credential that bypasses RLS; the superuser and owner credentials
 *     reach only the two one-shot jobs, which a plain `up` never starts. The
 *     file runs no database: PgBouncer, the listener and both jobs reach the
 *     separate database server named by POSTGRES_HOST.
 *   - database server (`docker-compose.db.yml`): the pinned Postgres image on
 *     a named volume, listening on one address and admitting one client range.
 *   - demo: the same, with the env file its own generator writes, which loads
 *     through the runtime config under the production database rules; plus
 *     the droplet's sizing and its caddy service, the edge of a shared host.
 *   - development: the file renders on a fresh clone (no ignored env file) and
 *     runs the API in development mode, where the single role is allowed.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { load } from '@bslt/server-system/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The image's migrate entry: `migrateDatabase` of @bslt/db as a process. */
const MIGRATE_ENTRY = ['node', 'node_modules/@bslt/db/dist/migrate/entry.js'];

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

const SUPERUSER_PASSWORD = 'fixture-superuser-password';
const OWNER_PASSWORD = 'fixture-owner-password';
const APP_URL = 'postgresql://bslt_app:fixture-app-password@pgbouncer:5432/app_prod';
const WORKER_URL = 'postgresql://bslt_worker:fixture-worker-password@pgbouncer:5432/app_prod';
/** The separate database server, as the app server reaches it. */
const DB_HOST = 'db.internal.test';
const LISTEN_URL = `postgresql://bslt_worker:fixture-worker-password@${DB_HOST}:5432/app_prod`;
const OWNER_URL = `postgresql://bslt_owner:${OWNER_PASSWORD}@${DB_HOST}:5432/app_prod`;
const ADMIN_URL = `postgresql://postgres:${SUPERUSER_PASSWORD}@${DB_HOST}:5432/app_prod`;

interface RenderedService {
  readonly command?: readonly string[] | null;
  readonly configs?: readonly {
    readonly source: string;
    readonly target?: string;
  }[];
  readonly depends_on?: Readonly<Record<string, unknown>>;
  readonly environment?: Readonly<Record<string, string | null>>;
  readonly healthcheck?: { readonly test?: readonly string[] };
  readonly image?: string;
  readonly mem_limit?: string;
  readonly network_mode?: string;
  readonly ports?: readonly unknown[];
  readonly profiles?: readonly string[];
  readonly restart?: string;
  readonly volumes?: readonly {
    readonly source?: string;
    readonly target?: string;
  }[];
}

interface RenderedCompose {
  readonly configs?: Readonly<Record<string, { readonly content?: string }>>;
  readonly services: Readonly<Record<string, RenderedService>>;
  readonly volumes?: Readonly<Record<string, { readonly name?: string }>>;
}

const dockerAvailable = ((): boolean => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * `docker compose config` with nothing inherited from the caller's shell: a
 * developer's exported DATABASE_URL must not decide what these tests see.
 */
function render(args: readonly string[], env: Record<string, string> = {}): RenderedCompose {
  const out = execFileSync('docker', ['compose', ...args, 'config', '--format', 'json'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? os.tmpdir(),
      ...env,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out) as RenderedCompose;
}

function service(rendered: RenderedCompose, name: string): RenderedService {
  const found = rendered.services[name];
  if (found === undefined) throw new Error(`service "${name}" is not in the rendered file`);
  return found;
}

function environmentOf(rendered: RenderedCompose, name: string): Record<string, string> {
  const entries = Object.entries(service(rendered, name).environment ?? {});
  return Object.fromEntries(entries.map(([key, value]) => [key, value ?? '']));
}

/** Names of the services whose environment carries `secret` anywhere in a value. */
function holders(rendered: RenderedCompose, secret: string): string[] {
  return Object.keys(rendered.services)
    .filter((name) => Object.values(environmentOf(rendered, name)).some((v) => v.includes(secret)))
    .toSorted();
}

describe.runIf(dockerAvailable)('production compose: database role split', () => {
  let fixtureRoot: string | undefined;
  let args: string[] = [];

  beforeAll(() => {
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'bslt-compose-roles-'));
    const composeFile = path.join(fixtureRoot, 'infra/docker/production/docker-compose.prod.yml');
    const envFile = path.join(fixtureRoot, 'config/env/.env.production');
    mkdirSync(path.dirname(composeFile), { recursive: true });
    mkdirSync(path.dirname(envFile), { recursive: true });
    copyFileSync(
      path.join(REPO_ROOT, 'infra/docker/production/docker-compose.prod.yml'),
      composeFile,
    );
    // What an operator's .env.production holds on the documented manual path:
    // every credential, because the one-shot jobs and PgBouncer need them.
    writeFileSync(
      envFile,
      [
        'DOMAIN=app.example.test',
        `POSTGRES_HOST=${DB_HOST}`,
        'POSTGRES_PORT=5432',
        'POSTGRES_DB=app_prod',
        'POSTGRES_USER=postgres',
        `POSTGRES_PASSWORD=${SUPERUSER_PASSWORD}`,
        `DATABASE_URL=${APP_URL}`,
        `WORKER_DATABASE_URL=${WORKER_URL}`,
        `LISTEN_DATABASE_URL=${LISTEN_URL}`,
        `MIGRATION_DATABASE_URL=${OWNER_URL}`,
        `DATABASE_ADMIN_URL=${ADMIN_URL}`,
        'JWT_SECRET=fixtureJwtSigningKeyMinimum32Characters',
        'COOKIE_SECRET=fixtureCookieSigningKeyMinimum32Characters',
        'OAUTH_TOKEN_ENCRYPTION_KEY=fixtureOauthTokenEncryptionKey32Characters',
        'EMAIL_FROM_ADDRESS=no-reply@app.example.test',
        'SMTP_HOST=smtp.mail.app.example.test',
        '',
      ].join('\n'),
    );
    args = ['--env-file', envFile, '-f', composeFile];
  });

  afterAll(() => {
    if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('gives the running API its two role URLs and no credential that bypasses RLS', () => {
    const api = environmentOf(render(args), 'api');

    expect(api['DATABASE_URL']).toBe(APP_URL);
    expect(api['WORKER_DATABASE_URL']).toBe(WORKER_URL);
    // env_file passes .env.production through, so each of these has to be
    // blanked explicitly; leaving a key out of `environment:` is not enough.
    expect(api['POSTGRES_PASSWORD'] ?? '').toBe('');
    expect(api['POSTGRES_USER'] ?? '').toBe('');
    expect(api['MIGRATION_DATABASE_URL'] ?? '').toBe('');
    expect(api['DATABASE_ADMIN_URL'] ?? '').toBe('');
  });

  it('gives the API its pub/sub LISTEN URL, straight at the database server', () => {
    // PgBouncer's transaction pooling does not carry a LISTEN session.
    const api = environmentOf(render(args), 'api');

    expect(api['LISTEN_DATABASE_URL']).toBe(LISTEN_URL);
    expect(new URL(api['LISTEN_DATABASE_URL'] ?? '').host).toBe(`${DB_HOST}:5432`);
  });

  it('runs no database: nothing is named postgres and nothing keeps its data', () => {
    // The database lives on its own server (docker-compose.db.yml). A deploy
    // of this file can therefore never restart or replace it.
    const rendered = render(['--profile', 'ops', ...args]);

    expect(Object.keys(rendered.services)).not.toContain('postgres');
    expect(Object.keys(rendered.volumes ?? {}).filter((name) => /postgres/u.test(name))).toEqual(
      [],
    );
    for (const [name, definition] of Object.entries(rendered.services)) {
      expect(Object.keys(definition.depends_on ?? {}), name).not.toContain('postgres');
    }
  });

  it('points PgBouncer at the database server', () => {
    const pgbouncer = environmentOf(render(args), 'pgbouncer');

    expect(pgbouncer['POSTGRESQL_HOST']).toBe(DB_HOST);
    expect(pgbouncer['POSTGRESQL_PORT']).toBe('5432');
  });

  it('carries a database port other than 5432 to PgBouncer and the role bootstrap', () => {
    const rendered = render(['--profile', 'ops', ...args], {
      POSTGRES_PORT: '6543',
    });

    expect(environmentOf(rendered, 'pgbouncer')['POSTGRESQL_PORT']).toBe('6543');
    expect(environmentOf(rendered, 'bootstrap-roles')['POSTGRES_PORT']).toBe('6543');
    // PgBouncer's own listening port inside the stack does not move with it.
    expect(environmentOf(rendered, 'pgbouncer')['PGBOUNCER_PORT']).toBe('5432');
  });

  it('refuses to render without the database server address', () => {
    const envFile = path.join(fixtureRoot ?? '', 'config/env/.env.production');
    const withoutHost = readFileSync(envFile, 'utf8').replace(/^POSTGRES_HOST=.*\n/mu, '');
    const stripped = path.join(fixtureRoot ?? '', 'config/env/.env.no-host');
    writeFileSync(stripped, withoutHost);
    const composeFile = args[args.length - 1] ?? '';

    const result = spawnSync(
      'docker',
      ['compose', '--env-file', stripped, '-f', composeFile, 'config'],
      {
        env: { PATH: process.env['PATH'] ?? '', HOME: os.tmpdir() },
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('POSTGRES_HOST');
  });

  it('refuses to render the API without a LISTEN URL', () => {
    const envFile = path.join(fixtureRoot ?? '', 'config/env/.env.production');
    const withoutListen = readFileSync(envFile, 'utf8').replace(/^LISTEN_DATABASE_URL=.*\n/mu, '');
    const stripped = path.join(fixtureRoot ?? '', 'config/env/.env.no-listen');
    writeFileSync(stripped, withoutListen);
    const composeFile = args[args.length - 1] ?? '';

    const result = spawnSync(
      'docker',
      ['compose', '--env-file', stripped, '-f', composeFile, 'config'],
      {
        env: { PATH: process.env['PATH'] ?? '', HOME: os.tmpdir() },
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('LISTEN_DATABASE_URL');
  });

  it('keeps the superuser password away from every service that does not need it', () => {
    const rendered = render(['--profile', 'ops', ...args]);

    // pgbouncer is the known exception: it looks role passwords up as the
    // superuser (PGBOUNCER_AUTH_USER). A new holder must be a decision.
    expect(holders(rendered, SUPERUSER_PASSWORD)).toEqual(['bootstrap-roles', 'pgbouncer']);
    expect(holders(rendered, OWNER_PASSWORD)).toEqual(['bootstrap-roles', 'migrate']);
  });

  it('starts neither one-shot job on a plain `up`', () => {
    expect(Object.keys(render(args).services).toSorted()).toEqual([
      'api',
      'caddy',
      'pgbouncer',
      'redis',
      'web',
    ]);

    const withOps = render(['--profile', 'ops', ...args]);
    for (const name of ['bootstrap-roles', 'migrate']) {
      expect(service(withOps, name).profiles).toEqual(['ops']);
      // A one-shot that restarts would re-run against a live database forever.
      expect(service(withOps, name).restart).toBe('no');
    }
  });

  it('runs the role bootstrap as the superuser, straight at the database server', () => {
    const rendered = render(['--profile', 'ops', ...args]);
    const bootstrap = environmentOf(rendered, 'bootstrap-roles');

    expect(service(rendered, 'bootstrap-roles').command).toEqual([
      'node',
      'dist/src/bootstrap-roles.js',
    ]);
    // Not pgbouncer: role and ownership DDL must not go through the pooler.
    expect(bootstrap['POSTGRES_HOST']).toBe(DB_HOST);
    expect(bootstrap['POSTGRES_PORT']).toBe('5432');
    expect(bootstrap['POSTGRES_USER']).toBe('postgres');
    expect(bootstrap['POSTGRES_PASSWORD']).toBe(SUPERUSER_PASSWORD);
    // Each role's password is read out of the URL that role logs in with.
    expect(bootstrap['DATABASE_URL']).toBe(APP_URL);
    expect(bootstrap['WORKER_DATABASE_URL']).toBe(WORKER_URL);
    expect(bootstrap['MIGRATION_DATABASE_URL']).toBe(OWNER_URL);
  });

  it('runs migrations with the owner URL and nothing else', () => {
    const rendered = render(['--profile', 'ops', ...args]);

    // The runner of @bslt/db, on the baselines that package ships in the image.
    expect(service(rendered, 'migrate').command).toEqual(MIGRATE_ENTRY);
    expect(environmentOf(rendered, 'migrate')).toEqual({
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL: OWNER_URL,
    });
  });

  it('gives the API an HTTPS public origin when only DOMAIN is configured', () => {
    // Production config rejects the http://localhost defaults, and the deploy
    // workflow configures DOMAIN, not the two URLs.
    const api = environmentOf(render(args), 'api');

    expect(api['API_BASE_URL']).toBe('https://app.example.test');
    expect(api['APP_URL']).toBe('https://app.example.test');
  });

  it('lets an explicit public origin win over the DOMAIN default', () => {
    const api = environmentOf(
      render(args, {
        API_BASE_URL: 'https://api.example.test',
        APP_URL: 'https://example.test',
      }),
      'api',
    );

    expect(api['API_BASE_URL']).toBe('https://api.example.test');
    expect(api['APP_URL']).toBe('https://example.test');
  });

  it('sizes the PgBouncer pool for one full application pool per role', () => {
    // Session pooling: a client keeps its server connection, and the API opens
    // up to DB_MAX_CONNECTIONS (default 20) clients on each of its two roles.
    const pgbouncer = environmentOf(render(args), 'pgbouncer');

    expect(Number(pgbouncer['PGBOUNCER_DEFAULT_POOL_SIZE'])).toBeGreaterThanOrEqual(20);
  });
});

describe.runIf(dockerAvailable)('database server compose', () => {
  const COMPOSE_FILE = path.join(REPO_ROOT, 'infra/docker/production/docker-compose.db.yml');
  const PINNED_IMAGE = /^POSTGRES_IMAGE=(.+)$/mu.exec(
    readFileSync(path.join(REPO_ROOT, 'infra/versions.env'), 'utf8'),
  )?.[1];
  const ENV: Readonly<Record<string, string>> = {
    POSTGRES_DB: 'app_prod',
    POSTGRES_PASSWORD: SUPERUSER_PASSWORD,
    DB_LISTEN_ADDRESS: '10.20.0.5',
    APP_SERVER_CIDR: '10.20.0.4/32',
  };
  const args = ['-f', COMPOSE_FILE];

  /** The client authentication rules the file gives Postgres, one rule per entry. */
  function hbaRules(rendered: RenderedCompose): string[][] {
    const postgres = service(rendered, 'postgres');
    const mounted = (postgres.configs ?? []).find((config) =>
      config.target?.endsWith('pg_hba.conf'),
    );
    const content = rendered.configs?.[mounted?.source ?? '']?.content ?? '';
    return content
      .split('\n')
      .map((line) => line.replace(/#.*$/u, '').trim())
      .filter((line) => line !== '')
      .map((line) => line.split(/\s+/u));
  }

  it('runs the pinned Postgres image and nothing else', () => {
    const rendered = render(args, ENV);

    expect(PINNED_IMAGE).toBeDefined();
    expect(Object.keys(rendered.services)).toEqual(['postgres']);
    expect(service(rendered, 'postgres').image).toBe(PINNED_IMAGE);
    expect(service(rendered, 'postgres').restart).toBe('unless-stopped');
  });

  it('keeps the cluster on a named volume', () => {
    const rendered = render(args, ENV);
    const data = (service(rendered, 'postgres').volumes ?? []).find(
      (volume) => volume.target === '/var/lib/postgresql/data',
    );

    expect(data?.source).toBe('postgres_data');
    expect(rendered.volumes?.['postgres_data']?.name).toBe('abe-postgres-data');
    // A second database on the same host must not share it.
    const other = render(args, { ...ENV, RESOURCE_PREFIX: 'abe-staging' });
    expect(other.volumes?.['postgres_data']?.name).toBe('abe-staging-postgres-data');
  });

  it('listens on loopback and the one configured address, never on every interface', () => {
    const postgres = service(render(args, ENV), 'postgres');
    const command = postgres.command ?? [];
    const listen = command.find((argument) => argument.startsWith('listen_addresses='));

    // Host networking: the address Postgres binds is the server's own, with
    // no published port and no address translation in between.
    expect(postgres.network_mode).toBe('host');
    expect(postgres.ports ?? []).toEqual([]);
    expect(listen).toBe('listen_addresses=localhost,10.20.0.5');
    expect(command.join(' ')).not.toMatch(/listen_addresses=(?:\*|0\.0\.0\.0)/u);
  });

  it('admits the app server range by password and no other remote client', () => {
    const rendered = render(args, ENV);
    const command = service(rendered, 'postgres').command ?? [];
    const rules = hbaRules(rendered);
    const remote = rules.filter(
      ([type, , , address]) =>
        type !== 'local' && address !== '127.0.0.1/32' && address !== '::1/128',
    );

    expect(command).toContain('hba_file=/etc/postgresql/pg_hba.conf');
    expect(remote).toEqual([['host', 'app_prod', 'all', '10.20.0.4/32', 'scram-sha-256']]);
    // With host networking the loopback is the server's: no `trust` over TCP.
    for (const [type, , , , method] of rules) {
      if (type !== 'local') expect(method).toBe('scram-sha-256');
    }
  });

  it.each(['POSTGRES_PASSWORD', 'DB_LISTEN_ADDRESS', 'APP_SERVER_CIDR'])(
    'refuses to render without %s',
    (name) => {
      const env = Object.fromEntries(Object.entries(ENV).filter(([key]) => key !== name));

      const result = spawnSync('docker', ['compose', ...args, 'config'], {
        env: { PATH: process.env['PATH'] ?? '', HOME: os.tmpdir(), ...env },
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(name);
    },
  );

  it('reports health from inside the container', () => {
    const test = service(render(args, ENV), 'postgres').healthcheck?.test ?? [];

    expect(test.join(' ')).toContain('pg_isready');
  });

  it('moves the port Postgres listens on with POSTGRES_PORT', () => {
    const postgres = environmentOf(render(args, { ...ENV, POSTGRES_PORT: '6543' }), 'postgres');

    expect(postgres['PGPORT']).toBe('6543');
  });
});

describe('demo stack: generated env file', () => {
  const GENERATOR = path.join(REPO_ROOT, 'infra/docker/demo/generate-env.sh');
  const EXAMPLE = path.join(REPO_ROOT, 'config/env/.env.production.example');
  let workDir: string | undefined;

  function generate(out: string): Record<string, string> {
    const result = spawnSync('bash', [GENERATOR, EXAMPLE, out, 'https://demo.example.test'], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const env: Record<string, string> = {};
    for (const line of readFileSync(out, 'utf8').split('\n')) {
      const separator = line.indexOf('=');
      if (separator > 0) env[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return env;
  }

  function credentials(url: string | undefined): {
    user: string;
    password: string;
  } {
    const parsed = new URL(url ?? '');
    return { user: parsed.username, password: parsed.password };
  }

  beforeAll(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'bslt-demo-env-'));
  });

  afterAll(() => {
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
  });

  it('connects the app, the worker and the migrator as their own roles', () => {
    const out = path.join(workDir ?? '', 'fresh.env');
    const env = generate(out);

    const app = credentials(env['DATABASE_URL']);
    const worker = credentials(env['WORKER_DATABASE_URL']);
    const owner = credentials(env['MIGRATION_DATABASE_URL']);
    expect([app.user, worker.user, owner.user]).toEqual(['bslt_app', 'bslt_worker', 'bslt_owner']);
    // The pub/sub listener is the worker role, direct to postgres.
    expect(env['LISTEN_DATABASE_URL']).toBe(
      `postgresql://bslt_worker:${worker.password}@postgres:5432/bslt_demo`,
    );

    // Four separately generated secrets; no two may coincide.
    const secrets = [app.password, worker.password, owner.password, env['POSTGRES_PASSWORD']];
    expect(new Set(secrets).size).toBe(4);
    // Written into URLs unencoded, so nothing that needs percent-encoding.
    for (const secret of secrets) expect(secret).toMatch(/^[0-9a-f]{64}$/u);

    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it('keeps every database password across a redeploy', () => {
    const out = path.join(workDir ?? '', 'redeploy.env');
    const first = generate(out);
    const second = generate(out);

    for (const key of [
      'POSTGRES_PASSWORD',
      'DATABASE_URL',
      'WORKER_DATABASE_URL',
      'MIGRATION_DATABASE_URL',
    ]) {
      expect(first[key] ?? '').not.toBe('');
      expect(second[key]).toBe(first[key]);
    }
  });

  it('does not reuse the superuser password when upgrading a single-role env file', () => {
    // The env file this generator wrote before the role split.
    const out = path.join(workDir ?? '', 'upgrade.env');
    const oldSuperuserPassword = 'a'.repeat(64);
    writeFileSync(
      out,
      [
        `POSTGRES_PASSWORD=${oldSuperuserPassword}`,
        `DATABASE_URL=postgresql://postgres:${oldSuperuserPassword}@postgres:5432/bslt_demo`,
        '',
      ].join('\n'),
    );

    const env = generate(out);

    // The data volume was initialised with this password; it must survive.
    expect(env['POSTGRES_PASSWORD']).toBe(oldSuperuserPassword);
    const app = credentials(env['DATABASE_URL']);
    expect(app.user).toBe('bslt_app');
    expect(app.password).not.toBe(oldSuperuserPassword);
  });
});

describe.runIf(dockerAvailable)('demo stack: database role split', () => {
  let fixtureRoot: string | undefined;
  let args: string[] = [];
  let generated: Record<string, string> = {};

  beforeAll(() => {
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'bslt-demo-roles-'));
    const composeFile = path.join(fixtureRoot, 'docker-compose.demo.yml');
    copyFileSync(path.join(REPO_ROOT, 'infra/docker/demo/docker-compose.demo.yml'), composeFile);
    // The droplet's .env is whatever generate-env.sh writes, so render with that.
    const envFile = path.join(fixtureRoot, '.env');
    const result = spawnSync(
      'bash',
      [
        path.join(REPO_ROOT, 'infra/docker/demo/generate-env.sh'),
        path.join(REPO_ROOT, 'config/env/.env.production.example'),
        envFile,
        'https://demo.example.test',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const separator = line.indexOf('=');
      if (separator > 0) generated[line.slice(0, separator)] = line.slice(separator + 1);
    }
    // The project directory is the compose file's own, so its .env is read.
    args = ['-f', composeFile];
  });

  afterAll(() => {
    if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
    generated = {};
  });

  it('gives the running API its two role URLs and no credential that bypasses RLS', () => {
    const api = environmentOf(render(args), 'api');

    expect(new URL(api['DATABASE_URL'] ?? '').username).toBe('bslt_app');
    expect(new URL(api['WORKER_DATABASE_URL'] ?? '').username).toBe('bslt_worker');
    expect(api['POSTGRES_PASSWORD'] ?? '').toBe('');
    expect(api['POSTGRES_USER'] ?? '').toBe('');
    expect(api['MIGRATION_DATABASE_URL'] ?? '').toBe('');
    expect(api['DATABASE_ADMIN_URL'] ?? '').toBe('');
  });

  it('hands the superuser password to postgres and the role bootstrap only', () => {
    const rendered = render(['--profile', 'ops', ...args]);
    const superuserPassword = generated['POSTGRES_PASSWORD'] ?? '';
    const ownerPassword = new URL(generated['MIGRATION_DATABASE_URL'] ?? '').password;

    expect(superuserPassword).not.toBe('');
    expect(holders(rendered, superuserPassword)).toEqual(['bootstrap-roles', 'postgres']);
    expect(holders(rendered, ownerPassword)).toEqual(['bootstrap-roles', 'migrate']);
  });

  it('gives the API every key the runtime config requires, the production rules included', () => {
    const api = environmentOf(render(args), 'api');

    // As deployed: the demo runs the API in development mode, with console mail.
    expect(api['NODE_ENV']).toBe('development');
    expect(() => load(api)).not.toThrow();

    // Under the production rules, which require the role split
    // (validateDatabaseConfig: WORKER_DATABASE_URL, LISTEN_DATABASE_URL, both
    // the worker role). Only the mail transport the demo has no use for is added.
    const production = load({
      ...api,
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.mail.demo.example.test',
    });
    expect(production.database).toMatchObject({
      connectionString: generated['DATABASE_URL'],
      workerConnectionString: generated['WORKER_DATABASE_URL'],
      listenConnectionString: generated['LISTEN_DATABASE_URL'],
    });
  });

  it('starts neither one-shot job on a plain `up`', () => {
    expect(Object.keys(render(args).services).toSorted()).toEqual([
      'api',
      'caddy',
      'postgres',
      'web',
    ]);

    const withOps = render(['--profile', 'ops', ...args]);
    expect(service(withOps, 'bootstrap-roles').command).toEqual([
      'node',
      'dist/src/bootstrap-roles.js',
    ]);
    expect(service(withOps, 'migrate').command).toEqual(MIGRATE_ENTRY);
    for (const name of ['bootstrap-roles', 'migrate']) {
      expect(service(withOps, name).profiles).toEqual(['ops']);
      expect(service(withOps, name).restart).toBe('no');
    }
  });
});

/**
 * The demo shares a 2 GB droplet with other stacks, and its caddy container is
 * the edge of the whole host: it also serves the other projects' domains. So
 * the compose file carries the droplet's sizing, and its caddy service is the
 * droplet's exactly — any difference makes the next `docker compose up` on the
 * host recreate the edge, taking every site on it down for that moment.
 */
describe.runIf(dockerAvailable)('demo stack: the shared host', () => {
  const COMPOSE_FILE = path.join(REPO_ROOT, 'infra/docker/demo/docker-compose.demo.yml');

  /** The caddy service of /opt/bslt/demo/docker-compose.demo.yml on the droplet. */
  const DROPLET_CADDY = [
    '  caddy:',
    '    image: caddy:2-alpine',
    '    mem_limit: 256m',
    '    ports:',
    "      - '80:80'",
    "      - '443:443'",
    '    volumes:',
    '      - ./Caddyfile:/etc/caddy/Caddyfile:ro',
    '      - ./origin-cert.pem:/etc/caddy/origin-cert.pem:ro',
    '      - ./origin-key.pem:/etc/caddy/origin-key.pem:ro',
    '      - caddy_data:/data',
    '      - caddy_config:/config',
    '    depends_on: [api, web]',
    '    restart: unless-stopped',
    '    networks: [internal]',
    '',
  ].join('\n');

  let fixtureRoot: string | undefined;

  /** The demo file, or the demo file with `edit` applied, rendered in one directory. */
  function renderDemo(edit: (text: string) => string = (text) => text): RenderedCompose {
    const file = path.join(fixtureRoot ?? '', 'docker-compose.demo.yml');
    writeFileSync(file, edit(readFileSync(COMPOSE_FILE, 'utf8')));
    return render(['-f', file], {
      POSTGRES_PASSWORD: 'fixture-superuser-password',
    });
  }

  beforeAll(() => {
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'bslt-demo-host-'));
    // env_file of the api and the one-shot jobs; its content does not matter here.
    writeFileSync(path.join(fixtureRoot, '.env'), '');
  });

  afterAll(() => {
    if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("defines caddy exactly as the droplet's running edge", () => {
    const withDropletCaddy = renderDemo((text) => {
      const swapped = text.replace(/^ {2}caddy:\n(?:(?: {4}.*)?\n)*/mu, DROPLET_CADDY);
      expect(swapped.split('\n').filter((line) => line === '  caddy:')).toHaveLength(1);
      expect(swapped).toContain(DROPLET_CADDY);
      return swapped;
    });

    expect(service(renderDemo(), 'caddy')).toEqual(service(withDropletCaddy, 'caddy'));
  });

  it("carries the droplet's memory limits and Postgres sizing", () => {
    const rendered = renderDemo();
    const limits = Object.fromEntries(
      ['postgres', 'api', 'web', 'caddy'].map((name) => [name, service(rendered, name).mem_limit]),
    );

    expect(limits).toEqual({
      postgres: String(160 * 2 ** 20),
      api: String(256 * 2 ** 20),
      web: String(128 * 2 ** 20),
      caddy: String(256 * 2 ** 20),
    });
    expect(service(rendered, 'postgres').command).toEqual([
      'postgres',
      '-c',
      'shared_buffers=32MB',
      '-c',
      'work_mem=2MB',
      '-c',
      'maintenance_work_mem=16MB',
      '-c',
      'max_connections=30',
    ]);
    // A V8 heap below the container limit, so Node collects before the kernel kills it.
    expect(environmentOf(rendered, 'api')['NODE_OPTIONS']).toBe('--max-old-space-size=192');
    expect(environmentOf(rendered, 'web')['NODE_OPTIONS']).toBe('--max-old-space-size=96');
    expect(environmentOf(rendered, 'web')['PROCESS_ROLE']).toBe('web');
  });

  it("keeps the API's uploaded files on the host", () => {
    const uploads = (service(renderDemo(), 'api').volumes ?? []).find(
      (volume) => volume.target === '/app/uploads',
    );

    expect(uploads?.source).toBe(path.join(fixtureRoot ?? '', 'uploads'));
  });

  it('probes Postgres health over TCP rather than the initdb Unix socket', () => {
    // On an empty volume docker-entrypoint.sh starts a temporary Unix-socket-only
    // server (`listen_addresses=''`); a socket healthcheck marks postgres healthy
    // before TCP :5432 is open for bootstrap-roles, migrate and api.
    const test = service(renderDemo(), 'postgres').healthcheck?.test ?? [];

    expect(test.join(' ')).toContain('pg_isready -h 127.0.0.1');
  });
});

describe('demo stack: remote-deploy.sh order', () => {
  const script = readFileSync(path.join(REPO_ROOT, 'infra/docker/demo/remote-deploy.sh'), 'utf8');
  const lines = script.split('\n').map((line) => line.trim());

  it('bootstraps roles, then migrates, then recreates api and web', () => {
    const bootstrap = lines.indexOf('$COMPOSE run --rm bootstrap-roles');
    const migrate = lines.indexOf('$COMPOSE run --rm migrate');
    const start = lines.indexOf('$COMPOSE up -d --no-deps --force-recreate api web');

    expect(bootstrap).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(bootstrap);
    expect(start).toBeGreaterThan(migrate);
  });

  it('stops at the first failing step, before the API starts', () => {
    // Without errexit a failed bootstrap or migration would fall through to `up -d`.
    expect(lines).toContain('set -euo pipefail');
  });
});

describe.runIf(dockerAvailable)('development compose: full local stack', () => {
  let fixtureRoot: string | undefined;
  let composeFile = '';

  beforeAll(() => {
    // A fresh clone: config/env/.env.development is gitignored and absent.
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'bslt-compose-dev-'));
    composeFile = path.join(fixtureRoot, 'infra/docker/development/docker-compose.yml');
    mkdirSync(path.dirname(composeFile), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, 'infra/docker/development/docker-compose.yml'), composeFile);
  });

  afterAll(() => {
    if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('renders without the ignored env file and gives postgres usable credentials', () => {
    const postgres = environmentOf(render(['-f', composeFile]), 'postgres');

    expect(postgres['POSTGRES_DB']).not.toBe('');
    expect(postgres['POSTGRES_USER']).not.toBe('');
    expect(postgres['POSTGRES_PASSWORD']).not.toBe('');
  });

  it('runs the API in development mode, where the single role is allowed', () => {
    // This stack has one POSTGRES_* role. Production mode refuses to start on
    // it, so forcing NODE_ENV=production here can only produce a dead container.
    const api = environmentOf(render(['-f', composeFile]), 'api');

    expect(api['NODE_ENV']).toBe('development');
  });
});
