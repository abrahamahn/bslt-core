// main/tools/scripts/audit/version-pins.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { auditVersionPins, readPins, run } from './version-pins';

const SHA = '34e114876b0b11c390a56381ad16ebd13914f8d5';
const DIGEST = `sha256:${'ab12'.repeat(16)}`;
const PGBOUNCER = `bitnamilegacy/pgbouncer:1.24.1-debian-12-r10@${DIGEST}`;

const DOCKERFILE = [
  'ARG NODE_VERSION=24.22.3',
  'FROM node:${NODE_VERSION}-alpine AS base',
  'FROM base AS build',
  'ARG NODE_VERSION',
  'FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine AS runner',
  'COPY --from=build /app /app',
  '',
].join('\n');

const COMPOSE = [
  'services:',
  '  postgres:',
  '    image: postgres:17.11-alpine',
  '  pgbouncer:',
  `    image: ${PGBOUNCER}`,
  '  web:',
  '    image: node:24.22.3-alpine',
  '  api:',
  '    image: ${API_IMAGE:-app:local}',
  '  redis:',
  '    image: redis:7-alpine',
  '',
].join('\n');

const WORKFLOW = [
  'name: CI',
  'on: [push]',
  'jobs:',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    services:',
  '      postgres:',
  '        image: postgres:17.11-alpine',
  '    steps:',
  `      - uses: actions/checkout@${SHA} # v4.3.1`,
  '      - name: Setup Node.js',
  `        uses: actions/setup-node@${'49933ea5288caeca8642d1e84afbd3f7d6820020'} # v4.4.0`,
  '        with:',
  '          node-version-file: .node-version',
  '          cache: pnpm',
  '      - uses: ./.github/actions/setup',
  `      - uses: "github/codeql-action/init@${'89a39a4e59826350b863aa6b6252a07ad50cf83e'}" # v4.32.4`,
  '      - run: pnpm test',
  '',
].join('\n');

const ACTION = [
  'name: Setup',
  'runs:',
  '  using: composite',
  '  steps:',
  `    - uses: pnpm/action-setup@${'41ff72655975bd51cab0327fa583b6e92b6d3061'} # v4.2.0`,
  '',
].join('\n');

const DO_TF = [
  'resource "digitalocean_droplet" "app" {',
  '  image = "ubuntu-24-04-x64"',
  '}',
  '',
  'resource "digitalocean_database_cluster" "app" {',
  '  engine     = "pg"',
  '  version    = "17"',
  '  node_count = 1',
  '}',
  '',
].join('\n');

const GCP_TF = [
  'resource "google_sql_database_instance" "app" {',
  '  database_version = "POSTGRES_17"',
  '}',
  '',
].join('\n');

const GOOD: Readonly<Record<string, string>> = {
  '.node-version': '24.22.3\n',
  'infra/versions.env': [
    '# pins',
    'POSTGRES_MAJOR=17',
    'POSTGRES_IMAGE=postgres:17.11-alpine',
    `PGBOUNCER_IMAGE=${PGBOUNCER}`,
    '',
  ].join('\n'),
  'package.json': `${JSON.stringify({ name: 'root', engines: { node: '>=24 <25' } }, null, 2)}\n`,
  'main/app/package.json': `${JSON.stringify({ name: 'app' }, null, 2)}\n`,
  'infra/docker/Dockerfile': DOCKERFILE,
  'infra/docker/Dockerfile.dockerignore': 'node_modules\n',
  'infra/docker/docker-compose.yml': COMPOSE,
  '.github/workflows/ci.yml': WORKFLOW,
  '.github/actions/setup/action.yml': ACTION,
  'infra/cloud/digitalocean/main.tf': DO_TF,
  'infra/cloud/gcp/main.tf': GCP_TF,
};

const fixtures: string[] = [];

