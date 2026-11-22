// main/tools/gates/registry.ts
/**
 * The gate registry (restructure plan, section 14.1).
 *
 * Every check the repository gates on is an entry here, and every audit script
 * exports the `run()` an entry calls. `bslt gate merge` runs the `merge` lane in
 * registry order; `bslt gate --self-test` runs every entry.
 *
 * `REPORTS` are the audit-directory scripts that generate output instead of
 * passing or failing (graphs, line counts, usage reports). They run by name
 * (`bslt report <id>`) and are not gates.
 */
import { run as apiClientSurfaces } from '../scripts/audit/api-client-surfaces';
import { run as bundleSize } from '../scripts/audit/bundle-size';
import { run as clientPublicSurfaces } from '../scripts/audit/client-public-surfaces';
import { run as testPairs } from '../scripts/audit/colocated-test-pairs';
import { run as declaredDependencies } from '../scripts/audit/declared-dependencies';
import { run as docsLinks } from '../scripts/audit/docs-links';
import { run as envExamples } from '../scripts/audit/env-examples';
import { run as esmDist } from '../scripts/audit/esm-dist';
import { run as gateCoverage } from '../scripts/audit/gate-coverage';
import { run as generatedArtifacts } from '../scripts/audit/generated-artifacts';
import { run as i18nCompleteness } from '../scripts/audit/i18n-completeness';
import { run as localEnvSecrets } from '../scripts/audit/local-env-secrets';
import { run as packageExports } from '../scripts/audit/package-exports';
import { run as routeContractCoverage } from '../scripts/audit/route-contract-coverage';
import { run as tempExceptions } from '../scripts/audit/temp-exceptions';
import { run as versionPins } from '../scripts/audit/version-pins';
import { run as viteBuildArgs } from '../scripts/audit/vite-build-args';
import { run as webFeatureSurfaces } from '../scripts/audit/web-feature-surfaces';
import { run as webPublicAssets } from '../scripts/audit/web-public-assets';
import { run as cssTokens } from '../scripts/lint/lint-css-tokens';
import { run as deadClasses } from '../scripts/lint/lint-dead-classes';
import { run as responsive } from '../scripts/lint/lint-responsive';
import { run as undefinedTokens } from '../scripts/lint/lint-undefined-tokens';
import { syncHeaders } from '../sync/sync-file-headers';
import { syncTsReferences } from '../sync/sync-ts-references';

import {
  prettierArgs,
  runPrettier,
  runRootScript,
  runTurbo,
  turboArgs,
  type TurboTask,
} from './commands';
import { run as depsAllowlist } from './deps-allowlist';
import { run as eventsGate } from './events';
import { run as moduleGraph } from './module-graph';
import { run as moduleShape } from './module-shape';
import { run as optionalModuleIsolation } from './optional-module-isolation';
import { RATCHETS, run as ratchet } from './ratchets/ratchets';
import { run as ssrPublicOnly } from './ssr-public-only';
import { run as tombstones } from './tombstones';

import type { CheckResult, Gate, GateContext, Lane } from './types';

/** Every merge gate also runs, narrowed, in the changed lane and in the nightly lane. */
const MERGE: readonly Lane[] = ['merge', 'changed', 'nightly'];

function gate(
  id: string,
  source: string,
  description: string,
  lanes: readonly Lane[],
  run: (ctx: GateContext) => CheckResult | Promise<CheckResult>,
  command?: (ctx: GateContext) => string | undefined,
): Gate {
  return {
    id,
    source,
    description,
    lanes,
    run: (ctx) => Promise.resolve(run(ctx)),
    ...(command === undefined ? {} : { command }),
  };
}

const turboCommand =
  (task: TurboTask) =>
  (ctx: GateContext): string =>
    `turbo ${turboArgs(task, ctx).join(' ')}`;

const prettierCommand = (ctx: GateContext): string | undefined => {
  const args = prettierArgs(ctx);
  return args === undefined ? undefined : `prettier ${args.join(' ')}`;
};

function hasFlag(ctx: GateContext, flag: string): boolean {
  return ctx.args?.includes(flag) === true;
}

const AUDIT = 'main/tools/scripts/audit';
const LINT = 'main/tools/scripts/lint';

