// main/tools/gates/tombstones.ts
/**
 * Tombstones: deleted paths, root scripts and symbols that must not reappear.
 *
 * Append-only. Each restructure phase that deletes an old path adds it here in
 * the same change (restructure plan, section 14.3 and rule C2). `run()` is the
 * `tombstones` gate of the merge lane.
 *
 * Mentions in history documents are allowed: `ALLOWED_MENTION_PATHS` lists the
 * directories whose text may still name a tombstoned symbol.
 *
 * `TOMBSTONED_PATTERNS` bans a construct rather than a name: a regular
 * expression that must match no line of the tracked files a pathspec selects
 * (for example tsconfig `paths`, which Phase 3 replaced with package `exports`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../lib/paths';
import { gitEnvironment } from '../scripts/git-environment';

import { fail, pass, type CheckResult } from './types';

export interface TombstonedPath {
  /** Repository-relative file or directory. */
  readonly path: string;
  /** Restructure phase that deleted it. */
  readonly phase: number;
  /** Where it lives now, or why it is gone. */
  readonly note: string;
}

export interface TombstonedName {
  readonly name: string;
  readonly phase: number;
  readonly note: string;
}

export interface TombstonedPattern {
  readonly name: string;
  /** Git pathspecs (globs) of the files the pattern must not match. */
  readonly files: readonly string[];
  /**
   * Regular expression that must match no line: `git grep -E` syntax, kept to
   * the subset that means the same in JavaScript (no POSIX classes).
   */
  readonly pattern: string;
  readonly phase: number;
  readonly note: string;
}

const DISTRIBUTION = 'Extracted to bslt-distribution (frozen).';
const KANU = 'Moved to the Kanu repository, branch import/bslt-server-rust.';
const STARTER_AUDITS =
  'Deleted with the starter edition checks (plan section 14.3); the env parser moved to main/tools/lib/env-file.ts.';
const TOOLS_PACKAGE =
  'main/tools is the @bslt/tools package: turbo lints, type-checks and tests it.';
const GATE_REGISTRY =
  'Replaced by the gate registry: bslt gate merge (CI), bslt gate merge --changed (pre-push), bslt gate run <id>.';
const BSLT_CLI =
  'Root scripts are thin bslt calls (plan section 14.1): see `pnpm bslt --help` and docs/dev/workflow.md.';
const ENTRY_GUARDS =
  'Scripts run only through the gate registry and bslt subcommands, so they need no main-module guard.';
const BUILD_CONFIG =
  'Moved to @bslt/build-config (main/build-config): import it by package name (plan section 14.1).';
const ALIASES =
  'Module resolution goes through package.json `exports` (with the `source` condition) and `imports` (`#app/*`), never through aliases (plan section 17.2, Phase 3).';
const REPLACED_IN_PHASE_4 =
  'Deleted; CI is continuous-integration.yml until Phase 4 folds it into ci.yml.';
const ONE_CI =
  'Folded into .github/workflows/ci.yml, the one CI workflow (plan section 14.5): see docs/dev/workflow.md.';
const ONE_DEPLOY =
  'Folded into .github/workflows/deploy.yml, the one deploy workflow (plan section 14.5): see docs/deploy/README.md.';

const BUILD_APP =
  'The server is composed by buildApp() (main/apps/server/src/bootstrap/build-app.ts); main.ts, the tests and the tools all call it.';

const TESTING_KIT =
  'Test servers come from @bslt/testing (main/testing): buildTestApp is the production buildApp() on a test database, buildTestServer the production createServer() over mocks; describeRealDb gives a suite its database.';

const BASELINE_RESET =
  'The 0000..0926 chain was reset to one baseline per owner (plan section 9.3): main/server/db/sql (kernel) and main/server/db/legacy-migrations/<owner>, applied by the runner of @bslt/db (main/server/db/src/migrate).';

const ONE_RUNNER =
  'One runner and one entry point (plan section 9.3 item 7): `pnpm bslt db migrate` and the image entry main/server/db/src/migrate/entry.ts both call migrateDatabase of @bslt/db.';

const ONE_CATALOG =
  'One committed catalog and one command (plan section 9.1 items 3 and 4): `pnpm bslt db catalog` computes main/server/db/catalog.snapshot.json with every object attributed to its migration source (main/tools/catalog); `pnpm bslt db audit` reads that file, not the SQL text.';

const GENERATED_ROWS =
  'Row types, column maps, table names and the required-table list are generated from the database catalog (plan section 9.5): `pnpm bslt sync rows` writes main/server/db/src/generated and main/server/db/src/legacy-generated/<owner>.ts; main/server/db/src/schema states only what differs, over those.';

const ONE_TENANCY_MODEL =
  'One tenancy model (plan section 9.4): one flat public schema, every table classified and forced under row-level security. The schema-per-tenant toolkit and its DB_TENANCY_MODE switch are deleted; see docs/dev/tenancy.md.';

const SYS_HELPERS =
  'The kernel baseline names its helpers sys_* (plan section 9.4): sys_current_user_id, sys_current_org_id, sys_current_user_is_org_member, sys_current_user_is_platform_admin, sys_apply_rls; the role helper of orgs is orgs_current_user_role.';

const DEAD_TABLES =
  'The table was dropped in the baseline reset (plan section 9.3 item 3); nothing read or wrote it.';

const OWNED_TOTP_AND_ARGON2 =
  'Owned code replaced both (plan section 13, A3 and A4): TOTP is @bslt/protocols/totp (main/kernel/protocols), password hashing is node:crypto argon2 in main/server/core/src/auth/utils/password.ts.';