/** Writes the good fixture repository with `overrides` applied (`null` deletes a file). */
function fixtureRepo(overrides: Readonly<Record<string, string | null>> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'version-pins-'));
  fixtures.push(root);
  for (const [relative, content] of Object.entries({ ...GOOD, ...overrides })) {
    if (content === null) continue;
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

/** The good file at `relative` with `from` replaced by `to` (which must change it). */
function edited(relative: string, from: string, to: string): Record<string, string> {
  const before = GOOD[relative] ?? '';
  const after = before.replace(from, to);
  expect(after, `${relative} does not contain ${from}`).not.toBe(before);
  return { [relative]: after };
}

function problemsFor(overrides: Readonly<Record<string, string | null>>): string[] {
  return auditVersionPins(fixtureRepo(overrides));
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('readPins', () => {
  it('reads the Node pin and the versions file', () => {
    expect(readPins(fixtureRepo())).toEqual({
      pins: {
        node: '24.22.3',
        nodeMajor: 24,
        postgresMajor: '17',
        postgresImage: 'postgres:17.11-alpine',
        pgbouncerImage: PGBOUNCER,
      },
      problems: [],
    });
  });

  it.each([
    ['a missing .node-version', { '.node-version': null }, '.node-version: missing'],
    [
      'a floating Node major',
      { '.node-version': '24\n' },
      '.node-version: "24" is not an exact version (major.minor.patch)',
    ],
    [
      'an lts alias',
      { '.node-version': 'lts/krypton\n' },
      '.node-version: "lts/krypton" is not an exact version (major.minor.patch)',
    ],
    ['a missing versions file', { 'infra/versions.env': null }, 'infra/versions.env: missing'],
    [
      'a missing key',
      edited('infra/versions.env', 'POSTGRES_MAJOR=17\n', ''),
      'infra/versions.env: POSTGRES_MAJOR is not set',
    ],
    [
      'an image of another major',
      edited('infra/versions.env', 'POSTGRES_MAJOR=17', 'POSTGRES_MAJOR=16'),
      'infra/versions.env: POSTGRES_IMAGE "postgres:17.11-alpine" is not a minor release of PostgreSQL 16 (expected postgres:16.<minor>)',
    ],
    [
      'a floating Postgres minor',
      edited('infra/versions.env', 'postgres:17.11-alpine', 'postgres:17-alpine'),
      'infra/versions.env: POSTGRES_IMAGE "postgres:17-alpine" is not a minor release of PostgreSQL 17 (expected postgres:17.<minor>)',
    ],
    [
      'a PgBouncer image without a digest',
      edited('infra/versions.env', `@${DIGEST}`, ''),
      'infra/versions.env: PGBOUNCER_IMAGE must be pinned by digest (@sha256:<64 hex>)',
    ],
  ])('reports %s', (_label, overrides, problem) => {
    const result = readPins(fixtureRepo(overrides));

    expect(result.problems).toContain(problem);
    expect(result.pins).toBeUndefined();
  });
});

describe('auditVersionPins', () => {
  it('passes a repository whose every version is a pin', () => {
    expect(problemsFor({})).toEqual([]);
  });

  it('stops at the pins when they cannot be read', () => {
    expect(problemsFor({ '.node-version': null })).toEqual(['.node-version: missing']);
  });

  describe('package.json engines', () => {
    it.each([
      ['a wider range', '>=22'],
      ['another major', '>=22 <23'],
      ['an exact version', '24.22.3'],
    ])('rejects %s in the root package', (_label, range) => {
      expect(problemsFor({ 'package.json': JSON.stringify({ engines: { node: range } }) })).toEqual(
        [`package.json: engines.node is "${range}", expected ">=24 <25"`],
      );
    });

    it('requires the root package to declare engines.node', () => {
      expect(problemsFor({ 'package.json': JSON.stringify({ name: 'root' }) })).toEqual([
        'package.json: engines.node is not set, expected ">=24 <25"',
      ]);
    });

    it('holds a workspace package that declares engines to the same range', () => {
      expect(
        problemsFor({ 'main/app/package.json': JSON.stringify({ engines: { node: '>=20' } }) }),
      ).toEqual(['main/app/package.json: engines.node is ">=20", expected ">=24 <25"']);
    });

    it('ignores installed packages', () => {
      expect(
        problemsFor({
          'node_modules/dep/package.json': JSON.stringify({ engines: { node: '>=18' } }),
          'main/app/node_modules/dep/Dockerfile': 'FROM node:18\n',
        }),
      ).toEqual([]);
    });
  });

  describe('Dockerfiles', () => {
    it('rejects an ARG default that is not the pin', () => {
      expect(
        problemsFor(
          edited('infra/docker/Dockerfile', 'ARG NODE_VERSION=24.22.3', 'ARG NODE_VERSION=22'),
        ),
      ).toEqual([
        'infra/docker/Dockerfile:1: ARG NODE_VERSION defaults to "22", expected 24.22.3 (.node-version)',
      ]);
    });

    it('rejects a literal Node image', () => {
      expect(
        problemsFor(
          edited(
            'infra/docker/Dockerfile',
            'FROM node:${NODE_VERSION}-alpine AS base',
            'FROM node:24.22.3-alpine AS base',
          ),
        ),
      ).toEqual([
        'infra/docker/Dockerfile:2: FROM node:24.22.3-alpine must take its version from the build arg: node:${NODE_VERSION}[-variant]',
      ]);
    });

    it('rejects a Node image copied from, too', () => {
      expect(
        problemsFor({
          'infra/docker/Dockerfile': `${DOCKERFILE}COPY --from=node:22-alpine /usr/local/bin/node /node\n`,
        }),
      ).toEqual([
        'infra/docker/Dockerfile:7: COPY --from=node:22-alpine must take its version from the build arg: node:${NODE_VERSION}[-variant]',
      ]);
    });

    it('requires the build arg to have the pin as its default', () => {
      expect(
        problemsFor({
          'infra/docker/Dockerfile.web':
            'ARG NODE_VERSION\nFROM node:${NODE_VERSION}-alpine AS base\n',
        }),
      ).toEqual([
        'infra/docker/Dockerfile.web: uses a Node image without "ARG NODE_VERSION=24.22.3" (.node-version)',
      ]);
    });

    it('holds a Postgres base image to POSTGRES_IMAGE', () => {
      expect(problemsFor({ 'infra/db/Dockerfile': 'FROM postgres:16-alpine\n' })).toEqual([
        'infra/db/Dockerfile:1: image postgres:16-alpine is not POSTGRES_IMAGE postgres:17.11-alpine (infra/versions.env)',
      ]);
      expect(problemsFor({ 'infra/db/Dockerfile': 'FROM postgres:17.11-alpine\n' })).toEqual([]);
    });
  });

  describe('compose files', () => {
    it.each([
      ['another major', 'postgres:16-alpine'],
      ['a floating minor', 'postgres:17-alpine'],
      ['another variant', 'postgres:17.11'],
      ['the default of a variable', '${POSTGRES_IMAGE:-postgres:16-alpine}'],
      ['a quoted image', "'postgres:16-alpine'"],
      ['a registry-qualified image', 'docker.io/library/postgres:16-alpine'],
    ])('rejects a Postgres image with %s', (_label, image) => {
      const [problem, ...rest] = problemsFor(
        edited(
          'infra/docker/docker-compose.yml',
          'image: postgres:17.11-alpine',
          `image: ${image}`,
        ),
      );

      expect(problem).toMatch(
        /^infra\/docker\/docker-compose\.yml:3: image \S+ is not POSTGRES_IMAGE postgres:17\.11-alpine \(infra\/versions\.env\)$/u,
      );
      expect(rest).toEqual([]);
    });

    it('rejects a PgBouncer image that is not the pinned digest', () => {
      expect(
        problemsFor(
          edited('infra/docker/docker-compose.yml', PGBOUNCER, 'bitnami/pgbouncer:latest'),
        ),
      ).toEqual([
        `infra/docker/docker-compose.yml:5: image bitnami/pgbouncer:latest is not PGBOUNCER_IMAGE ${PGBOUNCER} (infra/versions.env)`,
      ]);
    });

    it.each(['node:22-alpine', 'node:24-alpine', 'node:lts', 'node'])(
      'rejects the Node image %s',
      (image) => {
        expect(
          problemsFor(edited('infra/docker/docker-compose.yml', 'node:24.22.3-alpine', image)),
        ).toEqual([
          `infra/docker/docker-compose.yml:7: image ${image} is not node:24.22.3[-variant] (.node-version)`,
        ]);
      },
    );

    it('finds compose files by name, in any directory', () => {
      expect(
        problemsFor({
          'tests/e2e/compose.test.yaml': 'services:\n  db:\n    image: postgres:15\n',
        }),
      ).toEqual([
        'tests/e2e/compose.test.yaml:3: image postgres:15 is not POSTGRES_IMAGE postgres:17.11-alpine (infra/versions.env)',
      ]);
    });
  });

  describe('workflows: versions', () => {
    it('rejects a service image that is not POSTGRES_IMAGE', () => {
      expect(
        problemsFor(
          edited(
            '.github/workflows/ci.yml',
            'image: postgres:17.11-alpine',
            'image: postgres:16-alpine',
          ),
        ),
      ).toEqual([
        '.github/workflows/ci.yml:8: image postgres:16-alpine is not POSTGRES_IMAGE postgres:17.11-alpine (infra/versions.env)',
      ]);
    });

    it.each([
      ['a floating major', 'node-version: 24', 'node-version is "24"'],
      ['a quoted other version', "node-version: '20'", 'node-version is "20"'],
      [
        'an expression',
        'node-version: ${{ env.NODE_VERSION }}',
        'node-version is "${{ env.NODE_VERSION }}"',
      ],
    ])('rejects setup-node with %s', (_label, input, found) => {
      expect(
        problemsFor(edited('.github/workflows/ci.yml', 'node-version-file: .node-version', input)),
      ).toEqual([
        `.github/workflows/ci.yml:14: ${found}; use "node-version-file: .node-version" (or the exact pin 24.22.3)`,
      ]);
    });

    it('accepts the exact pin as a literal', () => {
      expect(
        problemsFor(
          edited(
            '.github/workflows/ci.yml',
            'node-version-file: .node-version',
            "node-version: '24.22.3'",
          ),
        ),
      ).toEqual([]);
    });

    it('rejects another version file', () => {
      expect(
        problemsFor(
          edited(
            '.github/workflows/ci.yml',
            'node-version-file: .node-version',
            'node-version-file: package.json',
          ),
        ),
      ).toEqual([
        '.github/workflows/ci.yml:14: node-version-file is "package.json", expected .node-version',
      ]);
    });

    it('rejects setup-node that names no version at all', () => {
      expect(
        problemsFor(
          edited('.github/workflows/ci.yml', '          node-version-file: .node-version\n', ''),
        ),
      ).toEqual([
        '.github/workflows/ci.yml:12: actions/setup-node without "node-version-file: .node-version"',
      ]);
    });

    it('reads the inputs of a setup-node step that starts with uses', () => {
      const workflow = [
        'jobs:',
        '  a:',
        '    steps:',
        `      - uses: actions/setup-node@${SHA} # v4.4.0`,
        '      - name: next step',
        '        with:',
        '          node-version-file: .node-version',
        '',
      ].join('\n');

      expect(problemsFor({ '.github/workflows/ci.yml': workflow })).toEqual([
        '.github/workflows/ci.yml:4: actions/setup-node without "node-version-file: .node-version"',
      ]);
    });

    it('rejects a node-version input declared by a composite action', () => {
      const action = [
        'inputs:',
        '  node-version:',
        "    default: '22'",
        'runs:',
        '  using: composite',
        '  steps:',
        `    - uses: actions/setup-node@${SHA} # v4.4.0`,
        '      with:',
        '        node-version: ${{ inputs.node-version }}',
        '',
      ].join('\n');

      expect(problemsFor({ '.github/actions/setup/action.yml': action })).toEqual([
        '.github/actions/setup/action.yml:2: a node-version input lets a caller choose the Node version; read .node-version instead',
        '.github/actions/setup/action.yml:9: node-version is "${{ inputs.node-version }}"; use "node-version-file: .node-version" (or the exact pin 24.22.3)',
      ]);
    });

    it.each([
      ["NODE_VERSION: '20'", 'NODE_VERSION is "20"'],
      ['NODE_VERSION=22', 'NODE_VERSION is "22"'],
    ])('rejects the literal %s', (line, found) => {
      expect(problemsFor({ '.github/workflows/ci.yml': `${WORKFLOW}env:\n  ${line}\n` })).toEqual([
        `.github/workflows/ci.yml:20: ${found}, expected 24.22.3 (.node-version)`,
      ]);
    });

    it('accepts NODE_VERSION set to the pin or read from it', () => {
      expect(
        problemsFor({
          '.github/workflows/ci.yml': `${WORKFLOW}env:\n  NODE_VERSION: 24.22.3\n  X: NODE_VERSION=\${{ steps.pins.outputs.node }}\n`,
        }),
      ).toEqual([]);
    });
  });

  describe('workflows: actions pinned by commit', () => {
    const checkout = `uses: actions/checkout@${SHA} # v4.3.1`;

    it.each([
      ['a major tag', 'uses: actions/checkout@v4', 'actions/checkout@v4'],
      ['a version tag', 'uses: actions/checkout@v4.3.1 # v4.3.1', 'actions/checkout@v4.3.1'],
      ['a branch', 'uses: actions/checkout@main', 'actions/checkout@main'],
      ['a short hash', 'uses: actions/checkout@34e1148 # v4.3.1', 'actions/checkout@34e1148'],
      ['no ref', 'uses: actions/checkout', 'actions/checkout'],
    ])('rejects %s', (_label, line, reference) => {
      expect(problemsFor(edited('.github/workflows/ci.yml', checkout, line))).toEqual([
        `.github/workflows/ci.yml:10: ${reference} is not pinned to a full commit SHA (owner/repo@<40 hex> # vX.Y.Z)`,
      ]);
    });

    it.each([
      ['no comment', `uses: actions/checkout@${SHA}`],
      ['a comment that is not a version', `uses: actions/checkout@${SHA} # pinned`],
      ['an empty comment', `uses: actions/checkout@${SHA} #`],
    ])('rejects a commit with %s', (_label, line) => {
      expect(problemsFor(edited('.github/workflows/ci.yml', checkout, line))).toEqual([
        `.github/workflows/ci.yml:10: actions/checkout@${SHA} needs its version tag in a trailing comment (# vX.Y.Z)`,
      ]);
    });

    it('checks the steps of composite actions', () => {
      expect(
        problemsFor(
          edited(
            '.github/actions/setup/action.yml',
            'pnpm/action-setup@41ff72655975bd51cab0327fa583b6e92b6d3061 # v4.2.0',
            'pnpm/action-setup@v4',
          ),
        ),
      ).toEqual([
        '.github/actions/setup/action.yml:5: pnpm/action-setup@v4 is not pinned to a full commit SHA (owner/repo@<40 hex> # vX.Y.Z)',
      ]);
    });

    it('checks reusable workflows of other repositories and leaves local ones alone', () => {
      const workflow = [
        'jobs:',
        '  local:',
        '    uses: ./.github/workflows/deploy.yml',
        '  remote:',
        '    uses: octo-org/shared/.github/workflows/build.yml@main',
        '',
      ].join('\n');

      expect(problemsFor({ '.github/workflows/ci.yml': workflow })).toEqual([
        '.github/workflows/ci.yml:5: octo-org/shared/.github/workflows/build.yml@main is not pinned to a full commit SHA (owner/repo@<40 hex> # vX.Y.Z)',
      ]);
    });

    it('requires a digest on a docker action', () => {
      const workflow = (image: string): string =>
        `jobs:\n  a:\n    steps:\n      - uses: docker://${image}\n`;

      expect(problemsFor({ '.github/workflows/ci.yml': workflow('alpine:3.20') })).toEqual([
        '.github/workflows/ci.yml:4: docker://alpine:3.20 is not pinned by digest (@sha256:<64 hex>)',
      ]);
      expect(
        problemsFor({ '.github/workflows/ci.yml': workflow(`alpine:3.20@${DIGEST}`) }),
      ).toEqual([]);
    });
  });

  describe('terraform', () => {
    it('holds a managed DigitalOcean cluster to POSTGRES_MAJOR', () => {
      expect(
        problemsFor(
          edited('infra/cloud/digitalocean/main.tf', 'version    = "17"', 'version    = "16"'),
        ),
      ).toEqual([
        'infra/cloud/digitalocean/main.tf:7: managed PostgreSQL version is "16", expected "17" (POSTGRES_MAJOR in infra/versions.env)',
      ]);
    });

    it('leaves the version of a cluster of another engine alone', () => {
      expect(
        problemsFor(
          edited('infra/cloud/digitalocean/main.tf', 'engine     = "pg"', 'engine     = "redis"'),
        ),
      ).toEqual([]);
    });

    it('holds a Cloud SQL instance to POSTGRES_MAJOR', () => {
      expect(problemsFor(edited('infra/cloud/gcp/main.tf', 'POSTGRES_17', 'POSTGRES_16'))).toEqual([
        'infra/cloud/gcp/main.tf:2: database_version is "POSTGRES_16", expected "POSTGRES_17" (POSTGRES_MAJOR in infra/versions.env)',
      ]);
    });
  });

  it('holds .nvmrc, when there is one, to the pin', () => {
    expect(problemsFor({ '.nvmrc': 'v24.22.3\n' })).toEqual([]);
    expect(problemsFor({ '.nvmrc': '22\n' })).toEqual([
      '.nvmrc: "22" is not the pinned Node.js version 24.22.3 (.node-version)',
    ]);
  });
});

describe('run', () => {
  it('fails with every problem listed', () => {
    const root = fixtureRepo({
      ...edited(
        '.github/workflows/ci.yml',
        `actions/checkout@${SHA} # v4.3.1`,
        'actions/checkout@v4',
      ),
      ...edited('infra/docker/docker-compose.yml', 'postgres:17.11-alpine', 'postgres:16'),
    });

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe('2 version pin violations');
    expect(result.problems).toHaveLength(2);
  });

  it('summarizes what it held to the pins', () => {
    expect(run(fixtureRepo())).toEqual({
      ok: true,
      summary:
        'Node 24.22.3 and postgres:17.11-alpine in 8 files; 4 action references pinned by commit',
    });
  });

  it('passes on this repository', () => {
    expect(run()).toMatchObject({ ok: true });
  });
});
