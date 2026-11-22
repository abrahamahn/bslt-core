// main/tools/gates/merge-parity.ts
/**
 * Parity record between the deleted `ci:merge-gate` script chain and the merge
 * lane of the gate registry (restructure plan, Phase 2: "reproduce ci:merge-gate
 * gate for gate, diff the check lists").
 *
 * `MERGE_GATE_CHAIN_AT_PHASE_2_START` is `ci:merge-gate` at `c4e5c00`, the start
 * of Phase 2, expanded through every `pnpm <script>` it called into the commands
 * it ran, in order. `merge-parity.test.ts` maps each command to the gate that
 * now runs the same check and requires the merge lane to equal that list with
 * exactly the changes in `PARITY_CHANGES`. A merge gate that disappears from the
 * lane without a recorded reason fails that test.
 */

/** The 16 packages `ci:merge-gate` named in each of its three turbo `--filter` lists. */
export const MERGE_GATE_FILTERED_PACKAGES = [
  '@bslt/shared',
  '@bslt/db',
  '@bslt/core',
  '@bslt/server-system',
  '@bslt/comms',
  '@bslt/storage',
  '@bslt/media',
  '@bslt/realtime',
  '@bslt/workers',
  '@bslt/server',
  '@bslt/web',
  '@bslt/api',
  '@bslt/client-engine',
  '@bslt/react',
  '@bslt/ui',
  '@bslt/tests',
] as const;

const FILTERS = MERGE_GATE_FILTERED_PACKAGES.map((name) => `--filter=${name}`).join(' ');

export const MERGE_GATE_CHAIN_AT_PHASE_2_START: readonly string[] = [
  'node --import tsx main/tools/sync/sync-file-headers.ts --check --quiet',
  'tsx main/tools/sync/sync-ts-references.ts --check',
  'node --import tsx main/tools/scripts/audit/profile-boundaries.ts',
  'node --import tsx main/tools/scripts/audit/starter-defaults.ts',
  'node --import tsx main/tools/scripts/audit/starter-docs.ts',
  'node --import tsx main/tools/scripts/audit/client-public-surfaces.ts',
  'node --import tsx main/tools/scripts/audit/web-feature-surfaces.ts',
  'node --import tsx main/tools/scripts/audit/api-client-surfaces.ts',
  'node --import tsx main/tools/scripts/audit/generated-artifacts.ts',
  'node --import tsx main/tools/scripts/audit/esm-dist.ts',
  'node --import tsx main/tools/scripts/audit/package-exports.ts',
  'node --import tsx main/tools/scripts/audit/env-examples.ts',
  'node --import tsx main/tools/scripts/audit/vite-build-args.ts',
  'node --conditions=source --import tsx main/tools/scripts/audit/route-contract-coverage.ts --fail-on-drift',
  'node --import tsx main/tools/scripts/audit/web-public-assets.ts',
  'node --import tsx main/tools/scripts/audit/i18n-completeness.ts',
  'node --import tsx main/tools/scripts/audit/csp-sync.ts',
  'node --import tsx main/tools/scripts/audit/docs-links.ts',
  'node --import tsx main/tools/scripts/lint/lint-css-tokens.ts',
  'node --import tsx main/tools/scripts/lint/lint-responsive.ts',
  'node --import tsx main/tools/scripts/lint/lint-dead-classes.ts',
  'node --import tsx main/tools/scripts/lint/lint-undefined-tokens.ts',
  'node --import tsx main/tools/scripts/audit/gate-coverage.ts',
  'tsc -p main/tools/tsconfig.json',
  'tsc -p main/profiles/tsconfig.json',
  'pnpm exec vitest run --config vitest.config.ts main/tools main/profiles --fileParallelism=false --reporter=dot',
  'prettier --config config/.prettierrc --no-cache --check .',
  'node --import tsx main/tools/scripts/audit/colocated-test-pairs.ts --strict',
  `pnpm exec turbo run lint --only --output-logs=errors-only --continue ${FILTERS}`,
  `pnpm exec turbo run type-check --only --output-logs=errors-only --continue ${FILTERS}`,
  `pnpm exec turbo run test --only --output-logs=errors-only --continue ${FILTERS} -- --coverage.enabled=false`,
];

