// main/tools/scripts/audit/deploy-workflow-database-roles.test.ts
/**
 * The remote script of the `app` job in `.github/workflows/deploy.yml`, run
 * for real, in both of its modes.
 *
 * That script is where the database role split is delivered to a server: it
 * writes the `.env`, rewrites the compose file, and decides the order in which
 * the role bootstrap, the migrations and the API start. It has no other test,
 * and it had these faults at once:
 *
 *   - the three role passwords were derived from the superuser password and
 *     lived only in the deploy SSH session, so the `.env` it left behind
 *     rendered `postgresql://bslt_app:@pgbouncer…` for anyone else;
 *   - the API container received the superuser password and the owner URL;
 *   - a failed role bootstrap or migration did not stop the API from starting;
 *   - the compose file was fetched at the literal ref `${DEPLOY_COMMIT_SHA}`.
 *
 * Since Phase 4 the app server runs no database: the script writes the address
 * of the separate database server into the `.env`, asks that server for its
 * version before it changes anything, and never takes the running stack down.
 *
 * Its second mode is the rollback. The workflow it replaces
 * (`deployment-rollback.yml`) could not work: it rewrote `image:` lines with a
 * pattern the deployed file never contained, so it restarted the same build
 * and reported success. Here a rollback runs on the files an actual deploy
 * left behind, and what it changed is read back.
 *
 * The script text is taken from the workflow, its `${{ }}` expressions are
 * replaced by fixture values, and it runs under `sh` against stub `docker` and
 * `curl` binaries. It is delivered the way the SSH action delivers it: one
 * quoted `export` line for each variable the step lists in `envs:`, then the
 * script, as a single command text for the server's shell. What it wrote is
 * then rendered by the real `docker compose` from a bare environment, and the
 * API environment that comes out is loaded through the production config
 * factory.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { load } from '../../../kernel/server/src/config/factory';
import { REPO_ROOT } from '../../lib/paths';
import {
  blockOf,
  expressionEnvOf,
  jobKey,
  jobOf,
  readWorkflow,
  stepOf,
  substituteExpressions,
} from '../../lib/workflow-file';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const API_IMAGE = `ghcr.io/acme/app:${COMMIT}-api`;
const WEB_IMAGE = `ghcr.io/acme/app:${COMMIT}-web`;
/** An earlier commit, whose images a rollback runs again. */
const OLD_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const OLD_API_IMAGE = `ghcr.io/acme/app:${OLD_COMMIT}-api`;
const OLD_WEB_IMAGE = `ghcr.io/acme/app:${OLD_COMMIT}-web`;
const DOMAIN = 'app.example.test';

/** One value per variable the step passes to the server; all distinct. */
const SECRETS: Readonly<Record<string, string>> = {
  REGISTRY_HOST: 'ghcr.io',
  REGISTRY_USER: 'deployer',
  REGISTRY_TOKEN: 'fixture-registry-token',
  REPO_TOKEN: 'fixture-repo-token',
  DB_SUPERUSER_PASSWORD: 'fixture-superuser-password',
  DB_OWNER_PASSWORD: 'fixture-owner-password',
  DB_APP_PASSWORD: 'fixture-app-password',
  DB_WORKER_PASSWORD: 'fixture-worker-password',
  DB_HOST: 'db.internal.test',
  DB_PORT: '5432',
  DB_NAME: 'abe_stack',
  JWT_SECRET: 'fixtureJwtSigningKeyMinimum32Characters',
  COOKIE_SECRET: 'fixtureCookieSigningKeyMinimum32Characters',
  OAUTH_TOKEN_ENCRYPTION_KEY: 'fixtureOauthTokenEncryptionKey32Characters',
  ACME_EMAIL: `admin@${DOMAIN}`,
  EMAIL_FROM_ADDRESS_INPUT: '',
  SMTP_HOST_INPUT: '',
  SMTP_USER: '',
  SMTP_PASS: '',
};

/** Shell and Compose syntax in one value, with nothing a `.env` line cannot carry. */
const AWKWARD = 'pa$$w0rd `id` "quoted" $(id) ${HOME} $HOME \\n#x y';

/** The free-text values of the `.env`: secrets and settings that are not validated as URL parts. */
const ENV_FILE_VALUES = [
  'DB_SUPERUSER_PASSWORD',
  'JWT_SECRET',
  'COOKIE_SECRET',
  'OAUTH_TOKEN_ENCRYPTION_KEY',
  'ACME_EMAIL',
  'EMAIL_FROM_ADDRESS_INPUT',
  'SMTP_HOST_INPUT',
  'SMTP_USER',
  'SMTP_PASS',
] as const;

/** The four database passwords: none may ever appear on a command line. */
const DATABASE_SECRETS = [
  'DB_SUPERUSER_PASSWORD',
  'DB_OWNER_PASSWORD',
  'DB_APP_PASSWORD',
  'DB_WORKER_PASSWORD',
] as const;

/** Every variable that carries a secret value to the server. */
const SECRET_NAMES = [
  ...DATABASE_SECRETS,
  'REGISTRY_TOKEN',
  'REPO_TOKEN',
  'JWT_SECRET',
  'COOKIE_SECRET',
  'OAUTH_TOKEN_ENCRYPTION_KEY',
] as const;

const DB_ADDRESS = `${SECRETS['DB_HOST'] ?? ''}:${SECRETS['DB_PORT'] ?? ''}`;

const VERSIONS = readFileSync(path.join(REPO_ROOT, 'infra/versions.env'), 'utf8');
const PINNED_MAJOR = /^POSTGRES_MAJOR=(\d+)$/mu.exec(VERSIONS)?.[1] ?? '';
const PINNED_IMAGE = /^POSTGRES_IMAGE=(.+)$/mu.exec(VERSIONS)?.[1] ?? '';
/** `SHOW server_version_num` on a server of the pinned major (minor 4). */
const PINNED_VERSION_NUM = `${PINNED_MAJOR}0004`;

/** What GitHub substitutes into the script text before the server sees it. */
const EXPRESSIONS: Readonly<Record<string, string>> = {
  'needs.plan.outputs.mode': 'deploy',
  'needs.plan.outputs.environment': 'production',
  'needs.plan.outputs.sha': COMMIT,
  'steps.target.outputs.domain': DOMAIN,
  "vars.APP_NAME || 'bslt'": 'bslt',
  'steps.images.outputs.api_image': API_IMAGE,
  'steps.images.outputs.web_image': WEB_IMAGE,
  'github.repository': 'acme/app',
};

/** The same step, as the workflow fills it in for a rollback to OLD_COMMIT. */
const ROLLBACK_EXPRESSIONS: Readonly<Record<string, string>> = {
  ...EXPRESSIONS,
  'needs.plan.outputs.mode': 'rollback',
  'needs.plan.outputs.sha': OLD_COMMIT,
  'steps.images.outputs.api_image': OLD_API_IMAGE,
  'steps.images.outputs.web_image': OLD_WEB_IMAGE,
};