export const GATES: readonly Gate[] = [
  gate(
    'headers',
    'main/tools/sync/sync-file-headers.ts',
    'path header on every source file',
    MERGE,
    () => syncHeaders({ check: true, quiet: true }),
  ),
  gate(
    'ts-references',
    'main/tools/sync/sync-ts-references.ts',
    'root tsconfig references every project',
    MERGE,
    () => syncTsReferences({ check: true }),
  ),
  gate(
    'client-surfaces',
    `${AUDIT}/client-public-surfaces.ts`,
    'client packages imported through public surfaces',
    MERGE,
    () => clientPublicSurfaces(),
  ),
  gate(
    'web-feature-surfaces',
    `${AUDIT}/web-feature-surfaces.ts`,
    'web feature public surfaces',
    MERGE,
    () => webFeatureSurfaces(),
  ),
  gate(
    'api-client-surfaces',
    `${AUDIT}/api-client-surfaces.ts`,
    'one browser REST transport',
    MERGE,
    () => apiClientSurfaces(),
  ),
  gate(
    'generated-artifacts',
    `${AUDIT}/generated-artifacts.ts`,
    'no build output tracked or beside sources',
    MERGE,
    () => generatedArtifacts(),
  ),
  gate('esm-dist', `${AUDIT}/esm-dist.ts`, 'built dist directories are valid ESM', MERGE, () =>
    esmDist(),
  ),
  gate(
    'package-exports',
    `${AUDIT}/package-exports.ts`,
    'workspace package exports resolve',
    MERGE,
    () => packageExports(),
  ),
  gate(
    'declared-dependencies',
    `${AUDIT}/declared-dependencies.ts`,
    'every import is declared by the importing package',
    MERGE,
    () => declaredDependencies(),
  ),
  gate(
    'deps-allowlist',
    'main/tools/gates/deps-allowlist.ts',
    'no new runtime dependency, and none past its removal phase',
    MERGE,
    (ctx) => depsAllowlist(ctx.root),
  ),
  gate(
    'env-examples',
    `${AUDIT}/env-examples.ts`,
    'env templates load through the runtime config',
    MERGE,
    () => envExamples(),
  ),
  gate(
    'version-pins',
    `${AUDIT}/version-pins.ts`,
    'Node and Postgres versions are the pins; actions are pinned by commit',
    MERGE,
    (ctx) => versionPins(ctx.root),
  ),
  gate(
    'vite-build-args',
    `${AUDIT}/vite-build-args.ts`,
    'the deployed web image gets its build args',
    MERGE,
    () => viteBuildArgs(),
  ),
  gate(
    'route-contract-coverage',
    `${AUDIT}/route-contract-coverage.ts`,
    'every non-exempt route has a contract and mutating routes have schemas',
    MERGE,
    (ctx) => routeContractCoverage({ failOnDrift: true, verbose: hasFlag(ctx, '--verbose') }),
  ),
  gate(
    'snapshot-api',
    'main/tools/snapshot/api.ts',
    'the API surface equals its committed snapshot',
    MERGE,
    // Loaded on demand: it composes the server.
    async () => (await import('../snapshot/api')).run(),
  ),
  gate(
    'snapshot-web-routes',
    'main/tools/snapshot/web-routes.ts',
    'the web route surface equals its committed snapshot',
    MERGE,
    // Loaded on demand: it loads the web app through Vite.
    async () => (await import('../snapshot/web-routes')).run(),
  ),
  gate(
    'generated-rows',
    'main/tools/sync/rows.ts',
    'the files generated from the database catalog are up to date, and nothing else is in their directories',
    MERGE,
    // Loaded on demand: it loads Prettier.
    async (ctx) => (await import('../sync/rows')).run({ root: ctx.root }),
  ),
  gate(
    'generated-modules',
    'main/tools/sync/modules.ts',
    'the module install lists, app dependencies, module graph and README blocks match bslt.config.ts',
    MERGE,
    async (ctx) => (await import('../sync/modules')).run({ root: ctx.root }),
  ),
  gate(
    'generated-icons',
    'main/tools/sync/icons.ts',
    'main/kernel/ui/src/icons.generated.ts matches main/kernel/ui/icons/*.svg',
    MERGE,
    async (ctx) => (await import('../sync/icons')).run({ root: ctx.root }),
  ),
  gate(
    'generated-stories',
    'main/tools/sync/stories.ts',
    'story-index.generated.ts covers every @bslt/ui component export with unique variant keys',
    MERGE,
    async (ctx) => (await import('../sync/stories')).run({ root: ctx.root }),
  ),
  gate(
    'generated-openapi',
    'main/tools/sync/openapi.ts',
    'docs/reference/openapi.json equals what bslt sync openapi generates',
    MERGE,
    // Loaded on demand: it composes the server.
    async (ctx) => (await import('../sync/openapi')).run({ root: ctx.root }),
  ),
  gate(
    'generated-csp',
    'main/tools/sync/csp.ts',
    'Caddy security headers and server CSP/Permissions-Policy constants match bslt sync csp',
    MERGE,
    async (ctx) => (await import('../sync/csp')).run({ root: ctx.root }),
  ),
  gate(
    'generated-docs',
    'main/tools/sync/docs.ts',
    'docs/reference/*.md and the DIRECTION.md status block match bslt sync docs, with no orphans',
    MERGE,
    async (ctx) => (await import('../sync/docs')).run({ root: ctx.root }),
  ),
  gate(
    'lockfile',
    'main/tools/sync/permissions.ts',
    'bslt.lock.json org permission bits are append-only, contiguous, and match declared module permissions',
    MERGE,
    async (ctx) => (await import('../sync/permissions')).run({ root: ctx.root }),
  ),
  gate(
    'module-shape',
    'main/tools/gates/module-shape.ts',
    'every package in main/modules/* conforms to canonical module shape, i18n, and RLS isolation rules',
    MERGE,
    (ctx) => moduleShape(ctx.root),
  ),
  gate(
    'module-graph',
    'main/tools/gates/module-graph.ts',
    'module dependency graph is acyclic, excludes projection targets, and aligns with FKs and bslt.config.ts',
    MERGE,
    (ctx) => moduleGraph(ctx.root),
  ),
  gate(
    'optional-module-isolation',
    'main/tools/gates/optional-module-isolation.ts',
    'Minimal Core and app composition roots never import optional modules outside src/generated/',
    MERGE,
    (ctx) => optionalModuleIsolation(ctx.root),
  ),
  gate(
    'events',
    'main/tools/gates/events.ts',
    'every declared EventDef has a server publish call and every webhook event appears in generated docs',
    MERGE,
    (ctx) => eventsGate(ctx.root),
  ),
  gate(
    'ssr-public-only',
    'main/tools/gates/ssr-public-only.ts',
    'AnonymousSdk calls only cache.public endpoints and logged-in routes are never server-rendered',
    MERGE,
    (ctx) => ssrPublicOnly(ctx.root),
  ),
  gate(
    'db-audit',
    'main/tools/catalog/audit.ts',
    'every database object is attributed, every table is classified and equals its class',
    MERGE,
    async (ctx) => (await import('../catalog/audit')).run({ root: ctx.root }),
  ),
  gate(
    'web-assets',
    `${AUDIT}/web-public-assets.ts`,
    'web manifest and icons are real assets',
    MERGE,
    () => webPublicAssets(),
  ),
  gate(
    'i18n',
    `${AUDIT}/i18n-completeness.ts`,
    'en-US translation maps are non-empty and every literal t() key resolves',
    MERGE,
    () => i18nCompleteness(),
  ),
  gate('docs-links', `${AUDIT}/docs-links.ts`, 'docs link only to paths that exist', MERGE, (ctx) =>
    docsLinks({ includeArchive: hasFlag(ctx, '--include-archive') }),
  ),
  gate('css-tokens', `${LINT}/lint-css-tokens.ts`, 'no hardcoded CSS values', MERGE, () =>
    cssTokens(),
  ),
  gate(
    'responsive',
    `${LINT}/lint-responsive.ts`,
    'breakpoints and responsive variants',
    MERGE,
    () => responsive(),
  ),
  gate(
    'dead-classes',
    `${LINT}/lint-dead-classes.ts`,
    'no new class that styles nothing',
    MERGE,
    (ctx) => deadClasses({ update: hasFlag(ctx, '--update') }),
  ),
  gate(
    'undefined-tokens',
    `${LINT}/lint-undefined-tokens.ts`,
    'no reference to an undefined token',
    MERGE,
    () => undefinedTokens(),
  ),
  gate(
    'gate-coverage',
    `${AUDIT}/gate-coverage.ts`,
    'the gates reach every test and package',
    MERGE,
    () => gateCoverage(),
  ),
  gate(
    'tombstones',
    'main/tools/gates/tombstones.ts',
    'deleted paths, scripts and symbols stay deleted',
    MERGE,
    () => tombstones(),
  ),
  // The ratchets (plan section 14.3): counts that may only go down.
  ...RATCHETS.map(({ id, noun }) =>
    gate(id, 'main/tools/gates/ratchets/ratchets.ts', `ratchet: ${noun}`, MERGE, (ctx) =>
      ratchet(id, ctx),
    ),
  ),
  gate(
    'format',
    'main/tools/gates/commands.ts',
    'Prettier formatting',
    MERGE,
    (ctx) => runPrettier(ctx),
    prettierCommand,
  ),
  gate(
    'test-pairs',
    `${AUDIT}/colocated-test-pairs.ts`,
    'colocated test pairs (strict)',
    MERGE,
    (ctx) => testPairs({ strict: true, update: hasFlag(ctx, '--update') }),
  ),
  gate(
    'lint',
    'main/tools/gates/commands.ts',
    'turbo lint over the package graph',
    MERGE,
    (ctx) => runTurbo('lint', ctx),
    turboCommand('lint'),
  ),
  gate(
    'type-check',
    'main/tools/gates/commands.ts',
    'turbo type-check over the package graph',
    MERGE,
    (ctx) => runTurbo('type-check', ctx),
    turboCommand('type-check'),
  ),
  gate(
    'test',
    'main/tools/gates/commands.ts',
    'turbo test over the package graph',
    MERGE,
    (ctx) => runTurbo('test', ctx),
    turboCommand('test'),
  ),

  // Nightly only.
  gate(
    'build',
    'main/tools/gates/commands.ts',
    'build every package (with postbuild ESM checks)',
    ['nightly'],
    (ctx) => (ctx.selfTest ? runTurbo('build', ctx) : runRootScript(ctx, 'build')),
    () => 'pnpm run build',
  ),

  // By name only (a CI job or a person runs them).
  gate(
    'db-catalog',
    'main/tools/catalog/command.ts',
    'the catalog computed from the migration sources equals the committed one (needs a database)',
    ['manual'],
    // Loaded on demand: it opens a Postgres client.
    async (ctx) => (await import('../catalog/command')).run({ selfTest: ctx.selfTest }),
  ),
  gate(
    'local-env-secrets',
    `${AUDIT}/local-env-secrets.ts`,
    'no secret values in ignored env files',
    ['manual'],
    () => localEnvSecrets(),
  ),
  gate(
    'temp-exceptions',
    `${AUDIT}/temp-exceptions.ts`,
    'no expired TEMP exception markers',
    ['manual'],
    () => tempExceptions(),
  ),
  gate(
    'bundle-size',
    `${AUDIT}/bundle-size.ts`,
    'web JS chunks within the gzipped budget',
    ['manual'],
    () => bundleSize(),
  ),
];

