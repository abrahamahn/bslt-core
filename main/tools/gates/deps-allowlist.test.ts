// main/tools/gates/deps-allowlist.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths';
import { CURRENT_PHASE } from '../lib/phase';

import {
  ALLOWLIST_FILE,
  auditDepsAllowlist,
  readAllowlist,
  run,
  type AllowlistEntry,
} from './deps-allowlist';

const roots: string[] = [];

interface Manifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const REACT: AllowlistEntry = {
  name: 'react',
  replacement: 'none: kept by owner decision',
  removeBy: 'permanent',
  conformance: 'n/a',
  usedBy: ['@bslt/web'],
};

const WEBAUTHN: AllowlistEntry = {
  name: '@simplewebauthn/server',
  replacement: "identity's verifier on @bslt/protocols/{cbor,cose}",
  removeBy: 19,
  conformance: 'W3C/FIDO vectors',
  usedBy: ['@bslt/server-system'],
};

const WEB: Manifest = {
  name: '@bslt/web',
  dependencies: { react: '^19.0.0', '@bslt/server-system': 'workspace:*' },
  devDependencies: { vitest: '^5.0.0' },
};

const SYSTEM: Manifest = {
  name: '@bslt/server-system',
  dependencies: { '@simplewebauthn/server': '^14.0.0' },
};

function repo(
  allowlist: readonly AllowlistEntry[],
  packages: Readonly<Record<string, Manifest>> = {
    'main/apps/web': WEB,
    'main/server/system': SYSTEM,
  },
  rootManifest: Manifest = { name: '@bslt/root', devDependencies: { turbo: '^2.0.0' } },
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-deps-allowlist-'));
  roots.push(root);
  writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    "packages:\n  - 'main/apps/*'\n  - 'main/modules/*'\n  - 'main/server/*'\n",
  );
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(rootManifest));
  for (const [dir, manifest] of Object.entries(packages)) {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(manifest));
  }
  mkdirSync(path.dirname(path.join(root, ALLOWLIST_FILE)), { recursive: true });
  writeFileSync(path.join(root, ALLOWLIST_FILE), JSON.stringify(allowlist));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the deps-allowlist gate', () => {
  it('passes when every runtime dependency is listed for the package that declares it', () => {
    const root = repo([WEBAUTHN, REACT]);
    expect(auditDepsAllowlist(root, 5)).toEqual([]);
    expect(run(root, 5)).toEqual({
      ok: true,
      summary: '2 runtime dependencies in 3 manifests, all on the allowlist (phase 5)',
    });
  });

  it('ignores dev dependencies and workspace packages', () => {
    const root = repo([WEBAUTHN, REACT]);
    expect(auditDepsAllowlist(root, 5).join('\n')).not.toMatch(
      /vitest|turbo|@bslt\/server-system"/u,
    );
  });

  it.each(['dependencies', 'peerDependencies', 'optionalDependencies'] as const)(
    'fails on an addition under %s',
    (field) => {
      const root = repo([WEBAUTHN, REACT], {
        'main/apps/web': { ...WEB, [field]: { ...WEB[field], lodash: '^4.0.0' } },
        'main/server/system': SYSTEM,
      });
      const result = run(root, 5);
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual([
        `main/apps/web/package.json: @bslt/web declares "lodash" under ${field}, and it is not on the allowlist. ` +
          'No new runtime packages (plan section 13): own the code, or reach the service over HTTP behind an owned port.',
      ]);
    },
  );

  it('fails on an addition in the root manifest', () => {
    const root = repo([WEBAUTHN, REACT], undefined, {
      name: '@bslt/root',
      dependencies: { lodash: '^4.0.0' },
    });
    expect(auditDepsAllowlist(root, 5)).toEqual([
      expect.stringContaining('package.json: @bslt/root declares "lodash" under dependencies'),
    ]);
  });

  it('fails when a listed dependency spreads to another package', () => {
    const root = repo([WEBAUTHN, REACT], {
      'main/apps/web': {
        ...WEB,
        dependencies: { ...WEB.dependencies, '@simplewebauthn/server': '^14.0.0' },
      },
      'main/server/system': SYSTEM,
    });
    expect(auditDepsAllowlist(root, 5)).toEqual([
      'main/apps/web/package.json: @bslt/web declares "@simplewebauthn/server" under dependencies, and the allowlist has it only for @bslt/server-system. ' +
        'A dependency that is being removed does not spread.',
    ]);
  });

  it('fails on an entry whose removeBy phase is past, and not while that phase runs', () => {
    const root = repo([WEBAUTHN, REACT]);
    expect(auditDepsAllowlist(root, 19)).toEqual([]);
    expect(auditDepsAllowlist(root, 20)).toEqual([
      `${ALLOWLIST_FILE}: "@simplewebauthn/server" was to be removed by Phase 19 and the current phase is 20. ` +
        "Replacement: identity's verifier on @bslt/protocols/{cbor,cose}.",
    ]);
  });

  it('fails on an entry nothing declares any more, so the list only shrinks', () => {
    const root = repo([WEBAUTHN, REACT], {
      'main/apps/web': WEB,
      'main/server/system': { name: '@bslt/server-system' },
    });
    expect(auditDepsAllowlist(root, 5)).toEqual([
      `${ALLOWLIST_FILE}: "@simplewebauthn/server" is declared by no package: delete its entry.`,
    ]);
  });

  it('treats a scoped name that is not a workspace package as an addition', () => {
    const root = repo([REACT], { 'main/apps/web': WEB });
    expect(auditDepsAllowlist(root, 5)).toEqual([
      expect.stringContaining('@bslt/web declares "@bslt/server-system" under dependencies'),
    ]);
  });

  it('fails on a usedBy package that no longer declares the dependency', () => {
    const root = repo([{ ...WEBAUTHN, usedBy: ['@bslt/server-system', '@bslt/web'] }, REACT]);
    expect(auditDepsAllowlist(root, 5)).toEqual([
      `${ALLOWLIST_FILE}: "@simplewebauthn/server" lists @bslt/web in usedBy, which does not declare it: remove it from usedBy.`,
    ]);
  });

  it('allows permanent only for react and react-dom', () => {
    const root = repo([{ ...WEBAUTHN, removeBy: 'permanent' }, REACT]);
    expect(auditDepsAllowlist(root, 5)).toEqual([
      `${ALLOWLIST_FILE}: "@simplewebauthn/server" is marked permanent; only react and react-dom are (plan section 13).`,
    ]);
  });

  it('allows permanent dependencies in main/modules/* without per-module usedBy edits, while blocking non-permanent ones', () => {
    const allowedRoot = repo([WEBAUTHN, REACT], {
      'main/apps/web': WEB,
      'main/modules/tasks': {
        name: '@bslt/tasks',
        peerDependencies: { react: '^19.0.0' },
      },
      'main/server/system': SYSTEM,
    });
    expect(auditDepsAllowlist(allowedRoot, 8)).toEqual([]);

    const forbiddenRoot = repo([WEBAUTHN, REACT], {
      'main/apps/web': WEB,
      'main/modules/tasks': {
        name: '@bslt/tasks',
        dependencies: { '@simplewebauthn/server': '^14.0.0' },
      },
      'main/server/system': SYSTEM,
    });
    expect(auditDepsAllowlist(forbiddenRoot, 8)).toEqual([
      'main/modules/tasks/package.json: @bslt/tasks declares "@simplewebauthn/server" under dependencies, and the allowlist has it only for @bslt/server-system. ' +
        'A dependency that is being removed does not spread.',
    ]);
  });

  it('refuses an entry without its fields, and a name listed twice', () => {
    const broken = {
      name: '@simplewebauthn/server',
      usedBy: ['@bslt/server-system'],
    } as unknown as AllowlistEntry;
    expect(() => readAllowlist(repo([broken, REACT]))).toThrow(
      /"@simplewebauthn\/server".*replacement/u,
    );
    expect(() => readAllowlist(repo([WEBAUTHN, WEBAUTHN, REACT]))).toThrow(
      /"@simplewebauthn\/server" is listed twice/u,
    );
  });
});

