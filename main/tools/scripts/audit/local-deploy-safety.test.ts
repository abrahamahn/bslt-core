// main/tools/scripts/audit/local-deploy-safety.test.ts
/**
 * Safety invariants for `infra/docker/demo/local-deploy.sh`.
 *
 * The script deploys to a droplet that also hosts two unrelated production sites
 * (ganbate.io, kanustudio.com). Its safety properties are therefore not style
 * preferences — they are the reason a demo deploy cannot take down someone else's
 * site. They are also exactly the kind of thing a later edit "helpfully" removes:
 * syncing every stack file looks more correct than syncing one, and dropping
 * `--no-deps` looks like a more thorough restart.
 *
 * These read the script as text because there is nothing to unit-test — the logic
 * is ssh and docker invocations. Asserting the invariants is still worth more than
 * asserting nothing.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoPath } from '../../lib/paths';
import { jobOf, readWorkflow, stepOf } from '../../lib/workflow-file';

const SCRIPT_PATH = repoPath('infra/docker/demo/local-deploy.sh');
const script = readFileSync(SCRIPT_PATH, 'utf8');

describe('local-deploy.sh passes the API origin to the browser build', () => {
  function buildProbe(apiUrl?: string) {
    const directory = mkdtempSync(path.join(tmpdir(), 'bslt-deploy-'));
    try {
      const key = path.join(directory, 'key');
      writeFileSync(key, 'test-only');
      for (const [name, content] of Object.entries({
        ssh: '#!/bin/sh\necho ok\n',
        docker: '#!/bin/sh\nprintf "ARG=%s\\n" "$@"\nexit 73\n',
      })) {
        const file = path.join(directory, name);
        writeFileSync(file, content);
        chmodSync(file, 0o755);
      }
      const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        DROPLET_HOST: 'example.invalid',
        SSH_KEY: key,
      };
      delete env['VITE_API_URL'];
      if (apiUrl !== undefined) env['VITE_API_URL'] = apiUrl;
      return spawnSync('bash', [SCRIPT_PATH, '--web'], {
        env,
        encoding: 'utf8',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it.each([undefined, ''])('uses the same-origin base when configured as %s', (value) => {
    const result = buildProbe(value);
    expect(result.status).toBe(73);
    expect(result.stdout.split('\n')).toContain('ARG=VITE_API_URL=');
  });

  it('preserves an absolute API origin', () => {
    const result = buildProbe('https://api.example.com');
    expect(result.status).toBe(73);
    expect(result.stdout.split('\n')).toContain('ARG=VITE_API_URL=https://api.example.com');
  });

  it.each(['/api', '/api/', 'api', '//api.example.com', 'ftp://api.example.com'])(
    'rejects the invalid API base %s before building',
    (value) => {
      const result = buildProbe(value);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('VITE_API_URL');
      expect(result.stdout).not.toContain('ARG=');
    },
  );
});

/**
 * Statements that actually run: comments and blanks dropped, and backslash
 * continuations joined so a command reads as one line.
 *
 * The joining matters. `scp -i … \` puts its source path on the *next* physical
 * line, so a per-line check for "which files does this script copy" sees an scp
 * with no filename — the same failure mode as judging CSS one physical line at a
 * time, which produced 43 false positives in `lint-css-tokens` earlier today.
 */
const executable = ((): string[] => {
  const out: string[] = [];
  let pending = '';
  for (const raw of script.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    out.push((pending + line).trim());
    pending = '';
  }
  if (pending !== '') out.push(pending.trim());
  return out;
})();