/** Script file name (without `.ts`) to the gate that runs the same check. */
const SCRIPT_GATES: Readonly<Record<string, string>> = {
  'sync-file-headers': 'headers',
  'sync-ts-references': 'ts-references',
  'profile-boundaries': 'profile-boundaries',
  'starter-defaults': 'starter-defaults',
  'starter-docs': 'starter-docs',
  'client-public-surfaces': 'client-surfaces',
  'web-feature-surfaces': 'web-feature-surfaces',
  'api-client-surfaces': 'api-client-surfaces',
  'generated-artifacts': 'generated-artifacts',
  'esm-dist': 'esm-dist',
  'package-exports': 'package-exports',
  'env-examples': 'env-examples',
  'vite-build-args': 'vite-build-args',
  'route-contract-coverage': 'route-contract-coverage',
  'web-public-assets': 'web-assets',
  'i18n-completeness': 'i18n',
  'csp-sync': 'csp',
  'docs-links': 'docs-links',
  'lint-css-tokens': 'css-tokens',
  'lint-responsive': 'responsive',
  'lint-dead-classes': 'dead-classes',
  'lint-undefined-tokens': 'undefined-tokens',
  'gate-coverage': 'gate-coverage',
  'colocated-test-pairs': 'test-pairs',
};

/**
 * The checks a chain command ran, as gate ids. Commands that already call
 * `bslt` name their gates; for the others, the gate that runs the same check. Commands that checked
 * `main/tools` and `main/profiles` outside turbo map to the `@bslt/tools` turbo
 * task that checks them now.
 */
export function checksOfCommand(command: string): string[] {
  const named = /^bslt gate run ((?:[a-z0-9][a-z0-9-]* ?)+)/u.exec(command);
  if (named !== null) return (named[1] ?? '').trim().split(' ');
  if (/^bslt sync headers --check\b/u.test(command)) return ['headers'];
  if (/^bslt sync ts --check\b/u.test(command)) return ['ts-references'];
  return [checkOfCommand(command)];
}

function checkOfCommand(command: string): string {
  const turbo = /\bturbo run (lint|type-check|test)\b/u.exec(command);
  if (turbo !== null) return turbo[1] ?? '';
  if (/^prettier .*--check\b/u.test(command)) return 'format';
  if (/^tsc -p main\/(tools|profiles)\/tsconfig\.json$/u.test(command)) {
    return '@bslt/tools#type-check';
  }
  if (/vitest run .*main\/tools main\/profiles/u.test(command)) return '@bslt/tools#test';
  const script = /main\/tools\/(?:sync|scripts\/(?:audit|lint))\/([\w-]+)\.ts\b/u.exec(command);
  const gate = script === null ? undefined : SCRIPT_GATES[script[1] ?? ''];
  if (gate === undefined) throw new Error(`no gate known for chain command: ${command}`);
  return gate;
}