export const TOMBSTONED_PATHS: readonly TombstonedPath[] = [
  // Phase 1: distribution machinery (plan section 15.1).
  { path: 'main/editions', phase: 1, note: DISTRIBUTION },
  { path: 'main/extensions', phase: 1, note: DISTRIBUTION },
  { path: 'main/apps/storefront', phase: 1, note: DISTRIBUTION },
  { path: 'infra/storefront', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/features', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/setup', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/editions', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/recipes', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/profiles', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/prune.ts', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/prune.test.ts', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/prune-manifests.ts', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/prune-manifests-features.ts', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/prune-manifests-packages.ts', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/prune-proof.ts', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/smoke.ts', phase: 1, note: DISTRIBUTION },
  { path: 'main/tools/scripts/starter/smoke.test.ts', phase: 1, note: DISTRIBUTION },
  {
    path: 'main/tools/scripts/audit/manifest-sync.ts',
    phase: 1,
    note: 'Deleted with main/tools/setup, whose manifest it audited.',
  },
  {
    path: 'main/tools/scripts/audit/manifest-sync.test.ts',
    phase: 1,
    note: 'Deleted with main/tools/setup, whose manifest it audited.',
  },
  { path: '.github/workflows/editions.yml', phase: 1, note: DISTRIBUTION },
  { path: '.github/workflows/publish-core.yml', phase: 1, note: DISTRIBUTION },
  { path: '.github/workflows/storefront-deploy.yml', phase: 1, note: DISTRIBUTION },
  { path: '.github/workflows/template-readiness.yml', phase: 1, note: DISTRIBUTION },
  { path: '.github/workflows/auto-merge-claude-sessions.yml', phase: 1, note: REPLACED_IN_PHASE_4 },
  { path: '.github/workflows/pr-preview.yml', phase: 1, note: REPLACED_IN_PHASE_4 },
  { path: '.woodpecker', phase: 1, note: REPLACED_IN_PHASE_4 },
  { path: 'infra/ci/woodpecker', phase: 1, note: REPLACED_IN_PHASE_4 },
  { path: 'docs/architecture/core-and-extensions.md', phase: 1, note: DISTRIBUTION },
  { path: 'docs/architecture/installable-features.md', phase: 1, note: DISTRIBUTION },
  { path: 'docs/architecture/feature-installer-review.md', phase: 1, note: DISTRIBUTION },
  { path: 'docs/dev/prune.md', phase: 1, note: DISTRIBUTION },
  { path: 'docs/deploy/storefront.md', phase: 1, note: DISTRIBUTION },
  { path: 'docs/dev/setup.md', phase: 1, note: 'Documented the deleted setup wizard.' },
  { path: 'docs/recipes', phase: 1, note: 'Documented the deleted recipes tooling.' },

  // Phase 1: Rust handoff (plan section 15.2).
  { path: 'main/apps/server-rust', phase: 1, note: KANU },
  { path: 'main/apps/web/src/features/rust-access', phase: 1, note: KANU },
  { path: 'main/apps/web/tests/rust-access.e2e.spec.ts', phase: 1, note: KANU },
  { path: 'main/apps/web/rust.html', phase: 1, note: KANU },
  { path: 'main/apps/web/vite.rust.config.ts', phase: 1, note: KANU },
  { path: 'main/apps/web/playwright.rust.config.ts', phase: 1, note: KANU },
  { path: '.github/workflows/rust-backend.yml', phase: 1, note: KANU },
  {
    path: 'docs/dev/rust-backend.md',
    phase: 1,
    note: `${KANU} Pointer: docs/archive/server-rust.md.`,
  },

  // Phase 2: tools spine (plan section 14.3).
  {
    path: 'main/tools/scripts/audit/starter-defaults.ts',
    phase: 2,
    note: STARTER_AUDITS,
  },
  { path: 'main/tools/scripts/audit/starter-defaults.test.ts', phase: 2, note: STARTER_AUDITS },
  { path: 'main/tools/scripts/audit/starter-docs.ts', phase: 2, note: STARTER_AUDITS },
  { path: 'main/tools/scripts/audit/starter-docs.test.ts', phase: 2, note: STARTER_AUDITS },
  { path: 'main/tools/scripts/is-entry-module.ts', phase: 2, note: ENTRY_GUARDS },
  { path: 'main/tools/scripts/is-entry-module.test.ts', phase: 2, note: ENTRY_GUARDS },

  // Phase 3: alias collapse and @bslt/build-config (plan section 17.2).
  {
    path: 'main/tools/scripts/build/ensure-js-extensions.ts',
    phase: 3,
    note: `${BUILD_CONFIG} The fixer is the bslt-esm-fix bin.`,
  },
  {
    path: 'main/server/system/tsconfig.madge.json',
    phase: 3,
    note: 'It held only `paths`; the madge report reads the package tsconfig.json, which resolves @bslt/* through the source condition.',
  },
  {
    path: 'main/tools/scripts/audit/shared-vitest-aliases.ts',
    phase: 3,
    note: `${ALIASES} Vitest configs extend @bslt/build-config/vitest.`,
  },
  {
    path: 'vitest.config.ts',
    phase: 3,
    note: `The root Vitest base (a shim over vite-tsconfig-paths). ${BUILD_CONFIG}`,
  },
  // Phase 4: one CI, one deploy (plan section 14.5).
  { path: '.github/workflows/continuous-integration.yml', phase: 4, note: ONE_CI },
  { path: '.github/workflows/security-scanning.yml', phase: 4, note: ONE_CI },
  { path: '.github/workflows/dependency-audit.yml', phase: 4, note: ONE_CI },
  {
    path: '.github/workflows/infrastructure-test.yml',
    phase: 4,
    note: 'Its Terraform validation is the `infra` job of .github/workflows/ci.yml; a plan with credentials is the manual `terraform` job of deploy.yml.',
  },
  { path: '.github/workflows/application-deploy.yml', phase: 4, note: ONE_DEPLOY },
  { path: '.github/workflows/staging-deploy.yml', phase: 4, note: ONE_DEPLOY },
  { path: '.github/workflows/demo-deploy.yml', phase: 4, note: ONE_DEPLOY },
  {
    path: '.github/workflows/deployment-rollback.yml',
    phase: 4,
    note: 'A rollback is the `rollback_sha` input of .github/workflows/deploy.yml.',
  },
  {
    path: '.github/workflows/infrastructure-deploy.yml',
    phase: 4,
    note: 'Terraform plan and apply are the manual `terraform` input of .github/workflows/deploy.yml.',
  },
  {
    path: '.github/workflows/infrastructure-destroy.yml',
    phase: 4,
    note: 'Not replaced: .github/workflows/deploy.yml offers plan and apply only; run `terraform destroy` by hand.',
  },
  { path: '.github/workflows/web-deploy-cloudflare.yml', phase: 4, note: ONE_DEPLOY },
  {
    path: '.github/workflows/database-backup.yml',
    phase: 20,
    note: 'Replaced by in-network encrypted backups and PITR in infra/runtime/backup (owner decision D13).',
  },
  // Phase 5: one composition function (plan sections 14.4 and 17.2).
  { path: 'main/apps/server/src/bootstrap/system.ts', phase: 5, note: BUILD_APP },
  { path: 'main/apps/server/src/bootstrap/system.test.ts', phase: 5, note: BUILD_APP },
  // Phase 5: the testing kit (plan section 14.4).
  { path: 'tests/integration/api/test-utils.ts', phase: 5, note: TESTING_KIT },
  { path: 'tests/integration/api/index.ts', phase: 5, note: TESTING_KIT },
  { path: 'tests/integration/api/real-db-app.ts', phase: 5, note: TESTING_KIT },
  {
    path: 'tests/integration/api/real-db-app.test.ts',
    phase: 5,
    note: `${TESTING_KIT} The guard is tests/integration/api/real-db-suites.test.ts.`,
  },
  {
    path: 'tests/integration/api/db-harness.ts',
    phase: 5,
    note: `${TESTING_KIT} It is main/testing/src/database.ts (createTestDatabase), reached through describeRealDb.`,
  },
  {
    path: 'tests/integration/api/db-harness-provisioning.ts',
    phase: 5,
    note: `${TESTING_KIT} It is main/testing/src/provisioning.ts.`,
  },
  {
    path: 'tests/integration/api/db-harness-provisioning.test.ts',
    phase: 5,
    note: `${TESTING_KIT} It is main/testing/src/provisioning.test.ts.`,
  },
  {
    path: 'tests/integration/api/seed-helpers.ts',
    phase: 5,
    note: `${TESTING_KIT} It is main/testing/src/seed.ts.`,
  },
  // Phase 6: the baseline reset and the one migration runner.
  { path: 'main/server/db/migrations', phase: 6, note: BASELINE_RESET },
  { path: 'main/server/db/src/migrations.ts', phase: 6, note: ONE_RUNNER },
  { path: 'main/server/db/src/migrations.test.ts', phase: 6, note: ONE_RUNNER },
  { path: 'main/apps/server/src/migrate.ts', phase: 6, note: ONE_RUNNER },
  { path: 'main/apps/server/src/migrate.test.ts', phase: 6, note: ONE_RUNNER },
  { path: 'main/tools/scripts/db/push.ts', phase: 6, note: ONE_RUNNER },
  { path: 'main/tools/scripts/db/push.test.ts', phase: 6, note: ONE_RUNNER },
  { path: 'main/server/db/src/repositories/system/jobs.ts', phase: 6, note: DEAD_TABLES },
  { path: 'main/server/db/src/repositories/system/jobs.test.ts', phase: 6, note: DEAD_TABLES },
  { path: 'main/server/db/src/schema/tenant-settings.ts', phase: 6, note: DEAD_TABLES },
  { path: 'main/server/db/src/tenancy.ts', phase: 6, note: ONE_TENANCY_MODEL },
  { path: 'main/server/db/src/tenancy.test.ts', phase: 6, note: ONE_TENANCY_MODEL },
  {
    path: 'main/shared/src/modules/system/config/env.tenancy.ts',
    phase: 6,
    note: ONE_TENANCY_MODEL,
  },
  {
    path: 'main/shared/src/modules/system/config/env.tenancy.test.ts',
    phase: 6,
    note: ONE_TENANCY_MODEL,
  },
  { path: 'main/shared/src/constants/system/tenancy.ts', phase: 6, note: ONE_TENANCY_MODEL },
  {
    path: 'tests/integration/api/tenant-schema-isolation.real-db.test.ts',
    phase: 6,
    note: ONE_TENANCY_MODEL,
  },
  { path: 'main/tools/snapshot/db-catalog.ts', phase: 6, note: ONE_CATALOG },
  { path: 'main/tools/snapshot/db-catalog.test.ts', phase: 6, note: ONE_CATALOG },
  { path: 'main/tools/snapshots/db-catalog.json', phase: 6, note: ONE_CATALOG },
  { path: 'main/tools/scripts/audit/db-schema-audit.ts', phase: 6, note: ONE_CATALOG },
  { path: 'main/tools/scripts/audit/db-schema-audit.test.ts', phase: 6, note: ONE_CATALOG },
  // Phase 7: kernel mechanical move (plan section 17.2).
  {
    path: 'main/server/db',
    phase: 7,
    note: 'Moved to main/kernel/db (@bslt/db; plan section 17.2, Phase 7).',
  },
  {
    path: 'main/server/system',
    phase: 7,
    note: 'Moved to main/kernel/server (@bslt/server-system; plan section 17.2, Phase 7).',
  },
  {
    path: 'main/server/storage',
    phase: 7,
    note: 'Moved to main/kernel/storage (@bslt/storage; plan section 17.2, Phase 7).',
  },
  {
    path: 'main/server/comms',
    phase: 7,
    note: 'Moved to main/kernel/comms (@bslt/comms; plan section 17.2, Phase 7).',
  },
  {
    path: 'main/server/realtime',
    phase: 7,
    note: 'Moved to main/kernel/realtime (@bslt/realtime; plan section 17.2, Phase 7).',
  },
  {
    path: 'main/client/engine',
    phase: 7,
    note: 'Moved to main/kernel/client (@bslt/client-engine; plan section 17.2, Phase 7).',
  },
  {
    path: 'main/client/react',
    phase: 7,
    note: 'Moved to main/kernel/react (@bslt/react; plan section 17.2, Phase 7).',
  },
  {
    path: 'main/client/ui',
    phase: 7,
    note: 'Moved to main/kernel/ui (@bslt/ui; plan section 17.2, Phase 7).',
  },
  // Phase 8: contract layer, module host, one transport, tasks module (plan section 17.2).
  {
    path: 'main/shared/src/schema',
    phase: 8,
    note: 'Moved to main/kernel/schema (@bslt/schema; plan section 17.2, Phase 8).',
  },
  {
    path: 'main/server/core/src/tasks',
    phase: 8,
    note: 'Migrated to main/modules/tasks (@bslt/tasks; plan section 18.3, Phase 8).',
  },
  {
    path: 'main/shared/src/modules/core/tasks',
    phase: 8,
    note: 'Migrated to main/modules/tasks/contract/schemas.ts (plan section 18.3, Phase 8).',
  },
  {
    path: 'main/shared/src/contracts/contract.tasks.ts',
    phase: 8,
    note: 'Migrated to main/modules/tasks/contract/endpoints.ts (plan section 18.3, Phase 8).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/tasks',
    phase: 8,
    note: 'Migrated to main/modules/tasks/server/migrations/0001_tasks.sql (plan section 18.3, Phase 8).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/tasks.ts',
    phase: 8,
    note: 'Replaced by main/modules/tasks/server/generated/rows.ts via `bslt sync rows` (plan section 18.3, Phase 8).',
  },
  {
    path: 'main/kernel/db/src/repositories/tasks',
    phase: 8,
    note: 'Migrated to main/modules/tasks/server/repository.ts (plan section 18.3, Phase 8).',
  },
  {
    path: 'main/client/api/src/tasks',
    phase: 8,
    note: 'Deleted: client calls are inferred directly from @bslt/tasks/contract via createEndpointClient / useEndpoint (plan section 18.3, Phase 8).',
  },
  {
    path: 'main/client/api/src/generated',
    phase: 8,
    note: 'Deleted: generated API client stub replaced by contract-inferred @bslt/client-engine transport (plan section 17.2, Phase 8).',
  },
  {
    path: 'main/apps/web/src/features/tasks',
    phase: 8,
    note: 'Migrated to main/modules/tasks/web (plan section 18.3, Phase 8).',
  },
  {
    path: 'docs/api/tasks.md',
    phase: 8,
    note: 'Now in docs/reference/api.md (generated; plan section 18.3, Phase 8).',
  },
  {
    path: 'main/tools/scripts/audit/api-client-sync.ts',
    phase: 8,
    note: 'Deleted: the client is inferred from contracts and responses are validated in dev/test (plan section 14.3, Phase 8).',
  },
  {
    path: 'main/tools/scripts/audit/api-client-sync.test.ts',
    phase: 8,
    note: 'Deleted with api-client-sync.ts (plan section 14.3, Phase 8).',
  },
  {
    path: 'main/tools/scripts/audit/api-response-sync.ts',
    phase: 8,
    note: 'Deleted: responses are validated at runtime in dev/test by the module host (plan section 14.3, Phase 8).',
  },
  {
    path: 'main/tools/scripts/audit/api-response-sync.test.ts',
    phase: 8,
    note: 'Deleted with api-response-sync.ts (plan section 14.3, Phase 8).',
  },
  {
    path: 'main/tools/scripts/api',
    phase: 8,
    note: 'Deleted with the generated API client/hooks codegen (plan section 19, Phase 8).',
  },
  {
    path: 'main/tools/scripts/build/generate-api-client.ts',
    phase: 8,
    note: 'Deleted with main/client/api/src/generated (plan section 19, Phase 8).',
  },
  {
    path: 'main/tools/scripts/build/generate-api-client.test.ts',
    phase: 8,
    note: 'Deleted with generate-api-client.ts (plan section 19, Phase 8).',
  },
  {
    path: 'main/tools/scripts/starter/feature.ts',
    phase: 8,
    note: 'Replaced by main/tools/module/new.ts (`bslt module new <id>`; plan sections 15.1 and 17.2, Phase 8).',
  },
  {
    path: 'main/tools/scripts/starter/feature.test.ts',
    phase: 8,
    note: 'Replaced by main/tools/module/new.test.ts (plan sections 15.1 and 17.2, Phase 8).',
  },
  // Phase 9: web contributions seam (plan sections 11.1–11.2 and 17.2).
  {
    path: 'main/apps/web/src/app/starterSurface.ts',
    phase: 9,
    note: 'Deleted with edition/starter route-list split; routes compose through createWebApp (plan section 11.2, Phase 9).',
  },
  // Phase 10: one queue (`sys_jobs`), dead write/media queue & HTTP duplication deleted (plan sections 8.2 and 17.2).
  {
    path: 'main/kernel/db/src/queue/write-service.ts',
    phase: 10,
    note: 'Deleted: WriteService had zero production callers; mutations use k.db.tx + k.events.publish (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/queue/write-service.test.ts',
    phase: 10,
    note: 'Deleted with write-service.ts (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/queue/write-types.ts',
    phase: 10,
    note: 'Deleted with write-service.ts (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/queue/types/operation-types.ts',
    phase: 10,
    note: 'Deleted with write-service.ts (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/queue',
    phase: 10,
    note: 'Deleted: in-process CustomJobQueue replaced by the one Postgres-backed job queue (`sys_jobs`; plan sections 8.2 and 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/processor.ts',
    phase: 10,
    note: 'Deleted: unwired MediaProcessingOrchestrator replaced by `sys_jobs` workers (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/processor.test.ts',
    phase: 10,
    note: 'Deleted with processor.ts (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/database.ts',
    phase: 10,
    note: 'Deleted: unwired InMemoryMediaDatabase (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/database.test.ts',
    phase: 10,
    note: 'Deleted with database.ts (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/facade.ts',
    phase: 10,
    note: 'Deleted: unwired ServerMediaQueue facade (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/facade.test.ts',
    phase: 10,
    note: 'Deleted with facade.ts (plan section 17.2, Phase 10).',
  },
  {
    path: 'main/server/media/src/http',
    phase: 10,
    note: 'Deleted: unwired duplicate media HTTP surface; app media routes live in main/apps/server/src/http/media until files module migration (plan section 17.2, Phase 10).',
  },
  // Phase 10: cron scheduler moved into @bslt/server-system/cron; db-health-sampler moved into @bslt/server-system/observability (plan section 8.4).
  {
    path: 'main/apps/server/src/bootstrap/db-health-sampler.ts',
    phase: 10,
    note: 'Moved to main/kernel/server/src/observability/db-health-sampler.ts so setInterval lives only in kernel runtimes (plan section 8.4, Phase 10).',
  },
  {
    path: 'main/apps/server/src/bootstrap/db-health-sampler.test.ts',
    phase: 10,
    note: 'Moved with db-health-sampler.ts to main/kernel/server/src/observability (plan section 8.4, Phase 10).',
  },
  {
    path: 'main/server/workers/src/scheduler/cron-parser.ts',
    phase: 10,
    note: 'Moved to main/kernel/server/src/cron/cron-parser.ts (@bslt/server-system/cron; plan section 8.4, Phase 10).',
  },
  {
    path: 'main/server/workers/src/scheduler/cron-parser.test.ts',
    phase: 10,
    note: 'Moved with cron-parser.ts to main/kernel/server/src/cron (plan section 8.4, Phase 10).',
  },
  {
    path: 'main/server/workers/src/scheduler/scheduler.ts',
    phase: 10,
    note: 'Moved to main/kernel/server/src/cron/scheduler.ts (@bslt/server-system/cron; plan section 8.4, Phase 10).',
  },
  {
    path: 'main/server/workers/src/scheduler/scheduler.test.ts',
    phase: 10,
    note: 'Moved with scheduler.ts to main/kernel/server/src/cron (plan section 8.4, Phase 10).',
  },
  {
    path: 'main/server/workers/src/scheduler/types.ts',
    phase: 10,
    note: 'Moved to main/kernel/server/src/cron/types.ts (@bslt/server-system/cron; plan section 8.4, Phase 10).',
  },
  {
    path: 'main/server/workers/src/scheduler/start.ts',
    phase: 10,
    note: 'Deleted: cron ticks enqueue onto sys_jobs via createCronScheduler in @bslt/server-system/cron (plan section 8.4, Phase 10).',
  },
  // Phase 10: outbound webhooks migrated to main/modules/webhooks (@bslt/webhooks; plan section 18.7).
  {
    path: 'main/server/core/src/webhooks',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/server (@bslt/webhooks; plan section 18.7, Phase 10).',
  },
  {
    path: 'main/server/core/src/admin/webhookHandlers.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/server (@bslt/webhooks; plan section 18.7, Phase 10).',
  },
  {
    path: 'main/shared/src/contracts/contract.webhooks.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/contract/endpoints.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/shared/src/modules/comms/webhooks',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/contract/schemas.ts and server/target-policy.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/shared/src/modules/system/config/env.webhooks.ts',
    phase: 10,
    note: 'Migrated to webhooksModule.env in main/modules/webhooks (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/shared/src/modules/system/config/env.webhooks.test.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/module.test.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/webhooks',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/server/migrations/0001_webhooks.sql (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/webhooks.ts',
    phase: 10,
    note: 'Replaced by main/modules/webhooks/server/generated/rows.ts via `bslt sync rows` (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/repositories/system/webhooks.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/server/repository.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/repositories/system/webhooks.test.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/server/repository.test.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/repositories/system/webhook-deliveries.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/server/repository.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/kernel/db/src/repositories/system/webhook-deliveries.test.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/server/repository.test.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/client/api/src/webhooks',
    phase: 10,
    note: 'Deleted: client calls are inferred directly from @bslt/webhooks/contract via createEndpointClient / useEndpoint (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/kernel/react/src/webhooks',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/hooks.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/components/CreateWebhookDialog.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/CreateWebhookDialog.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/components/CreateWebhookDialog.css',
    phase: 10,
    note: 'Deleted with CreateWebhookDialog migration to @bslt/webhooks/web (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/components/WebhookDeliveryRow.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/WebhookDeliveryRow.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/components/WebhookStatusBadge.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/WebhookStatusBadge.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useWebhookAdmin.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/hooks.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useWebhookMonitor.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/hooks.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useWebhookMonitorDeliveries.ts',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/hooks.ts (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/WebhookDetailPage.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/WebhookDetailPage.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/WebhookDetailPage.test.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/WebhookDetailPage.test.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/WebhookListPage.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/WebhookListPage.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/WebhookListPage.test.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/WebhookListPage.test.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/WebhookMonitorPage.tsx',
    phase: 10,
    note: 'Migrated to main/modules/webhooks/web/WebhookMonitorPage.tsx (plan section 18.7, Phase 10).',
  },
  {
    path: 'docs/api/webhooks.md',
    phase: 10,
    note: 'Now in docs/reference/api.md (generated; plan section 18.7, Phase 10).',
  },
  // Phase 11: feature flags migrated to main/modules/flags (@bslt/flags; plan section 18.8).
  {
    path: 'main/server/core/src/feature-flags',
    phase: 11,
    note: 'Migrated to main/modules/flags/server (@bslt/flags; plan section 18.8, Phase 11).',
  },
  {
    path: 'main/shared/src/contracts/contract.feature.flags.ts',
    phase: 11,
    note: 'Migrated to main/modules/flags/contract/endpoints.ts (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/shared/src/modules/core/feature-flags',
    phase: 11,
    note: 'Migrated to main/modules/flags/contract/schemas.ts (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/flags',
    phase: 11,
    note: 'Migrated to main/modules/flags/server/migrations/0001_flags.sql (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/flags.ts',
    phase: 11,
    note: 'Replaced by main/modules/flags/server/generated/rows.ts via `bslt sync rows` (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/kernel/db/src/repositories/features',
    phase: 11,
    note: 'Migrated to main/modules/flags/server/repository.ts (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/kernel/db/src/schema/features.ts',
    phase: 11,
    note: 'Deleted with legacy feature_flags / tenant_feature_overrides tables (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/FeatureFlagsPage.tsx',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/FeatureFlagsPage.tsx (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/FeatureFlagsPage.css',
    phase: 11,
    note: 'Deleted with FeatureFlagsPage migration to @bslt/flags/web (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/FeatureFlagsPage.test.tsx',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/FeatureFlagsPage.test.tsx (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/components/FeatureFlagOverrideTable.tsx',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/FeatureFlagOverrideTable.tsx (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useFeatureFlag.ts',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/hooks.ts (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useFeatureFlag.test.ts',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/hooks.test.tsx (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useFeatureFlagOverrides.ts',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/hooks.ts (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useFeatureFlags.ts',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/hooks.ts (plan section 18.8, Phase 11).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useFeatureFlags.test.ts',
    phase: 11,
    note: 'Migrated to main/modules/flags/web/hooks.test.tsx (plan section 18.8, Phase 11).',
  },
  {
    path: 'docs/api/featureFlags.md',
    phase: 11,
    note: 'Now in docs/reference/api.md (generated; plan section 18.8, Phase 11).',
  },
  {
    path: 'tests/integration/api/feature-flags-files.integration.test.ts',
    phase: 11,
    note: 'Split: files mock guard tests live in tests/integration/api/files.integration.test.ts; flags are tested in main/modules/flags and feature-flags.real-db.test.ts (Phase 11).',
  },
  // Phase 11: runtime capability context & PROCESS_ROLE replace profiles and VITE_ENABLE_* (plan sections 10.1–10.3, 11.1 and 17.2).
  {
    path: 'main/profiles',
    phase: 11,
    note: 'Deleted: installed modules (bslt.config.ts), runtime flags (@bslt/flags), and PROCESS_ROLE replace build-time profiles (plan section 17.2, Phase 11).',
  },
  {
    path: 'main/apps/server/src/bootstrap/generated/profile.generated.ts',
    phase: 11,
    note: 'Deleted with main/profiles; server subsystems start by PROCESS_ROLE (plan section 17.2, Phase 11).',
  },
  {
    path: 'main/apps/server/src/bootstrap/generated/profile.generated.test.ts',
    phase: 11,
    note: 'Deleted with main/profiles (plan section 17.2, Phase 11).',
  },
  {
    path: 'main/apps/web/src/bootstrap/generated/profile.generated.ts',
    phase: 11,
    note: 'Deleted with main/profiles; SPA reads CapabilityProvider from GET /api/platform/context (plan section 17.2, Phase 11).',
  },
  {
    path: 'main/apps/web/src/bootstrap/generated/profile.generated.test.ts',
    phase: 11,
    note: 'Deleted with main/profiles (plan section 17.2, Phase 11).',
  },
  {
    path: 'main/apps/server/src/bootstrap/optional-import.ts',
    phase: 11,
    note: 'Deleted: server packages are imported statically and started by PROCESS_ROLE (plan section 17.2, Phase 11).',
  },
  {
    path: 'main/apps/server/src/bootstrap/optional-capability-packaging.test.ts',
    phase: 11,
    note: 'Deleted with optional-import.ts and ship-capability.sh (plan section 17.2, Phase 11).',
  },
  {
    path: 'infra/docker/ship-capability.sh',
    phase: 11,
    note: 'Deleted: one server image ships all compiled packages and boots by PROCESS_ROLE (plan section 17.2, Phase 11).',
  },
  {
    path: 'main/apps/web/src/app/capabilities.ts',
    phase: 11,
    note: 'Replaced by CapabilityProvider / useCapabilities in @bslt/web-platform (plan section 11.1, Phase 11).',
  },
  {
    path: 'main/tools/scripts/audit/profile-boundaries.ts',
    phase: 11,
    note: 'Deleted with main/profiles; module boundaries are enforced by module-graph and ESLint boundaries (plan section 17.2, Phase 11).',
  },
  // Phase 12, A5: Sentry replaced by the owned error reporter (plan section 13).
  {
    path: 'main/kernel/server/src/observability/sentry.provider.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/kernel/server/src/observability/sentry.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/kernel/server/src/observability/factory.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/kernel/server/src/observability/factory.test.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/kernel/server/src/observability/console.provider.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/kernel/server/src/observability/noop.provider.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/shared/src/modules/system/observability/types.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/apps/web/src/lib/sentry.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    path: 'main/apps/web/src/lib/sentry.test.ts',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  // Phase 13: Wave A module migrations — support (plan section 17.2).
  {
    path: 'main/server/core/src/support',
    phase: 13,
    note: 'Migrated to main/modules/support/server (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/contracts/contract.support.ts',
    phase: 13,
    note: 'Migrated to main/modules/support/contract/endpoints.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/modules/core/support',
    phase: 13,
    note: 'Migrated to main/modules/support/contract (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/support',
    phase: 13,
    note: 'Migrated to main/modules/support/server/migrations/0001_support.sql (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/support.ts',
    phase: 13,
    note: 'Replaced by main/modules/support/server/generated/rows.ts via `bslt sync rows` (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/src/schema/support.ts',
    phase: 13,
    note: 'Replaced by main/modules/support/server/generated/rows.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/src/repositories/support',
    phase: 13,
    note: 'Migrated to main/modules/support/server/repository.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/client/api/src/support',
    phase: 13,
    note: 'Deleted: client calls are inferred from @bslt/support/contract via useEndpoint / useMutationEndpoint (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/apps/web/src/features/support',
    phase: 13,
    note: 'Migrated to main/modules/support/web (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/SupportInboxPage.tsx',
    phase: 13,
    note: 'Migrated to main/modules/support/web/SupportInboxPage.tsx (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/SupportInboxPage.test.tsx',
    phase: 13,
    note: 'Migrated to main/modules/support/web/SupportInboxPage.test.tsx (plan section 17.2, Phase 13).',
  },
  {
    path: 'docs/api/support.md',
    phase: 13,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 13).',
  },
  // Phase 13: Wave A module migrations — status (plan section 17.2).
  {
    path: 'main/server/core/src/status',
    phase: 13,
    note: 'Migrated to main/modules/status/server (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/contracts/contract.status.ts',
    phase: 13,
    note: 'Migrated to main/modules/status/contract/endpoints.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/contracts/contract.status.test.ts',
    phase: 13,
    note: 'Migrated to main/modules/status/contract/schemas.test.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/client/api/src/status',
    phase: 13,
    note: 'Deleted: client calls are inferred from @bslt/status/contract via useEndpoint (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/apps/web/src/features/status',
    phase: 13,
    note: 'Migrated to main/modules/status/web (plan section 17.2, Phase 13).',
  },
  {
    path: 'docs/api/status.md',
    phase: 13,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 13).',
  },
  // Phase 13: Wave A module migrations — search (plan section 17.2).
  {
    path: 'main/server/core/src/search',
    phase: 13,
    note: 'Migrated to main/modules/search/server (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/contracts/contract.search.ts',
    phase: 13,
    note: 'Migrated to main/modules/search/contract/endpoints.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/contracts/contract.search.test.ts',
    phase: 13,
    note: 'Migrated to main/modules/search/contract/schemas.test.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/client/api/src/search',
    phase: 13,
    note: 'Deleted: client calls are inferred from @bslt/search/contract via useEndpoint (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/apps/web/src/features/search',
    phase: 13,
    note: 'Migrated to main/modules/search/web (plan section 17.2, Phase 13).',
  },
  {
    path: 'docs/api/search.md',
    phase: 13,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 13).',
  },
  // Phase 13: Wave A module migrations — analytics (plan section 17.2).
  {
    path: 'main/server/core/src/analytics',
    phase: 13,
    note: 'Migrated to main/modules/analytics/server (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/contracts/contract.analytics.ts',
    phase: 13,
    note: 'Migrated to main/modules/analytics/contract/endpoints.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/modules/core/analytics',
    phase: 13,
    note: 'Migrated to main/modules/analytics/{contract,server} (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/shared/src/modules/system/config/env.analytics.ts',
    phase: 13,
    note: 'Replaced by analyticsEnvSchema on analyticsModule.env in @bslt/analytics (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/analytics',
    phase: 13,
    note: 'Migrated to main/modules/analytics/server/migrations/0001_analytics.sql (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/analytics.ts',
    phase: 13,
    note: 'Replaced by main/modules/analytics/server/generated/rows.ts via `bslt sync rows` (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/src/schema/events.ts',
    phase: 13,
    note: 'Replaced by main/modules/analytics/server/generated/rows.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/kernel/db/src/repositories/analytics',
    phase: 13,
    note: 'Migrated to main/modules/analytics/server/repository.ts (plan section 17.2, Phase 13).',
  },
  {
    path: 'main/client/api/src/analytics',
    phase: 13,
    note: 'Deleted: client calls are inferred from @bslt/analytics/contract via createEndpointClient / useMutationEndpoint (plan section 17.2, Phase 13).',
  },
  {
    path: 'docs/api/analytics.md',
    phase: 13,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 13).',
  },
  // Phase 14: Wave B module migrations — audit, security events, and activities (plan section 17.2).
  {
    path: 'main/server/core/src/audit',
    phase: 14,
    note: 'Migrated to main/modules/audit/server (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/server/core/src/activities',
    phase: 14,
    note: 'Migrated to main/modules/audit/server (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/server/core/src/admin/auditHandlers.ts',
    phase: 14,
    note: 'Migrated to main/modules/audit/server (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/server/core/src/admin/securityHandlers.ts',
    phase: 14,
    note: 'Migrated to main/modules/audit/server (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/server/core/src/admin/securityService.ts',
    phase: 14,
    note: 'Migrated to main/modules/audit/server/service.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/contracts/contract.activities.ts',
    phase: 14,
    note: 'Migrated to main/modules/audit/contract/endpoints.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/modules/core/activities',
    phase: 14,
    note: 'Migrated to main/modules/audit/contract (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/modules/core/audit-log',
    phase: 14,
    note: 'Migrated to main/modules/audit/contract (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/modules/core/admin/admin.security.schemas.ts',
    phase: 14,
    note: 'Migrated to main/modules/audit/contract/schemas.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/constants/system/audit.ts',
    phase: 14,
    note: 'Migrated to main/modules/audit/contract/schemas.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/audit',
    phase: 14,
    note: 'Migrated to main/modules/audit/server/migrations/0001_audit.sql (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/audit.ts',
    phase: 14,
    note: 'Replaced by main/modules/audit/server/generated/rows.ts via `bslt sync rows` (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/schema/activities.ts',
    phase: 14,
    note: 'Replaced by main/modules/audit/server/generated/rows.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/repositories/activities',
    phase: 14,
    note: 'Migrated to main/modules/audit/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/repositories/system/audit-events.ts',
    phase: 14,
    note: 'Migrated to main/modules/audit/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/repositories/auth/security-events.ts',
    phase: 14,
    note: 'Merged into audit_log in main/modules/audit/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/client/api/src/activities',
    phase: 14,
    note: 'Deleted: client calls are inferred from @bslt/audit/contract via createEndpointClient / useEndpoint (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/activities',
    phase: 14,
    note: 'Migrated to main/modules/audit/web (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/AuditEventsPage.tsx',
    phase: 14,
    note: 'Migrated to main/modules/audit/web/AuditEventsPage.tsx (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/SecurityEventsPage.tsx',
    phase: 14,
    note: 'Migrated to main/modules/audit/web/SecurityEventsPage.tsx (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/SecurityEventDetailPage.tsx',
    phase: 14,
    note: 'Migrated to main/modules/audit/web/SecurityEventDetailPage.tsx (plan section 17.2, Phase 14).',
  },
  {
    path: 'docs/api/activities.md',
    phase: 14,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 14).',
  },
  // Phase 14 (14.3b): realtime permissions replaced by ChannelRegistry + server-signed grants.
  {
    path: 'main/kernel/realtime/src/permissions',
    phase: 14,
    note: 'Deleted: client-reported permission maps replaced by server-side ChannelRegistry and HMAC-signed channel grants (plan section 8.6, Phase 14).',
  },
  {
    path: 'tests/integration/api/realtime-permissions.integration.test.ts',
    phase: 14,
    note: 'Deleted with main/kernel/realtime/src/permissions; ChannelRegistry tests live in main/kernel/realtime/src/channels.test.ts (plan section 8.6, Phase 14).',
  },
  // Phase 14 (14.3c): notifications projection module (@bslt/notifications).
  {
    path: 'main/server/core/src/notifications',
    phase: 14,
    note: 'Migrated to main/modules/notifications/server (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/contracts/contract.notifications.ts',
    phase: 14,
    note: 'Migrated to main/modules/notifications/contract/endpoints.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/notifications',
    phase: 14,
    note: 'Migrated to main/modules/notifications/server/migrations/0001_notifications.sql (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/notifications.ts',
    phase: 14,
    note: 'Replaced by main/modules/notifications/server/generated/rows.ts via `bslt sync rows` (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/schema/notifications.ts',
    phase: 14,
    note: 'Replaced by main/modules/notifications/server/generated/rows.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/schema/push.ts',
    phase: 14,
    note: 'Replaced by main/modules/notifications/server/generated/rows.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/repositories/notifications',
    phase: 14,
    note: 'Migrated to main/modules/notifications/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/repositories/push',
    phase: 14,
    note: 'Migrated to main/modules/notifications/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/client/api/src/notifications',
    phase: 14,
    note: 'Deleted: client calls are inferred from @bslt/notifications/contract via createEndpointClient / useEndpoint (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/notifications',
    phase: 14,
    note: 'Migrated to main/modules/notifications/web (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/NotificationSenderPage.tsx',
    phase: 14,
    note: 'Migrated to main/modules/notifications/web/NotificationSenderPage.tsx (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/settings/components/NotificationPreferencesForm.tsx',
    phase: 14,
    note: 'Migrated to main/modules/notifications/web/NotificationPreferencesForm.tsx (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/modules/db/pubsub/authorize.ts',
    phase: 14,
    note: 'Deleted: realtime channel keys are owned by @bslt/notifications and authorized via ChannelRegistry in @bslt/realtime (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/shared/src/modules/db/pubsub/authorize.test.ts',
    phase: 14,
    note: 'Deleted with main/shared/src/modules/db/pubsub/authorize.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'docs/api/notifications.md',
    phase: 14,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 14).',
  },
  // Phase 14 (14.4a): @aws-sdk/* replaced by @bslt/protocols/s3.
  {
    path: 'main/kernel/storage/src/providers/s3.client.wrapper.ts',
    phase: 14,
    note: 'Replaced by owned @bslt/protocols/s3 in main/kernel/storage/src/providers/s3.ts (plan section 13 B4, Phase 14).',
  },
  {
    path: 'main/kernel/storage/src/providers/presigner.ts',
    phase: 14,
    note: 'Dead SHA-512 helper; local storage signing lives in main/kernel/storage/src/signing.ts and S3 presigning in @bslt/protocols/s3 (Phase 14).',
  },
  // Phase 14 (14.4b): @bslt/files module + ffmpeg replacing sharp and legacy upload/media/avatar surfaces.
  {
    path: 'main/server/core/src/files',
    phase: 14,
    note: 'Migrated to main/modules/files (@bslt/files; plan sections 5.2 and 17.2, Phase 14).',
  },
  {
    path: 'main/server/media',
    phase: 14,
    note: 'Replaced by ffmpeg/ffprobe media pipeline in main/modules/files/server/media.ts (plan sections 5.2, 13 B5, and 17.2, Phase 14).',
  },
  {
    path: 'main/apps/server/src/http/media',
    phase: 14,
    note: 'Migrated to /api/media/* contracts in main/modules/files (plan section 17.2 and owner decision D2, Phase 14).',
  },
  {
    path: 'main/server/core/src/users/handlers/avatar.ts',
    phase: 14,
    note: 'Migrated to files_avatars and /api/files/avatar* in main/modules/files (plan sections 5.2 and D9, Phase 14).',
  },
  {
    path: 'main/shared/src/contracts/contract.files.ts',
    phase: 14,
    note: 'Migrated to main/modules/files/contract (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/files',
    phase: 14,
    note: 'Migrated to main/modules/files/server/migrations/0001_files.sql (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/schema/files.ts',
    phase: 14,
    note: 'Migrated to main/modules/files/server/generated/rows.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/db/src/repositories/files',
    phase: 14,
    note: 'Migrated to main/modules/files/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/files',
    phase: 14,
    note: 'Migrated to main/modules/files/web (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/media',
    phase: 14,
    note: 'Deleted per owner decision D2; /api/media/* is owned by main/modules/files (plan section 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/settings/components/AvatarUpload.tsx',
    phase: 14,
    note: 'Migrated to main/modules/files/web/AvatarUpload.tsx (plan sections 5.2 and 17.2, Phase 14).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useAvatarUpload.ts',
    phase: 14,
    note: 'Migrated to main/modules/files/web/hooks.ts (plan sections 5.2 and 17.2, Phase 14).',
  },
  {
    path: 'main/kernel/ui/src/components/media',
    phase: 14,
    note: 'Unused MediaGallery deleted from @bslt/ui (plan section 17.2, Phase 14).',
  },
  {
    path: 'docs/api/files.md',
    phase: 14,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 14).',
  },
  // Phase 15 (15.1a): @bslt/workers deleted; scheduled retention and cron run via createCronScheduler & module crons.
  {
    path: 'main/server/workers',
    phase: 15,
    note: 'Deleted: scheduled tasks and retention run on leader-elected createCronScheduler and module cron jobs (plan sections 4 and 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/modules/workers',
    phase: 15,
    note: 'Deleted with @bslt/workers (plan section 17.2, Phase 15).',
  },
  // Phase 15 (15.1b): @bslt/compliance module migration.
  {
    path: 'main/server/core/src/compliance',
    phase: 15,
    note: 'Migrated to main/modules/compliance (@bslt/compliance; plan section 17.2, Phase 15).',
  },
  {
    path: 'main/server/core/src/consent',
    phase: 15,
    note: 'Migrated to main/modules/compliance (@bslt/compliance; plan section 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/modules/core/compliance',
    phase: 15,
    note: 'Migrated to main/modules/compliance/contract (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/contracts/contract.compliance.ts',
    phase: 15,
    note: 'Migrated to main/modules/compliance/contract/endpoints.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/compliance',
    phase: 15,
    note: 'Migrated to main/modules/compliance/server/migrations (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/schema/compliance.ts',
    phase: 15,
    note: 'Replaced by main/modules/compliance/server/generated/rows.ts via `bslt sync rows` (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/repositories/compliance',
    phase: 15,
    note: 'Migrated to main/modules/compliance/server/repository.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/client/api/src/legal',
    phase: 15,
    note: 'Replaced by inferred contract client in @bslt/compliance/web (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/react/src/legal',
    phase: 15,
    note: 'Migrated to main/modules/compliance/web/hooks.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/content',
    phase: 15,
    note: 'Migrated to main/modules/compliance/web (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/pages/LegalDocumentPage.tsx',
    phase: 15,
    note: 'Migrated to main/modules/compliance/web/LegalDocumentPage.tsx (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/LegalDocumentsPage.tsx',
    phase: 15,
    note: 'Migrated to main/modules/compliance/web/LegalDocumentsPage.tsx (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useConsent.ts',
    phase: 15,
    note: 'Migrated to main/modules/compliance/web/hooks.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useDataExport.ts',
    phase: 15,
    note: 'Migrated to main/modules/compliance/web/hooks.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'docs/legal',
    phase: 15,
    note: 'Moved to main/modules/compliance/seeds/legal (plan section 17.2, Phase 15).',
  },
  {
    path: 'docs/api/compliance.md',
    phase: 15,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 15).',
  },
  // Phase 15: organizations, memberships, custom roles, and invitations migrated to main/modules/orgs (@bslt/orgs).
  {
    path: 'main/server/core/src/tenants',
    phase: 15,
    note: 'Migrated to main/modules/orgs/server (@bslt/orgs; plan section 18.2, Phase 15).',
  },
  {
    path: 'main/server/core/src/admin/tenantHandlers.ts',
    phase: 15,
    note: 'Migrated to main/modules/orgs/server (@bslt/orgs; plan section 18.2, Phase 15).',
  },
  {
    path: 'main/server/core/src/admin/tenantService.ts',
    phase: 15,
    note: 'Migrated to main/modules/orgs/server/service.ts (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/server/core/src/auth/personal-tenant.ts',
    phase: 15,
    note: 'Migrated to ensurePersonalOrg + identity.user.registered subscriber in main/modules/orgs/server (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/orgs',
    phase: 15,
    note: 'Migrated to main/modules/orgs/server/migrations/0001_orgs.sql (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/orgs.ts',
    phase: 15,
    note: 'Replaced by main/modules/orgs/server/generated/rows.ts via `bslt sync rows` (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/schema/tenant.ts',
    phase: 15,
    note: 'Replaced by main/modules/orgs/server/generated/rows.ts via `bslt sync rows` (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/repositories/tenant',
    phase: 15,
    note: 'Migrated to main/modules/orgs/server/repository.ts (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/shared/src/contracts/contract.tenants.ts',
    phase: 15,
    note: 'Migrated to main/modules/orgs/contract/endpoints.ts (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/shared/src/modules/core/tenant',
    phase: 15,
    note: 'Migrated to main/modules/orgs/contract (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/client/api/src/workspace',
    phase: 15,
    note: 'Replaced by inferred contract client in @bslt/orgs/web (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/organization',
    phase: 15,
    note: 'Migrated to main/modules/orgs/web (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/TenantListPage.tsx',
    phase: 15,
    note: 'Migrated to main/modules/orgs/web/TenantListPage.tsx (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/TenantDetailPage.tsx',
    phase: 15,
    note: 'Migrated to main/modules/orgs/web/TenantDetailPage.tsx (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useTenant.ts',
    phase: 15,
    note: 'Migrated to main/modules/orgs/web/hooks.ts (plan section 18.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useTenants.ts',
    phase: 15,
    note: 'Migrated to main/modules/orgs/web/hooks.ts (plan section 18.2, Phase 15).',
  },
  {
    path: 'docs/api/tenants.md',
    phase: 15,
    note: 'Now in docs/reference/api.md (generated; plan section 18.2, Phase 15).',
  },
  // Phase 15 (15.4c): @bslt/billing module migration, webhook special-case removal, and edition-ports deletion.
  {
    path: 'main/server/core/src/billing',
    phase: 15,
    note: 'Migrated to main/modules/billing/server (@bslt/billing; plan section 17.2, Phase 15).',
  },
  {
    path: 'main/server/core/src/admin/billingHandlers.ts',
    phase: 15,
    note: 'Migrated to main/modules/billing/server (@bslt/billing; plan section 17.2, Phase 15).',
  },
  {
    path: 'main/server/core/src/admin/billingService.ts',
    phase: 15,
    note: 'Migrated to main/modules/billing/server/service.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/contracts/contract.billing.ts',
    phase: 15,
    note: 'Migrated to main/modules/billing/contract/endpoints.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/contracts/edition-ports.ts',
    phase: 15,
    note: 'Deleted: BillingNotifier replaced by notify metadata on @bslt/billing events (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/modules/core/billing',
    phase: 15,
    note: 'Migrated to main/modules/billing/contract (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/modules/core/usage-metering',
    phase: 15,
    note: 'Migrated to main/modules/billing/contract and server/metering.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/shared/src/constants/core/billing.ts',
    phase: 15,
    note: 'Migrated to main/modules/billing/contract/schemas.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/legacy-migrations/billing',
    phase: 15,
    note: 'Migrated to main/modules/billing/server/migrations/0001_billing.sql (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated/billing.ts',
    phase: 15,
    note: 'Replaced by main/modules/billing/server/generated/rows.ts via `bslt sync rows` (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/schema/billing.ts',
    phase: 15,
    note: 'Replaced by main/modules/billing/server/generated/rows.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/schema/metering.ts',
    phase: 15,
    note: 'Replaced by main/modules/billing/server/generated/rows.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/repositories/billing',
    phase: 15,
    note: 'Migrated to main/modules/billing/server/repository.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/db/src/repositories/metering',
    phase: 15,
    note: 'Migrated to main/modules/billing/server/repository.ts and metering.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/client/api/src/billing',
    phase: 15,
    note: 'Replaced by inferred contract client in @bslt/billing/web (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/react/src/billing',
    phase: 15,
    note: 'Migrated to main/modules/billing/web/hooks.ts (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/kernel/ui/src/components/billing',
    phase: 15,
    note: 'Migrated to main/modules/billing/web/BillingComponents.tsx (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/billing',
    phase: 15,
    note: 'Migrated to main/modules/billing/web (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/pages/PlanManagementPage.tsx',
    phase: 15,
    note: 'Migrated to main/modules/billing/web/PlanManagementPage.tsx (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/components/GrantSubscriptionCard.tsx',
    phase: 15,
    note: 'Migrated to main/modules/billing/web/GrantSubscriptionCard.tsx (plan section 17.2, Phase 15).',
  },
  {
    path: 'main/apps/web/src/features/admin/components/StripeStatusCard.tsx',
    phase: 15,
    note: 'Migrated to main/modules/billing/web/StripeStatusCard.tsx (plan section 17.2, Phase 15).',
  },
  {
    path: 'docs/api/billing.md',
    phase: 15,
    note: 'Now in docs/reference/api.md (generated; plan section 17.2, Phase 15).',
  },
  // Phase 16: identity, admin, and devtools migration (plan section 17.2, Phase 16).
  {
    path: 'main/server/core/src/api-keys',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (@bslt/identity; plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/contracts/contract.api-keys.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/endpoints.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/api-keys',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/repositories/api-keys',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/repository.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/schema/api-keys.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/repository.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/client/api/src/api-keys',
    phase: 16,
    note: 'Deleted: client calls are inferred directly from @bslt/identity/contract via createEndpointClient / useEndpoint (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/components/ApiKeysSection.tsx',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/ApiKeysSection.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/components/ApiKeysSection.test.tsx',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/ApiKeysSection.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useApiKeys.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useApiKeys.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'docs/api/apiKeys.md',
    phase: 16,
    note: 'Now in docs/reference/api.md (generated; plan section 18.1, Phase 16).',
  },
  // Phase 16 Slice 16.1c: users, admin user management, liveness cache, retention, and profile hooks
  {
    path: 'main/server/core/src/users',
    phase: 16,
    note: 'Migrated to @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/admin/userHandlers.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/index.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/admin/userHandlers.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/index.test.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/admin/userHelpers.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/service.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/admin/userHelpers.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/service.test.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/admin/userService.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/service.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/admin/userService.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/service.test.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/liveness-cache.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/crypto.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/liveness-cache.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/crypto.test.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/contracts/contract.users.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/endpoints.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/users/lifecycle.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/profile',
    phase: 16,
    note: 'Migrated to @bslt/identity/web (identityMeQueryKey, identityProfileCompletenessQueryKey) (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useAccountLifecycle.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useAccountLifecycle.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/usePasswordChange.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/usePasswordChange.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useProfile.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useProfile.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useProfileCompleteness.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useSessions.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useSessions.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useUsername.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useAdminUser.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useAdminUser.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useAdminUsers.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useAdminUsers.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useUserActions.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/admin/hooks/useUserActions.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'docs/api/users.md',
    phase: 16,
    note: 'Now in docs/reference/api.md (generated; plan section 18.1, Phase 16).',
  },
  // Phase 16 Slice 16.1d-1: Sudo, global logout, devices, phone/SMS 2FA, TOTP & backup codes, WebAuthn & passkeys
  {
    path: 'main/server/core/src/auth/sms-2fa',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/mfa.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/webauthn',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/webauthn.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/totp.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/mfa.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/totp-secret.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/crypto.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/security/totp-challenge-guard.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/mfa.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/oauth/token-crypto.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/crypto.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/routes/factors.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/endpoints.ts & server/index.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/devices.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/invalidate-sessions.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/logout-all.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/phone.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/sms-challenge.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/sudo.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/totp.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/webauthn.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/repositories/auth/totp-backup-codes.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/repository.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/repositories/auth/webauthn-credentials.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/repository.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.devices.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.passkey.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.webauth.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/client/api/src/devices',
    phase: 16,
    note: 'Deleted: use createEndpointClient(identityModule, transport) or useDevices from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/client/api/src/phone',
    phase: 16,
    note: 'Deleted: use createEndpointClient(identityModule, transport) or usePhone from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/client/api/src/settings',
    phase: 16,
    note: 'Deleted: use createEndpointClient(identityModule, transport) or useSudo from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/react/src/devices',
    phase: 16,
    note: 'Migrated to useDevices in @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/react/src/phone',
    phase: 16,
    note: 'Migrated to usePhone in @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/lib/webauthn.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/webauthn.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useSudo.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useBackupCodes.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/settings/hooks/useTotpManagement.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/tos.ts',
    phase: 16,
    note: 'Migrated to getTosStatus/acceptTos in main/modules/compliance/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/tos-gating.ts',
    phase: 16,
    note: 'Migrated to @bslt/compliance/server CapabilityContext contributor and ToS endpoints (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.tos.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/compliance/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/magic-link',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/auth-flows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/otp',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/auth-flows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/email-change.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/auth-flows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/email-change.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/index.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/handlers/strategies.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/index.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/routes/account.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/endpoints.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/routes/password.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/endpoints.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/routes/session.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/endpoints.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/routes/verification.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/endpoints.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/security/events/magic-link.ts',
    phase: 16,
    note: 'Migrated to identityEvents.accountAlerted + structured audit in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth/security/events/otp.ts',
    phase: 16,
    note: 'Migrated to identityEvents.accountAlerted + structured audit in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/server/core/src/auth',
    phase: 16,
    note: 'Dissolved completely into @bslt/identity/server + @bslt/protocols/oauth + @bslt/compliance/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/server/src/http/auth-route-overrides.ts',
    phase: 16,
    note: 'Deleted with legacy auth route registration; all /api/auth* endpoints register via identityServer and complianceServer (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/contracts/contract.auth.ts',
    phase: 16,
    note: 'Migrated completely into main/modules/identity/contract/endpoints.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'tests/integration/auth',
    phase: 16,
    note: 'Legacy mock unit tests for deleted @bslt/core/auth internals; replaced by colocated @bslt/identity/server/*.test.ts and real-DB suites (plan section 18.1, Phase 16).',
  },
  {
    path: 'docs/api/auth.md',
    phase: 16,
    note: 'Now in docs/reference/api.md (generated; plan section 18.1, Phase 16).',
  },
  // Phase 16 Slice 16.1d-2d-1: @bslt/react/oauth removal & TosAcceptanceModal ownership
  {
    path: 'main/kernel/react/src/oauth',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/hooks.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/components/TosAcceptanceModal.tsx',
    phase: 16,
    note: 'Migrated to main/modules/compliance/web/TosAcceptanceModal.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/components/TosAcceptanceModal.test.tsx',
    phase: 16,
    note: 'Migrated to main/modules/compliance/web/TosAcceptanceModal.test.tsx (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.oauth.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.oauth.schemas.test.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.test.ts (plan section 18.1, Phase 16).',
  },
  // Phase 16 Slice 16.1d-2d-2: @bslt/identity/web AuthService + @bslt/api auth client & shared auth/users schema retirement
  {
    path: 'main/client/api/src/api',
    phase: 16,
    note: 'Catch-all ApiClient retired; auth & identity endpoints run through createEndpointClient(identityModule, transport) in @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/services',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/authService.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/utils',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/authService.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/authModalStore.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/authService.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/hooks/useAuth.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/authService.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/hooks/useAuthMutations.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/authService.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/apps/web/src/features/auth/hooks/useWebauthn.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/web/authService.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/schemas.ts',
    phase: 16,
    note: 'Migrated to @bslt/schema primitives and @bslt/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.core.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.email.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.magic.link.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.mfa.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.otp.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/auth/auth.sessions.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/users/attestation.policy.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/users/lifecycle.logic.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/users/username.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/users/users.schemas.ts',
    phase: 16,
    note: 'Migrated to main/modules/identity/contract/schemas.ts (plan section 18.1, Phase 16).',
  },
  // Phase 16 Slice 16.1d-2d-3: Complete auth UI & route migration into @bslt/identity/web
  {
    path: 'main/apps/web/src/features/auth',
    phase: 16,
    note: 'Migrated completely into main/modules/identity/web (plan section 18.1, Phase 16).',
  },
  // Phase 16 Slice 16.1e: Identity DB baseline split, prefixing & @bslt/db domain retirement
  {
    path: 'main/kernel/db/legacy-migrations/identity',
    phase: 16,
    note: 'Migrated to main/modules/identity/server/migrations/0001_identity.sql (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/legacy-generated',
    phase: 16,
    note: 'Retired with LEGACY_OWNERS = []; identity rows generate into main/modules/identity/server/generated/rows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/factory.ts',
    phase: 16,
    note: 'Retired domain repository container; @bslt/db owns only kernel system tables (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/repositories/auth',
    phase: 16,
    note: 'Migrated into identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/repositories/oauth',
    phase: 16,
    note: 'Migrated into identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/repositories/sessions',
    phase: 16,
    note: 'Migrated into identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/repositories/users',
    phase: 16,
    note: 'Migrated into identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/schema/auth.ts',
    phase: 16,
    note: 'Migrated into main/modules/identity/server/generated/rows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/schema/oauth.ts',
    phase: 16,
    note: 'Migrated into main/modules/identity/server/generated/rows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/schema/sessions.ts',
    phase: 16,
    note: 'Migrated into main/modules/identity/server/generated/rows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/schema/shape.ts',
    phase: 16,
    note: 'Retired with legacy identity schema wrappers in @bslt/db (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/schema/trusted-devices.ts',
    phase: 16,
    note: 'Migrated into main/modules/identity/server/generated/rows.ts (plan section 18.1, Phase 16).',
  },
  {
    path: 'main/kernel/db/src/schema/users.ts',
    phase: 16,
    note: 'Migrated into main/modules/identity/server/generated/rows.ts and composite User projection in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  // Phase 16 Sub-Slice 16.2a: @bslt/admin & @bslt/devtools server/contract extraction; retire core/admin, api-client/admin, contract.{admin,jobs}, and shared/core/admin
  {
    path: 'main/server/core/src/admin',
    phase: 16,
    note: 'Dissolved into @bslt/admin/server and @bslt/devtools/server (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/client/api/src/admin',
    phase: 16,
    note: 'Replaced by createEndpointClient(adminModule, transport) and createEndpointClient(devtoolsModule, transport) (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/contracts/contract.admin.ts',
    phase: 16,
    note: 'Migrated into main/modules/admin/contract/endpoints.ts and main/modules/devtools/contract/endpoints.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/contracts/contract.jobs.ts',
    phase: 16,
    note: 'Migrated into main/modules/admin/contract/endpoints.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/admin',
    phase: 16,
    note: 'Migrated into @bslt/admin/contract, @bslt/devtools/contract, and local @bslt/ui badge maps (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/jobs/jobs.ts',
    phase: 16,
    note: 'Migrated into @bslt/admin/contract and local @bslt/ui/components/JobStatusBadge.tsx (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/core/jobs/jobs.test.ts',
    phase: 16,
    note: 'Migrated into main/modules/admin/contract/schemas.test.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'docs/api/admin.md',
    phase: 16,
    note: 'Now in docs/reference/api.md (generated; plan section 18.2, Phase 16).',
  },
  {
    path: 'docs/api/jobs.md',
    phase: 16,
    note: 'Now in docs/reference/api.md (generated; plan section 18.2, Phase 16).',
  },
  // Phase 16 Sub-Slice 16.2b: Dissolve main/apps/web/src/{features,demo,lib/consent} and EmailUnsubscribePage into owning WebModules and app/
  {
    path: 'main/apps/web/src/features',
    phase: 16,
    note: 'Dissolved into owning WebModules (@bslt/{identity,admin,compliance,billing,notifications}/web) and main/apps/web/src/app/{admin,account,dashboard,command-palette} (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/apps/web/src/demo',
    phase: 16,
    note: 'Migrated into @bslt/devtools/web (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/apps/web/src/lib/consent',
    phase: 16,
    note: 'Migrated into main/modules/compliance/web/consent (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/apps/web/src/pages/EmailUnsubscribePage.tsx',
    phase: 16,
    note: 'Migrated into main/modules/notifications/web/EmailUnsubscribePage.tsx (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/apps/web/src/pages/EmailUnsubscribePage.test.tsx',
    phase: 16,
    note: 'Migrated into main/modules/notifications/web/EmailUnsubscribePage.test.tsx (plan section 18.2, Phase 16).',
  },
  // Phase 16 Sub-Slice 16.2c: Remove dead unreferenced shared modules
  {
    path: 'main/shared/src/modules/core/jobs',
    phase: 16,
    note: 'Deleted unreferenced legacy BatchedQueue and ReactiveMap in main/shared/src/modules/core/jobs (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/storage',
    phase: 16,
    note: 'Deleted unreferenced legacy file schemas in main/shared/src/modules/storage; @bslt/files/contract owns file schemas (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/email',
    phase: 16,
    note: 'Deleted unreferenced legacy email schemas in main/shared/src/modules/comms/email (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/system/http/response.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy response envelope schemas; @bslt/contract owns emptyBodySchema and errorResponseSchema (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/system/http/response.test.ts',
    phase: 16,
    note: 'Deleted with main/shared/src/modules/system/http/response.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/db/search/schemas.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy search opaque schemas; @bslt/search/contract owns search schemas (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/db/search/schemas.test.ts',
    phase: 16,
    note: 'Deleted with main/shared/src/modules/db/search/schemas.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/db/search/query.builder.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy SearchQueryBuilder (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/db/search/query.builder.test.ts',
    phase: 16,
    note: 'Deleted with main/shared/src/modules/db/search/query.builder.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.display.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy notification display helpers; @bslt/notifications owns notification UI (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.display.test.ts',
    phase: 16,
    note: 'Deleted with notifications.display.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.logic.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy notification logic helpers; @bslt/notifications/server owns preference evaluation (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.logic.test.ts',
    phase: 16,
    note: 'Deleted with notifications.logic.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.errors.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy notification error classes; @bslt/notifications owns module errors (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.errors.test.ts',
    phase: 16,
    note: 'Deleted with notifications.errors.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.schemas.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy notification opaque schemas; @bslt/notifications/contract owns notification schemas (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.schemas.test.ts',
    phase: 16,
    note: 'Deleted with notifications.schemas.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.push.schemas.ts',
    phase: 16,
    note: 'Deleted unreferenced legacy push notification opaque schemas; @bslt/notifications/contract owns push schemas (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/shared/src/modules/comms/notifications/notifications.push.schemas.test.ts',
    phase: 16,
    note: 'Deleted with notifications.push.schemas.ts (plan section 18.2, Phase 16).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/ar.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/de.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/es.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/fr.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/ja.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/ko.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/pt-BR.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/apps/web/src/i18n/locales/zh-CN.ts',
    phase: 17,
    note: 'Foundation ships en-US only; non-en-US locale maps deleted (plan section 12.7, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/DeviceRowCard.tsx',
    phase: 17,
    note: 'Domain card moved to main/modules/identity/web/IdentityCards.tsx so @bslt/ui holds zero domain types (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/SessionCard.tsx',
    phase: 17,
    note: 'Domain card moved to main/modules/identity/web/IdentityCards.tsx so @bslt/ui holds zero domain types (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/ProfileCompletenessCard.tsx',
    phase: 17,
    note: 'Domain card moved to main/modules/identity/web/IdentityCards.tsx so @bslt/ui holds zero domain types (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/ProfileCompletenessCard.test.tsx',
    phase: 17,
    note: 'Replaced by main/modules/identity/web/IdentityCards.test.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/RoleBadge.tsx',
    phase: 17,
    note: 'Domain badge moved to main/modules/admin/web/AdminBadges.tsx so @bslt/ui holds zero domain types (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/JobStatusBadge.tsx',
    phase: 17,
    note: 'Domain badge moved to main/modules/admin/web/AdminBadges.tsx so @bslt/ui holds zero domain types (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/react/src/hooks/useVirtualScroll.tsx',
    phase: 17,
    note: 'Deleted unreferenced VirtualScrollList/useVirtualScroll export with inline styles (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/react/src/hooks/useVirtualScroll.test.tsx',
    phase: 17,
    note: 'Deleted with useVirtualScroll.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/layouts/layers/Modal.tsx',
    phase: 17,
    note: 'Consolidated into Dialog in main/kernel/ui/src/components/Dialog.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/layouts/layers/Modal.test.tsx',
    phase: 17,
    note: 'Consolidated into main/kernel/ui/src/components/Dialog.test.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/Toast.tsx',
    phase: 17,
    note: 'Consolidated into Toaster in main/kernel/ui/src/elements/Toaster.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/Toast.test.tsx',
    phase: 17,
    note: 'Consolidated into main/kernel/ui/src/elements/Toaster.test.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/CardAsyncState.tsx',
    phase: 17,
    note: 'Consolidated into AsyncBoundary in main/kernel/ui/src/components/AsyncBoundary.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/LoadingContainer.tsx',
    phase: 17,
    note: 'Consolidated into AsyncBoundary in main/kernel/ui/src/components/AsyncBoundary.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/LoadingContainer.test.tsx',
    phase: 17,
    note: 'Consolidated into main/kernel/ui/src/components/AsyncBoundary.test.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/components/SectionErrorBoundary.tsx',
    phase: 17,
    note: 'Consolidated into AsyncBoundary in main/kernel/ui/src/components/AsyncBoundary.tsx (plan section 12.4, Phase 17).',
  },
  {
    path: 'main/apps/web/src/app/layouts',
    phase: 17,
    note: 'Replaced by the four named shells (PublicShell, AuthShell, AppShell, ConsoleShell) in main/apps/web/src/app/shells (plan section 12.6, Phase 17).',
  },
  {
    path: 'main/apps/web/src/app/layouts/AppShell.css',
    phase: 17,
    note: 'Replaced by main/apps/web/src/app/shells/Shells.css and @bslt/ui base rules (plan section 12.6, Phase 17).',
  },
  {
    path: 'main/apps/web/src/app/layouts/useAppShellPanes.ts',
    phase: 17,
    note: 'IDE four-pane shell deleted; only ConsoleShell uses resizable panes (plan section 12.6, Phase 17).',
  },
  {
    path: 'main/kernel/ui/src/layouts/layers/ProtectedRoute.tsx',
    phase: 17,
    note: 'Route auth guarding moved to createWebApp / shell guards; unused DS ProtectedRoute deleted (plan section 12.4, Phase 17).',
  },
  // Phase 18: Public SSR seam replaces build-time-only ServerApp/entry-server prerenderer (plan sections 11.3 and 17.2).
  {
    path: 'main/apps/web/src/ssr/prerender.ts',
    phase: 18,
    note: 'Replaced by PublicRoute<D>, renderPublic, serve.ts, and `bslt web prerender` (plan section 11.3, Phase 18).',
  },
  {
    path: 'main/apps/web/src/ssr/prerender.test.ts',
    phase: 18,
    note: 'Replaced by main/kernel/web/src/ssr/public-route.test.tsx, main/apps/web/src/server/serve.test.ts, and main/tools/web/prerender.test.ts (Phase 18).',
  },
  {
    path: 'main/apps/web/src/ssr/ServerApp.tsx',
    phase: 18,
    note: 'Replaced by renderPublic + PublicDocumentShell so server and entry-public.tsx hydrate the identical tree (plan section 11.3, Phase 18).',
  },
  {
    path: 'main/apps/web/src/ssr/SsrContext.tsx',
    phase: 18,
    note: 'Replaced by PublicRoute<D> typed `data` prop and dehydrated `#__BSLT_STATE__` QueryCache payload (plan section 11.3, Phase 18).',
  },
  {
    path: 'main/apps/web/src/entry-server.tsx',
    phase: 18,
    note: 'Replaced by main/apps/web/src/server/serve.ts (`PROCESS_ROLE=web` + `prerenderStaticPublicRoutes`) (plan section 11.3, Phase 18).',
  },
  {
    path: 'main/apps/web/scripts/prerender.ts',
    phase: 18,
    note: 'Replaced by `bslt web prerender` (`main/tools/web/prerender.ts`) (plan sections 11.3 and 17.2, Phase 18).',
  },
  {
    path: 'main/apps/web/wrangler.jsonc',
    phase: 18,
    note: 'Cloudflare Workers static-assets deploy retired per owner decision D7 in favor of PROCESS_ROLE=web (plan sections 14.5, 20 D7, and 21, Phase 18).',
  },
  {
    path: 'main/apps/web/public/_headers',
    phase: 18,
    note: 'Cloudflare static _headers retired per D7; CSP and Permissions-Policy are generated by `bslt sync csp` (plan sections 11.3 and 14.2, Phase 18).',
  },
  {
    path: 'infra/docker/nginx.conf',
    phase: 18,
    note: 'Dockerfile.web switched from nginx to Node.js `PROCESS_ROLE=web` (`serve.ts`) with generated security headers (plan section 11.3, Phase 18).',
  },
  {
    path: 'main/tools/scripts/audit/csp-sync.ts',
    phase: 18,
    note: 'Replaced by `bslt sync csp` (`main/tools/sync/csp.ts` / `generated-csp` gate; plan sections 14.2 and 14.3, Phase 18).',
  },
  // Phase 19: Tranche C runtime dependencies (plan section 13, C1–C3).
  {
    path: 'main/apps/server/src/types/fastify.d.ts',
    phase: 19,
    note: 'Fastify declaration merging deleted with fastify/fastify-plugin; request/reply types live in @bslt/server-system/http (`server.ts`; plan section 13 C1, Phase 19).',
  },
  // Phase 20: Coexistence closeout — legacy horizontal packages, shims, and coexistence gates deleted (plan sections 16 and 17.2).
  {
    path: 'main/shared',
    phase: 20,
    note: 'Horizontal @bslt/shared package deleted; primitives live in @bslt/schema, @bslt/contract, @bslt/db, @bslt/server-system, @bslt/client-engine, and vertical modules (plan section 17.2, Phase 20).',
  },
  {
    path: 'main/server',
    phase: 20,
    note: 'Legacy main/server/* directory deleted with @bslt/core; server platform lives in main/kernel/* and domain logic in main/modules/* (plan section 17.2, Phase 20).',
  },
  {
    path: 'main/server/core',
    phase: 20,
    note: 'Horizontal @bslt/core package deleted; all domain logic lives in main/modules/* (plan section 17.2, Phase 20).',
  },
  {
    path: 'main/client',
    phase: 20,
    note: 'Legacy main/client/* directory deleted with @bslt/api; browser kernel lives in main/kernel/{client,react,ui,web} and module clients use createEndpointClient (plan section 17.2, Phase 20).',
  },
  {
    path: 'main/client/api',
    phase: 20,
    note: 'Hand-written @bslt/api package deleted; all browser transport runs through @bslt/client-engine + module contracts (plan section 17.2, Phase 20).',
  },
  {
    path: 'main/apps/server/src/legacy',
    phase: 20,
    note: 'Coexistence server legacy shim directory deleted in Phase 20 (plan section 16, Phase 20).',
  },
  {
    path: 'main/apps/web/src/legacy',
    phase: 20,
    note: 'Coexistence web legacy contributions directory deleted in Phase 20 (plan section 16, Phase 20).',
  },
  {
    path: 'main/kernel/db/legacy-migrations',
    phase: 20,
    note: 'Coexistence legacy-migrations directory deleted; all baselines live in main/kernel/db/sql and main/modules/*/server/migrations (plan section 9.3, Phase 20).',
  },
  {
    path: 'main/apps/server/src/middleware/permissions.ts',
    phase: 20,
    note: 'Unregistered legacy permission middleware deleted; authorization runs via endpoint auth + CapabilityContext (plan section 17.2, Phase 20).',
  },
  {
    path: 'main/apps/server/src/middleware/permissions.test.ts',
    phase: 20,
    note: 'Deleted with main/apps/server/src/middleware/permissions.ts (plan section 17.2, Phase 20).',
  },
  {
    path: 'main/tools/gates/frozen-paths.ts',
    phase: 20,
    note: 'Coexistence frozen-paths gate retired once main/shared, main/server/core, and main/client/api were deleted (plan section 16, Phase 20).',
  },
  {
    path: 'main/tools/gates/frozen-paths.json',
    phase: 20,
    note: 'Deleted with main/tools/gates/frozen-paths.ts (plan section 16, Phase 20).',
  },
  // Phase 20: Generated reference docs (`bslt sync docs`) and stale doc archival (plan section 14.6).
  {
    path: 'main/tools/scripts/docs/generate-api-docs.ts',
    phase: 20,
    note: 'Replaced by main/tools/sync/docs.ts (`bslt sync docs`; plan section 14.6, Phase 20).',
  },
  {
    path: 'main/tools/scripts/docs/generate-api-docs.test.ts',
    phase: 20,
    note: 'Replaced by main/tools/sync/docs.test.ts (plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/api',
    phase: 20,
    note: 'Replaced by generated docs/reference/api.md (`bslt sync docs`; plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/api/README.md',
    phase: 20,
    note: 'Replaced by generated docs/reference/api.md (`bslt sync docs`; plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/CLAUDE.md',
    phase: 20,
    note: 'Completeness & status ledger folded into docs/DIRECTION.md (plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/architecture/layer-map.md',
    phase: 20,
    note: 'Archived to docs/archive/layer-map.md; live architecture & module graph live in docs/specs/principles.md and generated docs/reference/module-dag.md (plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/architecture/server-dependency-dag.md',
    phase: 20,
    note: 'Archived to docs/archive/server-dependency-dag.md; replaced by generated docs/reference/module-dag.md (plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/architecture/api-contract-matrix.md',
    phase: 20,
    note: 'Archived to docs/archive/api-contract-matrix.md; replaced by generated docs/reference/api.md (plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/todo',
    phase: 20,
    note: 'Historical pre-restructure todo archived to docs/archive/TODO-2026-08.md; status lives in docs/DIRECTION.md (plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/HANDOFF-2026-06-19.md',
    phase: 20,
    note: 'Historical handoff archived to docs/archive/HANDOFF-2026-06-19.md (plan section 14.6, Phase 20).',
  },
  {
    path: 'docs/dev/PORTING-FROM-GANBATE.md',
    phase: 20,
    note: 'Historical porting audit archived to docs/archive/PORTING-FROM-GANBATE.md (plan section 14.6, Phase 20).',
  },
];

/** Root package.json scripts that must not come back. */
export const TOMBSTONED_ROOT_SCRIPTS: readonly TombstonedName[] = [
  'wizard',
  'enable',
  'setup:features',
  'setup:integrations',
  'recipes:list',
  'recipes:show',
  'recipes:check',
  'profiles:apply',
  'profiles:check',
  'starter:prune',
  'starter:prune:proof',
  'starter:smoke',
  'audit:manifest-sync',
  'editions:export',
  'editions:verify',
  'editions:pack',
  'editions:publish-core',
  'test:editions',
  'features:ui',
  'features:pack',
  'features:verify',
  'features:catalog',
  'test:features',
  'storefront:dev',
  'storefront:release',
  'storefront:deploy',
]
  .map((name): TombstonedName => ({ name, phase: 1, note: DISTRIBUTION }))
  .concat([
    { name: 'type-check:tools', phase: 2, note: TOOLS_PACKAGE },
    { name: 'test:tools', phase: 2, note: TOOLS_PACKAGE },
    { name: 'starter:tools:lint', phase: 2, note: TOOLS_PACKAGE },
    { name: 'starter:tools:test', phase: 2, note: TOOLS_PACKAGE },
    { name: 'test:profiles', phase: 2, note: TOOLS_PACKAGE },
    { name: 'audit:starter-defaults', phase: 2, note: STARTER_AUDITS },
    { name: 'audit:starter-docs', phase: 2, note: STARTER_AUDITS },
    { name: 'ci:merge-gate', phase: 2, note: GATE_REGISTRY },
    { name: 'ci:merge-gate:local', phase: 2, note: GATE_REGISTRY },
    { name: 'ci:fast', phase: 2, note: GATE_REGISTRY },
    { name: 'ci:fast:local', phase: 2, note: GATE_REGISTRY },
    { name: 'ci:verify', phase: 2, note: GATE_REGISTRY },
    { name: 'ci:local', phase: 2, note: GATE_REGISTRY },
    { name: 'lint:fast', phase: 2, note: GATE_REGISTRY },
    { name: 'lint:merge-gate', phase: 2, note: GATE_REGISTRY },
    { name: 'lint:test-pairs', phase: 2, note: GATE_REGISTRY },
    { name: 'lint:test-pairs:strict', phase: 2, note: BSLT_CLI },
    { name: 'lint:responsive', phase: 2, note: BSLT_CLI },
    { name: 'lint:dead-classes', phase: 2, note: BSLT_CLI },
    { name: 'lint:undefined-tokens', phase: 2, note: BSLT_CLI },
    { name: 'format:check:ci', phase: 2, note: BSLT_CLI },
    { name: 'check:changed', phase: 2, note: BSLT_CLI },
    { name: 'test:fast', phase: 2, note: BSLT_CLI },
    { name: 'test:full', phase: 2, note: BSLT_CLI },
    { name: 'test:e2e:8081', phase: 2, note: BSLT_CLI },
    { name: 'test:e2e:8082', phase: 2, note: BSLT_CLI },
    { name: 'test:e2e:8083', phase: 2, note: BSLT_CLI },
    { name: 'sync:headers:staged', phase: 2, note: BSLT_CLI },
    { name: 'sync:headers:check', phase: 2, note: BSLT_CLI },
    { name: 'sync:headers:watch', phase: 2, note: BSLT_CLI },
    { name: 'api:generate-client', phase: 2, note: BSLT_CLI },
    { name: 'api:generate-hooks', phase: 2, note: BSLT_CLI },
    { name: 'api:generate', phase: 2, note: BSLT_CLI },
    { name: 'api:check', phase: 2, note: BSLT_CLI },
    { name: 'api:check:fix', phase: 2, note: BSLT_CLI },
    { name: 'docs:api', phase: 2, note: BSLT_CLI },
    { name: 'audit:api-docs', phase: 2, note: BSLT_CLI },
    { name: 'assets:web-icons', phase: 2, note: BSLT_CLI },
    { name: 'audit:api-response-sync:strict', phase: 2, note: BSLT_CLI },
    { name: 'audit:api-client-sync:strict', phase: 2, note: BSLT_CLI },
    { name: 'audit:api-client-surfaces', phase: 2, note: BSLT_CLI },
    { name: 'audit:client-surfaces', phase: 2, note: BSLT_CLI },
    { name: 'audit:responsive', phase: 2, note: BSLT_CLI },
    { name: 'audit:web-feature-surfaces', phase: 2, note: BSLT_CLI },
    { name: 'audit:route-contract-coverage', phase: 2, note: BSLT_CLI },
    { name: 'audit:api-governance:strict', phase: 2, note: BSLT_CLI },
    { name: 'starter:feature', phase: 2, note: BSLT_CLI },
    { name: 'starter:rename', phase: 2, note: BSLT_CLI },
    { name: 'starter:rename-scope', phase: 2, note: BSLT_CLI },
    { name: 'audit:gate-coverage', phase: 2, note: BSLT_CLI },
    { name: 'starter:verify', phase: 2, note: BSLT_CLI },
    { name: 'audit:env-examples', phase: 2, note: BSLT_CLI },
    { name: 'audit:vite-build-args', phase: 2, note: BSLT_CLI },
    { name: 'audit:local-env-secrets', phase: 2, note: BSLT_CLI },
    { name: 'audit:generated-artifacts', phase: 2, note: BSLT_CLI },
    { name: 'audit:esm-dist', phase: 2, note: BSLT_CLI },
    { name: 'audit:package-exports', phase: 2, note: BSLT_CLI },
    { name: 'fix:esm-dist', phase: 2, note: BSLT_CLI },
    { name: 'audit:web-assets', phase: 2, note: BSLT_CLI },
    { name: 'audit:i18n', phase: 2, note: BSLT_CLI },
    { name: 'audit:csp', phase: 2, note: BSLT_CLI },
    { name: 'audit:profile-boundaries', phase: 2, note: BSLT_CLI },
    { name: 'audit:template', phase: 2, note: BSLT_CLI },
    { name: 'sync:ts:check', phase: 2, note: BSLT_CLI },
    { name: 'health-check', phase: 2, note: BSLT_CLI },
    { name: 'db:audit:db', phase: 2, note: BSLT_CLI },
    { name: 'db:backfill-totp', phase: 2, note: BSLT_CLI },
    { name: 'docker:dev:postgres', phase: 2, note: BSLT_CLI },
    { name: 'hooks:cache:maintain', phase: 2, note: BSLT_CLI },
    { name: 'workflow:dump', phase: 2, note: BSLT_CLI },
    { name: 'export:server-config', phase: 2, note: BSLT_CLI },
    { name: 'export:server-system', phase: 2, note: BSLT_CLI },
    { name: 'lint:boundaries:warn', phase: 2, note: BSLT_CLI },
    { name: 'lint:boundaries:error', phase: 2, note: BSLT_CLI },
    { name: 'audit:shared-boundaries', phase: 2, note: BSLT_CLI },
    { name: 'audit:shared-export-usage', phase: 2, note: BSLT_CLI },
    { name: 'graph:shared', phase: 2, note: BSLT_CLI },
    { name: 'graph:server', phase: 2, note: BSLT_CLI },
    { name: 'graph:server-system', phase: 2, note: BSLT_CLI },
    { name: 'graph:server-system:full', phase: 2, note: BSLT_CLI },
    { name: 'graph:db', phase: 2, note: BSLT_CLI },
    { name: 'check:shared-exports', phase: 2, note: BSLT_CLI },
    { name: 'line-count', phase: 2, note: BSLT_CLI },
    { name: 'export:errors', phase: 2, note: BSLT_CLI },
    { name: 'export:error', phase: 2, note: BSLT_CLI },
    { name: 'export:logger', phase: 2, note: BSLT_CLI },
    { name: 'export:server-main', phase: 2, note: BSLT_CLI },
    { name: 'db:push', phase: 6, note: ONE_RUNNER },
  ]);

/** Identifiers that must not appear in tracked source again. */
export const TOMBSTONED_SYMBOLS: readonly TombstonedName[] = [
  { name: 'PRUNE_MANIFESTS', phase: 1, note: DISTRIBUTION },
  { name: '@bslt/storefront', phase: 1, note: DISTRIBUTION },
  // The server's container entries keep the one allowed guard (ALLOWED_MENTION_PATHS).
  { name: 'process.argv[1]', phase: 2, note: ENTRY_GUARDS },
  { name: 'vite-tsconfig-paths', phase: 3, note: ALIASES },
  { name: 'createSharedVitestAliases', phase: 3, note: ALIASES },
  { name: 'shared-vitest-aliases', phase: 3, note: ALIASES },
  { name: 'bootstrapServerSystem', phase: 5, note: BUILD_APP },
  { name: 'stopServerSystem', phase: 5, note: BUILD_APP },
  { name: 'ServerBootstrapState', phase: 5, note: BUILD_APP },
  {
    name: 'createTestServer',
    phase: 5,
    note: `The hand-built composition root of the integration suites. ${TESTING_KIT}`,
  },
  { name: 'wireRealDbApp', phase: 5, note: TESTING_KIT },
  { name: 'createDbHarness', phase: 5, note: TESTING_KIT },
  {
    name: 'isDatabaseReachable',
    phase: 5,
    note: 'The per-suite copy of the real-DB probe and skip. describeRealDb (@bslt/testing/real-db) is the one copy.',
  },
  {
    name: 'startWorkersPhase',
    phase: 5,
    note: 'Split into composeWorkersPhase (load, register the WebSocket gateway) and its start(): buildApp composes without scheduling anything.',
  },
  // Phase 6: the single-directory runner, its entry points and its directory.
  { name: 'runSqlMigrations', phase: 6, note: ONE_RUNNER },
  { name: 'MIGRATIONS_DIR', phase: 6, note: ONE_RUNNER },
  { name: 'resolveMigrationsDir', phase: 6, note: ONE_RUNNER },
  { name: 'runContainerMigrations', phase: 6, note: ONE_RUNNER },
  { name: 'pushSchema', phase: 6, note: ONE_RUNNER },
  { name: 'db:push', phase: 6, note: ONE_RUNNER },
  { name: 'dist/src/migrate.js', phase: 6, note: ONE_RUNNER },
  { name: 'server/db/migrations', phase: 6, note: BASELINE_RESET },
  { name: 'createJobRepository', phase: 6, note: DEAD_TABLES },
  { name: 'TENANT_SETTINGS_TABLE', phase: 6, note: DEAD_TABLES },
  // Phase 6: the catalog oracle and the regular-expression audit.
  { name: 'snapshot-db-catalog', phase: 6, note: ONE_CATALOG },
  { name: 'snapshot db-catalog', phase: 6, note: ONE_CATALOG },
  { name: 'DB_CATALOG_SNAPSHOT', phase: 6, note: ONE_CATALOG },
  { name: 'extractRlsClassesFromSql', phase: 6, note: ONE_CATALOG },
  // Phase 6: the schema-per-tenant toolkit.
  { name: 'DB_TENANCY_MODE', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'TENANCY_MODES', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'TenancyEnvSchema', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'TenancyConfig', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'makeTenantSchemaProvisioner', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'provisionTenantSchema', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'resolveTenantSchema', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'tenantSchemaName', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'listTenantSchemas', phase: 6, note: ONE_TENANCY_MODEL },
  { name: 'isValidSchemaName', phase: 6, note: ONE_TENANCY_MODEL },
  // Phase 6: the Phase 0 names of the database helpers.
  { name: 'app_apply_rls', phase: 6, note: SYS_HELPERS },
  { name: 'app_current_user_id', phase: 6, note: SYS_HELPERS },
  { name: 'app_current_tenant_id', phase: 6, note: SYS_HELPERS },
  { name: 'app_current_user_is_tenant_member', phase: 6, note: SYS_HELPERS },
  { name: 'app_current_user_is_platform_admin', phase: 6, note: SYS_HELPERS },
  { name: 'app_current_user_tenant_role', phase: 6, note: SYS_HELPERS },
  // Phase 8: @bslt/schema, tasks module migration, and generated client retirement.
  {
    name: '@bslt/shared/schema',
    phase: 8,
    note: 'Moved to @bslt/schema (main/kernel/schema; plan section 17.2, Phase 8).',
  },
  {
    name: 'createTasksClient',
    phase: 8,
    note: 'Deleted with main/client/api/src/tasks; use createEndpointClient / useEndpoint on tasksModule (plan section 18.3, Phase 8).',
  },
  {
    name: 'TasksClient',
    phase: 8,
    note: 'Deleted with main/client/api/src/tasks (plan section 18.3, Phase 8).',
  },
  {
    name: 'tasksRoutes',
    phase: 8,
    note: 'Deleted with main/server/core/src/tasks; routes are derived by the module host from tasksEndpoints (plan section 18.3, Phase 8).',
  },
  {
    name: 'TASKS_QUERY_KEY',
    phase: 8,
    note: 'Deleted with legacy useTasks; query keys are derived via endpointQueryKey (plan section 18.3, Phase 8).',
  },
  {
    name: 'TasksAppContext',
    phase: 8,
    note: 'Replaced by RequestContext in @bslt/server-system/module (plan section 18.3, Phase 8).',
  },
  {
    name: 'createTaskRepository',
    phase: 8,
    note: 'Replaced by tasksRepository(tx) in main/modules/tasks/server/repository.ts (plan section 18.3, Phase 8).',
  },
  {
    name: 'createGeneratedApiClient',
    phase: 8,
    note: 'Deleted with main/client/api/src/generated; use @bslt/client-engine transport + createEndpointClient (plan section 19, Phase 8).',
  },
  {
    name: 'runStarterFeatureCli',
    phase: 8,
    note: 'Replaced by runModuleNewCli in main/tools/module/new.ts (`bslt module new <id>`; plan section 17.2, Phase 8).',
  },
  // Phase 9: web contributions seam (plan sections 11.1–11.2 and 17.2).
  {
    name: 'STARTER_PRODUCT_ROUTE_PATHS',
    phase: 9,
    note: 'Deleted with starterSurface.ts (plan section 11.2, Phase 9).',
  },
  {
    name: 'STARTER_OPTIONAL_ROUTE_PATHS',
    phase: 9,
    note: 'Deleted with starterSurface.ts (plan section 11.2, Phase 9).',
  },
  {
    name: 'STARTER_ADMIN_SURFACE_IDS',
    phase: 9,
    note: 'Deleted with starterSurface.ts (plan section 11.2, Phase 9).',
  },
  {
    name: 'AdminSurfaceTier',
    phase: 9,
    note: 'Deleted with adminSurface tier/starter metadata; admin surfaces compose through createWebApp (plan section 11.1, Phase 9).',
  },
  {
    name: 'SETTINGS_TAB_IDS',
    phase: 9,
    note: 'Deleted with hand settings-section lists; settings sections compose through createWebApp (plan section 11.2, Phase 9).',
  },
  {
    name: 'SETTINGS_TAB_ALIASES',
    phase: 9,
    note: 'Deleted with hand settings-section lists; settings aliases compose through createWebApp (plan section 11.2, Phase 9).',
  },
  {
    name: 'SETTINGS_NAV_ITEMS',
    phase: 9,
    note: 'Deleted with hand settings-section lists; settings nav composes through createWebApp (plan section 11.2, Phase 9).',
  },
  {
    name: 'VOLATILE_KEY_SEGMENTS',
    phase: 9,
    note: 'Deleted with queryPersistencePolicy denylist; persistence uses default-deny allowlist via createWebApp (WEB-06, Phase 9).',
  },
  {
    name: 'NON_PERSISTABLE_HEADS',
    phase: 9,
    note: 'Deleted with queryPersistencePolicy denylist; persistence uses default-deny allowlist via createWebApp (WEB-06, Phase 9).',
  },
  // Phase 10: one queue (`sys_jobs`), dead write/media queue & HTTP duplication deleted (plan sections 8.2 and 17.2).
  {
    name: 'WriteService',
    phase: 10,
    note: 'Deleted with write-service.ts; mutations use k.db.tx + k.events.publish (plan section 17.2, Phase 10).',
  },
  {
    name: 'createWriteService',
    phase: 10,
    note: 'Deleted with write-service.ts (plan section 17.2, Phase 10).',
  },
  {
    name: 'WriteServiceOptions',
    phase: 10,
    note: 'Deleted with write-service.ts (plan section 17.2, Phase 10).',
  },
  {
    name: 'CustomJobQueue',
    phase: 10,
    note: 'Deleted with main/server/media/src/queue; `sys_jobs` is the one queue (plan sections 8.2 and 17.2, Phase 10).',
  },
  {
    name: 'MediaProcessingOrchestrator',
    phase: 10,
    note: 'Deleted with main/server/media/src/processor.ts (plan section 17.2, Phase 10).',
  },
  {
    name: 'MediaProcessingQueue',
    phase: 10,
    note: 'Deleted with main/server/media/src/queue (plan section 17.2, Phase 10).',
  },
  {
    name: 'createMediaProcessingQueue',
    phase: 10,
    note: 'Deleted with main/server/media/src/queue (plan section 17.2, Phase 10).',
  },
  {
    name: 'MediaProcessingRetryHandler',
    phase: 10,
    note: 'Deleted with main/server/media/src/queue (plan section 17.2, Phase 10).',
  },
  {
    name: 'InMemoryMediaDatabase',
    phase: 10,
    note: 'Deleted with main/server/media/src/database.ts (plan section 17.2, Phase 10).',
  },
  {
    name: 'ServerMediaQueue',
    phase: 10,
    note: 'Deleted with main/server/media/src/facade.ts (plan section 17.2, Phase 10).',
  },
  {
    name: 'createServerMediaQueue',
    phase: 10,
    note: 'Deleted with main/server/media/src/facade.ts (plan section 17.2, Phase 10).',
  },
  {
    name: '@bslt/media/http',
    phase: 10,
    note: 'Deleted with main/server/media/src/http (plan section 17.2, Phase 10).',
  },
  {
    name: 'startCronScheduler',
    phase: 10,
    note: 'Deleted with main/server/workers/src/scheduler/start.ts; cron ticks enqueue onto sys_jobs via createCronScheduler (plan section 8.4, Phase 10).',
  },
  // Phase 10: outbound webhooks migrated to @bslt/webhooks (plan section 18.7).
  {
    name: 'emitWebhookEvent',
    phase: 10,
    note: 'Deleted with main/server/core/src/webhooks; fan-out runs through k.events.publish + onFlagged("webhook", ...) in @bslt/webhooks (plan section 18.7, Phase 10).',
  },
  {
    name: 'WEBHOOK_EVENT_TYPES',
    phase: 10,
    note: 'Deleted: webhook events are declared per module via event(..., { webhook: true }) (plan section 18.7, Phase 10).',
  },
  {
    name: 'SUBSCRIBABLE_EVENT_TYPES',
    phase: 10,
    note: 'Deleted with WEBHOOK_EVENT_TYPES (plan section 18.7, Phase 10).',
  },
  {
    name: 'webhookRoutes',
    phase: 10,
    note: 'Deleted with main/server/core/src/webhooks; routes are derived by the module host from webhooksEndpoints (plan section 18.7, Phase 10).',
  },
  {
    name: 'createWebhookClient',
    phase: 10,
    note: 'Deleted with main/client/api/src/webhooks; use createEndpointClient / useEndpoint on webhooksModule (plan section 18.7, Phase 10).',
  },
  {
    name: 'WebhookEnvSchema',
    phase: 10,
    note: 'Replaced by webhooksEnvSchema on webhooksModule.env in @bslt/webhooks (plan section 18.7, Phase 10).',
  },
  {
    name: 'createWebhookRepository',
    phase: 10,
    note: 'Replaced by webhooksRepository(tx) in main/modules/webhooks/server/repository.ts (plan section 18.7, Phase 10).',
  },
  {
    name: 'createWebhookDeliveryRepository',
    phase: 10,
    note: 'Replaced by webhookDeliveriesRepository(tx) in main/modules/webhooks/server/repository.ts (plan section 18.7, Phase 10).',
  },
  {
    name: 'WEBHOOK_RETRY_MAX_BATCH',
    phase: 10,
    note: 'Deleted with legacy webhook-retry cron; retry cron lives in @bslt/webhooks (plan section 18.7, Phase 10).',
  },
  // Phase 11: feature flags migrated to @bslt/flags (plan section 18.8).
  {
    name: 'featureFlagRoutes',
    phase: 11,
    note: 'Deleted with main/server/core/src/feature-flags; routes are derived by the module host from flagsEndpoints (plan section 18.8, Phase 11).',
  },
  {
    name: 'featureFlagsContract',
    phase: 11,
    note: 'Migrated to flagsEndpoints in @bslt/flags/contract (plan section 18.8, Phase 11).',
  },
  {
    name: 'createFeatureFlagRepository',
    phase: 11,
    note: 'Replaced by flagsRepository(tx) in main/modules/flags/server/repository.ts (plan section 18.8, Phase 11).',
  },
  {
    name: 'createTenantFeatureOverrideRepository',
    phase: 11,
    note: 'Replaced by flagOverridesRepository(tx) in main/modules/flags/server/repository.ts (plan section 18.8, Phase 11).',
  },
  {
    name: '@bslt/core/feature-flags',
    phase: 11,
    note: 'Deleted with main/server/core/src/feature-flags; use @bslt/flags (plan section 18.8, Phase 11).',
  },
  {
    name: '@bslt/shared/core/feature-flags',
    phase: 11,
    note: 'Deleted with main/shared/src/modules/core/feature-flags; use @bslt/flags/contract (plan section 18.8, Phase 11).',
  },
  // Phase 11: profiles, optional-import, and VITE_ENABLE_* retired (plan section 17.2).
  {
    name: 'isServerCapabilityEnabled',
    phase: 11,
    note: 'Deleted with profile.generated.ts; server subsystems boot by PROCESS_ROLE (plan section 17.2, Phase 11).',
  },
  {
    name: 'isWebCapabilityEnabled',
    phase: 11,
    note: 'Deleted with profile.generated.ts; SPA checks useCapabilities() from @bslt/web-platform (plan section 17.2, Phase 11).',
  },
  {
    name: 'importOptionalCapability',
    phase: 11,
    note: 'Deleted with optional-import.ts (plan section 17.2, Phase 11).',
  },
  {
    name: 'ACTIVE_SERVER_PROFILE',
    phase: 11,
    note: 'Deleted with profile.generated.ts (plan section 17.2, Phase 11).',
  },
  {
    name: 'ACTIVE_WEB_PROFILE',
    phase: 11,
    note: 'Deleted with profile.generated.ts (plan section 17.2, Phase 11).',
  },
  {
    name: 'VITE_ENABLE_',
    phase: 11,
    note: 'Deleted: optional UI surfaces resolve at runtime via GET /api/platform/context and CapabilityProvider (plan section 17.2, Phase 11).',
  },
  {
    name: 'PUBLIC_EXTENDED_LOGIN_ENABLED',
    phase: 11,
    note: 'Deleted with VITE_ENABLE_ADVANCED_AUTH; auth strategies come from context.authStrategies (plan section 17.2, Phase 11).',
  },
  {
    name: 'PinoLoggerWrapper',
    phase: 12,
    note: 'Replaced by the owned JSON logger in main/kernel/server/src/logger/logger.ts (plan section 13, A1).',
  },
  {
    name: 'pino-pretty',
    phase: 12,
    note: 'Unused dependency removed; dev logs are pretty-printed by developmentFormatter and the dev runner (main/tools/scripts/dev) (plan section 13, A1).',
  },
  // Phase 12: runtime dependencies replaced by owned code (plan section 13).
  {
    name: '@fastify/compress',
    phase: 12,
    note: 'Replaced by br/gzip negotiation on node:zlib in main/apps/server/src/middleware/compression.ts (plan section 13, A2).',
  },
  {
    name: '@fastify/swagger',
    phase: 12,
    note: 'Replaced, with @fastify/swagger-ui, by docs/reference/openapi.json, written by `pnpm bslt sync openapi` and checked by the generated-openapi gate (plan section 13, A6).',
  },
  {
    name: '/api/docs',
    phase: 12,
    note: 'The Swagger UI and its JSON and YAML routes are deleted; the OpenAPI document is docs/reference/openapi.json (plan section 13, A6).',
  },
  {
    name: 'DOCS_AUTH_REQUIRED',
    phase: 12,
    note: 'Deleted with the Swagger UI routes it guarded (plan section 13, A6).',
  },
  // Phase 12, A5: Sentry replaced by the owned error reporter (plan section 13).
  {
    name: '@sentry/',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    name: 'SENTRY_DSN',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    name: 'initSentry',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    name: 'SentryErrorBoundary',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    name: 'sentry.io',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    name: 'createErrorTracker',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  {
    name: 'ERROR_TRACKING_DSN',
    phase: 12,
    note: 'Replaced by the owned error reporter: POST /api/platform/errors and logger error events (plan section 13, A5).',
  },
  // Phase 12: runtime deps tranche A (plan section 13).
  {
    name: '@simplewebauthn/browser',
    phase: 12,
    note: 'Replaced by navigator.credentials plus the owned base64url/JSON codec in main/modules/identity/web/webauthn.ts (plan section 13, A7).',
  },
  // Phase 13: Wave A module migrations — support (plan section 17.2).
  {
    name: 'createSupportClient',
    phase: 13,
    note: 'Deleted with main/client/api/src/support; use createEndpointClient / useEndpoint on supportModule (plan section 17.2, Phase 13).',
  },
  {
    name: 'SupportClient',
    phase: 13,
    note: 'Deleted with main/client/api/src/support (plan section 17.2, Phase 13).',
  },
  {
    name: 'supportRoutes',
    phase: 13,
    note: 'Deleted with main/server/core/src/support; routes are derived by the module host from supportEndpoints (plan section 17.2, Phase 13).',
  },
  {
    name: 'supportContract',
    phase: 13,
    note: 'Migrated to supportEndpoints in @bslt/support/contract (plan section 17.2, Phase 13).',
  },
  {
    name: 'createSupportRequestRepository',
    phase: 13,
    note: 'Replaced by supportRepository(tx) in main/modules/support/server/repository.ts (plan section 17.2, Phase 13).',
  },
  {
    name: '@bslt/core/support',
    phase: 13,
    note: 'Deleted with main/server/core/src/support; use @bslt/support (plan section 17.2, Phase 13).',
  },
  {
    name: '@bslt/shared/core/support',
    phase: 13,
    note: 'Deleted with main/shared/src/modules/core/support; use @bslt/support/contract (plan section 17.2, Phase 13).',
  },
  {
    name: 'createStatusClient',
    phase: 13,
    note: 'Deleted with @bslt/api/status; use createEndpointClient(statusModule, transport) or useEndpoint (plan section 17.2, Phase 13).',
  },
  {
    name: 'StatusClient',
    phase: 13,
    note: 'Deleted with @bslt/api/status; client types are inferred from @bslt/status/contract (plan section 17.2, Phase 13).',
  },
  {
    name: 'statusRoutes',
    phase: 13,
    note: 'Deleted with main/server/core/src/status; routes are derived by the module host from statusEndpoints (plan section 17.2, Phase 13).',
  },
  {
    name: 'statusContract',
    phase: 13,
    note: 'Migrated to statusEndpoints in @bslt/status/contract (plan section 17.2, Phase 13).',
  },
  {
    name: 'IncidentLog',
    phase: 13,
    note: 'Replaced by durable status_incidents + createIncidentTracker in main/modules/status/server (plan section 17.2, Phase 13).',
  },
  {
    name: 'createSearchClient',
    phase: 13,
    note: 'Deleted with @bslt/api/search; use createEndpointClient(searchModule, transport) or useEndpoint (plan section 17.2, Phase 13).',
  },
  {
    name: 'SearchClient',
    phase: 13,
    note: 'Deleted with @bslt/api/search; client types are inferred from @bslt/search/contract (plan section 17.2, Phase 13).',
  },
  {
    name: 'searchRoutes',
    phase: 13,
    note: 'Deleted with main/server/core/src/search; routes are derived by the module host from searchEndpoints (plan section 17.2, Phase 13).',
  },
  {
    name: 'searchContract',
    phase: 13,
    note: 'Migrated to searchEndpoints in @bslt/search/contract (plan section 17.2, Phase 13).',
  },
  {
    name: '@bslt/core/search',
    phase: 13,
    note: 'Deleted with main/server/core/src/search; use @bslt/search (plan section 17.2, Phase 13).',
  },
  {
    name: 'createAnalyticsClient',
    phase: 13,
    note: 'Deleted with @bslt/api/analytics; use createEndpointClient(analyticsModule, transport) or useMutationEndpoint (plan section 17.2, Phase 13).',
  },
  {
    name: 'AnalyticsClient',
    phase: 13,
    note: 'Deleted with @bslt/api/analytics; client types are inferred from @bslt/analytics/contract (plan section 17.2, Phase 13).',
  },
  {
    name: 'analyticsRoutes',
    phase: 13,
    note: 'Deleted with main/server/core/src/analytics; routes are derived by the module host from analyticsEndpoints (plan section 17.2, Phase 13).',
  },
  {
    name: 'analyticsContract',
    phase: 13,
    note: 'Migrated to analyticsEndpoints in @bslt/analytics/contract (plan section 17.2, Phase 13).',
  },
  {
    name: 'AnalyticsEnvSchema',
    phase: 13,
    note: 'Replaced by analyticsEnvSchema on analyticsModule.env in @bslt/analytics (plan section 17.2, Phase 13).',
  },
  {
    name: 'createEventRepository',
    phase: 13,
    note: 'Replaced by analyticsRepository(tx) in main/modules/analytics/server/repository.ts (plan section 17.2, Phase 13).',
  },
  {
    name: '@bslt/core/analytics',
    phase: 13,
    note: 'Deleted with main/server/core/src/analytics; use @bslt/analytics (plan section 17.2, Phase 13).',
  },
  {
    name: '@bslt/shared/core/analytics',
    phase: 13,
    note: 'Deleted with main/shared/src/modules/core/analytics; use @bslt/analytics/contract (plan section 17.2, Phase 13).',
  },
  // Phase 14: Wave B module migrations — audit, security events, and activities (plan section 17.2).
  {
    name: 'createActivitiesClient',
    phase: 14,
    note: 'Deleted with main/client/api/src/activities; use createEndpointClient / useEndpoint on auditModule (plan section 17.2, Phase 14).',
  },
  {
    name: 'ActivitiesClient',
    phase: 14,
    note: 'Deleted with main/client/api/src/activities; client types are inferred from @bslt/audit/contract (plan section 17.2, Phase 14).',
  },
  {
    name: 'activityRoutes',
    phase: 14,
    note: 'Deleted with main/server/core/src/activities; routes are derived by the module host from auditEndpoints (plan section 17.2, Phase 14).',
  },
  {
    name: 'activitiesContract',
    phase: 14,
    note: 'Migrated to auditEndpoints in @bslt/audit/contract (plan section 17.2, Phase 14).',
  },
  {
    name: 'createActivityRepository',
    phase: 14,
    note: 'Replaced by auditRepository(tx) in main/modules/audit/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    name: 'createAuditEventRepository',
    phase: 14,
    note: 'Replaced by auditRepository(tx) in main/modules/audit/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    name: 'createSecurityEventRepository',
    phase: 14,
    note: 'Merged into auditRepository(tx) in main/modules/audit/server/repository.ts (plan section 17.2, Phase 14).',
  },
  {
    name: 'logActivity',
    phase: 14,
    note: 'Deleted: user-visible activity timeline entries project from domain events flagged `activity: true` via @bslt/audit (plan section 17.2, Phase 14).',
  },
  {
    name: 'recordSideEffectsAsSystem',
    phase: 14,
    note: 'Deleted: audit and activity side effects are projected asynchronously on k.db.system by @bslt/audit subscribers (plan section 17.2, Phase 14).',
  },
  {
    name: '@bslt/core/audit',
    phase: 14,
    note: 'Deleted with main/server/core/src/audit; use @bslt/audit (plan section 17.2, Phase 14).',
  },
  {
    name: '@bslt/core/activities',
    phase: 14,
    note: 'Deleted with main/server/core/src/activities; use @bslt/audit (plan section 17.2, Phase 14).',
  },
  {
    name: '@bslt/shared/core/activities',
    phase: 14,
    note: 'Deleted with main/shared/src/modules/core/activities; use @bslt/audit/contract (plan section 17.2, Phase 14).',
  },
  {
    name: '@bslt/shared/core/audit-log',
    phase: 14,
    note: 'Deleted with main/shared/src/modules/core/audit-log; use @bslt/audit/contract (plan section 17.2, Phase 14).',
  },
  {
    name: 'createPermissionChangeHandler',
    phase: 14,
    note: 'Deleted with main/kernel/realtime/src/permissions; session revocation closes sockets via identity.session.revoked and revokeUserSessions (plan section 8.6, Phase 14).',
  },
  {
    name: 'filterRecordsForUser',
    phase: 14,
    note: 'Deleted with main/kernel/realtime/src/permissions; use ChannelRegistry in @bslt/realtime (plan section 8.6, Phase 14).',
  },
  {
    name: '@bslt/realtime/permissions',
    phase: 14,
    note: 'Deleted with main/kernel/realtime/src/permissions; use ChannelRegistry in @bslt/realtime (plan section 8.6, Phase 14).',
  },
  {
    name: 'tryNotification',
    phase: 14,
    note: 'Deleted: billing and transactional user notices emit notifications.user.notified via publishUserNotice (plan section 17.2, Phase 14).',
  },
  {
    name: 'notifyAdmins',
    phase: 14,
    note: 'Deleted: account alerts emit identity.account.alerted via publishAccountAlert and project through @bslt/notifications (plan section 17.2, Phase 14).',
  },
  {
    name: '@bslt/core/notifications',
    phase: 14,
    note: 'Deleted with main/server/core/src/notifications; use @bslt/notifications (plan section 17.2, Phase 14).',
  },
  {
    name: 'createNotificationClient',
    phase: 14,
    note: 'Deleted with main/client/api/src/notifications; use createEndpointClient(notificationsModule, transport) (plan section 17.2, Phase 14).',
  },
  {
    name: '#app/features/notifications',
    phase: 14,
    note: 'Deleted with main/apps/web/src/features/notifications; import from @bslt/notifications/web (plan section 17.2, Phase 14).',
  },
  {
    name: 'S3ClientWrapper',
    phase: 14,
    note: 'Deleted with main/kernel/storage/src/providers/s3.client.wrapper.ts; use @bslt/protocols/s3 (plan section 13 B4, Phase 14).',
  },
  {
    name: 'MediaGallery',
    phase: 14,
    note: 'Deleted with main/kernel/ui/src/components/media (plan section 17.2, Phase 14).',
  },
  {
    name: 'filesContract',
    phase: 14,
    note: 'Deleted with main/shared/src/contracts/contract.files.ts; use @bslt/files/contract (plan section 17.2, Phase 14).',
  },
  {
    name: 'fileRoutes',
    phase: 14,
    note: 'Deleted with main/server/core/src/files; use filesServer from @bslt/files/server (plan section 17.2, Phase 14).',
  },
  {
    name: 'mediaRoutes',
    phase: 14,
    note: 'Deleted with main/apps/server/src/http/media; /api/media/* lives in @bslt/files (plan section 17.2, Phase 14).',
  },
  {
    name: 'resolveAuthUserAvatar',
    phase: 14,
    note: 'Deleted: user avatars are owned by files_avatars and /api/files/avatar* in @bslt/files (plan sections 5.2 and D9, Phase 14).',
  },
  {
    name: 'createFileRepository',
    phase: 14,
    note: 'Deleted with main/kernel/db/src/repositories/files; use @bslt/files/server (plan section 17.2, Phase 14).',
  },
  {
    name: '@bslt/core/files',
    phase: 14,
    note: 'Deleted with main/server/core/src/files; use @bslt/files (plan section 17.2, Phase 14).',
  },
  {
    name: '#app/features/files',
    phase: 14,
    note: 'Deleted with main/apps/web/src/features/files; import from @bslt/files/web (plan section 17.2, Phase 14).',
  },
  {
    name: '#app/features/media',
    phase: 14,
    note: 'Deleted with main/apps/web/src/features/media per owner decision D2 (Phase 14).',
  },
  {
    name: 'registerScheduledTasks',
    phase: 15,
    note: 'Deleted with @bslt/workers; recurring work uses module cron entries on createCronScheduler (plan section 17.2, Phase 15).',
  },
  {
    name: 'stopScheduledTasks',
    phase: 15,
    note: 'Deleted with @bslt/workers; recurring work uses module cron entries on createCronScheduler (plan section 17.2, Phase 15).',
  },
  {
    name: '@bslt/shared/workers',
    phase: 15,
    note: 'Deleted with main/shared/src/modules/workers (plan section 17.2, Phase 15).',
  },
  {
    name: 'legalRoutes',
    phase: 15,
    note: 'Deleted with main/server/core/src/compliance/legal; use complianceServer from @bslt/compliance/server (plan section 17.2, Phase 15).',
  },
  {
    name: 'consentRoutes',
    phase: 15,
    note: 'Deleted with main/server/core/src/consent; use complianceServer from @bslt/compliance/server (plan section 17.2, Phase 15).',
  },
  {
    name: 'dataExportRoutes',
    phase: 15,
    note: 'Deleted with main/server/core/src/compliance/data-export; use complianceServer from @bslt/compliance/server (plan section 17.2, Phase 15).',
  },
  {
    name: 'complianceContract',
    phase: 15,
    note: 'Deleted with main/shared/src/contracts/contract.compliance.ts; use complianceModule.endpoints (plan section 17.2, Phase 15).',
  },
  {
    name: 'createLegalClient',
    phase: 15,
    note: 'Deleted with main/client/api/src/legal; use inferred contract client from @bslt/compliance/web (plan section 17.2, Phase 15).',
  },
  {
    name: 'legalQueryKeys',
    phase: 15,
    note: 'Deleted with main/kernel/react/src/legal; use endpointQueryKey on @bslt/compliance (plan section 17.2, Phase 15).',
  },
  {
    name: 'createLegalDocumentRepository',
    phase: 15,
    note: 'Replaced by complianceRepository(tx) in main/modules/compliance/server/repository.ts (plan section 17.2, Phase 15).',
  },
  {
    name: 'createConsentRecordRepository',
    phase: 15,
    note: 'Replaced by complianceRepository(tx) in main/modules/compliance/server/repository.ts (plan section 17.2, Phase 15).',
  },
  {
    name: 'createDataExportRequestRepository',
    phase: 15,
    note: 'Replaced by complianceRepository(tx) in main/modules/compliance/server/repository.ts (plan section 17.2, Phase 15).',
  },
  {
    name: '@bslt/core/compliance',
    phase: 15,
    note: 'Deleted with main/server/core/src/compliance; use @bslt/compliance (plan section 17.2, Phase 15).',
  },
  {
    name: '@bslt/core/consent',
    phase: 15,
    note: 'Deleted with main/server/core/src/consent; use @bslt/compliance (plan section 17.2, Phase 15).',
  },
  {
    name: '@bslt/shared/core/compliance',
    phase: 15,
    note: 'Deleted with main/shared/src/modules/core/compliance; use @bslt/compliance/contract (plan section 17.2, Phase 15).',
  },
  {
    name: '#app/features/content',
    phase: 15,
    note: 'Deleted with main/apps/web/src/features/content; import from @bslt/compliance/web (plan section 17.2, Phase 15).',
  },
  {
    name: 'registerBillingWebhookRoutes',
    phase: 15,
    note: 'Deleted: inbound provider webhooks use contract endpoints with auth: { webhook, rawBody: true } in @bslt/billing (plan section 17.2, Phase 15).',
  },
  {
    name: 'BillingNotifier',
    phase: 15,
    note: 'Deleted with edition-ports.ts; dunning notifications emit via notify metadata on @bslt/billing events (plan section 17.2, Phase 15).',
  },
  {
    name: 'createBillingNotifier',
    phase: 15,
    note: 'Deleted with BillingNotifier; dunning notifications emit via notify metadata on @bslt/billing events (plan section 17.2, Phase 15).',
  },
  {
    name: 'billingRoutes',
    phase: 15,
    note: 'Deleted with main/server/core/src/billing; routes are derived by the module host from billingEndpoints (plan section 17.2, Phase 15).',
  },
  {
    name: 'billingContract',
    phase: 15,
    note: 'Deleted with main/shared/src/contracts/contract.billing.ts; use billingModule.endpoints (plan section 17.2, Phase 15).',
  },
  {
    name: 'createBillingClient',
    phase: 15,
    note: 'Deleted with main/client/api/src/billing; use createEndpointClient(billingModule, transport) (plan section 17.2, Phase 15).',
  },
  {
    name: 'createAdminBillingClient',
    phase: 15,
    note: 'Deleted with main/client/api/src/billing; use createEndpointClient(billingModule, transport) (plan section 17.2, Phase 15).',
  },
  {
    name: '@bslt/core/billing',
    phase: 15,
    note: 'Deleted with main/server/core/src/billing; use @bslt/billing (plan section 17.2, Phase 15).',
  },
  {
    name: '@bslt/shared/core/billing',
    phase: 15,
    note: 'Deleted with main/shared/src/modules/core/billing; use @bslt/billing/contract (plan section 17.2, Phase 15).',
  },
  {
    name: '#app/features/billing',
    phase: 15,
    note: 'Deleted with main/apps/web/src/features/billing; import from @bslt/billing/web (plan section 17.2, Phase 15).',
  },
  // Phase 16: identity, admin, and devtools migration (plan section 17.2, Phase 16).
  {
    name: 'apiKeysContract',
    phase: 16,
    note: 'Deleted with main/shared/src/contracts/contract.api-keys.ts; use identityEndpoints from @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: 'apiKeysRoutes',
    phase: 16,
    note: 'Deleted with main/server/core/src/api-keys; routes register via identityServer from @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createApiKeyRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/api-keys; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createApiKeysClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/api-keys; use createEndpointClient(identityModule, transport) (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/core/api-keys',
    phase: 16,
    note: 'Deleted with main/server/core/src/api-keys; use @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/shared/core/api-keys',
    phase: 16,
    note: 'Deleted with main/shared/src/modules/core/api-keys; use @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: 'usersContract',
    phase: 16,
    note: 'Deleted with main/shared/src/contracts/contract.users.ts; use identityEndpoints from @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: 'userRoutes',
    phase: 16,
    note: 'Deleted with main/server/core/src/users; routes register via identityServer from @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/core/users',
    phase: 16,
    note: 'Deleted with main/server/core/src/users; use @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/core/admin/userService',
    phase: 16,
    note: 'Deleted with main/server/core/src/admin/userService.ts; use @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/core/auth/liveness-cache',
    phase: 16,
    note: 'Deleted with main/server/core/src/auth/liveness-cache.ts; use @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'currentUserProfileQueryKey',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/profile; use identityMeQueryKey from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    name: 'getAuditEventsForDeletedUser',
    phase: 16,
    note: 'Deleted with main/server/core/src/users/data-hygiene.ts; use listActorAuditTrailForExport from @bslt/audit/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createDeviceClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/devices; use useDevices from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    name: 'DeviceClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/devices; use @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: 'createPhoneClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/phone; use usePhone from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    name: 'PhoneClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/phone; use @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: 'createSettingsClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/settings; use useSudo from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    name: 'SettingsClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/settings; use @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: 'webauthnRoutes',
    phase: 16,
    note: 'Deleted with main/server/core/src/auth/webauthn; routes register via identityServer from @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'webauthnRouteEntries',
    phase: 16,
    note: 'Deleted with main/server/core/src/auth/webauthn; routes register via identityServer from @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'factorRouteEntries',
    phase: 16,
    note: 'Deleted with main/server/core/src/auth/routes/factors.ts; routes register via identityServer from @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createTotpBackupCodeRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/auth/totp-backup-codes.ts; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createWebauthnCredentialRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/auth/webauthn-credentials.ts; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'devicesQueryKeys',
    phase: 16,
    note: 'Deleted with main/kernel/react/src/devices; use useDevices from @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    name: 'createRequireTosAcceptance',
    phase: 16,
    note: 'Deleted with main/server/core/src/auth/tos-gating.ts; ToS gating uses CapabilityContext requires: [tos.accepted] (plan section 18.1, Phase 16).',
  },
  {
    name: 'TosAcceptanceRequiredError',
    phase: 16,
    note: 'Deleted with main/server/core/src/auth/tos-gating.ts; assertRequirements emits TOS_ACCEPTANCE_REQUIRED via CapabilityContext (plan section 18.1, Phase 16).',
  },
  {
    name: 'createLegacyContextContributors',
    phase: 16,
    note: 'Deleted from main/apps/server/src/legacy/legacy-modules.ts; identityServer contributes authStrategies and eligibility.emailVerified directly (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/core/auth',
    phase: 16,
    note: 'Deleted with main/server/core/src/auth; use @bslt/identity/server, @bslt/identity/contract, or @bslt/protocols/oauth (plan section 18.1, Phase 16).',
  },
  {
    name: 'createComposedAuthRoutes',
    phase: 16,
    note: 'Deleted with main/apps/server/src/http/auth-route-overrides.ts; identityServer registers all /api/auth* endpoints (plan section 18.1, Phase 16).',
  },
  {
    name: 'recordLegacySecurityAudit',
    phase: 16,
    note: 'Deleted from @bslt/audit/server now that @bslt/identity publishes structured audit events via s.events.publish (plan section 18.1, Phase 16).',
  },
  {
    name: 'oauthQueryKeys',
    phase: 16,
    note: 'Deleted with main/kernel/react/src/oauth; use endpointQueryKey on @bslt/identity/web (plan section 18.1, Phase 16).',
  },
  {
    name: 'OAuthClientConfig',
    phase: 16,
    note: 'Deleted with main/kernel/react/src/oauth; @bslt/identity/web hooks use TransportProvider (plan section 18.1, Phase 16).',
  },
  {
    name: 'createApiClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/api; use createEndpointClient(module, transport) from @bslt/client-engine (plan section 18.1, Phase 16).',
  },
  {
    name: 'getApiClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/api; use module hooks or createEndpointClient(module, useTransport()) (plan section 18.1, Phase 16).',
  },
  {
    name: 'clearApiClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/api; AuthService uses Transport directly without a global ApiClient singleton (plan section 18.1, Phase 16).',
  },
  {
    name: 'createFeatureClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/api/features.ts; use createEndpointClient(module, transport) from @bslt/client-engine (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/web/features/auth',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/auth; import from @bslt/identity/web and @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: '#app/features/auth',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/auth; import from @bslt/identity/web and @bslt/identity/contract (plan section 18.1, Phase 16).',
  },
  {
    name: 'createRepositories',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/factory.ts; @bslt/db owns only kernel system tables and modules own their repositories (plan section 18.1, Phase 16).',
  },
  {
    name: '@bslt/db/factory',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/factory.ts; use module repositories directly (plan section 18.1, Phase 16).',
  },
  {
    name: 'createUserRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/users; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createRefreshTokenRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/auth; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createLoginAttemptRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/auth; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createAuthTokenRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/auth; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createTrustedDeviceRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/auth; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createOAuthConnectionRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/oauth; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'createUserSessionRepository',
    phase: 16,
    note: 'Deleted with main/kernel/db/src/repositories/sessions; use identityRepository in @bslt/identity/server (plan section 18.1, Phase 16).',
  },
  {
    name: 'handleGetAdminHealth',
    phase: 16,
    note: 'Deleted with main/server/core/src/admin/healthHandler.ts; routes register via adminServer (plan section 18.2, Phase 16).',
  },
  {
    name: 'handleGetRouteManifest',
    phase: 16,
    note: 'Deleted with main/server/core/src/admin/route-manifest.ts; routes register via devtoolsServer (plan section 18.2, Phase 16).',
  },
  {
    name: '@bslt/core/admin',
    phase: 16,
    note: 'Deleted with main/server/core/src/admin; use @bslt/admin/server or @bslt/devtools/server (plan section 18.2, Phase 16).',
  },
  {
    name: 'createAdminClient',
    phase: 16,
    note: 'Deleted with main/client/api/src/admin; use createEndpointClient(adminModule, transport) (plan section 18.2, Phase 16).',
  },
  {
    name: 'adminContract',
    phase: 16,
    note: 'Deleted with main/shared/src/contracts/contract.admin.ts; use adminEndpoints / devtoolsEndpoints (plan section 18.2, Phase 16).',
  },
  {
    name: 'jobsContract',
    phase: 16,
    note: 'Deleted with main/shared/src/contracts/contract.jobs.ts; use adminEndpoints in @bslt/admin/contract (plan section 18.2, Phase 16).',
  },
  {
    name: 'systemStatsResponseSchema',
    phase: 16,
    note: 'Deleted drifted legacy admin schema; use adminHealthResponseSchema and adminMetricsResponseSchema in @bslt/admin/contract (plan section 18.2, Phase 16).',
  },
  {
    name: '#app/features/admin',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/admin; import from @bslt/admin/web or #app/app/admin (plan section 18.2, Phase 16).',
  },
  {
    name: '#app/features/settings',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/settings; import from @bslt/{identity,compliance}/web or #app/app/account (plan section 18.2, Phase 16).',
  },
  {
    name: '#app/features/dashboard',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/dashboard; import from #app/app/dashboard or @bslt/web/app/dashboard (plan section 18.2, Phase 16).',
  },
  {
    name: '#app/features/command-palette',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/command-palette; import from #app/app/command-palette (plan section 18.2, Phase 16).',
  },
  {
    name: '#app/features/shared',
    phase: 16,
    note: 'Deleted dead unused web features/shared hooks in Phase 16 (plan section 18.2, Phase 16).',
  },
  {
    name: '#app/demo',
    phase: 16,
    note: 'Deleted with main/apps/web/src/demo; import from @bslt/devtools/web (plan section 18.2, Phase 16).',
  },
  {
    name: '#app/lib/consent',
    phase: 16,
    note: 'Deleted with main/apps/web/src/lib/consent; import from @bslt/compliance/web (plan section 18.2, Phase 16).',
  },
  {
    name: '@bslt/web/demo',
    phase: 16,
    note: 'Deleted with main/apps/web/src/demo; import from @bslt/devtools/web (plan section 18.2, Phase 16).',
  },
  {
    name: '@bslt/web/features/dashboard',
    phase: 16,
    note: 'Deleted with main/apps/web/src/features/dashboard; import from @bslt/web/app/dashboard (plan section 18.2, Phase 16).',
  },
  {
    name: 'CardAsyncState',
    phase: 17,
    note: 'Consolidated into AsyncBoundary in @bslt/ui (plan section 12.4, Phase 17).',
  },
  {
    name: 'LoadingContainer',
    phase: 17,
    note: 'Consolidated into AsyncBoundary in @bslt/ui (plan section 12.4, Phase 17).',
  },
  {
    name: 'SectionErrorBoundary',
    phase: 17,
    note: 'Consolidated into AsyncBoundary in @bslt/ui (plan section 12.4, Phase 17).',
  },
  {
    name: 'ToastContainer',
    phase: 17,
    note: 'Consolidated into Toaster in @bslt/ui (plan section 12.4, Phase 17).',
  },
  {
    name: 'ModalSize',
    phase: 17,
    note: 'Consolidated into Dialog in @bslt/ui (plan section 12.4, Phase 17).',
  },
  {
    name: 'ModalHeightMode',
    phase: 17,
    note: 'Consolidated into Dialog in @bslt/ui (plan section 12.4, Phase 17).',
  },
  {
    name: 'useAppShellPanes',
    phase: 17,
    note: 'IDE four-pane shell deleted; replaced by named shells in main/apps/web/src/app/shells (plan section 12.6, Phase 17).',
  },
  {
    name: 'AppTopLayout',
    phase: 17,
    note: 'Replaced by fixed-height ShellHeader in main/apps/web/src/app/shells/ShellHeader.tsx (plan section 12.6, Phase 17).',
  },
  {
    name: 'AppMainLayout',
    phase: 17,
    note: 'IDE four-pane shell deleted; replaced by named shells in main/apps/web/src/app/shells (plan section 12.6, Phase 17).',
  },
  {
    name: 'AppBottomLayout',
    phase: 17,
    note: 'IDE four-pane shell deleted; AppShell uses BottombarLayout on mobile from slot app.primary (plan section 12.6, Phase 17).',
  },
  {
    name: 'SsrDataProvider',
    phase: 18,
    note: 'Deleted with SsrContext.tsx; PublicRoute<D> passes typed `data` and dehydrates `#__BSLT_STATE__` (plan section 11.3, Phase 18).',
  },
  {
    name: 'useSsrData',
    phase: 18,
    note: 'Deleted with SsrContext.tsx; PublicRoute<D> passes typed `data` and dehydrates `#__BSLT_STATE__` (plan section 11.3, Phase 18).',
  },
  {
    name: 'prerenderSite',
    phase: 18,
    note: 'Deleted with entry-server.tsx; replaced by `prerenderStaticPublicRoutes` + `bslt web prerender` (plan section 11.3, Phase 18).',
  },
  {
    name: 'ServerAppProps',
    phase: 18,
    note: 'Deleted with ServerApp.tsx; replaced by `renderPublic` in @bslt/web-platform (plan section 11.3, Phase 18).',
  },
];

/** Constructs that must not come back, by file and line pattern. */
export const TOMBSTONED_PATTERNS: readonly TombstonedPattern[] = [
  {
    name: 'tsconfig paths and baseUrl',
    files: ['*tsconfig*.json'],
    pattern: '"(paths|baseUrl)" *:',
    phase: 3,
    note: ALIASES,
  },
  {
    name: 'Vite and Vitest resolve aliases',
    files: ['*vite.config.*', '*vitest.config.*', 'main/build-config/src/*'],
    pattern: '(^|[^A-Za-z0-9_])alias *:',
    phase: 3,
    note: ALIASES,
  },
  {
    name: 'hand-written column maps and table names',
    files: ['main/kernel/db/src/schema/*.ts'],
    pattern: "_(COLUMNS|TABLE) = (\\{|')",
    phase: 6,
    note: GENERATED_ROWS,
  },
  {
    name: 'hand-written row types',
    files: ['main/kernel/db/src/schema/*.ts'],
    pattern: '^ +(createdAt|updatedAt)[?]?: Date',
    phase: 6,
    note: GENERATED_ROWS,
  },
  {
    name: 'the REQUIRED_TABLES literal',
    files: ['main/*.ts'],
    pattern: 'REQUIRED_TABLES( *:[^=]*)? *= *\\[',
    phase: 6,
    note: GENERATED_ROWS,
  },
  {
    name: 'a pino dependency',
    files: ['*package.json'],
    pattern: '"pino" *:',
    phase: 12,
    note: 'The server logger is owned code (plan section 13, A1); the lockfile keeps pino only as a fastify dependency until Phase 19.',
  },
  {
    name: 'the otpauth and argon2 npm packages',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"](otpauth|argon2)(/[^\'"]*)?[\'"]',
    phase: 12,
    note: OWNED_TOTP_AND_ARGON2,
  },
  {
    name: 'otpauth or argon2 in a package manifest',
    files: ['*package.json'],
    pattern: '"(otpauth|argon2)"',
    phase: 12,
    note: OWNED_TOTP_AND_ARGON2,
  },
  {
    name: 'the ws, ioredis, and web-push npm packages',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"](ws|ioredis|web-push)(/[^\'"]*)?[\'"]',
    phase: 14,
    note: 'Owned protocols replaced all three in @bslt/protocols/{ws,resp,webpush} (plan section 13, Phase 14).',
  },
  {
    name: 'ws, ioredis, or web-push in a workspace package manifest',
    files: ['main/*package.json', 'tests/package.json'],
    pattern: '"(@types/ws|ws|ioredis|web-push)"',
    phase: 14,
    note: 'Owned protocols replaced all three in @bslt/protocols/{ws,resp,webpush} (plan section 13, Phase 14).',
  },
  {
    name: 'the @aws-sdk/* npm packages',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"]@aws-sdk/',
    phase: 14,
    note: 'Owned S3 & SigV4 client in @bslt/protocols/s3 replaced @aws-sdk/* (plan section 13 B4, Phase 14).',
  },
  {
    name: '@aws-sdk/* in a workspace package manifest',
    files: ['main/*package.json', 'tests/package.json'],
    pattern: '"@aws-sdk/',
    phase: 14,
    note: 'Owned S3 & SigV4 client in @bslt/protocols/s3 replaced @aws-sdk/* (plan section 13 B4, Phase 14).',
  },
  {
    name: 'the sharp npm package',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"]sharp(/|\'|")',
    phase: 14,
    note: 'ffmpeg/ffprobe in main/modules/files/server/media.ts replaced sharp (plan section 13 B5, Phase 14).',
  },
  {
    name: 'sharp in a package manifest',
    files: ['*package.json'],
    pattern: '"sharp"',
    phase: 14,
    note: 'ffmpeg/ffprobe in main/modules/files/server/media.ts replaced sharp (plan section 13 B5, Phase 14).',
  },
  {
    name: 'the stripe and @stripe/* npm packages',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"](stripe|@stripe/)',
    phase: 15,
    note: 'Owned Stripe REST client + HMAC verifier in @bslt/billing/server and hosted checkout replaced stripe/@stripe/* (plan section 13 A8/B6, Phase 15).',
  },
  {
    name: 'stripe or @stripe/* in a package manifest',
    files: ['*package.json'],
    pattern: '"(stripe|@stripe/[^"]+)"',
    phase: 15,
    note: 'Owned Stripe REST client + HMAC verifier in @bslt/billing/server and hosted checkout replaced stripe/@stripe/* (plan section 13 A8/B6, Phase 15).',
  },
  {
    name: 'forwardRef in @bslt/ui',
    files: ['main/kernel/ui/src/**'],
    pattern: 'forwardRef',
    phase: 17,
    note: 'React 19 direct ref props replaced forwardRef across @bslt/ui (plan section 12.3, Phase 17).',
  },
  {
    name: 'Modal.* compound component usage',
    files: ['*.ts', '*.tsx'],
    pattern: 'Modal\\.(Root|Header|Body|Footer|Title|Description|Close)',
    phase: 17,
    note: 'Modal compound components were consolidated into Dialog.* in @bslt/ui (plan section 12.4, Phase 17).',
  },
  {
    name: 'the fastify and fastify-plugin npm packages',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"](fastify|fastify-plugin)(/[^\'"]*)?[\'"]',
    phase: 19,
    note: 'Owned node:http router & lifecycle (`createHttpServer` in @bslt/server-system/http) replaced fastify and fastify-plugin (plan section 13 C1, Phase 19).',
  },
  {
    name: 'fastify or fastify-plugin in a package manifest',
    files: ['*package.json'],
    pattern: '"(fastify|fastify-plugin)"',
    phase: 19,
    note: 'Owned node:http router & lifecycle (`createHttpServer` in @bslt/server-system/http) replaced fastify and fastify-plugin (plan section 13 C1, Phase 19).',
  },
  {
    name: 'Fastify framework type names in TypeScript sources',
    files: ['*.ts', '*.tsx'],
    pattern:
      '(^|[^A-Za-z0-9_])(FastifyInstance|FastifyRequest|FastifyReply|FastifyBaseLogger|LightMyRequestResponse)([^A-Za-z0-9_]|$)',
    phase: 19,
    note: 'Replaced by HttpServer, HttpServerRequest, HttpServerReply, Logger, and InjectResponse in @bslt/server-system/http (plan section 13 C1, Phase 19).',
  },
  {
    name: 'the @simplewebauthn/server npm package',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"]@simplewebauthn/server(/[^\'"]*)?[\'"]',
    phase: 19,
    note: 'Owned WebAuthn verifier in main/modules/identity/server/webauthn.ts on @bslt/protocols/{cbor,cose} + node:crypto replaced @simplewebauthn/server (plan section 13 C2, Phase 19).',
  },
  {
    name: '@simplewebauthn/server in a package manifest',
    files: ['*package.json'],
    pattern: '"@simplewebauthn/server"',
    phase: 19,
    note: 'Owned WebAuthn verifier in main/modules/identity/server/webauthn.ts on @bslt/protocols/{cbor,cose} + node:crypto replaced @simplewebauthn/server (plan section 13 C2, Phase 19).',
  },
  {
    name: 'the postgres npm package',
    files: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    pattern: '(from|import|require|mock) *\\(? *[\'"]postgres(/[^\'"]*)?[\'"]',
    phase: 19,
    note: 'Owned PostgreSQL wire v3.0 driver & pool (`createPgPool` in @bslt/protocols/pg) replaced the postgres npm package (plan section 13 C3, Phase 19).',
  },
  {
    name: 'postgres in a package manifest',
    files: ['*package.json'],
    pattern: '"postgres"\\s*:',
    phase: 19,
    note: 'Owned PostgreSQL wire v3.0 driver & pool (`createPgPool` in @bslt/protocols/pg) replaced the postgres npm package (plan section 13 C3, Phase 19).',
  },
  {
    name: 'an import of deleted @bslt/shared, @bslt/core, or @bslt/api',
    files: [
      '*.ts',
      '*.tsx',
      '*.mts',
      '*.cts',
      '*.js',
      '*.mjs',
      '*.cjs',
      ':(exclude)main/tools/scripts/starter/scope-rename.test.ts',
    ],
    pattern: '(from|import|require|mock) *\\(? *[\'"]@bslt/(shared|core|api)(/[^\'"]*)?[\'"]',
    phase: 20,
    note: 'Horizontal @bslt/shared, @bslt/core, and @bslt/api packages were deleted in Phase 20 (plan section 17.2, Phase 20).',
  },
  {
    name: '@bslt/shared, @bslt/core, or @bslt/api in a package manifest',
    files: ['*package.json'],
    pattern: '"@bslt/(shared|core|api)"\\s*:',
    phase: 20,
    note: 'Horizontal @bslt/shared, @bslt/core, and @bslt/api packages were deleted in Phase 20 (plan section 17.2, Phase 20).',
  },
];

