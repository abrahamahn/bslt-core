# bslt-main restructure

Working documents for turning bslt-main into a generic, reusable TypeScript platform foundation.
After the foundation is tagged `foundation-v1`, it is forked into a separate repository for a
live-first hybrid creator platform. Creator-specific work does not belong in this repository.

| Document                                         | What it is                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`restructure-plan.md`](./restructure-plan.md)   | The adopted design and the 21-phase plan (Phase 0 to Phase 20), with exit criteria. Start here.                                           |
| [`fragmentation-map.md`](./fragmentation-map.md) | Evidence: a read-only map of the codebase at `ff07d363` (9 root causes, 22 ranked problems, 157 findings with paths, per-feature traces). |
| [`stack-review.md`](./stack-review.md)           | Stack-fit review for the creator platform: per-layer verdicts, what belongs in the foundation, vendor acceptable-use fact-checks.         |
| [`ownership-rescore.md`](./ownership-rescore.md) | The stack review re-scored under the dependency-ownership rule, with the runtime dependency replacement list and order.                   |

These are snapshots from 2026-11-10. Paths in them refer to the tree at `ff07d363`. Phase 20
replaces them with generated references.

## Binding owner decisions

- Own every runtime dependency except `react` and `react-dom`. Dev tooling is exempt. No new npm
  runtime packages; external services sit behind owned ports and are called over HTTP.
- Extract and freeze the Core/Pro editions, storefront, feature packs, recipes and prune tooling.
  A frozen local copy exists as `bslt-distribution` (tag `frozen-2026-11-10`, not pushed).
- Move `main/apps/server-rust` and the web `rust-access` feature to the Kanu repository. A local
  branch `import/bslt-server-rust` holds them there, with history (not pushed).
- Migrations get a clean per-module baseline reset. No deployed data must survive.
- One flat `public` Postgres schema. Module ownership is expressed with `<module>_` table prefixes
  and module-owned migration files, not with a schema per module.
- Security defects are fixed before any structural move (Phase 0).
- Server-side rendering for public routes only, through an owned seam. The logged-in app stays an SPA.
- WCAG-compliant control contrast over the hairline look.
- After `foundation-v1`, a distribution channel on the module system (owner direction, 2026-11-12):
  Core is free, and extra features are bought and installed as plug-in modules in one step. The
  extracted `bslt-distribution` code is not brought back, because it edited source text; the module
  system is the precondition. It is not one of the 21 phases. See plan section 15.3 and owner
  decision D14.

## Rules for anyone continuing this work

- `main` is the only branch, locally and on GitHub (owner decision, 2026-11-15); work lands on it
  directly. While GitHub Actions budget is unavailable, the `Deploy` workflow (`deploy.yml`) is
  disabled and accepted `main` commits deploy to the DigitalOcean demo droplet (`app.bslt.dev`)
  through the workstation runner (`utility/auto-deploy`, running `infra/docker/demo/remote-deploy.sh`
  in `loaded` mode after `bslt gate merge` and `test:real-db`; see
  [`docs/deploy/demo-manual-deploy.md`](../../deploy/demo-manual-deploy.md)). Every push to `main`
  must leave the merge gate, the real-DB suite and the e2e suite green.
  (Until Phase 1 a push also published Core to the public `bslt-core` repository; that workflow is
  deleted.)
- Workstation sessions do not create or push `claude/**` branches (`main` is updated directly).
  Cloud coding sandboxes whose git proxy forbids direct pushes to `main` push to their assigned
  session branch and open a pull request into `main` for a workstation session to land and delete
  (see [`AGENTS.md`](../../../AGENTS.md)).
- Follow [`AGENTS.md`](../../../AGENTS.md) and [`docs/specs/principles.md`](../../specs/principles.md):
  failing test first, no escape hatches, small reversible changes.

## Current status: Phase 20 — Complete, tagged `foundation-v1` (2026-11-21)

All 21 phases (`Phase 0` through `Phase 20`) are complete on `main` and tagged `foundation-v1`. For the live workspace inventory and generated reference suite (`pnpm bslt sync docs`), see [`docs/DIRECTION.md`](../../DIRECTION.md).

## Phase 20, Delete legacy, docs, ops hardening and tag foundation-v1 (2026-11-21, done)

On `main`, on top of Phase 19 (`CURRENT_PHASE = 20`), closing out the 21-phase modular restructure (plan sections 14, 15, 16, and 17.2 Phase 20):