/** The differences between the old chain and the merge lane, each with its reason. */
export const PARITY_CHANGES = {
  /** Deleted with their scripts in Phases 2, 11 and 18 (plan sections 14.3 and 17.2). */
  removed: ['profile-boundaries', 'starter-defaults', 'starter-docs', 'csp'],
  /**
   * Workspace packages from `MERGE_GATE_FILTERED_PACKAGES` folded into vertical
   * modules or kernel runtimes (`@bslt/media` -> `@bslt/files` in Phase 14,
   * `@bslt/workers` -> kernel cron + module jobs in Phase 15, and `@bslt/shared`,
   * `@bslt/core`, `@bslt/api` deleted at Phase 20 coexistence closeout, plan sections 5.2, 8.4 and 17.2).
   */
  deletedPackages: ['@bslt/media', '@bslt/workers', '@bslt/shared', '@bslt/core', '@bslt/api'],
  /**
   * `main/tools` is the `@bslt/tools` package (and Phase 11 deleted `main/profiles`),
   * so the turbo type-check and test gates run what these commands ran.
   */
  folded: { '@bslt/tools#type-check': 'type-check', '@bslt/tools#test': 'test' },
  /**
   * New in the merge lane. `tombstones` was enforced only by `tombstones.test.ts`
   * inside `test:tools`; `declared-dependencies` is new (an undeclared `ws` in
   * `@bslt/realtime` crashed the server image with the realtime capability on);
   * `version-pins` is new in Phase 4 (plan section 14.3: Node and Postgres come
   * from `.node-version` and `infra/versions.env`, actions are pinned by commit);
   * the `snapshot-*` oracles are new in Phase 5 (plan section 14.3: an unintended
   * difference from the committed snapshot fails), and so are the six ratchets
   * (same section: counts that may only go down, budgets in
   * `main/tools/gates/ratchets/budgets.json`) and `deps-allowlist` (section 13:
   * no new runtime dependency, and none past the phase it leaves in). `db-audit`,
   * `generated-rows` and the `db-legacy-names` ratchet are new in Phase 6 (plan
   * sections 9.1, 9.5, 14.2 and 14.3): they read the committed database catalog,
   * so they need no database. `generated-rows` is the `generated` check for the
   * files `bslt sync rows` writes: stale files and orphans fail. `generated-openapi`
   * is new in Phase 12 (plan section 13, A6): the OpenAPI document the deleted
   * Swagger routes served is a committed file, checked like a snapshot.
   */
  added: [
    { id: 'tombstones', after: 'gate-coverage' },
    { id: 'declared-dependencies', after: 'package-exports' },
    { id: 'deps-allowlist', after: 'declared-dependencies' },
    { id: 'version-pins', after: 'env-examples' },
    { id: 'snapshot-api', after: 'route-contract-coverage' },
    { id: 'snapshot-web-routes', after: 'snapshot-api' },
    { id: 'generated-rows', after: 'snapshot-web-routes' },
    { id: 'generated-modules', after: 'generated-rows' },
    { id: 'generated-icons', after: 'generated-modules' },
    { id: 'generated-stories', after: 'generated-icons' },
    { id: 'generated-openapi', after: 'generated-stories' },
    { id: 'generated-csp', after: 'generated-openapi' },
    { id: 'generated-docs', after: 'generated-csp' },
    { id: 'lockfile', after: 'generated-docs' },
    { id: 'module-shape', after: 'lockfile' },
    { id: 'module-graph', after: 'module-shape' },
    { id: 'optional-module-isolation', after: 'module-graph' },
    { id: 'events', after: 'optional-module-isolation' },
    { id: 'ssr-public-only', after: 'events' },
    { id: 'db-audit', after: 'ssr-public-only' },
    { id: 'swallowed-catch', after: 'tombstones' },
    { id: 'raw-sql-outside-repos', after: 'swallowed-catch' },
    { id: 'setinterval', after: 'raw-sql-outside-repos' },
    { id: 'inline-style', after: 'setinterval' },
    { id: 'opaque-schema', after: 'inline-style' },
    { id: 'unused-exports', after: 'opaque-schema' },
  ],
} as const;

/** The merge lane the old chain implies once `PARITY_CHANGES` are applied. */
export function laneFromChain(chain: readonly string[]): string[] {
  const removed = new Set<string>(PARITY_CHANGES.removed);
  const folded = new Set(Object.keys(PARITY_CHANGES.folded));
  const lane = chain
    .flatMap((command) => checksOfCommand(command))
    .filter((id) => !removed.has(id) && !folded.has(id));
  for (const { id, after } of PARITY_CHANGES.added) {
    lane.splice(lane.indexOf(after) + 1, 0, id);
  }
  return lane;
}

/**
 * Expands a root script into the commands it runs, in order, following
 * `pnpm <script>`, `pnpm run <script>` and `pnpm -w run <script>` calls. Extra
 * arguments on a call are appended to the commands of the script it calls.
 */
export function expandScript(
  scripts: Readonly<Record<string, string>>,
  name: string,
  extra = '',
): string[] {
  const body = scripts[name];
  if (body === undefined) throw new Error(`no root script "${name}"`);
  return body.split(' && ').flatMap((part) => {
    const command = part.trim();
    const call = /^pnpm (?:-w )?(?:run )?([\w:.-]+)(.*)$/u.exec(command);
    const target = call?.[1];
    if (target !== undefined && scripts[target] !== undefined) {
      return expandScript(scripts, target, (call?.[2] ?? '').trim());
    }
    return [extra === '' ? command : `${command} ${extra}`];
  });
}
