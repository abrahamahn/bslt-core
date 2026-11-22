// main/tools/scripts/audit/compose-isolation.test.ts
/**
 * Two environments on one host must not share a container name or a data volume.
 *
 * Docker treats `container_name:` and a volume's explicit `name:` as ABSOLUTE —
 * the compose project name does NOT prefix them. The production compose file
 * hardcoded `container_name: abe-postgres` and `name: abe-postgres-data`, so
 * bringing staging up on a host that had ever run production would attach
 * production's data volume, and then run migrations against it.
 *
 * The CI deploy path was never actually exposed to this: the deploy workflow
 * strips the `name:` and `container_name:` lines with sed before invoking
 * compose. But that means the safety of every deploy rests on three regexes over
 * a YAML file, with nothing asserting the result. The documented MANUAL path
 * (infra/cloud/staging-setup.md) has no such protection and is the one that bites.
 *
 * Two things are pinned here, and the FIRST matters more than the second:
 *
 *   1. With no RESOURCE_PREFIX, the rendered names are exactly what they are
 *      today. An existing droplet must not be renamed, and above all must not be
 *      handed a fresh empty volume — that would be silent data loss dressed up
 *      as a fix.
 *   2. With a RESOURCE_PREFIX, nothing is shared.
 *
 * Since Phase 4 the file runs no database (it lives on its own server,
 * `docker-compose.db.yml`), so `abe-postgres` and `abe-postgres-data` are no
 * longer among the names: the database volume cannot be attached, renamed or
 * emptied by anything this file does.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const COMPOSE_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'docker',
  'production',
  'docker-compose.prod.yml',
);

/** Values the file marks as required; irrelevant to naming, but config refuses to render without them. */
const REQUIRED = {
  POSTGRES_PASSWORD: 'x',
  JWT_SECRET: 'x',
  COOKIE_SECRET: 'x',
  EMAIL_FROM_ADDRESS: 'a@b.c',
  SMTP_HOST: 'smtp',
  OAUTH_TOKEN_ENCRYPTION_KEY: 'k',
  // Database role split: the API refuses to render without its two role URLs
  // and the worker's direct pub/sub URL, PgBouncer without the database server.
  POSTGRES_HOST: 'db.internal.test',
  DATABASE_URL: 'postgresql://bslt_app:x@pgbouncer:5432/x',
  WORKER_DATABASE_URL: 'postgresql://bslt_worker:x@pgbouncer:5432/x',
  LISTEN_DATABASE_URL: 'postgresql://bslt_worker:x@db.internal.test:5432/x',
};

let composeFile: string;

// Naming checks must not require or read a developer's production service secrets.
function render(env: Record<string, string>): { containers: string[]; volumes: string[] } {
  const out = execFileSync('docker', ['compose', '-f', composeFile, 'config'], {
    env: { ...process.env, ...REQUIRED, ...env },
    encoding: 'utf8',
  });

  const containers = [...out.matchAll(/^\s*container_name:\s*(\S+)$/gmu)].map((m) => m[1] ?? '');
  // Only top-level volume names (4-space indent under `volumes:`), not networks.
  const volumes = [...out.matchAll(/^ {4}name:\s*(\S+)$/gmu)]
    .map((m) => m[1] ?? '')
    .filter((name) => !name.includes('_internal'));

  return { containers, volumes };
}

const dockerAvailable = ((): boolean => {
  try {
    execFileSync('docker', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(dockerAvailable)('production compose isolation', () => {
  let fixtureRoot: string | undefined;

  beforeAll(() => {
    // Some Compose versions still require env_file paths to exist when using
    // --no-env-resolution. Mirror the unchanged config with an empty test env.
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'bslt-compose-isolation-'));
    composeFile = path.join(fixtureRoot, 'infra/docker/production/docker-compose.prod.yml');
    const envFile = path.join(fixtureRoot, 'config/env/.env.production');
    mkdirSync(path.dirname(composeFile), { recursive: true });
    mkdirSync(path.dirname(envFile), { recursive: true });
    copyFileSync(COMPOSE_FILE, composeFile);
    writeFileSync(envFile, '# Empty fixture; no production credentials.\n');
  });

  afterAll(() => {
    if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('renders exactly the names it renders today when RESOURCE_PREFIX is unset', () => {
    // If this ever fails, an existing deployment is about to be handed new,
    // EMPTY volumes. That is worse than the bug being fixed.
    const { containers, volumes } = render({});

    expect(containers.toSorted()).toEqual([
      'abe-api',
      'abe-caddy',
      'abe-pgbouncer',
      'abe-redis',
      'abe-web',
    ]);
    expect(volumes.toSorted()).toEqual([
      'abe-caddy-config',
      'abe-caddy-data',
      'abe-redis-data',
      'abe-uploads-data',
    ]);
  });

  it('shares no container name or volume between two prefixes', () => {
    const prod = render({ RESOURCE_PREFIX: 'abe-prod' });
    const staging = render({ RESOURCE_PREFIX: 'abe-staging' });

    expect(prod.containers).not.toHaveLength(0);
    expect(prod.volumes).not.toHaveLength(0);

    const sharedContainers = prod.containers.filter((name) => staging.containers.includes(name));
    const sharedVolumes = prod.volumes.filter((name) => staging.volumes.includes(name));

    expect(sharedContainers).toEqual([]);
    expect(sharedVolumes).toEqual([]);
  });

  it('lets two environments bind different host ports', () => {
    // Without this, isolation is academic: both stacks' Caddy would fight over
    // :443 and the second would simply fail to come up.
    const out = execFileSync('docker', ['compose', '-f', composeFile, 'config'], {
      env: { ...process.env, ...REQUIRED, HTTP_PORT: '8080', HTTPS_PORT: '8443' },
      encoding: 'utf8',
    });

    expect(out).toContain('8080');
    expect(out).toContain('8443');
  });
});