const step = stepOf(jobOf(readWorkflow('deploy.yml'), 'app'), 'Deploy on the server');

/** The step's `script: |` block, de-indented, exactly as the workflow has it. */
const rawScript = blockOf(step, 'script');

/** Names the step forwards to the server (`with.envs`). */
const forwarded = (/^ {10}envs: (.+)$/mu.exec(step)?.[1] ?? '').split(',').filter(Boolean);

/** Names the step defines (`env:`), with the expression each is set from. */
const defined = expressionEnvOf(step);

/** The services of the production compose file that keep running (no `ops` profile). */
const LONG_RUNNING = ['api', 'caddy', 'pgbouncer', 'redis', 'web'] as const;

/** `docker compose ps`, one line per service, with every service healthy but those given. */
function psOutput(
  statuses: Readonly<Partial<Record<(typeof LONG_RUNNING)[number], string | undefined>>>,
): string {
  return LONG_RUNNING.flatMap((service) => {
    const status = service in statuses ? statuses[service] : 'Up 2 minutes (healthy)';
    return status === undefined ? [] : [`${service} ${status}`];
  }).join('\n');
}

/**
 * `docker`, as far as the script can tell. It logs every call, and it keeps
 * one piece of state: a full `compose up -d` records the images the compose
 * file names for api and web, and `inspect` reports those, the way a real
 * container reports the image it was created from. A script that failed to
 * change the compose file is therefore caught by its own image check.
 */
const DOCKER_STUB = [
  '#!/bin/sh',
  'printf "%s\\n" "$*" >> "$STUB_DOCKER_LOG"',
  'image_of() {',
  '  awk -v service="  $1:" \'$0 == service { found = 1; next } found && /^  [a-zA-Z0-9_-]+:$/ { exit } found && /^    image:/ { print $2; exit }\' docker-compose.prod.yml',
  '}',
  'case "$*" in',
  '  "compose "*" run --rm bootstrap-roles") exit "${STUB_BOOTSTRAP_EXIT:-0}" ;;',
  '  "compose "*" run --rm migrate") exit "${STUB_MIGRATE_EXIT:-0}" ;;',
  // psql in the pinned Postgres image, asking the database server its version.
  // Empty: the server did not answer (down, firewalled, wrong password).
  '  "run --rm "*" psql "*)',
  '    printf "%s\\n" "${PGPASSWORD:-}" > "$STUB_PSQL_PASSWORD"',
  '    [ -n "${STUB_SERVER_VERSION_NUM:-}" ] || exit 2',
  '    printf "%s\\n" "$STUB_SERVER_VERSION_NUM" ;;',
  '  "compose "*" up -d")',
  '    [ "${STUB_UP_EXIT:-0}" = "0" ] || exit "$STUB_UP_EXIT"',
  '    image_of api > "$STUB_STATE/running-api"',
  '    image_of web > "$STUB_STATE/running-web"',
  // Compose recreates a container when its image or its configuration
  // changed. The content of a bind-mounted file is neither, and a container
  // keeps the file it was created with when another is renamed over it: an
  // existing caddy container goes on seeing its old Caddyfile.
  '    [ -f "$STUB_STATE/caddy-sees" ] || cp Caddyfile "$STUB_STATE/caddy-sees" ;;',
  '  "compose "*" up -d --force-recreate --no-deps caddy")',
  '    [ "${STUB_RECREATE_EXIT:-0}" = "0" ] || exit "$STUB_RECREATE_EXIT"',
  '    cp Caddyfile "$STUB_STATE/caddy-sees" ;;',
  '  "compose "*" exec -T caddy cat /etc/caddy/Caddyfile") cat "$STUB_STATE/caddy-sees" ;;',
  '  "compose "*" ps -q api") echo cid-api ;;',
  '  "compose "*" ps -q web") echo cid-web ;;',
  // The long-running services of the compose file, and the `ps` line of one
  // of them: the first word of a line of STUB_PS_OUTPUT is the service. With
  // no STUB_PS_OUTPUT every service is up and healthy.
  '  "compose "*" config --services")',
  '    [ "${STUB_SERVICES_EXIT:-0}" = "0" ] || exit "$STUB_SERVICES_EXIT"',
  `    printf "%s\\n" ${LONG_RUNNING.join(' ')} ;;`,
  '  "compose "*" ps")',
  '    if [ -n "${STUB_PS_OUTPUT+set}" ]; then',
  '      printf "%s\\n" "$STUB_PS_OUTPUT"',
  '    else',
  `      printf "%s Up 5 seconds (healthy)\\n" ${LONG_RUNNING.join(' ')}`,
  '    fi ;;',
  '  "compose "*" ps "*)',
  '    for service in "$@"; do :; done',
  '    if [ -n "${STUB_PS_OUTPUT+set}" ]; then',
  '      printf "%s\\n" "$STUB_PS_OUTPUT" | grep "^$service "',
  '    else',
  '      echo "$service Up 5 seconds (healthy)"',
  '    fi ;;',
  '  "inspect "*cid-api) cat "$STUB_STATE/running-api" ;;',
  '  "inspect "*cid-web) cat "$STUB_STATE/running-web" ;;',
  '  "login "*) cat > "$STUB_STATE/login-stdin"; exit "${STUB_LOGIN_EXIT:-0}" ;;',
  // A commit whose images were never pushed.
  '  "pull "*) case "$*" in *"${STUB_MISSING_IMAGE:-no-such-image}"*) exit 1 ;; esac ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

// Serves the repository files the script fetches, from this checkout.
const CURL_STUB = [
  '#!/bin/sh',
  'out=""',
  'url=""',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    -o) out="$2"; shift ;;',
  '    http*) url="$1" ;;',
  '  esac',
  '  shift',
  'done',
  'printf "%s\\n" "$url" >> "$STUB_CURL_LOG"',
  'case "$url" in',
  '  *"/infra/docker/production/docker-compose.prod.yml?"*)',
  '    cp "$STUB_REPO/infra/docker/production/docker-compose.prod.yml" "$out" ;;',
  '  *"/infra/runtime/caddy/Caddyfile?"*)',
  '    cp "${STUB_CADDYFILE:-$STUB_REPO/infra/runtime/caddy/Caddyfile}" "$out" ;;',
  '  *"/infra/runtime/prometheus/alerts.yml?"*) cp "$STUB_REPO/infra/runtime/prometheus/alerts.yml" "$out" ;;',
  '  *"/infra/versions.env?"*) cp "$STUB_REPO/infra/versions.env" "$out" ;;',
  '  *) exit 22 ;;',
  'esac',
  '',
].join('\n');

interface DeployRun {
  readonly status: number | null;
  readonly output: string;
  readonly docker: readonly string[];
  readonly fetched: readonly string[];
  readonly deployDir: string;
}

const workDirs: string[] = [];