describe('local-deploy.sh never writes files that belong to other sites', () => {
  it('copies nginx.conf to the droplet and nothing else', () => {
    const scpLines = executable.filter((line) => line.includes('scp '));
    expect(scpLines).toHaveLength(1);
    expect(scpLines[0]).toContain('nginx.conf');
  });

  it.each(['Caddyfile', 'docker-compose.demo.yml', 'origin-cert.pem', 'origin-key.pem'])(
    'never scps %s',
    (file) => {
      // The droplet's Caddyfile routes ganbate.io and kanustudio.com as well as
      // app.bslt.dev; its compose file and origin certs have also diverged. All are
      // reported as differing, never overwritten.
      const writes = executable.filter((line) => line.includes('scp ') && line.includes(file));
      expect(writes).toEqual([]);
    },
  );

  it('backs up nginx.conf before replacing it', () => {
    const backup = executable.find(
      (line) => line.includes('nginx.conf.bak') && line.includes('cp '),
    );
    expect(backup).toBeDefined();
  });
});

describe('local-deploy.sh restarts only its own services', () => {
  it('passes --no-deps to every compose up', () => {
    const ups = executable.filter((line) => line.includes('compose') && line.includes('up -d'));
    expect(ups.length).toBeGreaterThan(0);
    for (const line of ups) expect(line).toContain('--no-deps');
  });

  it('never restarts caddy or postgres by name', () => {
    // caddy fronts the other two sites; postgres is shared by this stack only but
    // restarting it drops connections for no reason when shipping a frontend.
    for (const service of ['caddy', 'postgres']) {
      const restarts = executable.filter(
        (line) => line.includes('up -d') && new RegExp(`\\b${service}\\b`).test(line),
      );
      expect(restarts).toEqual([]);
    }
  });

  it('never runs a bare `docker compose up -d` that would start everything', () => {
    const bare = executable.filter((line) => /up -d(\s+--\S+)*\s*(&&|;|"|')?\s*$/.test(line));
    expect(bare).toEqual([]);
  });
});

describe('local-deploy.sh makes destructive steps opt-in', () => {
  it.each([['image pruning', 'PRUNE', 'image prune']])(
    'gates %s behind a flag defaulting to off',
    (_label, flag, command) => {
      expect(script).toMatch(new RegExp(`${flag}=0`));
      const guarded = executable.some(
        (line, i) =>
          line.includes(`"$${flag}" -eq 1`) &&
          executable.slice(i, i + 4).some((next) => next.includes(command)),
      );
      expect(guarded).toBe(true);
    },
  );

  it('runs no database job outside the --migrate block', () => {
    // Migrations are not always reversible, so running them is a decision. The
    // role bootstrap travels with them: it is what the migrations run after.
    expect(script).toMatch(/RUN_MIGRATIONS=0/);

    const start = executable.findIndex((line) => line.includes('"$RUN_MIGRATIONS" -eq 1'));
    expect(start).toBeGreaterThan(-1);
    // Walk to the `fi` that closes the block, counting nested `if`s.
    let depth = 0;
    let end = -1;
    for (let i = start; i < executable.length; i++) {
      const line = executable[i] ?? '';
      if (/^if\b/.test(line)) depth++;
      if (line === 'fi' && --depth === 0) {
        end = i;
        break;
      }
    }
    expect(end).toBeGreaterThan(start);

    const jobs = executable.flatMap((line, i) =>
      line.includes('compose') && /bootstrap-roles|\bmigrate\b/.test(line) ? [i] : [],
    );
    // The probe for the one-shot services, then at least one job per branch.
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    for (const index of jobs) {
      expect(index).toBeGreaterThan(start);
      expect(index).toBeLessThan(end);
    }
  });
});

/**
 * The order is the safety property. The API image runs every user session as
 * the role `authenticated`, and that role and its grants come from
 * the role bootstrap and the baselines. Restarting the API first and migrating
 * afterwards (what this script used to do) serves permission errors in between,
 * and for good if the migration then fails.
 *
 * These run the real script against stub `ssh`/`docker`/`curl` binaries and read
 * back the remote commands in the order they were issued.
 */
describe('local-deploy.sh runs the database jobs before the API restarts', () => {
  interface DeployProbe {
    readonly status: number | null;
    readonly stdout: string;
    readonly remote: readonly string[];
  }

  // Records the remote command (always the last argument), drains stdin so a
  // piped image stream ends cleanly, and plays the droplet's part.
  const SSH_STUB = [
    '#!/bin/sh',
    'for last; do :; done',
    'printf "%s\\n" "$last" >> "$STUB_REMOTE_LOG"',
    'cat > /dev/null',
    'case "$last" in',
    '  *"config --services"*) [ "$STUB_ONE_SHOT_SERVICES" = 1 ]; exit $? ;;',
    'esac',
    'if [ -n "$STUB_FAIL_ON" ]; then',
    '  case "$last" in *"$STUB_FAIL_ON"*) exit 1 ;; esac',
    'fi',
    'exit 0',
    '',
  ].join('\n');

  const CURL_STUB = [
    '#!/bin/sh',
    'case "$*" in',
    '  *http_code*) printf 200 ;;',
    '  *size_download*) printf 5000 ;;',
    'esac',
    '',
  ].join('\n');

  function deploy(
    args: readonly string[],
    options: {
      readonly oneShotServices?: boolean;
      readonly failOn?: string;
    } = {},
  ): DeployProbe {
    const directory = mkdtempSync(path.join(tmpdir(), 'bslt-deploy-order-'));
    try {
      const key = path.join(directory, 'key');
      const log = path.join(directory, 'remote.log');
      writeFileSync(key, 'test-only');
      writeFileSync(log, '');
      for (const [name, content] of Object.entries({
        ssh: SSH_STUB,
        // A --web deploy copies nginx.conf to the droplet.
        scp: '#!/bin/sh\nexit 0\n',
        curl: CURL_STUB,
        docker: '#!/bin/sh\nexit 0\n',
        sleep: '#!/bin/sh\nexit 0\n',
      })) {
        const file = path.join(directory, name);
        writeFileSync(file, content);
        chmodSync(file, 0o755);
      }
      const result = spawnSync('bash', [SCRIPT_PATH, ...args], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env['PATH'] ?? ''}`,
          DROPLET_HOST: 'example.invalid',
          SSH_KEY: key,
          STUB_REMOTE_LOG: log,
          STUB_ONE_SHOT_SERVICES: options.oneShotServices === false ? '0' : '1',
          STUB_FAIL_ON: options.failOn ?? '',
        },
        encoding: 'utf8',
      });
      return {
        status: result.status,
        stdout: result.stdout,
        remote: readFileSync(log, 'utf8').split('\n').filter(Boolean),
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const position = (remote: readonly string[], needle: string): number =>
    remote.findIndex((command) => command.includes(needle));
  const restartOfApi = (remote: readonly string[]): number =>
    remote.findIndex((command) => /up -d --no-deps --force-recreate\s+api\b/.test(command));

  it('bootstraps roles, then migrates, then restarts the API', () => {
    const { status, remote } = deploy(['--api', '--migrate']);

    expect(status).toBe(0);
    const bootstrap = position(remote, 'run --rm --no-deps bootstrap-roles');
    const migrate = position(remote, 'run --rm --no-deps migrate');
    const restart = restartOfApi(remote);
    expect(bootstrap).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(bootstrap);
    expect(restart).toBeGreaterThan(migrate);
  });

  it.each([
    ['the role bootstrap', 'run --rm --no-deps bootstrap-roles'],
    ['a migration', 'run --rm --no-deps migrate'],
  ])('leaves the running API alone when %s fails', (_label, failOn) => {
    const { status, remote } = deploy(['--api', '--migrate'], { failOn });

    expect(status).not.toBe(0);
    expect(position(remote, failOn)).toBeGreaterThan(-1);
    expect(position(remote, 'up -d')).toBe(-1);
  });

  it('migrates through the api service when the droplet compose file has no one-shot jobs', () => {
    // docker-compose.demo.yml is never synced by this script, so the droplet's
    // copy may predate the bootstrap-roles / migrate services.
    const { status, stdout, remote } = deploy(['--api', '--migrate'], {
      oneShotServices: false,
    });

    expect(status).toBe(0);
    expect(position(remote, 'run --rm --no-deps bootstrap-roles')).toBe(-1);
    const migrate = position(
      remote,
      'run --rm --no-deps api node node_modules/@bslt/db/dist/migrate/entry.js',
    );
    expect(migrate).toBeGreaterThan(-1);
    expect(restartOfApi(remote)).toBeGreaterThan(migrate);
    expect(stdout).toContain('predates the database role split');
  });

  it('never lets a database job start or recreate postgres', () => {
    // `compose run` brings dependencies up, recreating one whose definition has
    // drifted. --no-deps keeps the "restart only what changed" rule intact.
    const runs = executable.filter((line) => line.includes('compose') && line.includes(' run '));
    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) expect(line).toContain('--no-deps');
  });

  it.each([
    ['--api', 'API_IMAGE=bslt-api:local', 'WEB_IMAGE='],
    ['--web', 'WEB_IMAGE=bslt-web:local', 'API_IMAGE='],
  ])(
    '%s points the droplet .env at the image it shipped, before any job or restart',
    (flag, pinned, untouched) => {
      // remote-deploy.sh pins the deployed images in that .env, and compose
      // resolves API_IMAGE / WEB_IMAGE from it: without this the restart below
      // would bring the previously pinned image back.
      const { status, remote } = deploy([flag, '--migrate']);

      expect(status).toBe(0);
      const pin = position(remote, pinned);
      expect(pin).toBeGreaterThan(-1);
      expect(remote[pin]).toContain('.env');
      const later = remote.slice(pin + 1);
      expect(later.some((command) => command.includes('up -d --no-deps'))).toBe(true);
      expect(remote.slice(0, pin).some((command) => /\brun --rm\b|\bup -d\b/u.test(command))).toBe(
        false,
      );
      expect(position(remote, untouched)).toBe(-1);
    },
  );

  it('runs no database job without --migrate, and says what that risks', () => {
    const { status, stdout, remote } = deploy(['--api']);

    expect(status).toBe(0);
    expect(remote.filter((command) => command.includes(' run '))).toEqual([]);
    expect(stdout).toContain('--migrate not given');
  });
});

describe('local-deploy.sh verifies the deploy it performed', () => {
  it('checks the public URL and fails on a non-200', () => {
    expect(script).toContain('%{http_code}');
    expect(script).toMatch(/if \[ "\$status" != "200" \]/);
  });

  it('tells the operator how to roll back when it fails', () => {
    const failure = script.slice(script.indexOf('Public URL returned'));
    expect(failure).toContain('WEB_IMAGE=');
    expect(failure).toContain('nginx.conf.bak');
  });

  it('warns when a prerendered page comes back suspiciously small', () => {
    // A 200 that returns a bare SPA shell means the prerender step regressed.
    expect(script).toContain('%{size_download}');
  });
});

describe('local-deploy.sh matches the workflow it replaces', () => {
  const demoWebBuild = stepOf(
    jobOf(readWorkflow('deploy.yml'), 'demo-images'),
    'Build and push the demo web image',
  );

  it('passes no build arg the workflow does not', () => {
    const local = [...script.matchAll(/--build-arg ([A-Z_]+)=true/gu)].map((match) => match[1]);
    const workflow = [...demoWebBuild.matchAll(/^ {12}([A-Z_]+)=true$/gmu)].map(
      (match) => match[1],
    );

    expect(local.toSorted()).toEqual(workflow.toSorted());
  });

  it('builds both images from the same Dockerfiles the workflow uses', () => {
    expect(script).toContain('-f infra/docker/Dockerfile.web');
    expect(script).toContain('-f infra/docker/Dockerfile ');
  });
});