/** Directories (and this file) whose text may still name tombstoned symbols. */
export const ALLOWED_MENTION_PATHS: readonly string[] = [
  'docs/log',
  'docs/archive',
  'docs/architecture/restructure',
  'main/tools/gates/tombstones.ts',
  // The guard of the container entry bootstrap-roles.js, run by path in the image.
  'main/apps/server/src/is-entry-module.ts',
];

/** Tracked files outside `ALLOWED_MENTION_PATHS` whose text contains `symbol`. */
export function trackedFilesMentioning(symbol: string, root: string = REPO_ROOT): string[] {
  const exclusions = ALLOWED_MENTION_PATHS.map((allowed) => `:(exclude)${allowed}`);
  try {
    const output = execFileSync(
      'git',
      ['grep', '-l', '-F', '-e', symbol, '--', '.', ...exclusions],
      { cwd: root, encoding: 'utf8', env: gitEnvironment() },
    );
    return output.split('\n').filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

/** Tracked files (outside `ALLOWED_MENTION_PATHS`) with a line matching the pattern. */
export function trackedFilesMatching(entry: TombstonedPattern, root: string = REPO_ROOT): string[] {
  const exclusions = ALLOWED_MENTION_PATHS.map((allowed) => `:(exclude)${allowed}`);
  try {
    const output = execFileSync(
      'git',
      ['grep', '-l', '-E', '-e', entry.pattern, '--', ...entry.files, ...exclusions],
      { cwd: root, encoding: 'utf8', env: gitEnvironment() },
    );
    return output.split('\n').filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

/** Tombstoned paths that exist under `root`, and tombstoned scripts its package.json defines. */
export function findRevivedPathsAndScripts(root: string = REPO_ROOT): string[] {
  const problems = TOMBSTONED_PATHS.filter((entry) => existsSync(path.join(root, entry.path))).map(
    (entry) =>
      `${entry.path} exists again (deleted in Phase ${String(entry.phase)}: ${entry.note})`,
  );
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const defined = new Set(Object.keys(pkg.scripts ?? {}));
  for (const entry of TOMBSTONED_ROOT_SCRIPTS) {
    if (defined.has(entry.name)) {
      problems.push(
        `root script "${entry.name}" is defined again (deleted in Phase ${String(entry.phase)}: ${entry.note})`,
      );
    }
  }
  return problems;
}

function trackedFilesMentioningAny(symbols: readonly string[], root: string): string[] {
  if (symbols.length === 0) return [];
  const exclusions = ALLOWED_MENTION_PATHS.map((allowed) => `:(exclude)${allowed}`);
  const patternArgs = symbols.flatMap((symbol) => ['-e', symbol]);
  try {
    const output = execFileSync(
      'git',
      ['grep', '-l', '-F', ...patternArgs, '--', '.', ...exclusions],
      { cwd: root, encoding: 'utf8', env: gitEnvironment() },
    );
    return output.split('\n').filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

/** The `tombstones` gate. */
export function run(root: string = REPO_ROOT): CheckResult {
  const problems = findRevivedPathsAndScripts(root);
  const symbolCandidates = trackedFilesMentioningAny(
    TOMBSTONED_SYMBOLS.map((entry) => entry.name),
    root,
  );
  if (symbolCandidates.length > 0) {
    for (const entry of TOMBSTONED_SYMBOLS) {
      for (const file of trackedFilesMentioning(entry.name, root)) {
        problems.push(`${file} names "${entry.name}" (deleted in Phase ${String(entry.phase)})`);
      }
    }
  }
  for (const entry of TOMBSTONED_PATTERNS) {
    for (const file of trackedFilesMatching(entry, root)) {
      problems.push(
        `${file} has ${entry.name} (removed in Phase ${String(entry.phase)}: ${entry.note})`,
      );
    }
  }
  const checked =
    TOMBSTONED_PATHS.length +
    TOMBSTONED_ROOT_SCRIPTS.length +
    TOMBSTONED_SYMBOLS.length +
    TOMBSTONED_PATTERNS.length;
  return problems.length === 0
    ? pass(`none of ${String(checked)} tombstoned paths, scripts, symbols and patterns is back`)
    : fail(
        `${String(problems.length)} tombstoned path(s), script(s), symbol(s) or pattern(s) are back`,
        problems,
      );
}