/** A stand-in for the deploy server: a home directory and stub binaries. */
function createServer(): string {
  const work = mkdtempSync(path.join(os.tmpdir(), 'bslt-deploy-workflow-'));
  workDirs.push(work);
  mkdirSync(path.join(work, 'bin'));
  mkdirSync(path.join(work, 'home'));
  mkdirSync(path.join(work, 'state'));
  for (const [name, content] of Object.entries({
    docker: DOCKER_STUB,
    curl: CURL_STUB,
    sleep: '#!/bin/sh\nexit 0\n',
  })) {
    writeFileSync(path.join(work, 'bin', name), content);
    chmodSync(path.join(work, 'bin', name), 0o755);
  }
  return work;
}

/** Runs the remote script on `server`, filled in with `expressions`. */
function runScript(
  expressions: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
  server: string,
): DeployRun {
  const home = path.join(server, 'home');
  const dockerLog = path.join(server, 'docker.log');
  const curlLog = path.join(server, 'curl.log');
  writeFileSync(dockerLog, '');
  writeFileSync(curlLog, '');

  // What the pinned SSH action sends (drone-ssh 1.7.3, plugin.go): one
  // `export NAME='value'` line per name in `envs:`, a single quote in a value
  // written as '\\'', then the script, joined into one command text that the
  // server's shell is started with. Only what the step forwards is there: a
  // variable the script needs but `envs:` does not list is unset on the server.
  const values: Record<string, string> = { ...SECRETS, ...overrides };
  const exports = forwarded.map(
    (name) => `export ${name}='${(values[name] ?? '').replaceAll("'", "'\\''")}'`,
  );
  const commandText = [...exports, substituteExpressions(rawScript, expressions).trim()].join('\n');
  const stubSettings = Object.fromEntries(
    Object.entries(overrides).filter(([name]) => !forwarded.includes(name)),
  );

  const result = spawnSync('sh', ['-c', commandText], {
    cwd: home,
    env: {
      PATH: `${path.join(server, 'bin')}:${process.env['PATH'] ?? ''}`,
      HOME: home,
      STUB_DOCKER_LOG: dockerLog,
      STUB_CURL_LOG: curlLog,
      STUB_REPO: REPO_ROOT,
      STUB_STATE: path.join(server, 'state'),
      STUB_PSQL_PASSWORD: path.join(server, 'psql-password'),
      STUB_SERVER_VERSION_NUM: PINNED_VERSION_NUM,
      ...stubSettings,
    },
    encoding: 'utf8',
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    docker: readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean),
    fetched: readFileSync(curlLog, 'utf8').split('\n').filter(Boolean),
    deployDir: path.join(home, 'deployments', 'bslt', 'production'),
  };
}

/** One deploy of COMMIT: run the remote script on `server` (a fresh one by default). */
function runDeploy(
  overrides: Readonly<Record<string, string>> = {},
  server: string = createServer(),
): DeployRun {
  return runScript(EXPRESSIONS, overrides, server);
}

/** One rollback to OLD_COMMIT on `server`. */
function runRollback(server: string, overrides: Readonly<Record<string, string>> = {}): DeployRun {
  return runScript(ROLLBACK_EXPRESSIONS, overrides, server);
}

const COMPOSE = 'compose --project-name bslt-production -f docker-compose.prod.yml';
const BOOTSTRAP = `${COMPOSE} run --rm bootstrap-roles`;
const MIGRATE = `${COMPOSE} run --rm migrate`;
const START_STACK = `${COMPOSE} up -d`;
const RECREATE_CADDY = `${COMPOSE} up -d --force-recreate --no-deps caddy`;