describe('the committed allowlist', () => {
  const entries = readAllowlist(REPO_ROOT);
  const entry = (name: string): AllowlistEntry | undefined =>
    entries.find((candidate) => candidate.name === name);

  it('matches the package manifests today', () => {
    expect(auditDepsAllowlist(REPO_ROOT, CURRENT_PHASE)).toEqual([]);
  });

  it('is sorted by name', () => {
    const names = entries.map((candidate) => candidate.name);
    expect(names).toEqual([...names].sort());
  });

  it('marks react and react-dom permanent, and nothing else', () => {
    expect(
      entries.filter((candidate) => candidate.removeBy === 'permanent').map(({ name }) => name),
    ).toEqual(['react', 'react-dom']);
  });

  it('carries the removal phases of the plan', () => {
    // Restructure plan, section 13: wave A in Phase 12, wave B in 14 and 15, wave C in 19.
    expect(entry('ws')).toBeUndefined();
    expect(entry('ioredis')).toBeUndefined();
    expect(entry('web-push')).toBeUndefined();
    expect(entry('@aws-sdk/client-s3')).toBeUndefined();
    expect(entry('@aws-sdk/credential-providers')).toBeUndefined();
    expect(entry('@aws-sdk/s3-request-presigner')).toBeUndefined();
    expect(entry('sharp')).toBeUndefined();
    expect(entry('stripe')).toBeUndefined();
    expect(entry('@stripe/stripe-js')).toBeUndefined();
    expect(entry('@stripe/react-stripe-js')).toBeUndefined();
    expect(entry('fastify')).toBeUndefined();
    expect(entry('fastify-plugin')).toBeUndefined();
    expect(entry('@simplewebauthn/server')).toBeUndefined();
    expect(entry('postgres')).toBeUndefined();
    expect(entries.map(({ name }) => name)).toEqual(['react', 'react-dom']);
  });
});