- **Slice 20.1 (`83f9e5ebe`):** Deleted horizontal legacy packages and shims (`main/shared`, `main/server` / `@bslt/core`, `main/client` / `@bslt/api`, `main/apps/{server,web}/src/legacy`, `main/kernel/db/legacy-migrations`), retired coexistence `frozen-paths`, pruned workspace unused exports from `574 -> 0`, and locked `"unused-exports": 0` in `main/tools/gates/ratchets/budgets.json`.
- **Slice 20.2 (`cceb55dd4`):** Shipped `@bslt/protocols/otlp` + opt-in `startOtlpHttpTelemetry` (`OTEL_EXPORTER_OTLP_ENDPOINT`), locked SHA-256 checksums for all 16 baseline SQL migrations in `bslt.lock.json` (enforced by `@bslt/db`'s migration runner), shipped in-network `AES-256-GCM` (`BSLTBK01`) PostgreSQL backups + S3 SigV4 upload + PITR WAL hooks + automated restore drill (`infra/runtime/backup/` + `backup-restore-drill.real-db.test.ts`), retired `.github/workflows/database-backup.yml` (leaving only `ci.yml` and `deploy.yml`), and wired Prometheus `alerts.yml` (`EventLoopLagHigh`, `DeadBackgroundJobs`, `BackupStale`) into `deploy.yml`.
- **Slice 20.3 (`foundation-v1`):** Added `pnpm bslt sync docs` (`main/tools/sync/docs.ts`, `generated-docs` merge gate #49) generating `docs/reference/{api,database,events-jobs-cron,web-routes,module-dag}.md` and the `docs/DIRECTION.md` status block with strict attribution and orphan enforcement; wrote canonical [`docs/specs/modules.md`](../../specs/modules.md) and [`docs/specs/data.md`](../../specs/data.md); rewrote [`docs/specs/principles.md`](../../specs/principles.md), [`docs/DIRECTION.md`](../../DIRECTION.md), and [`AGENTS.md`](../../../AGENTS.md); archived historical pre-restructure docs to `docs/archive/`; and tagged `foundation-v1`.

## Phase 19, Runtime deps tranche C (2026-11-21, done)

On `main`, on top of Phase 18. `CURRENT_PHASE` was `19`; it moves to `20` as Phase 20 starts. Phase 19
replaced the final three runtime npm dependency groups (`fastify` + `fastify-plugin`,
`@simplewebauthn/server`, and `postgres`) with owned implementations and moved exempt dev-tooling
packages (`@eslint/*`, `eslint*`, `typescript-eslint`, `vite`, `vitest`) to `devDependencies`,
reducing `main/tools/gates/deps-allowlist.json` to ONLY `["react", "react-dom"]` (plan sections 13 and
17.2 Phase 19):

- **C1 (`fastify`, `fastify-plugin` -> `@bslt/server-system/http`, `d1c06d785`):** owned `node:http`
  radix-tree router, content-type parser pipeline, request/reply lifecycle hooks, encapsulated plugin
  scoping, and in-memory `inject()` harness (`createHttpServer`), pruning 45 transitive npm packages.
- **C2 (`@simplewebauthn/server` -> `@bslt/protocols/{cbor,cose}` + `@bslt/identity/server`,
  `970a7cee2`):** definite-length RFC 8949 CBOR codec with deterministic §4.2 encoding (`cbor.ts`),
  RFC 9052 / RFC 9053 `COSE_Key` parser and signature verifier (`cose.ts` for ES256 `-7`, EdDSA `-8`,
  RS256 `-257`), and owned WebAuthn Level 3 `"none"`-attestation and assertion ceremonies (D11),
  pruning 25 transitive npm packages.
- **C3 (`postgres` -> `@bslt/protocols/pg` behind `RawDb`):** owned PostgreSQL wire v3.0 driver and
  connection pool (`createPgPool` in `main/kernel/protocols/src/pg.ts`) over `node:net` and `node:tls`
  supporting `SSLRequest`, mutual `SCRAM-SHA-256` / MD5 / cleartext auth, Simple Query (`Q`) + Extended
  Query (`Parse`/`Bind`/`Describe`/`Execute`/`Sync`) + pipelined `batch()`, wire `CancelRequest` on
  `AbortSignal`, `int8 -> bigint` / `timestamptz` / `numeric` / `jsonb` / `bytea` / array codecs,
  `begin()` + `savepoint()`, and dedicated `LISTEN` / `NOTIFY` sessions.

## Phase 18, Public SSR seam (2026-11-21, done)

On `main`, on top of Phase 17. `CURRENT_PHASE` was `18`; it moves to `19` as Phase 19 starts. Phase 18
implemented the owned public-only SSR seam and `PROCESS_ROLE=web` runtime, generated Caddy and server
CSP/Permissions-Policy headers, hardened the PWA service worker and manifest, added Lighthouse budgets
for the public entry, retired the Cloudflare static-assets deploy job (D7), and deleted the legacy
`ServerApp`/`entry-server` prerender scaffolding (plan sections 11.3, 14.2, 14.5, and 17.2 Phase 18):

- Kernel Public SSR seam (`@bslt/web-platform`, `main/kernel/web/src/ssr/public-route.tsx`) &
  `ssr-public-only` gate (`main/tools/gates/ssr-public-only.ts`): `PublicRoute<D>`, `definePublicRoute`,
  `AnonymousSdk` (type-filtered and runtime Proxy-enforced to `auth: 'public'` + `cache.public`, zero
  cookies/auth headers), `renderPublic` (per-request `QueryCache`, `#__BSLT_STATE__` escaping, head/JSON-LD
  injection, logged-in route exclusion), `hydratePublic` (`hydrateRoot` with zero client remount), and
  runtime `/sitemap.xml` + `/robots.txt` builders.
- Consumers, `PROCESS_ROLE=web` server, `entry-public.tsx`, & `bslt web prerender`: `status`,
  `compliance` legal pages, `support`, `moderation` (`/report`), and landing `PublicRoute` definitions;
  lean `entry-public.tsx` hydration bundle; self-contained `node:http` `serve.ts` (`SITE_URL` production
  boot check, immutable `/assets/*`, `/sitemap.xml`, SPA fallback); `bslt web prerender`; Node 24
  `Dockerfile.web` runner + Caddy `@public_ssr` routing; Cloudflare `web` deploy job, `wrangler.jsonc`,
  `_headers`, and `infra/docker/nginx.conf` retired; `bslt sync csp` (`generated-csp` gate replacing
  `csp-sync`); hardened `sw.js` (fingerprinted-only caching, `no-store`/`private` honoured, logout
  `CLEAR_CACHE`) + completed `manifest.json`; `config/lighthouse-budget.json` + `.lighthouserc.json` +
  `bundle-size` public-entry check; and `docs/DIRECTION.md` rendering section rewritten.

## Phase 17, UI system and named shells (2026-11-21, done)

On `main`, on top of Phase 16. `CURRENT_PHASE` was `17`; it moves to `18` as Phase 18 starts. Phase 17
consolidated `@bslt/ui` tokens, recipes, layout primitives, owned SVG icons, and consolidated
Dialog/Toast/AsyncBoundary primitives; wired the four named shells (`PublicShell`, `AuthShell`,
`AppShell`, `ConsoleShell`) across every `WebRoute` and deleted the legacy four-pane IDE shell; and
locked in accessibility, catalog story coverage, and single-locale i18n gates (plan sections 12 and
17.2 Phase 17):

- Tokens, icons & primitives (`@bslt/ui`): brand accent scale (50–950 + on-accent) sourced from
  `bslt.config.ts`, `--ui-z-*` / `--ui-elevation-*` / motion / display / aspect tokens, `@layer
ui.tokens, ui.base, ui.recipes, ui.utilities, app`, layout primitives (`Stack`, `Inline`, `Grid`,
  `Cluster`, `Center`, `AspectRatio`), `PageShell`/`PageHeader`, `StatusBadge` neutral tones, owned
  SVG icon set (`main/kernel/ui/icons/*.svg` + `bslt sync icons`), React 19 ref props (`forwardRef`
  removed and tombstoned across all 53 files), `inline-style` ratchet driven to `0`, and 8 non-`en-US`
  locale maps deleted.
- Named shells (`@bslt/web-platform`, `@bslt/react/router`, `@bslt/web`): pathless layout routes in
  `@bslt/react/router`, mandatory `WebRoute.shell` partitioning across `PublicShell`, `AuthShell`,
  `AppShell` (fixed top bar, responsive left nav, mobile `BottombarLayout` from `app.primary`), and
  `ConsoleShell` (sole resizable pane shell), `ui-*` DS shell CSS prefixes (CLI-05), shell auth guard
  replacing `@bslt/ui`'s `ProtectedRoute`, and deletion + tombstoning of `main/apps/web/src/app/layouts/*`.
- Accessibility & catalog regression surface: `eslint-plugin-jsx-a11y` across JSX files,
  `react/jsx-no-literals` + attribute literal ban across `main/modules/**/web/**`, `.ui-*` selector
  override ban outside `main/kernel/ui`, all 4 CSS lint gates expanded to `main/modules`, 100%
  `@bslt/ui` story coverage (87 stories) enforced by `bslt sync stories` / `generated-stories`,
  Playwright light/dark story screenshots, and axe e2e gate tightened to `serious = 0`.

## Phase 16, Wave D (identity, admin, devtools) (2026-11-21, done)

On `main`, on top of Phase 15. `CURRENT_PHASE` was `16`; it moves to `17` as Phase 17 starts. Wave D
migrated the final three foundation modules (`identity`, `admin`, and `devtools`) into
`main/modules/{identity,admin,devtools}`, dissolved `main/server/core`, `main/apps/web/src/features`,
and `main/apps/web/src/demo`, emptied every server/web/cron/context/migration legacy shim list, and
drove `legacy-shim`, `db-legacy-names`, `raw-sql-outside-repos`, `swallowed-catch`, and
`opaque-schema` all to `0` (plan sections 17.2 Phase 16 and 18.2):

- `@bslt/identity` (`main/modules/identity`): unified auth, users, sessions, devices, OAuth, MFA
  (TOTP + SMS + backup codes), WebAuthn passkeys, sudo elevation, email-change revert, lockout, and
  scoped sudo-gated API keys over `identity_users` and module-owned `identity_*` tables with forced
  RLS, `privacy` export/erase hooks, and `identityWeb` forms/pages/settings sections, deleting
  `core/{auth,users,api-keys}`, `client/api` identity clients, `kernel/db/src/factory.ts`, and
  `legacy-migrations/identity`.
- `@bslt/admin` (`main/modules/admin`) & `@bslt/devtools` (`main/modules/devtools`): dissolved
  legacy admin into module `admin` contributions plus console residue (`admin` users, kernel health,
  metrics, jobs, and outbox monitoring) and the `devOnly` `@bslt/devtools` module (live composed
  route manifest explorer and UI component catalog), deleting `core/admin`, `features/*`, and
  `demo/*`.
- Ratchets driven to zero & frozen paths lowered: `legacy-shim` 57 -> 0, `db-legacy-names` -> 0,
  `raw-sql-outside-repos` -> 0, `swallowed-catch` -> 0, `opaque-schema` -> 0, `frozen-paths` -> 184
  files, `inline-style` 125 -> 36, `unused-exports` -> 447.

## Phase 15, Wave C (compliance, orgs, entitlements, billing) (2026-11-19, done)

On `main`, on top of Phase 14 (`c3c29815a`). `CURRENT_PHASE` was `15`; it moves to `16` as Phase 16
starts. Wave C migrated `compliance`, `orgs`, `entitlements`, and `billing` into
`main/modules/{compliance,orgs,entitlements,billing}`, deleted `@bslt/workers`, and removed runtime
dependencies `stripe`, `@stripe/stripe-js`, and `@stripe/react-stripe-js` (plan sections 13, 17.2
Phase 15, and 18.2):

- `@bslt/compliance` (`main/modules/compliance`): legal documents (`compliance_legal_documents` +
  seeds), ToS acceptance (`tos.accepted`), consent (`compliance_consents`), GDPR export/erase
  orchestrator over the kernel `privacy` slot across every module with user data, retention and
  legal holds, `AgeAssuranceProvider` (`age.verified:<n>`), and `@bslt/workers` deletion.
- `@bslt/orgs` (`main/modules/orgs`): full `tenant -> org` rename across SQL (`orgs`,
  `orgs_members`, `orgs_roles`, `orgs_invitations`), contracts, and UI; personal org provisioning
  on `identity.user.registered`; append-only `bslt.lock.json` permission bits; and `actingOrg`
  session context.
- `@bslt/entitlements` (`main/modules/entitlements`): generic organization-scoped
  `entitlements_grants`, grant/revoke/check APIs, `context` slot capability contributions, and
  `entitlement:<key>` endpoint requirements with real-DB denial proof.
- `@bslt/billing` (`main/modules/billing`): organization-owned `billing_plans`,
  `billing_subscriptions`, `billing_customer_mappings`, `billing_invoices`,
  `billing_payment_methods`, insert-first `billing_payment_inbox`, and `billing_usage_*` tables
  with `ON DELETE RESTRICT` on financial mirrors; `PaymentIngress` / `HostedCheckout` ports and
  TEXT provider registry; owned REST Stripe + PayPal + Mock adapters; contract-backed webhook
  endpoints (`auth: { webhook, rawBody: true }`) via the `verifiers` slot; entitlement grant sync;
  and dunning notifications via `notify` event metadata, deleting `core/billing`,
  `registerBillingWebhookRoutes`, `edition-ports.ts`, and `BillingNotifier`.

## Phase 14, Wave B (audit, notifications, files, moderation) (2026-11-19, done)

On `main`, on top of Phase 13 (`b7aba12e9`). `CURRENT_PHASE` was `14`; it moves to `15` as Phase 15
starts. Wave B migrated `audit`, `notifications`, `files`, and `moderation` into
`main/modules/{audit,notifications,files,moderation}`, built four owned protocol subpaths in
`@bslt/protocols`, and removed all seven Phase 14 runtime dependencies (`ws`, `web-push`,
`ioredis`, `@aws-sdk/client-s3`, `@aws-sdk/credential-providers`, `@aws-sdk/s3-request-presigner`,
`sharp`) with tombstones for every deleted legacy path and symbol:

- `@bslt/audit` (`main/modules/audit`): append-only `audit_log` (including `'kyc_access'` and
  `'trust_safety'` categories) and `audit_activity` projections via `onFlagged('audit')` and
  `onFlagged('activity')`, console security event queries, and WORM-ready archival jobs, deleting
  `core/{audit,activities}` and inline `logActivity` / `record()` call sites.
- `@bslt/protocols/{ws,resp,webpush,s3}` + `@bslt/realtime` + `@bslt/storage`: owned RFC 6455
  WebSocket framing, RESP2/RESP3 client, RFC 8291 / RFC 8292 VAPID + Web Push encryption, and AWS
  Signature V4 S3 client (presigning + multipart uploads); one-time realtime connection tickets,
  typed deny-by-default channel registry, upload sessions, and `@bslt/client-engine`
  `uploadFileResumable`.
- `@bslt/notifications` (`main/modules/notifications`): unified `notify()` projection over
  `onFlagged('notify')` and `notificationKinds` templates, user notification preferences, Web Push
  subscriptions, and RFC 8058 HMAC one-click email unsubscribes, deleting `core/notifications`,
  `tryNotification`, and `notifyAdmins`.
- `@bslt/files` (`main/modules/files`): unified asset state machine (`files`, `files_variants`,
  `files_upload_sessions`, `files_avatars`), `ffmpeg`/`ffprobe` media processing on the `media`
  queue replacing `sharp`, taxonomy-free `audience_level` + `sys_apply_audience` fail-closed RLS,
  `ContentScanner` port with magic-byte/MIME/size checks, `legal_hold`/`retain_until` delete
  protection, manifest `csp` merge, and `/api/media/*` contract endpoints, deleting `core/files`,
  `main/server/media`, `apps/server/src/http/media`, legacy avatar upload handlers, and
  `MediaGallery`.
- `@bslt/moderation` (`main/modules/moderation`): native trust-and-safety module with public
  no-login notice intake (`/report`), cases, mandatory Statements of Reasons decisions, user
  appeals (`/moderation/appeals`), moderator queue (`/admin/moderation`), `'moderator'` `Auth`
  level, kernel `actions` slot (`files.quarantine` wired first), and fail-closed
  `ModerationProvider` port.
- Ratchets & frozen paths lowered: `frozen-paths` -> 917 files, `db-legacy-names` 43 -> 37,
  `legacy-shim` 158 -> 128, `opaque-schema` 374 -> 352, `raw-sql-outside-repos` -> 116,
  `swallowed-catch` 119 -> 72, `unused-exports` 711 -> 667.

| Check (2026-11-19, Phase 14 closeout)                     | Result                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`                    | 47 of 47 gates                                                                                            |
| `pnpm bslt db audit` & `pnpm bslt db catalog --check`     | 54 tables of 15 sources attributed and equal to class; 25 owner tables isolated; catalog matches snapshot |
| `REQUIRE_REAL_DB=1 pnpm test:real-db` on PostgreSQL 17.11 | 61 files, 934 tests, 0 failed                                                                             |
| `pnpm test:postgres-smoke` on PostgreSQL 17.11            | 1 file, 9 tests, 0 failed                                                                                 |

## Phase 13, Wave A (support, status, search, analytics) (2026-11-17, done)

On `main`, on top of Phase 12 (`7e02c020c`). `CURRENT_PHASE` was `13`; it moves to `14` as Phase 14
starts. Wave A migrated the four lowest-blast-radius modules of plan section 17.2 into
`main/modules/*` with owned `@bslt/schema` combinator contracts, module-owned migrations, RLS
isolation suites, and tombstones for every deleted legacy path and symbol:

- `@bslt/support` (`main/modules/support`): ticket creation, replies, status updates, and platform
  support console over `support_tickets` and `support_messages` with forced `owner_user` / `console`
  RLS and support email notifications via `@bslt/comms`.
- `@bslt/status` (`main/modules/status`): public health summary (`cache: { public: 30 }`) and live
  incident feed over `status_incidents` with console incident management and module-host health
  aggregation (`KernelHealthSummary`).
- `@bslt/search` (`main/modules/search`): PostgreSQL full-text search (`websearch_to_tsquery` +
  `ts_rank`) over `search_documents` with per-module `searchable` descriptors, replacing the
  `Meilisearch` / `Elasticsearch` provider shells.
- `@bslt/analytics` (`main/modules/analytics`): consent-gated client batch ingestion,
  `onFlagged('analytics')` domain-event subscriber, monthly range-partitioned `analytics_events`
  with partition-management and retention crons, and console summary queries.
- Kernel & cloud hardening: optional viewer resolution (`authenticateOptional`) on uncached public
  module endpoints, isolated real-DB teardown timeouts, tracked `AGENTS.md` + `.claude/settings.json`
  `SessionStart` cloud bootstrap, and `pre-push` shallow-clone fallback.
- Ratchets lowered: `db-legacy-names` 45 -> 43, `inline-style` 130 -> 125, `legacy-shim` 177 -> 158,
  `opaque-schema` 388 -> 374, `swallowed-catch` 120 -> 119, `unused-exports` 718 -> 711.

| Check (2026-11-17, at `b7aba12e9` + `sessions.e2e.ts` fix) | Result                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`                     | 47 of 47 gates                                                                                                 |
| `pnpm bslt db audit --db` & `pnpm bslt db catalog --check` | 48 tables of 14 sources attributed and equal to class; 21 owner tables isolated; catalog matches snapshot      |
| `REQUIRE_REAL_DB=1 pnpm test:real-db` on PostgreSQL 17.11  | 56 files, 885 tests, 0 failed                                                                                  |
| `pnpm test:postgres-smoke` on PostgreSQL 17.11             | 1 file, 9 tests, 0 failed                                                                                      |
| `pnpm test:e2e`, starter configuration                     | 333 passed, 92 skipped in 8-worker sweep; `account.e2e.ts` + fixed `admin/sessions.e2e.ts` 20 of 20 in CI mode |

## Phase 12, runtime deps tranche A (2026-11-15, done)

On `main`, on top of Phase 11 (`df0d85a0d`). `CURRENT_PHASE` is `12`; it moves to `13` when Phase 13
starts. The ten runtime packages of plan section 13, A1 to A7, are replaced by owned code, each with
its old adapter deleted and tombstoned in the same change, and are gone from every `package.json`
and from `deps-allowlist.json` (the lockfile keeps `pino` only as a dependency of `fastify` until
Phase 19):

- A1 `pino`, `pino-pretty`: an owned JSON logger in `@bslt/server-system`; 51 call forms recorded
  from pino 10.4.0 pin the line shape. `pino-pretty` had no call site; the dev runner and
  `developmentFormatter` stay the pretty printers.
- A2 `@fastify/compress`: br/gzip negotiation on `node:zlib`
  (`main/apps/server/src/middleware/compression.ts`); request-body decoding is kept, bounded by the
  body limit.
- A3 `otpauth`: `@bslt/protocols/totp`, the first subpath of the new kernel package, with the RFC
  6238 and RFC 4226 vectors.
- A4 `argon2`: `node:crypto` argon2id with today's parameters and PHC strings, so every existing
  hash still verifies; RFC 9106 vectors and hashes recorded from the npm package.
- A5 `@sentry/react`, `@sentry/node`: server 5xx and crashes are logger error events; browsers that
  consented to analytics send masked reports to `POST /api/platform/errors`.
- A6 `@fastify/swagger`, `@fastify/swagger-ui`: `docs/reference/openapi.json`, written by
  `pnpm bslt sync openapi` and checked by the `generated-openapi` gate; `/api/docs/*` is gone.
- A7 `@simplewebauthn/browser`: `navigator.credentials` with an owned codec
  (`main/apps/web/src/lib/webauthn.ts`) producing the JSON `@simplewebauthn/server` reads.

| Check (2026-11-15, at `f7852bd78`)                              | Result                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm bslt gate merge`                                          | 47 of 47 gates                                              |
| `pnpm test:real-db` on PostgreSQL 17.11                         | 52 files, 871 tests                                         |
| `pnpm test:e2e`, starter configuration (passkey specs included) | 336 passed, 92 skipped, 0 failed                            |
| `pnpm test:e2e`, the three toggles on                           | 369 passed, 64 skipped, 1 failed: the flake fixed below     |
| The mocked-login specs, ten repeats each                        | 240 of 240 after the fix (SMS 2FA failed 3 of 10 before it) |
| `docker build` of `Dockerfile` and `Dockerfile.web`             | both images build                                           |

Found while verifying, and fixed: the mocked-login specs left `GET /api/platform/context` to the
real server with a fake token, so the client signed the mocked user out whenever that 401 won the
race (since Phase 11); and the error handler logged the request URL with its query string, which can
carry a reset or magic-link token.

### Owner decisions after Phase 12 (2026-11-16, all applied)

- **The crash-report body skips the injection filter.** `POST /api/platform/errors` alone carries the
  route option `skipBodyInjectionFilter`; its query and params are still checked, and its body is
  still sanitized, schema-checked, size- and rate-limited and only logged. Minified stack traces
  (Rollup chunk names use `--`) were refused with a 400 before.
- **Crash reports need analytics consent**, as plan section 13 says ("consent-gated"); this
  supersedes D3 (crash capture for everyone as a legitimate interest). The reporter is unchanged; the
  consent banner, the settings toggle and the cookie policy say crash reports are part of analytics
  consent. The privacy policy template in the compliance seed is not edited; its wording waits for a
  published version 2.
- **Unhandled promise rejections end the API process** and Docker restarts it (fail fast), as Node
  does by default. Kept as built.
- **Log redaction is widened.** The logger censors every name in the shared `SENSITIVE_KEYS`, its
  only list, in any case and with or without `-` and `_`, at any depth and inside arrays, never
  touching the logged object. Names match exactly, not by suffix; the set and what stays visible are
  in `docs/deploy/observability.md` ("Log redaction").

## Phase 11, capability context, flags module, process roles (2026-11-15, done)

Branch `main` since 2026-11-15: `fix/security-defects-tamrnu` was merged into it (`16b7fccf6`) and
the work continues there. On top of Phase 10 (`bc2d182cf`). `CURRENT_PHASE` was `11`.

Steps 11.0 to 11.4: `CapabilityContribution` aggregation, `GET /api/platform/context`, typed
requirement 403s in the guard chain and the `@bslt/client-engine` requirement interceptor;
`@bslt/flags` (`flags` + `flags_overrides`, manifest `flags` field, `context` slot, admin
contribution); the ToS gate as `tos.accepted` via legacy context; `PROCESS_ROLE` startup with
role-labelled histograms and event-loop lag metrics; and `CapabilityProvider` in place of
`app/capabilities.ts`, `main/profiles`, both `profile.generated.ts`, `isServerCapabilityEnabled`,
`optional-import.ts`, `profile-boundaries` and every `VITE_ENABLE_*` flag (plan sections 6.3,
10.1–10.3, 11.1, 17.2 Phase 11, and 18.2).

Step 11.5, the browser verification, found defects that no merge gate or real-DB suite could see.
They are fixed:

- **The e2e suite collected 0 tests from Phase 8 until 2026-11-15**, so Phases 8 to 11 had never
  run in a browser. A spec imports a source-only export of `@bslt/web`; `test:e2e` now runs
  Playwright with `NODE_OPTIONS=--conditions=source`.
- **CI's `e2e` job could not start the API** (no `JWT_SECRET` on a fresh checkout). It writes the
  development env first, and a second step runs the flag-gated specs with the three
  `E2E_ENABLE_*` toggles on. No workflow of this branch has run on GitHub yet.
- **A signed-in viewer kept the anonymous context until a reload**, and **a flag-gated URL was
  resolved before the viewer's context had loaded**. `/settings/billing` after sign-in or on a
  reload was replaced by `/settings` for good; `/activities` and `/billing/*` showed NotFound and
  `/admin/<child>` a blank outlet until the context arrived. `ClientEnvironment` now reports a
  viewer as pending while its session hydrates, `CapabilityProvider` reports `'loading'` until the
  context is that viewer's (one 5 s attempt plus one retry; an answer for another viewer is an
  error), and while it loads `AppRoutes` renders `createPendingAppRoutes`: every route with a
  `when` keeps its slot with a placeholder, so no URL is decided early. Ungated pages are
  unchanged.
- **A signed-out visitor never got a runtime flag.** The `flags` context slot now evaluates an
  anonymous viewer: each row's untargeted global value; org overrides, allow-lists and rollouts
  below 100% apply to signed-in viewers only. A module's anonymous read (`k.db.viewer(null)`) runs
  as `bslt_app` with no user id, never as the worker, and the kernel refuses a viewer read without
  a host runner. Flag keys and their global values are readable without signing in (documented in
  the flags README). Approved by the owner on 2026-11-15 as a change to the database-role wiring.
- **The `E2E_ENABLE_*` toggles only un-skipped specs.** globalSetup now reconciles the `flags.*`
  rows of the run's database to the toggles (`syncE2eRuntimeFlags`), and
  `system/runtime-flags.e2e.ts` checks the served context signed out and signed in.
- **The billing e2e mock answered a plan change with the response shape of before 2026-07-07**, so
  the upgrade and downgrade specs could not pass; the specs skip by default, so nothing showed it.

| Check (2026-11-15, at `5c1a24c0b`)                               | Result                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Old paths deleted and tombstoned; `git grep VITE_ENABLE_` code   | `main/profiles` and the rest are gone; 0 matches outside docs and the tombstone list                                |
| Server context and SPA guards agree (contract test)              | `guard-agreement.integration.test.ts` passes                                                                        |
| A smoke test boots every role                                    | `composition.real-db.test.ts` (in the real-DB suite)                                                                |
| `pnpm bslt gate merge` (46 gates)                                | 45 pass. `test` fails only on the two workflow tests that run `jq`, which this machine lacks                        |
| `pnpm test:real-db` on PostgreSQL 17.11                          | 52 files, 871 tests                                                                                                 |
| `pnpm test:e2e`, starter configuration, clean worktree           | 336 passed, 92 skipped, 0 failed; no `flags.*` row left in the database                                             |
| `pnpm test:e2e`, the three toggles on, one worker (CI's setting) | 369 passed, 64 skipped, 1 failed: the known intermittent sign-out after register-and-login (below), 60/60 on repeat |

### Open after Phase 11

- **An e2e test now and then finds its page signed out right after register-and-login** (seen
  again on 2026-11-15, `account.e2e.ts` avatar upload on mobile-chrome; the same spec passed 60 of
  60 times on repeat). CI retries twice. Lead: the `maxConcurrentSessions` cap of 10 evicting a
  session between login and refresh (`login.ts`).
- **A flag turned off reaches an open page only on reload or a viewer change**: the flags module
  publishes no events, so the SPA context is not invalidated. `refresh()` drops to `'loading'` and
  must keep its snapshot before it gets a caller.
- **Switching the acting org does not refetch the context**, so per-org overrides are stale until
  a reload: the viewer key is the user id only.
- **Settled SPA semantics are capability-first.** A denied `/admin/<child>` renders a blank outlet,
  and a signed-out deep link to a route behind a targeted flag gets NotFound rather than the login.
  `WebRoute.requires` is not enforced yet (plan section 10.3, as built).
- **`loginViaUi` and the other password helpers time out when `AUTH_STRATEGIES` contains
  `magic`**, which keeps the advanced-auth specs from running; browser runs pin
  `AUTH_STRATEGIES=local`.
- **`LiveRegion` leaks its announce timers on unmount** (`@bslt/react`); `App.test.tsx` drains them
  in an `afterEach`.
- **Development and the e2e run connect as the superuser**, where row-level security does not
  apply. Only the real-DB suite and production run as `bslt_app`.

## Phase 10, events, outbox, one queue, cron, orgs shell, webhooks module (2026-11-14, done)

Branch `fix/security-defects-tamrnu`, on top of Phase 9 (`d920502c8`). `CURRENT_PHASE` is `10`:

- **Queue, outbox, events & cron kernel (`@bslt/db`, `@bslt/server-system`, `@bslt/testing`):**
  deleted dead queue/media duplication (`WriteService`/`write-types`, `CustomJobQueue`, media
  orchestrator/facade/in-memory DB, duplicate `@bslt/media/http`); upgraded `sys_jobs` (`queue`,
  `priority`, `dead` status, `last_error`, `dead_at`, unique `(name, idempotency_key)`, retention)
  and wired `QueueServer` + `k.jobs.enqueue` on `worker`/`all`; added `sys_outbox`,
  `k.events.publish`, AES-256-GCM `sealed()` payloads, `sys.outbox.dispatch` (`NOTIFY bslt_outbox` +
  `FOR UPDATE SKIP LOCKED` + per-subscriber `sys_jobs` fan-out), `runSubscriberTwice`, and the
  `events` emit-site gate; moved all server `setInterval` tasks to cron (including `SECURITY DEFINER`
  analytics partition maintenance and `legacy.cron`), leaving `setInterval` only in kernel runtimes.
- **Orgs events shell & `@bslt/webhooks` module (`main/modules/{orgs,webhooks}`):** created the
  `@bslt/orgs` shell (`orgs.member.added` / `orgs.member.removed` with `webhook: true` and audit
  metadata) and published in-transaction from `tenants/handlers/members.ts`; added the manifest
  `env` field and `viewer.actingOrg`; migrated outbound webhooks + admin webhook monitor/endpoints
  end-to-end into `@bslt/webhooks` (`webhooks` + `webhooks_deliveries` with `org_id NOT NULL` and
  `sys_apply_rls`, `webhooks.deliver` job, cron retry, `onFlagged('webhook', ...)` subscriber,
  inferred hooks, and console surfaces), deleting and tombstoning `emitWebhookEvent` and
  `WEBHOOK_EVENT_TYPES`.

| Exit criterion / check (plan 17.2)                             | Result                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Old paths deleted and tombstoned                               | `emitWebhookEvent`, `WEBHOOK_EVENT_TYPES`, webhook retry interval, `WriteService`, `CustomJobQueue`, media orchestrator/http removed |
| `setInterval` confined to kernel runtimes                      | `setinterval` ratchet lowered to `6` (kernel runtimes only); `unused-exports` `738`, `opaque-schema` `401`, `legacy-shim` `182`      |
| Real-DB outbox rollback & at-least-once idempotent delivery    | Proven in `outbox-dispatch.real-db.test.ts` + `rls-system-content.real-db.test.ts` + `webhooks.real-db.test.ts`                      |
| `api-surface` & `web-routes` snapshots                         | All HTTP paths/methods/auth unchanged (`admin` webhook routes re-attributed to `webhooks`); `web-routes` adds webhooks admin nav     |
| `pnpm bslt gate merge --concurrency=1`, `--self-test`, real-DB | 47/47 merge gates passed (`esm-dist` 22/22); 52/52 self-test; 45 tables / 20 owner isolation tests; 51/51 real-DB suites / 858 tests |

## Phase 9, web contributions seam (2026-11-14, done)

Branch `fix/security-defects-tamrnu`, on top of Phase 8 (`db4738e38`). `CURRENT_PHASE` is `9`:

- **Web composition kernel (`main/kernel/web`, `@bslt/web-platform`):** added `implementWeb`,
  `WebImpls`, `lazyModulePage`, and `createWebApp({ modules, legacy })` to aggregate module web
  contributions (`routes`, `nav` for `app.primary` / `palette` / `dashboard`, `settingsSections`,
  `admin`, `notificationRoutes`, `sitePages`, `persistableQueryHeads`, and `messages`) alongside
  shrink-only legacy definitions (`main/apps/web/src/legacy/{contributions,routeContributions}.ts`).
- **Ten web registries converted one per commit (§11.2):** `app/routes.tsx`, `primaryNav.ts` /
  `AppLeftMenu.tsx`, `commands.ts` (including `tasks` command-palette entry), `starterSurface.ts`
  (deleted and tombstoned), `adminSurface.ts` (with `tier` / `starter` fields deleted and
  tombstoned), the four settings-section lists (`SettingsTabId`, `SETTINGS_TAB_IDS`,
  `SETTINGS_NAV_ITEMS`, `ACCOUNT_MODAL_SECTIONS`), `siteMap.ts` + retargeted reachability test,
  `getNotificationRoute.ts`, `queryPersistencePolicy.ts` (strict allowlist), and
  `DashboardPage.tsx` tiles / quick actions.
- **Ratchet & scaffolding:** onboarded web legacy lists into the `legacy-shim` ratchet (`177`) and
  wired `bslt module new <id>` to emit `app.primary`, `palette`, and `dashboard` contributions.

| Exit criterion / check (plan 17.2)                             | Result                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Old paths deleted and tombstoned                               | `starterSurface.ts`, `adminSurface` `tier`/`starter` fields, and scattered hand lists outside `legacy/` removed |
| `web-routes` snapshot diff                                     | Only `nav-tasks` palette entry added and removed `tier`/`starter` fields on `admin` entries (`api-surface` 0 Δ) |
| `siteMap.test.ts` reachability check                           | Retargeted to aggregated routes and green                                                                       |
| `bslt module new example` in a temporary workspace             | Scaffolds from cold checkout and passes 46/46 `bslt gate merge` gates (25 workspace packages)                   |
| `pnpm bslt gate merge --concurrency=1`, `--self-test`, real-DB | 46/46 merge gates passed (`esm-dist` 20/20); 51/51 self-test; 49/49 real-DB suites / 837 tests on PG 17.11      |

## Phase 8, contract layer, module host, one transport, tasks module (2026-11-14, done)

Branch `fix/security-defects-tamrnu`, on top of Phase 7 (`5b6178415`). `CURRENT_PHASE` is `8`:

- **Schema & Contract kernel (`main/kernel/{schema,contract}`):** extracted `@bslt/schema` from
  `@bslt/shared/schema` with strict combinators (`object`, `optional`, `nullable`, `array`,
  `record`, `union`, `discriminated`, `literal`, `enumOf`, `brand`, `refine`, `bigintString`,
  `sealed`), `Infer`, `describe()`, and Standard Schema v1 (`~standard`); added `@bslt/contract`
  (`endpoint`, `event`, `job`, `defineModule`, `defineConfig`, `defineErrors` + global `ErrorCode`
  registry, HTTP envelope, `Money` / `Asset`, branded `Id<Table>`, `Requirement` / `evaluate`, and
  `composeRouter(legacyRouter, installedModules)`).
- **Server module host & unified client transport:** added `implementServer`, `ServerImpls`, and
  contract-to-`RouteMap` composition in `@bslt/server-system` (`buildApp({ modules, legacy })`);
  unified browser REST transport (`createTransport`, re-pointed `createCsrfRequestClient`, and
  `createEndpointClient`) in `@bslt/client-engine`; added `useEndpoint`, `useEndpointMutation`, and
  `implementWeb` / `WebImpls` in `@bslt/react`; extracted `@bslt/server-system/testing/{database,real-db}`
  so modules test against Postgres without importing `main/apps/server`.
- **Composition, scaffolding, gates & reference module:** added root `bslt.config.ts`,
  `bslt sync modules` (`main/apps/{server,web}/src/generated/modules.ts`, app `package.json` deps
  and `tsconfig.json` refs, `main/tools/generated/module-graph.json`, module `README.md` blocks),
  `bslt module new <id>`, and gates `module-shape`, `module-graph`, `frozen-paths`, and
  `legacy-shim`; created `@bslt/identity` shell and migrated `@bslt/tasks` end-to-end
  (`main/modules/tasks`), deleting `api-client-sync`, `api-response-sync`, `main/tools/starter`, and
  all legacy tasks paths; rewrote the Code Placement table in `docs/specs/principles.md` and added
  `docs/dev/module-creation.md`.

| Exit criterion / check (plan 17.2)                            | Result                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tasks & starter old paths deleted and tombstoned              | All legacy tasks + `starter/feature` paths absent; `294` tombstoned path/symbol entries pass                               |
| `api-client-sync` and `api-response-sync` deleted             | Removed and recorded in `merge-parity.ts` (+5 Phase 8 gates added)                                                         |
| `api-surface`, `web-routes`, and `db-catalog` snapshots       | `api-surface` & `web-routes` 0 diff; `catalog.snapshot.json` diff is `tasks.owner_id → owner_user_id` + source attribution |
| `legacy-shim` ratchet                                         | Lowered `48 → 45` (`tasks` removed from `coreRouteModuleRegistrations`, `legacyApiRouter`, `LEGACY_OWNERS`)                |
| `bslt module new example` in a temporary workspace            | Scaffolds from cold checkout and passes 46/46 `bslt gate merge` gates                                                      |
| `pnpm bslt gate merge --concurrency=1` & `--self-test`        | 46/46 merge gates passed (`lint`/`type-check`/`test` 23/23, `esm-dist` 19/19); 51/51 self-test                             |
| `pnpm bslt db reset --force`, `db audit --db`, `test:real-db` | 14/14 migrations + seeds; 44 tables / 19 owner isolation tests; 49 files / 837 tests on PG 17.11                           |

## Phase 7, kernel mechanical move (2026-11-14, done)

Branch `fix/security-defects-tamrnu`, on top of Phase 6 (`143264d9c`). The eight surviving kernel
packages now live under `main/kernel/*` with their package names and import specifiers unchanged
(plan section 17.2, Phase 7):

| Before                 | After                  | Package               |
| ---------------------- | ---------------------- | --------------------- |
| `main/server/db`       | `main/kernel/db`       | `@bslt/db`            |
| `main/server/system`   | `main/kernel/server`   | `@bslt/server-system` |
| `main/server/storage`  | `main/kernel/storage`  | `@bslt/storage`       |
| `main/server/comms`    | `main/kernel/comms`    | `@bslt/comms`         |
| `main/server/realtime` | `main/kernel/realtime` | `@bslt/realtime`      |
| `main/client/engine`   | `main/kernel/client`   | `@bslt/client-engine` |
| `main/client/react`    | `main/kernel/react`    | `@bslt/react`         |
| `main/client/ui`       | `main/kernel/ui`       | `@bslt/ui`            |

Workspace globs (`pnpm-workspace.yaml`), `tsconfig.json` project references, ESLint boundary
elements and restricted-syntax globs (`main/build-config/src/eslint.ts`), Dockerfiles and
`ship-capability.sh`, `@bslt/tools` path constants / syncs / audits / CSS lints / ratchets, and the
eight path tombstones are updated; `CURRENT_PHASE` is `7`.

| Exit criterion / check (plan 17.2)                 | Result                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Old directories gone and tombstoned                | All 8 old directories absent; 8 path tombstones added (`265` tombstoned entries)              |
| Zero import-specifier changes in moved files       | `0` import-specifier diff lines across `main/kernel/**` (verified by rename diff)             |
| `pnpm build`                                       | 15/15 built (`0` cached); `esm-dist` passed on all 15 `dist` directories                      |
| `pnpm bslt gate merge --concurrency=2`             | 41/41 gates passed (`lint` 19/19, `type-check` 19/19, `test` 19/19, all 7 ratchets at budget) |
| `pnpm bslt gate --self-test`                       | All 48 registered gates executed                                                              |
| `pnpm bslt db catalog --check` on PostgreSQL 17.11 | Matches `main/kernel/db/catalog.snapshot.json`                                                |
| `pnpm test:real-db` on PostgreSQL 17.11            | 48 files, 835 tests passed                                                                    |

## Phase 6, DB foundation and clean baseline reset (2026-11-12)

Branch `fix/security-defects-tamrnu`, on top of Phase 5 (`ac73392`). Part A is `3dbac3d`..`e09b264`,
pushed. Part B is `42b2f33`..`ba503a9` and part C is `b89bb7b`..the commit of this section; both are
committed and not pushed. Phase 6 of plan section 17.2 was done in three parts; each has its section
below, and the exit check, the final checks of the phase and what stays open follow part C.

| Part | What                                                                                                                                                                           | State |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| A    | The migration runner, the clean baseline reset, the oracle check, everything repointed, old paths gone                                                                         | Done  |
| B    | The `sys_*` helpers and `sys_apply_audience`, the three RLS proofs, `bslt db catalog` and the catalog audit, `bslt sync rows`, derived `REQUIRED_TABLES`, `tenancy.ts` deleted | Done  |
| C    | Client hardening (transaction retry, timeouts, `skipLocked`/`noWait`, bigint, the builder's fragments), the one-statement session, the exit check and the docs                 | Done  |

### Part A: runner and baseline reset

**Where things are** (Phase 7 moves `main/server/db` to `main/kernel/db`; the plan names the paths
after that move):

| What                          | Where                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Kernel baseline               | `main/server/db/sql/0001_sys.sql`                                                                             |
| One legacy baseline per owner | `main/server/db/legacy-migrations/<owner>/0001_<owner>.sql`, twelve owners                                    |
| Required seeds                | `main/server/db/legacy-migrations/compliance/seeds/0001_legal_templates.sql`                                  |
| The runner                    | `main/server/db/src/migrate/` (`runner.ts`, `sources.ts`, `database.ts`, `entry.ts`)                          |
| The commands                  | `pnpm bslt db migrate`, `pnpm bslt db reset`; in the image `node node_modules/@bslt/db/dist/migrate/entry.js` |
| How it works                  | [`docs/deploy/migrations.md`](../../deploy/migrations.md)                                                     |

**The runner** (plan 9.3 item 7): sources with an id and the ids they depend on, applied kernel
first, then in dependency order (ties by id), then by file number; `sys_migrations(source, name,
checksum, applied_at)`; a session advisory lock for the run; one transaction per file, or statement
by statement for a file marked `-- bslt:no-transaction`; required seeds (`seeds/NNNN_<name>.sql`)
after all migrations, applied again when changed. Pre-v1 policy (item 6): a changed or removed
file, a new file before an applied one, or tables without a record stop the run before it changes
anything, with `run: pnpm bslt db reset`.

**The reset** (items 2 to 5). The `0000`..`0926` chain is gone. The split follows the plan's
owner-to-file mapping; `0700`, `0900`, `0901`, `0902` and `0918`-`0926` are dissolved into the
owners' files. Module tables keep their names: each module's migration renames its own (plan 9.1).

**Oracle.** `pnpm bslt snapshot db-catalog` on the baselines against the snapshot of the chain.
Before any clean-up the difference was only the dropped tables and the runner's record table: 43
tables, every policy, grant, trigger and function hash unchanged. With the hand-clean list applied,
the difference is exactly the list below; a sorted `pg_dump --schema-only` of both databases shows
the same and nothing more.

| Item of the hand-clean list                                     | Result                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drop `jobs`, `tenant_settings`, `billing_tenant_backfill_audit` | Dropped, with the enum `job_status`; the dead `jobs` repository and the `tenant_settings` schema types are deleted                               |
| The 0906 refresh-token index under a unique name                | Already done by `0925` (`idx_refresh_tokens_family_unrotated`); verified                                                                         |
| Invitation unique partial                                       | Already done by `0925`; verified with a revoked, an accepted and two pending rows                                                                |
| Provider-id uniques                                             | `(provider, provider id)` on subscriptions, invoices, payment methods and customer mappings; `endpoint` on push subscriptions                    |
| Redundant indexes                                               | 23 dropped by one rule (a prefix of another index without a predicate, or a repeat or extension of a unique key); the rule is a test             |
| Phantom `reminder_sent_at`                                      | Never in the DDL, and its column map was already gone; verified                                                                                  |
| `notification_type` to `notifications_level`                    | Renamed                                                                                                                                          |
| Financial FKs `RESTRICT`                                        | `user_id` of subscriptions, customer mappings, invoices and payment methods; `bslt_system` loses `DELETE` on subscriptions and customer mappings |
| `job_queue` to `sys_jobs`, `cron_jobs` to `sys_cron`            | Renamed, with their constraints and indexes                                                                                                      |
| (the runner)                                                    | `migrations` and its sequence are gone; `sys_migrations` is the record                                                                           |

Each item is a test in `tests/integration/database/baseline-hand-clean.real-db.test.ts`; on the
chain seven failed and the three verified items passed.

Decisions:

- **Two helpers that read owner tables are in the kernel file.** The class template writes
  `app_current_user_is_platform_admin()` and `app_current_user_is_tenant_member()` into every admin
  and `owner_org` policy, the kernel's own `sys_jobs` included, so they exist before identity and
  orgs create `users` and `memberships` (`check_function_bodies` is off for the kernel file; a SQL
  function body is resolved when it is called). `app_current_user_tenant_role()` returns orgs'
  `tenant_role` and is in the orgs file. The `definer_read_policy` of each table is in its owner's
  file. Names are unchanged (`app_*`): part B re-expresses them as `sys_*`.
- **`dependsOn` of the legacy sources is what the files reference today**, not the module graph of
  plan section 5.1: the legacy tables of audit, notifications, webhooks and analytics still carry
  foreign keys to `users` and `tenants`. Each module's migration removes its own.
- **A required seed runs after the classification**, so the legal templates lift `FORCE` on
  `legal_documents` inside their own transaction (the owner is bound by `FORCE`, and no role is
  granted that insert).
- **A user with billing rows is never hard deleted.** With the financial foreign keys on
  `RESTRICT`, retention anonymizes such a user, counts it as blocked and deletes no billing row
  (`main/server/core/src/users/pii-anonymization.ts`). Before, the purge deleted the billing rows of
  a tenant the user owned alone and the rest went with the cascade.
- **`idx_usage_snapshots_tenant_period` stays**, although the fragmentation map (DB-14) calls it
  covered: `findByTenant` orders by `period_start` on it. The index rule drops nine indexes DB-14
  does not list (plain `user_id` or `tenant_id` prefixes of a composite index, and
  `idx_users_active`).
- **The demo database is recreated when it cannot be migrated forward, not on every deploy.**
  `remote-deploy.sh` drops the volume when the migrate job exits 3 (built from other baselines, or
  by the old chain) and migrates again; a deploy that touches no baseline keeps the demo data.
  Production treats exit 3 as a failed deploy. Remove the demo case at `foundation-v1`.
- **The image's migrate entry is in `@bslt/db`**, which ships its SQL (`files`: `sql`,
  `legacy-migrations`); the image build reads every source through the package. `bootstrap-roles`
  is still an entry of the server app.
- **`billing_resolve_primary_tenant()` is kept**, although nothing calls it since the backfill it
  served is gone: it is not on the hand-clean list. A candidate for the billing module's migration.

Final checks of part A, Node 22 locally (CI runs the pinned Node 24):

| Check                                          | Result                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`         | 38 gates passed                                                                                                                                                                                          |
| `pnpm bslt gate --self-test`                   | all 46 registered gates ran                                                                                                                                                                              |
| `pnpm test:real-db` on PostgreSQL 17           | 41 files, 566 tests passed                                                                                                                                                                               |
| `pnpm test:real-db` on PostgreSQL 16           | 41 files, 566 tests passed                                                                                                                                                                               |
| `pnpm bslt snapshot db-catalog --check`        | matches the committed snapshot                                                                                                                                                                           |
| `pnpm test:e2e -- --workers=2 --reporter=line` | 334 passed, 90 skipped (capability-gated), 0 failed, 5.1 min. The run before it had one failure, `admin/sessions.e2e.ts:257` (the page was logged out right after register-and-login); it did not repeat |

The e2e setup is the one of Phase 5 with `pnpm db:migrate` in place of the deleted `db:push`.

Open after part A:

- Tables, functions and roles keep their pre-restructure names (`users`, `app_apply_rls`,
  `authenticated`); the prefix gate and the renames are part B and the module migrations.
- `main/server/db/src/schema/*.ts` and `REQUIRED_TABLES` are still written by hand (part B derives
  them from the catalog); `JOB_QUEUE_TABLE` and `CRON_JOBS_TABLE` name `sys_jobs` and `sys_cron`.
- `bslt db audit` still reads the SQL text with regular expressions (now from the runner's
  sources); part B replaces it with the catalog attribution of plan 9.1.
- The demo host holds a database of the old chain: the first deploy from this branch recreates it.
- The production `deploy` job has never run against a real database server (Phase 4, open): there
  is nothing to reset there.

### Part B: `sys_*` helpers, the RLS proofs, the catalog, generated rows

**Where things are** (paths before the Phase 7 move):

| What                               | Where                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Helpers and templates              | `main/server/db/sql/0001_sys.sql`: `sys_current_user_id`, `sys_current_org_id`, `sys_max_audience`, `sys_apply_rls`, `sys_apply_audience` |
| The committed catalog              | `main/server/db/catalog.snapshot.json`, written by `pnpm bslt db catalog`                                                                 |
| Catalog reader, attribution, audit | `main/tools/catalog/` (`read.ts`, `attribute.ts`, `build.ts`, `command.ts`, `audit.ts`, `rls.ts`, `names.ts`, `rls-structure.ts`)         |
| Generated rows                     | `main/server/db/src/legacy-generated/<owner>.ts`, `main/server/db/src/generated/{rows,tables}.ts`, written by `pnpm bslt sync rows`       |
| The names the code base uses       | `main/server/db/src/schema/*.ts`: expressions over the generated rows (`schema/shape.ts`)                                                 |
| Behavioural proof, once per class  | `tests/integration/database/rls-classes.real-db.test.ts`                                                                                  |
| Structural proof, per table        | `tests/integration/database/generated/rls.real-db.test.ts` (generated)                                                                    |
| Owner isolation, per owned table   | `tests/integration/api/owner-isolation.real-db.test.ts`, `describeOwnerIsolation` of `@bslt/testing`                                      |
| How to use them                    | [`docs/dev/workflow.md`](../../dev/workflow.md) ("The database catalog", "Generated rows"), [`docs/dev/tenancy.md`](../../dev/tenancy.md) |

**1. The `sys_*` helpers** (plan 9.4). The Phase 0 names are replaced in every baseline, test and
caller, and tombstoned: `app_current_user_id` is `sys_current_user_id`, `app_current_tenant_id` is
`sys_current_org_id`, `app_current_user_is_tenant_member` is `sys_current_user_is_org_member`,
`app_current_user_is_platform_admin` is `sys_current_user_is_platform_admin`, `app_apply_rls` is
`sys_apply_rls`, and orgs' `app_current_user_tenant_role` is `orgs_current_user_role`. New:
`sys_max_audience()` and `sys_apply_audience(tbl, col, owner_col)`. The reviewed catalog difference
(old snapshot with the six names replaced, against the new one): every table, with its columns,
constraints, indexes, policy texts, triggers, grants and comment, is identical, and so are roles,
types and schemas; two functions are new, two have a renamed parameter (`_org_id`), and five have a
new body hash because they name a renamed helper or gained the class defaults. The full list is in
the message of `42b2f33`.

**2. The proofs** (plan 9.4):

- _Behavioural, once per class_: fixture tables classified with the three-argument `sys_apply_rls`,
  run as `bslt_app` (user sessions) and as `bslt_worker`: cross-user and cross-org read, update and
  delete touch 0 rows; a foreign-owner insert and handing a row over fail WITH CHECK; naming a foreign
  org in the session does not make the caller a member; the worker reaches a table only where system
  commands are listed and cannot become a user session; the audience backstop fails closed for both
  roles. 30 tests.
- _Structural, per table_: generated, 44 tables, 133 tests: row security is forced, the policies and
  grants equal the template of the class or are the listed hand-written ones of a `custom` table, and
  the class, owner column and commands are the ones of the catalog.
- _Owner isolation_: `describeOwnerIsolation` takes `owner: 'org'`; there is a case for each of the
  19 `owner_user` and `owner_org` tables (16 new), and `bslt db audit` fails for a table without one.

**3. `bslt db catalog`** (plan 9.1 items 3 and 4). The sources are applied one at a time to a scratch
database as `bslt_owner`; `pg_catalog` is read after each; every type, sequence, function, table and
view carries the `source` that created it. A source that alters or drops another source's object
(any facet: a column, an index, a policy, a grant, a trigger, the comment, a function body), an
object that was there before any source ran, and a catalog the audit refuses all stop the command,
which then writes nothing. The 13 sources of today own what they touch: no finding. ONE catalog and
ONE command: `bslt snapshot db-catalog` and `main/tools/snapshots/db-catalog.json` are gone; the new
file holds the same content byte for byte plus `sources` and `source`. The real-DB lane recomputes it
(`pnpm bslt db catalog --check` in CI, and `db-catalog.real-db.test.ts`, which also runs fixture
sources that reach into each other).

`bslt db audit` reads the committed catalog, so it is in the merge lane (`db-audit`): attribution,
classification, FORCE on every table but `sys_migrations`, the class template and the role matrix
of grants (`main/tools/catalog/rls.ts`), a NOT NULL owner column, foreign keys within `dependsOn`,
and the owner-isolation coverage. `--db` compares the connected database with the catalog.

**4. `bslt sync rows`** (plan 9.5, 14.2). From the committed catalog, without a database: per table
`<TABLE>_TABLE`, `<Table>Row`, `<Table>Insert`, `<Table>Update` and `<TABLE>_COLUMNS`, the enums as
unions, the table list per source, and the structural RLS test. Headers name the command; every
derived line ends with `// <- <key of the catalog>`; the `generated-rows` gate fails on a stale file
and on an orphan in a generated directory. The 19 hand-written schema files keep their exported names
and state them over the generated rows; all 138 exported types were checked mutually assignable with
the hand-written ones, with the same keys, before those were deleted. `REQUIRED_TABLES` is the
generated `TABLES` (44 tables; the literal had 38).

**5. `tenancy.ts` and `DB_TENANCY_MODE`** are deleted with their config, call sites (login, OAuth,
magic link, tenant creation, the data phase), tests and docs, and tombstoned. A database session
never changes the `search_path`.

Decisions:

- **`sys_apply_rls` keeps its three command lists**, now with defaults: the plan's three-argument
  form gives a class its own commands, and an explicit list (empty included) replaces it. The 43
  existing calls pass explicit lists, so no table changed. The per-table lists are what the product
  has (a system fact gets no user insert); dropping them would change behaviour.
- **Policy names and policy-target roles are unchanged** (`rls_user_<cmd>`, `rls_admin_<cmd>`,
  `system_access_policy`; `authenticated`, `bslt_system`, `bslt_definer`), with the DB-verified
  admin check and the definer read policies of Phase 0. The plan's sketch names `rls_app_*` and
  `rls_worker_*`; renaming 162 policies is not a rename of helpers and proves nothing new.
- **`sys_apply_audience` writes one RESTRICTIVE `SELECT` policy that names no role**, so it binds
  the system role too: a job that must read past it sets `app.max_audience` itself. The owner sees
  its rows; anyone else only rated rows up to the ceiling; no ceiling is 0.
- **`sys_current_org_id()` reads `app.org_id` and falls back to `app.tenant_id`**, which is what the
  client binds today. No policy reads it. Remove the fallback when the client binds `app.org_id`
  (part C, one `set_config`).
- **Attribution is per object, a table as a whole.** Because a source is applied in one step and may
  not change another source's object, every column, index, policy, trigger and grant of a table
  belongs to the table's source. Roles, extensions and schemas belong to the cluster and the
  database and carry no source. `sys_migrations` is attributed to the kernel (the runner creates it
  while it applies the kernel).
- **The catalog is next to the migrations** (`main/server/db/`, the plan's `main/kernel/db/` after
  Phase 7), and the reader, attribution and audit are in `@bslt/tools` (`main/tools/catalog/`): the
  plan lists catalog introspection under `@bslt/db`, but the code builds a scratch database with
  `@bslt/testing` and is a gate, which is tooling. Move it with the kernel if `@bslt/db` should own
  it.
- **Generated rows are in `src/legacy-generated/`**, not `main/server/db/legacy-generated/`: the
  package compiles `src/`.
- **uuid is `string`, not a branded id.** Every signature of the code base passes plain strings; a
  module adopts brands with its own `server/generated/rows.ts`. Everything else is the plan's map
  (timestamptz `Date`, bigint `bigint`, numeric `string`, jsonb `JsonValue`, enum and CHECK unions).
- **The schema files state what differs from the catalog, they do not hide it.** `version` is left
  out of 20 row types (the column maps are now complete: the case helpers convert an unmapped key
  the same way, so nothing changes at run time); two bigint columns and one numeric are typed
  `number`; some insert types require or omit a column. Each is one expression to delete when the
  module migrates.
- **The structural test and the real-DB suites stay in `tests/`**, the one package with a database
  lane; the plan's per-module `server/generated/rls.real-db.test.ts` and the kernel's
  `rls.real-db.test.ts` move there with the modules.
- **The owner-isolation requirement is a check of `bslt db audit`**, until there is a module-shape
  gate to hold it.
- **Generated files are exempt** from the `unused-exports` ratchet and from the colocated-test rule:
  nobody can drop an export from a generated file, and the generator is what is tested.

Findings (not fixed here; each is visible where it is stated):

- **Three unions of `@bslt/shared` do not match their enum.** `PLAN_INTERVALS` lacks `lifetime`;
  `INVOICE_STATUSES` has `past_due`, which `invoice_status` does not; `PAYMENT_METHOD_TYPES` has
  `bank_account` where `payment_method_type` has `bank_transfer`, `crypto` and `other` (inserting
  `bank_account` fails in the database). `main/server/db/src/schema/billing.ts` keeps the shared
  unions, each with a note; the billing module's migration makes each pair one list.
- **`webhooks.tenant_id` is nullable** although the table is `owner_org` (plan 9.2 wants one NOT
  NULL owner column). Listed in `NULLABLE_OWNER_COLUMNS` of the audit, shrink-only, until the
  webhooks module (Phase 10).
- **49 objects do not carry the prefix of their owner** (`db-legacy-names` ratchet): 34 tables, 11
  types, 4 functions, the kernel's `update_updated_at_column()` among them.

Final checks of part B, Node 22 locally (CI runs the pinned Node 24):

| Check                                               | Result                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`              | 41 gates passed (38 before: `generated-rows`, `db-audit`, `db-legacy-names`)                                     |
| `pnpm bslt gate --self-test`                        | all 48 registered gates ran                                                                                      |
| `pnpm test:real-db` on PostgreSQL 17                | 42 files, 792 tests passed                                                                                       |
| `pnpm bslt db catalog --check` on PostgreSQL 17, 16 | matches the committed catalog on both                                                                            |
| `pnpm bslt db audit`                                | 44 tables of 13 sources are attributed, classified and equal their class; 19 owner tables have an isolation test |
| Database and isolation suites on PostgreSQL 16      | 7 files, 276 tests passed                                                                                        |

The first run of the merge gate had one failure, a subprocess timeout in
`main/tools/scripts/lint/eslint-boundaries.integration.test.ts` while another agent was building on
the same machine; the test passed alone and in the second full run. The e2e suite and the full
real-DB suite on PostgreSQL 16 were not run in part B.

Ratchets: `db-legacy-names` is new at 49; `unused-exports` 780 to 777, `raw-sql-outside-repos` 148 to
142, `opaque-schema` 431 to 430; three files left the test-pair debt list.

Open after part B, as it stood (part C merged the client work and bound `app.org_id`; the current
list is under [Open after Phase 6](#open-after-phase-6)):

- **Merging part C.** Part C edits `main/server/db/src/client.ts` and `builder/` in a worktree. Part
  B changed `client.ts` in three places only (the `./tenancy` import, `SessionContext.schema`, the
  `search_path` branch of `applySession`) and `rls.unit.test.ts` (the `search_path` tests). When part
  C binds `app.org_id`, drop the `app.tenant_id` fallback of `sys_current_org_id()` and recompute the
  catalog.
- **`docs/CLAUDE.md` still says the schema-per-tenant mode ships.** That file is the owner's to
  change; its link target `docs/dev/tenancy.md` now describes the one model.
- Tables and types keep their pre-restructure names; each module's migration renames its own and
  lowers `db-legacy-names`.
- The catalog gate does not compare the attributed tables with `module.ts` `tables` (plan 9.1 item
  3): there is no `module.ts` before Phase 8.
- `bslt gen explain <file:line>` (plan 14.2) does not exist; the `// <-` keys are read by eye.
- `bslt_app` and `bslt_worker` are still members of the policy targets rather than the policy
  targets themselves; the plan's role list names only the three login roles.

### Part C: client hardening, the one-statement session, close-out

**Where things are** (paths before the Phase 7 move):

| What                                   | Where                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The client                             | `main/server/db/src/client.ts`: `transaction()` and its retry, `DbTimeouts`, `sessionSettingsQuery`, `toSafeNumber`                                     |
| The builder                            | `main/server/db/src/builder/`: `fragment()` and the brand (`types/types.ts`), `skipLocked()`, `noWait()`, `eqSubquery()`, `selectCount()`               |
| The limits of the two runtime pools    | `main/apps/server/src/bootstrap/phases/data.ts`, from `DB_STATEMENT_TIMEOUT_MS` and the three keys next to it                                           |
| Real-DB proofs                         | `tests/integration/database/`: `transaction-retry`, `client-timeouts`, `queue-claim`, `client-bigint`, `builder-values`, `client-session`               |
| How to use it                          | [`docs/dev/database.md`](../../dev/database.md); operations in [`docs/deploy/production-postgres.md`](../../deploy/production-postgres.md) and `env.md` |
| Adding a table, from baseline to tests | [`docs/dev/database.md`](../../dev/database.md#add-a-table)                                                                                             |

The client work was done on a branch in a worktree on top of part A and picked onto this branch
after part B (`b89bb7b`..`76797cb`, ten commits, no conflict); the worktree and its branch are gone.

**1. Transaction retry.** `transaction()` runs its callback again when Postgres rolls the
transaction back for a serialization failure (`40001`) or a deadlock (`40P01`): three attempts by
default, exponential wait with jitter, per pool (`transactionRetry`) or per call (`retry`, `false`
to run once). Only the call that opens the transaction retries; a nested call is a savepoint and
refuses a mode of its own.

**2. Timeouts.** A pool created with `timeouts` runs under `statement_timeout`, `lock_timeout` and
`idle_in_transaction_session_timeout`: 30 s for a statement of the app pool, 120 s for the worker
pool, 10 s for a lock, 60 s idle in a transaction, each an env key and `0` for off. Only the two
runtime pools set them; the migration owner connection, the tools and the test harness set none.
`QueryOptions.timeout`, accepted and ignored before, cancels the one statement.

**3. `skipLocked()` and `noWait()`** in the select builder, with `eqSubquery()`. The queue's claim
is built by the builder; five workers as `bslt_worker` drain 24 jobs and none is taken twice.

**4. bigint.** Every int8 is a JavaScript `bigint` on every pool, whatever its value, as the
generated rows say. `selectCount()` writes `COUNT(*)::int` and returns a number;
`toSafeNumber()` converts a value known to stay small and throws instead of rounding
(`files.size_bytes`, `tenant_roles.permissions`).

**5. A value can never become SQL.** A fragment is made only by `fragment()` and carries a
module-private symbol; `SqlFragment` is branded in the type. `set()`, insert values and conditions
bind whatever is not a fragment, and every method that takes a fragment refuses a look-alike. This
closes the `update().set()` item carried forward from Phase 0.

**6. The session is ONE statement** (plan 9.4, DB-15). The client bound a session with up to four
`SET LOCAL` statements, values escaped into the text, in a transaction of its own, after a separate
statement for the limits: eight messages for one statement of a request. Now:

```sql
SELECT set_config('role', $1, true), set_config('app.user_id', $2, true),
       set_config('app.org_id', $3, true), set_config('app.role', $4, true),
       set_config('app.max_audience', $5, true), set_config('statement_timeout', $6, true), ...
```

- A single statement travels with it in one driver batch: one round trip, one implicit
  transaction, no `BEGIN` and no `COMMIT`.
- `transaction()` sends it once, after `SET TRANSACTION`, before the callback.
- A session client made inside a transaction is a savepoint with the session alone.
- `tests/integration/database/client-session.real-db.test.ts` counts the statements where they leave
  the process (the driver's `debug` hook): 2 for a session statement, where there were 7 or 8; one
  settings statement for a transaction of any length. It also shows that a login role that may not
  act as `authenticated` runs nothing of the statement (a sequence that was never advanced), and
  that the connection keeps no setting afterwards.

The org of the request is bound as `app.org_id`, so the `app.tenant_id` fallback of
`sys_current_org_id()` is gone; the catalog difference is that one function body.

**Found along the way and fixed, each test first:**

- A job's arguments were stored as one JSON string since the driver upgrade, so handlers were called
  with a string (`376b598` on the worktree, `668bf75` here).
- `DbConfig` documents milliseconds and the driver takes seconds: the default connect timeout was
  10 000 seconds. The pub/sub connections had the same mistake (`998a4a4`).
- `jsonbEq()` wrote its key into the SQL text; `jsonbContains()` and `jsonbContainedBy()` never
  matched, because of the same double encoding as the queue's.
- Two count readers returned strings typed as numbers, and `sizeBytes` reached the API as a string.
- A test of the data phase asserted on mock calls it had just cleared (`cd4c13e`).

Decisions:

- **The limits are set per transaction with `set_config(..., true)`**, not as startup parameters
  and not on the session: PgBouncer refuses unknown startup parameters, and a session setting leaks
  to the next client of a pooled connection.
- **The role is set with `set_config('role', ...)`**, which is what `SET LOCAL ROLE` sets, the
  membership check included, so the role and the settings the policies read arrive together and a
  refused role fails the whole statement. It is the first item of the list.
- **The statement lists what the session carries**, not always four settings as the plan's sketch:
  a session without a user sets no role and no `app.user_id`, and a savepoint session does not clear
  what its transaction has. A setting that is not bound reads as unset (`NULL`, ceiling 0).
- **A session statement is a batch, not `BEGIN` ... `COMMIT`.** One round trip instead of four. The
  price: on a session client, as on a pool with limits, one call is one statement (no `a; b`), and a
  statement that refuses a transaction cannot run there. Runtime server code has neither.
- **`SessionContext` keeps the field `tenantId`**; what it binds is `app.org_id`. The field is
  renamed with the orgs module. `maxAudience` is new and nothing passes it yet: labels are the
  fork's.
- **A count is a number, cast in SQL.** `COUNT(*)::int` fails in Postgres over 2^31 - 1 instead of
  rounding in JavaScript.
- **The schema files keep two `number` overrides** over the generated `bigint` (`sizeBytes`,
  `permissions`): their repositories convert with `toSafeNumber()`, so the types are true.

### Phase 6 exit check

| Exit criterion (plan 17.2)                                      | Result                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbered migrations deleted and tombstoned                      | `main/server/db/migrations` is gone (`0000`..`0926`); path and name tombstones                                                                                                                                                                                                          |
| `db:push` and the extra migration entry points                  | Gone: the root script, `main/tools/scripts/db/push.ts`, `main/apps/server/src/migrate.ts`, `main/server/db/src/migrations.ts`; `runMigrations` of `@bslt/db` is the one runner, called by `bslt db migrate`, `bslt db reset`, the image entry, the test harness and the catalog command |
| `tenancy.ts` and `DB_TENANCY_MODE`                              | Gone, with their config, call sites and tests; ten name tombstones                                                                                                                                                                                                                      |
| Hand row types and `*_COLUMNS`                                  | Generated; three pattern tombstones keep a literal column map, a hand row type and a `REQUIRED_TABLES` literal out of `main/server/db/src/schema/`                                                                                                                                      |
| The catalog difference equals the reviewed list                 | See below: 63 differences, each one an item of a reviewed list                                                                                                                                                                                                                          |
| `bslt db audit` green                                           | 44 tables of 13 sources attributed, classified, forced and equal to their class; 19 owner tables have an isolation test                                                                                                                                                                 |
| Real-DB suite (user sessions as `bslt_app`) and e2e green       | See the final checks                                                                                                                                                                                                                                                                    |
| Ratchet budgets follow their counts (rule of the ratchet gates) | All seven at their count: `raw-sql-outside-repos` 149 to 136 over the phase, `unused-exports` 781 to 776, `opaque-schema` 431 to 430, `db-legacy-names` new at 49                                                                                                                       |

**The catalog difference across Phase 6.** The snapshot of the old chain at the end of Phase 5
(`main/tools/snapshots/db-catalog.json` at `ac73392`) against `main/server/db/catalog.snapshot.json`
now, with the seven reviewed renames applied to the old text (the six helper names and
`notification_type`) and `source` left out. With `job_queue` and `cron_jobs` also renamed, `sys_jobs`
and `sys_cron` are identical to them, constraints and indexes included. 63 lines differ:

| Differences | What                                                                                                                                                                                                                     | Reviewed as                 |
| ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
|           4 | Tables `jobs`, `tenant_settings`, `billing_tenant_backfill_audit` and the type `job_status` are gone                                                                                                                     | Hand-clean list             |
|          23 | Redundant indexes dropped                                                                                                                                                                                                | Hand-clean list             |
|          10 | Five provider-id unique constraints, each with its index (subscriptions, invoices, payment methods, customer mappings, push subscriptions)                                                                               | Hand-clean list             |
|           8 | Four financial foreign keys from `CASCADE` to `RESTRICT`                                                                                                                                                                 | Hand-clean list             |
|           4 | `bslt_system` loses `DELETE` on `subscriptions` and `customer_mappings`                                                                                                                                                  | Hand-clean list (same item) |
|           3 | `migrations` and its sequence are gone, `sys_migrations` is new                                                                                                                                                          | The runner                  |
|           4 | `sys_current_user_is_org_member` and `orgs_current_user_role`: the parameter is `_org_id`                                                                                                                                | Part B, `42b2f33`           |
|           2 | `sys_max_audience()` and `sys_apply_audience()` are new                                                                                                                                                                  | Part B, `42b2f33`           |
|           5 | Body hash only: `sys_apply_rls` (class defaults), `sys_current_org_id` (reads `app.org_id`), and three functions that name a renamed helper (`sys_current_user_is_platform_admin`, the two `*_guard_privileged_columns`) | Parts B and C               |

No column, no policy text, no trigger and no other grant differs. Two items of the hand-clean list
show no difference because `0925` had made them before the Phase 5 snapshot (the refresh-token index
and the partial invitation unique), and one because it never was in the DDL (`reminder_sent_at`).

### Final checks of Phase 6

At `e2d7573`, one at a time with nothing else running, Node 22 locally (CI runs the pinned Node 24):

| Check                                               | Result                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`              | 41 gates passed                                                                                                       |
| `pnpm bslt gate --self-test`                        | all 48 registered gates ran                                                                                           |
| `pnpm test:real-db` on PostgreSQL 17                | 48 files, 835 tests passed                                                                                            |
| `pnpm test:real-db` on PostgreSQL 16                | 48 files, 835 tests passed                                                                                            |
| `pnpm bslt db audit`                                | 44 tables of 13 sources are attributed, classified and equal their class; 19 owner tables have an isolation test      |
| `pnpm bslt db catalog --check` on PostgreSQL 17, 16 | matches the committed catalog on both                                                                                 |
| `pnpm test:e2e -- --workers=2 --reporter=line`      | 334 passed, 90 skipped (capability-gated), 0 failed, 5.1 min, on the second run; the first had one failure, see below |

The first e2e run had 333 passed and one failure: `account/compliance.e2e.ts:241` on the `chromium`
project, where the page was logged out right after register-and-login (the settings page showed
Login and Register). The same test passed on `mobile-chrome` in that run, and the whole suite passed
on the second run. Part A recorded the same kind of failure once at `admin/sessions.e2e.ts:257`,
before any of the client changes. It is listed as open below.

The real-DB suite grew from 41 files and 566 tests (part A) to 48 and 835: 226 from part B (the
class proofs, the generated structural test, 16 isolation cases, the catalog suite), 35 from the
five client suites and 8 from the session suite.

The e2e setup: `pnpm bootstrap --preset docker --yes --skip-db --skip-docker --skip-install` writes
`config/env/.env.development` (database `abe_dev` on port 5432); create that database, then
`POSTGRES_PASSWORD=<superuser password> pnpm -s bslt db migrate` and
`POSTGRES_PASSWORD=<superuser password> pnpm test:e2e -- --workers=2 --reporter=line`. Remove the env
file and the database afterwards.

### Open after Phase 6

For the owner:

- **`docs/CLAUDE.md` still says the schema-per-tenant mode ships** (lines 38 to 41). The file is the
  owner's to change; its link target `docs/dev/tenancy.md` describes the one model.
- **Nothing of parts B and C is pushed.** The demo host holds a database of the old chain: the first
  deploy from this branch recreates it (migrate exit 3). The production `deploy` job has never run
  against a real database server (Phase 4, open).

Names, each renamed by the module that owns it (plan 9.1):

- 49 objects without the prefix of their owner (`db-legacy-names`): 34 tables, 11 types, 4
  functions, the kernel's `update_updated_at_column()` among them.
- Policy names (`rls_user_<cmd>`, `rls_admin_<cmd>`, `system_access_policy`) and the policy-target
  roles (`authenticated`, `bslt_system`, `bslt_definer`) are the Phase 0 ones, not the plan's
  `rls_app_*` and `rls_worker_*` sketch; `bslt_app` and `bslt_worker` are members of the targets.
- `SessionContext.tenantId` binds `app.org_id`; the field is renamed with the orgs module.
- `billing_resolve_primary_tenant()` is kept although nothing calls it.

Data defects recorded and not fixed (each belongs to a module's migration):

- **Three unions of `@bslt/shared` do not match their enum**: `PLAN_INTERVALS` lacks `lifetime`,
  `INVOICE_STATUSES` has `past_due`, `PAYMENT_METHOD_TYPES` has `bank_account`, which the database
  refuses on insert (`main/server/db/src/schema/billing.ts`).
- **`webhooks.tenant_id` is nullable** although the table is `owner_org` (`NULLABLE_OWNER_COLUMNS`
  of the audit, shrink-only).
- **About ten repositories store JSON as a JSON string**: they bind `JSON.stringify(value)` to a
  `jsonb` parameter, which the driver stores as one JSON string, and parse it on read (billing,
  feature flags, notification preferences, data export requests, the queue's `error` column). They
  round-trip, but SQL JSON operators do not work on those columns. Changing only the write side
  breaks the read side.

The client:

- **Each statement of a request is still its own transaction** (one round trip now). The second
  half of DB-15, one transaction per request or unit of work with repositories made per transaction
  (`repo(tx)`, plan 9.5), comes with the modules.
- On a session client and on a pool with limits one call is one statement; `raw()` takes no
  `QueryOptions`, so a per-statement deadline exists on `query`, `queryOne` and `execute` only.
- Outside production `createDbClient` caches pools by connection string: when the app and the
  worker share one URL (an un-split development setup), the pool created first decides the limits
  of both.
- uuid columns are plain `string` in the generated rows, not the plan's branded `Id<'table'>`; a
  module adopts brands with its own `server/generated/rows.ts`.

Tests:

- **An e2e test now and then finds its page logged out right after register-and-login.** Seen twice
  in Phase 6, in different specs, once before the client changes and once after; neither repeated.
  The cause is not known.

Tooling:

- The catalog gate does not compare the attributed tables with `module.ts` `tables` (plan 9.1 item
  3): there is no `module.ts` before Phase 8.
- `bslt gen explain <file:line>` (plan 14.2) does not exist; the `// <-` keys are read by eye.
- The catalog reader and audit are in `@bslt/tools` (`main/tools/catalog/`) and the generated rows in
  `main/server/db/src/legacy-generated/`; the plan names `@bslt/db` and the package root. Decide with
  the Phase 7 move.
- `main/server/db/src/schema-coverage.test.ts` skips every path that contains `.claude`, so it scans
  nothing and fails in a Claude worktree.

## Phase 5, oracles, `buildApp()`, testing kit, ratchets, allowlist, contrast token (2026-11-12)

Branch `fix/security-defects-tamrnu`, on top of Phase 4 (`bd68c57`). Committed (`ab0ee6b`..), not
pushed. Phase 5 of plan section 17.2 was done in three parts. Parts A and B have their own sections
below; part C is described here.

| Part | What                                                                                                     | State |
| ---- | -------------------------------------------------------------------------------------------------------- | ----- |
| A    | `buildApp()`, the one composition function; `@bslt/testing`; the hand-built test server deleted          | Done  |
| B    | `bslt snapshot api`, `db-catalog` and `web-routes`, their committed files and their checks               | Done  |
| C    | Six ratchets, the `deps-allowlist` gate, `--ui-color-border-control` on every control, the contrast gate | Done  |

Exit criteria of the plan:

| Criterion                                                                       | State | Evidence                                                                                                           |
| ------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| Three snapshots committed and enforced                                          | Met   | `snapshot-api` and `snapshot-web-routes` in the merge lane; `db-catalog` in the real-DB lane (it needs a database) |
| All ratchets active                                                             | Met   | `tombstones`, the six ratchets and `deps-allowlist` are gates of the merge lane                                    |
| `createTestServer`'s composition root deleted; `describeRealDb` copies replaced | Met   | Part A; both tombstoned                                                                                            |
| The composition smoke test passes on `buildApp()`                               | Met   | `tests/integration/api/composition.real-db.test.ts`                                                                |
| The contrast gate is green in both themes                                       | Met   | `main/client/ui/src/theme/contrast.test.ts`: light, dark and both with the high-contrast overrides                 |

### Part C: ratchets

A ratchet is a count that may only go down. The six are gates of the merge lane; each has one number
in `main/tools/gates/ratchets/budgets.json`. A count over its budget fails. A count under its budget
fails too and names the command that lowers the budget (`pnpm bslt gate run <id> --update`, which
never raises one), so a gap cannot be refilled. `--verbose` lists every site. How to work with them
is in [`docs/dev/workflow.md`](../../dev/workflow.md) under "Ratchets".

| Ratchet                 | Budget today | What it counts                                                                                                                                                | Where the count sits                                                            |
| ----------------------- | -----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `swallowed-catch`       |          122 | Empty `catch` blocks (47), and rejection handlers that do nothing: `.catch(() => {})`, `.catch(() => undefined)`, the second argument of `.then` (75)         | `main/server/core` 54, `main/apps/web` 43, the rest 25                          |
| `raw-sql-outside-repos` |          149 | Statements started with the `@bslt/db` builder and SQL text handed to a client (`.raw`, `.unsafe`), outside `main/server/db/src/repositories` and the builder | `main/server/core` 107, the rest of `main/server/db` 39, realtime 2, workers 1  |
| `setinterval`           |           11 | `setInterval` calls in server code                                                                                                                            | Ten files; `workers/src/service.ts` is one call in a loop over its tasks        |
| `inline-style`          |          130 | JSX `style` props outside `@bslt/ui`; a style object that only sets CSS custom properties is not counted                                                      | `main/apps/web` 125, `@bslt/react` 5                                            |
| `opaque-schema`         |          431 | `createSchema(fn)` calls outside `main/shared/src/schema`                                                                                                     | `main/shared` 430, `main/apps/web` 1                                            |
| `unused-exports`        |          781 | Declarations a package source exports and no other file imports                                                                                               | `main/shared` 268, `main/apps/web` 191, `main/server/core` 89, server-system 69 |

The code is `main/tools/gates/ratchets/`: `counters.ts` (what is counted, on the TypeScript syntax
tree, so a comment or a string never counts), `ratchets.ts` (which files each one reads),
`ratchet.ts` (the budget and the comparison), `unused-exports.ts`. All read production sources only:
no test file, no `__tests__`, `tests` or `testing` directory, no build output.

Decisions:

- **The plan's numbers are still there, inside wider counts.** The plan counted 49
  `.catch(() => {})` in `main/server/core` and 129 `style={{` in the web app. The same patterns
  measure 49 and 129 today. The ratchets count more: every package, empty `catch` blocks, the other
  spellings of a handler that does nothing, and a `style` prop that is passed a variable.
- **`opaque-schema` counts `createSchema(fn)`**, as plan section 7.4 defines it. It does not look
  for schemas that accept `unknown` or `any`: until the schemas can describe themselves, every
  hand-written parser is opaque.
- **`unused-exports` uses the TypeScript compiler, not knip.** knip is not installed, and the rule
  is no package without need. One program over `main/` and `tests/`; an import is followed through
  barrels to the declaration. Test files count as importers, as in knip, so an export only a test
  uses is not reported. A namespace import, `export * as`, a dynamic `import()` and an
  `import('...')` type count as using every export of their module, which undercounts. The plan's
  899 was a different measure (`@bslt/shared` symbols with no importer outside `main/shared`).
- **`setinterval` reads server code only.** A browser has no scheduler to move a timer to; the four
  `setInterval` calls in the web app and `@bslt/react` are not counted.
- **`raw-sql-outside-repos` counts the rest of `@bslt/db` too** (queue store, search, client,
  roles): 39 of the 149.

### Part C: runtime dependency allowlist

`main/tools/gates/deps-allowlist.json` lists the 37 runtime dependencies (`dependencies`,
`peerDependencies`, `optionalDependencies`) that the 20 package manifests declare today, each with
`name`, `replacement`, `removeBy` and `conformance` from the table of plan section 13, and `usedBy`,
the packages that may declare it. The `deps-allowlist` gate of the merge lane fails on:

- an addition: a dependency that is not listed, or is listed for other packages only;
- an entry whose `removeBy` is a phase before the current one;
- an entry that no package declares any more, so the list only shrinks.

The current phase is read from one place, `CURRENT_PHASE` in `main/tools/lib/phase.ts`, and
`phase.test.ts` requires this README to report the same phase in its "Current status" heading.

| `removeBy` | Dependencies                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12         | `pino`, `pino-pretty`, `@fastify/compress`, `otpauth`, `argon2`, `@sentry/react`, `@sentry/node`, `@fastify/swagger`, `@fastify/swagger-ui`, `@simplewebauthn/browser` |
| 14         | `ws`, `web-push`, `ioredis`, `@aws-sdk/client-s3`, `@aws-sdk/credential-providers`, `@aws-sdk/s3-request-presigner`, `sharp`                                           |
| 15         | `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`                                                                                                               |
| 19         | `fastify`, `fastify-plugin`, `@simplewebauthn/server`, `postgres`                                                                                                      |
| 20         | Eleven dev tools declared as runtime or peer dependencies (below)                                                                                                      |
| permanent  | `react`, `react-dom`                                                                                                                                                   |

**Eleven entries are not in the plan's table.** `@bslt/build-config` declares ESLint and its
plugins, `typescript-eslint`, `vite` and `vitest` under `dependencies`; `@bslt/testing` declares
`vitest` (and `fastify`, which is in the table); `@bslt/db` declares `vitest` as a peer for its
`./testing` export. The rule exempts dev tooling, but it reads those three fields, so they are listed
with `removeBy: 20` and the replacement "declare it under devDependencies". Phase 20 is an assumption
of this change, not a plan decision: the plan's exit (`deps-allowlist.json` = `[react, react-dom]`)
needs them gone by then.

### Part C: control border and contrast gate

- **`--ui-color-border-control`** is the border of every control. It replaces
  `--ui-color-border-strong`, which five controls used (input, textarea, select, checkbox, switch).
  Ten more boundaries moved from the hairline to it: `.radio-circle`, `.btn-secondary`,
  `.oauth-button`, the file button, `.pagination-button`, `.pricing-table__toggle`, the two
  payment-method actions, the usage-override input, and the theme option of the settings page. The
  hairline `--ui-color-border` stays on decoration: card edges, dividers, table rules, menus.
  `main/client/ui/src/__tests__/control-borders.test.ts` holds the list in both directions.
- **The unchecked switch track is filled with the control colour.** It was filled with the hairline,
  and the thumb was 1.27:1 on it in both themes. It is 3.66:1 (light) and 3.70:1 (dark) now.
- **High contrast draws control borders in the ink** (`#000000` on light, `#ffffff` on dark): one new
  override in `@bslt/client-engine`.
- **The contrast gate** is `main/client/ui/src/theme/contrast.test.ts`, with the pairs in
  `contrast.ts`. It builds the token set of four themes (light, dark, and each with the high-contrast
  overrides) and derives the pairs from the token names: text and muted text on each surface, each
  ink on the page and a raised surface, the inverse label on each fill, `--ui-color-on-<name>` on
  `--ui-color-<name>`, alert text and badge ink on their fills, the control border on each surface a
  control sits on, the switch thumb on both tracks, and the focus ring against the surfaces and its
  own inner ring. 48 pairs per theme (47 in high contrast, whose focus ring is one ring). It fails
  under 4.5:1 for text and under 3:1 for controls and the focus ring. A colour token that is in no
  pair must be named as decoration, or the gate fails.
- **No token value had to change.** Every pair passes in all four themes. The tightest are muted text
  on a pressed surface in light (4.55:1) and the control border on a hovered surface (3.19:1 light,
  3.17:1 dark).

| Theme               | Control border on page / raised surface / hovered surface |
| ------------------- | --------------------------------------------------------- |
| light               | 3.66 / 3.51 / 3.19                                        |
| dark                | 3.70 / 3.48 / 3.17                                        |
| light high contrast | 21.00 / 21.00 / 18.30                                     |
| dark high contrast  | 21.00 / 19.80 / 18.04                                     |

### Final checks

On the tree of the commit that adds this section, Node 22 locally (CI runs the pinned Node 24):

| Check                                                                                                         | Result                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`                                                                        | 38 gates passed: the 31 of part B, `deps-allowlist` and the six ratchets                                                                                                                                                                                                                    |
| `pnpm bslt gate --self-test`                                                                                  | All 46 registered gates returned a result                                                                                                                                                                                                                                                   |
| `pnpm test:real-db` on PostgreSQL 17                                                                          | 38 files, 541 tests; no test database left behind                                                                                                                                                                                                                                           |
| `pnpm test:e2e -- --workers=2 --reporter=line` (fresh database, `pnpm db:push`, `bslt setup --preset docker`) | 334 passed, 90 skipped (capability-gated), 0 failed, 5.4 min: the baseline. Run at `b68a423`, which has every change of parts A, B and C that a browser can see, the axe spec included. What came after it is this section, a tools test, and three type exports removed from `contrast.ts` |
| Web and UI unit tests                                                                                         | `@bslt/web` 206 files, 2682 tests; `@bslt/ui` 86 files, 1364 tests                                                                                                                                                                                                                          |

The e2e setup on this machine: `pnpm bootstrap --preset docker --yes --skip-db --skip-docker
--skip-install` writes `config/env/.env.development` (database `abe_dev` on port 5432, password
`development`); create that database, then run `pnpm db:push` and `pnpm test:e2e` with
`POSTGRES_PASSWORD` set to the local superuser's password, which overrides the file. Remove the env
file and the database afterwards.

### Open after Phase 5

From part C:

- **The look changed and there is no screenshot baseline to show it.** Secondary, OAuth, pagination
  and file buttons, the radio circle, the pricing toggle and the theme option have a mid-grey border
  where they had a hairline, and a switch that is off has a mid-grey track. This is the owner
  decision "WCAG-compliant control contrast over the hairline look"; the catalog screenshots of plan
  section 12 (item 8) would have recorded it.
- **The contrast gate reads tokens, not rendered pixels.** Colours a stylesheet mixes
  (`color-mix()` for button hover and pressed states and for the tinted payment-method actions) are
  not computed. The rendered check is the axe spec in e2e.
- **High contrast is still a list of overrides in `@bslt/client-engine`**, not derived from the
  tokens (plan section 12, item 1). It does not override `--ui-color-text-inverse`, the alert and
  badge colours or the interaction surfaces; the gate holds the pairs that result.
- **The lint rule `no-empty-catch-callback`** of plan section 8.2 is not written. The
  `swallowed-catch` ratchet stops new sites in the merge lane; the rule would stop them in the editor.
- **`unused-exports` undercounts** where a module is imported as a namespace, and counts an export
  only a test imports as used. knip would be stricter on both; it was not added.
- **The eleven dev tools in runtime fields** (above) need a phase the owner agrees to.
- **Gates of plan section 14.3 that belong to later phases are not built**: `legacy-shim`,
  `frozen-paths`, `module-shape`, `module-graph`, `events`, `generated`, `endpoint-tests`,
  `jsx-a11y`, `i18n-literals`, `ssr-public-only`.

From parts A and B (details in their sections):

- The request filter runs before authentication, drops `null` from every body, and its SQL
  heuristics refuse ordinary text containing `--`, `/*` or `select ... from`.
- The split process roles of plan section 10.2 are not built; `PROCESS_ROLES` is `['all']`.
- Six `createMockLogger` copies remain in packages that cannot import `@bslt/testing`.
- The route-map suites still build their mock contexts by hand.
- The API snapshot does not cover realtime, media or the WebSocket gateway, and does not see a
  change inside a schema that keeps its name.
- The database catalog is compared only in the real-DB lane.
- What the snapshots showed about the product (routes with `emptyBodySchema` and no contract body,
  routes without a contract, undeclared auth on server-registered routes) is recorded, not fixed.

## Phase 5, part A: `buildApp()` and the testing kit (2026-11-12)

Branch `fix/security-defects-tamrnu`, on top of Phase 4 (`bd68c57`). Committed (`ab0ee6b`..), not
pushed. Part A covers three items of plan section 17.2, Phase 5: the red `api-response-sync` gate,
`buildApp()`, and `@bslt/testing` with the deletion of the hand-built test server. The snapshots,
the ratchets, the dependency allowlist and the contrast token are other parts of the phase.

| Step                                      | State | Notes                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-response-sync` green                 | Done  | The login body and its contract agree (asserted over HTTP in `users-settings.real-db`). The gate's check pinned one spelling of the handler's source; it now accepts the service user with its avatar resolved and has a test                                                                             |
| `buildApp()`                              | Done  | `main/apps/server/src/bootstrap/build-app.ts`: phases, then the composed app (`app`, `server`, `context`, `routes()`, `ready()`, `start()`, `stop()`). `bootstrap/system.ts` is deleted and tombstoned; `ServerRuntime` keeps signals and exit codes; `main.ts` loads the config and reads `PROCESS_ROLE` |
| Process role                              | Done  | `PROCESS_ROLES` is `['all']`, what one process runs today. Any other value stops the boot before anything is opened. The split roles of plan section 10.2 are not built                                                                                                                                   |
| Composition smoke test                    | Done  | `tests/integration/api/composition.real-db.test.ts`: `buildApp()` per role on an isolated database with the loader's own config, over real sockets (listens, serves `/health`, guards `/api/users/me`, releases the port and the pools)                                                                   |
| `@bslt/testing`                           | Done  | `main/testing`: `buildTestApp`, `buildTestServer`, `describeRealDb`, `describeOwnerIsolation`, fakes for the ports, one `createMockLogger`. Runs from source; turbo, the ESLint preset and the `declared-dependencies` gate cover it. `main/testing/README.md`                                            |
| Real-DB suites on `buildTestApp`          | Done  | 36 preamble copies replaced by `describeRealDb`; 28 suites boot the production `buildApp()` instead of a hand-wired server. No assertion changed                                                                                                                                                          |
| Route-map suites on the production server | Done  | 27 suites without a database use `buildTestServer` (the production `createServer()`). Four tests were corrected to the production answer (below)                                                                                                                                                          |
| Old helpers deleted, tombstoned           | Done  | `tests/integration/api/{test-utils,index,real-db-app,db-harness,db-harness-provisioning,seed-helpers}.ts`; the symbols `createTestServer`, `wireRealDbApp`, `createDbHarness`, `bootstrapServerSystem`                                                                                                    |

### What the production composition exposed

The integration suites ran on a server built by hand in `test-utils.ts`: no request filter, no error
handler, no multipart parser. Booted on the production server, existing tests failed on four
product defects. Each was fixed with a failing test first.

| Defect                                                                                                                                                            | Fix                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The request filter answered 400 for any body, query or path string containing `$`, `{`, `}`, `[` or `]` (a password ending in `$`)                                | `detectNoSQLInjection` flags an operator token (`$where`, `$ne`) or `__proto__`, not punctuation (`8574146`)  |
| The error handler derived the status from the error's kind: a schema failure (`RequestSchemaError`, 422) was answered 400                                         | The mapper uses the status the error carries (`ef14873`). **Production now answers 422 for a schema failure** |
| The error handler turned Fastify's own request errors into 500 and reported them: body over the limit (413), malformed JSON (400), unsupported content type (415) | They keep their status, in the validation envelope, unreported (`ef14873`)                                    |
| `POST /api/notifications/send` with `userIds: [null]`: the request filter drops null entries, and an empty list was read as a broadcast to every active user      | The schema refuses an explicit empty list (`cea578d`)                                                         |

Four tests asserted what the hand-built server did with input the production request filter refuses
before the handler or the guard runs. They now assert the production answer (400 `VALIDATION_ERROR`,
repository never reached): `billing.integration` (SQL in a sort parameter, was 200),
`jobs-flow.integration` (SQL in a path parameter), and two in `sessions.integration` (the same
unauthenticated, and an oversized string unauthenticated, were 401). These are the only assertions
that changed.

### The composed router, for `bslt snapshot api`

`buildApp(config, options)` (`@bslt/server/bootstrap/build-app`) returns the composed app:
`built.server` is the Fastify instance with every plugin, hook and route; `built.routes()` is the
list of routes Fastify registered, plugin routes included, as `{ method, url }` in registration
order (an `onRoute` hook installed first in `createServer`; Fastify's automatic `HEAD` routes are in
it). The list is complete after `await built.ready()`. Always `await built.stop()`.

- **With a database:** `buildApp(config)` runs every phase. `buildTestApp({ database })` from
  `@bslt/testing` does the same inside a `describeRealDb` suite and also has `routes()`.
- **Without a database** (the merge gate has none): pass `context`, and the infra, data and comms
  phases are skipped; nothing is opened. Route registration reads only `config`, `log`, `repos` (it
  closes over them for the guard) and `db.healthCheck` (the health sampler). From a plain script:

  ```ts
  const config = load({
    NODE_ENV: 'test',
    JWT_SECRET,
    COOKIE_SECRET,
    OAUTH_TOKEN_ENCRYPTION_KEY,
    DATABASE_URL,
  });
  const context = {
    config,
    log: createLogger('error', { service: 'route-snapshot', env: 'test' }),
    db: { healthCheck: () => Promise.resolve(true) },
    repos: {},
    errorTracker: {
      captureError() {},
      addBreadcrumb() {},
      setUserContext() {},
    },
  } as unknown as InfraContext;
  const built = await buildApp(config, { context });
  await built.ready();
  built.routes(); // 293 routes on the starter profile with this config
  await built.stop();
  ```

  Run under `node --conditions=source --import tsx` (as `bslt` does); `@bslt/tools` already depends
  on `@bslt/server` and `@bslt/server-system`. The fakes of `@bslt/testing` are Vitest spies and do
  not work outside a test run.

The route set depends on the config and the generated profile, not only on the code:
`auth.strategies` filters the auth routes, `billing.enabled` adds the two provider webhook routes,
`storage.provider: 'local'` adds `/uploads/*`, and realtime, media and the WebSocket gateway are
registered only when their capability is enabled in
`main/apps/server/src/bootstrap/generated/profile.generated.ts`. A snapshot should pin its
environment explicitly, as above, and read nothing from `process.env`.

### Open after part A

- **The request filter runs before authentication.** An unauthenticated request with input the
  filter refuses is answered 400, not 401 (the two `sessions.integration` tests). Both hooks are
  `preHandler`; the guard is route-level, so the filter always goes first.
- **The request filter still drops `null`** from every body (`removeEmpty`), so a handler never sees
  an explicit null, and its SQL heuristics refuse ordinary text that contains `--`, `/*` or
  `select ... from`. Only the notification broadcast was closed. Whether the filter should rewrite
  request bodies at all is a product decision.
- **Six `createMockLogger` copies remain** outside `tests/`: four in `main/server/media`, one in
  `main/server/db`, one in `main/apps/server`. Those packages cannot import `@bslt/testing`, which
  depends on the server app (a package cycle). They go when the kernel ports get a leaf package
  (Phase 7).
- **The route-map suites still build their contexts by hand** (mock repositories per suite). Plan
  section 14.4 folds that tier into module unit tests or deletes it as modules migrate; only its
  server is production code now.
- e2e was not run for part A. The 400 to 422 change is the one a browser could see.

## Phase 5, part B: the three oracle snapshots (2026-11-12)

Branch `fix/security-defects-tamrnu`, on top of part A (`90d10f5`). Committed, not pushed. Part B is
the first item of plan section 17.2, Phase 5: `bslt snapshot api`, `bslt snapshot db-catalog` and
`bslt snapshot web-routes`, their committed files and their checks. How to update one on purpose is
in [`docs/dev/workflow.md`](../../dev/workflow.md) under "Oracle snapshots".

| Snapshot     | File                                    | State | Check                                                                                                                                                       |
| ------------ | --------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`        | `main/tools/snapshots/api-surface.json` | Done  | `snapshot-api` gate in the merge lane. 228 routes from the production `buildApp()`, no database                                                             |
| `db-catalog` | `main/tools/snapshots/db-catalog.json`  | Done  | Real-DB lane only: the `Catalog snapshot` step of the CI `real-db` job and `tests/integration/database/db-catalog.real-db.test.ts`. 47 tables, 162 policies |
| `web-routes` | `main/tools/snapshots/web-routes.json`  | Done  | `snapshot-web-routes` gate in the merge lane. Two configurations (`starter` 38 pages, `everything` 65 pages), loaded through Vite, nothing rendered         |

The code is `main/tools/snapshot/` (`snapshot-file.ts` holds the file format, the comparison and the
diff; one module per snapshot). The snapshot files are in `.prettierignore`: their gates compare
bytes.

### Decisions and consequences

- **Schema identity is the expression the contract declares.** A schema of `@bslt/shared` is an
  opaque parser, so the API snapshot names it by the source text of its contract slot
  (`successResponseSchema(logoutResponseSchema)`), read with the TypeScript compiler from
  `main/shared/src/contracts`. A change inside a schema that keeps its name does not show. The plan's
  `sha256` of `describe()` (section 7.1) replaces this when the schemas can describe themselves.
- **`getRouteDefinition(entry)`** is new in `@bslt/server-system/http`: the route definition behind a
  registry entry, so the snapshot reads the schema object a route really validates with. The entry
  stays plain data (the admin route manifest returns it as JSON).
- **The API snapshot composes the widest route set of one configuration**: every auth strategy,
  billing on, local storage, on the generated `starter` profile. Realtime, media and the WebSocket
  gateway are off in that profile, so their routes are not in the snapshot until Phase 11 changes how
  capabilities are composed.
- **The catalog leaves out what the migrations alone do not decide**: extension members, the dated
  partitions of `events` (created for the current and the next month), an owner's own privileges
  (their list differs between Postgres 16 and 17), and cluster roles the catalog does not name. The
  output is the same on Postgres 16 and 17. A function is recorded with the SHA-256 of its body.
- **The web snapshot needed two seams in the web app**: `getPrimaryNavLinks()` in
  `main/apps/web/src/app/layouts/primaryNav.ts` (the left menu's links as data; `AppLeftMenu` renders
  them) and `routePageName()` in `routeLoad.ts` (the module export a code-split page is loaded from).
- **`@bslt/tools` has `exports`** for the catalog reader, and `tools` is a known target in the ESLint
  boundaries, so the real-DB suite imports it. `@bslt/testing` exports `./database` to the command.
- **This plan names the files `api-surface.json` (section 7.1) and `catalog.snapshot.json` under
  `main/kernel/db` (section 9.3).** The catalog snapshot here is the Phase 5 oracle in
  `main/tools/snapshots/`; Phase 6 builds the generator input the plan describes.

### Final checks

At `dc39d60`, Node 22 locally (CI runs the pinned Node 24):

| Check                                   | Result                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`  | 31 gates passed; `snapshot-api` and `snapshot-web-routes` are the two new ones                                         |
| `pnpm bslt gate --self-test`            | All 39 registered gates returned a result; `snapshot-db-catalog` checks the file's form there                          |
| `pnpm test:real-db` on PostgreSQL 17    | 38 files, 541 tests (the 537 plus the 4 catalog tests); no test database left behind                                   |
| `pnpm bslt snapshot db-catalog --check` | Passes on PostgreSQL 17 and 16, and under the CI job's role-split environment                                          |
| `pnpm test:e2e`                         | Not run for part B. Nothing a browser sees changed: the left menu renders the same links, and its tests pass unchanged |

### What the snapshots show about the product today

Recorded as they are; none was changed.

- **14 routes validate their body with `emptyBodySchema` while their contract declares no body**
  (`request` is set, `contract.body` is `null`), for example `POST /api/notifications/mark-all-read`
  and `DELETE /api/users/me/sessions/:id`.
- **7 route-map routes have no contract**: `/health`, `/health/detailed`, `/health/geo`,
  `/health/live`, `/health/ready`, `/metrics`, `/metrics/prometheus`.
- **12 routes are registered straight on the Fastify instance**, so nothing declares their auth
  (`registeredBy: "server"`, `auth: "undeclared"`): the two provider webhooks, `/api/csrf-token`,
  `/uploads/*` and the docs routes. Plan section 7.2 turns the webhooks into ordinary endpoints.
- **81 routes require the role `user`, 38 only a signed-in user.** Both are in the snapshot as
  declared; whether the difference is meant is a question for the module migrations.

## Phase 4, one CI, one deploy, version pins (2026-11-12)

Branch `fix/security-defects-tamrnu`, on top of Phase 3 and the dependency fix (`876de0a`).
Committed (`84e4655`..), not pushed, not merged. Three agents in sequence: the pins (`84e4655`);
`LISTEN_DATABASE_URL` and the `version-pins` gate (`a0d1181`..`525fbbc`); the app-only production
compose, `ci.yml`, `deploy.yml`, the deletions and the docs (`4b49191`..).

**No workflow has run on GitHub.** Nothing was pushed, and this environment has no Docker daemon.
Everything below was checked by simulation: the shell of the workflows runs under `sh`/`bash`
against stub `docker` and `curl` binaries, compose files are rendered by the real `docker compose
config`, the database server's `pg_hba.conf` and flags were started on a scratch PostgreSQL 17.11
cluster, and both workflows pass actionlint. The first run on GitHub is still the first run.

| Step                              | State | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version pins                      | Done  | `.node-version` (24.22.3), `infra/versions.env` (`POSTGRES_MAJOR=17`, `POSTGRES_IMAGE=postgres:17.11-alpine`, `PGBOUNCER_IMAGE` by digest), `engines.node` `>=24 <25`. Dockerfiles, compose files, workflows and the Terraform managed-database version read them                                                                                                                               |
| `version-pins` gate               | Done  | `main/tools/scripts/audit/version-pins.ts`, in the merge lane: Node and Postgres versions equal the pins everywhere, and every `uses:` names a 40-hex commit with the release in a comment (59 references in the three workflows and the setup action)                                                                                                                                          |
| `LISTEN_DATABASE_URL`             | Done  | The pub/sub listener has its own URL, the worker role direct to Postgres. Required in production; the config refuses one whose user differs from the worker's                                                                                                                                                                                                                                   |
| Production compose, app-only      | Done  | `infra/docker/production/docker-compose.prod.yml` has no `postgres` service and no database volume. PgBouncer and `bootstrap-roles` reach the server named by `POSTGRES_HOST` (required) and `POSTGRES_PORT`; the listener and `migrate` take it from their URLs. The API still holds no superuser or owner credential                                                                          |
| Database server compose           | Done  | `infra/docker/production/docker-compose.db.yml`: the pinned image on a named volume, host networking, `listen_addresses=localhost,<DB_LISTEN_ADDRESS>`, a `pg_hba.conf` that admits SCRAM logins to `POSTGRES_DB` from `APP_SERVER_CIDR` and no other remote client, healthcheck. No TLS: the two servers share a private network                                                               |
| Major-version guard               | Done  | The deploy asks the database server (`SHOW server_version_num`, `psql` from the pinned image, superuser password as environment) before it changes anything, and stops when the server does not answer or runs another major. It no longer reads a local volume                                                                                                                                 |
| `ci.yml`                          | Done  | Triggers: pull_request, push to `main`, nightly, manual. Jobs: `static`, `real-db`, five `security-*` scanners and a `security` verdict, `infra` on infra changes; `images` on push to `main`; `e2e`, `build`, `coverage`, `lighthouse` nightly and manual. Lanes in `docs/dev/workflow.md#lanes`                                                                                               |
| `deploy.yml`                      | Done  | Environments `staging`, `production`, `demo`. A `plan` job decides what a run does; `app` (deploy or rollback), `staging-images`, `demo`, `web` (Cloudflare), `terraform` (manual only). Described in `docs/deploy/README.md#automated-deployment-recommended`                                                                                                                                  |
| Rollback                          | Done  | `rollback_sha` input: pulls that commit's two images, rewrites the four image references of the compose file the last deploy left, keeps the `.env`, runs no database step, then the same health wait and image check. Simulated on the files a real deploy leaves; never run against a server                                                                                                  |
| Old workflows deleted, tombstoned | Done  | The eleven Phase 4 files of plan section 14.5. `.github/workflows` holds `ci.yml`, `deploy.yml`, `database-backup.yml`                                                                                                                                                                                                                                                                          |
| Tests                             | Done  | `workflows.test.ts` (lanes, the plan for every event, guards, Terraform backend check, directory, tombstones), `deploy-workflow-database-roles.test.ts` (61 cases: the remote script in both modes), `compose-database-roles.test.ts`, `compose-isolation.test.ts`, `demo-remote-deploy.test.ts`, `local-deploy-safety.test.ts`; `main/tools/lib/workflow-file.ts` reads workflow text for them |
| Docs                              | Done  | `docs/deploy/*` (two servers, where each database step runs, secrets and variables), `docs/dev/workflow.md` (lanes), `security-ci.md`, `staging.md`, `DIRECTION.md`, the README                                                                                                                                                                                                                 |
| Terraform remote state            | Open  | Owner decision: not in this repository (below)                                                                                                                                                                                                                                                                                                                                                  |
| Live staging rolling deploy       | Open  | Owner decision: not run now (below)                                                                                                                                                                                                                                                                                                                                                             |

### Owner decisions for Phase 4

- The production database runs on a **separate, self-hosted Postgres 17 server**. It has a real
  superuser, so `bootstrap-roles` works unchanged. The production app compose file loses its
  `postgres` service.
- **Terraform is not applied for this template and no remote state backend is added.** The decision
  moves to the fork. `infra/cloud` stays as reference code with its validation (the `infra` job of
  `ci.yml`).
- **No live staging deploy is run now.** That exit criterion is recorded as open.
- The **demo deployment keeps its own disposable database** in its compose file.

### Exit criteria

| Criterion                                                                   | Result                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old paths deleted: the workflows listed for Phase 4 in section 14.5         | Done: eleven files deleted and tombstoned                                                                                                                                          |
| `.github/workflows/` contains `ci.yml`, `deploy.yml`, `database-backup.yml` | Done; `workflows.test.ts` fails on any other file                                                                                                                                  |
| The `version-pins` gate is green                                            | Green                                                                                                                                                                              |
| Every lane runs Node 24 and PG 17                                           | In the files: every lane reads `.node-version` and `POSTGRES_IMAGE`, and the gate holds them to it. Not observed: no workflow has run, and the local checks ran on Node 22 (below) |
| A staging rolling deploy succeeds with no DB restart                        | **Open.** By construction the deploy cannot restart the database (it is on another server and in no compose file the deploy touches) and never takes the stack down; not run live  |
| Plan 17.2: "Add remote locked Terraform state"                              | **Not done**, by owner decision. `deploy.yml` refuses `terraform apply` until a backend is declared                                                                                |

### Final checks

Run on `78b333b` (documentation changed afterwards). All on Node 22.23.4, the local toolchain, not
the pinned 24.22.3; pnpm prints an engines warning and does not block.

| Check                                                                                                                | Result                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`                                                                               | 29 gates passed, 4m25s; lint, type-check and test 18 of 18 turbo tasks each                                                                                          |
| `pnpm bslt gate --self-test`                                                                                         | All 36 registered gates executed and returned a result. It failed for the four turbo gates on Node 22 until `78b333b` (pnpm's engines warning ahead of turbo's JSON) |
| `pnpm test:real-db` on PostgreSQL 17.11 (local cluster, port 5433, superuser env)                                    | 35 files, 521 tests passed, 1m40s                                                                                                                                    |
| actionlint 1.7.7 on the three workflows (release binary, sha256 checked against the release's checksum file)         | No findings                                                                                                                                                          |
| Scripted check: YAML parse, every `needs`, every `needs`/`steps`/`inputs`/`matrix` reference                         | No problems; it and actionlint both report seeded errors                                                                                                             |
| `docker compose config` for `docker-compose.prod.yml` (with and without `--profile ops`) and `docker-compose.db.yml` | Rendered by the tests (`compose-database-roles.test.ts`, `compose-isolation.test.ts`)                                                                                |
| The rendered `pg_hba.conf` and server flags of `docker-compose.db.yml` on a scratch PostgreSQL 17.11 cluster         | Password login from the admitted address to the application database works; another database, and loopback without a password, are refused                           |
| The `real-db` job's steps on a scratch database (roles, migrations, `db:audit --db`, Postgres smoke)                 | All passed (46 migrations, 9 smoke tests)                                                                                                                            |

Not run: any workflow on GitHub, any Docker container, Terraform, e2e (unchanged code paths; last
run in Phase 3).

### Workflow map

Old workflow and job on the left; where it is now on the right.

| Old                                                                          | New                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `continuous-integration.yml` / `quality-merge-gate`                          | `ci.yml` / `static`                                                                                                                                                                                                         |
| `continuous-integration.yml` / `real-db-gate`                                | `ci.yml` / `real-db`, plus a catalog check (`pnpm db:audit --db`) between the migrations and the suites                                                                                                                     |
| `continuous-integration.yml` / `docker-build-publish`                        | `ci.yml` / `images`                                                                                                                                                                                                         |
| `continuous-integration.yml` / `full-monorepo-checks` (`gate nightly`)       | `ci.yml` / `build` (`gate run build`): the merge lane is not run a second time                                                                                                                                              |
| `continuous-integration.yml` / `build-and-verify` (API governance)           | `ci.yml` / `build`, second step (`api-response-sync`, `api-client-sync`; `route-contract-coverage` is already in the merge lane)                                                                                            |
| `continuous-integration.yml` / `e2e-tests`                                   | `ci.yml` / `e2e`                                                                                                                                                                                                            |
| `continuous-integration.yml` / `coverage-report`                             | `ci.yml` / `coverage`                                                                                                                                                                                                       |
| `continuous-integration.yml` / `lighthouse`                                  | `ci.yml` / `lighthouse`                                                                                                                                                                                                     |
| `continuous-integration.yml` trigger: push to `dev`; input `full_build`      | Removed. Pushes to `main` only; a manual run always includes the nightly lane                                                                                                                                               |
| (none) `unit`                                                                | Not added: the merge gate in `static` already runs every package's unit tests                                                                                                                                               |
| `security-scanning.yml` / `codeql`                                           | `ci.yml` / `security-codeql`                                                                                                                                                                                                |
| `security-scanning.yml` / `semgrep`                                          | `ci.yml` / `security-semgrep`                                                                                                                                                                                               |
| `security-scanning.yml` / `dependency-scan`                                  | `ci.yml` / `security-dependencies`                                                                                                                                                                                          |
| `security-scanning.yml` / `gitleaks`                                         | `ci.yml` / `security-secrets`                                                                                                                                                                                               |
| `security-scanning.yml` / `trivy`                                            | `ci.yml` / `security-trivy`                                                                                                                                                                                                 |
| `security-scanning.yml` triggers (push and PRs to `main`/`dev`, weekly)      | Every CI run; new `security` job gives one verdict                                                                                                                                                                          |
| `dependency-audit.yml` / `audit` (`pnpm audit --prod`, daily)                | `ci.yml` / `security-dependencies`, a step that runs nightly and on manual runs                                                                                                                                             |
| `infrastructure-test.yml` / `test-infrastructure` (fmt, validate, structure) | `ci.yml` / `infra`, both providers, when a file under `infra/` changed and in the nightly lane                                                                                                                              |
| `infrastructure-test.yml` (plan with credentials, `test-config.sh`)          | Not carried over. A plan with credentials is `deploy.yml` / `terraform` with `terraform` = `plan`                                                                                                                           |
| `application-deploy.yml` / `get-infrastructure-info`                         | `deploy.yml` / `app`, step "Resolve the target server". The deployment-info artifact lookup is gone: that artifact was uploaded by a run of another workflow, where `download-artifact` v4 does not look without a `run-id` |
| `application-deploy.yml` / `deploy`                                          | `deploy.yml` / `app`, step "Deploy on the server" (mode `deploy`)                                                                                                                                                           |
| `application-deploy.yml` / `smoke-test`                                      | `deploy.yml` / `app`, step "Smoke test". The informational public probe is dropped                                                                                                                                          |
| `application-deploy.yml` inputs (`provider`, `image_tag`, `app_name`, ...)   | Removed. `APP_NAME` is a variable; an older build is `rollback_sha`                                                                                                                                                         |
| `staging-deploy.yml` / `validate` (`pnpm build`, `pnpm test`)                | `deploy.yml` / `staging-images`, step "Merge gate"                                                                                                                                                                          |
| `staging-deploy.yml` / `build-and-push-images`                               | `deploy.yml` / `staging-images`                                                                                                                                                                                             |
| `staging-deploy.yml` / `deploy-staging`, `staging-summary`                   | `deploy.yml` / `app` in the `staging` environment                                                                                                                                                                           |
| `demo-deploy.yml` / `build-and-deploy`                                       | `deploy.yml` / `demo`                                                                                                                                                                                                       |
| `deployment-rollback.yml` / `rollback-deployment`                            | `deploy.yml` with `rollback_sha`: `app` in mode `rollback` (and `demo`, `web` for their environments)                                                                                                                       |
| `infrastructure-deploy.yml` / `validate`                                     | `ci.yml` / `infra`                                                                                                                                                                                                          |
| `infrastructure-deploy.yml` / `deploy-infrastructure`                        | `deploy.yml` / `terraform` (`plan` or `apply`). No state artifact, no deployment-info artifact; apply refused without a remote backend                                                                                      |
| `infrastructure-destroy.yml` / `destroy-infrastructure`                      | Not replaced. Run `terraform destroy` by hand                                                                                                                                                                               |
| `web-deploy-cloudflare.yml` / `deploy`                                       | `deploy.yml` / `web`                                                                                                                                                                                                        |
| `database-backup.yml`                                                        | Unchanged, the one transitional file (deleted in Phase 20)                                                                                                                                                                  |

### Decisions and consequences

- **A security failure on `main` now holds the production deploy.** The deploy starts for a CI run
  that passed as a whole, and the scanners are part of that run now. Before, they were another
  workflow and the deploy did not wait for them.
- **The demo deploys after CI passed**, not in parallel with it, and no longer skips documentation-only
  pushes (the old `paths-ignore`).
- **Unconfigured targets are skipped, with a warning, on automatic runs** (no app server, no demo
  host) and fail a manual run. The Cloudflare job is skipped with a notice on every kind of run. In
  one workflow, a fork that uses one target would otherwise be red for the others on every push.
- **CI no longer runs on pushes to `dev`**, and the scanners run on every pull request instead of
  only those into `main` and `dev`.
- **The stack is never taken down.** `bootstrap-roles` and `migrate` run while the previous API
  serves; `docker compose up -d` then replaces the containers whose image or configuration changed
  (and Caddy is recreated when its Caddyfile changed, review finding 2).
  On one host with one API container this is a replacement with a health wait, not a rolling restart
  across replicas: there is a short gap while the API container is recreated.
- **New stack files are put in place only after every check passed.** A deploy that stops at the
  version check or a failed pull leaves the compose file of the running stack as it was.
- **A manual production deploy runs from `main` only**; any other commit is a rollback, because only
  CI on `main` builds production images.
- **Rollback does not touch the database or the `.env`.** Migrations only move forward, so the older
  code runs on the current schema.
- **Every secret is forwarded by name**, quoted by the SSH action, instead of being pasted into the
  script text (JWT, cookie, OAuth and SMTP values were). The action writes them as `export` lines
  into the text of the remote command, so they are in the app server's process list while a deploy
  runs (corrected in the review below, finding 9).
- Fixed while simulating: the health wait counted `(unhealthy)` as healthy; `up -d`, registry login
  and image pulls were not checked; the rollback SHA was validated line by line.
- `docker/build-push-action` is v6.19.2 everywhere (CI and staging used v5.4.0).
- `PGBOUNCER` still looks role passwords up as the superuser (`auth_query`), now over the private
  network. Unchanged from before; a dedicated lookup role would be a separate change.
- A server deployed before Phase 4 keeps its old `postgres` container and volume as orphans of the
  compose project. A deploy uses neither and removes neither; moving the data is a manual step
  (`docs/deploy/production-postgres.md#major-version-upgrades`).

### Review of the Phase 4 workflows (2026-11-12)

An independent reviewer read `ci.yml`, `deploy.yml` and the two production compose files and
reported twelve findings. Each was reproduced first, by a test that failed because of it, then
fixed; one commit per finding (`b953a57`..`51c3fbd`). The exception is the app-server half of
finding 9, which corrects a claim and changes no behaviour. Still nothing has run on GitHub: the same
simulations as above, now 293 cases in `workflows.test.ts` (134), `deploy-workflow-database-roles.test.ts`
(137) and `demo-remote-deploy.test.ts` (22). The remote script is delivered in them the way the SSH
action delivers it (quoted `export` lines and the script as one command text for `sh -c`).

| #   | Finding                                                             | What changed                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The Caddyfile was mounted at `/e./Caddyfile` (unescaped `sed` dots) | One escaped pattern on the mount source. Caddy had been running its image's default configuration after every workflow deploy                                                                                         |
| 2   | A changed Caddyfile never reached the running Caddy                 | After `up -d` the script compares the file Caddy reads with the one on disk and recreates Caddy alone when they differ                                                                                                |
| 3   | Re-running an older CI run redeployed its commit                    | The plan reads the run attempt; a later attempt deploys only while its commit is the tip of `main`                                                                                                                    |
| 4   | Staging runs could deploy out of order                              | A run-level concurrency group for staging runs; every other run has a group of its own                                                                                                                                |
| 5   | Compose altered secrets written unquoted into `.env`                | Free-text values are single-quoted. A value that would still not arrive as configured stops the deploy first                                                                                                          |
| 6   | `SMTP_USER` / `SMTP_PASS` never reached the API                     | The API service passes both through by name                                                                                                                                                                           |
| 7   | The SSH action cut the script off after ten minutes                 | `command_timeout: 40m`                                                                                                                                                                                                |
| 8   | The health wait ignored a service that was not `Up`                 | Every service of the compose file is asked for by name and must report `(healthy)`                                                                                                                                    |
| 9   | Secrets on remote command lines                                     | Demo: the build moved to `demo-images` (packages: write); `demo` has packages: read and sends its token on standard input. App server: **not changed**, the comment and the docs now say what the action does (below) |
| 10  | Nightly and manual CI runs shared the queue of pushes to `main`     | The CI group carries the lane (`heavy` or `gate`)                                                                                                                                                                     |
| 11  | A manual production deploy did not wait for CI                      | The plan asks for a passed, push-started CI run of the commit, and compares the full ref                                                                                                                              |
| 12  | No SSH host key was verified                                        | `SSH_HOST_FINGERPRINT` (app server) and `DROPLET_KNOWN_HOSTS` (demo) pin the keys. Both are optional: without them a run warns and behaves as before                                                                  |

Decisions and consequences:

- **Finding 3 does not make the deploy "tip of `main` only".** A first attempt still deploys the
  commit CI ran on, even when a newer push is already in CI: the runs of `main` finish in push order.
  Only a later attempt is checked against the tip.
- **Finding 4**: a waiting staging run is cancelled by a newer one, as under the old
  `staging-deploy.yml`. Manual staging runs (rollback and Terraform included) are in the same queue.
- **Finding 5** also refuses white space at either end of a value and white space followed by `#`.
  Compose would carry those in single quotes, but the API's own loader (`config/factory.ts`, `load`)
  trims every value and cuts it at ` #`, for environment variables as well as files. That behaviour
  is unchanged; it is the reason for the refusal.
- **Finding 6** leaves `SMTP_PORT` and `SMTP_SECURE` at the API's defaults (587, STARTTLS): the
  workflow has no setting for them.
- **Finding 9, app server.** The SSH action puts the forwarded values into the command text, where
  any local user of the app server can read them while a deploy runs. Removing that means replacing
  the action with a plain `ssh` that sends the script on standard input, which rewrites the step and
  its simulation; not done here. The demo job already uses plain `ssh` and is fixed.
- **Finding 12 is opt-in.** Making the two values required would stop every deploy of an existing
  setup until the owner adds them, so that is left to the owner.
- The demo is now two jobs in the `demo` environment. With required reviewers on it, a run asks twice.

### What stays open

For the owner:

- **Pin the SSH host keys**: the secrets `SSH_HOST_FINGERPRINT` (per environment) and
  `DROPLET_KNOWN_HOSTS` (`docs/deploy/secrets-checklist.md#ssh-host-keys`). Until then each deploy
  warns and the connection is not verified. Then decide whether to make them required.
- **Create the GitHub environments** `staging`, `production` and `demo`, and set, per environment:
  the variable `DB_HOST` (required; plus `DB_PORT`, `DB_NAME` if not `5432` / `abe_stack`), and
  `DEPLOY_HOST` (or keep `INSTANCE_IP` / the secret `SERVER_HOST`). Existing repository-level
  secrets keep working. The full list is `docs/deploy/secrets-checklist.md`.
- **Set up the database server** before the first deploy: `docker-compose.db.yml` with
  `DB_LISTEN_ADDRESS` and `APP_SERVER_CIDR`, `POSTGRES_DB` equal to `DB_NAME`, and its superuser
  password as the secret `DB_PASSWORD`. Without `DB_HOST` the app deploy stops before it touches the
  server.
- **The first real deploy onto a separate database server**, and the live staging deploy that closes
  the exit criterion. `docker-compose.db.yml` has never been started by Docker: host networking and
  the inline `configs` file (Compose 2.23.1 or later) are unproven.
- **Terraform remote state and apply**, in the fork. Until a `backend` block exists, `apply` is
  refused. The reference Terraform creates one server and knows nothing of a database server.
- **Branch protection**: the job names to require are now `static`, `real-db` and `security`.
- The GitHub Actions budget was unavailable when the demo was last deployed
  (`docs/deploy/demo-manual-deploy.md`); `pnpm deploy:demo` remains the path until it is restored.

Known and not fixed here:

- **Listener TLS.** The API has one `DB_SSL` switch for all its connections, and the app compose
  file sets it to `false` for the PgBouncer hop, so the listener's direct connection to the database
  server is not encrypted by this stack. The layout assumes a private network
  (`docs/deploy/production-postgres.md#ssl-configuration`).
- **`database-backup.yml` on a GitHub-hosted runner cannot reach a database that listens on a private
  address.** The host-cron script on the database server is the working path.
- ~~The `api-response-sync` gate fails at HEAD~~ Fixed in Phase 5, part A (`ab0ee6b`): the handler and
  the contract agreed, the gate's source check was stale.
- **The demo database is not reset on every deploy** (plan 14.5: "while baselines are unfrozen"). It
  is dropped only when its volume holds another Postgres major. The unconditional reset belongs with
  the baseline reset of Phase 6.
- `pnpm bslt rename` does not know `docker-compose.db.yml`, and `@types/node` is `^26` while the
  runtime pin is 24.
- Terraform (`infra/cloud`) names PostgreSQL 17 for the optional managed database; nothing was
  applied.

## Phase 3, alias collapse and `@bslt/build-config` (2026-11-12)

Branch `fix/security-defects-tamrnu`, on top of Phase 2 (`8166814`). Committed (`56c4e33`..`7945896`),
not pushed, not merged. Two agents split the work: the build-config package and the server side
(`56c4e33`..`97aac71`), then the client side, the deletions and the docs (`850c2bc`..`7945896`).

| Step                     | State | Notes                                                                                                                                                                                                                                                                                      |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@bslt/build-config`     | Done  | `main/build-config`: `./vite` (`defineViteConfig`, Vite's client and SSR conditions with `source` first), `./vitest` (`defineVitestConfig`), `./eslint` (the preset; the root `eslint.config.ts` re-exports it), the `bslt-esm-fix` bin. Every build and config imports it by package name |
| `source` condition       | Done  | `config/tsconfig.base.json` sets `customConditions: ["source"]`; every built package's `exports` entry is `{ source, types, default }`. Missing subpaths that consumers imported were added (core 29, server 13, server-system 5, realtime 1, shared 1)                                    |
| Server-side packages     | Done  | shared, db, server-system, storage, comms, media, realtime, core, workers, server, tests (`#tests/*`), tools: one commit each, paths and Vitest aliases removed                                                                                                                            |
| Client packages          | Done  | api, client-engine, react, ui: paths and aliases removed; ui's 9 internal aliases became relative imports, its `@hooks/*` imports `@bslt/react/hooks`. @bslt/tests declares each client package it imports                                                                                 |
| Web app                  | Done  | 12 aliases became one `imports` key, `#app/*` → `./src/*` (448 specifiers, 208 files); `exports` (`source` only) for the 11 subpaths the tests import; Vite and Vitest use the build-config factories                                                                                      |
| Deletions and tombstones | Done  | `vite-tsconfig-paths`, `main/tools/scripts/audit/shared-vitest-aliases.ts`, the root `vitest.config.ts` shim and `ensure-js-extensions.ts` deleted and tombstoned. New `TOMBSTONED_PATTERNS`: no `"paths"`/`"baseUrl"` in any tsconfig, no `alias:` in any Vite or Vitest config           |
| Docs                     | Done  | `docs/dev/configuration.md` (module resolution), `testing.md`, the web README, ONBOARDING, principles, DIRECTION                                                                                                                                                                           |

### Exit criteria

| Criterion                                                                   | Result                                                                                                    |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Zero tsconfig `paths` entries                                               | 0 (538 entries in 27 files at `8166814`); `baseUrl` also 0. The `tombstones` gate fails if one comes back |
| `vite-tsconfig-paths` and `shared-vitest-aliases.ts` deleted and tombstoned | Done; also the symbol `createSharedVitestAliases` and the root Vitest shim                                |
| No relative `../../tools` import                                            | None outside the history docs                                                                             |
| The turbo graph includes `@bslt/tools` and `@bslt/build-config`             | Yes: 18 packages run lint, type-check and test                                                            |

### Final checks

Run on `7945896` (code unchanged since `66789e3`):

| Check                                                                                                                            | Result                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CI=1 TURBO_FORCE=1 TURBO_CONCURRENCY=2 pnpm bslt gate merge` (ESLint cache cleared)                                             | 27 gates passed, 6m46s; 18 lint, type-check and test tasks each, uncached                      |
| `pnpm exec turbo run build --filter=@bslt/web --force` (client build, SSR build, prerender)                                      | Passed; prerender wrote 9 files                                                                |
| `pnpm exec turbo run build --filter=@bslt/server... --filter=@bslt/realtime --filter=@bslt/workers --filter=@bslt/media --force` | Passed, 10 tasks                                                                               |
| `pnpm test:real-db` (local Postgres 16, superuser env)                                                                           | 35 files, 521 tests passed                                                                     |
| `pnpm test:e2e -- --workers=2 --reporter=line` (fresh database, `pnpm db:push`, `bslt setup --preset docker`)                    | 334 passed, 90 skipped (capability-gated), 0 failed, 5.7 min; the same as the Phase 1 baseline |

### Decisions and consequences

- **One `#app/*` key for the web app.** The plan names `#app/*`, so it maps to `./src/*` and
  replaces all 12 aliases, including `@/`; the feature shortcuts (`@auth`, `@admin`, `@billing`,
  `@dashboard`, `@settings`) fold into `#app/features/<name>`. The price is `#app/app/...` for files
  under `src/app`.
- **`imports` needs two conditions.** TypeScript does not try extensions on an `imports` target and
  takes an array of fallbacks; Vite tries extensions but rejects arrays. The key's `types` condition
  lists `*.ts`, `*.tsx`, `*/index.ts`, `*/index.tsx` for TypeScript, and `default` is the
  extensionless path for Vite, Vitest and ESLint. The ESLint resolver therefore no longer lists the
  `types` condition (it took only the first array entry); workspace packages still resolve through
  `source` first, and boundary probes are still rejected.
- **Libraries use relative imports for their own files.** ui's internal aliases became relative paths
  (the package already had 319), so its built `dist` no longer carries specifiers tsc left
  unresolved.
- **The web SSR build reads workspace packages from source** again (`defineViteConfig` sets the SSR
  conditions too). Against a build of `8166814`, the client bundle has the same 96 files (62 bytes
  smaller in total) and the prerendered pages differ only in the order of two `modulepreload` links.
- **`Dockerfile.web` moves from Node 20 to 22.** Vite bundles a config file but leaves its package
  imports to Node, which loads `@bslt/build-config/vite` by type stripping (Node 22.18 or later).
  Phase 4 pins 24 everywhere.
- **Package lint does not apply the boundaries rules.** The preset's boundary block uses root-relative
  `files` globs, so only the root ESLint run (the pre-commit hook, `lint-staged`) checks boundaries;
  `turbo lint` inside a package does not. Found while converting web; not changed in this phase.
- A consumer now declares every workspace package it imports: without `paths` an undeclared import
  does not resolve. `@bslt/tests` declares the client packages and `@bslt/web`.
- Known and not fixed here: `@bslt/realtime` imports `ws` without declaring it, so the server image
  (which copies realtime's `dist` by hand) cannot load it; the server image build was simulated step by
  step (no Docker daemon here) and `Dockerfile.web` was not built.
  **Fixed after Phase 3:** `ws` is a dependency of `@bslt/realtime`; the server Dockerfile ships the
  hand-copied capabilities with `infra/docker/ship-capability.sh`, which copies their third-party
  dependency closure, and loads each one in the production stage. The new `declared-dependencies`
  merge gate fails an import its package does not declare (it found 30 package/dependency pairs,
  `ws` among them, all declared now) and a production-source import of a devDependency in a
  package an image ships.

## Phase 2, tools spine (2026-11-12)

Branch `fix/security-defects-tamrnu`, on top of the Phase 1 merge (`a70ed1f`) and the dependency fix
`c4e5c00`. Committed (`72c5f25`..), not pushed, not merged.

| Step                            | State | Notes                                                                                                                                                                                                                                                                     |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@bslt/tools` package           | Done  | `main/tools/package.json` (bin `bslt`, run with tsx and `--conditions=source`); turbo lints, type-checks and tests it. `type-check:tools`, `test:tools`, the hand-picked tools lint and `test:profiles` are deleted                                                       |
| Gate registry                   | Done  | `main/tools/gates/registry.ts`: 34 gates (27 merge, `build` nightly, 6 manual) and 13 reports. Every audit exports `run()`; `registry.test.ts` fails on an audit or lint script that is neither a gate nor a report                                                       |
| `bslt gate --self-test`         | Done  | Runs every gate once in about 7s, no database: audits for real, turbo gates as `--dry=json`, Prettier on one file. In CI before the merge gate                                                                                                                            |
| `bslt gate merge` and parity    | Done  | `gates/merge-parity.ts` records `ci:merge-gate` at `c4e5c00` expanded (31 commands); `merge-parity.test.ts` holds the lane to it. Both ran on `3bacfe2` with the same result (below), then the chains were deleted                                                        |
| `--changed` and pre-push        | Done  | `bslt gate merge --changed` (merge base logic now in `main/tools/lib/merge-base.ts`); pre-push default runs it, `PRE_PUSH_FAST` and `PRE_PUSH_FULL` map onto `bslt gate run headers test-pairs lint` and `bslt gate nightly`                                              |
| Chains and filter lists deleted | Done  | `ci:merge-gate`, `ci:merge-gate:local`, `ci:fast`, `ci:fast:local`, `ci:verify`, `ci:local`, `lint:merge-gate`, `lint:fast` and their 125 `--filter` flags; `ci:full` is `bslt gate nightly`, `ci:everything` is rewritten on bslt. CI and the docs name the new commands |
| Entry guards deleted            | Done  | `isEntryModule` guards and `main/tools/scripts/is-entry-module.ts` are gone; scripts run through the registry or `bslt <command>` (`cli/scripts.ts`). `process.argv[1]` is tombstoned outside the server's container entries                                              |
| `main/tools/lib/paths.ts`       | Done  | One repository-paths module; vite-build-args, csp-sync, test-pairs, the Playwright config and every depth- or cwd-relative tools root use it. The real-DB suites are selected by suffix                                                                                   |
| `bslt rename`, root scripts     | Done  | `bslt rename` and `bslt rename scope` front the rename tools (tests kept). Root scripts: 131 at `c4e5c00`, 44 now; the removed ones are tombstoned                                                                                                                        |

### Merge gate parity

`ci:merge-gate` at `c4e5c00`, expanded through every `pnpm <script>` it called, against the merge lane
of `bslt gate merge`:

| #     | Old chain command                                                | Gate now                                                       |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 1-2   | `sync-file-headers.ts --check`, `sync-ts-references.ts --check`  | `headers`, `ts-references`                                     |
| 3     | `profile-boundaries.ts`                                          | `profile-boundaries`                                           |
| 4-5   | `starter-defaults.ts`, `starter-docs.ts`                         | deleted (plan 14.3 assigns them to Phase 1/2)                  |
| 6-18  | the rest of `audit:template`                                     | `client-surfaces` .. `docs-links`, same order                  |
| 19-22 | the four `lint:css` scripts                                      | `css-tokens`, `responsive`, `dead-classes`, `undefined-tokens` |
| 23    | `gate-coverage.ts`                                               | `gate-coverage`, then `tombstones` (new as a gate)             |
| 24-26 | `tsc` tools, `tsc` profiles, `vitest main/tools main/profiles`   | the `@bslt/tools` tasks of `type-check` and `test`             |
| 27    | `prettier --no-cache --check .`                                  | `format`                                                       |
| 28    | `colocated-test-pairs.ts --strict`                               | `test-pairs`                                                   |
| 29-31 | turbo `lint`, `type-check`, `test` with 16 `--filter` flags each | `lint`, `type-check`, `test` over the package graph (17)       |

Both on the same tree (`3bacfe2`), with `CI=1 TURBO_FORCE=1 TURBO_CONCURRENCY=2`: `pnpm bslt gate merge`
passed, 27 gates, 328s; `pnpm ci:merge-gate` passed, 333s. Each ran 17 uncached turbo tasks per lint,
type-check and test step.

### Final checks

Run on `0ec08bf` (the last code and docs commit):

| Check                                                            | Result                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge --concurrency=2`                           | 27 gates passed, 303s; 17 lint, type-check and test tasks each, uncached                                                                        |
| `pnpm bslt gate --self-test`                                     | 34 gates executed and returned a result, 8s                                                                                                     |
| `pnpm test:real-db` (local Postgres 16, superuser env as listed) | 35 files, 521 tests passed                                                                                                                      |
| `pnpm db:audit`                                                  | passed                                                                                                                                          |
| `pnpm pre-push --dry-run` (changed mode)                         | merge base `c4e5c00` with `origin/fix/security-defects-tamrnu`, 182 changed files; every merge gate planned, turbo with `--filter=...[c4e5c00]` |

### Decisions and consequences

- `main/profiles` is folded into `@bslt/tools` (lint, type-check and test) rather than kept as a root
  script; a change under it adds `--filter=@bslt/tools` in the changed lane. Tools type-check and test
  are uncached in turbo, because the tools audit the whole tree.
- gate-coverage check #2 went with the filter lists. It is replaced, not dropped: every workspace
  package must define `lint`, `type-check` and `test`, which is what makes turbo reach it. Check #1 now
  checks that the real-DB suites are selected by their suffix (`REAL_DB_TEST_SUFFIX`) and excluded from
  `test:integration`, instead of comparing a 35-file list.
- `main/apps/server/src/migrate.ts` and `bootstrap-roles.ts` keep their guard: the image runs them by
  path as `dist` entries. It is the only guard left, and the only allowed `process.argv[1]` read.
- The `merge` and `changed` lanes hold the same gates; `--changed` narrows turbo to the changed packages
  and their dependents and Prettier to the changed files. The repository audits are fast (about 5s) and
  read the whole tree in both.
- Audits that generate output (graphs, line counts, usage reports, health-check, bundle-monitor,
  responsive-sweep, check-smtp-env) are reports (`bslt report <id>`), not gates, so the self-test does
  not need a browser, a build or `npx madge`.
- `api-response-sync` fails on `main` and before this phase (one runtime check: `login(200)` user
  payload). It is a manual gate run by the nightly API governance job, so that job stays red until the
  Phase 8 generators replace it. `bundle-size` and `bundle-monitor` looked for the web build under a
  `src/apps/web` root that never existed; they now read `main/apps/web`.
- The rename tools stay in `main/tools/scripts/starter/` behind `bslt rename`; `starter:verify` is gone
  and the docs point at `bslt gate merge`.

## Phase 1, extract distribution machinery and Rust (2026-11-11, merged)

Branch `fix/security-defects-tamrnu`, restarted from `main` after the Phase 0 merge (`f082f54`),
pushed at `b4e89da`. Merged to `main` as `a70ed1f`. The owner chose not to publish the Phase 0 fixes to the public `bslt-core` repository
before the Core publishing workflow was deleted.

| Step                                     | State | Notes                                                                                                                                                                                                                   |
| ---------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 1: safe main-module guards            | Done  | 32 scripts behind `isEntryModule` (also correct through symlinks, which the plan's form is not); `main/tools/scripts/is-entry-module.test.ts`                                                                           |
| Lighter pre-push                         | Done  | Default mode checks only what changed since the merge base with the upstream branch; `PRE_PUSH_FAST`/`PRE_PUSH_FULL` unchanged                                                                                          |
| e2e green (exit criterion)               | Done  | Full suite 334 passed, 0 failed, 90 skipped (capability-gated) at `dd63838`; see "e2e baseline" below                                                                                                                   |
| PR 2/3: `bslt-distribution`, Kanu import | Done  | Owner side: `bslt-distribution` tag `frozen-2026-11-10`, Kanu branch `import/bslt-server-rust` (local, not pushed)                                                                                                      |
| Delete distribution machinery            | Done  | `main/editions`, `main/extensions`, `main/apps/storefront`, `infra/storefront`, `main/tools/{features,setup}`, `main/tools/scripts/{editions,recipes,profiles}`, prune and smoke scripts, their root scripts and audits |
| Rust handoff                             | Done  | `main/apps/server-rust`, `rust-access`, its e2e spec, vite and Playwright configs, `rust-backend.yml`; pointer in `docs/archive/server-rust.md`                                                                         |
| Phase 1 workflows                        | Done  | `editions`, `publish-core`, `storefront-deploy`, `rust-backend`, `template-readiness`, `auto-merge-claude-sessions`, `pr-preview`, Woodpecker                                                                           |
| Lighter CI                               | Done  | PRs and pushes run only the merge gate and the real-DB gate; heavy jobs run nightly. See `docs/dev/workflow.md#lanes`                                                                                                   |
| Docs and first tombstones                | Done  | `main/tools/gates/tombstones.ts`, enforced by `tombstones.test.ts` in `pnpm test:tools` until the Phase 2 gate registry runs it                                                                                         |

### Decisions and consequences

- The profile generator (`main/tools/scripts/profiles`) is deleted as the plan lists, but
  `main/profiles` stays until Phase 11. The three profile `*.generated.ts` files are frozen at the
  `starter` selection; `profiles:check` is no longer in `audit:template`.
- `docs/dev/setup.md` and `docs/recipes/README.md` documented only deleted tooling and are deleted
  and tombstoned with it.
- Deploys are no longer gated on e2e or the full monorepo checks: those moved to the nightly lane.
  The image build on push to `main` waits for the merge gate and the real-DB gate. Deploy
  workflows now act only on push-triggered CI runs.
- Kept for later phases although the plan's audit list (section 14.3) names them for Phase 1:
  `audit:starter-docs` and `audit:starter-defaults` do not read deleted code, and the parallel
  guard work edits them. They go with the Phase 2 gate registry.
- `pnpm audit:api-docs` was only run by `pr-preview.yml`. It reports drift on `main` too (the
  generator's output is reformatted by Prettier), so it is not moved into a CI lane; fix it with
  the Phase 8 generators.
- The Phase 0 deferrals (billing feature-pack template, `starter:prune` of `support`/`analytics`)
  are void: that tooling is gone from bslt-main.

### e2e baseline

The full Playwright suite (chromium and mobile-chrome, 424 tests) was run at `ff07d363` (before
Phase 0) and at `b4e89da` with the same setup. Before: 124 failed, 210 passed. After: 125 failed,
209 passed. Every failure after Phase 0 and 1 also fails before them, except one mobile `sms-2fa`
test that is flaky at both commits (it mocks login but not the dashboard endpoints). CI never
showed this because its e2e job died in setup at `ff07d363`. The 124 pre-existing failures have six
causes:

1. A second copy of React in the Vite dev server: the dashboard crashes with "Invalid hook call"
   after a UI login (55 tests).
2. `pnpm bootstrap --preset docker` writes `VITE_APP_NAME=Abe`; the tests expect "Your App" (22).
3. The register form gained an age/jurisdiction consent checkbox the tests do not tick (18).
4. The landing page behind the auth modal has its own "Sign in" link, so `getByText('Sign in')`
   matches twice (13).
5. The API smoke users have not accepted the ToS other specs publish: 403 TOS_ACCEPTANCE_REQUIRED (15).
6. Account deletion re-auth prompt, same layout cause as 2 and 4 (1).

Fixed on 2026-11-12 (`44ee9f2`..`dd63838`); the full suite then ran 334 passed, 0 failed, 90
skipped. Some causes were not what the list above says:

1. Not a second React: `NewDeviceBanner` called the toast store's hook inside an effect (a hook
   call outside render). Fixed in the component; it threw in production builds too.
2. The specs read `VITE_APP_NAME`; the preset keeps its name.
3. One shared register helper ticks every required consent.
4. Locators scoped to the auth modal. The forgot-password check also exposed a product bug: the
   modal closed on success with no confirmation. It now shows "Check your email".
5. The legal-template migration publishes ToS v1, not other specs; seeded users now get the
   consent rows a real signup writes. The smoke also refreshes its token after revoke-all
   (Phase 0, T-AUTH-I06).
6. The sudo modal has a confirm step before the password, and a grace-period login now lands on
   `/reactivate` by design.

Masked behind cause 1 until then: `loginViaUi` waited for an email or Logout button the header no
longer shows, settings became a modal (second dialog, overlay over the bell), notification seeds
stored `data` as a JSON string, and signed avatar URLs change per response. The mocked-login specs
(SMS, TOTP, passkey, magic link, email code) now mock the dashboard calls that signed them out.

## Phase 0, security fixes (2026-11-11, merged)

Branch `fix/security-defects-tamrnu` (continued in a cloud session from `fix/security-defects`
at `b8a1f9cc`). Implementation complete; the final gate passed on 2026-11-11 (see below). Merged to `main` as `f082f54`.

| Stage                           | State | Verified by                                                                                                                                      |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Realtime record API lockdown    | Done  | 132 realtime tests, shared pubsub and realtime suites, 15 real-DB tests (the promote-to-admin write is refused)                                  |
| Signed local-storage URLs       | Done  | 68 storage tests, server static and bootstrap tests, config tests, 3 real-DB file tests                                                          |
| Database roles and pools        | Done  | Real-DB suite on the role split; deploy, compose and CI rewritten and verified by rendering and simulation                                       |
| RLS foundation (`0919`)         | Done  | 60 foundation real-DB tests; HTTP suites run on the production wiring (`bslt_app` for users, `bslt_worker` for sessionless code)                 |
| RLS: identity tables            | Done  | 80 real-DB tests (`rls-identity`), attack probes (CTE/MERGE/ON CONFLICT role changes, trigger bypass, spoofed `app.role`, demotion)              |
| RLS: tenant tables              | Done  | 40 real-DB tests (`rls-tenants`); attack probes found and fixed a cross-tenant invitation forgery before commit                                  |
| RLS: billing, comms, compliance | Done  | 67 real-DB tests (`rls-billing-comms`); billing writes go through the system port                                                                |
| RLS: system and content tables  | Done  | 37 real-DB tests (`rls-system-content`); structural proof over the catalog (`rls-structure`); `pnpm db:audit` fails on an unclassified table     |
| One anonymization format        | Done  | 21 real-DB tests in `data-hygiene`, run with the narrowed system grants; one implementation in `main/server/core/src/users/pii-anonymization.ts` |
| Six small defects (plan list)   | Done  | One failing-first test each (SRV-02, T-AUTH-I09, T-AUTH-I06, T-AUTH-I11, DB-05, SHR-05)                                                          |
| Review, repair and final gate   | Done  | Whole-diff attack review: 11 findings, 9 confirmed, 7 fixed with failing-first tests, 2 deferred to Phase 1; final gate green                    |

### Still open before Phase 0 can merge

1. Merge to `dev` and `main` is the owner's call. Final gate on `4983a75`: headers, sync-ts,
   `audit:template`, `lint:css`, gate coverage, tools type-check and tests (640), Prettier, test
   pairs, ESLint, type-check and unit tests of all packages, real-DB suite, Postgres smoke on a
   bootstrapped and migrated database, `db:audit` and `db:audit --db`: all pass.
2. The Deploy workflow needs three new repository secrets before the next deploy:
   `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `DB_WORKER_PASSWORD` (`openssl rand -hex 32` each).
3. Accepted residuals, recorded for later phases: `security_events` writers on a user session pass
   the system handle at 5 call sites rather than one emitter (the outbox absorbs it);
   `token_version` and `password_hash` stay writable by the row owner; a user may choose its own
   deletion grace period; a tenant admin can set `is_billing_admin` and `custom_role_id`; a tenant
   owner can set `owner_id` to a non-member; storage blobs of purged users stay (files module);
   PII outside the `users` row stays until the Phase 15 compliance module; the e2e fixtures and
   the Postgres smoke test still write through a superuser URL.

4. Deferred to Phase 1, which deletes this tooling from bslt-main (the frozen copies in
   `bslt-distribution` are not affected): the billing feature-pack template
   (`main/extensions/billing`) no longer compiles against Core and its writes are refused by RLS;
   `starter:prune` of `support` or `analytics` leaves `0922`/`0923` classifying a table the prune
   removed.

### Design decisions made in this stage

- Roles: `bslt_owner` (owns objects, runs migrations), `bslt_app` (DML only, acts as
  `authenticated`), `bslt_worker` (cross-user access only through `system_access_policy TO
bslt_system`; no longer a member of `authenticated`). `authenticated`, `bslt_system` and
  `bslt_definer` are `NOLOGIN` policy targets. `bslt_definer` is granted to `bslt_owner` so the
  `SECURITY DEFINER` helpers can read `memberships` and `users` after they are forced.
- Any session with a user id runs `SET LOCAL ROLE authenticated` before the `app.*` settings.
  Platform admins too: admin rights come from `app_current_user_is_platform_admin()`, which reads
  `users.role` on every statement. No policy reads the `app.role` JWT claim.
- Env: `DATABASE_URL` (app), `WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, optional
  `DATABASE_ADMIN_URL`. Deploy order: `bootstrap-roles`, then `migrate`, then start.
- Every table gets one class through `app_apply_rls(tbl, class, owner_col, user_ops, admin_ops,
system_ops)` (`0919`): `owner_user`, `owner_org`, `public_read`, `append_only`, `system`,
  `custom`. It drops all other policies, enables and forces RLS, grants exactly the listed
  commands and comments the table `rls:<class>`. Phase 6 re-expresses this as `sys_apply_rls`.
- No default privileges: a new table has no runtime grants until a migration classifies it.
  Partitions are reached only through their parent.
- `rls_admin_transition` gives a DB-verified platform admin access to every RLS table that is not
  classified yet. `app_apply_rls` drops it table by table; the last RLS step asserts none is left.
- Request contexts carry an explicit `system: { db, repos }` handle on the worker pool. It is the
  only way a user-session flow reaches other users' rows, and every use is listed in the commit
  that adds it. Side-effect records (audit, activity, security events, webhook dispatch, admin
  alerts) are written through it in one place each.
- Real-DB suites use `wireRealDbApp` (`tests/integration/api/real-db-app.ts`), the production
  composition. Suites still on the legacy worker-only wiring are pinned in
  `real-db-app.test.ts`; the last RLS step must leave that list empty.
- Anonymization (decided, not implemented): one implementation in
  `main/server/core/src/users/pii-anonymization.ts`, format `deleted-<user id>@anonymized.invalid`
  in `email` and `canonical_email`, eligibility from the row's own `deletion_grace_period_ends`,
  legacy formats normalised by the next run. A tenant the user owns as sole member is purged with
  the user; a tenant with other members, or with another user's billing rows, blocks the purge and
  is reported.

### Carried forward from the finished stages

- WebSocket sessions are re-checked every 30 seconds, so a revoked session can stay connected for
  up to 30 seconds.
- Role guards read `users.role` through the auth liveness cache, not the token's role claim. A
  demotion made on another process reaches a guard within the cache TTL (10 seconds); the admin
  update route invalidates the entry on its own process at once.
- Unused code left in place: `main/server/realtime/src/permissions/*`,
  `main/apps/server/src/http/file-server.ts`, `main/server/storage/src/providers/presigner.ts`.
- Local signed URLs are bearer links, as S3 presigned URLs are. Ownership is not re-checked when a
  file is served.

### Running the real-DB tests

The harness needs a Postgres 17 server (the pin in `infra/versions.env`; Postgres 16 also passes)
and a superuser admin connection, because it creates the cluster roles and one isolated database
per test file. It reads `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and
`POSTGRES_DB`, or `DATABASE_URL`. Run with `REQUIRE_REAL_DB=1 pnpm test:real-db`. Keep
`--fileParallelism=false`.