const dockerAvailable = ((): boolean => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

interface RenderedService {
  readonly build?: unknown;
  readonly env_file?: unknown;
  readonly environment?: Readonly<Record<string, string | null>>;
  readonly healthcheck?: unknown;
  readonly image?: string;
  readonly volumes?: readonly { type?: string; source?: string; target?: string }[];
}

/** Render what the deploy left on the server, from a shell that has none of its variables. */
function renderFromBareShell(deployDir: string): Readonly<Record<string, RenderedService>> {
  const out = execFileSync(
    'docker',
    [...COMPOSE.split(' '), '--profile', 'ops', 'config', '--format', 'json'],
    {
      cwd: deployDir,
      env: { PATH: process.env['PATH'] ?? '', HOME: os.tmpdir() },
      encoding: 'utf8',
    },
  );
  return (JSON.parse(out) as { services: Record<string, RenderedService> }).services;
}

function environmentOf(
  services: Readonly<Record<string, RenderedService>>,
  name: string,
): Record<string, string> {
  const entries = Object.entries(services[name]?.environment ?? {});
  return Object.fromEntries(entries.map(([key, value]) => [key, value ?? '']));
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('deploy workflow: database role secrets', () => {
  it('passes one independent secret per database role to the server', () => {
    for (const name of ['DB_OWNER_PASSWORD', 'DB_APP_PASSWORD', 'DB_WORKER_PASSWORD']) {
      expect(forwarded).toContain(name);
      // Its own repository secret, not an expression over the superuser's.
      expect(defined.get(name)).toBe(`\${{ secrets.${name} }}`);
    }
    expect(forwarded).toContain('DB_SUPERUSER_PASSWORD');
  });

  it('passes the database server address to the server as environment', () => {
    for (const name of ['DB_HOST', 'DB_PORT', 'DB_NAME']) expect(forwarded).toContain(name);
    expect(defined.get('DB_HOST')).toContain('DB_HOST');
  });

  it('stops before touching the server when no database server is configured', () => {
    const run = runDeploy({ DB_HOST: '' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('DB_HOST');
    expect(run.docker).toEqual([]);
    expect(run.fetched).toEqual([]);
    expect(existsSync(path.join(run.deployDir, '.env'))).toBe(false);
  });

  it.each([
    ['a host with a path', { DB_HOST: 'db.internal.test/x' }],
    ['a host with credentials', { DB_HOST: 'user@db.internal.test' }],
    ['a port that is not a number', { DB_PORT: '54a2' }],
    ['a database name that needs quoting', { DB_NAME: 'abe stack' }],
  ])('refuses %s, which would corrupt the role URLs', (_label, override) => {
    const run = runDeploy(override);

    expect(run.status).not.toBe(0);
    expect(run.docker).toEqual([]);
    expect(existsSync(path.join(run.deployDir, '.env'))).toBe(false);
  });

  it('defaults the port and the database name', () => {
    const run = runDeploy({ DB_PORT: '', DB_NAME: '' });

    expect(run.status, run.output).toBe(0);
    expect(readFileSync(path.join(run.deployDir, '.env'), 'utf8').split('\n')).toEqual(
      expect.arrayContaining(['POSTGRES_PORT=5432', 'POSTGRES_DB=abe_stack']),
    );
  });

  it('keeps every database password off the command line of everything it starts', () => {
    // No `docker` call gets a password as an argument: they go on as
    // environment, on standard input and in the mode-600 .env. (The command
    // text the SSH action starts the script with does hold them, in its
    // `export` lines; the workflow says so where it lists `envs:`.)
    const run = runDeploy();

    expect(run.status, run.output).toBe(0);
    for (const name of DATABASE_SECRETS) {
      const secret = SECRETS[name] ?? '';
      expect(run.docker.filter((command) => command.includes(secret))).toEqual([]);
    }
  });

  it('defines every variable it forwards', () => {
    expect(forwarded.length).toBeGreaterThan(0);
    for (const name of forwarded) expect(defined.has(name), name).toBe(true);
  });

  it('never puts a secret into the script text', () => {
    // A `${{ secrets.* }}` in the script body is pasted into shell source:
    // a `$`, a backquote or a quote in the value would be read as syntax.
    // Every secret is forwarded by name, and the SSH action quotes its value.
    expect(rawScript).not.toContain('secrets.');
    expect(rawScript).not.toMatch(/sha256sum|role_password/u);
    for (const name of SECRET_NAMES) expect(forwarded, name).toContain(name);
  });

  it('carries a value with a single quote through the quoting of the SSH action', () => {
    const token = "registry-token-with-'quotes'-$(id)-`id`";
    const server = createServer();

    const run = runDeploy({ REGISTRY_TOKEN: token }, server);

    expect(run.status, run.output).toBe(0);
    expect(readFileSync(path.join(server, 'state', 'login-stdin'), 'utf8')).toBe(`${token}\n`);
  });

  it('writes a secret with shell syntax in it into the .env as it is', () => {
    // In single quotes, which Compose reads literally: unquoted, it would
    // resolve the `$` references and cut the value at ` #`.
    const run = runDeploy({ SMTP_PASS: AWKWARD });

    expect(run.status, run.output).toBe(0);
    expect(readFileSync(path.join(run.deployDir, '.env'), 'utf8').split('\n')).toContain(
      `SMTP_PASS='${AWKWARD}'`,
    );
  });

  it.each(
    ENV_FILE_VALUES.flatMap((name) => [
      [name, 'a single quote', "it's-a-value-of-at-least-32-characters"],
      [name, 'a backslash at its end', 'a-value-of-at-least-32-characters-\\'],
      [name, 'a line break', 'a-value-of-at-least\n32-characters-long'],
      // The API's configuration loader trims a value and cuts it at ` #`.
      [name, 'white space followed by #', 'a-value-of-at-least #32-characters-long'],
      [name, 'white space at its start', ' a-value-of-at-least-32-characters-long'],
      [name, 'white space at its end', 'a-value-of-at-least-32-characters-long\t'],
    ]),
  )('stops before touching the server when %s holds %s', (name, _label, value) => {
    // A single-quoted .env value cannot carry its own end, and nothing else
    // may shorten a secret on its way into a container or into the API.
    const run = runDeploy({ [name]: value });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('would not reach the containers as configured');
    expect(run.docker).toEqual([]);
    expect(run.fetched).toEqual([]);
    expect(existsSync(path.join(run.deployDir, '.env'))).toBe(false);
  });

  it.each([
    'DB_SUPERUSER_PASSWORD',
    'DB_OWNER_PASSWORD',
    'DB_APP_PASSWORD',
    'DB_WORKER_PASSWORD',
    'JWT_SECRET',
    'COOKIE_SECRET',
    'OAUTH_TOKEN_ENCRYPTION_KEY',
  ])('stops before touching the server when %s is not configured', (name) => {
    const run = runDeploy({ [name]: '' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(name === 'DB_SUPERUSER_PASSWORD' ? 'DB_PASSWORD' : name);
    expect(run.docker).toEqual([]);
    expect(run.fetched).toEqual([]);
    expect(existsSync(path.join(run.deployDir, '.env'))).toBe(false);
  });

  it.each([
    ['a slash', 'pa/ssword'],
    ['an at sign', 'pass@word'],
    ['a colon', 'pass:word'],
    ['a space', 'pass word'],
  ])('refuses a role password with %s, which would corrupt its URL', (_label, password) => {
    const run = runDeploy({ DB_APP_PASSWORD: password });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('URL-safe');
    expect(run.docker).toEqual([]);
  });
});

describe('deploy workflow: order and failure', () => {
  it('fetches the stack files at the commit being deployed', () => {
    const run = runDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.fetched).toHaveLength(4);
    for (const url of run.fetched) expect(url.endsWith(`?ref=${COMMIT}`)).toBe(true);
    expect(existsSync(path.join(run.deployDir, 'prometheus/alerts.yml'))).toBe(true);
  });

  it('bootstraps roles, then migrates, then starts the stack', () => {
    const run = runDeploy();

    expect(run.status, run.output).toBe(0);
    const order = [BOOTSTRAP, MIGRATE, START_STACK].map((command) => run.docker.indexOf(command));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it('never takes the running stack down', () => {
    // `up -d` replaces the containers whose image or configuration changed.
    // The old API keeps serving until the role bootstrap and the migrations
    // have passed, and a failed deploy leaves it running.
    const run = runDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.docker.filter((command) => / (?:down|stop|rm)\b/u.test(command))).toEqual([]);
  });

  it('starts no database and names no postgres service', () => {
    const run = runDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.docker.filter((command) => /^compose .* postgres\b/u.test(command))).toEqual([]);
  });

  it('does not migrate or start the API when the role bootstrap fails', () => {
    const run = runDeploy({ STUB_BOOTSTRAP_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.docker).toContain(BOOTSTRAP);
    expect(run.docker).not.toContain(MIGRATE);
    expect(run.docker).not.toContain(START_STACK);
  });

  it('does not start the API when a migration fails', () => {
    const run = runDeploy({ STUB_MIGRATE_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.docker).toContain(MIGRATE);
    expect(run.docker).not.toContain(START_STACK);
  });

  it('never rebuilds a production database: a migrate job that asks for a reset is a failed deploy', () => {
    // Exit 3: the database was built from other baselines (the demo deploy
    // recreates its disposable database on it; production never does).
    const run = runDeploy({ STUB_MIGRATE_EXIT: '3' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('FATAL: database migration failed');
    expect(run.docker.filter((command) => command === MIGRATE)).toHaveLength(1);
    expect(run.docker).not.toContain(START_STACK);
    expect(run.docker.filter((command) => / (?:down|stop|rm)\b|^volume /u.test(command))).toEqual(
      [],
    );
  });

  it('asks the database server for its version, with psql from the pinned image', () => {
    const server = createServer();
    const run = runDeploy({}, server);

    expect(run.status, run.output).toBe(0);
    const asked = run.docker.filter((command) => command.includes(' psql '));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(` ${PINNED_IMAGE} psql `);
    expect(asked[0]).toContain(
      `--host ${SECRETS['DB_HOST'] ?? ''} --port ${SECRETS['DB_PORT'] ?? ''}`,
    );
    expect(asked[0]).toContain('SHOW server_version_num');
    // As the superuser, whose password reaches psql as environment.
    expect(readFileSync(path.join(server, 'psql-password'), 'utf8').trim()).toBe(
      SECRETS['DB_SUPERUSER_PASSWORD'],
    );
    // Before anything on the server changes.
    expect(run.docker.indexOf(asked[0] ?? '')).toBeLessThan(run.docker.indexOf(BOOTSTRAP));
    expect(run.docker.findIndex((command) => command.startsWith('pull '))).toBeGreaterThan(
      run.docker.indexOf(asked[0] ?? ''),
    );
  });

  it('stops before touching the running stack when the server runs another Postgres major', () => {
    // The images, the migrations and the backups are built for the pinned
    // major. 160015 is PostgreSQL 16.15.
    const run = runDeploy({ STUB_SERVER_VERSION_NUM: '160015' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('runs PostgreSQL 16');
    expect(run.output).toContain(`PostgreSQL ${PINNED_MAJOR}`);
    expect(run.docker.some((command) => / down\b| up -d\b|^pull /u.test(command))).toBe(false);
    expect(run.docker).not.toContain(BOOTSTRAP);
  });

  it('stops before touching the running stack when the database server does not answer', () => {
    const run = runDeploy({ STUB_SERVER_VERSION_NUM: '' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(`database server at ${DB_ADDRESS}`);
    expect(run.docker.some((command) => / down\b| up -d\b|^pull /u.test(command))).toBe(false);
    expect(run.docker).not.toContain(BOOTSTRAP);
  });

  it('stops when the server answers with something that is not a version', () => {
    const run = runDeploy({ STUB_SERVER_VERSION_NUM: 'psql: error' });

    expect(run.status).not.toBe(0);
    expect(run.docker).not.toContain(BOOTSTRAP);
  });

  it('deploys onto a server of the pinned Postgres major', () => {
    expect(PINNED_MAJOR).not.toBe('');

    const run = runDeploy({ STUB_SERVER_VERSION_NUM: `${PINNED_MAJOR}0011` });

    expect(run.status, run.output).toBe(0);
    expect(run.docker).toContain(START_STACK);
  });

  it('leaves the compose file of the running stack alone when it stops early', () => {
    // The files on the server describe the stack that is running there. A
    // deploy that stops before the role bootstrap must not have replaced them.
    const server = createServer();
    const first = runDeploy({}, server);
    const composeFile = path.join(first.deployDir, 'docker-compose.prod.yml');
    const deployed = readFileSync(composeFile, 'utf8');

    const second = runScript(
      { ...EXPRESSIONS, 'steps.images.outputs.api_image': OLD_API_IMAGE },
      { STUB_SERVER_VERSION_NUM: '160015' },
      server,
    );

    expect(second.status).not.toBe(0);
    expect(readFileSync(composeFile, 'utf8')).toBe(deployed);
  });

  it('stops before the role bootstrap when an image cannot be pulled', () => {
    const run = runDeploy({ STUB_MISSING_IMAGE: WEB_IMAGE });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(`could not pull ${WEB_IMAGE}`);
    expect(run.docker).not.toContain(BOOTSTRAP);
    expect(run.docker).not.toContain(START_STACK);
  });

  it('fails when a container is unhealthy after the start', () => {
    // "(unhealthy)" contains "healthy": counting the bare word called a
    // broken stack ready on the first poll.
    const run = runDeploy({ STUB_PS_OUTPUT: 'api Up 5 seconds (unhealthy)' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('did not become healthy');
  });

  it('fails while a container is still starting when the wait runs out', () => {
    const run = runDeploy({ STUB_PS_OUTPUT: 'api Up 5 seconds (health: starting)' });

    expect(run.status).not.toBe(0);
  });

  it.each([
    // The count of healthy containers used to be compared with the count of
    // containers that are `Up`: one that is not up was simply not counted.
    ['keeps restarting', psOutput({ api: 'Restarting (1) 12 seconds ago' }), 'api'],
    ['has exited', psOutput({ web: 'Exited (1) 40 seconds ago' }), 'web'],
    ['has no container at all', psOutput({ redis: undefined }), 'redis'],
    ['is up without a health status', psOutput({ pgbouncer: 'Up 2 minutes' }), 'pgbouncer'],
  ])('fails when one service %s while the others are healthy', (_label, ps, service) => {
    const run = runDeploy({ STUB_PS_OUTPUT: ps });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('did not become healthy');
    expect(run.output).toContain(`not healthy: ${service}`);
  });

  it('waits for each service the compose file declares, by name', () => {
    const run = runDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.docker).toContain(`${COMPOSE} config --services`);
    for (const service of LONG_RUNNING) expect(run.docker).toContain(`${COMPOSE} ps ${service}`);
  });

  it('fails when the services of the stack cannot be listed', () => {
    const run = runDeploy({ STUB_SERVICES_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('could not list the services');
  });

  it('keeps the SSH session open for longer than the script can take', () => {
    // The SSH action ends the remote command after `command_timeout`, ten
    // minutes unless the step says otherwise: no more than the health wait
    // alone, so that wait could never report, and a migration that ran long
    // was cut off mid-way with a generic timeout.
    const minutes = Number(/^ {10}command_timeout: (\d+)m$/mu.exec(step)?.[1] ?? '10');
    const healthWait = Number(/^timeout=(\d+)$/mu.exec(rawScript)?.[1]);
    const jobMinutes = Number(jobKey(jobOf(readWorkflow('deploy.yml'), 'app'), 'timeout-minutes'));

    expect(healthWait).toBeGreaterThan(0);
    // At least twenty minutes for the pulls, the role bootstrap and the migrations.
    expect(minutes * 60 - healthWait).toBeGreaterThanOrEqual(20 * 60);
    // And the script's own failure is reported before the job is cancelled.
    expect(minutes).toBeLessThan(jobMinutes);
  });

  it('fails when the start itself fails', () => {
    const run = runDeploy({ STUB_UP_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('docker compose up failed');
  });

  it('stops when a stack file cannot be fetched', () => {
    // Otherwise the deploy carries on with whatever compose file an earlier
    // run left on the server.
    const run = runDeploy({ STUB_REPO: '/nonexistent' });

    expect(run.status).not.toBe(0);
    expect(run.docker).toEqual([]);
  });
});

describe('deploy workflow: a changed Caddyfile', () => {
  const SHIPPED = readFileSync(path.join(REPO_ROOT, 'infra/runtime/caddy/Caddyfile'), 'utf8');
  const CHANGED = `${SHIPPED}\n# a route added by a later commit\n`;

  /** A server COMMIT was deployed to, and a later commit's Caddyfile for the next deploy. */
  function deployedServer(): { server: string; overrides: Record<string, string> } {
    const server = createServer();
    const first = runDeploy({}, server);
    expect(first.status, first.output).toBe(0);
    const changed = path.join(server, 'Caddyfile.changed');
    writeFileSync(changed, CHANGED);
    return { server, overrides: { STUB_CADDYFILE: changed } };
  }

  /** The Caddyfile the caddy container reads, as the stub tracks it. */
  function caddySees(server: string): string {
    return readFileSync(path.join(server, 'state', 'caddy-sees'), 'utf8');
  }

  it('starts caddy on the Caddyfile of the first deploy, without recreating it', () => {
    const server = createServer();
    const run = runDeploy({}, server);

    expect(run.status, run.output).toBe(0);
    expect(caddySees(server)).toBe(SHIPPED);
    expect(run.docker).not.toContain(RECREATE_CADDY);
  });

  it('recreates caddy when the deployed commit changed the Caddyfile', () => {
    // `up -d` does not: the stack is no longer taken down first, and a changed
    // file behind a bind mount is no change Compose can see.
    const { server, overrides } = deployedServer();

    const run = runDeploy(overrides, server);

    expect(run.status, run.output).toBe(0);
    expect(readFileSync(path.join(run.deployDir, 'Caddyfile'), 'utf8')).toBe(CHANGED);
    expect(caddySees(server)).toBe(CHANGED);
    // After the stack is up, and without touching any other service.
    expect(run.docker.indexOf(RECREATE_CADDY)).toBeGreaterThan(run.docker.indexOf(START_STACK));
    expect(run.docker.filter((command) => command.includes('--force-recreate'))).toEqual([
      RECREATE_CADDY,
    ]);
  });

  it('leaves caddy alone when the Caddyfile is the one it runs on', () => {
    const server = createServer();
    runDeploy({}, server);

    const again = runDeploy({}, server);

    expect(again.status, again.output).toBe(0);
    expect(again.docker).not.toContain(RECREATE_CADDY);
  });

  it('applies a Caddyfile that a deploy which then failed had put in place', () => {
    // The failed deploy replaced the file and stopped at the migration. The
    // next one finds the file unchanged on disk, and caddy still on the old one.
    const { server, overrides } = deployedServer();
    const failed = runDeploy({ ...overrides, STUB_MIGRATE_EXIT: '1' }, server);
    expect(failed.status).not.toBe(0);
    expect(caddySees(server)).toBe(SHIPPED);

    const run = runDeploy(overrides, server);

    expect(run.status, run.output).toBe(0);
    expect(caddySees(server)).toBe(CHANGED);
  });

  it('fails when caddy cannot be recreated on the new Caddyfile', () => {
    const { server, overrides } = deployedServer();

    const run = runDeploy({ ...overrides, STUB_RECREATE_EXIT: '1' }, server);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('could not recreate caddy');
  });

  it.runIf(dockerAvailable)(
    'cannot rely on Compose to notice: the service hash ignores the file content',
    () => {
      const { server, overrides } = deployedServer();
      const deployDir = path.join(server, 'home', 'deployments', 'bslt', 'production');
      const hash = (): string =>
        execFileSync('docker', [...COMPOSE.split(' '), 'config', '--hash', 'caddy'], {
          cwd: deployDir,
          env: { PATH: process.env['PATH'] ?? '', HOME: os.tmpdir() },
          encoding: 'utf8',
        });
      const before = hash();

      runDeploy(overrides, server);

      expect(readFileSync(path.join(deployDir, 'Caddyfile'), 'utf8')).toBe(CHANGED);
      expect(hash()).toBe(before);
    },
  );
});

describe('deploy workflow: what is left on the server', () => {
  it('writes a .env only its owner can read, with nothing left to resolve', () => {
    const run = runDeploy();
    const envFile = path.join(run.deployDir, '.env');
    const env = readFileSync(envFile, 'utf8');

    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    // An unresolved `${VAR}` renders empty in every shell but the deploy session.
    expect(env).not.toContain('$');
    expect(env.split('\n')).toEqual(
      expect.arrayContaining([
        `POSTGRES_HOST=${SECRETS['DB_HOST'] ?? ''}`,
        `POSTGRES_PORT=${SECRETS['DB_PORT'] ?? ''}`,
        'POSTGRES_DB=abe_stack',
        `POSTGRES_PASSWORD='${SECRETS['DB_SUPERUSER_PASSWORD'] ?? ''}'`,
        `DATABASE_URL=postgresql://bslt_app:${SECRETS['DB_APP_PASSWORD'] ?? ''}@pgbouncer:5432/abe_stack`,
        `WORKER_DATABASE_URL=postgresql://bslt_worker:${SECRETS['DB_WORKER_PASSWORD'] ?? ''}@pgbouncer:5432/abe_stack`,
        `LISTEN_DATABASE_URL=postgresql://bslt_worker:${SECRETS['DB_WORKER_PASSWORD'] ?? ''}@${DB_ADDRESS}/abe_stack`,
        `MIGRATION_DATABASE_URL=postgresql://bslt_owner:${SECRETS['DB_OWNER_PASSWORD'] ?? ''}@${DB_ADDRESS}/abe_stack`,
        `DOMAIN='${DOMAIN}'`,
        `EMAIL_FROM_ADDRESS='no-reply@${DOMAIN}'`,
        `SMTP_HOST='smtp.mail.${DOMAIN}'`,
      ]),
    );
  });

  it('mounts the Caddyfile it fetched where Caddy reads its configuration', () => {
    // The mount source is rewritten to the file next to the compose file. A
    // pattern with unescaped dots also matched inside the target path and left
    // `/e./Caddyfile`, so Caddy started on its image's default configuration.
    const run = runDeploy();
    const mounts = readFileSync(path.join(run.deployDir, 'docker-compose.prod.yml'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('Caddyfile'));

    expect(run.status, run.output).toBe(0);
    expect(mounts).toEqual(['      - ./Caddyfile:/etc/caddy/Caddyfile:ro']);
    expect(existsSync(path.join(run.deployDir, 'Caddyfile'))).toBe(true);
  });

  it('tightens a .env an earlier deploy left world-readable', () => {
    const server = createServer();
    const first = runDeploy({}, server);
    chmodSync(path.join(first.deployDir, '.env'), 0o644);

    const second = runDeploy({}, server);

    expect(second.status, second.output).toBe(0);
    expect(statSync(path.join(second.deployDir, '.env')).mode & 0o777).toBe(0o600);
  });

  describe.runIf(dockerAvailable)('rendered by docker compose from a bare shell', () => {
    it('runs the API and both one-shot jobs from the image this deploy built', () => {
      const services = renderFromBareShell(runDeploy().deployDir);

      for (const name of ['api', 'bootstrap-roles', 'migrate']) {
        expect(services[name]?.image, name).toBe(API_IMAGE);
        expect(services[name]?.build, name).toBeUndefined();
      }
      expect(services['web']?.image).toBe(WEB_IMAGE);
    });

    it('binds the Caddyfile of the deploy directory to /etc/caddy/Caddyfile', () => {
      const { deployDir } = runDeploy();
      const binds = (renderFromBareShell(deployDir)['caddy']?.volumes ?? []).filter(
        (volume) => volume.type === 'bind',
      );

      expect(binds.map((volume) => [volume.source, volume.target])).toEqual([
        [path.join(deployDir, 'Caddyfile'), '/etc/caddy/Caddyfile'],
      ]);
    });

    it('gives the API its two role URLs with their passwords, and no other database secret', () => {
      const services = renderFromBareShell(runDeploy().deployDir);
      const api = environmentOf(services, 'api');

      expect(api['DATABASE_URL']).toBe(
        `postgresql://bslt_app:${SECRETS['DB_APP_PASSWORD'] ?? ''}@pgbouncer:5432/abe_stack`,
      );
      expect(api['WORKER_DATABASE_URL']).toBe(
        `postgresql://bslt_worker:${SECRETS['DB_WORKER_PASSWORD'] ?? ''}@pgbouncer:5432/abe_stack`,
      );
      // Pub/sub LISTEN goes to the database server directly: not through the pooler.
      expect(api['LISTEN_DATABASE_URL']).toBe(
        `postgresql://bslt_worker:${SECRETS['DB_WORKER_PASSWORD'] ?? ''}@${DB_ADDRESS}/abe_stack`,
      );
      const everything = JSON.stringify(api);
      expect(everything).not.toContain(SECRETS['DB_SUPERUSER_PASSWORD']);
      expect(everything).not.toContain(SECRETS['DB_OWNER_PASSWORD']);
    });

    it.each([
      ['a reference Compose would resolve', 'jwt$ecret-with-dollar-and-32-characters!!'],
      ['a hash and spaces', 'cookie value#hash, 32 characters long....'],
      ['shell and Compose syntax', AWKWARD],
    ])('hands every container a secret with %s exactly as configured', (_label, value) => {
      // `docker compose config` writes a literal `$` as `$$`.
      const rendered = (text: string | undefined): string => (text ?? '').replaceAll('$$', '$');
      const server = createServer();
      const run = runDeploy(
        {
          DB_SUPERUSER_PASSWORD: value,
          JWT_SECRET: value,
          COOKIE_SECRET: value,
          OAUTH_TOKEN_ENCRYPTION_KEY: value,
          ACME_EMAIL: value,
        },
        server,
      );
      expect(run.status, run.output).toBe(0);

      const services = renderFromBareShell(run.deployDir);
      const api = environmentOf(services, 'api');

      expect(rendered(api['JWT_SECRET'])).toBe(value);
      expect(rendered(api['COOKIE_SECRET'])).toBe(value);
      expect(rendered(api['OAUTH_TOKEN_ENCRYPTION_KEY'])).toBe(value);
      expect(rendered(environmentOf(services, 'caddy')['ACME_EMAIL'])).toBe(value);
      // The version guard, the role bootstrap and PgBouncer use one password.
      expect(readFileSync(path.join(server, 'psql-password'), 'utf8')).toBe(`${value}\n`);
      expect(rendered(environmentOf(services, 'bootstrap-roles')['POSTGRES_PASSWORD'])).toBe(value);
      expect(rendered(environmentOf(services, 'pgbouncer')['POSTGRESQL_PASSWORD'])).toBe(value);
    });

    it('hands the superuser and owner credentials to the one-shot jobs only', () => {
      const services = renderFromBareShell(runDeploy().deployDir);
      const holders = (secret: string): string[] =>
        Object.keys(services)
          .filter((name) => JSON.stringify(environmentOf(services, name)).includes(secret))
          .toSorted();

      expect(holders(SECRETS['DB_SUPERUSER_PASSWORD'] ?? '')).toEqual([
        'bootstrap-roles',
        'pgbouncer',
      ]);
      expect(holders(SECRETS['DB_OWNER_PASSWORD'] ?? '')).toEqual(['bootstrap-roles', 'migrate']);
    });

    it('declares the services the health wait is simulated with, each with a health check', () => {
      // What the real `docker compose config --services` prints for the files
      // a deploy leaves: the list the stub answers with. A service without a
      // health check would never read `(healthy)` and the wait would not end.
      const { deployDir } = runDeploy();
      const listed = execFileSync('docker', [...COMPOSE.split(' '), 'config', '--services'], {
        cwd: deployDir,
        env: { PATH: process.env['PATH'] ?? '', HOME: os.tmpdir() },
        encoding: 'utf8',
      });
      const services = renderFromBareShell(deployDir);

      expect(listed.split('\n').filter(Boolean).toSorted()).toEqual([...LONG_RUNNING]);
      for (const service of LONG_RUNNING) {
        expect(services[service]?.healthcheck, service).toBeDefined();
      }
    });

    it('runs no database on the app server and points every client at the database server', () => {
      const services = renderFromBareShell(runDeploy().deployDir);

      expect(Object.keys(services).toSorted()).toEqual([
        'api',
        'bootstrap-roles',
        'caddy',
        'migrate',
        'pgbouncer',
        'redis',
        'web',
      ]);
      expect(environmentOf(services, 'pgbouncer')['POSTGRESQL_HOST']).toBe(SECRETS['DB_HOST']);
      expect(environmentOf(services, 'bootstrap-roles')['POSTGRES_HOST']).toBe(SECRETS['DB_HOST']);
      expect(new URL(environmentOf(services, 'migrate')['MIGRATION_DATABASE_URL'] ?? '').host).toBe(
        DB_ADDRESS,
      );
    });

    it('gives the API the SMTP credentials, so that it authenticates to the mail server', () => {
      // The deploy removes the API's `env_file:`, the only way these two
      // reached it: the server's .env is read for interpolation alone.
      const run = runDeploy({ SMTP_USER: 'mailer@app.example.test', SMTP_PASS: AWKWARD });
      expect(run.status, run.output).toBe(0);
      const api = environmentOf(renderFromBareShell(run.deployDir), 'api');
      for (const [key, value] of Object.entries(api)) api[key] = value.replaceAll('$$', '$');
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${String(code)})`);
      });

      const config = load(api);

      expect(config.email.provider).toBe('smtp');
      expect(config.email.smtp.host).toBe(`smtp.mail.${DOMAIN}`);
      expect(config.email.smtp.auth).toEqual({ user: 'mailer@app.example.test', pass: AWKWARD });
    });

    it('leaves the API without SMTP credentials when none are configured', () => {
      const api = environmentOf(renderFromBareShell(runDeploy().deployDir), 'api');

      expect(api['SMTP_USER'] ?? '').toBe('');
      expect(api['SMTP_PASS'] ?? '').toBe('');
    });

    it('produces an API environment the production config accepts', () => {
      const api = environmentOf(renderFromBareShell(runDeploy().deployDir), 'api');
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${String(code)})`);
      });

      const config = load(api);

      expect(config.env).toBe('production');
      expect(config.server.apiBaseUrl).toBe(`https://${DOMAIN}`);
      expect(config.server.appBaseUrl).toBe(`https://${DOMAIN}`);
      expect(config.database.connectionString).toBe(api['DATABASE_URL']);
      expect(config.database.workerConnectionString).toBe(api['WORKER_DATABASE_URL']);
      expect(config.database.listenConnectionString).toBe(api['LISTEN_DATABASE_URL']);
    });
  });
});

describe('deploy workflow: rollback', () => {
  /** A server that COMMIT was deployed to, and what the deploy left on it. */
  function deployedServer(): { server: string; deployDir: string; compose: string; env: string } {
    const server = createServer();
    const deploy = runDeploy({}, server);
    expect(deploy.status, deploy.output).toBe(0);
    return {
      server,
      deployDir: deploy.deployDir,
      compose: readFileSync(path.join(deploy.deployDir, 'docker-compose.prod.yml'), 'utf8'),
      env: readFileSync(path.join(deploy.deployDir, '.env'), 'utf8'),
    };
  }

  function imageLines(compose: string): string[] {
    return compose.split('\n').filter((line) => /^ {4}image: /u.test(line));
  }

  it('is the same step as the deploy, in another mode', () => {
    expect(rawScript).toContain('if [ "$DEPLOY_MODE" = "rollback" ]; then');
  });

  it('changes the four image references and nothing else in the compose file', () => {
    const { server, deployDir, compose } = deployedServer();

    const run = runRollback(server);

    expect(run.status, run.output).toBe(0);
    const rolledBack = readFileSync(path.join(deployDir, 'docker-compose.prod.yml'), 'utf8');
    const before = compose.split('\n');
    const after = rolledBack.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.flatMap((line, index) => (line === before[index] ? [] : [line]));
    expect(changed).toEqual([
      `    image: ${OLD_API_IMAGE}`,
      `    image: ${OLD_API_IMAGE}`,
      `    image: ${OLD_API_IMAGE}`,
      `    image: ${OLD_WEB_IMAGE}`,
    ]);
    // Caddy, PgBouncer and Redis keep the images the deploy gave them.
    expect(imageLines(rolledBack).filter((line) => !line.includes(OLD_COMMIT))).toEqual(
      imageLines(compose).filter((line) => !line.includes(COMMIT)),
    );
  });

  it('keeps the file it replaced', () => {
    const { server, deployDir, compose } = deployedServer();

    runRollback(server);

    expect(
      readFileSync(path.join(deployDir, 'docker-compose.prod.yml.before-rollback'), 'utf8'),
    ).toBe(compose);
  });

  it('leaves the .env exactly as the deploy wrote it', () => {
    const { server, deployDir, env } = deployedServer();

    const run = runRollback(server);

    expect(run.status, run.output).toBe(0);
    expect(readFileSync(path.join(deployDir, '.env'), 'utf8')).toBe(env);
    expect(statSync(path.join(deployDir, '.env')).mode & 0o777).toBe(0o600);
  });

  it('pulls both images, then replaces the containers, and runs no database step', () => {
    const { server } = deployedServer();

    const run = runRollback(server);

    expect(run.status, run.output).toBe(0);
    const order = [`pull ${OLD_API_IMAGE}`, `pull ${OLD_WEB_IMAGE}`, START_STACK].map((command) =>
      run.docker.indexOf(command),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    // Migrations only move forward: the older code runs on the current schema.
    expect(run.docker).not.toContain(BOOTSTRAP);
    expect(run.docker).not.toContain(MIGRATE);
    expect(run.docker.filter((command) => command.includes(' psql '))).toEqual([]);
    expect(run.docker.filter((command) => / (?:down|stop|rm)\b/u.test(command))).toEqual([]);
    // Nothing is fetched: the stack files stay those of the last deploy.
    expect(run.fetched).toEqual([]);
  });

  it('verifies that the running containers are the images it rolled back to', () => {
    const { server } = deployedServer();

    const run = runRollback(server);

    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain(`ok: api is running ${OLD_API_IMAGE}`);
    expect(run.output).toContain(`ok: web is running ${OLD_WEB_IMAGE}`);
  });

  it('needs none of the database secrets', () => {
    const { server } = deployedServer();

    const run = runRollback(
      server,
      Object.fromEntries([...DATABASE_SECRETS, 'DB_HOST', 'JWT_SECRET'].map((name) => [name, ''])),
    );

    expect(run.status, run.output).toBe(0);
  });

  it.each([
    ['API', OLD_API_IMAGE],
    ['web', OLD_WEB_IMAGE],
  ])('changes nothing when the commit has no %s image', (_label, missing) => {
    const { server, deployDir, compose } = deployedServer();

    const run = runRollback(server, { STUB_MISSING_IMAGE: missing });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(`could not pull ${missing}`);
    expect(readFileSync(path.join(deployDir, 'docker-compose.prod.yml'), 'utf8')).toBe(compose);
    expect(run.docker).not.toContain(START_STACK);
  });

  it('stops when the server has no deployment to roll back', () => {
    const run = runRollback(createServer());

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('to roll back');
    expect(run.docker).toEqual([]);
  });

  it('refuses a compose file that no deploy of this workflow wrote', () => {
    // The repository's own file builds its images; it names none to replace.
    const { server, deployDir } = deployedServer();
    const composeFile = path.join(deployDir, 'docker-compose.prod.yml');
    copyFileSync(
      path.join(REPO_ROOT, 'infra/docker/production/docker-compose.prod.yml'),
      composeFile,
    );
    const handWritten = readFileSync(composeFile, 'utf8');

    const run = runRollback(server);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('is not the file a deploy writes');
    expect(readFileSync(composeFile, 'utf8')).toBe(handWritten);
    expect(run.docker).not.toContain(START_STACK);
  });

  it('fails when the rolled-back stack is unhealthy', () => {
    const { server } = deployedServer();

    const run = runRollback(server, { STUB_PS_OUTPUT: 'api Up 5 seconds (unhealthy)' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('did not become healthy');
  });

  it('rolls forward again with an ordinary deploy', () => {
    const { server, deployDir } = deployedServer();
    runRollback(server);

    const again = runDeploy({}, server);

    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain(`ok: api is running ${API_IMAGE}`);
    expect(
      imageLines(readFileSync(path.join(deployDir, 'docker-compose.prod.yml'), 'utf8')).filter(
        (line) => line.includes(OLD_COMMIT),
      ),
    ).toEqual([]);
  });

  describe.runIf(dockerAvailable)('rendered by docker compose from a bare shell', () => {
    it('runs the API, both one-shot jobs and the web app from the older images', () => {
      const { server, deployDir } = deployedServer();
      const before = renderFromBareShell(deployDir);
      runRollback(server);

      const services = renderFromBareShell(deployDir);

      for (const name of ['api', 'bootstrap-roles', 'migrate']) {
        expect(services[name]?.image, name).toBe(OLD_API_IMAGE);
      }
      expect(services['web']?.image).toBe(OLD_WEB_IMAGE);
      // The configuration is the last deploy's.
      expect(environmentOf(services, 'api')).toEqual(environmentOf(before, 'api'));
      expect(services['pgbouncer']?.image).toBe(before['pgbouncer']?.image);
    });
  });
});