export interface Report {
  readonly id: string;
  readonly source: string;
  readonly description: string;
  /** Resolves to the process exit code. */
  run(args: readonly string[]): Promise<number>;
}

function report(
  id: string,
  source: string,
  description: string,
  load: () => Promise<(args: readonly string[]) => unknown>,
): Report {
  return {
    id,
    source: `${AUDIT}/${source}`,
    description,
    run: async (args) => {
      const result = await (await load())(args);
      return typeof result === 'number' ? result : 0;
    },
  };
}

/**
 * Loaded on demand: several import the server, Playwright or the TypeScript
 * compiler, which the gates do not need.
 */
export const REPORTS: readonly Report[] = [
  report(
    'graph-db',
    'graph-db.ts',
    'madge graphs of @bslt/db',
    async () => (await import('../scripts/audit/graph-db')).run,
  ),
  report(
    'graph-server',
    'graph-server.ts',
    'madge graphs of @bslt/server',
    async () => (await import('../scripts/audit/graph-server')).run,
  ),
  report(
    'graph-server-system',
    'graph-server-system.ts',
    'madge graphs of @bslt/server-system',
    async () => (await import('../scripts/audit/graph-server-system')).run,
  ),
  report(
    'graph-server-system-full',
    'graph-server-system-full.ts',
    'server-system cross-package dependency graph',
    async () => (await import('../scripts/audit/graph-server-system-full')).run,
  ),
  report(
    'line-count',
    'line-count.ts',
    'source lines per package',
    async () => (await import('../scripts/audit/line-count')).run,
  ),
  report(
    'route-manifest',
    'route-manifest.ts',
    'registered routes as JSON',
    async () => (await import('../scripts/audit/route-manifest')).run,
  ),
  report(
    'health-check',
    'health-check.ts',
    'turbo lint, type-check and test with a per-package report',
    async () => (await import('../scripts/audit/health-check')).run,
  ),
  report(
    'bundle-monitor',
    'bundle-monitor.ts',
    'estimated bundle sizes over time',
    async () => (await import('../scripts/audit/bundle-monitor')).run,
  ),
  report(
    'responsive-sweep',
    'responsive-sweep.ts',
    'browser sweep of the responsive contract (needs a running app)',
    async () => (await import('../scripts/audit/responsive-sweep')).run,
  ),
  report(
    'check-smtp-env',
    'check-smtp-env.ts',
    'print the SMTP settings the server loads',
    async () => (await import('../scripts/audit/check-smtp-env')).run,
  ),
];

/** Audit-directory files that are libraries for the scripts, not scripts. */
export const AUDIT_LIBRARIES: readonly string[] = [
  `${AUDIT}/file-utils.ts`,
  `${LINT}/walkFiles.ts`,
];

export function findGate(id: string): Gate | undefined {
  return GATES.find((candidate) => candidate.id === id);
}

export function findReport(id: string): Report | undefined {
  return REPORTS.find((candidate) => candidate.id === id);
}
