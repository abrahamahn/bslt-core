// main/tools/scripts/audit/demo-remote-deploy.test.ts
/**
 * `infra/docker/demo/remote-deploy.sh`, run for real against stub binaries.
 *
 * It is the droplet-side half of the demo deploy, with two callers: the `demo`
 * job of `.github/workflows/deploy.yml`, which has the host pull the ghcr
 * images of a commit (`IMAGE_SOURCE=ghcr`, the default), and the workstation
 * deploy runner, which `docker load`s the images it built before it runs the
 * script (`IMAGE_SOURCE=loaded`). What it must keep doing, in both:
 *
 *   - bootstrap the database roles, then migrate, then recreate api and web,
 *     and stop at the first of those that fails (`set -e`);
 *   - recreate the database when the migrate job exits 3: it was built from
 *     other baselines, which are edited in place until foundation-v1, and the
 *     demo database is disposable (restructure plan 9.3, item 6);
 *   - read the pinned Postgres major from the synced `versions.env`, and when
 *     the data volume holds a cluster of another major, drop that volume (the
 *     demo database is disposable) instead of letting the pinned image
 *     crash-loop on it;
 *   - never stop, start or recreate caddy: it is the edge of the whole host and
 *     also serves other sites.
 *
 * And in loaded mode: no registry at all, both images checked before anything
 * changes, and no image prune (the runner keeps the previous images).
 *
 * The script runs under bash in a directory laid out like the droplet's
 * `/opt/bslt/demo`, with `docker`, `chown` and `sleep` stubbed and every docker
 * call logged.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { repoPath } from '../../lib/paths';
import {
  blockOf,
  jobKey,
  jobOf,
  jobsOf,
  needsOf,
  readWorkflow,
  stepOf,
} from '../../lib/workflow-file';

const SCRIPT = repoPath('infra/docker/demo/remote-deploy.sh');

/** The files the workflow syncs next to the script, by their name on the host. */
const SYNCED: Readonly<Record<string, string>> = {
  'docker-compose.demo.yml': 'infra/docker/demo/docker-compose.demo.yml',
  'nginx.conf': 'infra/docker/demo/nginx.conf',
  'generate-env.sh': 'infra/docker/demo/generate-env.sh',
  'remote-deploy.sh': 'infra/docker/demo/remote-deploy.sh',
  '.env.production.example': 'config/env/.env.production.example',
  'versions.env': 'infra/versions.env',
};

const PINNED_MAJOR = /^POSTGRES_MAJOR=(\d+)$/mu.exec(
  readFileSync(repoPath('infra/versions.env'), 'utf8'),
)?.[1];

const DOCKER_STUB = [
  '#!/bin/sh',
  'printf "%s\\n" "$*" >> "$STUB_DOCKER_LOG"',
  'case "$*" in',
  // STUB_MISSING_IMAGES: the images this host has not loaded.
  '  "image inspect "*)',
  '    for missing in ${STUB_MISSING_IMAGES:-}; do',
  '      [ "$3" = "$missing" ] && exit 1',
  '    done ;;',
  '  "compose "*" run --rm --no-deps --entrypoint cat postgres /var/lib/postgresql/data/PG_VERSION")',
  '    [ -n "${STUB_PG_VERSION:-}" ] && printf "%s\\n" "$STUB_PG_VERSION" ;;',
  '  "compose "*" exec -T postgres pg_isready "*) exit "${STUB_PG_READY_EXIT:-0}" ;;',
  '  "compose "*" run --rm bootstrap-roles") exit "${STUB_BOOTSTRAP_EXIT:-0}" ;;',
  // STUB_MIGRATE_EXITS: one exit code per call ("3 0"), the last one repeating.
  '  "compose "*" run --rm migrate")',
  '    calls=$(cat "$STUB_DOCKER_LOG.migrate-calls" 2>/dev/null || echo 0)',
  '    calls=$((calls + 1)); echo "$calls" > "$STUB_DOCKER_LOG.migrate-calls"',
  '    set -- ${STUB_MIGRATE_EXITS:-${STUB_MIGRATE_EXIT:-0}}',
  '    [ "$calls" -gt "$#" ] && calls=$#',
  '    eval "exit \\${$calls}" ;;',
  '  "login "*) cat > /dev/null ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

const COMPOSE = 'compose -f docker-compose.demo.yml';
const START_DATABASE = `${COMPOSE} up -d postgres`;
const CHECK_DATABASE = `${COMPOSE} exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d bslt_demo`;
const BOOTSTRAP = `${COMPOSE} run --rm bootstrap-roles`;
const MIGRATE = `${COMPOSE} run --rm migrate`;
/** api and web only: postgres is already up, and caddy is never touched. */
const START_SERVICES = `${COMPOSE} up -d --no-deps --force-recreate api web`;
const DROP_VOLUME = 'volume rm bslt-demo_postgres_data';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** What the `demo` job of deploy.yml gives the script. */
const GHCR_DEPLOY: Readonly<Record<string, string>> = {
  IMAGE_TAG: COMMIT,
  OWNER: 'acme',
  GHCR_TOKEN: 'fixture-ghcr-token',
  PUBLIC_HOST: 'demo.example.test',
};

/** What the workstation deploy runner gives the script, after `docker load`. */
const LOADED_DEPLOY: Readonly<Record<string, string>> = {
  IMAGE_SOURCE: 'loaded',
  API_IMAGE: `local-deploy/bslt-api:${COMMIT}`,
  WEB_IMAGE: `local-deploy/bslt-web:${COMMIT}`,
  PUBLIC_HOST: 'app.bslt.dev',
};

interface DemoRun {
  readonly status: number | null;
  readonly output: string;
  readonly docker: readonly string[];
  readonly chown: readonly string[];
  /** The `.env` the script left in the demo directory; `undefined` when none. */
  readonly env: Readonly<Record<string, string>> | undefined;
}

interface DeployOptions {
  /** The caller's environment; overrides are merged over it. */
  readonly base?: Readonly<Record<string, string>>;
  /** Entries of the droplet's demo directory that are missing. */
  readonly omit?: readonly string[];
}

const hosts: string[] = [];

afterEach(() => {
  for (const dir of hosts.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) env[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return env;
}

function runRemoteDeploy(
  overrides: Readonly<Record<string, string>> = {},
  { base = GHCR_DEPLOY, omit = [] }: DeployOptions = {},
): DemoRun {
  const host = mkdtempSync(path.join(os.tmpdir(), 'bslt-demo-host-'));
  hosts.push(host);
  const demoDir = path.join(host, 'demo');
  const bin = path.join(host, 'bin');
  mkdirSync(demoDir);
  mkdirSync(bin);
  for (const [name, source] of Object.entries(SYNCED)) {
    if (!omit.includes(name)) copyFileSync(repoPath(source), path.join(demoDir, name));
  }
  // The API's bind-mounted file storage, as the droplet has it.
  if (!omit.includes('uploads')) mkdirSync(path.join(demoDir, 'uploads'));
  const dockerLog = path.join(host, 'docker.log');
  const chownLog = path.join(host, 'chown.log');
  for (const [name, content] of Object.entries({
    docker: DOCKER_STUB,
    chown: `#!/bin/sh\nprintf "%s\\n" "$*" >> "${chownLog}"\n`,
    sleep: '#!/bin/sh\nexit 0\n',
  })) {
    writeFileSync(path.join(bin, name), content);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(dockerLog, '');
  writeFileSync(chownLog, '');

  const result = spawnSync('bash', [SCRIPT], {
    env: {
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      HOME: host,
      DEMO_DIR: demoDir,
      STUB_DOCKER_LOG: dockerLog,
      ...base,
      ...overrides,
    },
    encoding: 'utf8',
  });

  const envFile = path.join(demoDir, '.env');
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    docker: readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean),
    chown: readFileSync(chownLog, 'utf8').split('\n').filter(Boolean),
    env: existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : undefined,
  };
}

function indexOf(run: DemoRun, command: string): number {
  return run.docker.indexOf(command);
}

/** Every docker call that names caddy, and every compose `up` other than the two the deploy runs. */
function edgeTouches(run: DemoRun): string[] {
  return run.docker.filter(
    (command) =>
      /\bcaddy\b/u.test(command) ||
      / down\b/u.test(command) ||
      (/ up\b/u.test(command) && command !== START_DATABASE && command !== START_SERVICES),
  );
}

describe('demo remote deploy: order and failure', () => {
  it('bootstraps roles, then migrates, then recreates api and web', () => {
    const run = runRemoteDeploy();

    expect(run.status, run.output).toBe(0);
    // `-h 127.0.0.1` probes TCP, not the Unix socket Postgres opens during initdb.
    const order = [START_DATABASE, CHECK_DATABASE, BOOTSTRAP, MIGRATE, START_SERVICES].map(
      (command) => indexOf(run, command),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it('stops before bootstrap when postgres never accepts TCP connections', () => {
    const run = runRemoteDeploy({ STUB_PG_READY_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.docker).toContain(START_DATABASE);
    expect(run.docker.filter((command) => command === CHECK_DATABASE)).toHaveLength(30);
    expect(run.docker).not.toContain(BOOTSTRAP);
    expect(run.docker).not.toContain(MIGRATE);
    expect(run.docker).not.toContain(START_SERVICES);
  });

  it('does not migrate or recreate api and web when the role bootstrap fails', () => {
    const run = runRemoteDeploy({ STUB_BOOTSTRAP_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.docker).toContain(BOOTSTRAP);
    expect(run.docker).not.toContain(MIGRATE);
    expect(run.docker).not.toContain(START_SERVICES);
  });

  it('does not recreate api and web when a migration fails', () => {
    const run = runRemoteDeploy({ STUB_MIGRATE_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.docker).toContain(MIGRATE);
    expect(run.docker).not.toContain(START_SERVICES);
    // A failed migration is not a reason to drop the database.
    expect(run.docker).not.toContain(DROP_VOLUME);
  });

  it('stops before touching docker when versions.env was not synced', () => {
    const run = runRemoteDeploy({}, { omit: ['versions.env'] });

    expect(run.status).not.toBe(0);
    expect(run.docker).toEqual([]);
  });
});

describe('demo remote deploy: a database built from other baselines', () => {
  /** Exit code of the migrate entry when the database has to be rebuilt. */
  const RESET_REQUIRED = '3';

  it('recreates the database and migrates again, then recreates api and web', () => {
    const run = runRemoteDeploy({ STUB_MIGRATE_EXITS: `${RESET_REQUIRED} 0` });

    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('recreating the demo database');
    const steps = [
      START_DATABASE,
      BOOTSTRAP,
      MIGRATE,
      `${COMPOSE} stop api postgres`,
      `${COMPOSE} rm -f api postgres`,
      DROP_VOLUME,
      START_DATABASE,
      BOOTSTRAP,
      MIGRATE,
      START_SERVICES,
    ];
    // The database jobs and the reset, in the order they ran.
    expect(run.docker.filter((command) => steps.includes(command))).toEqual(steps);
  });

  it('fails without recreating api and web when the recreated database cannot be migrated either', () => {
    for (const second of [RESET_REQUIRED, '1']) {
      const run = runRemoteDeploy({
        STUB_MIGRATE_EXITS: `${RESET_REQUIRED} ${second}`,
      });

      expect(run.status, second).not.toBe(0);
      expect(run.docker.filter((command) => command === MIGRATE)).toHaveLength(2);
      expect(run.docker.filter((command) => command === DROP_VOLUME)).toHaveLength(1);
      expect(run.docker).not.toContain(START_SERVICES);
    }
  });

  it('never touches caddy on the way', () => {
    const run = runRemoteDeploy({ STUB_MIGRATE_EXITS: `${RESET_REQUIRED} 0` });

    expect(run.status, run.output).toBe(0);
    expect(edgeTouches(run)).toEqual([]);
  });
});

describe('demo remote deploy: the pinned Postgres major', () => {
  it('reads a pinned major from infra/versions.env', () => {
    expect(PINNED_MAJOR).toMatch(/^\d+$/u);
  });

  it('keeps a volume that holds the pinned major', () => {
    const run = runRemoteDeploy({ STUB_PG_VERSION: PINNED_MAJOR ?? '' });

    expect(run.status, run.output).toBe(0);
    expect(run.docker).not.toContain(DROP_VOLUME);
  });

  it('keeps a volume that holds no cluster yet', () => {
    const run = runRemoteDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.docker).not.toContain(DROP_VOLUME);
  });

  it('drops a volume of another major before the database starts', () => {
    const run = runRemoteDeploy({ STUB_PG_VERSION: '16' });

    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('PostgreSQL 16 cluster');
    const drop = indexOf(run, DROP_VOLUME);
    expect(drop).toBeGreaterThan(-1);
    expect(indexOf(run, `${COMPOSE} rm -f api postgres`)).toBeLessThan(drop);
    expect(drop).toBeLessThan(indexOf(run, START_DATABASE));
  });

  it('never touches caddy, which serves other sites on the host', () => {
    const run = runRemoteDeploy({ STUB_PG_VERSION: '16' });

    expect(run.status, run.output).toBe(0);
    expect(edgeTouches(run)).toEqual([]);
  });
});

describe('demo remote deploy: the ghcr images of a commit (deploy.yml)', () => {
  const API = `ghcr.io/acme/bslt-api:${COMMIT}`;
  const WEB = `ghcr.io/acme/bslt-web:${COMMIT}`;

  it('logs in and pulls both images of the commit before the stack changes', () => {
    const run = runRemoteDeploy();

    expect(run.status, run.output).toBe(0);
    const firstCompose = run.docker.findIndex((command) => command.startsWith('compose '));
    const registry = ['login ghcr.io -u acme --password-stdin', `pull ${API}`, `pull ${WEB}`].map(
      (command) => indexOf(run, command),
    );
    for (const index of registry) {
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(firstCompose);
    }
  });

  it('never puts the registry token in a docker argument', () => {
    const run = runRemoteDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.docker.join('\n')).not.toContain('fixture-ghcr-token');
  });

  it('recreates api and web only, never caddy', () => {
    const run = runRemoteDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.docker).toContain(START_SERVICES);
    expect(edgeTouches(run)).toEqual([]);
  });

  it('pins the pulled images in .env, so later compose commands resolve them', () => {
    const run = runRemoteDeploy();

    expect(run.status, run.output).toBe(0);
    expect(run.env).toMatchObject({ API_IMAGE: API, WEB_IMAGE: WEB });
  });

  it.each(['IMAGE_TAG', 'OWNER', 'GHCR_TOKEN', 'PUBLIC_HOST'])(
    'refuses to start without %s',
    (name) => {
      const base = Object.fromEntries(Object.entries(GHCR_DEPLOY).filter(([key]) => key !== name));

      const run = runRemoteDeploy({}, { base });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain(`${name} required`);
      expect(run.docker).toEqual([]);
    },
  );
});

describe('demo remote deploy: images loaded by the workstation runner', () => {
  const API = LOADED_DEPLOY['API_IMAGE'] ?? '';
  const WEB = LOADED_DEPLOY['WEB_IMAGE'] ?? '';
  const loaded = (
    overrides: Readonly<Record<string, string>> = {},
    options: DeployOptions = {},
  ): DemoRun => runRemoteDeploy(overrides, { base: LOADED_DEPLOY, ...options });

  it('deploys with no registry: no login, no pull, no token needed', () => {
    const run = loaded();

    expect(run.status, run.output).toBe(0);
    expect(run.docker.filter((command) => /^(?:login|pull)\b|\bpull\b/u.test(command))).toEqual([]);
  });

  it('checks that both images are on the host before anything else', () => {
    const run = loaded();

    expect(run.status, run.output).toBe(0);
    expect(run.docker.slice(0, 2)).toEqual([`image inspect ${API}`, `image inspect ${WEB}`]);
  });

  it.each([
    ['API', API],
    ['web', WEB],
  ])('changes nothing when the %s image was not loaded', (_label, image) => {
    const run = loaded({ STUB_MISSING_IMAGES: image });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(`${image} is not loaded`);
    expect(run.docker.filter((command) => !command.startsWith('image inspect '))).toEqual([]);
    // Not even the env file: the running stack keeps resolving its images.
    expect(run.env).toBeUndefined();
  });

  it('bootstraps roles, then migrates, then recreates api and web', () => {
    const run = loaded();

    expect(run.status, run.output).toBe(0);
    const steps = [START_DATABASE, BOOTSTRAP, MIGRATE, START_SERVICES];
    expect(run.docker.filter((command) => steps.includes(command))).toEqual(steps);
  });

  it('recreates a database built from other baselines, then recreates api and web', () => {
    const run = loaded({ STUB_MIGRATE_EXITS: '3 0' });

    expect(run.status, run.output).toBe(0);
    const steps = [
      START_DATABASE,
      BOOTSTRAP,
      MIGRATE,
      DROP_VOLUME,
      START_DATABASE,
      BOOTSTRAP,
      MIGRATE,
      START_SERVICES,
    ];
    expect(run.docker.filter((command) => steps.includes(command))).toEqual(steps);
  });

  it('does not recreate api and web when a migration fails', () => {
    const run = loaded({ STUB_MIGRATE_EXIT: '1' });

    expect(run.status).not.toBe(0);
    expect(run.docker).not.toContain(START_SERVICES);
    expect(run.docker).not.toContain(DROP_VOLUME);
  });

  it('never touches caddy, and prunes no image', () => {
    for (const overrides of [{}, { STUB_MIGRATE_EXITS: '3 0' }, { STUB_PG_VERSION: '16' }]) {
      const run = loaded(overrides);

      expect(run.status, run.output).toBe(0);
      expect(edgeTouches(run)).toEqual([]);
      expect(run.docker.filter((command) => command.includes('prune'))).toEqual([]);
    }
  });

  it('pins the loaded images in .env, next to the generated keys', () => {
    const run = loaded();

    expect(run.status, run.output).toBe(0);
    expect(run.env).toMatchObject({ API_IMAGE: API, WEB_IMAGE: WEB });
    expect(run.env?.['DATABASE_URL']).toMatch(/^postgresql:\/\/bslt_app:/u);
  });

  it('serves the public host over HTTPS unless told otherwise', () => {
    // The runner passes no PUBLIC_BASE_URL; Cloudflare serves the demo on https.
    expect(loaded().env).toMatchObject({
      APP_URL: 'https://app.bslt.dev',
      API_BASE_URL: 'https://app.bslt.dev',
      CORS_ORIGIN: 'https://app.bslt.dev',
    });
    expect(loaded({ PUBLIC_BASE_URL: 'http://203.0.113.7' }).env?.['APP_URL']).toBe(
      'http://203.0.113.7',
    );
  });

  it('gives a missing uploads directory to the API image user', () => {
    const run = loaded({}, { omit: ['uploads'] });

    expect(run.status, run.output).toBe(0);
    expect(run.chown).toEqual(['1001:1001 uploads']);
    expect(loaded().chown).toEqual([]);
  });

  it.each(['API_IMAGE', 'WEB_IMAGE'])('refuses to start without %s', (name) => {
    const base = Object.fromEntries(Object.entries(LOADED_DEPLOY).filter(([key]) => key !== name));

    const run = runRemoteDeploy({}, { base });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(`${name} required`);
    expect(run.docker).toEqual([]);
  });

  it('refuses an image source it does not know', () => {
    const run = loaded({ IMAGE_SOURCE: 'registry' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('IMAGE_SOURCE');
    expect(run.docker).toEqual([]);
  });
});

describe('deploy.yml: the demo job drives remote-deploy.sh', () => {
  const job = jobOf(readWorkflow('deploy.yml'), 'demo');
  const images = jobsOf(readWorkflow('deploy.yml')).get('demo-images') ?? '';
  const sync = blockOf(stepOf(job, 'Sync the demo stack files to the host'), 'run');
  const deploy = blockOf(stepOf(job, 'Deploy on the demo host'), 'run');

  it('syncs exactly the files the script reads, next to it', () => {
    // The last `scp` of the step: everything it copies into /opt/bslt/demo/.
    const copied = sync
      .slice(sync.lastIndexOf('scp '))
      .split('\n')
      .map((line) => line.replace(/\\$/u, '').trim())
      .filter((line) => /^(?:infra|config)\//u.test(line));

    expect(copied.toSorted()).toEqual(Object.values(SYNCED).toSorted());
    expect(sync).toContain('"root@${HOST}:/opt/bslt/demo/"');
  });

  describe('the host key', () => {
    // `ssh-keyscan` at the start of a run trusts whatever key answers at the
    // address at that moment, which is the same as not checking.
    const KNOWN_HOSTS =
      '[demo-host.example.test]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture';

    /** The sync step, run for real with `ssh`, `scp` and `ssh-keyscan` stubbed. */
    function runSync(knownHosts: string): {
      status: number | null;
      output: string;
      knownHosts: string;
      calls: string[];
    } {
      const runner = mkdtempSync(path.join(os.tmpdir(), 'bslt-demo-sync-'));
      hosts.push(runner);
      const bin = path.join(runner, 'bin');
      mkdirSync(bin);
      const log = path.join(runner, 'calls.log');
      writeFileSync(log, '');
      for (const [name, body] of Object.entries({
        ssh: 'exit 0',
        scp: 'exit 0',
        'ssh-keyscan': 'echo "scanned-key-of $*"',
      })) {
        writeFileSync(
          path.join(bin, name),
          `#!/bin/sh\nprintf "%s\\n" "${name} $*" >> "$STUB_CALLS"\n${body}\n`,
        );
        chmodSync(path.join(bin, name), 0o755);
      }

      const result = spawnSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-eo', 'pipefail', '-c', sync],
        {
          cwd: runner,
          env: {
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            HOME: runner,
            STUB_CALLS: log,
            SSH_PORT: '2222',
            HOST: 'demo-host.example.test',
            SSH_KEY: 'fixture-private-key',
            KNOWN_HOSTS: knownHosts,
          },
          encoding: 'utf8',
        },
      );

      return {
        status: result.status,
        output: `${result.stdout}${result.stderr}`,
        knownHosts: readFileSync(path.join(runner, '.ssh', 'known_hosts'), 'utf8'),
        calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
      };
    }

    it('reads the pinned key of the demo host from its own secret', () => {
      expect(stepOf(job, 'Sync the demo stack files to the host')).toContain(
        'KNOWN_HOSTS: ${{ secrets.DROPLET_KNOWN_HOSTS }}',
      );
    });

    it('trusts the pinned key and nothing else, and never scans', () => {
      const run = runSync(KNOWN_HOSTS);

      expect(run.status, run.output).toBe(0);
      expect(run.knownHosts).toBe(`${KNOWN_HOSTS}\n`);
      expect(run.calls.filter((call) => call.startsWith('ssh-keyscan'))).toEqual([]);
      expect(run.output).not.toContain('::warning::');
    });

    it('refuses to connect to a host whose key is not the pinned one', () => {
      // Said on every connection, not left to the client's defaults.
      const run = runSync(KNOWN_HOSTS);
      const connections = run.calls.filter((call) => /^(?:ssh|scp) /u.test(call));

      expect(connections.length).toBeGreaterThan(0);
      for (const call of connections) expect(call).toContain('-o StrictHostKeyChecking=yes');
      expect(deploy).toContain('-o StrictHostKeyChecking=yes');
    });

    it('still scans, and says that the key is not verified, while none is pinned', () => {
      const run = runSync('');

      expect(run.status, run.output).toBe(0);
      expect(run.calls.filter((call) => call.startsWith('ssh-keyscan'))).toHaveLength(1);
      expect(run.output).toContain('::warning::');
      expect(run.output).toContain('DROPLET_KNOWN_HOSTS');
    });
  });

  it('does not overwrite a Caddyfile that is already on the host', () => {
    // That file also serves other sites on the same host.
    expect(sync).toContain("'test -s /opt/bslt/demo/Caddyfile'");
    expect(sync.indexOf('test -s /opt/bslt/demo/Caddyfile')).toBeLessThan(
      sync.indexOf('infra/docker/demo/Caddyfile "root@'),
    );
  });

  /**
   * The deploy step, run for real with `ssh` stubbed. The stub records its
   * arguments (what `ps` shows on the runner, and the command text the host's
   * shell is started with) and then runs that command text as the host would,
   * with its own standard input, against a `bash` that stands in for
   * remote-deploy.sh and records the environment it was given.
   */
  function runDeployStep(token: string): {
    status: number | null;
    sshArguments: string;
    script: string[];
    environment: Record<string, string>;
  } {
    const runner = mkdtempSync(path.join(os.tmpdir(), 'bslt-demo-runner-'));
    hosts.push(runner);
    const bin = path.join(runner, 'bin');
    const hostBin = path.join(runner, 'host-bin');
    mkdirSync(bin);
    mkdirSync(hostBin);
    writeFileSync(
      path.join(bin, 'ssh'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" > "$STUB_SSH_ARGUMENTS"',
        'for command in "$@"; do :; done',
        'PATH="$STUB_HOST_BIN:$PATH" exec sh -c "$command"',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(hostBin, 'bash'),
      ['#!/bin/sh', 'printf "%s\\n" "$@" > "$STUB_HOST_SCRIPT"', 'env > "$STUB_HOST_ENV"', ''].join(
        '\n',
      ),
    );
    chmodSync(path.join(bin, 'ssh'), 0o755);
    chmodSync(path.join(hostBin, 'bash'), 0o755);
    const files = {
      STUB_SSH_ARGUMENTS: path.join(runner, 'ssh-arguments'),
      STUB_HOST_SCRIPT: path.join(runner, 'host-script'),
      STUB_HOST_ENV: path.join(runner, 'host-env'),
    };
    for (const file of Object.values(files)) writeFileSync(file, '');

    const result = spawnSync(
      '/bin/bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', deploy],
      {
        env: {
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          HOME: runner,
          STUB_HOST_BIN: hostBin,
          ...files,
          SSH_PORT: '2222',
          HOST: 'demo-host.example.test',
          IMAGE_TAG: COMMIT,
          OWNER: 'acme',
          PUBLIC_HOST: 'demo.example.test',
          GHCR_TOKEN: token,
        },
        encoding: 'utf8',
      },
    );

    const environment: Record<string, string> = {};
    for (const line of readFileSync(files.STUB_HOST_ENV, 'utf8').split('\n')) {
      const separator = line.indexOf('=');
      if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return {
      status: result.status,
      sshArguments: readFileSync(files.STUB_SSH_ARGUMENTS, 'utf8'),
      script: readFileSync(files.STUB_HOST_SCRIPT, 'utf8').split('\n').filter(Boolean),
      environment,
    };
  }

  it('passes every variable the script requires to deploy the ghcr images', () => {
    const run = runDeployStep('fixture-ghcr-token');

    expect(run.status).toBe(0);
    expect(run.script).toEqual(['/opt/bslt/demo/remote-deploy.sh']);
    expect(run.environment).toMatchObject({
      GHCR_TOKEN: 'fixture-ghcr-token',
      IMAGE_TAG: COMMIT,
      OWNER: 'acme',
      PUBLIC_HOST: 'demo.example.test',
      PUBLIC_BASE_URL: 'https://demo.example.test',
    });
    expect(run.environment['IMAGE_SOURCE']).toBeUndefined();

    // The same environment, given to the real script.
    const read = [
      'IMAGE_SOURCE',
      'IMAGE_TAG',
      'OWNER',
      'GHCR_TOKEN',
      'API_IMAGE',
      'WEB_IMAGE',
      'PUBLIC_HOST',
      'PUBLIC_BASE_URL',
    ];
    const base = Object.fromEntries(
      Object.entries(run.environment).filter(([key]) => read.includes(key)),
    );
    const deployed = runRemoteDeploy({}, { base });
    expect(deployed.status, deployed.output).toBe(0);
    expect(deployed.docker).toContain(`pull ghcr.io/acme/bslt-api:${COMMIT}`);
    expect(deployed.docker).toContain(START_SERVICES);
  });

  it('sends the registry token on standard input, never in the command the host runs', () => {
    // The command text is an argument of `ssh` on the runner and of the shell
    // the host starts for it: both are in a process list for the whole deploy.
    const token = 'fixture-ghcr-token-$(id)-`id`';

    const run = runDeployStep(token);

    expect(run.status).toBe(0);
    expect(run.sshArguments).not.toContain('fixture-ghcr-token');
    expect(run.environment['GHCR_TOKEN']).toBe(token);
  });

  it('gives the host a token that can read packages, from a job that cannot write them', () => {
    // The host also serves other projects. The token it logs in with comes
    // from this job; the one that pushes the images stays in the build job.
    const permissionsOf = (text: string): string[] => {
      const lines = text.split('\n');
      const start = lines.indexOf('    permissions:');
      const end = lines.findIndex((line, index) => index > start && !line.startsWith('      '));
      return lines
        .slice(start + 1, end)
        .map((line) => line.trim())
        .filter((line) => !line.startsWith('#'));
    };

    expect(permissionsOf(job)).toEqual(['contents: read', 'packages: read']);
    expect(job).not.toContain('build-push-action');
    expect(job).not.toContain('docker/login-action');
    expect(permissionsOf(images)).toEqual(['contents: read', 'packages: write']);
    expect(images).not.toContain('ssh ');
  });

  it('deploys after the images were pushed, and without them for a rollback', () => {
    expect(needsOf(job).toSorted()).toEqual(['demo-images', 'plan']);
    expect(jobKey(job, 'if')).toBe(
      "(!cancelled()) && needs.plan.outputs.demo == 'true' && (needs.demo-images.result == 'success' || needs.demo-images.result == 'skipped')",
    );
    expect(jobKey(images, 'if')).toBe(
      "needs.plan.outputs.demo == 'true' && needs.plan.outputs.mode == 'deploy'",
    );
  });

  it('builds for a configured host only, decided by the same check as the deploy', () => {
    const check = (text: string): string =>
      blockOf(stepOf(text, 'Check the demo host configuration'), 'run');

    expect(check(images)).toBe(check(job));
    expect(jobKey(images, 'environment')).toBe('demo');
    for (const name of ['Build and push the demo API image', 'Build and push the demo web image']) {
      expect(stepOf(images, name), name).toContain("if: steps.config.outputs.enabled == 'true'");
    }
  });

  it('deploys the images of the commit the plan names, and builds none for a rollback', () => {
    expect(job).toContain('      IMAGE_TAG: ${{ needs.plan.outputs.sha }}');
    for (const name of ['Build and push the demo API image', 'Build and push the demo web image']) {
      expect(stepOf(images, name), name).toContain(':${{ needs.plan.outputs.sha }}');
    }
    expect(jobKey(images, 'if')).toContain("needs.plan.outputs.mode == 'deploy'");
  });

  it('is skipped on an automatic run, and fails a manual one, when no host is configured', () => {
    const check = blockOf(stepOf(job, 'Check the demo host configuration'), 'run');
    const run = (event: string): ReturnType<typeof spawnSync> =>
      spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', check], {
        env: {
          PATH: process.env['PATH'] ?? '',
          EVENT_NAME: event,
          HOST: '',
          SSH_KEY: '',
          GITHUB_OUTPUT: '/dev/null',
        },
        encoding: 'utf8',
      });

    expect(run('workflow_run').status).toBe(0);
    expect(String(run('workflow_run').stdout)).toContain('::warning::');
    expect(run('workflow_dispatch').status).toBe(1);
  });
});
