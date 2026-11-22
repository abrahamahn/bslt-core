# BSLT (bslt-main) fragmentation map

Synthesis of 8 area maps and 4 end-to-end feature traces, produced by independent read-only agents, plus spot-checks run by the synthesizer. Date: 2026-11-10. Repo: `~/projects/library/bslt/bslt-main` (Windows: `\\wsl.localhost\ubuntu-24.04\home\abe\projects\library\bslt\bslt-main`). Nothing in the repo was modified.

**How to read this file.** Sections 1-11 are the synthesis. The Appendix (A-D) reproduces every finding from every area report, verbatim in substance, with stable IDs (`WEB-01`, `CLI-04`, `CORE-03`, `SHR-05`, `DB-01`, `SRV-01`, `TOOL-03`, `TEST-04`) and every trace's per-layer file list, wiring points, add-an-endpoint walkthrough, inconsistencies (`T-BILL-I01`...), dead ends, module tree and must-remain-shared list. The synthesis cites those IDs, so design agents can go from a claim to its evidence without leaving this file.

Area codes: **WEB** = main/apps/web; **CLI** = main/client/* and the design system; **CORE** = main/server/core; **SHR** = main/shared; **DB** = main/server/db and migrations; **SRV** = server composition and runtime capabilities (apps/server, server/system, realtime, media, workers, storage, comms, server-rust, profiles); **TOOL** = tooling, editions, extensions, storefront, infra and CI; **TEST** = tests and docs. Trace codes: **T-BILL** billing, **T-AUTH** authentication and account, **T-FILES** files/storage/media, **T-NOTIF** notifications and realtime.

---

## 1. Executive summary

BSLT is a capable, unusually well-guarded TypeScript SaaS starter: about 240k non-test lines, about 250-260k test lines, deep security-hardened auth, a real provider-abstracted billing stack, real-DB integration tests, and a governance culture (route-contract coverage, prune proofs, CSS lint, colocated-test ratchet) that most codebases lack. The owner's complaint ("features are there, but fragmented, scattered, and not linked together") is accurate and has identifiable, structural causes, not just untidiness.

1. **The repo is cut horizontally by package, and nothing re-assembles a feature vertically.** One feature spans 11-14 workspace packages and 217-550 files (billing 263 files in 12 packages; auth/account 550 in 14; files/media 223 in 14; notifications/realtime 217 in 11). Adding one endpoint touches about 20 files in 5-7 packages, and endpoint paths are hand-written in 4-7 places.
2. **There is no module manifest.** Each feature registers itself in roughly 10 hand-written registries per tier (route tables, nav lists, command palette, admin surface, settings tabs, repository factory, five barrels, context field lists, edition catalog, prune manifests). These lists already disagree. The one clean plugin contract in the repo (`InstalledServerFeature`/`InstalledWebFeature`) exists only inside the exported Core edition templates (TOOL-14).
3. **There is no domain event bus or outbox.** Every side effect (audit, activity, outbound webhook, notification, realtime invalidation, admin alert) is hand-called, fire-and-forget, outside the write transaction, often behind `.catch(() => {})` (49 sites in core, verified). Only 2 of 13 advertised webhook event types are ever emitted. Billing provider webhooks write no audit, activity or webhook. Four notification emitters bypass the notification pipeline (CORE-01, CORE-02, SRV-04, T-NOTIF).
4. **Many capabilities are built next to the system instead of inside it.** Entitlements, usage metering, feature-flag checks, the permissions checker, the WriteService, the job queue (`QueueServer` never started; zero `enqueue` sites), about 95% of `@bslt/media`, the cache (domains get `{getStats}` only), realtime permission code, a signed file server, and i18n (9 locales, `t()` called in one component) all exist, are tested, and have no runtime caller. Docs mark several of them done.
5. **The data layer does not enforce what it appears to enforce.** RLS policies exist on 24 of 46 tables, but every environment connects as the `postgres` superuser and the policies target an `authenticated` role nobody is granted, so RLS is inert (DB-01). Ownership (user vs tenant) is unresolved; billing tenant scoping stopped at Phase 0 (DB-03). Repositories are bypassed by about 25 core files. TS row types have drifted from the SQL. For a creator platform that must enforce SFW/softcore separation "at the data layer", this is the foundation that has to be fixed first.
6. **Productization machinery freezes the topology.** Core/Pro editions, feature packs, the storefront, profiles, recipes, the setup wizard and `starter:prune` (about 19k non-test LOC) use ten different feature vocabularies and edit source by exact-string anchors: 239 anchored edits across 133 files, 17 hand-written Core composition templates, 27 text edits into core. Any file move breaks them. The creator fork needs none of it (TOOL-03, TOOL-04, TOOL-13).
7. **Several real defects surfaced from the fragmentation**, all confirmed by reading code (not executed): the App DI container drops `billingNotifier`, so dunning emails never fire (SRV-02, verified: zero references in `app.ts`); the realtime `write`/`getRecords` API is an unscoped proxy onto `users`, exposing `password_hash` and allowing `role` writes when realtime is enabled (SRV-01, verified); local storage "signed" URLs are permanent public URLs served without auth (SRV-14, verified); two anonymization formats mean users anonymized under the workers profile are never hard-deleted (SRV-07); the 0906 reuse-detection index is silently never created (DB-05, verified); invitations cannot be re-sent after revoke (DB-05, verified).
8. **The UI is a developer console, not a product.** An IDE-style four-pane resizable shell serves every audience; the design system carries SaaS billing components while its own shells go unused; there are three styling approaches, four token vocabularies, no icon system, a monochrome palette and WCAG 1.4.11 failures (WEB-14, WEB-15, CLI-04, CLI-05, CLI-08, CLI-19).

**What to do.** Restructure into a small domain-free platform kernel plus vertical modules, each with one manifest that the app shells, the event bus, the job system and any tooling consume. Make contracts the single source of endpoint identity and generate the SDK from them. Introduce domain events with a transactional outbox. Fix data-layer enforcement (DB roles, forced and tested RLS, one owner column, repositories as sole SQL owners, module-owned migrations). Before moving any file: extract or freeze the edition/storefront/prune machinery and server-rust, convert the 33 fragile script guards (TOOL-02), and fix the security defects. Section 9 lists the owner decisions that gate this; Section 8 the principles.

---

## 2. Method, de-duplication and resolved disagreements

**Inputs.** 8 area maps (157 findings: 42 high, 80 medium, 35 low by area severity; 17 marked intentional) and 4 feature traces (81 inconsistencies, 66 dead ends). Many findings recur across reports; Section 4 merges them into 22 ranked problems and lists every contributing ID.

**Major duplicates merged** (same underlying fact found by several agents):

| Merged fact                                                      | Reported by                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| No domain event bus / hand-wired side effects                    | CORE-01, CORE-02, SRV-04, T-BILL-I10, T-NOTIF-I08, T-AUTH cross-links |
| `billingNotifier` dropped from App.context                       | CORE-03, SRV-02, T-BILL-I11                                           |
| Realtime record API unscoped onto `users`                        | SRV-01, T-NOTIF-I15, SHR-11 (contract side)                           |
| Contracts not wiring; 3-7 hand copies of each path               | CLI-01, SHR-01, T-BILL-I04, T-AUTH-I20, T-NOTIF-I07                   |
| Domain hooks split between `@bslt/react` and `apps/web`          | WEB-18, CLI-03, T-FILES-I19, T-NOTIF-I18, T-AUTH-I15                  |
| ~10 navigation/route registries                                  | WEB-01, CLI-17, WEB-11, CORE-15, SRV-13                               |
| Path-alias sprawl                                                | WEB-08, CLI-14, SHR-09, TOOL-16, TEST-10                              |
| Edition/prune anchors freeze topology                            | WEB-19, CORE-07, SRV-13, TOOL-03, TOOL-13, DB-04, TEST-11             |
| Entitlements/metering/flags unenforced                           | CORE-04, T-BILL-I07, T-FILES cross-links                              |
| Permissions checker and middleware unused; two authz models      | CORE-05, SHR-10, SRV-09                                               |
| No working job queue                                             | SRV-03, DB-08                                                         |
| Anonymization formats diverge (GDPR bug)                         | SRV-07, CORE-14, T-AUTH-I17                                           |
| `@bslt/media` mostly unwired; three upload paths                 | SRV-08, WEB-12, T-FILES-I01..I19                                      |
| Local storage unsigned public URLs                               | SRV-14, T-FILES-I01, T-FILES-I02                                      |
| Cache built but inert                                            | SRV-11, T-AUTH cross-links                                            |
| `version` columns (0700) missing from TS types                   | DB-06, T-BILL-I12, T-FILES-I06, T-AUTH-I19, T-NOTIF dead ends         |
| 0906 index name collision                                        | DB-05, T-AUTH-I19                                                     |
| Username policy divergence                                       | SHR-05, T-AUTH-I08                                                    |
| Audit trails split (audit_events / security_events / activities) | CORE-09, T-BILL-I10, T-AUTH-I18                                       |
| server-rust and rust-access are another product                  | WEB-20, SRV-17, DB-17, TOOL (open questions)                          |
| Storefront is a parallel mini-SaaS                               | TOOL-15, CLI-10, T-FILES cross-links                                  |
| Node/Postgres version drift                                      | DB-18, TOOL-07                                                        |
| ESLint `shared-config` targets a missing path                    | SHR-17, TOOL-08                                                       |
| Docs overstate status                                            | SRV-18, TEST-16, TEST-17, CLI-18, WEB-23, T-BILL-I17                  |

**Disagreements between reports, and how they were resolved** (synthesizer ran read-only `grep`/`find` in WSL):

| Topic                                                               | Report A                                                               | Report B                   | Checked                                                    | Resolution                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Web files using the token getter                                    | WEB-04: 60 import `getAccessToken` from `@app/authToken`               | CLI-02: 63                 | `grep` non-test `main/apps/web/src`                        | Both right: 60 files import from `@app/authToken`; 63 files reference `getAccessToken` at all.                                |
| `useClientEnvironment` consumers                                    | WEB: 48                                                                | CLI: 51                    | `grep -l useClientEnvironment` non-test                    | 51 files reference it; 48 is the count of `@app/ClientEnvironment` importers. Use 51.                                         |
| Web test files                                                      | WEB-24: 205                                                            | TEST inventory: 206        | `find main/apps/web/src -name '*.test.ts*'`                | 205 under `src/`; the 206th is `main/apps/web/tests/rust-access.e2e.spec.ts`.                                                 |
| Inline query-key literals                                           | WEB-04: 18                                                             | CLI-02: 28                 | `grep "queryKey: \['"`                                     | 17 with the narrow pattern; the 28 count includes keys passed positionally. Treat as 17-28, the qualitative point holds.      |
| server/core colocated tests                                         | CORE-17: 68                                                            | TEST inventory: 73         | `find main/server/core/src -name '*.test.ts'`              | 73.                                                                                                                           |
| Swallowed `.catch(() => {})` in core                                | CORE-01: "~50"                                                         | -                          | exact-pattern `grep` non-test                              | 49.                                                                                                                           |
| `billingNotifier` reaches handlers                                  | CORE-03, SRV-02 say no                                                 | (no dissent)               | `grep billingNotifier main/apps/server/src/bootstrap/*.ts` | Only the two type declarations in `context.ts:67,146`; zero references in `app.ts`. Confirmed (runtime not executed).         |
| `ws` available at runtime                                           | SRV-05: dev-only                                                       | -                          | `main/server/realtime/package.json`                        | `ws` is a devDependency (8.22.1) and an optional peer only; not a dependency. Confirmed.                                      |
| Realtime table map / protected fields                               | SRV-01                                                                 | -                          | `service.ts:35-37`, `realtime.ts:178-185`                  | `tableNameMap = { users }`; PROTECTED_FIELDS = id, version, created_at, updated_at, password_hash, passwordHash. Confirmed.   |
| Local `getSignedUrl`                                                | SRV-14, T-FILES-I01                                                    | -                          | `local.ts:114-121`                                         | Returns `${publicBaseUrl}/${key}` or `file://`. Confirmed.                                                                    |
| Postgres pubsub default channel                                     | T-NOTIF-I13: shared mirror says `'pubsub'`, server says `'app_events'` | -                          | `postgres-pubsub.ts:47`                                    | Server default is `'app_events'`; the shared mirror's default was not verified.                                               |
| Counts: migrations, workflows, root scripts, tsconfigs with `paths` | DB: 37; TOOL: 19, 156, 27                                              | docs claim 13/15 workflows | `ls`/`node`/`grep`                                         | 37, 19, 156, 27. Docs are stale.                                                                                              |
| 0906 index, invitation unique                                       | DB-05                                                                  | -                          | `grep` migrations                                          | Confirmed: same index name in 0000:179 and 0906:16 (IF NOT EXISTS no-op); `UNIQUE (tenant_id, email)` non-partial at 0100:77. |
| Storage capability on or off                                        | SRV-15, T-FILES-I17: excluded from starter profile                     | docs/DIRECTION.md: ON      | (reports agree with each other)                            | Effectively always on: `@bslt/storage` is always constructed and never gated; the profile flag is meaningless.                |

Not resolved (need a runtime check the read-only constraint forbids): whether `size_bytes` really returns as a string from postgres.js (T-FILES-I06, plausible); whether the Docker image with realtime fails on `import 'ws'` (SRV-05); whether turbo invalidates `@bslt/tests` on core source changes (TEST-09); whether the GCP Terraform path makes four FORCE-RLS tables default-deny (DB-01); whether CI is currently green (TEST-17: TODO.md says failing for 100+ runs, CLAUDE.md says 16/16).

---

## 3. Root causes of the "not one ecosystem" feeling

Each root cause is a structural property; the problems in Section 4 are its symptoms.

### RC1. Horizontal layering by package, with no vertical unit

The workspace is cut by technical layer: `shared` (schemas, constants, contracts, env), `server/db` (rows, repos), `server/core` (services, handlers, routes), `client/api` (clients), `client/react` (hooks), `client/ui` (components), `apps/web` (pages, nav), plus editions/tools. A domain therefore has no home; it exists as 7-14 slices that only humans keep aligned.

- Billing: 263 files, 12 packages, 40 wiring points; adding one provider-backed endpoint is 22+ files in 7 packages (T-BILL add-endpoint steps).
- Auth/account: 550 files, 14 packages, split over 3 server modules plus compliance/consent; `users/me/*` is owned by 5 modules (T-AUTH-I01, CORE-06).
- Shared is organised by layer: webhooks alone touches 23 shared files across constants, ids, env, admin schemas, contracts and 5 barrels (SHR-02).
- The prune manifests are literally a map of this: activities 66 anchored edits across 10 areas; webhooks 60 across 12; realtime 28 across 17 (TOOL-03).

### RC2. No module manifest or composition model; registration is hand-written lists

Every tier has its own registries, written by hand, never derived from one another: web route table, left menu + hint map, command palette, dashboard tiles, admin surface, starter surface, settings tabs (4 copies), notification-route map, site map, persistence denylist (WEB-01, WEB-11); server `route-modules.ts` (18 modules) + app `route-modules.ts` + `router.ts` special cases + raw billing webhooks + edition template copies (SRV-13, CORE-08); the repository factory + 4 db barrels + REQUIRED_TABLES (DB-12); `InfraContext`/`IServiceContainer`/App getters/App.context (four copies of the service list; SRV-02); shared barrels (50 index files, 3,989 LOC; SHR-13). Drift is already visible: Tasks missing from the palette, Billing missing from the menu, Organization reachable from nothing, `billingNotifier` missing from App.context, `REQUIRED_TABLES` missing 5 live tables. The best module contract in the repo exists only in Core edition templates (TOOL-14).

### RC3. Productization machinery that edits source text

Editions, profiles, recipes, the setup wizard, prune and feature packs each define features differently (10 vocabularies; TOOL-04) and integrate by exact-string anchors and template overrides (TOOL-03, TOOL-13, CORE-07, WEB-19, DB-04). Because removing a feature requires editing every caller's text, the code is forced to stay where the anchors expect it, and "entangled" features (billing, tenants, advanced-auth, notifications) are declared unprunable rather than decoupled. This is deliberate and documented, and it is the single biggest brake on restructuring.

### RC4. No domain events; side effects are imperative and best-effort

Without a bus, a business fact produces whichever side effects its author remembered, outside the transaction, silently swallowed on failure (CORE-01, SRV-04). Consequences: billing state changes are invisible to audit/activity/webhooks (CORE-02); 11 of 13 webhook event types never fire; notifications from billing/admin/invitations skip preferences, realtime and push (T-NOTIF-I08, CORE-10); action names diverge for the same event (CORE-09); WriteService and the realtime bus have no producers beyond notifications (SRV-04, T-NOTIF dead ends).

### RC5. Contracts are documentation, not wiring

214 schema-bearing endpoint contracts exist in `shared`, but only audit and docs tooling read `apiRouter`. Server routes, 19 hand-written client factories and the untyped "generated" client each restate method and path (CLI-01, SHR-01). Consequences: 15 client-factory names and 66 construction sites (WEB-04), 4+ copies of CSRF/auth transport (CLI-16), uneven response validation, a private billing client that skips tenant headers and refresh (T-BILL-I03), drift held at zero only by audits.

### RC6. Gating is spread over unrelated mechanisms that hide wiring

Build-time `VITE_ENABLE_*` flags (9), generated runtime profiles (8 capabilities, 4 of which change behaviour), DB feature flags (read only by an admin page), edition source selection, AUTH_STRATEGIES env vs `VITE_ENABLE_ADVANCED_AUTH`, admin tiers, and unused plan entitlements (WEB-03, CORE-04, SRV-15, T-BILL-I13, T-AUTH-I13). Optional capabilities load by bare-specifier dynamic import and do not resolve from the dev checkout (SRV-05). Because so much is conditionally absent, the wiring cannot be read from code and nothing guarantees web and server agree.

### RC7. "Exists" is treated as "done": unwired infrastructure accumulates

Entitlements, metering, permissions checker (648 LOC + 510 LOC middleware), WriteService, job queue, media pipeline (~4.1k of 5.3k LOC unreachable), cache, realtime permissions (913 LOC), signed file server, ~1.4k LOC of unregistered middleware, 899 of 1,986 unused shared symbols, i18n locales (CORE-04, CORE-05, SRV-03, SRV-08, SRV-09, SRV-11, SHR-04, WEB-07). Colocated tests keep them looking maintained (SRV-16) and docs mark them ✅ (SRV-18, TEST-17). Each unwired piece is a feature that is "there" but not "linked".

### RC8. Data ownership is undefined

No single rule says who owns a row (user, tenant or both nullable; DB-03), which package owns a table's SQL (repositories bypassed by ~25 core files; DB-07, CORE-13), or which migration owns a table (cross-module ALTERs in 0700/0900/0901/0902; DB-04). Each table exists in four hand-maintained representations (DDL, TS row type, column map, shared domain type; DB-06, SHR-12). RLS is written but not enforced (DB-01). The consequence for the owner is that the database cannot be the place where creator-platform rules live until this is fixed.

### RC9. Hand-synchronised duplication instead of generation

Alias tables in 5+ places (~410 tsconfig path entries in 27 files; TOOL-16), barrels, context field lists, settings section lists, constants copies (SHR-08), mock factories (30 `createMockLogger`; TEST-06), test path registries (TEST-11), per-file path headers. The repo compensates with audits that detect drift after the fact. Generation would remove the drift class instead.

---

## 4. Ranked problems

Scoring: impact on (a) everyday development speed, (b) building the creator platform on top, (c) reuse for future TypeScript platforms, each High/Med/Low. Rank is by combined impact, with security and data-integrity defects weighted up because they block (b).

| #   | Problem                                                                                    | Sev    | (a) dev | (b) creator | (c) reuse |
| --- | ------------------------------------------------------------------------------------------ | ------ | ------- | ----------- | --------- |
| 1   | Data-layer and access enforcement is absent or bypassable                                  | high   | Low     | High        | High      |
| 2   | No vertical module unit or manifest; ~10 registries per tier                               | high   | High    | High        | High      |
| 3   | No domain events / outbox; side effects hand-wired                                         | high   | Med     | High        | High      |
| 4   | Edition/prune/anchor machinery freezes topology                                            | high   | High    | Med         | Med       |
| 5   | Contracts are not the source of truth; client layer fragmented                             | high   | High    | High        | High      |
| 6   | Gating fragmented; entitlements and flags never enforced server-side                       | high   | Med     | High        | Med       |
| 7   | Built-but-unwired infrastructure (jobs, media, cache, WriteService, permissions)           | high   | Med     | High        | Med       |
| 8   | Data ownership, schema drift and migration structure                                       | high   | Med     | High        | High      |
| 9   | Composition root is hand-mirrored and capability loading is fragile                        | high   | Med     | High        | Med       |
| 10  | Shared package is a dumping ground with a ~45% dead surface                                | high   | High    | Med         | High      |
| 11  | Confirmed defects born of duplication (GDPR, username, sessions, phone, invites)           | high   | Low     | High        | Med       |
| 12  | Web app data and context plumbing (4 fetch patterns, tenant context, persistence denylist) | high   | High    | High        | Med       |
| 13  | UI shell, design system and visual language unfit for a consumer product                   | medium | Med     | High        | Med       |
| 14  | Audit and notification trails split; pipelines bypassed                                    | medium | Low     | High        | Med       |
| 15  | Files, uploads and media split into three paths                                            | medium | Med     | High        | Med       |
| 16  | Test topology mirrors and amplifies fragmentation                                          | medium | High    | Med         | Med       |
| 17  | Config, alias and module-resolution sprawl                                                 | medium | High    | Low         | High      |
| 18  | Tooling, scripts, CI and hosting sprawl; fragile script guards                             | medium | High    | Low         | Med       |
| 19  | Module-internal inconsistency (layouts, context types, error styles, cycles)               | medium | High    | Med         | Med       |
| 20  | Docs and agent instructions drift from code                                                | medium | Med     | Low         | Med       |
| 21  | Vocabulary collisions (tenant/workspace/org, core, webhooks, notifications, content)       | low    | Med     | Med         | Med       |
| 22  | Off-scope products carried in the repo (server-rust, rust-access, storefront)              | low    | Low     | Low         | Med       |

### P1. Data-layer and access enforcement is absent or bypassable (high)

- RLS is inert: superuser connections everywhere, policies `TO authenticated`, nothing grants or SETs the role, FORCE only on 4 tables (DB-01). Policies that exist are inconsistent and partly unsafe: raw `::uuid` casts, any user can insert their own membership into any tenant, viewers can update tenant rows, null-tenant activities visible to all (DB-02). 22 tables have no RLS.
- Realtime `write`/`getRecords` reads full `users` rows including `password_hash` and writes `role` on any row when realtime is on; the 913-LOC permission engine is never called (SRV-01; verified).
- Local storage "signed" URLs are permanent and public; `/uploads/*` is served with no auth and `Cache-Control: public`; the HMAC file server is unregistered; three incompatible signing implementations (SRV-14, T-FILES-I01, T-FILES-I02; verified).
- WebSocket auth checks only the JWT signature, so banned or revoked users keep receiving frames (T-NOTIF cross-links); logout-all via `users/me/sessions` does not bump tokenVersion (T-AUTH-I06).
- Server-side entitlements are never checked (CORE-04) and authorization exists in three models (route roles + tenant bitmask + RLS in practice; unused `core/permissions`; unused `realtime/permissions`; dead `can()`) (CORE-05, SHR-10).
- API keys inherit full user role, need no sudo, are unaudited and unscoped (T-AUTH-I18).
- Why it matters: SFW/softcore separation, paywalls, age gates and payouts all assume enforcement below the handler. None exists today.
- Direction: owner/app/worker DB roles; FORCE RLS everywhere with a generated policy template per scope class and a per-table denial test; delete or lock down realtime record API; signed expiring URLs for all providers; liveness check on sockets; one authz model; scoped, audited API keys.

### P2. No vertical module unit or manifest (high)

- Evidence: WEB-01, WEB-09, WEB-10, WEB-11, CLI-17, CORE-11, CORE-15, SRV-13, DB-12, SHR-02, SHR-13, TOOL-14, and every trace's add-endpoint list (about 20 files per endpoint).
- Why: this is the owner's complaint in mechanical form. Every new creator feature (subscriptions, PPV, tips, payouts, moderation, age verification) would need about 10 hand edits per tier.
- Direction: `defineModule({ id, contract, migrations, repositories, routes, webhooks, subscribers, jobs, services, web: { routes, nav, settingsSections, adminSurfaces, dashboardTiles, notificationRoutes, persistence, i18n } })` and generate the registries from the installed-module list. Promote the Core `InstalledServerFeature` shape as the seed.

### P3. No domain events or outbox (high)

- Evidence: CORE-01, CORE-02, CORE-09, CORE-10, SRV-04, T-BILL cross-links (audit, activities, webhooks, realtime not linked), T-AUTH cross-links (user.* webhooks never emitted, sockets survive revocation), T-NOTIF-I08.
- Why: money movement (tips, PPV, payouts) cannot be fire-and-forget; live UI needs reliable realtime fan-out.
- Direction: typed event catalog in the contract layer; outbox table written in the business transaction; dispatcher as a queue job; audit/activity/notifications/webhooks/realtime/analytics as subscribers registered by their own modules. Delete WriteService or make its afterWrite hook the outbox writer.

### P4. Edition/prune/anchor machinery freezes topology (high, deliberate)

- Evidence: TOOL-03 (239 anchors / 133 files), TOOL-04 (10 vocabularies, ~19k LOC), TOOL-13 (17 Core templates), CORE-07 (27 core text edits), WEB-19, SRV-13, DB-04 (prune breaks migration chain), TEST-11, TOOL-02 (moving a script can silently disable its gate).
- Why: every move in the restructure would otherwise break `ci:merge-gate`; the fork does not need any of it.
- Direction: decide first (D1). Either extract/freeze it out of bslt-main before moving files, or re-implement editions as module allow-lists over the manifest. Convert the 33 substring main-module guards before moving any tool.

### P5. Contracts are not the source of truth; client layer fragmented (high)

- Evidence: CLI-01, CLI-02, CLI-16, SHR-01, SHR-06, WEB-04, WEB-17, T-BILL-I03, T-BILL-I04, T-AUTH-I14, T-NOTIF-I06, T-NOTIF-I07, T-FILES-I11.
- Direction: generate a typed SDK from `apiRouter` routed through one request factory (CSRF, auth, tenant/creator context, refresh, ToS interception); one `sdk` in ClientEnvironment; generated per-domain query-key factories; server route registration derived from the same contract entries; one envelope and one error-code registry; wire `api:check` into the merge gate.

### P6. Gating fragmented; entitlements unenforced (high)

- Evidence: WEB-03, CORE-04, SRV-15, T-BILL-I13, T-AUTH-I13, T-FILES-I17, TOOL-04.
- Direction: a module is installed or absent (static registry); runtime behaviour gated by one server-provided capability context (installed modules, evaluated flags, viewer eligibility such as age-verified/creator status, entitlements) consumed by route guards and the SPA; one EntitlementService with a `requireEntitlement` preHandler and service-level assert.

### P7. Built-but-unwired infrastructure (high)

- Evidence: SRV-03 (no job queue; 3 job tables; 13 per-replica `setInterval` tasks), SRV-08 (media ~95% unwired), SRV-09 (~1.4k LOC unregistered middleware), SRV-11 (cache), CORE-05, DB-08, CLI-13, WEB-07, WEB-13, T-*-dead ends.
- Direction: "wired or deleted". Keep `job_queue` + `PostgresQueueStore` + `QueueServer`, start a consumer, move interval tasks onto the leader-elected cron, let modules declare jobs. Rebuild media processing as queue jobs on `file.uploaded`. Delete or adopt each unwired piece with a recorded decision; add an unused-export gate.

### P8. Data ownership, schema drift and migration structure (high)

- Evidence: DB-03, DB-04, DB-05, DB-06, DB-07, DB-09, DB-10, DB-11, DB-12, DB-14, CORE-13, SHR-12, T-BILL-I01 (SQL vs TS enum drift), T-BILL-I06, T-BILL-I12, T-FILES-I06, T-NOTIF-I01 (enum named `notification_type` holds levels).
- Direction: see Section 6.

### P9. Composition root hand-mirrored; capability loading fragile (high)

- Evidence: SRV-02 (billingNotifier, `ctx.billing` never set, provider constructed per request in 11 sites), SRV-05 (bare dynamic imports, Dockerfile copies, `ws` not a dependency), SRV-06 (workers phase owns WebSocket), SRV-10 (config split; adapters read `process.env`), TEST-03 (tests re-implement the composition root).
- Direction: one frozen AppContext built once, exhaustiveness check; capability modules with start/stop/health; static imports generated from the installed-module list; a `buildApp()` factory used by `main.ts` and tests; a composition-root smoke test per profile.

### P10. Shared is a dumping ground with a large dead surface (high)

- Evidence: SHR-03 (~30% server-only runtime, client-only display code, Node types), SHR-04 (899/1,986 symbols unused), SHR-06, SHR-07, SHR-08, SHR-09, SHR-13, SHR-14, SHR-15, SHR-16.
- Direction: an isomorphic contract kernel compiled without Node types; move server runtime pieces to server packages and presentation helpers to the client; vertical slices per domain; delete dead subsystems; flatten the export map to folder-per-subpath.

### P11. Confirmed defects born of duplication (high)

- GDPR: anonymization in 3+ implementations, 2 formats; workers-profile users are never hard-deleted and keep `canonical_email`/`username` (SRV-07, T-AUTH-I17).
- Username: admin 1-15 alnum vs self-service 2-30 letter-first; registration only min 2 (SHR-05, T-AUTH-I08).
- Phone: profile update writes `users.phone` without resetting `phone_verified`, yet SMS 2FA sends to it (T-AUTH-I09, security-relevant).
- Sessions modelled 3 times; three sign-out-everywhere endpoints with different guarantees; only password login runs the full post-login pipeline (T-AUTH-I05, I06, I07).
- Invitations: non-partial unique blocks re-invites; 0906 index never created; events partitions never maintained (DB-05).
- Billing: PayPal not a true peer; usage metering cannot produce data; plan catalog in 3 copies (T-BILL-I02, I05, I07).
- Avatars: auth responses null out storage-key avatars (T-AUTH-I11, T-FILES-I12).
- Direction: one implementation per rule in the owning module; regression tests before the restructure moves the code.

### P12. Web app data and context plumbing (high)

- Evidence: WEB-04, WEB-05 (active org only reaches the workspace client), WEB-06 (persistence denylist writes new data to IndexedDB for 24h by default), WEB-16, WEB-17 (localStorage token fallback undermines memory-only design), WEB-18, WEB-25.
- Direction: platform layer exposing `api`, auth, capability context and an "acting-as" context (viewer vs creator X) injected into every client and query key; allowlist persistence declared per query-key factory.

### P13. UI shell, design system and visual language (medium) - see Section 7.

### P14. Audit and notification trails split; pipelines bypassed (medium)

- Evidence: CORE-09 (audit_events / security_events / activities; double-logged actions under different names; unaudited API keys, webhooks, feature flags, billing webhooks), CORE-10, T-NOTIF-I01..I21.
- Direction: one action catalog (noun.verb) with category/severity; audit and activity as projections of events; one `notify()` pipeline with a NotificationKind registry (category, level, channels, route, i18n keys) that every emitter uses.

### P15. Files, uploads and media split into three paths (medium)

- Evidence: WEB-12, SRV-08, SRV-14, T-FILES-I01..I19 (7 storage-port interfaces, 4+ record shapes, 10 size limits, 3 client upload patterns, blob orphaning, tenant scoping unreachable, `/api/media` has no contract).
- Direction: one `assets` module (T-FILES module tree): one record with `content_rating` NOT NULL, `visibility`, `moderation_status`, `parent_asset_id`; presigned upload intents; signed access for all providers; processing as jobs.

### P16. Test topology mirrors and amplifies fragmentation (medium)

- Evidence: TEST-01 (11.3k LOC single-package tests in central `tests/`), TEST-02 (mock "integration" tier), TEST-03, TEST-04 (raw SQL seeds in e2e, `db:push` vs migrations), TEST-05, TEST-06, TEST-07, TEST-09, TEST-10, CORE-17 (tests deep-import internals), SRV-16.
- Direction: tests live with their module; `tests/` holds only cross-module HTTP, real-DB and e2e; a `describeRealDb` helper; one repository-based seed module; typed testing subpaths for fakes; tests target module public entrypoints.

### P17. Config, alias and module-resolution sprawl (medium)

- Evidence: TOOL-16, SHR-09, WEB-08, CLI-14, TEST-10, TOOL-05 (package builds reach into unpackaged `main/tools` by relative path; turbo cannot see it).
- Direction: package.json `exports` with a `source` condition as the only alias source; `customConditions`; a `@bslt/build-config` workspace package; `main/tools` as a real package.

### P18. Tooling, scripts, CI and hosting sprawl (medium)

- Evidence: TOOL-01 (156 scripts, ~25 unused; local pre-push excludes `@bslt/core`), TOOL-02, TOOL-06 (19 workflows, 6 hosting paths, Woodpecker mirror), TOOL-07, TOOL-08, TOOL-09, TOOL-10, TOOL-11, TOOL-12, TEST-12.
- Direction: a typed gate registry (`pnpm gate merge`); ~35-40 scripts; one CI workflow with reusable jobs; one deploy path; one `.node-version` and one Postgres pin.

### P19. Module-internal inconsistency (medium)

- Evidence: CORE-06 (auth<->users<->api-keys cycle), CORE-11, CORE-12, CORE-16, T-AUTH-I03, T-BILL-I08, T-BILL-I16, WEB-10.
- Direction: one canonical module shape enforced by audit; `defineHandler` with one result and error convention; a boundaries element per module with an allow-listed DAG.

### P20. Docs and agent instructions drift (medium)

- Evidence: TEST-16..TEST-23, SRV-18, CLI-18, WEB-23, SHR-17, T-BILL-I17, T-AUTH-I22; `.claude/` agent specs are untracked and target nonexistent paths (TEST-22).
- Direction: DIRECTION.md as the only status doc, with status generated from module manifests; READMEs generated from exports; backtick-path checking in docs-links; a versioned root agent guide.

### P21. Vocabulary collisions (low)

- Evidence: CORE-18, TOOL-18, DB-13, SHR-16, WEB-21 (`content` means legal pages), T-NOTIF (`notifications` means two things).
- Direction: one term per concept chosen before the fork rename (D13).

### P22. Off-scope products carried in the repo (low)

- Evidence: SRV-17, DB-17, WEB-20, TOOL-15, CLI-10.
- Direction: move server-rust + rust-access to their own repo; extract or rebuild the storefront (D1, D2).

---

## 5. Per-feature fragmentation

| Feature                                                                                                      | Packages touched                       | Files                               | Wiring points | Source          | Notes                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------- | ------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing (plans, subscriptions, payment methods, invoices, provider webhooks, metering, dunning, admin plans) | 12                                     | 263                                 | 40            | T-BILL          | 22+ files / 7 packages per endpoint; special-cased in 5 registries; third billing UI in the extension; entitlements and metering have no callers; billingNotifier never reaches handlers. |
| Authentication and account (auth, users, api-keys, sessions, MFA, passkeys, OAuth, profile, lifecycle)       | 14                                     | 550                                 | 27            | T-AUTH          | 3 server modules + compliance/consent; `users/me/*` owned by 5 modules; 5 client-access patterns; 17 core files raw SQL; anonymization GDPR bug.                                          |
| Files, uploads, storage and media                                                                            | 14                                     | 223                                 | 28            | T-FILES         | Three upload paths; local URLs unsigned; ~4.1k LOC media unreachable; `/api/media` outside contract governance; blobs orphaned on deletion.                                               |
| Notifications and realtime                                                                                   | 11                                     | 217                                 | 30            | T-NOTIF         | One path runs end to end; 4 emitters bypass it; email/SMS channels declared but absent; record-sync API is a security hole; bus split across shared/db/realtime/web.                      |
| Activities (from prune manifest)                                                                             | 10 areas                               | 66 anchored edits                   | 66            | TOOL-03         | Edit count, not file count; stripped from Core by text surgery though Core auth/users call it.                                                                                            |
| Outbound webhooks (from prune manifest)                                                                      | 12 areas                               | 60 anchored edits (23 shared files) | 60            | TOOL-03, SHR-02 | Only member.added/removed emitted out of 13 types.                                                                                                                                        |
| Realtime capability (from prune manifest)                                                                    | 17 areas                               | 28 anchored edits                   | 28            | TOOL-03         | Touches eslint.config.ts, root tsconfig and package.json.                                                                                                                                 |
| Organization / tenant context (web)                                                                          | 4+ (web, client/api, core/tenants, db) | not traced                          | n/a           | WEB-05, DB-03   | Active org reaches only the workspace client; `/organization` linked from nowhere; tenant creation implemented twice.                                                                     |

Pattern across the four traces: 11-14 packages, 217-550 files, 27-40 wiring points, 18-22 inconsistencies and 12-20 dead ends per feature; roughly 85% of inconsistencies were classified accidental.

---

## 6. Database: state, issues, recommendations

**State.** 37 SQL migrations (verified) create 46 live public tables plus the runner's `migrations` table, 16 enums, 24 JSONB columns, no GIN indexes. `@bslt/db` is 19.0k non-test LOC: a parameterised SQL builder (2.2k), 40 functional repositories (7.6k), hand-written row types and column maps (3.4k), plus a job-queue engine, WriteService, LISTEN/NOTIFY pubsub, SQL search and a schema-per-tenant toolkit. Numbering started as domain hundreds-blocks and decayed into 17 cross-domain chronological patches (0901-0917), including revert pairs; the history was already squashed once (2026-02-19). Sessions set `app.user_id/tenant_id/role` with SET LOCAL per query.

**Issues** (IDs in Appendix A):

1. RLS inert: superuser connections, policies `TO authenticated`, no grants (DB-01). If enforced, several policies are unsafe or leak (DB-02). 22 tables lack RLS, including `users`, `invitations`, `webhooks`, `usage_snapshots`.
2. Ownership unresolved: user-owned, tenant-owned and mixed tables with nullable owners; billing tenant scope frozen at Phase 0; `tenantId = user.userId` fallback in metering (DB-03, T-BILL-I06, T-BILL-I07).
3. Migrations organised by concern: 0700/0900/0901/0902 alter other modules' tables, so pruning a module breaks a fresh migrate (DB-04).
4. Latent bugs: 0906 index never created; invitation unique is not partial; `events` partitions never maintained; phantom `reminder_sent_at` column (DB-05).
5. Four representations per table, drifted: `version` missing from 21 column maps; SQL vs TS enum drift for billing (`payment_method_type`, `plan_interval`, `invoice_status`); `notification_type` enum holds levels (DB-06, T-BILL-I01, T-NOTIF-I01).
6. Repositories bypassed by ~25 core files; some repositories have zero callers; some tables have no repository (DB-07, CORE-13, T-AUTH-I04).
7. Dead tables: `jobs`, `tenant_settings`, `billing_tenant_backfill_audit`; unused `version` columns; TODO.md stale (DB-08).
8. Runner: no checksums, no advisory lock, no per-file no-transaction, three entry points; the Rust runner already does this correctly (DB-09).
9. `users` god table mixing credentials, profile, lockout, lifecycle, attestation; self-reported DOB contradicts 0916 (DB-10).
10. Financial rows cascade-delete with users; integer cents, free-text currency, no ledger (DB-11).
11. Package mixes persistence with runtime engines; adding a table touches ~9 files; all 40 repositories rebuilt per request (DB-12).
12. Naming (event/severity/version overloading, owner column names, folder names) (DB-13); redundant indexes and missing provider-id uniques (DB-14); 5 round trips per scoped query (DB-15); PG 16 vs 17 (DB-18).
13. Tests seed via raw SQL in e2e and CI e2e uses `db:push` while real-DB uses migrations (TEST-04).

**Recommendations.**

1. **Roles and enforcement first:** `bslt_owner` (migrations, owns objects), `bslt_app` (runtime, NOBYPASSRLS, DML only), `bslt_worker` (system jobs). Split `DATABASE_URL`/`MIGRATION_DATABASE_URL`. FORCE RLS on every user/org-owned table; generate policies from one template per scope class (`rls_user`, `rls_org`, `public_read`, `system`) using NULLIF-safe helpers (the 0901 pattern); set session vars with one bound `set_config` call per request transaction. A real-DB suite connecting as `bslt_app` proves cross-user and cross-org denial for every table; `db:audit` fails on an unclassified table.
2. **One owner per row:** `owner_user_id` or `org_id`, never both nullable. Recommended creator mapping: creator = org (reuse memberships and role bitmasks); fan-side records owned by user. Finish or revert 0902.
3. **Module-owned migrations in Postgres schemas:** `meta`, `identity`, `profile`, `org`, `billing`, `comms`, `ops`, `analytics`, then creator domains `content`, `live`, `commerce`, `ledger`, `payouts`, `moderation`, `compliance`. Each module's migrations touch only its own tables; RLS, triggers and versioning ship with the table. Use `TableSpec {schema,name}` (the builder supports it).
4. **Consolidate history** into a reviewed baseline (from a fully migrated `pg_dump --schema-only`, hand-cleaned: drop dead tables and redundant indexes, fix the invitation partial unique, 0906 index and provider uniques), shipped as one file per module. Bridge existing databases with a one-time migration if any data must survive (owner decision D4).
5. **Runner parity with Rust:** checksums, advisory lock, strict ordering, `-- migrate:no-transaction`; one entry point; seeds (legal templates) as idempotent required seeds.
6. **Codegen:** `db:codegen` from the catalog for row types, column maps, table specs and enum unions; derive REQUIRED_TABLES; fail CI on diff.
7. **Repositories own all SQL;** stop exporting table constants publicly; lint-ban the builder outside db/modules; unit-of-work `ctx.transaction(repos => ...)`.
8. **Split `users`** into identity, credentials, lockout and profile; verified age only in `compliance.age_verifications` (outcome + reference, no raw ID or DOB).
9. **Money:** financial FKs `ON DELETE RESTRICT`; append-only double-entry ledger (assets with decimals/chain, accounts, journal entries with idempotency keys, postings in NUMERIC minor units, deferrable balance check); billing becomes a provider mirror and inbox.
10. **Content rating at the data layer:** `content_rating NOT NULL CHECK IN ('sfw','softcore')`, rating changes only through a moderation decision (trigger), and an RLS SELECT policy requiring age verification and `app.surface <> 'sfw'` for softcore rows. This is only meaningful after step 1.
11. **One queue, one append-only audit stream**, partition maintenance as a cron job, one Postgres major pinned (17 or 18).

---

## 7. UI: state, issues, recommendations

**State.** `apps/web` is a Vite + React 19 SPA with build-time prerendering (48.2k non-test LOC, 205 colocated test files) on a zero-dependency client stack (custom router, query cache, schema). `@bslt/ui` has 89 component files (29 elements, 45 components, 15 layouts), ~92 generated `--ui-*` tokens and a hand-written 222-class utility layer. Foundations are good: services built before render, one testable route table reused by the prerenderer, `lazyPage` with stale-chunk recovery, a type-gated site map, cross-user cache resets, global a11y primitives, a token pipeline with lint gates at zero debt.

**Issues.**

1. Shell: one IDE-style four-pane resizable layout for landing, product, settings, admin and dev tools; viewport-percentage top bar; admin nav in the right pane; JWT decoded client-side for display (WEB-15). The DS ships an unused `AppShell` and four sidebar/topbar layouts whose CSS prefixes collide with the hand-built web shell (CLI-05).
2. Navigation and wiring: ~10 registries; unreachable pages (`/organization`, `/settings/accounts`, `/forbidden`); palette shown to signed-out users; settings split between a modal and pages; dashboard is not a hub (WEB-01, WEB-02, WEB-11, WEB-22).
3. Design system boundaries: half the DS is SaaS domain (10 billing components, ~43% of `components.css`; session/device/profile cards; status badges importing `@bslt/shared/core/*`; `ProtectedRoute`); re-export shims; a third billing UI in the extension (CLI-04). Two modal systems, three toast pieces, several loading/error wrappers (CLI-06). Unused DS pieces (CLI-13), two hierarchy violations (CLI-20), catalog key collision and ~60% coverage (CLI-15).
4. Styling: three approaches (24 CSS files/3,551 lines, 129 inline style objects, 565 utility usages); page BEM sheets overriding DS internals in 14 places; mixed size vocabularies; 13 raw z-index values and no z/elevation tokens; `forwardRef` in 53 files despite React 19 (WEB-14, CLI-09).
5. Theming split across ui, react and engine; `app-theme-mode` key in 3 places vs ThemeProvider default `theme-mode`; high-contrast palette outside the token source (CLI-07). Four token vocabularies; extensions use nonexistent `--ui-space-*` (CLI-10).
6. Visual language: primary = accent = near-black/near-white; no brand hue, no icon system (13 inline SVGs, text glyphs as rail icons), no display type scale, no live/premium/locked/rating tokens, no charts (CLI-19, WEB-14).
7. Accessibility: `--ui-color-border` fails WCAG 1.4.11 in both modes and is used on `.radio-circle`; reduced-motion honoured in one place; axe gate fails only on `critical`; no `jsx-a11y`; unguarded dark media queries (CLI-08).
8. i18n: 9 locales, ~57 keys each, `t()` in one component; all shell, auth, settings and notification copy hard-coded English; docs claim "fully translated" (WEB-07, T-NOTIF-I21, T-AUTH-I22).
9. Data/state: 4 fetch patterns, 15 client-factory names, tenant context not propagated, persistence denylist (WEB-04..WEB-06); three hand-rolled stores and mixed storage-key prefixes (WEB-25).
10. Layering: two-way coupling between `app/` and `features/` with no boundary rules; 4 conflicting alias tables; inconsistent feature folder shapes (WEB-08..WEB-10).

**Recommendations.**

1. **Named shells from the manifest:** public/marketing, viewer app (feed, creator profile, live player), creator studio, admin/moderation console, auth. Resizable panes only in the console. Fixed-height top bar, responsive left nav, mobile bottom nav (`BottombarLayout` exists, unused).
2. **One domain-free DS** (primitives, patterns, layouts, theme) with no imports from `@bslt/shared/core/*`; domain UI moves into module `ui/` folders; one generic `StatusBadge tone`; consolidate overlays onto one Dialog core (modal, non-modal, Sheet/Drawer/BottomSheet), one toast API, one AsyncBoundary, one PageShell/PageHeader.
3. **One styling contract** (decision D15): recommended tokens + recipe/variant components + a small layout-primitive set (Stack, Inline, Grid, Cluster, AspectRatio); utilities limited to layout; no inline style objects outside the DS; stylelint ban on descendant selectors against DS classes; `cn()` mandatory; sizes `sm|md|lg` everywhere; `--ui-z-*` and `--ui-elevation-*` scales.
4. **Theme in one module:** token sources, generated CSS (invariant tokens once), derived high-contrast and density, provider and hooks, one exported `THEME_STORAGE_KEYS`; publish `tokens.css` for static sites.
5. **Creator-platform visual language:** brand accent scale with on-accent, per-creator accent override, semantic tokens for live / premium / locked / rating-sfw / rating-softcore, display type scale, media tokens (aspect ratios, overlay gradients, blur for gated content), Icon primitive with one SVG set, IconButton `icon` slot, chart primitive.
6. **Missing product components:** VirtualFeed/InfiniteList (adopt the unused `useVirtualScroll`/`useInfiniteQuery`), PostCard, CreatorCard, ProfileHeader, ContentGate/BlurredMedia, AgeGate interstitial, PaywallOverlay/UnlockButton, Price/CurrencyAmount (fiat + crypto precision), TipSheet, WalletBalance, TransactionRow, PayoutStatus, LivePlayer, ChatMessageList, ViewerCount, StatTile, moderation queue tables.
7. **Accessibility as a gate:** `--ui-color-border-control` (≥3:1) for every control; global reduced-motion via motion tokens; axe gate on `serious`; `eslint-plugin-jsx-a11y`; DS strings via props or a DS message provider.
8. **i18n decision** (D16) before building creator UI.
9. **Catalog as visual-regression surface:** story per DS export generated from barrels, CI fails on missing stories, Playwright screenshots per story in both themes.
10. **Platform layer for the SPA:** env, `api` SDK, auth, capability/eligibility context, acting-as context, realtime channel registry, layout slots; features import only the platform layer and other features' public barrels (lint-enforced).

---

## 8. Restructure principles

1. **One module, one folder, one manifest.** A domain owns its contract, migrations, repositories, services, routes, jobs, event subscribers, client SDK, hooks, UI and web contributions in one place. App shells and tooling consume manifests; nothing patches source text.
2. **Small platform kernel, many product modules.** The kernel is domain-free: DB runtime and migration runner, HTTP and route helpers, config, auth guard chain, event bus and outbox, job queue and cron, realtime bus and channel registry, storage port, DS, client runtime and SDK core. Modules depend on the kernel and talk to each other only through events and declared ports. A lint-enforced DAG covers modules, not only packages.
3. **The contract is the endpoint.** Method, path, schemas, auth level and envelope are declared once; server registration, the typed SDK, query keys, docs and route coverage derive from it.
4. **Facts happen once.** State changes publish typed domain events inside the transaction via an outbox; audit, activity, notifications, outbound webhooks, realtime, analytics, metering and search are subscribers.
5. **Enforce at the lowest layer that can enforce.** DB roles and forced RLS for ownership and rating; entitlement preHandlers for paid access; repositories as sole SQL owners; signed, expiring URLs for all blobs; channel allowlists for realtime.
6. **Installed or absent, then runtime capabilities.** Static module installation replaces build-time product flags and profiles; runtime behaviour reads one server-provided capability/entitlement/eligibility context shared by server and SPA.
7. **Wired or deleted.** No module, export, table, middleware or locale ships without a runtime caller. Status in docs is generated from manifests. An unused-export budget runs in CI.
8. **Generate instead of hand-syncing.** Barrels, alias tables, context types, registries, row types, README export tables and route tables are generated; audits remain as guards on the generators.
9. **Allowlists over denylists** for persistence, realtime channels, RLS classification, CSP and ToS exemptions.
10. **One way per concern.** One request transport, one client per domain, one store helper, one overlay core, one error-code registry, one envelope, one anonymizer, one session issuer, one notify pipeline, one queue, one audit stream.
11. **Tests live with the module; data rules are proven on a real database;** the composition root is booted in a smoke test; tests import module public entrypoints only.
12. **Sequence for safety:** (1) decide and extract out-of-scope machinery; (2) harden fragile tooling (script guards, gate registry); (3) fix security and data-integrity defects with regression tests; (4) build the kernel (context, events, jobs, SDK generation, module manifest); (5) migrate modules one at a time behind contract tests; (6) consolidate migrations; (7) redesign shells and DS; (8) rewrite docs from manifests.
13. **Preserve the guardrail culture** (route-contract coverage, real-DB gate, lint:css, test-pair ratchet, drift audits, why-comments), retargeting each audit at manifests rather than file paths.
14. **One vocabulary**, chosen before the fork rename and applied identically in SQL, shared, server, client and UI.

---

## 9. Owner decisions

| #   | Question                                                                                     | Options                                                                                                                                                                                               | Recommendation                                                                                                   | Why                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Keep Core/Pro editions, feature packs, storefront, recipes and `starter:prune` in bslt-main? | (a) keep as-is; (b) extract to a separate distribution repo and freeze; (c) delete; (d) keep but rebuild on the module manifest (edition = module allow-list)                                         | (b) before the restructure, optionally (d) later                                                                 | 239 anchors/133 files, 17 templates and 27 core text edits must otherwise move in lockstep with every file; the creator fork needs none of it; (d) is cheap once manifests exist. |
| D2  | server-rust and the rust-access web entry                                                    | keep in place; move to own repo; delete                                                                                                                                                               | Move to the Kanu repo                                                                                            | Separate product, schema and CI; shares nothing with the TS runtime; adds lint/CI/alias weight.                                                                                   |
| D3  | Topology                                                                                     | (a) vertical modules `main/modules/<domain>` each with contract/db/server/client/ui/web; (b) keep layered packages with consistent per-feature folders; (c) hybrid kernel packages + vertical modules | (c)                                                                                                              | Vertical modules fix the scatter; kernel packages keep reusable infrastructure domain-free for future TS platforms.                                                               |
| D4  | Migration strategy                                                                           | (a) squash to a reviewed per-module baseline + bridge migration for existing DBs; (b) clean reset; (c) incremental                                                                                    | (a) if any deployed DB (e.g. bslt.dev demo) must survive, else (b)                                               | History needs up to 6 files to read one table; module-owned files are a prerequisite for pruning; the bridge preserves data.                                                      |
| D5  | Postgres namespaces                                                                          | per-module schemas vs flat `public` with prefixes                                                                                                                                                     | Per-module schemas                                                                                               | Ownership becomes visible and enforceable; builder already supports `TableSpec {schema,name}`.                                                                                    |
| D6  | DB roles and RLS enforcement timing                                                          | now, before restructure; during; after                                                                                                                                                                | Now                                                                                                              | Every creator-platform rule depends on it; it changes nothing structurally and has the highest risk reduction.                                                                    |
| D7  | Contracts as runtime source                                                                  | generated SDK + derived server routes; keep hand clients + audits                                                                                                                                     | Generated                                                                                                        | Removes 3-7 hand copies per path and 4 transport copies.                                                                                                                          |
| D8  | Schema library                                                                               | keep zero-dep custom + add declarative combinators (and Standard Schema interface); adopt Valibot/Zod                                                                                                 | Keep zero-dep, add combinators                                                                                   | Preserves the deliberate stance; removes the interface-plus-parser double declaration (416 schemas).                                                                              |
| D9  | Event mechanism                                                                              | in-process bus + transactional outbox; WriteService afterWrite hooks; none                                                                                                                            | Bus + outbox (reuse WriteService as the outbox hook or delete it)                                                | Money movement and live features need guaranteed delivery.                                                                                                                        |
| D10 | Job system                                                                                   | unify on `job_queue` + QueueServer + leader cron; keep status quo                                                                                                                                     | Unify; drop `jobs`; move 13 `setInterval` tasks to cron                                                          | Today nothing can be backgrounded and tasks run on every replica.                                                                                                                 |
| D11 | Ownership/tenancy model                                                                      | pure B2C user-owned; org-owned with creator = org; both                                                                                                                                               | Creator = org, fan records owned by user, one owner column per row; finish or revert billing Phase 1 accordingly | Managers/editors/moderators reuse memberships and role bitmasks.                                                                                                                  |
| D12 | Authorization model                                                                          | route roles + tenant bitmask + RLS (+ optional record policy); core/permissions checker; both                                                                                                         | First, delete the rest                                                                                           | It is what runs; two other models are dead code.                                                                                                                                  |
| D13 | Naming                                                                                       | tenant / workspace / organization (and creator)                                                                                                                                                       | `org` in code and SQL; UI term per product; reserve `content` for creator content                                | Three terms for one concept today; rename before the fork.                                                                                                                        |
| D14 | Gating model in bslt-main                                                                    | keep profiles + VITE flags; module installed/absent + runtime capability endpoint + DB flags                                                                                                          | Latter; in the fork make realtime, media, workers, storage mandatory                                             | Web and server can disagree today; profiles gate only 4 behaviours.                                                                                                               |
| D15 | UI styling model                                                                             | plain CSS + utilities (status quo); recipe components + layout primitives + tokens (CSS modules or layered CSS); Tailwind v4; vanilla-extract                                                         | Recipe components + layout primitives + tokens, no new runtime dependency                                        | Fits the zero-dep stance and SSR/prerender; ends the three-dialect problem. If the owner prefers Tailwind v4, commit fully and drop the hand utility layer.                       |
| D16 | i18n                                                                                         | wire through module namespaces now; reduce to en-US + formatters                                                                                                                                      | Keep infra, en-US only, `t()` mandatory in new modules; add locales when funded                                  | Avoids maintaining 8 unused locale maps while not baking in literals.                                                                                                             |
| D17 | Client data stack                                                                            | keep custom router/query; adopt TanStack Router/Query                                                                                                                                                 | Keep, consolidate behind the SDK; revisit after the feed prototype                                               | Deliberate and owned; the real problem is plumbing, not the library.                                                                                                              |
| D18 | WCAG vs minimal hairline look                                                                | compliance; aesthetic                                                                                                                                                                                 | Compliance                                                                                                       | Consumer, payments and age-verification context; radio control is a real failure.                                                                                                 |
| D19 | Hosting and CI                                                                               | keep 6 paths + Woodpecker; one CI + one deploy path (DO)                                                                                                                                              | One CI, one deploy, retire Woodpecker unless live, GCP to docs                                                   | Delivery sprawl and version drift.                                                                                                                                                |
| D20 | Path headers on every file                                                                   | keep (auto-synced); drop                                                                                                                                                                              | Keep only if `sync:headers` runs as part of the move codemod; otherwise drop                                     | 2,368 files carry them; they add rewrite cost to every move.                                                                                                                      |
| D21 | Docs                                                                                         | keep all; DIRECTION.md as single status doc + generated references + archive                                                                                                                          | Latter; move `docs/legal` to app-owned content first                                                             | Docs are both stale and runtime content; the fork plans to remove docs.                                                                                                           |
| D22 | Legacy features to keep in the foundation                                                    | tasks scaffold, support inbox, status page, analytics, search, demo/dev tools                                                                                                                         | Keep tasks as the reference module and dev tools; decide others per module                                       | Keeps the reference implementation honest; avoids carrying unproven modules.                                                                                                      |

---

## 10. What must be preserved

Security and auth

- Refresh-token families with reuse detection and grace window; tokenVersion + liveness cache; hashed-at-rest secrets (auth tokens, API keys with prefix/last4, encrypted TOTP seeds and OAuth tokens); unified `auth_tokens` table; email change with revert token; sudo mode; versioned eligibility attestation with both-or-neither CHECK (reusable for age verification).
- Guard order JWT -> RLS context (membership-verified tenant header) -> ToS gate with explicit exempt list; CSRF double-submit; IP blocklist first; Redis-required rate limiting in production; geo gate after CORS; HTTPS-only URLs in production; exact port binding.
- WebSocket hardening: CSRF on upgrade, 64 KB max payload, heartbeat reaping, idempotent teardown, token via subprotocol or cookie only.
- Payload-free `{key, version}` invalidations and server-bound per-user channel authorization; LISTEN/NOTIFY cross-instance fan-out with echo suppression; poll fallback.

Payments and data

- Billing provider port (Stripe/PayPal/Mock/Disabled) with factory; idempotent webhook pipeline (one transaction, `billing_events` uniqueness, notifications dispatched after commit); raw-body capture and signature verification before parsing; refund revocation rules; plan-change and proration helpers shared by client and server; row-locked `recordUsageWithinLimit`; webhook signing with retries, replay and SSRF target policy.
- SQL migrations as schema truth; rationale comments in migrations; named CHECK constraints; TIMESTAMPTZ, UUID PKs, integer minor units; the 0901 RLS helper pattern; SKIP LOCKED queue with idempotency key; advisory-lock leader cron; partitioned analytics table; real-DB harness creating an isolated database per suite from real migrations; startup schema validation; injection-safe tenant schema naming; the Rust runner design as reference.
- Storage port with local and S3 providers (atomic writes, key normalisation, MinIO/R2/Spaces support, real presigned GETs); edition-ports idea keeping core cleanup free of paid code; storefront's entitlement-checked download route as the PPV template.

Architecture and code

- Phased bootstrap with symmetric shutdown and frozen contexts; framework-agnostic RouteMap and route registry; interface-segregated module contexts and explicit dependency parameters (no singletons); package-level boundaries via eslint-plugin-boundaries; explicit named-export barrels (no `export *`); zero-dependency client stack and schema core; typed AppError model with kind/code/status; framework-agnostic HttpRequest/HttpReply; branded-ID infrastructure; capability-scoped env schemas.
- The Core extension contract (`InstalledServerFeature`/`InstalledWebFeature` with authenticated relative routes and signed raw-body webhooks) as the seed of the module manifest.
- The `starter:feature` scaffolder and `starter:rename`/`rename-scope` as fork tools; the `tasks` reference module.

Web and UI

- Services built before render behind one ClientEnvironment; pure route table reused by the prerenderer; `lazyPage` with stale-chunk recovery; type-gated `siteMap` with a reachability test (pattern for the manifest); cross-user cache and storage resets; user-scoped storage and the IDB query persister; Stripe SDK lazy-loaded; billing routes ordered before settings tabs.
- Token pipeline from TS sources with pre-paint theme init; canonical breakpoint scale shared by CSS and hooks; compound and polymorphic component APIs with `data-tone`; accessibility primitives (FocusTrap, SkipLink, LiveRegion, RouteFocusAnnouncer, required aria-labels, `<img>` lint ban, RTL logical properties); business rules sourced from shared.
- Demo/dev tools isolated under `src/demo` with build-time elimination.

Governance and tests

- Route-contract coverage, api-response/client sync, gate-coverage, vite-build-args, csp-sync, env-examples, generated-artifacts, package-exports/esm-dist, profile-boundaries, lint:css (dead classes and undefined tokens at zero), colocated test-pair ratchet, docs-links, i18n parity (if i18n stays), anchored prune proof as a pattern; real-DB merge gate; non-blocking coverage with written rationale; capability-aware e2e; e2e mocks built through shared contracts; axe gate; dense colocated tests (~1:1 LOC in web); why-comments in configs and audits; weekly engineering log.

---

## 11. Risks

1. **Tooling breakage during moves.** Prune anchors, edition templates, test path lists and 33 substring script guards will either fail the merge gate or, worse, silently stop gating (TOOL-02). Mitigation: decide D1, convert guards and build the gate registry before moving files.
2. **Security regressions while code is in motion.** Auth, session and RLS code is subtle; moving it before regression tests exist risks losing reuse detection, liveness checks or ToS gating. Mitigation: characterise with real-DB and HTTP tests first; move auth last among core modules.
3. **Turning on RLS breaks things.** Workers, retention, admin search and backfills currently rely on superuser access; FORCE RLS on new tables may default-deny. Mitigation: `bslt_worker` role, per-table classification, staged enablement with denial and allowance tests.
4. **Data migration risk** if any deployed database must survive the baseline squash (bslt.dev demo). Mitigation: answer D4; bridge migration tested against a production snapshot.
5. **Hidden runtime behaviour.** Several facts are code-read only (billingNotifier, realtime exposure, `size_bytes` as string, `ws` missing in the image, turbo cache edges, GCP default-deny). Mitigation: a composition-root smoke test per profile and an image boot test before relying on any of them.
6. **Big-bang temptation.** 240k LOC plus 250k test LOC cannot move at once; a partial restructure leaves two patterns side by side, increasing fragmentation. Mitigation: kernel first, then one module at a time with explicit "old path deleted" criteria.
7. **Test inertia.** Tests deep-import internals (~54 integration files) and colocated tests pin dead code; moves will create noisy failures. Mitigation: public module entrypoints first; delete tests of deleted code deliberately.
8. **Over-generalising the kernel.** Designing for hypothetical future platforms can reproduce today's unwired-infrastructure problem. Mitigation: principle 7 ("wired or deleted") applies to the kernel too.
9. **Losing documented intent.** Deliberate choices (zero deps, lazy media, comms owned by the composition root, invalidation-only realtime for SaaS data) could be undone by accident. Mitigation: the preserve list and the "intentional?" flags in the Appendix.
10. **Payment provider fit.** Stripe and PayPal (the only provider enum values) may not accept softcore content; this changes whether the internal ledger is authoritative. Mitigation: decide merchant of record and payout custody before designing ledger tables.
11. **Throughput of the fork.** If bslt-main absorbs creator-specific assumptions during restructure, it stops being a reusable foundation; if it stays too generic, the fork redoes work. Mitigation: kernel and generic modules in bslt-main; creator domains only in the fork.
12. **Scope of the UI redesign.** Rebuilding shells and the DS in parallel with the backend restructure doubles moving parts. Mitigation: platform-layer plumbing first, shells second, visual redesign after the catalog becomes the visual-regression surface.

---

# Appendix

Everything below is reproduced from the area maps and feature traces as produced by the independent agents (content unchanged; only formatting and IDs added). Synthesizer notes are marked **[synth]**.

## A. Finding index (all 157 area findings)

| ID      | Severity | Intentional? | Category             | Title                                                                                                                                                                    |
| ------- | -------- | ------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WEB-01  | high     | no           | wiring-sprawl        | Navigation and page metadata live in about 10 hand-written registries that already disagree                                                                              |
| WEB-02  | medium   | no           | dead-code            | Pages that nothing links to, and duplicate UIs for the same capability                                                                                                   |
| WEB-03  | high     | no           | config               | Four disconnected gating systems plus edition templates; shared env schema not used                                                                                      |
| WEB-04  | high     | no           | fragmentation        | Data fetching uses at least four patterns and 15 client-factory names                                                                                                    |
| WEB-05  | high     | no           | coupling             | Active organization (tenant) context is not linked to the rest of the app                                                                                                |
| WEB-06  | high     | no           | other                | Query-cache persistence uses a denylist, so new and sensitive data persists to IndexedDB by default                                                                      |
| WEB-07  | medium   | no           | fragmentation        | The i18n system is built and gated but barely used                                                                                                                       |
| WEB-08  | medium   | no           | tooling              | Path-alias tables conflict across tsconfig, vite and vitest; one module imported several ways                                                                            |
| WEB-09  | medium   | no           | layering-violation   | Two-way coupling between app/ and features/ with no boundary rules inside the app                                                                                        |
| WEB-10  | medium   | no           | naming-inconsistency | Feature folder shapes, hook placement and client placement vary by feature                                                                                               |
| WEB-11  | medium   | no           | duplication          | The list of settings sections is declared in several places                                                                                                              |
| WEB-12  | high     | no           | duplication          | Three upload/media surfaces, plus an unused MediaGallery in @bslt/ui                                                                                                     |
| WEB-13  | low      | no           | dead-code            | Dead or orphaned code in the web app                                                                                                                                     |
| WEB-14  | medium   | no           | ui-consistency       | Three styling approaches, inconsistent page scaffolding and no icon system                                                                                               |
| WEB-15  | medium   | no           | ui-design            | The app shell is a developer-tool, IDE-style four-pane layout                                                                                                            |
| WEB-16  | medium   | no           | duplication          | Auth guards and error handling are implemented more than once and unevenly                                                                                               |
| WEB-17  | medium   | no           | duplication          | app/authToken.ts duplicates the shared token reader and falls back to localStorage                                                                                       |
| WEB-18  | medium   | no           | layering-violation   | Domain hooks and domain components are split between client packages and the web app with no rule                                                                        |
| WEB-19  | medium   | yes          | tooling              | A hand-maintained Core copy of the shell and anchor-based tooling make the app hard to restructure                                                                       |
| WEB-20  | low      | yes          | other                | rust-access is a separate SPA (another product's slice) living inside features/                                                                                          |
| WEB-21  | low      | no           | naming-inconsistency | 'content' is really legal documents; the legal UI is spread over four places                                                                                             |
| WEB-22  | medium   | no           | fragmentation        | The dashboard does not act as a hub                                                                                                                                      |
| WEB-23  | low      | no           | docs                 | README and inline docs are stale relative to the code                                                                                                                    |
| WEB-24  | low      | no           | test-topology        | Tests are colocated and plentiful, but data hooks and app wiring are the least tested                                                                                    |
| WEB-25  | low      | no           | duplication          | Three hand-rolled external stores repeat the same pattern                                                                                                                |
| CLI-01  | high     | no           | fragmentation        | API 'codegen' is a route-manifest stub; 214 shared endpoint contracts never reach the browser client                                                                     |
| CLI-02  | high     | no           | wiring-sprawl        | Every data hook hand-wires its own client: no single SDK instance, two DI styles, ad hoc query keys                                                                      |
| CLI-03  | high     | no           | fragmentation        | Domain hooks split between @bslt/react and apps/web with no placement rule                                                                                               |
| CLI-04  | high     | no           | layering-violation   | Design-system package carries SaaS-domain components; app wraps them with shims, and a third billing UI exists                                                           |
| CLI-05  | high     | no           | duplication          | Two app-shell implementations; ui shells are unused and their CSS namespaces collide with the web shell                                                                  |
| CLI-06  | medium   | no           | duplication          | Overlapping components inside @bslt/ui (two modal systems, three toast pieces, several loading/error wrappers)                                                           |
| CLI-07  | medium   | no           | fragmentation        | Theme ownership split across ui, react and engine; magic storage keys; high-contrast palette outside the token source                                                    |
| CLI-08  | medium   | no           | accessibility        | WCAG gaps: hairline border fails 1.4.11 in both modes (and on radio controls), reduced-motion barely honored, DS strings not localizable                                 |
| CLI-09  | medium   | no           | ui-consistency       | Styling conventions inconsistent: dual spacing scales, BEM page one-offs overriding DS internals, mixed size vocab, no z-index/elevation tokens                          |
| CLI-10  | medium   | no           | fragmentation        | Four unrelated token vocabularies (ui, storefront, rust-access, extensions) and lint does not see two of them                                                            |
| CLI-11  | medium   | no           | docs                 | client/engine identity is muddled and its README documents removed modules                                                                                               |
| CLI-12  | medium   | yes          | layering-violation   | No client realtime package: the only socket client is an app-local invalidation bus with one consumer                                                                    |
| CLI-13  | low      | no           | dead-code            | Speculative/unused client surface: many DS components and react hooks have zero product consumers                                                                        |
| CLI-14  | low      | no           | config               | tsconfig alias sprawl: same alias means different packages; ui imports react's private source                                                                            |
| CLI-15  | low      | no           | ui-design            | /ui-library catalog: key collision, inverted taxonomy, ~60% coverage, demo CSS shipped in the DS                                                                         |
| CLI-16  | medium   | no           | duplication          | Auth/CSRF transport logic duplicated in 4+ places; catch-all createApiClient duplicates domain clients                                                                   |
| CLI-17  | medium   | no           | wiring-sprawl        | Feature registration is scattered: route paths repeated as literals across routes, nav, command palette, dashboard                                                       |
| CLI-18  | low      | no           | docs                 | Stale docs across the client layer contradict the code                                                                                                                   |
| CLI-19  | medium   | no           | ui-design            | No icon system and a SaaS-monochrome visual language unsuited to a consumer creator platform                                                                             |
| CLI-20  | low      | no           | layering-violation   | Two UI-hierarchy violations exist and the hierarchy is not lint-enforced inside ui                                                                                       |
| CORE-01 | high     | no           | coupling             | No domain event mechanism; side effects are copy-pasted at every call site                                                                                               |
| CORE-02 | high     | no           | fragmentation        | Billing events reach almost nothing else; most advertised webhook event types are never emitted                                                                          |
| CORE-03 | high     | no           | wiring-sprawl        | Billing dunning notifier is never passed to the webhook routes (wiring bug, found by reading code)                                                                       |
| CORE-04 | high     | no           | dead-code            | Usage metering, plan entitlements and feature flags are built but nothing enforces them on the server                                                                    |
| CORE-05 | medium   | no           | dead-code            | Dead or parallel infrastructure: permissions checker, permission middleware, WriteService, preference gates                                                              |
| CORE-06 | medium   | no           | coupling             | Import cycle auth <-> users <-> api-keys, and the users/me/* URL space is split between auth and users                                                                   |
| CORE-07 | medium   | yes          | coupling             | Core-edition modules depend on paid modules; the edition split and the pruner patch core source as text                                                                  |
| CORE-08 | medium   | no           | wiring-sprawl        | Billing registration is special-cased in five places, with provider protocol logic living in the app shell                                                               |
| CORE-09 | high     | no           | fragmentation        | Several overlapping audit trails, with the same event logged under different names                                                                                       |
| CORE-10 | medium   | no           | fragmentation        | Notifications and email have six or more independent write paths with different guarantees                                                                               |
| CORE-11 | medium   | no           | naming-inconsistency | Module folder layouts and file naming differ from module to module                                                                                                       |
| CORE-12 | medium   | no           | naming-inconsistency | Module context types, handler return style and error adapters differ across modules                                                                                      |
| CORE-13 | medium   | no           | layering-violation   | Services and handlers bypass repositories with raw SQL; tenant creation is implemented twice                                                                             |
| CORE-14 | medium   | no           | duplication          | Duplicated logic across core, apps/server and workers                                                                                                                    |
| CORE-15 | medium   | no           | wiring-sprawl        | Adding a domain such as creators, content or ledger touches about 15-20 places                                                                                           |
| CORE-16 | low      | yes          | god-file             | Large files and a cross-domain admin module                                                                                                                              |
| CORE-17 | low      | no           | test-topology        | Core tests are split across three places and pin internal file paths                                                                                                     |
| CORE-18 | low      | no           | naming-inconsistency | The same concepts go by different names across layers                                                                                                                    |
| SHR-01  | high     | no           | coupling             | Endpoint identity is triple-sourced; shared contracts are audit and docs artifacts, not the wiring source                                                                |
| SHR-02  | high     | no           | fragmentation        | Features are sliced horizontally: one domain is spread over constants, ids, env, modules, contracts and five barrels                                                     |
| SHR-03  | high     | no           | layering-violation   | Shared is a dumping ground: about 30% is server-only runtime code, some is client-only UI code, and 'runtime-agnostic' is not enforced                                   |
| SHR-04  | high     | no           | dead-code            | Large dead surface: 899 of 1,986 unique public symbols have no consumer outside shared, including whole subsystems                                                       |
| SHR-05  | high     | no           | duplication          | Duplicated validation rules have diverged: two incompatible username policies enforced at different server boundaries                                                    |
| SHR-06  | medium   | no           | duplication          | Three error-code vocabularies and three response-envelope type sets; contracts mix wrapped and raw 200s                                                                  |
| SHR-07  | medium   | yes          | duplication          | Custom schema system lacks object/optional combinators: types and validators are written twice and object parsing is hand-rolled hundreds of times                       |
| SHR-08  | medium   | no           | fragmentation        | Constants sprawl: arbitrary core/system split, alias shim files and copy-pasted values                                                                                   |
| SHR-09  | medium   | no           | wiring-sprawl        | Subpath export and alias sprawl: the shared module map is restated in package.json, about 27 tsconfigs and about 14 vitest configs                                       |
| SHR-10  | medium   | no           | fragmentation        | Authorization vocabulary is split across six files with two permission models; the 'central' policy is unused                                                            |
| SHR-11  | medium   | no           | fragmentation        | Live/realtime contract fragmented across db/pubsub, modules/realtime and contracts; excluded from router and coverage                                                    |
| SHR-12  | medium   | no           | db-schema            | Entity models duplicated across layers, with persistence shapes mixed into shared; branded IDs barely adopted                                                            |
| SHR-13  | medium   | yes          | god-file             | Barrel overhead and a root barrel used mainly by tests                                                                                                                   |
| SHR-14  | low      | no           | duplication          | Utility logic implemented more than once; misleading file names                                                                                                          |
| SHR-15  | low      | no           | god-file             | Oversized, mixed-responsibility files                                                                                                                                    |
| SHR-16  | low      | no           | naming-inconsistency | Inconsistent naming conventions for files, modules and UI tone vocabularies                                                                                              |
| SHR-17  | low      | no           | docs                 | Stale docs and config describing the old shared layout                                                                                                                   |
| DB-01   | high     | no           | db-security          | RLS policies exist but cannot apply at runtime: the app connects as superuser `postgres`, the policies target role `authenticated`, and nothing grants or SETs that role |
| DB-02   | high     | no           | db-security          | RLS policy set is inconsistent, partly unsafe if it were enforced, and covers only 24 of 46 tables                                                                       |
| DB-03   | high     | no           | db-schema            | Billing tenant-scope stopped at Phase 0, so user vs tenant ownership is unresolved across the schema                                                                     |
| DB-04   | high     | no           | tooling              | Prune tooling can break the migration chain because some migrations alter other modules' tables                                                                          |
| DB-05   | high     | no           | db-schema            | Concrete schema bugs: index name collision, unconditional 'pending' unique on invitations, unmaintained event partitions, phantom column                                 |
| DB-06   | medium   | no           | duplication          | Four hand-maintained representations per table have drifted (SQL DDL, TS row types, *_COLUMNS maps, shared domain types)                                                 |
| DB-07   | medium   | no           | layering-violation   | Repository layer is bypassed: about 25 server/core files build SQL directly while some repositories have zero callers                                                    |
| DB-08   | medium   | no           | dead-code            | Dead or orphaned schema and wiring                                                                                                                                       |
| DB-09   | medium   | no           | tooling              | Migration numbering scheme has decayed and the runner is minimal (no checksums, no lock, three entry points)                                                             |
| DB-10   | medium   | no           | db-schema            | users is a god table that mixes credentials, profile, lockout, lifecycle and attestation; DOB is self-reported                                                           |
| DB-11   | medium   | no           | db-schema            | Financial records are cascade-deleted with users; the money model has no ledger                                                                                          |
| DB-12   | medium   | no           | wiring-sprawl        | @bslt/db mixes persistence with queue, pubsub, search and tenancy runtime; adding one table touches about 9 files                                                        |
| DB-13   | low      | no           | naming-inconsistency | Naming inconsistencies across tables, columns, logs and folders                                                                                                          |
| DB-14   | low      | no           | db-schema            | Redundant indexes and missing uniqueness on provider identifiers                                                                                                         |
| DB-15   | low      | no           | other                | Session scoping costs about 5 round trips per query and opens one transaction per repository call                                                                        |
| DB-16   | low      | yes          | fragmentation        | schema-per-tenant mode is a second, TS-defined schema source with a single demo table                                                                                    |
| DB-17   | low      | yes          | fragmentation        | server-rust keeps its own `bslt_rust` schema, users and sessions for the Kanu Rust backend                                                                               |
| DB-18   | low      | no           | config               | Postgres major version differs across environments                                                                                                                       |
| SRV-01  | high     | no           | db-security          | Realtime record API is an unscoped read/write proxy onto the users table                                                                                                 |
| SRV-02  | high     | no           | coupling             | App DI container silently drops billingNotifier; billing service slot is never filled                                                                                    |
| SRV-03  | high     | no           | fragmentation        | No working job queue: three job tables, an idle QueueServer, an in-memory media queue, and setInterval tasks                                                             |
| SRV-04  | high     | no           | fragmentation        | No outbox or domain-event mechanism; side effects are hand-wired fire-and-forget calls                                                                                   |
| SRV-05  | high     | yes          | coupling             | Optional capabilities load by bare-specifier dynamic import and do not resolve outside the Pro export                                                                    |
| SRV-06  | high     | no           | coupling             | The workers phase owns WebSocket registration and the startup summary                                                                                                    |
| SRV-07  | medium   | no           | duplication          | Retention and anonymization exist three times with incompatible email formats, so hard-delete never runs in the workers profile                                          |
| SRV-08  | medium   | no           | dead-code            | @bslt/media is about 95% unwired, and there are two media HTTP modules                                                                                                   |
| SRV-09  | medium   | no           | dead-code            | apps/server ships about 1.4k lines of tested but unwired middleware and plugins                                                                                          |
| SRV-10  | medium   | no           | config               | Configuration is split across duplicate loaders, direct process.env reads and leftover provider configs                                                                  |
| SRV-11  | medium   | no           | coupling             | The cache is built but never handed to domains; user cache-aside is a silent no-op                                                                                       |
| SRV-12  | medium   | no           | duplication          | Infrastructure helpers are duplicated across apps/server, server/system and shared                                                                                       |
| SRV-13  | medium   | yes          | wiring-sprawl        | Route registration is spread across six places plus text-patch anchors in tools                                                                                          |
| SRV-14  | medium   | no           | other                | Local storage serves uploads publicly, unsigned and without auth, unlike S3                                                                                              |
| SRV-15  | low      | yes          | config               | Capability profile model is inconsistent; several flags gate nothing                                                                                                     |
| SRV-16  | low      | no           | test-topology        | Tests give false confidence for unwired code and leave wired adapters untested                                                                                           |
| SRV-17  | low      | yes          | other                | server-rust is a separate, deliberate experiment for another product                                                                                                     |
| SRV-18  | low      | no           | docs                 | Status docs overstate how far several capabilities are integrated                                                                                                        |
| TOOL-01 | high     | no           | wiring-sprawl        | Root script surface: 156 scripts, about 25 with zero consumers, 127 hardcoded --filter flags, near-duplicate ci:* chains                                                 |
| TOOL-02 | high     | no           | tooling              | Moving a tool script can silently turn its gate into a no-op (hardcoded main-module path guards)                                                                         |
| TOOL-03 | high     | yes          | coupling             | Prune manifests pin 239 exact-match anchors across 133 files: any restructure must edit them in lockstep                                                                 |
| TOOL-04 | high     | no           | fragmentation        | Ten overlapping 'feature' vocabularies and registries across the productization machinery (about 19k non-test LOC)                                                       |
| TOOL-05 | high     | no           | layering-violation   | Package builds and test configs depend on main/tools by relative path; main/tools is not a workspace package                                                             |
| TOOL-06 | medium   | no           | duplication          | Delivery sprawl: 19 workflows, 6 hosting paths, a Woodpecker mirror, image builds duplicated in 4 places                                                                 |
| TOOL-07 | medium   | no           | config               | Node and Postgres version drift across CI, containers and engines                                                                                                        |
| TOOL-08 | medium   | no           | config               | ESLint and turbo config carry dead or stale targets; editor config is in a location editors never search                                                                 |
| TOOL-09 | medium   | no           | test-topology        | About 24k LOC of tooling and 2.8k LOC of .template TypeScript have no CI lint coverage                                                                                   |
| TOOL-10 | medium   | no           | dead-code            | Dead or vestigial tool code and stale references                                                                                                                         |
| TOOL-11 | medium   | yes          | duplication          | Terraform maintains DO/GCP parity behind a root wrapper that cannot be applied                                                                                           |
| TOOL-12 | low      | no           | duplication          | Docker and proxy config duplication                                                                                                                                      |
| TOOL-13 | medium   | yes          | coupling             | Editions maintain hand-written parallel composition roots (17 Core templates)                                                                                            |
| TOOL-14 | medium   | no           | fragmentation        | The clean extension contract exists only in exported Core, not in the dev tree                                                                                           |
| TOOL-15 | medium   | yes          | duplication          | Storefront is a parallel mini-SaaS that reuses nothing from BSLT                                                                                                         |
| TOOL-16 | medium   | no           | wiring-sprawl        | Path-alias and module-resolution config is defined in 5+ independent places                                                                                              |
| TOOL-17 | medium   | no           | coupling             | Other move-sensitive hardcoded path lists                                                                                                                                |
| TOOL-18 | low      | no           | naming-inconsistency | Naming collisions: 'core', 'bootstrap', 'starter', and audit/check/verify/lint                                                                                           |
| TEST-01 | high     | no           | test-topology        | Single-package tests misplaced in central tests/integration (19 files, 11.3k LOC), duplicating colocated tests and inflating colocation debt                             |
| TEST-02 | high     | no           | test-topology        | 'Integration' tier is mock-based and parallels the real-DB tier per domain; the docs define integration as 'against test database'                                       |
| TEST-03 | high     | no           | coupling             | createTestServer re-implements the composition root and a full AppConfig by hand                                                                                         |
| TEST-04 | high     | no           | db-schema            | Tests encode the DB schema in raw SQL through three independent seeding paths; schema setup differs per CI lane                                                          |
| TEST-05 | medium   | no           | duplication          | Real-DB gate boilerplate copied into all 26 real-db suites                                                                                                               |
| TEST-06 | medium   | no           | duplication          | Mock factory sprawl; the canonical @bslt/db testing mock is unused                                                                                                       |
| TEST-07 | medium   | no           | duplication          | Web test helpers duplicated between tests/ and apps/web                                                                                                                  |
| TEST-08 | medium   | no           | dead-code            | Dead test scaffolding, placeholder fixtures and unconditional skips                                                                                                      |
| TEST-09 | medium   | no           | coupling             | Package unit tests depend on central tests/utils, and turbo has no graph edge for @bslt/tests                                                                            |
| TEST-10 | medium   | no           | config               | Vitest config sprawl with hand-maintained, inconsistent alias plumbing                                                                                                   |
| TEST-11 | medium   | no           | tooling              | Hard-coded path registries a topology restructure must update                                                                                                            |
| TEST-12 | low      | no           | tooling              | CI e2e report upload points at a path Playwright never writes                                                                                                            |
| TEST-13 | low      | no           | god-file             | Oversized test files                                                                                                                                                     |
| TEST-14 | low      | no           | test-topology        | Uneven unit coverage by package                                                                                                                                          |
| TEST-15 | low      | no           | naming-inconsistency | Inconsistent test-kind naming and package-local test folders                                                                                                             |
| TEST-16 | high     | no           | docs                 | Testing, workflow and onboarding docs are materially wrong about the current test system                                                                                 |
| TEST-17 | medium   | no           | docs                 | Competing status docs with contradictory claims                                                                                                                          |
| TEST-18 | medium   | no           | docs                 | Package READMEs are sparse, and the client/engine README describes removed APIs                                                                                          |
| TEST-19 | medium   | no           | docs                 | Docs gates do not catch dead inline path references (73 across 26 docs)                                                                                                  |
| TEST-20 | medium   | no           | docs                 | Docs sprawl: orphans, unindexed files, overlapping topics                                                                                                                |
| TEST-21 | medium   | no           | coupling             | docs/ doubles as runtime content and a tooling output directory                                                                                                          |
| TEST-22 | medium   | no           | docs                 | Agent instructions are untracked and stale; stray artifacts are tracked                                                                                                  |
| TEST-23 | low      | no           | docs                 | Architecture docs mostly accurate, with two drifts (media deps; @bslt/shared/workers not exported)                                                                       |

## B. Area reports (full)

### B.WEB. main/apps/web (React app)

**Summary.** main/apps/web is a Vite + React 19 SPA with a prerender step at build time. It has 598 files under src: 274 non-test source files (about 48.2k LOC) and 205 colocated test files (about 49.3k LOC). The source is split into app/ (shell, route table, capabilities), bootstrap/, features/ (18 folders, 35.7k LOC, mostly admin at 12.6k, settings at 8.6k and auth at 5.6k), pages/ (6 standalone pages), demo/ (dev tools, 4.7k LOC), i18n/, lib/ (sentry, consent, realtime) and ssr/. The foundations are solid: services are built before React renders, there is one explicit and testable route table (createAppRoutes + flattenAppRoutes, reused by the prerenderer), a lazyPage loader that recovers from stale chunks, a type-gated public site map, and careful cleanup so cached data does not leak between users. The 'not one breathing ecosystem' problem is concrete in this app. Navigation is declared in about 10 separate hand-written registries that already disagree. Feature gating uses four unrelated mechanisms (build-time VITE_ENABLE_* flags, generated profile capabilities, server feature flags that only the admin preview page reads, and admin tier/starter metadata). Data fetching uses 15 different API-client factory names, 66 client construction sites, a direct import of a global token getter in 60 files, and a mix of query-cache hooks with hand-rolled useState/useEffect fetching. The organization switcher's active tenant only reaches the workspace client. The i18n system ships 9 locales but only one component calls t(). Some pages exist with nothing linking to them (/organization, /settings/accounts, /forbidden). Some of this split is deliberate and documented: optional capability gating, the Core edition templates, the rust-access entry, the AuthService exception and dev-tool demos. Most of the cross-feature wiring sprawl, the duplicated section and nav lists and the inconsistent data patterns are not deliberate. Restructuring is constrained by three tools that patch app files by matching exact strings: the starter:feature scaffolder, the starter:prune manifests and the Core edition .template copies of routes.tsx, AppLayout and capabilities.

#### Findings

##### WEB-01. Navigation and page metadata live in about 10 hand-written registries that already disagree

- **Area:** main/apps/web (React app)
- **Category:** wiring-sprawl
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Adding or changing a page means editing the route table, the left menu and its hint map, the command palette, optional dashboard tiles, the starter-surface test list and sometimes the settings, admin, site-map or notification maps. Nothing derives one list from another, so they have drifted. Tasks is in the left menu and dashboard but not the palette. Billing is in the palette but not the left menu. Organization appears in none of them. The palette is mounted globally in App.tsx:423 and lists Dashboard/Settings/Files even to signed-out users, because useCommandPalette never checks isAuthenticated. Only siteMap.ts (for public pages) follows a single-source discipline.

**Evidence:**

- main/apps/web/src/app/routes.tsx:174-586 (route table, 636 lines; gated builders productFeatureRoutes/billingRoutes/teamsRoutes/activityFeedRoutes/advancedAuthRoutes/developerTool*Routes/adminRoutes)
- main/apps/web/src/app/layouts/AppLeftMenu.tsx:20 HINT_MAP, :69 AUTH_LINKS, :74 PRODUCT_LINKS, :80 ADMIN_LINKS (separate hard-coded menu lists)
- main/apps/web/src/features/command-palette/data/commands.ts:55-148 (own nav list: dashboard/settings/files/admin/billing/activities; no Tasks, Profile or Organization)
- main/apps/web/src/features/dashboard/pages/DashboardPage.tsx:178-193,298 (hard-coded quick-action links)
- main/apps/web/src/app/layouts/AppTopLayout.tsx:301-316 (account menu opens modal sections directly)
- main/apps/web/src/features/admin/adminSurface.ts:14-135 (admin nav, repeats href/routePath already in routes.tsx:307-411)
- main/apps/web/src/app/siteMap.ts:73-120 (public/footer pages)
- main/apps/web/src/features/settings/settingsTabs.ts:28-58 + accountModalStore.ts:13 (settings sections)
- main/apps/web/src/app/starterSurface.ts:26 STARTER_ADMIN_SURFACE_IDS=['health','users'] while adminSurface.ts:63-70 marks 'support' starter:true (drift)
- main/apps/web/src/features/notifications/utils/getNotificationRoute.ts (hard-coded '/settings/billing', '/settings?tab=security' strings)
- 77 hard-coded '/path' literals in non-demo TSX (to="/…", navigate('/…'), href="/…")

**Direction.** Introduce one typed feature/page manifest per feature (id, path, lazy loader, layout/shell, requires {auth, role, capability, verification}, nav slots {primary, palette, dashboardTile, accountMenu}, settings sections, admin surfaces, notification deep-link matchers, i18n namespace, persistence policy). Derive routes.tsx, AppLeftMenu, the command palette, dashboard tiles, adminSurface, starterSurface and getNotificationRoute from it. Export typed path builders (paths.organization(), paths.settings('security')) instead of string literals. Keep siteMap.ts's live-gating idea as the model.

##### WEB-02. Pages that nothing links to, and duplicate UIs for the same capability

- **Area:** main/apps/web (React app)
- **Category:** dead-code
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Features exist but are not reachable from the product's own navigation. Some capabilities have two disconnected UIs (OAuth connections as a page and as a modal section; forbidden as a page and as inline JSX).

**Evidence:**

- /organization (routes.tsx:227-243, gated VITE_ENABLE_TEAMS): only self-references (OrganizationPage.tsx:429, AcceptInvitationPage.tsx:84); not in AppLeftMenu, command palette or dashboard; OrgSwitcher.tsx has no 'manage' link
- /settings/accounts -> features/auth/pages/ConnectedAccountsPage.tsx (routes.tsx:264-268): zero inbound references; the same capability is rendered inside the settings modal via OAuthConnectionsList (features/settings/components/AccountModal.tsx:238)
- /forbidden -> pages/ForbiddenPage.tsx: zero inbound references; AdminLayout renders its own inline 'Access denied' (features/admin/layouts/AdminLayout.tsx:157-175)
- getNotificationRoute.ts:34 routes 'invite_received' to '/settings?tab=notifications' instead of the invitation or organization page
- /billing/success and /unavailable have no in-app references (server redirect targets; expected)

**Direction.** When the manifest is introduced, make 'reachable from at least one nav slot or declared as an external redirect target' a test (as siteMap.test.ts does for public pages). Delete ConnectedAccountsPage or make it the single OAuth surface. Route AdminLayout denials to ForbiddenPage. Point invite notifications at the invitation/org page.

##### WEB-03. Four disconnected gating systems plus edition templates; shared env schema not used

- **Area:** main/apps/web (React app)
- **Category:** config
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Whether a surface shows depends on a build-time env flag, a generated profile file, the user's role checked ad hoc in layouts and menus, an admin tier, and for Core an entirely different template. None of these share a runtime model. The server has no endpoint the SPA uses to learn which capabilities are actually live, so VITE_ENABLE_BILLING can disagree with the server's billing config. The profile gating and edition templates are deliberate and documented (docs/DIRECTION.md, docs/architecture/core-and-extensions.md). The duplicated schema and the parallel flag systems are accidental.

**Evidence:**

- main/apps/web/src/app/capabilities.ts:4-51: 7 build-time flags (VITE_ENABLE_ACTIVITY_FEED/ADVANCED_ADMIN/ADVANCED_AUTH/BILLING/DEV_CHROME/DEV_TOOLS/TEAMS) + isMediaEnabled() reading the generated profile
- main/apps/web/src/bootstrap/generated/profile.generated.ts:20-73 (profile capabilities; used for 'media' routes and 'workers' service-worker registration in bootstrap/client.tsx:124)
- Server feature flags: useFeatureFlag is consumed only by features/admin/pages/FeatureFlagsPage.tsx:56; no product UI is gated by them
- features/admin/adminSurface.ts tier/starter fields + routes.tsx:413-417 advancedAdmin switch; /admin/billing/plans is gated by ADVANCED_ADMIN only, not BILLING
- main/shared/src/modules/system/config/env.frontend.ts:20-25 schema lists only 3 of the 7 VITE_ENABLE_* flags and is not imported anywhere in main/apps/web/src
- routes.tsx:588-595 appRoutes is frozen at module load; flag changes need a dev-server restart
- main/editions/core/main/apps/web/src/app/capabilities.ts.template, routes.tsx.template (110 lines) replace the dev versions in Core

**Direction.** Create one CapabilityContext in the client environment, seeded from the generated profile and build flags and refreshed from a server capabilities endpoint (also carrying evaluated feature flags and viewer eligibility such as age-verified or creator status). Route-manifest 'requires' checks this one context. Validate env through shared env.frontend.ts and generate capabilities.ts from it.

##### WEB-04. Data fetching uses at least four patterns and 15 client-factory names

- **Area:** main/apps/web (React app)
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Every feature re-decides how to build a client, where the base URL and token come from, whether to use the query cache, and how to name keys. Manual fetching hooks bypass cache invalidation, refetch-on-focus and the user-switch reset in App.tsx:274-300. A cross-cutting concern such as a tenant header, CSRF, an age-verification header or retry policy cannot be added in one place.

**Evidence:**

- 66 API-client construction sites (non-test) across features/pages; factory names: createAdminClient (aliased 'as createAdminApiClient' in every admin hook), getApiClient, createSettingsClient, createNotificationClient, createActivitiesClient, createApiKeysClient, createAdminBillingClient, createWorkspaceClient, createTasksClient, createSupportClient, createStatusClient, createSearchClient, createGeneratedApiClient (pages/EmailUnsubscribePage.tsx:39), createApiClient
- Raw fetch clients bypassing @bslt/api: features/media/hooks/mediaClient.ts:52,70 (own CSRF handling), features/rust-access/api.ts:21
- 60 files import getAccessToken from @app/authToken; 29 files import clientConfig directly from @config/@/config while 48 use useClientEnvironment().config
- Lifecycle variants: module singletons (features/tasks/hooks/useTasks.ts:24-32, features/support/hooks/supportClient.ts, features/organization/workspaceClient.ts), per-render useMemo (features/admin/hooks/useAdminUsers.ts:63-70), per-call construction (features/settings/hooks/useDataExport.ts:134,168,194)
- 21 files fetch manually with useState/useEffect (e.g. features/admin/hooks/useAdminUsers.ts, useAdminUser.ts, useTenants.ts, useTenant.ts, features/settings/hooks/useBackupCodes.ts, useConsent.ts, useDataExport.ts, useTotpManagement.ts, features/auth/hooks/useWebauthn.ts) vs 44 using useQuery/useMutation
- Query keys: 18 inline literals with mixed casing ('adminHealth', 'email-unsubscribe', ['auth','tos-status']) vs factories (features/organization/hooks/queryKeys.ts, features/profile/queryKeys.ts, billingQueryKeys in @bslt/react)

**Direction.** Have ClientEnvironment expose a typed `api` registry built once in bootstrap/client.tsx (token, tenant/creator context, CSRF, base URL). Ban direct getAccessToken/clientConfig imports in features with a lint rule. Require domain hooks to use useQuery/useMutation with per-domain query-key factories. Move media endpoints into @bslt/api.

##### WEB-05. Active organization (tenant) context is not linked to the rest of the app

- **Area:** main/apps/web (React app)
- **Category:** coupling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Switching organizations changes only the organization page's requests. Tasks, files, billing, notifications and activities are neither tenant-scoped from the web side nor invalidated on switch. This is the clearest example of features that exist but are not joined into one context. The creator platform will need the same mechanism for 'acting as creator X'.

**Evidence:**

- features/organization/workspaceClient.ts:21-25 is the only client given getTenantId: getActiveOrgId
- grep for getTenantId/getActiveOrgId in main/apps/web/src: only organization/ files
- features/organization/activeOrg.ts:14 localStorage 'bslt.activeOrgId'; OrgSwitcher rendered in app/layouts/AppTopLayout.tsx:252 when VITE_ENABLE_TEAMS
- Query keys for tasks/files/notifications/billing carry no tenant segment (e.g. useTasks.ts:22 ['tasks'], useFiles.ts:14 ['files'])

**Direction.** Promote active-tenant (later active-creator) to the platform layer. Inject it into every API client through the environment registry, include it in query-key factories, and invalidate scoped queries on switch.

##### WEB-06. Query-cache persistence uses a denylist, so new and sensitive data persists to IndexedDB by default

- **Area:** main/apps/web (React app)
- **Category:** other
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Any feature that forgets to register its key head gets its data written to IndexedDB for a day. The persistence decision is not made where the query is declared. For the creator platform this would put paywalled media URLs, payout and KYC state, and moderation data on disk unless every author remembers the denylist.

**Evidence:**

- main/apps/web/src/app/queryPersistencePolicy.ts:22-29 NON_PERSISTABLE_HEADS = apiKeys, sessions, devices, billing, notifications, legal; :37-44 isPersistableQueryKey returns true for everything else
- features/search/hooks/useSearch.ts:55 ['search', term] (admin search hits contain emails/UUIDs per docs/CLAUDE.md) is persisted
- Persisted admin data: ['auditEvents'] useAuditEvents.ts:50, ['adminMetrics'], ['webhookMonitorDeliveries'], ['featureFlagOverrides'], ['job', id]; organizations/members keys (organization/hooks/queryKeys.ts)
- app/App.tsx:226-262 restores and persists the cache with a 24h maxAge (config.ts queryPersistence)

**Direction.** Switch to an allowlist. Attach persistence metadata to query-key factories (persist: 'never' | 'session' | 'offline') declared in the feature manifest. Add a test that fails on undeclared key heads.

##### WEB-07. The i18n system is built and gated but barely used

- **Area:** main/apps/web (React app)
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Translation infrastructure, a provider, RTL handling and a CI parity gate exist, but the UI does not consume them. Switching language changes almost nothing on screen. The docs overstate the state.

**Evidence:**

- main/apps/web/src/i18n/locales/*.ts: 9 locales, ~57 keys each (en-US.ts: 19 auth, 12 common, 4 error, 22 settings)
- t() is called only at features/settings/components/LanguageSelector.tsx:79 and :92; useLocale is used only for date formatting in 4 files
- All shell and feature copy is hard-coded English (e.g. AppLeftMenu.tsx labels, AppTopLayout.tsx 'Login'/'Register'/'Log out', CommandPalette.tsx strings)
- docs/DIRECTION.md Frontend table claims 'i18n (9 locales) + RTL ✅ … all fully translated'; main/tools/scripts/audit/i18n-completeness.ts enforces key parity on keys nothing renders

**Direction.** Decide per fork. Either wire i18n through manifest-declared namespaces and replace literals feature by feature, or drop locales and keys to en-US and keep only the formatting helpers until needed. Either way, correct DIRECTION.md.

##### WEB-08. Path-alias tables conflict across tsconfig, vite and vitest; one module imported several ways

- **Area:** main/apps/web (React app)
- **Category:** tooling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Four alias definitions (tsconfig, tsconfig.lint, vite, vitest) disagree on meaning. Feature-specific aliases (@auth, @settings, @dashboard) let one feature reach into another without going through @features, and there are several spellings for the same import.

**Evidence:**

- main/apps/web/tsconfig.json: '@components' -> ./src/features/admin/components, '@layouts' -> ./src/app/layouts, '@hooks' -> client/react hooks, '@config' -> ./src/config (actual file is src/config.ts)
- main/apps/web/vite.config.ts (alias block) and vitest.config.ts:170-197: '@components' -> client/ui/src/components, '@layouts' -> client/ui/src/layouts
- main/apps/web/tsconfig.lint.json:32-33,54-55 maps '@components'/'@layouts' to BOTH targets
- 0 web source files use @components/@layouts/@hooks/@router/@providers/@admin/@billing; 93 use @app, 34 @auth, 32 '@/', 29 @config, 21 @features, 4 @settings, 1 @dashboard
- useAuth imported as '@auth/hooks' (22), '@features/auth' (3), '@auth' (2); '@/config' and '@config' both used
- README.md alias table maps @components/@hooks to features/auth (stale)

**Direction.** Shrink to '@/' plus '@app/_' (or '@platform/_') and '@features/*'. Generate all four alias tables from one source, which the shared-vitest-aliases helper already partly does. Lint-enforce one spelling per target.

##### WEB-09. Two-way coupling between app/ and features/ with no boundary rules inside the app

- **Area:** main/apps/web (React app)
- **Category:** layering-violation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** app/ is both the composition root and a service locator that features depend on. The result is cycles that were worked around with deep imports and comments. Features are not independently removable without the prune manifests' string patching.

**Evidence:**

- 75 feature files import from @app: @app/authToken (60), @app/ClientEnvironment (48), @app/capabilities (10), @app/layouts/AppLayoutContext (2), @app/siteMap (1)
- app imports features deeply: app/layouts/AppLayout.tsx:32 '@features/admin/components/ImpersonationBanner', AppTopLayout.tsx:26 '@features/organization/components', AppFooter.tsx '@settings/components/DoNotSellControl', App.tsx:34-35 command-palette + settings CookieConsentBanner
- features/auth/hooks/useAuth.ts header comments: imports deep paths 'to avoid circular dependency' through the @app barrel
- Cross-feature edges: settings->profile(5), settings->auth(7), dashboard->settings, admin->support, auth->settings (ReactivatePromptPage imports @settings/hooks)
- Root eslint.config.ts:258 treats all of main/apps/web as one 'app-web' boundary element, so nothing governs feature-to-feature or feature-to-app imports

**Direction.** Split app/ into (a) a platform layer (env, api registry, auth token, capabilities, layout slots) that features may import, and (b) a composition root (routes, shells) that only consumes feature manifests. Add eslint-plugin-boundaries elements for web/platform, web/features/*, web/app and web/demo. Allow feature-to-feature imports only through public barrels or explicit 'depends' entries.

##### WEB-10. Feature folder shapes, hook placement and client placement vary by feature

- **Area:** main/apps/web (React app)
- **Category:** naming-inconsistency
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** No feature can be used as the template for the next one. Stores, clients, query keys, layouts and registries sit at different depths in each feature.

**Evidence:**

- Shapes: admin [components,hooks,layouts,pages,utils]+adminSurface.ts; auth [components,hooks,pages,services,utils]+authModalStore.ts; billing [components,pages]+defaultPlans.ts (no hooks; uses @bslt/react billing hooks); command-palette [components,data,hooks]; content [components,lib,pages]; organization [components,hooks,pages]+workspaceClient.ts+activeOrg.ts at root; profile = queryKeys.ts+index.ts only (5 LOC, consumed by settings); rust-access flat files; search [hooks,pages] with no sub-barrels; settings [components,hooks,pages,utils]+settingsTabs.ts+accountModalStore.ts; FEATURE.md only in tasks/ and files/
- API clients in hooks/ (support/hooks/supportClient.ts, media/hooks/mediaClient.ts) because main/tools/scripts/audit/web-feature-surfaces.ts bans features/_/api and features/_/services (except auth/services), so the rule is met by file location rather than by design
- Eager vs lazy is inconsistent: DashboardPage, auth pages, content pages and settings modal routes are imported eagerly in routes.tsx:2-26 while Tasks/Files/Status/Support are lazyPage
- features/index.ts claims '@auto-generated - Do not edit manually' but no generator exists in main/tools and nothing imports '@features'

**Direction.** Define a canonical feature skeleton (index.ts public API, manifest.ts, pages/, components/, hooks/ including query-key factory, model/ or store.ts) and have starter:feature emit it. Fold profile/ into settings or make it the owner of profile hooks. Delete the stale features/index.ts.

##### WEB-11. The list of settings sections is declared in several places

- **Area:** main/apps/web (React app)
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Settings are split between a modal (most sections) and standalone pages (billing, connected accounts). The section ids are repeated in four forms that are kept in sync by hand.

**Evidence:**

- features/settings/settingsTabs.ts:11-21 SettingsTabId union, :28-39 SETTINGS_TAB_IDS set, :48-58 SETTINGS_NAV_ITEMS
- features/settings/accountModalStore.ts:13 ACCOUNT_MODAL_SECTIONS (a 4th copy without 'billing')
- features/settings/components/AccountModal.tsx:382-425 switch over sections
- features/settings/pages/AccountModalRoute.tsx:35 billing redirects to a real page /settings/billing (features/billing/pages/BillingSettingsPage.tsx, 708 LOC) outside the modal
- AppTopLayout.tsx:304,312 and getNotificationRoute.ts hard-code section ids

**Direction.** One settings-section registry (id, label, component, requires, aliases) contributed by features through the manifest. The modal, the deep-link resolver and the nav derive from it. Decide whether billing/payouts live inside the account surface or in a dedicated studio area.

##### WEB-12. Three upload/media surfaces, plus an unused MediaGallery in @bslt/ui

- **Area:** main/apps/web (React app)
- **Category:** duplication
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Files and Media are separate products with separate clients and UIs over related storage. The design-system gallery built for this goes unused. For a creator platform, media upload, processing and gated delivery is the core loop and must be one pipeline.

**Evidence:**

- features/files/pages/FilesPage.tsx + hooks/useFiles.ts (storage API via getApiClient)
- features/media/pages/MediaStudioPage.tsx:250-267 builds its own gallery grid; features/media/hooks/mediaClient.ts is a hand-written fetch client with its own CSRF fetch (:52,:70); gated by the profile 'media' capability (routes.tsx:186-188)
- features/settings/hooks/useAvatarUpload.ts (third upload path)
- main/client/ui/src/components/media/MediaGallery.tsx (pagination, preview, empty/error states) is imported by no app
- main/client/ui/src/components/billing/TenantUsageOverrideEditor.tsx also imported by no app

**Direction.** Merge Files and Media into one 'library/media' feature over a single typed @bslt/api media client, rendered with @bslt/ui MediaGallery (or delete it). Have avatar upload use the same upload primitive.

##### WEB-13. Dead or orphaned code in the web app

- **Area:** main/apps/web (React app)
- **Category:** dead-code
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Each item is small, but together they add noise that a restructure should drop rather than move.

**Evidence:**

- features/auth/hooks/useAuthMutations.ts (130 LOC): useLogin/useRegister/useVerifyEmail re-exported from auth/hooks/index.ts:4, no non-test consumer
- demo/home/hooks/useHomeKeyboard.ts (76 LOC): exported, never used
- demo/ui-library/hooks/useUILibraryPanes.ts (76 LOC): near-copy of app/layouts/useAppShellPanes.ts, unused, with two test files (useUILibraryPanes.test.ts and .test.tsx)
- features/index.ts: stale 'auto-generated' root barrel with no consumers
- lib/sentry.ts: setSentryUser (:334), withSentryProfiler (:381), captureError (:320) unused in web
- ssr/SsrContext.tsx:83 useSsrData unused; settings/utils/profileOptions.ts:249 PROFILE_LANGUAGES unused; demo/ui-library/catalog/catalog.ts:23 getTotalComponentCount unused
- features/settings/components/SessionCard.tsx is a 1-line re-export shim of @bslt/ui/components SessionCard
- app/components/index.ts:4 re-exports SectionErrorBoundary, never rendered

**Direction.** Delete these during the move. Add a knip/ts-prune-style unused-export gate for main/apps/web.

##### WEB-14. Three styling approaches, inconsistent page scaffolding and no icon system

- **Area:** main/apps/web (React app)
- **Category:** ui-consistency
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The visual language depends on which feature you are in. A redesign has no single place to apply tokens, page headers, empty/loading/error states or icons.

**Evidence:**

- 24 CSS files, 3,551 lines (largest: features/settings/components/AccountModal.css 730, features/billing/pages/BillingSettingsPage.css 559, rust-access.css 418, app/layouts/AppShell.css 326)
- 129 inline style={{…}} objects in 20 files (e.g. features/command-palette/components/CommandPalette.tsx, app/layouts/AppFooter.tsx, pages/LandingPage.tsx, features/admin/pages/AdminDashboardPage.tsx)
- 565 utility-class usages ('flex items-center gap-3 …') backed by main/client/ui/src/styles/utilities.css
- 14 page components do not use PageContainer (e.g. features/admin/pages/SystemHealthPage.tsx, AdminDashboardPage.tsx, FeatureFlagsPage.tsx, organization/pages/OrganizationPage.tsx); auth pages use AuthLayout
- Loading copy varies ('Loading...', 'Loading…', 'Loading tasks...', 'Loading admin access. Sign in may be required.')
- No icon set in @bslt/ui (only IconButton); inline <svg> in 8 web files; layout rail uses text glyphs 'T','L','R','B','↺' (app/layouts/AppMainLayout.tsx LAYOUT_TOGGLES)

**Direction.** Pick one styling contract: tokens and utilities from @bslt/ui plus per-feature CSS modules, with no inline style objects. Add a PageShell/PageHeader primitive with standard async states (extend CardAsyncState/EmptyState) and an icon set in @bslt/ui. Enforce with lint (ban style={{}} outside @bslt/ui).

##### WEB-15. The app shell is a developer-tool, IDE-style four-pane layout

- **Area:** main/apps/web (React app)
- **Category:** ui-design
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The shell suits a dev console, not a consumer product. The top bar scales with viewport height, admin navigation sits on the right, and there is no room for a feed or live-player layout. There is one shell for every audience.

**Evidence:**

- app/layouts/useAppShellPanes.ts:5-17 DEFAULT_PANE_CONFIG top 6%, left 18%, right 25%, bottom 8%, persisted to localStorage 'app-pane-config'
- app/layouts/AppLayout.tsx:106-153 nested ResizablePanelGroups; AppTopLayout height is a percentage of the viewport (ResizablePanel minSize 6 / maxSize 20)
- Admin sub-navigation is injected into the RIGHT pane via useAppRightSidebar (features/admin/layouts/AdminLayout.tsx:136); the right pane is otherwise used only by demos
- AppTopLayout.tsx:195-203 text 'Menu' toggle button; AppTopLayout.tsx:129-154 decodes the JWT payload client-side to recover an email for display
- One AppLayout serves landing, product, settings, admin and dev tools; there are no separate public, product and console shells

**Direction.** Define named shells in the manifest (public/marketing, viewer app, creator studio, admin/moderation console, auth). Keep resizable panes only in the console shell. Use fixed-height top bars and responsive left nav. Remove JWT decoding from the UI and rely on the user object.

##### WEB-16. Auth guards and error handling are implemented more than once and unevenly

- **Area:** main/apps/web (React app)
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Access control and failure isolation are decided per layout rather than per route. This matters more once routes need creator-only, age-verified or moderator-only gates.

**Evidence:**

- app/App.tsx:137-148 ProtectedPage wraps @bslt/ui ProtectedRoute (client/ui/src/layouts/layers/ProtectedRoute.tsx) with a returnTo redirect
- features/admin/layouts/AdminLayout.tsx:140-175 re-implements the loading gate and returnTo redirect, compares role by string (user?.role !== 'admin', :157) while AppLeftMenu/AppTopLayout/useCommandPalette use isAdmin() from @bslt/shared/core/users, and navigates with window.location.href (:170)
- app/routes.tsx:530-541 /search reuses AdminLayout as an auth+role guard
- AppRoute (routes.tsx:44-53) has protected/publicOnly but no role/capability requirement field
- Only a root ErrorBoundary + SentryErrorBoundary (App.tsx:399-400); routes are wrapped in Suspense only (App.tsx:180), so one page crash replaces the whole shell

**Direction.** Add `requires: { auth, roles, capabilities, verification }` to the route manifest, enforced by one guard component. Use ForbiddenPage for denials. Wrap every route element in a SectionErrorBoundary with a retry fallback.

##### WEB-17. app/authToken.ts duplicates the shared token reader and falls back to localStorage

- **Area:** main/apps/web (React app)
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The memory-only design is undermined by a leftover fallback that accepts any localStorage 'accessToken'. The fallback is also a second copy of the shared logic.

**Evidence:**

- main/apps/web/src/app/authToken.ts:4-24 reads localStorage[ACCESS_TOKEN_COOKIE_NAME] and promotes it into tokenStore
- main/shared/src/modules/system/security/crypto.ts:28-36 has the same readPersistedToken; :97-103 states the default tokenStore is memory-only, 'immune to XSS'
- main/apps/web/README.md 'Token Management | Memory storage (XSS-safe)'
- Imported by 60 feature files as getToken

**Direction.** Make getToken come from the environment's AuthService/tokenStore only and delete the localStorage branch. With the api registry, features stop importing a token getter at all.

##### WEB-18. Domain hooks and domain components are split between client packages and the web app with no rule

- **Area:** main/apps/web (React app)
- **Category:** layering-violation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Reuse across future TypeScript platforms depends on knowing which layer owns domain UI and hooks. Today the answer depends on the domain.

**Evidence:**

- main/client/react/src/{billing,devices,legal,oauth,phone,webhooks}/ provide domain hooks (useSubscription, usePlans, useDevices, useCurrentLegal, useOAuthConnections, useWebhooks…) consumed by 17 web files
- Other domains keep hooks in the web app (features/settings/hooks/_, notifications/hooks/_, tasks, files, organization, admin/hooks/*); features/admin/hooks/useWebhookAdmin.ts wraps @bslt/react webhooks
- main/client/ui/src/components contains domain components (StatusBadge for admin users, JobStatusBadge, RoleBadge, SessionCard, DeviceRowCard, ProfileCompletenessCard, billing/_, media/_) while web keeps parallel status-tone logic (features/admin/utils/statusTone.ts, features/status/pages/StatusPage.tsx STATE_BADGES, features/admin/components/WebhookStatusBadge.tsx)

**Direction.** Pick a rule. For example, @bslt/react hosts headless domain hooks for every API domain, @bslt/ui stays domain-free (primitives and patterns), and domain components live in the web feature that owns them, or in a new @bslt/ui-domain package if shared across apps. Apply the same rule to status-tone helpers.

##### WEB-19. A hand-maintained Core copy of the shell and anchor-based tooling make the app hard to restructure

- **Area:** main/apps/web (React app)
- **Category:** tooling
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** Three tools encode today's file layout and exact code text. Moving or reformatting routes.tsx, AppLeftMenu or commands.ts breaks scaffold, prune or edition export. The Core edition and feature packs use a cleaner manifest-plus-extension-host model that the dev/Pro app itself lacks. The documentation describes this as deliberate (core-and-extensions.md), but the divergence is a drift risk.

**Evidence:**

- main/tools/scripts/starter/feature.ts:1266-1340 patches routes.tsx, AppLeftMenu.tsx and starterSurface.ts by string anchors; :1269 emits `lazy(async () => …)` instead of the current lazyPage() (no stale-chunk reload); it does not register command-palette, dashboard, HINT_MAP, i18n or persistence policy
- main/tools/scripts/starter/prune-manifests-features.ts:343-455,1183-1292,1423-1443 anchor into routes.tsx, capabilities.ts, starterSurface.ts, AppLeftMenu(.test).tsx, command-palette/data/commands(.test).ts, adminSurface.ts, admin barrels, demo/api-routes/routeCoverage.ts
- main/editions/core/main/apps/web/src/app/{routes.tsx,capabilities.ts,layouts/AppLayout.tsx,layouts/index.ts}.template and extensions/{index,types}.ts.template: a separate 110-line route table with an extension host
- main/tools/features/manifest.ts:86 WEB_REGISTRY = main/apps/web/src/extensions/installed.tsx, which does not exist in the dev/Pro web app (no src/extensions; the dev routes.tsx has no extension routes)
- Every file carries a '// main/apps/web/src/…' path header (CI-gated per docs/DIRECTION.md principle 7), so moves need header rewrites

**Direction.** Make the feature manifest the integration point so the scaffolder, pruner and edition exporter add or remove manifest entries or files instead of patching code. Have the dev/Pro app use the same extension-host contract as Core (packs register through the manifest), so there is one composition model.

##### WEB-20. rust-access is a separate SPA (another product's slice) living inside features/

- **Area:** main/apps/web (React app)
- **Category:** other
- **Severity:** low
- **Intentional?** yes (deliberate/documented)

**Description.** It is live only as a dev entry at http://127.0.0.1:5178/rust.html for apps/server-rust (login, register, session, logout, revoke-all). It is deliberate and documented, but it sits in the wrong place: it is not a web feature and it shares nothing with the SPA.

**Evidence:**

- main/apps/web/rust.html, vite.rust.config.ts (port 5178, proxy /api/rust -> 127.0.0.1:8088), playwright.rust.config.ts, tests/rust-access.e2e.spec.ts
- main/apps/web/src/features/rust-access/index.tsx calls createRoot itself; not referenced by app/routes.tsx
- docs/dev/rust-backend.md describes it as the opt-in local access slice of the Kanu Rust backend; no package.json script; own CI .github/workflows/rust-backend.yml; excluded from editions in main/tools/scripts/editions/export.ts:118-121; own eslint block at eslint.config.ts:859
- rust-access.css 418 lines; does not use @bslt/ui by design

**Direction.** Move it out of features/ (for example main/apps/server-rust/web or main/apps/rust-access-web) with its own package. In the creator-platform fork, delete it along with server-rust unless that backend is adopted.

##### WEB-21. 'content' is really legal documents; the legal UI is spread over four places

- **Area:** main/apps/web (React app)
- **Category:** naming-inconsistency
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The content feature is live: /cookies, /acceptable-use and /disclaimer are prerendered and linked from the footer through siteMap. Its generic name will collide with the creator platform's 'content' (posts and media), and operator branding is compiled into the bundle.

**Evidence:**

- features/content/pages/ContentPages.tsx:15-17 imports docs/legal/*.md?raw via 7-level relative paths ('../../../../../../../docs/legal/…')
- pages/LegalDocumentPage.tsx (DB-backed Terms/Privacy) lives outside features/
- features/admin/pages/LegalDocumentsPage.tsx and features/settings/components/LegalDocumentsSection.tsx are the other legal surfaces
- features/content/lib/document.ts:21-24 hard-codes operator facts (COMPANY_NAME 'BSLT', a personal CONTACT_EMAIL, EFFECTIVE_DATE) in source

**Direction.** Rename to features/legal, absorb pages/LegalDocumentPage.tsx, and move operator facts into config or env read by fillDocument. Reserve 'content' for creator content.

##### WEB-22. The dashboard does not act as a hub

- **Area:** main/apps/web (React app)
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The landing surface after login does not show the state of other features, so they feel unconnected.

**Evidence:**

- features/dashboard/pages/DashboardPage.tsx reads only useProfileCompleteness + useSessions (from @settings/hooks) and useAuth
- Static quick-action links at DashboardPage.tsx:178-193 (Tasks, Files, Profile, Settings); no data from tasks, files, notifications, organization, billing or activities

**Direction.** Let features contribute dashboard widgets through the manifest (dashboardTile with its own query), and render them by capability.

##### WEB-23. README and inline docs are stale relative to the code

- **Area:** main/apps/web (React app)
- **Category:** docs
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The docs describe an earlier app.

**Evidence:**

- main/apps/web/README.md: '48 test files passing' (actual 205), 'src/config/index.ts' (actual src/config.ts), routes shown inline in App.tsx (actual app/routes.tsx), '@hooks -> features/auth/hooks', 'notifications/ (empty - future feature)' (10 files), 'ProtectedRoute' listed under features/auth (it is in @bslt/ui), router 'via @bslt/ui' (it is @bslt/react)
- main/apps/web/src/demo/README.md lists a utils/ folder that does not exist
- features/admin/layouts/AdminLayout.tsx:9 says the sidebar mirrors the Settings 'Control Center' menu (settings is now a modal; .control-center-sidebar is used only by AdminLayout)
- features/auth/index.ts comment: useAuthModeNavigation 'should be imported directly from @bslt/ui' (it is in @bslt/react)

**Direction.** Rewrite the README from the manifest and shell structure after the restructure, and generate the route and feature tables from the manifest.

##### WEB-24. Tests are colocated and plentiful, but data hooks and app wiring are the least tested

- **Area:** main/apps/web (React app)
- **Category:** test-topology
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Placement is consistent and worth keeping. Coverage gaps are concentrated in the data and wiring code that the restructure will touch most.

**Evidence:**

- 205 *.test.ts(x) files (~49.3k LOC) colocated next to 274 source files (~48.2k LOC)
- 74 source files lack a colocated test, including features/organization/hooks/{useOrganizations,useMembers,useInvitations,useRoles}.ts, features/tasks/hooks/useTasks.ts, files/hooks/useFiles.ts, media/hooks/useMedia.ts + pages/MediaStudioPage.tsx, status/hooks/useStatusSummary.ts, search/hooks/useSearch.ts, app/capabilities.ts, app/authToken.ts, app/layouts/useAppShellPanes.ts, 11 admin components; main/tools/scripts/audit/test-pairs-debt.json has 86 web entries
- main/apps/web/tests/ holds only rust-access.e2e.spec.ts; product e2e lives in repo tests/e2e/specs (32 specs: auth 12, admin 6, system 6, account 5, billing 1, media 1, notifications 1)

**Direction.** Before moving code, add contract tests for the derived registries (routes, nav and palette all agree with the manifest) and for each domain hook's query-key and persistence metadata. Keep colocated *.test.tsx.

##### WEB-25. Three hand-rolled external stores repeat the same pattern

- **Area:** main/apps/web (React app)
- **Category:** duplication
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** This is small duplication, but app-level UI state (modals, active context) has no single home or naming convention.

**Evidence:**

- features/auth/authModalStore.ts:19-49, features/settings/accountModalStore.ts:31-71, features/organization/activeOrg.ts:15-73 each implement let state + Set<listener> + useSyncExternalStore
- @bslt/react already exports createStore (main/client/react/src/stores) used for toastStore
- Storage keys use mixed namespaces: 'bslt.activeOrgId', 'bslt.consent.v1', 'bslt:browser-device-id', 'app-theme-mode', 'app-pane-config', 'demo-pane-config', 'chunk-reload-at'

**Direction.** Use createStore for UI stores in a platform/ui-state module. Standardize storage keys under one prefix generated from the app name, which also simplifies the fork rename.

#### WEB strengths (preserve)

- Services before React: bootstrap/client.tsx builds QueryCache and AuthService, restores the session and handles HMR disposal before render, behind a single ClientEnvironment context (app/ClientEnvironment.tsx). It is testable and has no provider nesting for services.
- One explicit route table: app/routes.tsx createAppRoutes(options) is a pure function, so it is testable per flag combination. flattenAppRoutes feeds the build-time prerenderer from the same table, avoiding a second route list.
- app/routeLoad.ts lazyPage: named-export code splitting with a one-time reload on stale chunks, a reload-loop cooldown, and pacing so the route fallback does not flicker.
- app/siteMap.ts: one source for public pages, with a type-enforced `live` gate (LiveSitePage) and a test that every live page is routed. This is the pattern to generalize into a feature manifest.
- Cross-user safety: App.tsx useAuthScopedCacheReset, clearUserScopedLocalStorage, runUserScopedResets and registerUserScopedReset (organization/activeOrg.ts) clear the previous user's state on account switch.
- features/admin/adminSurface.ts: a typed admin-surface registry with tier and starter metadata, plus AdminSurfaceId typing on routes. It can be extended for moderation consoles.
- Business rules come from @bslt/shared (for example OrganizationPage.tsx uses canAssignRole, canChangeRole, isSoleOwner and canRemoveMember from @bslt/shared/core/tenant) instead of being reimplemented in components.
- Accessibility basics are wired globally: SkipLink, LiveRegion, RouteFocusAnnouncer and an aria-labelled nav (App.tsx, AppLeftMenu.tsx), and the palette has combobox/listbox semantics.
- Tests are colocated (205 files, about 1:1 LOC with source) using shared helpers in src/**tests**/utils.tsx.
- Demo and dev tools are isolated under src/demo with build-time dead-code elimination of repo docs (demo/home/data/docsMeta.ts DEV_TOOLS_BUILD).
- Comments explain why decisions were made (route ordering, the prerender/hydration choice, the splash contract, the persistence policy). This should be kept through the restructure.
- Guardrail audits exist and should be kept and extended: web-feature-surfaces, i18n-completeness, colocated-test-pairs, starter-defaults and anchor-checked prune manifests that fail loudly on drift.

#### WEB inventory

| Path                                                                             | Purpose                                                                                                                                                                                                                                                                                                                                                                                                     | Size                                | Notes                                                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| main/apps/web/src/app                                                            | Composition root and service locator: App.tsx (providers, route renderer, ToS, persistence), routes.tsx (route table), capabilities.ts (build-time gates), siteMap.ts, starterSurface.ts, routeLoad.ts, authToken.ts, tosHandler.ts, queryPersistencePolicy.ts, layouts/ (AppLayout, AppTopLayout, AppLeftMenu, AppMainLayout, AppFooter, AppBottomLayout, panes), components/ (NetworkStatus + re-exports) | 25 files / 2,786 LOC non-test       | Imported by 75 feature files (authToken, ClientEnvironment, capabilities)                                        |
| main/apps/web/src/bootstrap                                                      | client.tsx environment creation and boot; splash.ts; generated/profile.generated.ts (profile capabilities from tools/scripts/profiles/apply.ts)                                                                                                                                                                                                                                                             | 3 files / 466 LOC                   |                                                                                                                  |
| main/apps/web/src/features/admin                                                 | Admin console: 19 pages, 26 hooks, 24 components, AdminLayout, adminSurface registry, statusTone util                                                                                                                                                                                                                                                                                                       | 78 src / 48 tests / 12,649 LOC      | Starter surfaces health/users/support; others behind VITE_ENABLE_ADVANCED_ADMIN; mixes manual and query fetching |
| main/apps/web/src/features/settings                                              | Account modal (profile, security, sessions, notifications, theme, account, data controls, API keys, legal), consent banner, hooks                                                                                                                                                                                                                                                                           | 53 src / 39 tests / 8,642 LOC       | Route stubs /settings, /settings/:tab, /profile open the modal; billing is a separate page                       |
| main/apps/web/src/features/auth                                                  | AuthService (837 LOC), useAuth, auth modal plus route stubs, forms (login/register/OTP/magic link/SMS/passkey/Turnstile), email-change and reactivation pages, ConnectedAccountsPage                                                                                                                                                                                                                        | 38 src / 24 tests / 5,576 LOC       | services/ is the sanctioned exception; useAuthMutations.ts dead                                                  |
| main/apps/web/src/features/organization                                          | OrgSwitcher, OrganizationPage (members, invitations, roles, settings), AcceptInvitationPage, workspaceClient, activeOrg store                                                                                                                                                                                                                                                                               | 17 src / 6 tests / 2,261 LOC        | VITE_ENABLE_TEAMS; /organization not linked from nav                                                             |
| main/apps/web/src/features/billing                                               | Pricing, BillingSettings (/settings/billing), checkout success/cancel, BillingUnavailable, Stripe card forms, client-side DEFAULT_PRICING_PLANS fallback                                                                                                                                                                                                                                                    | 10 src / 7 tests / 1,688 LOC        | VITE_ENABLE_BILLING; hooks come from @bslt/react billing                                                         |
| main/apps/web/src/features/notifications                                         | NotificationBell and dropdown in the top bar, useNotifications (realtime via lib/realtime.ts), preferences, push subscription, getNotificationRoute                                                                                                                                                                                                                                                         | 10 src / 6 tests / 1,027 LOC        | No notifications page; always on for signed-in users                                                             |
| main/apps/web/src/features/command-palette                                       | Global Ctrl/Cmd+K palette mounted in App.tsx; hard-coded nav and theme commands                                                                                                                                                                                                                                                                                                                             | 7 src / 3 tests / 638 LOC           | Live; separate nav registry; shown to signed-out users                                                           |
| main/apps/web/src/features/media                                                 | Media Studio (upload, stream, probe, transform) with its own fetch client                                                                                                                                                                                                                                                                                                                                   | 6 src / 1 test / 630 LOC            | Gated by profile capability 'media' (off in starter)                                                             |
| main/apps/web/src/features/files                                                 | Files page (list, upload, signed download, delete) via @bslt/api                                                                                                                                                                                                                                                                                                                                            | 5 src / 1 test / 410 LOC            | Scaffold-style with FEATURE.md                                                                                   |
| main/apps/web/src/features/rust-access                                           | Standalone React entry (rust.html) for the apps/server-rust /api/rust/auth slice                                                                                                                                                                                                                                                                                                                            | 3 src / 2 tests / 399 LOC + 418 CSS | Not routed in the SPA; dev-only on port 5178; excluded from editions; Kanu-specific per docs/dev/rust-backend.md |
| main/apps/web/src/features/dashboard                                             | Post-login dashboard (profile completeness, sessions, quick links)                                                                                                                                                                                                                                                                                                                                          | 3 src / 1 test / 339 LOC            |                                                                                                                  |
| main/apps/web/src/features/support                                               | Public /support contact form plus support-inbox hooks used by admin                                                                                                                                                                                                                                                                                                                                         | 7 src / 3 tests / 291 LOC           |                                                                                                                  |
| main/apps/web/src/features/tasks                                                 | Scaffolded first product feature (/tasks) generated by starter:feature                                                                                                                                                                                                                                                                                                                                      | 5 src / 1 test / 287 LOC            |                                                                                                                  |
| main/apps/web/src/features/activities                                            | Activity feed page and component                                                                                                                                                                                                                                                                                                                                                                            | 7 src / 3 tests / 261 LOC           | VITE_ENABLE_ACTIVITY_FEED                                                                                        |
| main/apps/web/src/features/status                                                | Public /status page (component health and incidents) from GET /api/status                                                                                                                                                                                                                                                                                                                                   | 5 src / 1 test / 223 LOC            | Live; in siteMap/footer; prerendered                                                                             |
| main/apps/web/src/features/search                                                | Admin-only /search results page and hook (wrapped by AdminLayout)                                                                                                                                                                                                                                                                                                                                           | 3 src / 1 test / 205 LOC            |                                                                                                                  |
| main/apps/web/src/features/content                                               | File-owned legal pages (/cookies, /acceptable-use, /disclaimer) rendered from docs/legal/*.md?raw                                                                                                                                                                                                                                                                                                           | 7 src / 3 tests / 149 LOC           | Live; misnamed (legal)                                                                                           |
| main/apps/web/src/features/profile                                               | Two profile query keys used by settings                                                                                                                                                                                                                                                                                                                                                                     | 2 src / 5 LOC                       | Vestigial                                                                                                        |
| main/apps/web/src/features/index.ts                                              | Root feature barrel marked auto-generated                                                                                                                                                                                                                                                                                                                                                                   | 5 LOC                               | No generator, no consumers                                                                                       |
| main/apps/web/src/pages                                                          | Standalone pages: LandingPage, LegalDocumentPage (DB-backed Terms/Privacy), NotFound, Forbidden, Unavailable, EmailUnsubscribe                                                                                                                                                                                                                                                                              | 6 files / 461 LOC                   |                                                                                                                  |
| main/apps/web/src/demo                                                           | Dev tools: home/docs viewer (/clean), UI library (/ui-library, /side-peek-ui-library), API route inspector (/developer/api-routes)                                                                                                                                                                                                                                                                          | 31 files / 4,696 LOC                | Gated by DEV or VITE_ENABLE_DEV_TOOLS                                                                            |
| main/apps/web/src/i18n                                                           | I18nProvider, hooks, formatters, 9 locale maps (~57 keys)                                                                                                                                                                                                                                                                                                                                                   | 15 files / 1,665 LOC                | t() used in 1 component                                                                                          |
| main/apps/web/src/lib                                                            | sentry.ts (388), consent/ (model, store, gate), realtime.ts (WebSocket subscriptions used by notifications)                                                                                                                                                                                                                                                                                                 | 6 files / 1,092 LOC                 |                                                                                                                  |
| main/apps/web/src/ssr + entry-server.tsx + scripts/prerender.ts                  | Build-time prerender of live siteMap pages (no runtime SSR)                                                                                                                                                                                                                                                                                                                                                 | ~560 LOC                            |                                                                                                                  |
| main/apps/web/{tsconfig.json,tsconfig.lint.json,vite.config.ts,vitest.config.ts} | Build, test and alias config (4 alias tables)                                                                                                                                                                                                                                                                                                                                                               |                                     | Conflicting @components/@layouts mappings                                                                        |
| main/apps/web/{rust.html,vite.rust.config.ts,playwright.rust.config.ts,tests/}   | Opt-in rust-access entry and its e2e test                                                                                                                                                                                                                                                                                                                                                                   |                                     | Separate CI workflow                                                                                             |
| main/editions/core/main/apps/web/src/**/*.template                               | Core edition replacements for routes.tsx, capabilities.ts, AppLayout, layouts/index, LandingPage, sentry, plus extensions host                                                                                                                                                                                                                                                                              |                                     | Second copy of the composition model (dependency, outside this area)                                             |

#### WEB wiring points

- `main/apps/web/src/app/routes.tsx`: Every route: lazyPage consts, gated builders (product/billing/teams/activity/advancedAuth/devTools/admin starter+advanced), protected/publicOnly flags, adminSurface ids, route ordering constraints (billing before settings/:tab)
- `main/apps/web/src/app/capabilities.ts`: Build-time gates isBillingEnabled/isTeamsEnabled/isActivityFeedEnabled/isAdvancedAdminEnabled/isAdvancedAuthEnabled/isDeveloperTools/ChromeEnabled + isMediaEnabled (profile)
- `main/apps/web/src/bootstrap/generated/profile.generated.ts`: Generated profile capability set (starter: comms, core, db, system) used for media routes and service-worker registration
- `main/apps/web/src/app/layouts/AppLeftMenu.tsx`: Primary nav: PUBLIC/DEVELOPER/AUTH/PRODUCT/SETTINGS/ADMIN link lists + HINT_MAP FeatureHint copy + per-flag pushes
- `main/apps/web/src/app/layouts/AppTopLayout.tsx`: Header: admin-only search box, OrgSwitcher (teams), NotificationBell/Dropdown, account menu items opening AccountModal sections
- `main/apps/web/src/features/command-palette/data/commands.ts`: Palette navigation and action commands (separate nav list, flag- and role-aware)
- `main/apps/web/src/features/dashboard/pages/DashboardPage.tsx`: Dashboard quick-action links and metric-card hrefs
- `main/apps/web/src/features/admin/adminSurface.ts`: Admin surface ids, labels, hrefs, routePaths, tier and starter flags (admin sidebar)
- `main/apps/web/src/app/siteMap.ts`: Public pages for the footer and prerenderer (live-gated), sections, product tagline
- `main/apps/web/src/app/starterSurface.ts`: Starter route and admin-surface lists asserted by routes.test.ts and patched by starter:feature
- `main/apps/web/src/features/settings/settingsTabs.ts + accountModalStore.ts + components/AccountModal.tsx`: Settings section ids, aliases, nav items, modal sections and the section render switch
- `main/apps/web/src/features/notifications/utils/getNotificationRoute.ts`: Notification action/type to route mapping
- `main/apps/web/src/app/queryPersistencePolicy.ts`: Query-key heads excluded from IndexedDB persistence
- `main/apps/web/src/app/App.tsx`: Global providers and always-mounted overlays (Toaster, NetworkStatus, CommandPalette, CookieConsentBanner, TosAcceptanceModal)
- `main/apps/web/src/app/layouts/AppLayout.tsx`: Shell-mounted overlays: AuthModal, AccountModal, NewDeviceBanner, ImpersonationBanner, SidePeek UI library (dev)
- `main/apps/web/src/i18n/locales/*.ts`: Translation keys (9 locales; parity enforced by tools/scripts/audit/i18n-completeness.ts)
- `main/apps/web/{tsconfig.json,tsconfig.lint.json,vite.config.ts,vitest.config.ts}`: Path aliases (four separate tables)
- `main/tools/scripts/starter/feature.ts`: Scaffold patches into routes.tsx, AppLeftMenu.tsx, starterSurface.ts (plus shared/server/api registrations)
- `main/tools/scripts/starter/prune-manifests-features.ts`: String-anchor removals in routes.tsx, capabilities.ts, starterSurface.ts, AppLeftMenu(.test).tsx, commands(.test).ts, adminSurface.ts, admin barrels, demo routeCoverage
- `main/editions/core/main/apps/web/src/app/*.template + extensions/*.template`: Core edition route table, shell and extension host (featureRoutes/featureNavigation from installed packs)
- `main/tools/features/manifest.ts:86`: Feature-pack web registry target main/apps/web/src/extensions/installed.tsx (absent in the dev/Pro app)

#### WEB creator-platform notes

- Build the feature manifest first. Subscriptions, pay-per-view, live tipping, payouts, moderation and age verification each need route, nav, palette, dashboard tile, settings section, admin/moderation surface, notification deep links and gates. Today that is about 10 hand edits per feature, done with string-anchored tooling.
- Route metadata needs `requires` (auth, role such as creator/moderator/admin, capability, and viewer eligibility such as age-verified or SFW-only). The current AppRoute has only protected/publicOnly, and role checks are ad hoc (AdminLayout string compare vs isAdmin elsewhere).
- Content-rating separation is enforced at the data layer, but the UI still needs an app-level viewer-eligibility context (age verification state, content filter preference). Put it in the same runtime CapabilityContext proposed for flags so every query and route reads one source.
- Switch query persistence to an allowlist before adding paywalled media URLs, payout or KYC data and moderation queues. With the current denylist, all of these would be written to IndexedDB for 24h by default.
- Media is the core loop. Converge Files, Media Studio and avatar upload into one media library over one @bslt/api client, and either adopt the unused @bslt/ui MediaGallery or delete it. Media is currently gated by the profile 'media' capability, which is off in starter.
- Live-first needs real realtime wiring. lib/realtime.ts is a thin WebSocket helper used only by notifications, and server realtime is an optional profile package. Plan a platform-level realtime channel registry (tips, live chat, presence) next to the api registry.
- Generalize the active-org context into an 'acting-as' context (viewer vs creator X) injected into all clients and query keys. Today only the workspace client receives a tenant header.
- Rename features/content to features/legal now. 'content' should mean creator posts and media in the fork.
- Shells: the current IDE-style resizable shell does not fit a consumer creator product. Plan separate shells (public creator profiles and landing, viewer feed and live player, creator studio, moderation/admin console). Keep resizable panes only for the console.
- Billing UI is subscription and Stripe-Elements centric (BillingSettingsPage 708 LOC, client-side DEFAULT_PRICING_PLANS fallback). PPV unlocks, tips and creator payouts (including crypto) are new surfaces. Design them as manifest-registered features rather than extending BillingSettingsPage.
- The admin feature is the natural base for moderation. adminSurface.ts is a good registry to extend, but normalize admin hooks onto the query layer first (5 admin hooks still fetch manually).
- Fork cleanup is simple in this area: delete features/rust-access with rust.html and the vite/playwright rust configs, delete demo/ if unwanted (README says it is safe), and rename the brand in index.html, public/manifest.json, siteMap PRODUCT_TAGLINE, content OPERATOR and storage-key prefixes.
- Decide on i18n before building creator UI. Either wire it through manifest namespaces now or remove the unused locale maps, so new creator features do not add more hard-coded strings beside unused key files.

#### WEB open questions

- Is the four-pane resizable shell (top/left/right/bottom percentages persisted in localStorage) meant to be product UI, or developer chrome that leaked into the default shell?
- Should feature packs (main/extensions/*) be installable into the dev/Pro web app? Today only the Core edition templates contain an extension host, and tools/features/manifest.ts targets main/apps/web/src/extensions/installed.tsx, which does not exist here.
- Should capability gating move from build-time VITE_ENABLE_* flags to a server-provided runtime capabilities endpoint, so web and server cannot disagree (for example VITE_ENABLE_BILLING vs server billing config)?
- Should i18n be wired across the UI or reduced to en-US? The CI gate enforces parity on keys only one component renders.
- Should rust-access stay in this repo at all, given docs/dev/rust-backend.md describes Kanu as a separate product? If so, where should its web entry live?
- Is the service-worker registration gate on the 'workers' capability (bootstrap/client.tsx:124) intended to also disable Web Push? The push-subscription UI in NotificationPreferencesForm is not gated the same way. Not verified at runtime.
- Should end-user search be re-enabled for the creator platform (creator discovery)? /search is admin-only and wrapped in AdminLayout.
- Which layer should own domain hooks and domain components going forward: @bslt/react / @bslt/ui, or the web feature? The answer differs by domain today.
- Should /admin/billing/plans also require VITE_ENABLE_BILLING? It is currently gated only by VITE_ENABLE_ADVANCED_ADMIN.

### B.CLI. Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web

**Summary.** The four client packages form a strict DAG ([api, client-engine] → react → ui → apps/web), but the responsibilities inside it are blurred, and domain logic is spread across all four packages plus apps/web.

- **@bslt/api (5.4k LOC).** 19 hand-written `create*Client` factories with about 190 request call sites and roughly 390 literal path strings. `createApiClient` in `api/client.ts` (1,088 lines) is a catch-all, and it repeats endpoints that domain clients also expose, with weaker types.
- **The "generated client" is not a typed client.** It is a route-manifest list plus an untyped `request(): Promise<unknown>`. Only the dev route explorer and `EmailUnsubscribePage` use it. The 214 schema-bearing endpoint contracts in `main/shared/src/contracts` (aggregated as `apiRouter`) are read only by tooling, never by the browser client. Hooks codegen is retired.
- **React hooks are written by hand and split two ways.** 26 domain hooks live in @bslt/react (billing, devices, legal, oauth, phone, webhooks). 59 hook files live in `apps/web/features/*/hooks`. Most of those build a fresh client inside every `queryFn` with `getToken: getAccessToken` (63 files import it).
- **@bslt/react (8.3k LOC)** mixes four things: a custom router, a TanStack-like query layer, about 35 generic hooks (12 have zero consumers), and the domain hooks above.
- **@bslt/client-engine (1.8k LOC)** is framework-agnostic browser machinery: a 643-line QueryCache, IndexedDB and a query persister, user-scoped storage, density/high-contrast CSS-variable maps, and a key-binding parser. Its README still describes modules that were removed long ago.
- **@bslt/ui (11.3k TS + 6.1k CSS)** has 89 component files: 29 elements, 45 components, 15 layouts. Styling is plain CSS with about 92 `--ui-*` tokens generated from TypeScript sources, plus a hand-written Tailwind-like utility layer (222 classes).
- **ui also carries domain code.** That includes 10 SaaS billing components (about 900 CSS lines), session/device/profile cards, status badges that import `@bslt/shared/core/*`, `ProtectedRoute`, and a media gallery. Meanwhile apps/web builds its own app shell, page-level BEM stylesheets and re-export shims instead of using the ui shells.
- **Theming is spread across ui, react and engine.** Accessibility basics are solid, but `--ui-color-border` fails WCAG 1.4.11 in both light and dark mode, and the radio control actually uses it.
- **There are four separate token vocabularies:** `--ui-*`, the storefront's own variables, rust-access `--access-*`, and the extensions' undefined `--ui-space-*`.
- **The /ui-library dev page** catalogues about 55 of the 89 components, uses a taxonomy that contradicts the package's own, and has a key collision that silently drops one demo.
- **There is no first-class realtime client.** It is an invalidation-only module at `apps/web/src/lib/realtime.ts`.
- **The visual language is monochrome SaaS:** primary equals accent equals near-black or near-white. There is no icon system, display typography, elevation or z-index scale. Nothing exists for media, feeds, paywalls, money or live UI that a consumer creator platform needs.

#### Findings

##### CLI-01. API 'codegen' is a route-manifest stub; 214 shared endpoint contracts never reach the browser client

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The repo already has a schema-bearing contract layer: method, path, body, query and per-status responses, built on its own zero-dependency Schema library. The client ignores it. Paths, types and validation are re-typed by hand in 19 factories. The so-called generated client only provides path autocompletion. It bypasses the CSRF, bearer-token, tenant-header and refresh-on-401 logic that `utils.ts` provides, so even the one product page using it (email unsubscribe) gets a weaker transport. This is the root cause of contract drift (the api-contract-matrix lists PARTIAL_RUNTIME/TYPE_ONLY rows). It is accidental: the docs state the opposite intent.

**Evidence:**

- main/tools/scripts/api/generate-client.ts:28-138 emits only {method,path,module,public} rows plus request<P>(): Promise<unknown>; no body/response types, no auth/CSRF/tenant headers, throws plain Error
- main/client/api/src/generated/client.ts: 185 route rows; consumers are only main/apps/web/src/demo/api-routes/pages/ApiRoutesPage.tsx:5 and main/apps/web/src/pages/EmailUnsubscribePage.tsx:39-56 (which casts path `as GeneratedApiPath`)
- main/tools/scripts/api/generate-hooks.ts:1-29 is 'retired' and only deletes generated/hooks.ts
- main/shared/src/contracts/contract.*.ts (26 files, 214 `method:` entries) + main/shared/src/api/router.ts `apiRouter`: importers are only tools (audit/route-contract-coverage.ts, audit/api-response-sync.ts, docs/generate-api-docs.ts, starter/feature.ts); main/client/api imports contracts only for 2 types (search/client.ts:11, status/client.ts:11)
- main/client/api/src: ~390 literal '/...' path strings; ~190 request call sites across 19 create*Client factories
- Response-schema validation present only in api/client.ts, billing/*, notifications, webhooks, devices, phone; absent in admin/client.ts (34 calls), workspace/client.ts (21), settings/client.ts (13), tasks, support, legal, api-keys, activities, analytics, search, status
- api/client.ts declares 10 methods returning Promise<Record<string, unknown>> (lines 170-174 etc.)
- Intent documented but unrealized: docs/architecture/api-contract-standard.md 'Rules Going Forward' #3-#5 (client parses with shared schemas; paths derived from contract constants); docs/specs/principles.md:297 claims 'Generated React hooks live in main/client/api/src/generated/hooks.ts'; docs/DIRECTION.md:254 marks 'API client + React hooks codegen' as done
- `pnpm api:check` (package.json:61) is not in ci:merge-gate, ci:fast or audit:template

**Direction.** Make the contract the single source and generate the client from it.

1. Generate a typed SDK from `apiRouter`: one function per endpoint, with path params, body and query typed from the schemas, and the response parsed with the 2xx schema. Route it through `createRequestFactory` so CSRF, auth, tenant and refresh are handled once.
2. Emit per-domain query-key factories and thin `useX`/`useXMutation` wrappers over the @bslt/react query layer.
3. Delete the route-manifest client and retire the hand-written factories domain by domain, starting with admin, workspace and settings, which have no validation today.
4. Wire `api:check` into ci:merge-gate.
5. Require that new creator-platform domains (subscriptions, PPV, tips, payouts, live, moderation, age verification) exist only as contracts plus generated client code.

##### CLI-02. Every data hook hand-wires its own client: no single SDK instance, two DI styles, ad hoc query keys

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** wiring-sprawl
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** No single composed client object (SDK) exists. Each hook rebuilds transport configuration, so cross-cutting concerns (tenant switching, impersonation, age-gate or ToS interception, device id) have to be threaded through dozens of call sites or through process-wide globals like `setDefaultOnUnauthorized`. Cache invalidation across domains, such as a tip updating both a wallet and a creator's earnings, has no shared key space.

**Evidence:**

- createAdminApiClient( called inside queryFn in 20+ files under main/apps/web/src/features/admin/hooks/ (e.g. useAdminHealth.ts:43-47 builds a new client on every fetch)
- getAccessToken imported in 63 non-test web files (`grep -rl getAccessToken main/apps/web/src`)
- useClientEnvironment() used in 51 web files (main/apps/web/src/app/ClientEnvironment.tsx exposes only {config, queryCache, auth})
- @bslt/react domain hooks take a `clientConfig` prop instead (main/client/react/src/devices/hooks.ts:30-51); pages build it with useMemo (features/billing/pages/BillingSettingsPage.tsx:78, PricingPage.tsx:75, admin/pages/LegalDocumentsPage.tsx:60, NotificationSenderPage.tsx:74)
- Query keys: 28 inline literal arrays in web features (e.g. ['adminHealth']) vs factory objects (react/src/devices/hooks.ts devicesQueryKeys, apps/web/src/features/organization/hooks/queryKeys.ts, apps/web/src/features/profile/queryKeys.ts)
- main/client/api/src/utils.ts:83-95 comment: 'each of the ~50 feature clients having to wire the hook individually'

**Direction.** Put one `sdk` (the generated client above) into ClientEnvironment, built once in `bootstrap/client.tsx` from config, auth and the active tenant. Hooks then read `useSdk()`. Generate query-key factories per domain under a shared root namespace so cross-domain invalidation is declarative. Retire the `clientConfig` prop pattern in @bslt/react.

##### CLI-03. Domain hooks split between @bslt/react and apps/web with no placement rule

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** A developer cannot predict where a domain's data layer lives. The editions/prune tooling also has to know this split (core-and-extensions.md:105 'Core removes ... React billing/webhook helpers'). This is the client-side shape of the 'not linked together' complaint: api client, hooks, UI components and pages for one domain sit in 3-4 packages.

**Evidence:**

- @bslt/react domain modules: billing (useAdminPlans, usePlans, useSubscription, useUsage, useInvoices, useInvoice, usePaymentMethods, useProrationPreview — main/client/react/src/billing/hooks.ts 757 lines, admin.ts 159), devices, legal, oauth (403 lines), phone, webhooks (330 lines): 26 hooks total
- main/apps/web/src/features/*/hooks: 59 hook files (admin 24, settings 13, organization 5, support 3, notifications 3, auth 3, media 2, others 1 each)
- Admin billing hooks live in react/src/billing/admin.ts while all other admin hooks live in apps/web/src/features/admin/hooks/
- apps/web/src/features/billing has no hooks dir (depends on @bslt/react) while apps/web/src/features/notifications/hooks owns its own
- docs/specs/principles.md:288 says 'React hook for API → main/client/react/', which 59 web hook files contradict

**Direction.** Adopt feature slices. A domain's generated client, its hooks, and its domain components should live together, either as `main/features/<domain>/{contract,client,hooks,ui}` or as `apps/web/src/features/<domain>` consuming only generated SDK code. @bslt/react keeps only domain-agnostic machinery: router, query layer, generic hooks. Under this rule, creator-platform domains are added as slices and the SaaS billing slice can be pruned in the fork.

##### CLI-04. Design-system package carries SaaS-domain components; app wraps them with shims, and a third billing UI exists

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** layering-violation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The documented hierarchy (principles.md:68-72) is about primitives, yet @bslt/ui is half design system and half SaaS feature library. This couples the design system to billing, admin and auth schemas: changing a billing schema forces a UI-package release. The pruner cannot remove billing cleanly (billing is documented as 'entangled', docs/CLAUDE.md:110). The billing feature ends up with three presentation layers.

**Evidence:**

- main/client/ui/src/components/billing/*: 10 components (InvoiceRow 278, PlanChangeDialog 225, TenantUsageOverrideEditor 240, PricingTable 221, SubscriptionStatus 220, UsageDashboard 207, PlanCard 168, UsageSummary 151, PaymentMethodCard 147, UsageBar 100 lines); 12 imports of @bslt/shared/core/billing
- main/client/ui/src/styles/components.css lines ~216-349 and ~1235-2011 (~900 of 2,109 lines) are billing selectors (plan-card 21, tenant-usage 21, usage-dashboard 19, plan-change 19, payment-method 13, pricing-table 12...)
- Domain cards in ui: SessionCard.tsx (imports shared/system/http parseUserAgent), DeviceRowCard.tsx, ProfileCompletenessCard.tsx, StatusBadge.tsx/RoleBadge.tsx (shared/core/admin), JobStatusBadge.tsx (shared/core/jobs), PasswordInput.tsx (shared/core/auth), AuthForm.tsx (exports AuthFormLayout), OAuthButton, layouts/layers/ProtectedRoute.tsx (imports @bslt/react/router)
- Re-export shim: main/apps/web/src/features/settings/components/SessionCard.tsx is one line re-exporting @bslt/ui/components; ProfileCompleteness.tsx wraps ProfileCompletenessCard
- Same pattern implemented in the app instead: main/apps/web/src/features/admin/components/WebhookStatusBadge.tsx
- Unused in product: UsageDashboard, TenantUsageOverrideEditor, InvoiceRow (only InvoiceList), MediaGallery (519 lines, 26 inline styles) — 0 imports in apps/web outside demo
- Third billing UI: main/extensions/billing/src/web/index.tsx.template (446 lines) builds its own billing page from primitives instead of the ui billing components

**Direction.** Split @bslt/ui into two layers.

- **Domain-agnostic DS:** primitives, patterns and layouts, with no imports from `@bslt/shared/core/*`.
- **Domain UI:** moves into feature slices, e.g. `features/billing/ui`, `features/account/ui`.

Also:

- Replace StatusBadge/RoleBadge/JobStatusBadge/WebhookStatusBadge with one generic `<StatusBadge tone label>` and a per-domain mapping.
- Move `ProtectedRoute` to the router layer.
- Delete the re-export shims.
- Have extension templates reuse slice components instead of reimplementing them.

##### CLI-05. Two app-shell implementations; ui shells are unused and their CSS namespaces collide with the web shell

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** duplication
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The design system ships a shell that nobody uses. The real shell lives in the app as bespoke components and CSS that share the DS class prefix, and the DS stylesheet reaches into app classes. A redesign has to reconcile both. For a creator platform with distinct shells (fan feed, creator studio, live room, admin), today's mix of a single hard-coded app shell and unused DS shells is the wrong base.

**Evidence:**

- ui shells AppShell (291 lines), TopbarLayout, LeftSidebarLayout, RightSidebarLayout, BottombarLayout, StackedLayout: 0 product imports in apps/web (only demo/ui-library catalog)
- Web hand-builds its shell: main/apps/web/src/app/layouts/AppLayout.tsx, AppTopLayout, AppLeftLayout, AppRightLayout, AppBottomLayout, AppMainLayout, AppLeftMenu, useAppShellPanes.ts + AppShell.css (326 lines), using only ResizablePanel/ScrollArea/IconButton from ui
- Class prefix collision: main/client/ui/src/styles/layouts.css:7-71 defines .app-shell, .app-shell-header/-body/-sidebar/-main/-content/-aside/-footer; main/apps/web/src/app/layouts/AppShell.css:42-180 defines .app-shell-viewport/-top-panel/-main-frame/-layout-rail/-side-panel and .app-main-content
- Inversion: ui layouts.css:342-353 styles `.app-main-content .auth-layout`, a class owned by the web app

**Direction.** Pick one shell primitive set in the DS: a slot-based `AppFrame` with top bar, rail, main, aside, bottom nav, and resizable panes. Rebuild the web shell(s) on it as named layouts (FanLayout, StudioLayout, LiveLayout, AdminLayout). Delete the unused shell variants, and remove app-class knowledge from `ui/styles/layouts.css`.

##### CLI-06. Overlapping components inside @bslt/ui (two modal systems, three toast pieces, several loading/error wrappers)

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Duplicate primitives drift apart in focus handling, sizing and ARIA. Product code has already settled on Modal, Toaster and PageContainer, which leaves the alternatives as maintenance-only surface.

**Evidence:**

- Modal: main/client/ui/src/layouts/layers/Modal.tsx (246 lines; portal + FocusTrap + Overlay + context; used in 18 web files) vs Dialog: main/client/ui/src/components/Dialog.tsx (315 lines; portal + FocusTrap + controllable state + context; used in 5)
- Toast (components/Toast.tsx, unused in web) + ToastContainer (components/Toast.tsx:90) + Toaster (elements/Toaster.tsx, wraps ToastContainer; used once in app/App.tsx:74); toast state lives in react/src/stores/toastStore.ts
- Loading: Spinner, Skeleton, LoadingContainer, DelayedFallback (0 product uses), CardAsyncState
- Errors: ErrorBoundary vs SectionErrorBoundary (1 product use)
- Containers: Card vs TitledCardSection; Box (0 product uses) vs Container (0) vs PageContainer (36) vs StackedLayout (0)
- Menus: Dropdown + MenuItem vs Popover (0 product uses) vs Select (custom listbox)

**Direction.** Consolidate. Keep one overlay engine: Dialog with modal and non-modal modes, and Sheet/Drawer variants built on the same core. Keep one toast API (store plus Toaster). Keep one AsyncBoundary pattern that combines loading, empty and error. Keep one surface primitive (Card with slots) and one layout pair (Stack/Inline). Track removals in the ui-library catalog.

##### CLI-07. Theme ownership split across ui, react and engine; magic storage keys; high-contrast palette outside the token source

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Changing the palette or adding a brand theme, such as per-creator accent colours, means editing three packages. The high-contrast palette can drift from the main palette because it is not generated from the same source, and three magic strings have to be kept in sync by comments.

**Evidence:**

- Tokens (colors/spacing/typography/radius/motion/breakpoints): main/client/ui/src/theme/*.ts → generated main/client/ui/src/styles/theme.css via main/tools/sync/sync-css-theme.ts (turbo build:theme)
- Mode/density/contrast hooks: main/client/react/src/hooks/useThemeMode.ts, useDensity.ts, useContrast.ts; composed by main/client/ui/src/theme/provider.tsx (imports them via the @hooks alias)
- CSS-var payloads: main/client/engine/src/theme/contrast.ts:18-61 hard-codes 14 high-contrast hex values per theme outside colors.ts; density.ts; re-exported again by main/client/react/src/theme/index.ts
- Storage key 'app-theme-mode' duplicated in main/apps/web/src/app/App.tsx:404-408, src/ssr/ServerApp.tsx:127-131 and public/theme-init.js:24, while the ThemeProvider default is 'theme-mode'
- theme.css re-emits all 92 tokens in 4 blocks (:root, [data-theme=light], [data-theme=dark], prefers-color-scheme) — 47 theme-invariant tokens repeated 4×

**Direction.** Move all theme concerns into one `theme` module inside the DS:

- token sources
- the generated CSS, emitting theme-invariant tokens once and only colour tokens per mode
- high-contrast and density variants derived from the same sources
- ThemeProvider and the mode, density and contrast hooks
- one exported `THEME_STORAGE_KEYS` constant shared by `theme-init.js` and SSR.

Engine then keeps only non-visual machinery.

##### CLI-08. WCAG gaps: hairline border fails 1.4.11 in both modes (and on radio controls), reduced-motion barely honored, DS strings not localizable

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** accessibility
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** A consumer platform with age verification and payments carries regulatory and app-store exposure, so the owner's 'sleekness vs compliance' call (TODO.md) should probably go towards compliance. The radio failure is a concrete bug, not a style choice. Video, live and tip animations will multiply the reduced-motion gap. DS components with baked-in English cannot be localized.

**Evidence:**

- docs/todo/TODO.md:69 — '--ui-color-border is 1.27:1 against the page' (light #e4e4e7 on #ffffff); dark #1f1f22 on #000000 is ~1.28:1 (theme.css:263) and is not mentioned
- Most controls already use --ui-color-border-strong (#85858c ≈3.7:1): input elements.css:722, textarea, checkbox, switch, select — but .radio-circle uses var(--ui-color-border) (main/client/ui/src/styles/components.css:547-556), a genuine control-boundary failure
- --ui-color-border used ~73 times vs border-strong 5 times across ui styles
- prefers-reduced-motion: only components.css:2006 (usage-dashboard); @keyframes ui-skeleton-shimmer (elements.css:935), ui-spinner-rotate (elements.css:955), feature-hint-fade-in (components.css:1224) not guarded; no reduced-motion handling in TS
- Axe gate tests/e2e/specs/system/a11y.e2e.ts fails only on 'critical' impact; 'serious' (where contrast lands) only console.warns; no eslint jsx-a11y plugin
- Hardcoded English in DS: SessionCard.tsx:42,61 ('Current Session','Revoke'), ErrorBoundary.tsx:103-106, PricingTable.tsx:123,178, PlanChangeDialog.tsx:126, UsageDashboard.tsx:111, CardAsyncState.tsx:29; web i18n useTranslation used in only 2 files (apps/web/src/i18n/hooks.ts:71)
- Unguarded @media (prefers-color-scheme: dark) rules in components.css:750, 808, 943 apply dark chevrons/colors even when the user forces data-theme='light'; chevron colors hard-coded as hex inside data-URI SVGs

**Direction.** - Add a semantic token `--ui-color-border-control` (≥3:1) for every control boundary and fix `.radio-circle` now. Keep `--ui-color-border` for decorative separators only.

- Add a global reduced-motion layer: a token-level `--ui-motion-duration-*` override set to 0 under `prefers-reduced-motion`.
- Raise the axe gate to fail on 'serious' and add `eslint-plugin-jsx-a11y`.
- Give DS components label props or a DS-level i18n message provider with defaults.
- Guard component-level dark rules with `:root:not([data-theme])`, or remove them in favour of tokens such as a `--ui-icon-chevron` mask.

##### CLI-09. Styling conventions inconsistent: dual spacing scales, BEM page one-offs overriding DS internals, mixed size vocab, no z-index/elevation tokens

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** ui-consistency
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The token and lint discipline is real: dead classes and undefined tokens are both at zero. However, the authoring model is a hybrid of hand-written Tailwind-style utilities, BEM page sheets and DS class overrides. Each page ends up with its own visual dialect, and DS internals (.btn, .card, .input) have become a de-facto public API that blocks a redesign.

**Evidence:**

- Utilities use a numeric scale mapped to named tokens: main/client/ui/src/styles/utilities.css:124-160 (.gap-1→--ui-gap-xs ... .gap-6→2xl, .gap-8→3xl, .p-12); web uses them heavily (flex 285, gap-2 81, gap-3 73, p-4 45 occurrences) while principles.md:223 says the scale is xs..xl
- Page-level BEM one-offs: features/billing/pages/BillingSettingsPage.css (559 lines, e.g. .billing-settings-page__section-header/__section-title/__surface), features/settings/components/AccountModal.css (730), features/dashboard/pages/DashboardPage.css (.dashboard-card--metric duplicates ui MetricValue+Card)
- Web CSS overriding DS internal classes in 14 places: DashboardPage.css:133 `.dashboard-panel__header .btn`, BillingSettingsPage.css:90 `.billing-settings-page .card`, AccountModal.css:107,295,300 (.card/.input/.btn), AppShell.css:35,102,277
- Size vocab: Button.tsx:12 and IconButton.tsx:12 use 'small'|'medium'|'large'; Kbd, Text, Heading, Container, Modal, SidePeek, DelayedFallback, LoadingContainer use 'sm'|'md'|'lg'; Spinner.tsx:16 size?: string
- className composition: 25 ui files use cn(), 38 use template literals
- z-index: 13 distinct raw values in CSS (1, 2, 10, 20, 40, 50, 999, 1000, 1001, 1002, 9998, 9999, 10000), zero --ui-z-* tokens; only 2 shadow tokens, named --ui-color-shadow/--ui-color-shadow-overlay
- forwardRef used in 53 ui files despite React 19 ref-as-prop
- 169 inline style={{}} across web+ui non-test TSX (92 in demo/ui-library catalogs, 26 in MediaGallery.tsx)

**Direction.** For the redesign, pick one authoring model:

- **Option A:** recipe or variant-based components plus a small layout-primitive set (Stack, Inline, Grid, Cluster, Center, AspectRatio), with utilities limited to layout.
- **Option B:** commit fully to utilities, using one scale named the same as the tokens.

In either case:

- Add `--ui-z-*` and `--ui-elevation-*` scales.
- Normalise size vocab to sm/md/lg everywhere.
- Mandate `cn()`.
- Forbid descendant selectors on DS classes with a stylelint rule in `lint:css`.
- Fold page BEM sheets into DS patterns: PageHeader, Section, Surface, StatTile.

##### CLI-10. Four unrelated token vocabularies (ui, storefront, rust-access, extensions) and lint does not see two of them

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Storefront and rust-access sit outside the editions and are partly intentional: the storefront is a separate static marketing site, and rust-access is an experimental app excluded from both editions per core-and-extensions.md. The extensions case is an accidental bug that silently opts installable packs out of theming.

**Evidence:**

- @bslt/ui: --ui-* (92 tokens, main/client/ui/src/styles/theme.css)
- Storefront: main/apps/storefront/public/styles.css (757 lines) defines --surface, --subtle, --panel, --text, --muted, --border, --accent... with 22 hex literals; static HTML + site.js, no @bslt/ui
- Rust access app: main/apps/web/src/features/rust-access/rust-access.css defines --access-* with 40 hex literals (only web CSS file with hex besides 1 in AppShell.css)
- Extensions: main/extensions/billing/src/web/styles.css.template and account-insights/... use var(--ui-space-4, 1rem)/var(--ui-space-6, 1.5rem) — --ui-space-* does not exist (system is --ui-gap-*), so they always fall back to literals and ignore theming
- main/tools/scripts/lint/lint-undefined-tokens.ts:38,44 STYLE_ROOTS = ['main/apps','main/client'] — main/extensions is out of scope

**Direction.** - Publish the DS tokens as a standalone CSS file (`@bslt/ui/tokens.css`) that static sites can link, and have the storefront alias its variables to `--ui-*`.

- Fix the extension templates to use `--ui-gap-*`, and add `main/extensions` to `STYLE_ROOTS`.
- Decide whether rust-access stays or is removed in the fork.

##### CLI-11. client/engine identity is muddled and its README documents removed modules

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** docs
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** In practice client/engine is the framework-agnostic browser runtime that the React query layer and app bootstrap depend on. Its valuable parts are QueryCache, the IDB persister and user-scoped storage, which clears data when the user switches. Its public README advertises an optimistic, offline, realtime engine that no longer exists, which will mislead anyone planning live features on it.

**Evidence:**

- main/client/engine/README.md describes RecordCache, LoaderCache, WebsocketPubsubClient, TransactionQueue, MutationQueue, UndoRedoStack, search query builder, push-notification client/hooks, RealtimeProvider/useRecord/useWrite — none exist in main/client/engine/src (only query/QueryCache.ts 643, storage/{idb,queryPersister,storage,userScopedStorage}.ts, theme/{contrast,density}.ts, ui/keyboard.ts 213)
- package.json peerDependency react + devDependency react, and src/types/react-shim.d.ts (34 lines declaring a fake 'react' module), but 0 react imports in engine src
- package.json publishConfig {access: public, registry: npmjs} and description 'Client data engine' while it also owns theme CSS-var maps and keyboard parsing
- docs/specs/principles.md:60-64 correctly describes it as 'framework-agnostic browser machinery (IndexedDB, the query cache, theme, key bindings)'

**Direction.** - Rename or reposition it as `@bslt/client-runtime` (query cache, persistence, user-scoped storage, and a future realtime transport).

- Move theme and keyboard code to the DS and the react package.
- Remove the react peer dependency, the shim and `publishConfig`.
- Rewrite the README from the actual exports.
- If live features need optimistic writes, design them fresh against the realtime contract rather than reviving the README.

##### CLI-12. No client realtime package: the only socket client is an app-local invalidation bus with one consumer

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** layering-violation
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** Invalidation-only is a deliberate and documented design that suits polling-backed SaaS data. A live-first creator platform needs presence, chat, tip and gift events, live-room state and viewer counts with payloads, ordering and backpressure. With the socket living in the app shell, there is no reusable, testable package boundary for this.

**Evidence:**

- main/apps/web/src/lib/realtime.ts (261 lines) exports subscribeToKey/InvalidationHandler; header documents it as invalidation-only ('server sends { type: update, key, version } and nothing else — no payload')
- Single consumer: main/apps/web/src/features/notifications/hooks/useNotifications.ts
- No realtime module in main/client/* (engine README's WebsocketPubsubClient was removed)

**Direction.** Create `@bslt/realtime-client` (or put it in the client-runtime package) generated from `@bslt/shared` realtime contracts:

- typed channels
- reconnect and backoff
- an auth/CSRF handshake that reuses `@bslt/api` `getCsrfToken`
- an invalidation mode that keeps today's behaviour
- payload channels for live rooms.

Expose React hooks from @bslt/react: `useChannel`, `usePresence`.

##### CLI-13. Speculative/unused client surface: many DS components and react hooks have zero product consumers

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** dead-code
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** This runs against the repo's own YAGNI principle (principles.md:106). However, several unused pieces are exactly what a creator platform needs: useVirtualScroll and useInfiniteQuery for feeds, Tooltip, Popover and Slider for players, and BottombarLayout for mobile navigation. They are tested in isolation but unproven in a real screen.

**Evidence:**

- ui exports with 0 imports in apps/web/apps/storefront outside demo/ui-library: Accordion, Box, Tooltip, Popover, Slider, VisuallyHidden, DelayedFallback, StackedLayout, TopbarLayout, LeftSidebarLayout, RightSidebarLayout, BottombarLayout, AppShell, MediaGallery, UsageDashboard, TenantUsageOverrideEditor, Toast/ToastContainer (direct)
- @bslt/react hooks with 0 consumers in apps/web, client/ui, client/react internals: useSchemaForm (DIRECTION.md:153 says 'per-form migration is incremental' — 0 forms migrated), useInfiniteQuery (524 lines; only internal), usePaginatedQuery (287), useVirtualScroll (188), useOnScreen, useDebounce, useClickOutside, useCopyToClipboard, useFocusReturn, useHistoryNav, usePanelConfig, useWindowSize, useIsTouch
- Stale allowlist: main/tools/scripts/audit/api-client-surfaces.ts RAW_FETCH_ALLOWLIST lists main/apps/web/src/features/shared/hooks/useUndoRedoIntegration.ts which does not exist
- Web tsconfig aliases with 0 uses: @hooks, @router, @providers, @components, @layouts (main/apps/web/tsconfig.json)

**Direction.** Do not delete blindly. Mark each item as one of:

- 'adopt in creator platform': feed virtualisation, infinite queries, Tooltip/Popover, the mobile bottom bar
- 'delete': duplicate shells, Box, Toast as a direct export, usePanelConfig, useHistoryNav

Clean up the stale allowlist entry and the dead aliases.

##### CLI-14. tsconfig alias sprawl: same alias means different packages; ui imports react's private source

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** config
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The same alias string resolves to different code depending on which package you are in. The DS also reaches into another package's source tree past its declared exports, which the surface audit does not catch inside ui.

**Evidence:**

- @components → apps/web/src/features/admin/components in main/apps/web/tsconfig.json, but → client/ui/src/components in main/client/ui/tsconfig.json
- @hooks/@router/@providers in main/client/ui/tsconfig.json and main/apps/web/tsconfig.json point into ../react/src/* (private source); @providers points to main/client/react/src/providers, which does not exist (also in react's own tsconfig)
- ui uses @hooks 12 times (e.g. theme/provider.tsx, components/Dialog.tsx imports @hooks/useControllableState) bypassing the public @bslt/react/hooks entry that main/tools/scripts/audit/client-public-surfaces.ts:28 enforces for other code

**Direction.** Allow only `@bslt/*` package specifiers across packages, and use relative or `#internal` subpath imports inside a package. Delete the dead and duplicate aliases, and extend `client-public-surfaces` to cover tsconfig paths in `client/ui`.

##### CLI-15. /ui-library catalog: key collision, inverted taxonomy, ~60% coverage, demo CSS shipped in the DS

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** ui-design
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The catalog is the only living documentation of the DS. It is gated and well-tested (catalog tests exist), but it does not reflect the package taxonomy and cannot act as a coverage gate.

**Evidence:**

- Duplicate key 'card' in main/apps/web/src/demo/ui-library/catalog/componentCatalog.tsx:102 and elementCatalog.tsx:134; catalog.ts:9-13 spreads components then elements, so the components demo is silently dropped
- Taxonomy inverted vs package: componentCatalog has Box, Button, Input, Spinner, Badge (package elements); elementCatalog has Accordion, Dialog, Modal, Overlay, Tabs, ResizablePanel, ScrollArea, Popover, Pagination (package components/layouts)
- 10 + 38 + 8 = 56 entries (55 unique) vs 89 component files; missing: all billing, SessionCard, DeviceRowCard, StatusBadge/RoleBadge/JobStatusBadge, EmptyState, ErrorBoundary, SidePeek, Markdown, MetricValue, LabeledValueRow, FileInput, OAuthButton, SkipLink, FeatureHint, CardAsyncState
- 92 inline style={{}} in catalog files (layoutCatalog 52, elementCatalog 24, componentCatalog 16)
- Demo-only classes in DS utilities: main/client/ui/src/styles/utilities.css ~854-905 (.variant-card, .variant-card-header, .demo-copy-button, .preview-box, .code-details)
- Routes /ui-library and /side-peek-ui-library gated by VITE_ENABLE_DEV_TOOLS (main/apps/web/src/app/routes.tsx:65-67,277,294; docs/DIRECTION.md:78)

**Direction.** Generate the catalog index from the DS barrels, with one story file per component colocated in `client/ui`. Fail CI when an exported component has no story. Key stories by export name, and move demo CSS into `demo/`. For the redesign, make the catalog the visual-regression surface: run Playwright screenshots per story in both themes.

##### CLI-16. Auth/CSRF transport logic duplicated in 4+ places; catch-all createApiClient duplicates domain clients

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Security-relevant transport behaviour (CSRF retry, ToS gating, device id, refresh) is implemented several times, each slightly differently. The god-file client keeps legacy methods that duplicate domain clients with `Record<string, unknown>` types. docs/CLAUDE.md:74-75 defers 'god files' unless touched; the restructure will touch them.

**Evidence:**

- main/client/api/src/utils.ts:96-120 isCsrfError + fetchCsrfToken + csrfTokenCache
- main/client/api/src/api/client.ts:241-300 re-implements isCsrfError/fetchCsrfToken/request ('Custom request helper with ToS interception (not shared by other clients)')
- main/apps/web/src/features/media/hooks/mediaClient.ts:41-76 third copy (allowlisted in audit/api-client-surfaces.ts)
- Generated client has no CSRF/auth at all (generated/client.ts:93-131); demo ApiRoutesPage.tsx:291,462-468 fourth copy
- Endpoint duplicates with weaker types in api/client.ts: '/admin/legal/publish' and '/legal/current' (lines 610,619) also in legal/client.ts:101,109; '/admin/users/:id/hard-ban' (604) also in admin/client.ts:420; '/activities' (616) also in activities/client.ts:44

**Direction.** Use one transport, `createRequestFactory`, with pluggable interceptors for ToS, device id and age-gate. Delete the duplicate methods from `createApiClient`, keeping auth only. Make `mediaClient` use the SDK once media contracts exist, which the creator platform needs anyway.

##### CLI-17. Feature registration is scattered: route paths repeated as literals across routes, nav, command palette, dashboard

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** wiring-sprawl
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Adding a feature means editing 4-6 registries by hand. This overlaps the apps/web area and is recorded here because nav and command-palette UI is DS-adjacent. It is the UI-wiring counterpart of the 'not linked together' complaint.

**Evidence:**

- '/settings' literal appears in 11 web files incl. app/routes.tsx, app/layouts/AppLeftMenu.tsx, features/command-palette/data/commands.ts, features/dashboard/pages/DashboardPage.tsx, features/billing/pages/PricingPage.tsx, features/notifications/utils/getNotificationRoute.ts
- '/files' in routes.tsx, AppLeftMenu.tsx, DashboardPage.tsx, commands.ts; registries: app/routes.tsx (636 lines, 37 lazyPage), app/siteMap.ts (156), app/layouts/AppLeftMenu.tsx (158), command-palette/data/commands.ts (168), features/admin/adminSurface.ts, app/starterSurface.ts

**Direction.** Have each feature slice export a manifest: routes, nav entries, commands, capabilities and typed path builders. routes.tsx, nav, siteMap and command palette are then derived from the manifest list. The capability profile, which today is `profile.generated`, filters the manifests.

##### CLI-18. Stale docs across the client layer contradict the code

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** docs
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The owner's honesty-first docs (docs/CLAUDE.md 'written from verified code inspection') have drifted in the client layer. That will mislead restructure planning.

**Evidence:**

- main/client/ui/README.md: claims '26 elements, 16 components, 15 layouts', '23+ hooks' and a 'Custom router (~150 lines)' exported from @bslt/ui — router and hooks live in @bslt/react; actual counts 29/45/15
- main/client/react/src/router/index.ts docblock: '~150 lines' (router is ~920 lines across context.tsx 471, components.tsx 348, hooks.ts 100) and examples import from '@bslt/ui'
- docs/specs/principles.md:297 'Generated React hooks live in main/client/api/src/generated/hooks.ts' (retired)
- docs/DIRECTION.md:254 marks hooks codegen ✅; DIRECTION.md:387,390 reference main/client/engine/src/ui/date.ts and main/client/ui/src/utils/syntax-highlighter.tsx, which do not exist
- main/client/engine/README.md (see the engine finding); package.json repository.directory values 'client/api', 'client/ui' (actual main/client/*)

**Direction.** Regenerate package READMEs from exports, for example a small script that lists barrel exports with counts. Fix principles.md and DIRECTION.md rows as part of the restructure, and add the client READMEs to `audit:docs-links` or a new export-count check.

##### CLI-19. No icon system and a SaaS-monochrome visual language unsuited to a consumer creator platform

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** ui-design
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The current design language suits an admin-style SaaS starter. Feeds, creator profiles, live rooms, paywalls and wallets depend on imagery, brand colour, hierarchy and motion, none of which the token set can express today.

**Evidence:**

- No icon package or Icon primitive; 13 inline <svg> across 8 web files (features/auth/components/OAuthProviderIcons.tsx 4, NotificationDropdown.tsx 2, NotificationBell.tsx, NotFoundPage.tsx, ForbiddenPage.tsx, TasksPage.tsx, FilesPage.tsx, RegisterForm.tsx); catalog uses unicode glyphs (elementCatalog.tsx:916-922 '✕', '⚙'); IconButton (elements/IconButton.tsx) has no icon prop
- Palette: main/client/ui/src/theme/colors.ts:3-23 primary = accent = neutral = #0a0a0a (light) / #fafafa (dark); no brand/accent hue, no 'live', 'premium/locked', 'adult/age-restricted' semantic tokens
- Typography tops out at --ui-font-size-xl clamp(1.25rem..1.75rem) (theme.css:43); Heading sizes xl/lg/md/sm only — no display scale for profile headers or hero
- Only 2 shadow tokens; no elevation, z-index, aspect-ratio or media-overlay tokens beyond --ui-color-scrim
- No charting (only UsageDashboard bars and a TOTP QR canvas)

**Direction.** Extend the token model with:

- a brand palette (accent scale plus on-accent), designed for per-creator theming
- semantic status tokens: live, premium, locked, rating-sfw, rating-softcore
- a display type scale
- elevation and z-index scales
- media tokens: aspect ratios, overlay gradients, blur radius for gated content.

Add an Icon primitive backed by a single SVG sprite or icon set, with size and colour tokens, and give IconButton an `icon` slot.

##### CLI-20. Two UI-hierarchy violations exist and the hierarchy is not lint-enforced inside ui

- **Area:** Client packages (main/client/ui, main/client/react, main/client/api, main/client/engine) and the design system, including overlap with main/apps/web
- **Category:** layering-violation
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** There are only two violations, but nothing prevents more, and the redesign will add many components.

**Evidence:**

- main/client/ui/src/elements/Toaster.tsx:2 imports ToastContainer from @components/Toast (element → component)
- main/client/ui/src/components/media/MediaGallery.tsx:17 imports Modal from @layers/Modal (component → layout)
- docs/specs/principles.md:68-72 'theme → elements → components → layouts (never reverse)'; main/client/ui/eslint.config.ts has no boundaries rule

**Direction.** Add an ESLint import-boundary rule inside `client/ui`, or fold this into the existing boundaries config. Move Toaster to components and MediaGallery to the media feature slice.

#### CLI strengths (preserve)

- Token pipeline with a single TypeScript source: main/client/ui/src/theme/*.ts generates styles/theme.css via main/tools/sync/sync-css-theme.ts, wired into turbo `build:theme` and the dev watcher. A pre-paint `public/theme-init.js` prevents a flash of the wrong theme. Supports system, light and dark modes plus density and high-contrast.
- CSS quality gates that actually run in ci:merge-gate: `lint:css` covers css-tokens, responsive, dead-classes and undefined-tokens. Dead-class and undefined-token debt are both at zero (docs/todo/TODO.md 'Closed 2026-08-04/05'). Outside rust-access there is only one raw hex colour in app CSS.
- Canonical breakpoint scale shared between CSS and hooks: main/shared/src/constants/breakpoints.ts → theme tokens → `bp:` utilities → useBreakpoint/useIsMobile, with lint enforcement (docs/architecture/responsive.md).
- High test density: @bslt/ui has 84 test files (16.9k lines) and every element and layout has a colocated test. @bslt/react has 40 (15k lines), @bslt/api 18 (6.8k) and engine 7 (2.3k).
- Solid accessibility fundamentals:
- about 150 aria-label usages and 25 focus-visible rules
- a `--ui-focus` ring token
- FocusTrap, SkipLink, LiveRegion and RouteFocusAnnouncer
- IconButton requires aria-label at the type level
- raw `<img>` is lint-banned in favour of Image/Avatar
- RTL logical properties
- an axe e2e gate on login, dashboard and settings.
- Compound and polymorphic component API conventions: Modal.Root/Header/Body, Dialog.Root, Card.Header, `as` props, and tone expressed through `data-tone` attributes. This is a good base to keep while restyling.
- Deliberately zero-dependency client stack: a custom router, query cache and Schema library. The web app's runtime deps are only Sentry, simplewebauthn and Stripe (docs/DIRECTION.md:152-155). It is fully owned and forkable.
- Transport fundamentals in main/client/api/src/utils.ts are worth turning into the single SDK core:
- refresh-on-401 via setDefaultOnUnauthorized
- the x-tenant-id header for RLS tenant scoping
- CSRF fetch and retry
- the typed ApiError hierarchy in errors.ts.
- The shared contract layer already exists (26 contract files, 214 endpoints with request and response schemas, plus `apiRouter`). Contract-first codegen can be built on it without new dependencies.
- Client surface audits enforce package entrypoints and flag raw fetch: client-public-surfaces.ts, api-client-surfaces.ts (with a justified allowlist) and web-feature-surfaces.ts.
- Engine's userScopedStorage (clear-on-switch, per-user namespacing) and the IndexedDB query persister are directly valuable for fans and creators switching accounts or roles.
- A single DI root exists (main/apps/web/src/app/ClientEnvironment.tsx) and can host a unified SDK and realtime client.
- The dev tooling (/ui-library, /developer/api-routes) is cleanly isolated under main/apps/web/src/demo, gated by VITE_ENABLE_DEV_TOOLS, and documented as deletable (demo/README.md).

#### CLI inventory

| Path                                                                                                                    | Purpose                                                                                                                                                                                                                                                                          | Size                                                                                                                                                       | Notes                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main/client/api                                                                                                         | Browser REST transport (@bslt/api): shared request factory (CSRF, bearer token, x-tenant-id, refresh-on-401), typed ApiError, 19 per-domain create*Client factories, auth god-client, generated route manifest                                                                   | 5.4k LOC non-test (api/client.ts 1,088; admin/client.ts 627; notifications 412; utils 305; generated/client.ts 363); 18 test files / 6.8k lines            | Declares a react peerDependency but has 0 react imports. Response validation is partial. Only 2 type imports from shared/contracts.                     |
| main/client/api/src/generated                                                                                           | Output of `pnpm api:generate-client`: generatedRouteDefinitions (185 rows) + untyped createGeneratedApiClient                                                                                                                                                                    | 363 + 11 lines                                                                                                                                             | Source is the server route-manifest, not the shared contracts. Hooks generation is retired. Freshness check (`api:check`) is not gated.                 |
| main/client/react                                                                                                       | @bslt/react: custom router (router/), TanStack-like query hooks over the engine QueryCache (query/), ~35 generic hooks, stores (createStore, toastStore), forms (createFormHandler, useSchemaForm), LiveRegion, plus domain hooks for billing/devices/legal/oauth/phone/webhooks | 8.3k LOC non-test; 40 test files / 15k lines                                                                                                               | Subpath exports: ., ./hooks, ./router. theme/index.ts only re-exports the engine.                                                                       |
| main/client/engine                                                                                                      | @bslt/client-engine: framework-agnostic browser runtime — QueryCache (643 lines), IndexedDB wrapper, query persister, localStorage queue, user-scoped storage, contrast/density CSS-var maps, key-binding parser                                                                 | 1.8k LOC non-test; 7 test files / 2.3k lines                                                                                                               | The README describes removed modules. react-shim.d.ts and the react peer dependency are vestigial.                                                      |
| main/client/ui                                                                                                          | @bslt/ui: design system — 29 elements, 45 components (incl. 10 billing + 1 media), 15 layouts (containers/layers/shells), theme TS sources + ThemeProvider, utils (cn, markdown parser)                                                                                          | 11.3k TS + 6.1k CSS (components.css 2,109; utilities.css 1,725; elements.css 1,507; theme.css 397 generated; layouts.css 381); 84 test files / 16.9k lines | Depends on @bslt/react (router, hooks, ToastMessage), @bslt/client-engine (theme) and @bslt/shared/core/* (billing, admin, jobs, auth, usage-metering). |
| main/client/ui/src/theme                                                                                                | Token sources (colors, spacing, typography, radius, motion, breakpoints), buildThemeCss, ThemeProvider/useTheme                                                                                                                                                                  | ~1.0k lines incl. colors.ts 280, buildThemeCss.ts 204, provider.tsx 151                                                                                    |                                                                                                                                                         |
| main/client/ui/src/styles                                                                                               | Plain CSS: generated theme tokens, reset + element styles, component styles (≈43% billing), layout shells, 222 hand-written utility classes                                                                                                                                      | 6.1k lines                                                                                                                                                 | Each component imports a whole sheet. Web imports `@bslt/ui/styles/elements.css` once in bootstrap/client.tsx:27.                                       |
| main/apps/web/src/demo/ui-library                                                                                       | Dev-only live catalog of @bslt/ui at /ui-library and /side-peek-ui-library                                                                                                                                                                                                       | ~4.0k lines incl. tests (elementCatalog 1,048, layoutCatalog 650, componentCatalog 391)                                                                    | 55 unique entries for 89 component files. Duplicate 'card' key.                                                                                         |
| main/apps/web/src/app/layouts                                                                                           | The real app shell (AppLayout, Top/Left/Right/Bottom/Main layouts, AppLeftMenu, AppShell.css)                                                                                                                                                                                    | ~1.2k lines + 326 CSS                                                                                                                                      | Does not use the ui AppShell or Topbar/Sidebar layouts.                                                                                                 |
| main/apps/web/src/features/*/hooks                                                                                      | 59 app-local data hooks (admin 24, settings 13, ...) built directly on @bslt/api + @bslt/react useQuery                                                                                                                                                                          | 59 files                                                                                                                                                   |                                                                                                                                                         |
| main/apps/web/src/lib/realtime.ts                                                                                       | Browser WebSocket invalidation bus (subscribeToKey)                                                                                                                                                                                                                              | 261 lines                                                                                                                                                  | Only consumer is features/notifications/hooks/useNotifications.ts.                                                                                      |
| main/apps/web/src/features/media/hooks/mediaClient.ts                                                                   | Self-contained fetch client for the profile-gated media studio (own CSRF/auth)                                                                                                                                                                                                   | ~120 lines                                                                                                                                                 | On the RAW_FETCH_ALLOWLIST.                                                                                                                             |
| main/tools/scripts/api                                                                                                  | generate-client.ts (route-manifest → generated/), generate-hooks.ts (retired no-op), check-client-freshness.ts                                                                                                                                                                   | 452 lines                                                                                                                                                  |                                                                                                                                                         |
| main/tools/sync/sync-css-theme.ts                                                                                       | Generates client/ui/src/styles/theme.css from theme TS sources with a hash cache                                                                                                                                                                                                 | ~150 lines                                                                                                                                                 |                                                                                                                                                         |
| main/tools/scripts/lint/lint-css-tokens.ts, lint-responsive.ts, lint-dead-classes.ts, lint-undefined-tokens.ts          | The four `pnpm lint:css` gates for the design system                                                                                                                                                                                                                             |                                                                                                                                                            | STYLE_ROOTS exclude main/extensions.                                                                                                                    |
| main/tools/scripts/audit/client-public-surfaces.ts, api-client-surfaces.ts, web-feature-surfaces.ts, api-client-sync.ts | Enforce client package entrypoints, ban raw fetch outside the allowlist, forbid feature-local api/services dirs, compare route manifest vs client calls                                                                                                                          |                                                                                                                                                            |                                                                                                                                                         |
| main/shared/src/contracts + main/shared/src/api/router.ts                                                               | 214 schema-bearing endpoint contracts aggregated as apiRouter (dependency of this area; owned by the shared area)                                                                                                                                                                |                                                                                                                                                            | Not consumed by the client packages.                                                                                                                    |
| main/apps/storefront/public/styles.css                                                                                  | Static storefront stylesheet with its own token vocabulary                                                                                                                                                                                                                       | 757 lines, 22 hex                                                                                                                                          |                                                                                                                                                         |
| main/apps/web/src/features/rust-access                                                                                  | Separate React entry for the experimental Rust app with its own --access-* tokens                                                                                                                                                                                                | 399 TS lines + 418 CSS (40 hex)                                                                                                                            |                                                                                                                                                         |
| main/extensions/*/src/web/{index.tsx,styles.css}.template                                                               | Installable-pack web UIs (billing 446 lines, account-insights 65) using @bslt/ui primitives                                                                                                                                                                                      |                                                                                                                                                            | Use the nonexistent --ui-space-* tokens.                                                                                                                |

#### CLI wiring points

- `main/apps/web/src/bootstrap/client.tsx`: Imports the global DS stylesheet (@bslt/ui/styles/elements.css). Constructs QueryCache, the query persister and AuthService (which registers setDefaultOnUnauthorized). Builds the ClientEnvironment and gates capabilities via ./generated/profile.generated.
- `main/apps/web/src/app/App.tsx`: Provider tree: ErrorBoundary → QueryCacheProvider → ThemeProvider (storageKey 'app-theme-mode') → I18nProvider → BrowserRouter → ClientEnvironmentProvider → HistoryProvider → LiveRegion. Also mounts Toaster, CommandPalette, CookieConsentBanner and TosAcceptanceModal.
- `main/apps/web/src/ssr/ServerApp.tsx`: SSR provider tree for public routes (duplicate ThemeProvider keys, MemoryRouter)
- `main/apps/web/public/theme-init.js + main/apps/web/index.html`: Pre-paint data-theme from localStorage 'app-theme-mode'; color-scheme rules
- `main/apps/web/src/app/ClientEnvironment.tsx`: DI context {config, queryCache, auth} consumed via useClientEnvironment (51 files)
- `main/apps/web/src/app/routes.tsx`: 37 lazy pages including dev-gated /ui-library, /side-peek-ui-library and /developer/api-routes
- `main/client/api/src/utils.ts`: createRequestFactory/apiRequest (CSRF, bearer, x-tenant-id, retry), the process-wide setDefaultOnUnauthorized hook, and the csrfTokenCache
- `main/client/api/src/index.ts`: Public @bslt/api surface (43 export statements): all create*Client factories, generated client and error types
- `main/client/react/src/index.ts`: Public @bslt/react surface: query layer, router, stores, forms and domain hooks (billing, devices, legal, oauth, phone, webhooks); subpaths ./hooks and ./router
- `main/client/ui/src/index.ts`: Public @bslt/ui surface: elements, components (incl. billing), layouts, theme and utils; subpaths ./components, ./elements, ./layouts, ./theme, ./utils, ./styles/*.css
- `main/client/ui/tsconfig.json, main/apps/web/tsconfig.json, main/client/react/tsconfig.json`: Path aliases including cross-package private-source aliases (@hooks, @router, @providers → client/react/src)
- `package.json scripts`: api:generate, api:generate-client, api:generate-hooks, api:check, build:theme and lint:css. audit:template includes audit:client-surfaces, audit:web-feature-surfaces, audit:api-client-surfaces and audit:route-contract-coverage.
- `turbo.json`: build:theme task (inputs: sync-css-theme.ts, client/ui/src/theme/**); build dependsOn build:theme
- `main/tools/scripts/audit/api-client-surfaces.ts`: RAW_FETCH_ALLOWLIST (rust-access/api.ts, demo ApiRoutesPage, nonexistent features/shared/hooks/useUndoRedoIntegration.ts, media/hooks/mediaClient.ts) and FORBIDDEN_API_EXPORTS

#### CLI creator-platform notes

- Build every new creator-platform domain contract-first: subscriptions and tiers, PPV unlocks, tips, wallets and ledgers, payouts including crypto, live rooms, moderation queues, age verification, content rating. Generate the SDK, query keys and hooks from shared contracts so the hand-written fragmentation does not grow.
- A first-class realtime client package is a prerequisite for live rooms (presence, chat, tip and gift events, viewer counts). The current invalidation-only `apps/web/src/lib/realtime.ts` can survive as one mode. Payload channels must come from shared realtime contracts.
- Content separation (SFW vs softcore) enforced at the data layer still needs a UI counterpart. Media primitives must take a typed `rating` and gating state. Needed pieces: a BlurredMedia or ContentGate overlay, an AgeGate interstitial, RatingBadge, PaywallOverlay and UnlockButton. None exist today, and the SaaS-plan billing components (PlanCard, PricingTable, UsageDashboard, TenantUsageOverrideEditor) do not map to per-creator tiers.
- Feed primitives are missing in practice. useVirtualScroll and useInfiniteQuery exist but have zero consumers. The platform needs VirtualFeed or InfiniteList, PostCard, CreatorCard, ProfileHeader with display typography, StoryRing, LiveRing on Avatar, and AspectRatio media boxes.
- Money UI is needed: Price or CurrencyAmount (fiat plus crypto precision, locale-aware through apps/web/src/i18n/format.ts formatCurrency), WalletBalance, TipButton or TipSheet with preset amounts, TransactionRow, and PayoutStatus. A generic StatusBadge with tone mapping should replace the per-domain badge components.
- Live UI is needed: LivePlayer or VideoPlayer, LiveBadge or ViewerCount, ChatMessageList (virtualised), ReactionBurst or GiftAnimation, and a token-level reduced-motion policy. The current DS honours prefers-reduced-motion in one place only.
- Mobile-first consumer patterns are needed: BottomSheet or Drawer built on the unified Dialog core (SidePeek is the nearest relative), BottomNav (BottombarLayout exists but is unused), ActionSheet, and pull-to-refresh-friendly lists.
- Creator studio and dashboards need StatTile (MetricValue plus Card exist), a chart primitive (none exists), DataTable (Table exists), and moderation queue tables with bulk actions. The admin feature (12.6k LOC in apps/web) is the best pattern source.
- Theming should support a platform brand accent and possibly per-creator accent overrides on profile pages. That requires moving from monochrome primary=accent to an accent scale, plus elevation and z-index tokens and an Icon system.
- Keep through the restructure: - the token generation pipeline - the lint:css gates (extended to main/extensions) - accessibility primitives (FocusTrap, SkipLink, LiveRegion, RouteFocusAnnouncer) - compound component patterns - client surface audits - user-scoped storage (vital when a user switches between fan and creator identities) - the dev-gated /ui-library, rebuilt as a story-per-export catalog doubling as the visual-regression surface.
- For the fork: if domain UI moves into feature slices before forking, then 'removing unnecessary features' becomes deleting slices (billing-SaaS, tenants UI, admin-only pages) rather than untangling @bslt/ui and @bslt/react. That directly fixes the 'billing/tenants/notifications are not prunable' constraint on the client side.

#### CLI open questions

- Styling model for the redesign: keep plain CSS plus a hand-written utility layer, or move to CSS Modules, vanilla-extract or Tailwind v4? The utility layer already mimics Tailwind naming with a numeric scale that conflicts with the named token scale.
- Keep the custom router and query layer, which are deliberate and zero-dependency, or adopt TanStack Router/Query for the creator platform's heavier data needs (infinite feeds, optimistic tips, websocket-driven cache updates)? principles.md 'use the platform' and the zero-deps stance pull in different directions.
- Which overlay is canonical, Modal (18 product uses) or Dialog (5)? Should Sheet, Drawer and BottomSheet be built on the survivor?
- WCAG 1.4.11: will the owner now choose compliance over the minimal hairline look (TODO.md:69), given the consumer, payments and age-verification context?
- Where should feature slices live: a new main/features/<domain> workspace layer shared by apps, or inside apps/web/src/features with only generated SDK code in client/*?
- Should the storefront static site and the rust-access app adopt @bslt/ui tokens, or be dropped from the creator-platform fork entirely?
- Do public creator profiles need SSR or SEO? ServerApp.tsx already renders public routes. If yes, DS components must stay SSR-safe, which affects the choice of styling solution and the theme-init strategy.
- Should the generated SDK replace the hand-written clients in one migration, or domain by domain behind the api-client-sync audit?

### B.CORE. main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added

**Summary.** @bslt/core has about 45.1k non-test lines in 20 top-level module folders. compliance holds two sub-modules (legal, data-export). Size is very uneven: auth 15.8k (96 files), billing 6.1k, admin 5.5k, tenants 3.6k, users 3.3k, notifications 2.4k, webhooks 1.6k. Eleven modules are under 1.1k each. Every module exposes a RouteMap built from the same @bslt/server-system/http helpers. main/server/core/src/route-modules.ts lists 18 of them. The app shell (main/apps/server/src/http/route-modules.ts and router.ts) composes them under /api with one guard chain: JWT, then RLS contextualize, then the ToS gate. Billing is special-cased outside that registry. Package boundaries are clean: core depends only on db, system and shared, enforced by eslint-plugin-boundaries. Inside core there are no boundaries. There is an auth<->users<->api-keys import cycle. Each module has its own folder layout, context-type naming, handler return style and error-logging adapter. There is no domain event bus. Audit, activity, outbound webhooks, admin alerts, in-app notifications and emails are hand-wired at each call site as fire-and-forget calls. About 50 of them end in `.catch(() => {})`. As a result, many built capabilities are not connected to the domains that should use them. Billing provider webhooks write no audit or activity rows and emit none of the advertised subscription/invoice webhook events. Only 2 of 13 subscribable webhook types are ever emitted. Usage metering, plan entitlements, server-side feature-flag checks, the WriteService (writes that publish to pubsub) and the core permissions checker have no runtime callers. Reading the code, the billing dunning notifier is never placed into the context that the webhook routes receive. Adding a domain touches about 15-20 places, counting the scaffolder's 7 registry patches, edition and prune manifests, package exports, context field lists and event vocabularies. Removing a domain for the Core edition or the pruner relies on 27 text-anchored source edits into core files.

#### Findings

##### CORE-01. No domain event mechanism; side effects are copy-pasted at every call site

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** coupling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Domains are linked only by direct imports of helper functions, which each handler calls by hand after its write. Nothing guarantees that a given business fact produces the same set of side effects everywhere. Coverage depends on whether the author remembered each call. All side effects run outside the write transaction, are best-effort and are often silently swallowed. This is the main technical cause of the owner's 'features are there but not linked' observation.

**Evidence:**

- grep for EventEmitter|eventBus|outbox|DomainEvent across main/server, main/shared, main/apps/server finds only doc comments (main/server/core/src/audit/types.ts:6, audit/index.ts:5)
- main/server/core/src/tenants/handlers/members.ts:120-149: handleAddMember makes 3 separate fire-and-forget calls (audit record, logActivity, emitWebhookEvent), each ending in .catch(() => {})
- audit record() is imported by 21 files in 7 modules (tenants 5, auth 6, users 4, admin 2, compliance 2, billing 1, consent 1)
- logActivity has 16 call sites in 11 files (auth/handlers/login.ts:311, logout.ts:51, tenants/_, users/handlers/_, billing/handlers/support.ts:50)
- notifyAdmins has 8 call sites (auth/handlers/login.ts:295,360; auth/service.ts:243; auth/password/service.ts:151; users/handlers/lifecycle.ts:187,273,357; users/handlers/account.ts:273)
- ~50 `.catch(() => {})` swallow sites across 19 core files (tenants/handlers/members.ts alone has 10), contrary to docs/specs/principles.md:147 'Never silent failures, swallowed errors'
- tryAudit is copy-pasted 4 times: billing/handlers/support.ts:39, compliance/legal/handlers.ts:97, compliance/data-export/handlers.ts:83, consent/handlers.ts:33
- no document records a decision against an event bus; 'outbox' appears only in docs/dev/rust-backend.md:36

**Direction.** Add a typed domain-event catalog in main/shared (e.g. member.added, subscription.activated, tip.sent) and an in-process event bus in core, e.g. core/src/events, created at composition. Services publish events after commit. Audit, activity, outbound webhooks, notifications, realtime invalidation and admin alerts become subscribers registered by their own modules. Back the bus with a transactional outbox table so delivery survives a crash. Replace the swallowed .catch(() => {}) sites with subscriber-level logging and retries.

##### CORE-02. Billing events reach almost nothing else; most advertised webhook event types are never emitted

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Subscription state changes from Stripe and PayPal update billing tables only. They create no audit trail, no activity entry and no outbound webhook, even though subscribers can sign up for those event types today. Webhook subscribers receive almost nothing.

**Evidence:**

- main/shared/src/constants/system/comms.ts:12-26: WEBHOOK_EVENT_TYPES lists 13 subscribable types (user._, tenant._, member.*, subscription.created/updated/cancelled, invoice.paid/failed)
- the only emitWebhookEvent calls are main/server/core/src/tenants/handlers/members.ts:145 (member.added) and :300 (member.removed)
- main/server/core/src/billing/webhooks/stripe/events.ts (431 LOC) and paypal/events.ts (448 LOC) contain no audit record, logActivity, or emitWebhookEvent calls; their only follow-up is pending dunning notifications (billing/webhooks/shared.ts:101)
- registration (auth/service.ts registerUser) and personal workspace creation (auth/personal-tenant.ts:81-88) emit no user.created or tenant.created webhook
- docs/DIRECTION.md:143 confirms outbound webhooks are 'Wired to member.added/member.removed; other events call the same helper'

**Direction.** Have billing webhook processing publish domain events (subscription.activated/updated/canceled, invoice.paid/failed). Then audit, activity, outbound webhooks and notifications subscribe once. Add a governance check that every SUBSCRIBABLE_EVENT_TYPES entry has at least one producer.

##### CORE-03. Billing dunning notifier is never passed to the webhook routes (wiring bug, found by reading code)

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** wiring-sprawl
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Payment-failed, payment-recovered and account-suspended emails and in-app alerts built by createBillingNotifier appear never to fire in the running server. This was established by reading the code; nothing was executed. It shows how hand-maintained context field lists drift: the field appears in InfraContext and IServiceContainer but was left out of the App.context literal.

**Evidence:**

- main/apps/server/src/bootstrap/phases/comms.ts:108 and :198 build billingNotifier into InfraContext
- main/apps/server/src/bootstrap/app.ts:522-543: the App.context literal omits billingNotifier, and there is no `get billingNotifier()` among the 17 getters (app.ts:555-601)
- app.ts:506 calls registerRoutes(this._server, this.context); app.ts:550-553 contextualize also spreads this.context
- main/apps/server/src/http/route-modules.ts:125 and :196 pass ctx.billingNotifier to handleStripeWebhook/handlePayPalWebhook
- main/server/core/src/billing/webhooks/shared.ts:101 skips dispatch when the notifier is undefined; IServiceContainer marks it optional (context.ts:146), so TypeScript does not catch the omission
- the only test sets billingNotifier: undefined explicitly (tests/integration/api/billing-webhooks.integration.test.ts:158); the composition root is not tested

**Direction.** Short term: add billingNotifier to App.context, plus a composition-root test asserting that every IServiceContainer key is present in App.context. Long term: make dunning a subscriber of invoice.failed/recovered events, so no context field is needed.

##### CORE-04. Usage metering, plan entitlements and feature flags are built but nothing enforces them on the server

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** dead-code
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Billing knows a user's plan, but no server-side domain checks it. Paid capabilities and limits rest only on what the UI hides. For a paywalled creator platform this is the most important missing link.

**Evidence:**

- main/server/core/src/billing/usage-metering.ts:154 recordUsage, :190 recordUsageWithinLimit (row-locked), and assertWithinUsageLimit have no callers outside billing/index.ts; only createUsageSnapshot is used (main/server/workers/src/scheduler/register.ts:12)
- main/shared/src/modules/core/billing/billing.entitlements.ts:72 resolveEntitlements, :131 assertEntitled, :185 isEntitled have no runtime callers in main/server, main/apps or main/client
- docs/DIRECTION.md:131 claims 'Seat-based and resource-based limits ✅ main/server/core/src/billing/'; the only quota check in core is QUOTAS.MAX_PENDING_INVITATIONS (tenants/invitation-service.ts:307)
- feature flags are evaluated only from the browser (main/apps/web/src/features/admin/hooks/useFeatureFlag.ts:74); no server module calls evaluateFlags (feature-flags/service.ts:172) to gate behaviour
- three separate gating systems are unconnected: runtime profiles (route registration), DB feature flags (client-only), plan features/entitlements (unused)

**Direction.** Add a single EntitlementService in core that resolves plan, subscription, feature flags and overrides per subject. Expose it as a route preHandler (withRoutePreHandlers already exists in server-system/http) and as a service-level assert. Call recordUsageWithinLimit from domain events for metered resources. Either wire entitlements or delete them, and correct DIRECTION.md.

##### CORE-05. Dead or parallel infrastructure: permissions checker, permission middleware, WriteService, preference gates

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** dead-code
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Several well-tested building blocks are parallel alternatives to what actually runs. They inflate size and test load and mislead readers about the real authorization and notification model.

**Evidence:**

- main/server/core/src/permissions/checker.ts (648 LOC) + permissions/types.ts (331): createPermissionChecker (checker.ts:520) is referenced only by core/permissions and tests; checker.test.ts is 719 LOC
- main/apps/server/src/middleware/permissions.ts (510 LOC): createPermissionMiddleware (:162) and createStandalonePermissionGuard (:403) are exported from middleware/index.ts:84-85 but never registered
- main/server/realtime/src/permissions/* is a separate record-permission system (canReadRecord); the authz actually used is route roles + tenants role bitmask (tenants/role-service.ts uses shared tenant/role.permissions.ts resolveMemberPermissions) + RLS
- main/server/db/src/queue/write-service.ts (afterWrite hooks, automatic pubsub publish after commit) is created at main/apps/server/src/bootstrap/phases/data.ts:121 and placed on AppContext, but no core module uses ctx.write
- shouldSendNotification exists twice with different preference models (main/shared/src/modules/comms/notifications/notifications.logic.ts:19 and main/server/core/src/notifications/preferences.ts:237); neither has a runtime caller, so shouldSendEmail (notifications/unsubscribe.ts:244, the unsubscribe gate) is unreachable
- unused exported dependency types: AuthModuleDeps (auth/types.ts:254), BillingModuleDeps (billing/types.ts:48), BillingHandlerDeps (billing/types.ts:245)
- docs/CLAUDE.md calls permissions/checker the 'authz core' that is 'now tested'

**Direction.** Pick one authorization model: tenant RBAC bitmask + RLS + an optional record-level policy. Then delete or adopt core/permissions and apps/server middleware/permissions. Decide whether WriteService becomes the standard mutation path; its afterWrite hooks are a natural place to publish events. Otherwise remove it. Keep one notification preference model, in core.

##### CORE-06. Import cycle auth <-> users <-> api-keys, and the users/me/* URL space is split between auth and users

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** coupling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Account management is spread across auth and users with no clear owner, which produces a strongly connected component of three modules. Splitting packages, pruning, or adding an identity/creator boundary will run into this cycle.

**Evidence:**

- main/server/core/src/auth/utils/index.ts:15 re-exports UserNotFoundError from '../../users/errors'
- users imports auth: users/routes.ts:38 (REFRESH_COOKIE_NAME), users/handlers/account.ts:19-20 (hashPassword, revokeAllUserTokens, verifyPassword, WeakPasswordError), lifecycle.ts:28 (verifySudoToken), sessions.ts:13 (revokeTokenFamily)
- auth/middleware.ts:16 imports '../api-keys/service' while api-keys/service.ts:14 imports '../auth/utils/crypto'
- auth/routes/account.ts:73-125 registers users/me/devices, users/me/devices/:id/trust, users/me/phone, users/me/phone/verify, users/me/phone/delete; users/routes.ts:140-361 registers users/me, users/me/password, users/me/sessions, users/me/deactivate
- eslint.config.ts:245 treats main/server/core as a single boundaries element, so no rule prevents cross-module cycles inside core

**Direction.** Define an identity/account boundary: credentials and sessions (auth) versus profile and lifecycle (users). Move shared errors and crypto helpers into a small core kernel, e.g. core/src/kernel. Have one module own the users/me/* namespace. Add a boundaries element per core module, with an allow-list DAG.

##### CORE-07. Core-edition modules depend on paid modules; the edition split and the pruner patch core source as text

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** coupling
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** The mechanism is deliberate and documented. Anchored manifests fail loudly on drift. It is needed because modules call each other directly: removing a module means editing every caller's text. Any restructure of core file topology will invalidate these anchors.

**Evidence:**

- main/editions/catalog.ts:13-37 marks activities, tenants, billing, webhooks, admin as PAID, but CORE modules import activities: auth/handlers/login.ts:26, logout.ts:16, users/handlers/account.ts:17, avatar.ts:23, username.ts:21
- main/tools/scripts/editions/export.ts:226-242 strips logActivity blocks using PRUNE_MANIFESTS.activities anchors; export.ts:290-310 removes billing registration from core index.ts and apps/server router.ts by exact string match
- main/tools/scripts/starter/prune-manifests-features.ts has 24 anchored edits targeting core files (route-modules.ts x6, tenants/handlers/members.ts x2, billing/handlers/*, auth/handlers/login.ts:190-200 ...); prune-manifests.ts adds 3; the three manifest files total 2,418 LOC
- docs/CLAUDE.md documents billing, tenants, advanced-auth and notifications as entangled and not prunable

**Direction.** With events and a module manifest, pruning becomes unregistering a module and its subscribers instead of editing text. Decide before the restructure whether the Core/Pro export and the prune tooling must survive in bslt-main. If they do, migrate them to manifest-driven inclusion first.

##### CORE-08. Billing registration is special-cased in five places, with provider protocol logic living in the app shell

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** wiring-sprawl
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Billing is composed in three different ways: the dev router special case, edition text surgery, and an extension pack built from copied sources. Inbound provider webhooks are not part of the route-module contract at all.

**Evidence:**

- main/server/core/src/route-modules.ts:35-54 lists 18 modules but not billing
- main/apps/server/src/http/router.ts:88-95 registers billingRoutes and the webhook routes separately
- main/apps/server/src/http/route-modules.ts:85-217: two near-identical raw Fastify handlers for Stripe and PayPal (~65 lines each), including PayPal signature-string assembly (:159-165) and error-name mapping
- main/tools/scripts/audit/route-manifest.ts:106 register('billing', billingRoutes) duplicates the special case
- main/tools/scripts/editions/export.ts:298-310 removes it by text; main/extensions/billing/feature.json 'sources' copies 8 core billing files into a pack for the Core edition

**Direction.** Make billing an ordinary module whose manifest declares routes plus signed raw-body webhooks. Reuse the InstalledServerFeature {id, routes, webhooks} shape from main/editions/core/main/apps/server/src/extensions/types.ts.template. Move the provider header parsing into billing/webhooks.

##### CORE-09. Several overlapping audit trails, with the same event logged under different names

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Questions like 'who did what' have to be answered from three tables with inconsistent action names and categories. Several security-relevant actions are not recorded at all. Moderation, payouts and ledger disputes on a creator platform need a single trustworthy trail.

**Evidence:**

- audit_events via audit/service.ts:59 record(); security_events via auth/security/events/core.ts:8 logSecurityEvent (raw insert); activities via activities/service.ts:31; admin impersonation writes ctx.repos.auditEvents.create directly (admin/impersonationHandlers.ts:86-87,164-165); admin force-logout/hard-ban/soft-delete are stored only as security events with metadata.action (admin/userService.ts:292-303,495,587)
- one action logged twice under different names: users/handlers/avatar.ts:172 'user.avatar_uploaded' vs :183 'user.avatar.uploaded'; users/handlers/account.ts:175 vs :186; username.ts:124 vs :135; tenants/handlers/tenant-crud.ts:78 'workspace.created' vs :89 'tenant.created'; members.ts:181 'role.changed' vs :193 'member.role_changed'; ownership.ts:53 vs :65
- ACTIVITY_TYPES enum (main/shared/src/modules/core/activities/activities.types.ts:37) is used at only 7 sites; other sites use string literals
- AuditAction (audit/types.ts:19-35) is open-ended (string & {}) and lists project.* actions that never occur; inferCategory (audit/service.ts:25-31) maps only billing.* and role._, so workspace._, user.* and consent.* all become 'system'
- server writes skip the shared AUDIT_ACTION_REGEX validation (main/shared/src/modules/core/audit-log is consumed only by apps/web AuditEventsPage.tsx and contract.admin.ts)
- no audit at all for API key create/delete (api-keys/handlers.ts:53,78), webhook create/update/rotate-secret (webhooks/handlers.ts:44-301; webhooks/service.ts:66 '_userId accepted for audit trail purposes (future use)'), feature-flag changes, or billing webhook state changes

**Direction.** Define one event and action catalog in shared (noun.verb, validated) with category and severity metadata. Make audit and activity projections of domain events (audit = everything; activity = user-visible subset). Fold security events into the audit stream with category=security, or keep them separate only for documented retention reasons. Add a governance test that every mutating route emits an audit event.

##### CORE-10. Notifications and email have six or more independent write paths with different guarantees

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Whether a user sees a realtime bell update, gets push, or has preferences honoured depends on which module sent the notification. This is fragmentation inside a single capability.

**Evidence:**

- notifications/send.ts:94-106 creates a notification and publishes a realtime invalidation; notifications/admin-alerts.ts:161 calls repos.notifications.create with no publish; billing/payment-notifications.ts:138,206,282 and billing/handlers/support.ts:58 (tryNotification) also create without publish or preference checks
- emails are sent directly from 16 sites in 10 files: auth (verification/service, password/service, email-change, service x2, magic-link/service, otp/service, security/events/alerts), admin/userHelpers.ts x4, billing/payment-notifications.ts x3, tenants/invitation-service.ts:184
- email copy is built inside core in 7 files (auth/email-templates.ts, tenants/invitation-email.ts, billing/payment-notifications.ts fallbacks, auth/security/events/alerts.ts, ...), while branded templates come from comms through an intersection type (apps/server/src/bootstrap/phases/comms.ts:31,173)
- stale docs: notifications/send.ts:6-7 says browser push was removed, yet push-dispatch.ts is used by notifications/handlers.ts:35; notifications/index.ts:3,17 references a nonexistent '@bslt/notifications' package
- ctx.notifications (the comms NotificationService provider) and core/notifications (in-app feed module) share one name

**Direction.** Add one core NotificationService, e.g. notify(recipient, type, payload, channels). It resolves preferences and unsubscribes, writes the feed, publishes realtime, dispatches push and email from templates, and is the only path used by other modules or event subscribers. Keep transactional-email exemptions explicit.

##### CORE-11. Module folder layouts and file naming differ from module to module

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** naming-inconsistency
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** A reader cannot predict where a module's routes, logic or data access live. This makes the codebase feel scattered and increases the cost of every restructure and code-generation step.

**Evidence:**

- flat five-file layout (index/types/service/handlers/routes): activities, api-keys, consent, feature-flags, files, support, tasks, analytics, compliance/legal, compliance/data-export, matching docs/dev/module-creation.md
- no service.ts: search, status, notifications (logic lives in notifications/handlers.ts, 792 LOC); no routes: audit (its endpoint is admin/auditHandlers.ts), permissions
- tenants: handlers/ folder but flat service.ts, membership-service.ts, role-service.ts, invitation-service.ts
- billing: routes.ts beside a routes/ folder, a service/ folder, a paypal/ folder but a flat stripe-provider.ts, and usage-metering-handlers.ts outside handlers/
- auth: routes.ts + routes/ + handlers/ + 16 loose top-level files; email-change.ts beside handlers/email-change.ts, totp.ts beside handlers/totp.ts; password/ and verification/ each hold only service.ts
- admin uses camelCase file names (16 files, e.g. userHandlers.ts, billingService.ts) plus auth/security/rateLimitPresets.ts; the rest of core uses kebab-case (42 multi-word kebab files); docs/specs/principles.md:151-155 prescribes camelCase for utilities
- compliance concepts are split: ToS gating in auth (auth/tos-gating.ts, routes auth/tos/*), legal documents in compliance/legal, consent as a top-level sibling, deletion rules in shared/core/compliance/deletion.logic.ts

**Direction.** Adopt one canonical module shape and enforce it with a lint or audit script: module/{index, module.ts (manifest), routes.ts, handlers/, services/, events.ts, types.ts}, with sub-features as nested modules of the same shape. Pick one file-naming rule (kebab-case matches 90% of core) and update principles.md. Group compliance (legal, consent, ToS, export, deletion) into one bounded context.

##### CORE-12. Module context types, handler return style and error adapters differ across modules

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** naming-inconsistency
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The structural-typing approach (each module declares the slice of context it needs) is sound. But it is applied ad hoc, cast unchecked, and wrapped in per-module boilerplate that drifts.

**Evidence:**

- context types are named *AppContext in 14 modules but *ModuleDeps in tenants/users/notifications/webhooks; auth/types.ts:321 declares its own `AppContext`, colliding with main/apps/server/src/bootstrap/context.ts:209
- some extend BaseContext and some do not (analytics/types.ts:10, status/types.ts:9, support/types.ts:9, tasks/types.ts:10, api-keys/types.ts:9); users/types.ts:83 uses Omit<BaseContext,'db'>
- TenantsModuleDeps declares mailer/appBaseUrl (tenants/types.ts:55,59) that the composition root never supplies; invitation-service.ts:128-132,167 duck-types `deps.config as {...}` and falls back to deps.email
- every scoped route adapter casts `(ctx) => ctx as XAppContext` (14 route files); compliance/legal/routes.ts, consent/routes.ts and compliance/data-export/routes.ts use `handler as RouteHandler` casts (7), against docs/dev/module-creation.md's rule on bridging casts
- handler results: tenants return raw objects (21 `Promise<object>`) with mapErrorToHttpResponse (20 sites); webhooks throw and then map; admin, billing and notifications return {status, body}; users throw
- createLogAdapter is copy-pasted in tenants/handlers/members.ts:50, roles.ts:46 and invitations.ts:29; inline ErrorMapperLogger adapters appear in tenant-crud.ts (4x), ownership.ts and webhooks/handlers.ts (7x); auth/types.ts:377 has createErrorMapperLogger
- authenticated user id is read 4 ways: request.user?.userId (53), request.user.userId (24), req.user.userId (20), getAuthenticatedUser() (11)

**Direction.** Provide one defineModule/defineHandler helper in server-system/http. It types the module context once, injects the authenticated user, standardizes error mapping and logging, and fixes one result convention. Then delete the per-module adapters and unused *Deps types.

##### CORE-13. Services and handlers bypass repositories with raw SQL; tenant creation is implemented twice

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** layering-violation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Database ownership is unclear: a table's SQL can live in a repository, a domain service or a handler. A database restructure (e.g. adding creator, content and ledger tables, or moving to a data-layer content-rating rule) has to search many places.

**Evidence:**

- 19 non-test core files import @bslt/db/builder (auth 10, users 3, admin 2, notifications 2, tenants 1, auth security events); table constants are used directly: USERS_TABLE 43 occurrences, AUTH_TOKENS_TABLE 16, SMS_VERIFICATION_CODES_TABLE 15, REFRESH_TOKENS_TABLE 11, TENANTS_TABLE 8, SECURITY_EVENTS_TABLE 8
- tenants/service.ts:106-150 createTenant inserts TENANTS_TABLE and MEMBERSHIPS_TABLE directly, while auth/personal-tenant.ts:81-88 creates tenant + membership through repos.tenants.create/repos.memberships.create; personal workspaces get no audit or activity entry
- handlers doing data access with no service: notifications/handlers.ts (repos 5, db 6), users/handlers/lifecycle.ts (repos 6), auth/handlers/webauthn.ts (repos 9), auth/handlers/totp.ts (db 8), admin/webhookHandlers.ts maps raw rows (toWebhook(row: Record<string, unknown>))
- repository bundles are rebuilt inside transactions per module: billing/service/support.ts:17-21, billing/webhooks/shared.ts:53-57, admin/billingService.ts:329
- docs/DIRECTION.md:41: 'Proposals that place logic in components or HTTP handlers are rejected'

**Direction.** Repositories own all SQL for their tables. db should expose a unit of work (`ctx.transaction(async (repos) => ...)`) so modules stop hand-assembling repository bundles. Move handler data access into services. Make auth's personal-tenant creation call a shared tenant-provisioning service that also emits tenant.created.

##### CORE-14. Duplicated logic across core, apps/server and workers

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Some duplication is a documented consequence of optional packages: retention.ts runs sweeps when workers is absent, and media is app-owned. But the logic itself is copied instead of shared, and route-policy lists in the app shell drift from core's route keys.

**Evidence:**

- PII anonymization has three implementations: core users/pii-anonymization.ts:80 anonymizeExpiredUsers (used by main/apps/server/src/bootstrap/phases/retention.ts:103), main/server/workers/src/pii-anonymization.ts:30 anonymizeDeletedUsers, main/server/workers/src/hard-ban-anonymization.ts:54 plus an inline hard-ban sweep in retention.ts
- the permanent-ban sentinel new Date('2090-01-01') appears in workers/src/hard-ban-anonymization.ts:29, core admin/userHelpers.ts:65 and apps/server retention.ts:35
- getPlanById is defined twice: billing/service/catalog.ts:8 (returns null) and admin/billingService.ts:84 (throws)
- main/apps/server/src/http/auth-route-overrides.ts:13-31 filters core routes by string keys; LOCAL_AUTH_ROUTES lists 'auth/password/change', which does not exist (password change is users/me/password, users/routes.ts:189), so that route is never strategy-filtered; OAUTH_STRATEGY_KEYS includes facebook/microsoft with no provider in auth/oauth/providers
- the media domain (handlers/service/routes/types, ~700 LOC) lives in main/apps/server/src/http/media and wraps @bslt/core/files (documented as 'app-owned, profile-gated')
- core route registry exists in two hand-maintained copies: main/server/core/src/route-modules.ts and main/editions/core/main/server/core/src/route-modules.ts.template (the app registry likewise)

**Direction.** Keep one implementation per retention job in core and let both the in-process sweeper and workers call it. Move strategy and route policy into route metadata (e.g. route.strategy = 'local') rather than string lists in the app. Generate the edition registries from a module manifest.

##### CORE-15. Adding a domain such as creators, content or ledger touches about 15-20 places

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** wiring-sprawl
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** There is no single module manifest. Registration knowledge is spread across core, shared, the app shell, editions, profiles and tooling. The scaffolder automates part of it, but the event, edition and service wiring stays manual and is easy to miss, as the billingNotifier case shows.

**Evidence:**

- the starter:feature scaffolder writes 18 files and patches 7 registries: shared/contracts/index.ts, shared/api/router.ts, core route-modules.ts, client/api index, web routes.tsx, AppLeftMenu.tsx, starterSurface.ts (main/tools/scripts/starter/feature.ts:1110-1330)
- not covered by the scaffolder: db migration + schema + repository + Repositories factory; core/package.json exports (16 subpaths; tenants, tasks, support, search, status are not exported yet are reachable through the tsconfig wildcard '@bslt/core/_' -> src/_, e.g. apps/server/src/bootstrap/phases/comms.ts:12 imports '@bslt/core/tenants'); editions/catalog.ts CORE_/PAID_SERVER_MODULES (unknown directories excluded by default); the edition route-modules template copy
- a new infrastructure service (e.g. payout or age-verification provider) needs InfraContext + IServiceContainer (duplicated field lists, main/apps/server/src/bootstrap/context.ts:62-70 and 120-176), an App getter and the App.context literal (app.ts:522-601), and a bootstrap phase
- emails need another member in the AuthEmailTemplates & BillingEmailTemplates & TenantsEmailTemplates intersection (comms.ts:31,173) and in the comms createEmailTemplates
- side effects require editing WEBHOOK_EVENT_TYPES (shared constants), ACTIVITY_TYPES, the AuditAction union, notification types, and the prune manifests

**Direction.** Introduce defineServerModule({ id, edition, routes, webhooks, subscribers, jobs, services, emailTemplates, repositories }). One registry builds route registration, the subscriber map, worker jobs, package exports and edition lists from it. Generate AppContext from declared services instead of three hand-written field lists. Extend starter:feature to emit the manifest, migration and repository.

##### CORE-16. Large files and a cross-domain admin module

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** god-file
- **Severity:** low
- **Intentional?** yes (deliberate/documented)

**Description.** The admin module is organised by role (who can call it) rather than by domain, so each domain's admin operations live outside the domain. The large-file deferral is documented; the claimed enforcement does not exist.

**Evidence:**

- files over 600 lines: notifications/handlers.ts 792 (12 handlers + unsubscribe, no service), auth/service.ts 746 (registerUser at lines 102-323, authenticateUser at 324-596), admin/userHandlers.ts 693, admin/userService.ts 668, permissions/checker.ts 648 (no runtime use), tenants/invitation-service.ts 620
- near the threshold: auth/oauth/handlers.ts 597, auth/oauth/service.ts 590, auth/oauth/providers/apple.ts 590, billing/stripe-provider.ts 588, auth/otp/service.ts 536, admin/routes.ts 531
- admin (5,498 LOC, 21 files, ~43 routes) contains users, impersonation, security events, billing plans (admin/billingHandlers.ts 487 + billingService.ts 338), tenant suspension, jobs, webhook monitoring, health, metrics and route manifest; it imports auth 11x, users 3x, billing 2x; status/handlers.ts imports admin/healthHandler
- docs/CLAUDE.md lists god files as 'defer-unless-touched'; docs/dev/module-creation.md:112 cites 'enforced hot files ... security/events.ts', but that file is now a directory and no size budget appears in eslint.config.ts

**Direction.** Give each domain its own admin sub-routes (users/admin, billing/admin, tenants/admin) behind a shared admin guard, and keep a thin admin composition. Split auth/service.ts into register and login flows. Add a real file-size budget check if one is wanted.

##### CORE-17. Core tests are split across three places and pin internal file paths

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** test-topology
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Tests are thorough, but because they import internal paths, any file-topology restructure of core will break dozens of test files that only test behaviour.

**Evidence:**

- 68 co-located *.test.ts files (~14.9k LOC) in main/server/core/src; modules with no co-located tests: activities, audit, consent, feature-flags, files
- tests/integration/api holds 68 files, 51 of which import @bslt/core; there are paired *.integration.test.ts and *.real-db.test.ts per domain (e.g. audit.integration, audit-flow.integration, audit-security.real-db)
- integration tests deep-import and vi.mock internal paths: tests/integration/auth/login-edge-cases.test.ts:20-24 (@bslt/core/auth/service, auth/utils, auth/verification/service), tests/integration/auth/handlers.test.ts:15-34, session-binding.test.ts:2-29 (@bslt/core/auth/utils/jwt, auth/security/events/index)
- composition-root wiring is not tested end to end (see the billingNotifier finding)

**Direction.** Have integration tests target module public entrypoints, or HTTP through a booted app. Add a composition-root smoke test. Agree on one naming scheme for integration versus real-DB tiers.

##### CORE-18. The same concepts go by different names across layers

- **Area:** main/server/core (@bslt/core): domain modules, layouts, cross-module links, HTTP registration, and how a new domain is added
- **Category:** naming-inconsistency
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Mismatched vocabulary makes it hard to see that pieces belong together. A rename pass for the creator fork will be noisier as a result.

**Evidence:**

- tenant (code: core/tenants, shared/core/tenant) vs workspace (user-facing strings and audit actions: tenants/types.ts ERROR_MESSAGES 'Workspace not found', 'workspace.member_added') vs organization (main/apps/web/src/features/organization)
- shared 'tenant' vs server 'tenants'; shared 'audit-log' vs server 'audit'; shared 'compliance' vs server compliance/legal + compliance/data-export + top-level consent
- 'webhooks' means outbound subscriptions (core/webhooks) and also inbound provider callbacks (billing/webhooks); 'notifications' means the core in-app module and also ctx.notifications (comms provider)

**Direction.** Pick one term per concept: tenant or workspace in code, organization in UI or not at all. Rename inbound callbacks to provider-callbacks or similar. Align shared/core and server/core folder names one-to-one.

#### CORE strengths (preserve)

- Uniform HTTP primitives: every module builds a RouteMap with createRouteMap/protectedRoute/publicRoute from @bslt/server-system/http, and one registerRouteMap loop applies the /api prefix and a single guard chain (createAuthGuard, then RLS contextualizeRequest with membership verification, then the ToS gate) in main/apps/server/src/http/router.ts:55-95 and bootstrap/context.ts:268-297.
- Interface-segregated, injectable dependencies: modules declare narrow context slices (e.g. TasksAppContext uses Pick<Repositories,'tasks'>), and services take repositories as explicit parameters (activities/service.ts). There are no module-level singletons, so everything is testable.
- Clean package-level dependency graph: @bslt/core depends only on db, server-system and shared (package.json), core imports no comms/storage/media adapters, and eslint-plugin-boundaries enforces it (eslint.config.ts:212-390).
- Contract governance: shared/api/router.ts plus audit:route-contract-coverage --fail-on-drift in audit:template keeps server routes, shared contracts and client calls in sync (168/168 coverage per docs/CLAUDE.md).
- Carefully designed best-effort side-effect primitives worth reusing as event subscribers: webhooks/emit.ts never throws; webhook dispatch is signed with retries, backoff and replay plus an SSRF target policy (webhooks/target-policy.ts); notifications/publish.ts sends only an invalidation key over the socket, never content; the billing notifier runs after commit (billing/webhooks/shared.ts:101); provider webhooks are idempotent through billing_events and WebhookEventAlreadyProcessedError.
- Billing provider abstraction (Stripe, PayPal and Mock behind billing/factory.ts) and the row-locked recordUsageWithinLimit (billing/usage-metering.ts:175-210) are the right patterns for creator payments, payouts and metered limits.
- Deep, well-tested auth: refresh-token families with reuse detection, lockout, captcha, sudo mode, liveness cache, TOTP, SMS, WebAuthn, four OAuth providers, magic link and email OTP.
- Explicit named-export barrels (no export *), extensive JSDoc, and a module scaffolder (pnpm starter:feature) with a documented module guide (docs/dev/module-creation.md); tasks/ is a generated reference module.
- A clean plugin contract already exists in the Core edition templates: InstalledServerFeature {id, routes, webhooks} with validation (authenticated relative routes, signed raw-body webhooks) in main/editions/core/main/apps/server/src/extensions/*.template. It is a good seed for a general module manifest.
- Verb-suffixed POST route keys (28 keys such as .../delete and .../update) are applied consistently across modules, because a RouteMap allows one method per path.

#### CORE inventory

| Path                                                         | Purpose                                                                                                                                                                                                                                                                                                     | Size                                             | Notes                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main/server/core/src/auth                                    | Authentication: register/login/refresh/logout, password reset, email verification, magic link, email OTP, OAuth (apple, github, google, kakao), TOTP, backup codes, SMS 2FA, WebAuthn, sudo, ToS gating, email change, devices/phone (users/me/*), lockout, captcha, security events, auth guard middleware | 15,836 LOC / 96 files; 21 test files (4,473 LOC) | handlers/ (18 files) + routes/ (6) + routes.ts + service.ts (746) + 16 loose top-level files + subfeature folders; cycle with users and api-keys; Core edition   |
| main/server/core/src/billing                                 | Plans, subscriptions, checkout, payment methods, invoices; Stripe/PayPal/Mock providers; inbound provider webhooks; dunning notifier; usage metering                                                                                                                                                        | 6,073 LOC / 40 files; 9 tests (2,264 LOC)        | Not in route-modules.ts; registered by apps/server router.ts; webhook processing writes no audit/activity/outbound webhooks; usage record functions unused; PAID |
| main/server/core/src/admin                                   | Admin console across domains: users (lock/ban/delete/reset), impersonation, security events, billing plans and Stripe sync, tenant suspension, jobs, webhook monitoring, health, metrics, route manifest, audit list                                                                                        | 5,498 LOC / 21 flat files; 8 tests               | camelCase *Handlers/*Service pairs; ~43 routes; imports auth x11, users x3, billing x2; PAID                                                                     |
| main/server/core/src/tenants                                 | Workspaces, members, invitations (+email), custom RBAC roles (bitmask), ownership transfer                                                                                                                                                                                                                  | 3,616 LOC / 14 files; 5 tests                    | handlers/ folder + flat *-service.ts; only emitter of outbound webhooks (member.added/removed); raw SQL in service.ts; PAID                                      |
| main/server/core/src/users                                   | Profile, avatar, username, sessions, password change, account lifecycle, data hygiene, PII anonymization, unverified cleanup                                                                                                                                                                                | 3,282 LOC / 17 files; 1 test                     | handlers/ folder; imports auth (cycle); retention functions also used by apps/server retention phase and workers; Core edition                                   |
| main/server/core/src/notifications                           | In-app notification feed, preferences/quiet hours, web push subscribe/dispatch, email unsubscribe, admin alerts, realtime publish                                                                                                                                                                           | 2,429 LOC / 11 files; 7 tests                    | No service.ts; handlers.ts 792 LOC; preference gate functions have no runtime callers; Core edition                                                              |
| main/server/core/src/webhooks                                | Outbound webhook endpoints CRUD, signed delivery, retry, replay, secret rotation, SSRF target policy                                                                                                                                                                                                        | 1,639 LOC / 9 files; 4 tests                     | emitWebhookEvent is called only by tenants members; no audit of endpoint changes; PAID                                                                           |
| main/server/core/src/compliance/{legal,data-export}          | Legal document publishing and user agreements; GDPR data export (JSON/CSV)                                                                                                                                                                                                                                  | 1,458 LOC / 11 files; 3 tests                    | Each has its own copy of tryAudit; exported as @bslt/core/legal and @bslt/core/data-export                                                                       |
| main/server/core/src/permissions                             | Record-level permission checker (ownership/membership/role rules)                                                                                                                                                                                                                                           | 1,020 LOC / 3 files; 719-LOC test                | No runtime consumer; apps/server middleware/permissions.ts wrapper is also unregistered                                                                          |
| main/server/core/src/feature-flags                           | Feature flags + tenant overrides + evaluation endpoint                                                                                                                                                                                                                                                      | 797 LOC / 5 files; 0 tests                       | Evaluated client-side only; flag changes not audited                                                                                                             |
| main/server/core/src/files                                   | Storage-backed file upload/list/get/delete service and routes                                                                                                                                                                                                                                               | 777 LOC / 5 files; 0 tests                       | Reused by app-owned media module in apps/server/src/http/media                                                                                                   |
| main/server/core/src/consent                                 | Consent preference records                                                                                                                                                                                                                                                                                  | 432 LOC / 5 files; 0 tests                       | Sibling of compliance/ rather than inside it                                                                                                                     |
| main/server/core/src/audit                                   | record() audit service, retention, action types                                                                                                                                                                                                                                                             | 426 LOC / 4 files; 0 tests                       | No routes (admin/auditHandlers.ts serves the list); separate from security_events and activities                                                                 |
| main/server/core/src/api-keys                                | API key create/list/revoke, bslt_ bearer authentication                                                                                                                                                                                                                                                     | 317 LOC / 5 files; 3 tests                       | Cycle with auth (auth/middleware.ts uses authenticateApiKey); not audited                                                                                        |
| main/server/core/src/activities                              | User-visible activity feed (append-only)                                                                                                                                                                                                                                                                    | 278 LOC / 5 files; 0 tests                       | Imported by Core modules auth/users although PAID; stripped from Core by text manifests                                                                          |
| main/server/core/src/{tasks,support,analytics,search,status} | Starter task CRUD (generated), support inbox, product analytics + export, admin directory search, public status page (in-memory incident log)                                                                                                                                                               | 266 / 234 / 214 / 206 / 164 LOC                  | search and status have no service.ts; status imports admin/healthHandler                                                                                         |
| main/server/core/src/route-modules.ts                        | Canonical list of 18 core RouteMap registrations                                                                                                                                                                                                                                                            | 54 LOC                                           | Billing excluded; second copy in main/editions/core/.../route-modules.ts.template; patched by prune manifests (6 edits) and starter:feature                      |
| main/server/core/src/index.ts                                | Root barrel: selected route maps, auth guard, db/system types                                                                                                                                                                                                                                               | 38 LOC                                           | Edition export filters its lines by regex                                                                                                                        |
| main/server/core/package.json                                | 16 subpath exports + root                                                                                                                                                                                                                                                                                   | —                                                | tenants/tasks/support/search/status/api-keys not exported; tsconfig paths '@bslt/core/_' -> src/_ let consumers bypass exports                                   |

#### CORE wiring points

- `main/server/core/src/route-modules.ts`: coreRouteModuleRegistrations: 18 {module, routes} entries (auth, api-keys, tasks, tenants, users, notifications, support, search, status, admin, activities, analytics, feature-flags, legal, consent, data-export, files, webhooks)
- `main/apps/server/src/http/route-modules.ts`: createAppRouteModuleRegistrations: maps core registrations, swaps in strategy-filtered auth and annotated users routes, adds realtime (dynamic import when the profile enables it), app-owned media routes and system routes (prefix ''); registerBillingWebhookRoutes as raw Fastify POST /api/webhooks/stripe and /api/webhooks/paypal
- `main/apps/server/src/http/router.ts`: registerRoutes: registerRouteMap loop with /api prefix and the authGuardFactory (createAuthGuard, contextualizeRequest, createRequireTosAcceptance with TOS_EXEMPT_PATHS); billingRoutes registered separately; webhooks when billing is enabled
- `main/apps/server/src/http/auth-route-overrides.ts`: Auth strategy filtering by route-key string sets (LOCAL_AUTH_ROUTES, OAUTH_STRATEGY_KEYS) and OpenAPI annotations for auth/login and users/me
- `main/apps/server/src/bootstrap/context.ts`: PlatformContext/DataContext/InfraContext, IServiceContainer and AppContext field lists (the handler ctx shape); contextualizeRequest (RLS user/tenant scoping with membership check)
- `main/apps/server/src/bootstrap/app.ts`: App DI container: 17 getters plus the App.context literal passed to registerRoutes (billingNotifier omitted)
- `main/apps/server/src/bootstrap/phases/comms.ts`: createAuthEmailTemplates (fallback), comms createEmailTemplates producing the AuthEmailTemplates & BillingEmailTemplates & TenantsEmailTemplates intersection, createBillingNotifier, storage, SMS and notification providers
- `main/apps/server/src/bootstrap/phases/data.ts`: Repositories, createWriteService (unused by core), search provider, queue store, contextualize (per-request scoped db + createRepositories)
- `main/apps/server/src/bootstrap/phases/retention.ts`: In-process daily retention sweeps calling @bslt/core/users functions when the workers capability is absent
- `main/server/workers/src/service.ts and scheduler/register.ts`: Scheduled jobs calling core: runRetentionCycle (audit), refreshExpiringOAuthTokens (auth), cleanupUserFiles/hardDeleteAnonymizedUsers (users), createLogExporter/flushExportBatch (analytics), createUsageSnapshot (billing), processDelivery (webhooks)
- `main/shared/src/api/router.ts + main/shared/src/contracts/contract.*.ts`: Parallel HTTP contract registry (18 domains), checked against server routes by main/tools/scripts/audit/route-contract-coverage.ts --fail-on-drift
- `main/editions/catalog.ts`: CORE_SERVER_MODULES (auth, users, api-keys, audit, compliance, consent, notifications, permissions) and PAID_SERVER_MODULES (12 others); unknown module directories are excluded from Core
- `main/editions/core/main/server/core/src/route-modules.ts.template and main/editions/core/main/apps/server/src/{http/route-modules,extensions/*}.ts.template`: Core-edition copy of the registries; featureRouteModules/registerFeatureWebhooks from InstalledServerFeature packs (main/extensions/billing, account-insights) under /api/extensions/<id>
- `main/tools/scripts/editions/export.ts`: Text surgery on core during Core export: strips logActivity blocks from auth/users handlers, filters core index.ts exports, removes billing registration from router.ts
- `main/tools/scripts/starter/prune-manifests-features.ts and prune-manifests.ts`: 27 anchored text edits into core source files (route-modules.ts, tenants/users/auth/billing handlers, admin routes/types) used by starter:prune
- `main/tools/scripts/starter/feature.ts`: starter:feature scaffolder: 18 new files and patches to shared/contracts/index.ts, shared/api/router.ts, core route-modules.ts, client/api index, web routes.tsx, AppLeftMenu.tsx, starterSurface.ts
- `main/tools/scripts/audit/route-manifest.ts`: Builds the route manifest from coreRouteModuleRegistrations plus its own special-cased register('billing', billingRoutes)
- `eslint.config.ts`: Boundaries: main/server/core is a single element allowed to import shared, server-db, server-system (and, more loosely than the docs say, server-comms and server-media); no intra-core module rules

#### CORE creator-platform notes

- Build the domain-event bus and an outbox before adding creator domains. A tip, a pay-per-view unlock or a creator-subscription start must each produce a ledger entry, an audit record, an activity, a notification, a realtime invalidation and an outbound webhook from one published event. Hand-wiring them the way tenants/handlers/members.ts does will repeat today's fragmentation in the money path.
- There is no server-side entitlement enforcement today. Usage metering, shared billing entitlements and feature flags are not checked by any server domain. Subscriber-only and pay-per-view access, and SFW/softcore separation, must be enforced at the data layer (RLS policies plus repository filters plus an entitlement preHandler), not by route roles or the UI.
- The billing domain is a SaaS model: a user subscribes to a plan through Stripe or PayPal. Fan-to-creator subscriptions, tips and payouts (including crypto) need a new ledger domain. Keep the BillingProvider abstraction (billing/factory.ts), the idempotent provider-webhook pattern (billing_events, WebhookEventAlreadyProcessedError) and recordUsageWithinLimit row locking. Do not copy the tryAudit/tryNotification handler pattern.
- For live-first features, only notifications publish realtime invalidations today (notifications/publish.ts). WriteService already offers write-then-publish with afterWrite hooks but no domain uses it. Decide whether domain events or WriteService drive realtime updates for tips, chat and live state.
- Content and media: the media domain lives in the app shell (main/apps/server/src/http/media) wrapping core/files because core cannot depend on @bslt/media. A content domain with ratings and moderation state should be a first-class core module with media processing as an adapter.
- Moderation: a moderator role already exists, and notifyAdmins targets admin+moderator (notifications/admin-alerts.ts:23). Today admin is one module organised by role. Give moderation its own domain (queue, decisions, appeals) emitting audited events, rather than growing admin/.
- Age verification: auth/attestation.ts and shared users/attestation.policy.ts exist. Check whether they fit age verification before building something new.
- The tenancy model is B2C, with a personal workspace auto-provisioned at login (auth/personal-tenant.ts). A creator could map to a tenant (membership, roles, billing admin), but tenant creation is duplicated (tenants/service.ts vs auth/personal-tenant.ts) and the naming (tenant/workspace/organization) must be settled first.
- Pick one authorization model before adding creator/fan relationships. In practice today that is route roles + the tenant role bitmask (shared/core/tenant/role.permissions.ts) + RLS. Two other models exist unused: core/permissions and realtime/permissions.
- A RouteMap allows one method per path, which produces verb-suffixed POST routes. Decide whether new creator APIs keep that convention.
- The Core/Pro edition export and starter:prune depend on 27 text anchors in core files and a second copy of the registries. A restructure of bslt-main must migrate or retire this tooling first; otherwise every file move breaks the export. The creator fork can drop editions and prune entirely, which removes much of the wiring sprawl.
- Integration tests deep-import core internals (about 54 files). Give modules stable public entrypoints before moving files, so tests and the creator fork depend on a module API rather than on file paths.
- For future TypeScript platforms, separate a reusable platform kernel (identity/auth, users, tenants, audit and events, notifications, outbound webhooks, files, entitlements) from product modules (billing plans, support, tasks, analytics), using a defineServerModule manifest so each product fork composes modules instead of editing registries.

#### CORE open questions

- Must the Core/Pro edition export (main/editions, main/extensions) and the starter:prune manifests keep working through the bslt-main restructure, or can they be frozen or retired? They are the biggest constraint on moving core files.
- Is the billingNotifier omission from App.context known? Is there a deployment where dunning emails are confirmed to fire? This was found by reading code and has not been verified at runtime.
- Which authorization model is canonical: route roles + tenant RBAC bitmask + RLS (what runs), or the record-level checker in core/permissions (tested, but with no runtime use)?
- Is WriteService (Chet-stack style write-then-publish) intended as the standard mutation path for domain modules, or is it legacy?
- Should audit_events and security_events become one stream with categories, or do they stay separate for retention or compliance reasons (audit/retention.ts)?
- Should billing provider events emit the advertised subscription.* and invoice.* outbound webhooks? Is this product intent or an unfinished feature?
- Should media and content remain app-owned capabilities in apps/server, or become core domains with @bslt/media as an optional adapter?
- Which term should code use for the tenant concept (tenant, workspace or organization)? For the creator platform, does a creator map to a tenant?

### B.SHR. main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers

**Summary.** @bslt/shared is about 40.6k LOC across 262 source files, with about 40.2k LOC of colocated tests. It has zero runtime dependencies and is organized by layer, not by feature: primitives (constants/ 2.6k, helpers/ 1.35k, schema/ 0.76k), api/ (router types, 240 LOC), contracts/ (4.4k: 18 HTTP contract files plus server ports, request context and the native bridge) and modules/{system 7.7k, core 13.9k, db 4.1k, comms 3.0k, realtime 0.85k, media 0.8k, storage 0.5k, workers 40}, which the README says mirror main/server/*. Inside the package, layering is enforced well. Every directory has an index.ts, barrels use named exports only (0 `export *`), and eslint-plugin-boundaries stops primitives from importing upward. But the package has become a dumping ground. By consumer analysis, about 30% of it (env config, HTTP/proxy/cookie parsing, rate limiting, CSP, metrics, health checks, the SQL search DSL, the pub/sub subscription manager, media sniffing via Buffer) is used only by server packages. UI-only display, form, breakpoint and localStorage token-store code also lives here. Shared still compiles with Node types. About 45% of unique public symbols (899 of 1,986) have no consumer outside the package. Schemas are single-sourced: almost no createSchema exists outside shared, and server and client import the same schema objects. Endpoint identity is not. Method and path are written separately in the server route map, in the shared contract and in hand-written client methods. apiRouter is consumed only by audit and docs tooling, and the "generated" client comes from the server route manifest, returns unknown, and is unused. The custom schema system has no object combinator, so 416 schemas are hand-written parsers typed against separately declared interfaces. Duplicated rules have already diverged: two username policies are enforced at different server boundaries, and there are three error-code vocabularies, three response-envelope type sets and two parallel authorization models. One feature (for example webhooks) touches 23 shared files across constants, ids, env config, admin schemas, contracts and five barrels. The prune manifests and the feature scaffolder have to text-edit all of them, which is the "fragmented, not one ecosystem" symptom in concrete form.

#### Findings

##### SHR-01. Endpoint identity is triple-sourced; shared contracts are audit and docs artifacts, not the wiring source

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** coupling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Request and response schemas are defined once in shared and imported by both server and client, which is good. The endpoint itself (method, path, response pairing, envelope) is written three times: the server route map, contracts/contract.*.ts, and hand-written client/api methods. The contract objects have no runtime role. They exist so audits can cross-check the other two copies and so docs can be generated. Adding or renaming an endpoint therefore means editing three packages plus apiRouter and contracts/index.ts. The stated direction (contracts as source of truth, generated typed clients) was never finished.

**Evidence:**

- main/shared/src/api/router.ts:32-53 apiRouter: only consumers outside shared are main/tools/scripts/audit/route-contract-coverage.ts:17, main/tools/scripts/audit/api-response-sync.ts:23, main/tools/scripts/docs/generate-api-docs.ts:28 (grep of main/apps, main/server, main/client finds no runtime use of any *Contract object; the only hit is a local type AdminGetContract in main/server/core/src/admin/routes.ts:149)
- Server registers literal paths: main/server/core/src/users/routes.ts:138-361 ('users/me', 'users/me/update', ...) and imports request schemas directly from @bslt/shared/core/users (lines 23-34)
- Contract repeats them: main/shared/src/contracts/contract.users.ts:38-56 path '/api/users/me', '/api/users/me/update'
- Client repeats them a third time: main/client/api/src/api/client.ts:624-700 ('/auth/login', '/auth/register', '/users/me', ...) with response schemas imported from shared
- Generated client is built from the server route manifest, not contracts: main/client/api/src/generated/client.ts header ('Source: route definitions registered via route-manifest'); request() returns Promise<unknown> (line ~318); createGeneratedApiClient is exported (main/client/api/src/index.ts:234) but used by no app
- Type helpers meant for contract-driven clients are dead: main/shared/src/api/api.ts SuccessResponse/RequestBody/InferResponseData; 12 of 14 api.ts exports have no consumer outside shared
- Drift is held at zero only by tooling: route-contract-coverage run reports 209 routes, 34 exempt, 175 audited, 0 missing contracts/clients/method mismatches
- docs/architecture/api-contract-standard.md rule 5 ('Route path strings should be derived from contract constants, not duplicated in handlers/clients') is not followed; docs/DIRECTION.md:20 says custom schemas plus generated clients are the API source of truth

**Direction.** Make the contract entry the only definition of an endpoint. Have server route registration consume contract entries (method, path, body/query schema, auth level) and derive path strings from them. Generate or derive typed client methods from contracts, using the existing InferResponseData/RequestBody helpers, so client/api stops hand-coding paths. Keep route-contract-coverage as a guard. Retire the manifest-derived untyped generated client.

##### SHR-02. Features are sliced horizontally: one domain is spread over constants, ids, env, modules, contracts and five barrels

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Shared is organized by technical layer (constants / schema / modules / contracts / config) instead of by capability. To understand or change one feature you have to open files in 5-8 directories. To remove one, the prune tool must do anchor-based text surgery on aggregate barrels. This is the main structural reason the codebase feels like disconnected features rather than one system, and it will directly increase the cost of the fork's 'remove irrelevant features' step.

**Evidence:**

- Webhooks prune manifest deletes 4 shared paths and edits 19 shared files: main/tools/scripts/starter/prune-manifests-features.ts:633-940 (api/router.ts, constants/index.ts, constants/system/{comms,index,limits,platform}.ts, contracts/{index,contract.admin}.ts, src/index.ts, modules/comms/index.ts, modules/core/{index,admin/index,admin/admin.schemas(.test)}.ts, modules/system/config/{index,env.validation}.ts, schema/{ids,ids.test,index}.ts)
- Activities prune edits api/router.ts, contracts/index.ts, modules/core/index.ts, src/index.ts, schema/ids.ts, schema/index.ts (prune-manifests-features.ts:10-70)
- Feature scaffolder writes modules/core/<x>/<x>.schemas.ts, modules/core/<x>/index.ts and contracts/contract.<x>.ts, then patches contracts/index.ts and api/router.ts: main/tools/scripts/starter/feature.ts:139,240,260,1208-1232
- A domain's vocabulary sits in constants/core/<x>.ts or constants/system/<x>.ts, its branded ID in schema/ids.ts, its env in modules/system/config/env.<x>.ts, its schemas in modules/<cap>/<x>/, and its endpoints in contracts/contract.<x>.ts (some contracts also define schemas inline, e.g. 10 createSchema calls in contracts/contract.compliance.ts)

**Direction.** Restructure shared into vertical feature slices, e.g. shared/src/features/<domain>/{ids,constants,schemas,contract,errors,display?}.ts with one index per slice, plus a small primitives kernel (schema, ids helper, time, http status, regex). Generate the aggregate router and barrels from the slice list, or drop them. Pruning a feature then means deleting a folder and one registry line.

##### SHR-03. Shared is a dumping ground: about 30% is server-only runtime code, some is client-only UI code, and 'runtime-agnostic' is not enforced

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** layering-violation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The README and layer-map describe shared as 'contracts, schemas, environment-agnostic helpers'. In practice it also holds server runtime implementations (rate limiter, proxy IP trust, CSP policy, metrics collector, SQL search DSL, Postgres pub/sub manager, health checks, media sniffing) and browser UI presentation. Every consumer pulls a much larger surface than it needs, the boundary between 'shared vocabulary' and 'implementation' is gone, and the 'mirror' of server/* duplicates package responsibilities. Some of this is documented (ports and env schemas, principles.md:299; layer-map rows for contract.ports/native), but the runtime implementations are not.

**Evidence:**

- Consumer map from main/tools/scripts/audit/shared-export-usage.ts (run read-only): modules/system/config/env.*.ts (~2.7k LOC) consumed only by server/system, server/core, server/workers, server/comms, apps/server; FrontendEnvSchema (env.frontend.ts:32) has no consumer in apps/web
- modules/system/http/{cookies,csrf,multipart,proxy,request}.ts used only by apps/server; modules/system/security/{input,rate.limit,sanitization,headers}.ts only by apps/server; security/ip.ts only by server/system/src/security/ip-blocklist.ts; security/csp.ts by tests/audit only
- modules/system/observability/metrics.ts (522 LOC, MetricsCollector) and modules/system/cache/* used only by server/system and server/core; modules/system/runtime/health.ts uses process.uptime() (line 353)
- modules/db/search/* (2.16k LOC) only server/db; db/pubsub/subscription.manager.ts (384) only server packages; db/pagination/cursor.ts uses Buffer (lines 127,140); modules/media/media.ts uses Buffer (line 145) and is server-only; modules/realtime/realtime.ts (798) consumed only by server/realtime
- contracts/context.ts, contracts/contract.ports.ts (506), contracts/edition-ports.ts, core/billing/billing.service.types.ts, billing.errors.ts, helpers/postgres-dsn.ts, helpers/parse.ts (env-string parsing), constants/config.ts (ARGON2_DEFAULTS, DB_DEFAULTS, SMTP_DEFAULTS, S3_DEFAULTS, COURIER_DEFAULT_API_URL) are server-only
- Client-only code in shared: *.display.ts (billing 217, admin 86, audit.log 46, membership 47, activities 17, notifications 24), core/billing/billing.form.ts, constants/breakpoints.ts (client/react, client/ui), constants/core/ui.defaults.ts (client/engine), modules/system/security/crypto.ts (localStorage token store, apps/web only), system/http/user.agent.ts (client/ui only)
- main/shared/tsconfig.json extends ../../config/tsconfig.node.json with types:['node'], so Node globals compile in a package the README calls free of Node runtime concerns

**Direction.** Split responsibilities. (1) An isomorphic contracts kernel: wire DTO schemas, enums, ids, error codes, endpoint contracts, compiled without Node types (lib es2022 + dom-free) so Buffer/process fail the build. (2) Move server runtime pieces to their owners: http/security/observability/runtime/cache to server/system, search/pubsub/pagination internals to server/db, media sniffing to server/media, realtime transaction engine to server/realtime, env schemas to server/system/config, unless the fork needs client-side env typing. (3) Move display, label and tone helpers and breakpoints to client/ui or a dedicated presentation subpath.

##### SHR-04. Large dead surface: 899 of 1,986 unique public symbols have no consumer outside shared, including whole subsystems

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** dead-code
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Nearly half the public API is unused, and much of it is kept alive only by colocated tests, so it looks maintained. This inflates the surface the restructure must carry, misleads readers about what the platform actually uses (for example a fluent search DSL and a Result monad that nothing calls), and adds edit points for prune and rename tooling.

**Evidence:**

- shared-export-usage audit (repo-wide, read-only run): 156 public modules / 4,633 export entries (aliases double-count), 3,438 with no external consumer; deduplicated by declaration: 1,986 unique symbols, 899 never imported outside main/shared/src
- modules/db/search/query.builder.ts (738 LOC): SearchQueryBuilder/createSearchQuery have 0 references outside shared; modules/db/search/schemas.ts 26/26 exports unused
- helpers/result.ts (265 LOC): ok/err/andThen/fromPromise/unwrapOr/isOk have 0 references outside shared, yet are re-exported from the root barrel (src/index.ts)
- modules/comms/email/email.ts (270 LOC): 14/14 exports unused; modules/core/jobs/batched.queue.ts (254) and reactive.map.ts (153): BatchedQueue/ReactiveMap 0 external references
- contracts/contract.native.ts NativeBridge and healthContract: 0 consumers; cacheAside: 0
- modules/core/users/users.permissions.ts: canUser/isAdmin(user)/isModerator(user) are not exported by users/index.ts:58 and are unused; billing.logic.ts:121 hasActiveSubscription is not exported (billing/index.ts:171 exports the entitlements variant) but is still covered by billing.logic.test.ts:389
- schema/ids.ts: 31 of 41 exports unused externally; schema/parsers.ts 13/14 (internal building blocks published as API)

**Direction.** Before restructuring, run shared-export-usage (--report) as a CI budget. Delete unreferenced subsystems (search query builder, Result helpers, email schemas, batched queue, reactive map, native bridge) or move them into an explicitly labelled incubator folder outside the public exports. Stop publishing internal parsers through subpaths. Delete tests that only pin dead code.

##### SHR-05. Duplicated validation rules have diverged: two incompatible username policies enforced at different server boundaries

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** duplication
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** A user can self-select a 16-30 character username that the admin create endpoint would reject, and that adminUserSchema would fail to parse if any consumer validates admin responses through the contract. An admin can create '123abc', which the self-service rule forbids. This is a concrete example of the 'same concept defined in several places' problem producing behavior bugs, not just clutter. Usernames and handles are core identity for a creator platform.

**Evidence:**

- main/shared/src/modules/core/schemas.ts:30 local USERNAME_REGEX_LOCAL /^[a-zA-Z0-9_]{1,15}$/ and usernameSchema at :49-56 (1-15 chars, digit-first allowed)
- Used by admin create-user body validation: modules/core/admin/admin.schemas.ts:465 (adminCreateUserRequestSchema) registered at main/server/core/src/admin/routes.ts:247; and by the adminUserSchema response at admin.schemas.ts:296 (contract.admin.ts:94)
- Self-service policy: modules/core/users/username.schemas.ts:43 local USERNAME_REGEX /^[a-z][a-z0-9_]{1,29}$/ (2-30, letter-first) in updateUsernameRequestSchema (:62) registered at main/server/core/src/users/routes.ts:166
- constants/regex.ts:17-19 defines both REGEX_PATTERNS.USERNAME (2-30) and USERNAME_LOCAL (1-15), but neither schema imports them
- Byte-identical copies: RESERVED_USERNAMES at constants/core/iam.ts:57 and users/username.schemas.ts:16 (23 entries, diff identical)

**Direction.** Define one handle/username policy (regex, length, reserved list, normalization) in the users slice and reference it from every schema (admin create, admin response, self-service update, registration). Delete the local regex copies in core/schemas.ts and username.schemas.ts and the duplicate RESERVED_USERNAMES.

##### SHR-06. Three error-code vocabularies and three response-envelope type sets; contracts mix wrapped and raw 200s

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Clients cannot rely on one error-code space or one envelope convention. The same name (ApiResponse, ERROR_CODES, ErrorCode) means different things depending on the import path, and the root barrel exports the SCREAMING ERROR_CODES while @bslt/shared/system exports the 'system.*' one.

**Evidence:**

- constants/system/errors.ts:9-43 ERROR_CODES (SCREAMING; RESOURCE_NOT_FOUND maps to 'NOT_FOUND'), used by server auth paths (e.g. ERROR_CODES.INVALID_CREDENTIALS)
- modules/system/errors/errors.ts:4-17 a second ERROR_CODES ('system.validation', 'system.not_found', ...) plus ErrorCode type, used as AppError defaults (lines 385-601)
- api/api.ts:12-41 a third ErrorCode string union containing codes in neither ('RESOURCE_NOT_FOUND', 'TOKEN_EXPIRED', 'PAYMENT_FAILED', 'INSUFFICIENT_ENTITLEMENTS', 'TOS_ACCEPTANCE_REQUIRED', 'NETWORK_ERROR')
- modules/system/http/response.ts:136 errorCodeSchema validates against the SCREAMING set, so it would reject AppError's 'system.*' codes; it has 0 consumers outside shared
- Envelope types: api/api.ts ApiResponse(success-only)/ErrorResponse/ApiResult; helpers/response.ts ApiSuccessResponse/ApiErrorResponse/ApiResponse (same name, union meaning); modules/system/http/response.ts SuccessResponseEnvelope/ErrorResponseEnvelope/ApiResultEnvelope
- Contract 200s: contract.tenants.ts 21/21 raw, contract.files.ts 5/5 raw, contract.admin.ts 37/38 wrapped, contract.users.ts 12/13 wrapped ('me' raw at contract.users.ts:42)
- docs/specs/errors.md:128 accepts system.* as the baseline (partially documented)

**Direction.** Keep one namespaced error-code registry that each feature can extend (e.g. 'auth.invalid_credentials'), one envelope type and schema, and one rule for whether 200 responses are wrapped, applied by a contract helper such as ok(schema) instead of by hand. Delete helpers/response.ts and the api.ts union, and generate the client error union from the registry.

##### SHR-07. Custom schema system lacks object/optional combinators: types and validators are written twice and object parsing is hand-rolled hundreds of times

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** duplication
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** Zero dependencies and a custom schema system are deliberate (docs/DIRECTION.md:20). The cost of the current minimal API is that every DTO is declared twice (interface plus imperative parser), which makes up much of shared's size (admin.schemas.ts alone is 983 LOC). Reviews must check that parser and interface match field by field. No JSON Schema or OpenAPI can be derived for docs or client generation.

**Evidence:**

- schema/factory.ts (35 LOC) createSchema and schema/types.ts Schema<T> are the whole core; composite.ts offers enum/brand/array/literal/union but no object combinator
- 416 'export const xSchema: Schema<X>' declarations typed against 607 separately declared interfaces; only 2 InferSchema<> uses in shared
- 484 createSchema call sites; 291 copies of the '(data !== null && typeof data === 'object' ? data : {})' coercion (e.g. users.schemas.ts userSchema at ~line 205)
- schema/parsers.ts:136 parseObject and :259 parseRecord are identical
- Optional interface fields that a hand-written parser forgets are silently dropped (parsers build fresh objects); non-object input coerces to {} and fails on the first field rather than with 'must be an object'
- Only 1 createSchema outside shared (main/apps/web/src/lib/consent/model.ts), so schemas are single-sourced across packages

**Direction.** Keep the zero-dependency design, but add declarative combinators (object/shape, optional, nullable, nullish, array, record, enum, brand, default, refine) whose inferred type replaces the hand-written interface (type X = InferSchema<typeof xSchema>). Codemod existing parsers slice by slice. Optionally implement the Standard Schema interface and add a toJsonSchema walker to feed docs, OpenAPI and typed client generation.

##### SHR-08. Constants sprawl: arbitrary core/system split, alias shim files and copy-pasted values

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Constants are grouped by a 'core vs system' axis that no longer matches anything, carry compatibility shims from an earlier reorganization, and repeat values that have already drifted (storage and notification providers). Pruning webhooks has to edit 5 constants files.

**Evidence:**

- constants/system/platform.ts:103-121 re-aliases 15 constants from comms/jobs/log/http (HTTP_STATUS, EMAIL_PROVIDERS, JOB_STATUSES, LOG_LEVELS, ANSI, ...); constants/system/logger.ts only aliases log.ts; constants/system/errors.ts:6 re-aliases HTTP_STATUS; constants/core/i18n.ts:19-25 only aliases constants/system/i18n.ts
- platform.ts is imported through the non-public specifier @bslt/shared/constants/system/platform (4 consumers, flagged by the shared-export-usage audit)
- Split by unclear criteria: constants/core/geo.ts (geo headers) vs constants/system/geo.ts (COUNTRIES, US_STATES, web-only); core/notifications.ts vs system/comms.ts
- Copies: MAX_UPLOAD_FILE_SIZE/MAX_CHUNK_SIZE/MAX_UPLOAD_TIMEOUT_MS/MAX_FILENAME_LENGTH in constants/media.ts:250-259 and constants/system/limits.ts:130-132; DEFAULT_PAGE_LIMIT/DEFAULT_SORT_BY in limits.ts:59-61 and db/pagination/pagination.ts:33-34; NOTIFICATION_LEVELS in constants/core/notifications.ts:35 and comms/notifications/notifications.schemas.ts:43; PROTECTED_FIELDS identical in constants/core/policy.ts:12 and modules/realtime/realtime.ts:178; local regex copies in modules/core/schemas.ts:30,86-90 duplicating constants/regex.ts
- Provider enums drift: STORAGE_PROVIDERS ['local','s3','gcs'] (constants/media.ts:187, re-exported by server/db) vs CONFIG_STORAGE_PROVIDERS ['local','s3'] (constants/config.ts:64) vs StorageProviderName (env.storage.ts); NOTIFICATION_SCHEMA/ENV_PROVIDERS redeclared locally in env.notification.ts:245,281; BillingProvider in billing.schemas.ts:40 and env.billing.ts:27; EMAIL_PROVIDERS (4 values) vs env.email provider 'console'|'smtp'
- constants/index.ts re-exports only BILLING_PROVIDERS from constants/core, so most core constants are reachable only through @bslt/shared/constants/core

**Direction.** Move domain constants into their feature slice. Keep a small cross-cutting primitives set (time, http status, regex, limits that are truly global). Codemod imports off the alias files and delete platform.ts, logger.ts and core/i18n.ts. Derive provider unions from one tuple per provider type and reference it from env schemas.

##### SHR-09. Subpath export and alias sprawl: the shared module map is restated in package.json, about 27 tsconfigs and about 14 vitest configs

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** wiring-sprawl
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Because subpaths do not map 1:1 to folders (@bslt/shared/core resolves to src/modules/core, @bslt/shared/constants to src/constants), every resolver (Node exports, tsc paths, Vite and Vitest) needs a hand-maintained translation table. verify-shared-exports.ts and the alias audits exist to stop these copies drifting. This raises the cost of renaming the scope for the fork and of moving any folder.

**Evidence:**

- main/shared/package.json exports: 36 keys including duplicate aliases ./config and ./system/config (same folder; 4 vs 73 imports) and ./constants/system and ./system/constants; wildcards (./constants/_, ./helpers/_, ./schema/_, ./contracts/_, ./config/_, ./system/config/_, ./system/security/_, ./system/constants/_) make every file public (156 public modules per audit)
- Missing keys that code and docs use: ./workers (imported type-only at main/server/workers/src/types.ts:12, resolved only via main/server/workers/tsconfig.json:16, and recommended by docs/architecture/layer-map.md); ./api (named in docs/architecture/api-contract-standard.md)
- Root tsconfig.json:6-23 path map plus @bslt/shared paths in 27 tsconfig*.json files (e.g. main/server/realtime/tsconfig.json has 21 lines)
- Vitest aliases: helper main/tools/scripts/audit/shared-vitest-aliases.ts imported by ~12 vitest configs, plus hand-written regex aliases in main/server/core/vitest.config.ts (19 shared/src lines), main/server/system/vitest.config.ts, tests/vitest.config.ts
- Non-public specifiers in use: @bslt/shared/modules/system (tests/integration/api/data-hygiene.integration.test.ts:24, data-hygiene.real-db.test.ts:27)
- Root cause is stated in main/server/core/vitest.config.ts comments: subpaths mix top-level folders (constants, schema, contracts) with src/modules/* roots

**Direction.** Flatten the layout so each public subpath is a folder with an index (src/<subpath>/index.ts) and the exports map is one wildcard plus root. Remove duplicate aliases and leaf-file wildcards. Resolve workspace packages through the package.json 'source' condition instead of per-package tsconfig paths and vitest aliases, then delete those tables.

##### SHR-10. Authorization vocabulary is split across six files with two permission models; the 'central' policy is unused

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** There are two parallel permission models (string permissions with role levels, and tenant bitmasks), two isModerator functions with different semantics, and a documented 'central' policy that nothing calls. Moderation and creator/fan role separation will be built on this layer.

**Evidence:**

- constants/core/iam.ts:20-34 TENANT_ROLES, ROLE_LEVELS, PERMISSIONS (string 'resource:action')
- modules/core/auth/auth.policy.ts:44 can() ('The Big Can - Centralized logic for every authorization check') and :104 hasPermission(ctx, permission)
- modules/core/tenant/role.permissions.ts:25 TENANT_PERMISSIONS bitmask, :67 hasPermission(mask, bit), :109 resolveMemberPermissions
- modules/core/users/users.permissions.ts:56-70 hasRole/isAdmin(user)/isModerator(user) (moderator excludes admin) vs modules/core/users/users.roles.ts:18-24 isAdmin(role)/isModerator(role) (moderator includes admin)
- Outside shared: can, canUser, PERMISSIONS, ROLE_LEVELS and permissionSchema have 0 imports; real enforcement uses the tenant bitmask (apps/web/src/features/organization/components/RolesTab.tsx:12) and a separate main/apps/server/src/middleware/permissions.ts:472 hasPermission(request)

**Direction.** Consolidate into one authz slice: platform roles, tenant or creator roles, one permission registry (bitmask or string, not both), and one policy function used by server middleware and UI gating. Delete the unused can/canUser/ROLE_LEVELS/PERMISSIONS layer.

##### SHR-11. Live/realtime contract fragmented across db/pubsub, modules/realtime and contracts; excluded from router and coverage

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The live layer, the main capability for a live-first platform, has no single home. Its protocol types are filed under 'db', its HTTP contract is duplicated, and it sits outside the governance that keeps other endpoints in sync. File transfer endpoints are exempt too.

**Evidence:**

- WebSocket wire protocol (ClientMessage/ServerMessage, SubscriptionKey, a local 'WebSocket' interface that shadows the DOM name) lives in modules/db/pubsub/types.ts:11-40; apps/web/src/lib/realtime.ts:27 imports it from @bslt/shared/db
- realtimeContract defined twice: modules/realtime/realtime.ts:456 and contracts/contract.realtime.ts:15, exported from both modules/realtime/index.ts:17 and contracts/index.ts:24
- realtimeContract and healthContract are not in apiRouter (api/router.ts:32-51); main/tools/scripts/audit/route-contract-coverage.ts:71-74 exempts the whole 'realtime' and 'files' modules
- modules/realtime/realtime.ts (798 LOC) is consumed only by server/realtime; no client package uses the transaction contract
- The web socket protocol carries invalidations only ({type:'update', key, version}), per apps/web/src/lib/realtime.ts header

**Direction.** Create one 'live' slice that owns channel and key conventions, WS client and server message schemas (validated, not just typed), the transaction contract, and event payload schemas. Register it in the router and drop the realtime and files exemptions from coverage once contracts exist.

##### SHR-12. Entity models duplicated across layers, with persistence shapes mixed into shared; branded IDs barely adopted

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** db-schema
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Shared mixes wire DTOs (ISO strings) with DB row and insert shapes (Date, secrets), while server/db and server/core keep their own copies. Mapping between the three is manual, and the branded-ID safety net exists only inside shared. A database restructure will have to update each shape by hand.

**Evidence:**

- User x3: main/shared/src/modules/core/users/users.schemas.ts:40 (ISO strings, branded UserId), main/server/db/src/schema/users.ts:36 (Date, passwordHash, plain string id), main/server/core/src/users/service.ts:24 (third shape)
- Same for Plan/Subscription/Invoice (shared billing.schemas.ts:110-183 vs server/db/src/schema/billing.ts:69-230), Tenant, Notification, Job, Webhook
- Shared also defines persistence-shaped entities and inputs with Date fields in 21 files, e.g. comms/webhooks/webhooks.ts:40-97 (Webhook incl. secret, CreateWebhook, UpdateWebhookDelivery); core/activities/activities.schemas.ts and core/audit-log/audit.log.schemas.ts are consumed only by server/db
- core/jobs/jobs.ts carries Job, DomainJob and JobDetails, plus QueueJob in contracts/contract.ports.ts:252 and ScheduledTask in modules/workers/workers.ts
- Session (users.schemas.ts:173) vs UserSession (auth/auth.sessions.schemas.ts:39)
- Branded IDs: TenantId used in 0 files outside shared, UserId in 5; 479 'userId: string' and 275 'tenantId: string' declarations across packages; OrganizationId and TenantId both exist for one concept (schema/ids.ts)

**Direction.** Keep only wire DTOs and enums in shared. Move row and insert types to server/db (ideally generated from migrations) with explicit mappers in server/core. Either adopt branded IDs at every boundary for new domains, starting with the creator platform, or remove them. Pick one of OrganizationId and TenantId.

##### SHR-13. Barrel overhead and a root barrel used mainly by tests

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** god-file
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** Hand-maintained named-export barrels keep the package honest (no export *), but they are a large, change-heavy surface that every feature add or remove must touch, and the root barrel is mostly a test convenience.

**Evidence:**

- 50 index.ts files totalling 3,989 LOC (~10% of shared src)
- src/index.ts (371 LOC) exports 357 symbols, 56 used externally; all 37 apps/web files importing '@bslt/shared' are _.test._ or **tests**/utils.tsx; production root consumers are tools (apiRouter) plus a few client/api and server/db/media files
- modules/comms/index.ts exports 126 symbols, 8 used externally (not curated, unlike modules/core/index.ts which documents 'only symbols consumed'); modules/system/index.ts 170; schema/index.ts 70 (10 used)
- Prune manifests rely on text anchors inside these barrels (e.g. prune-manifests-packages.ts:315 anchor "export { realtimeContract } from './contract.realtime';")

**Direction.** After vertical slicing, keep one index per slice and generate any aggregate. Drop the root barrel, or limit it to primitives, and point tests at slice subpaths.

##### SHR-14. Utility logic implemented more than once; misleading file names

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** duplication
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** These are small duplicates, but they show that shared has no single owner per concern, and they make security-relevant logic (IP trust, key sanitization) harder to audit.

**Evidence:**

- IPv4 CIDR twice: modules/system/security/ip.ts:20-63 (ipv4ToInt/parseIpv4Cidr/isIpv4InCidrRange, used by server/system ip-blocklist.ts) vs modules/system/http/proxy.ts:46-240 (parseCidr/ipMatchesCidr with a private ipv4ToNumber) plus constants/regex.ts IP_V4
- Prototype-pollution key guards three times with different lists: helpers/object.ts:10 DANGEROUS_KEYS and :193 isSafeObjectKey; modules/system/security/input.ts:258 isValidInputKeyName (adds tostring/valueof); security/sanitization.ts
- calculateCursorPaginationMetadata with different signatures in db/pagination/pagination.ts:269 and db/pagination/helpers.ts:117
- hasActiveSubscription in billing.logic.ts:121 and billing.entitlements.ts:197 (different semantics)
- generateToken also in main/server/system/src/security/token.ts:49; server calls timingSafeEqual directly at 17 sites instead of shared constantTimeCompare
- modules/system/security/crypto.ts contains no crypto: it is a localStorage token store and addAuthHeader (browser), colliding by name with helpers/crypto.ts (generateToken/constantTimeCompare)

**Direction.** Keep one implementation per concern (an ip slice with v4 and v6 CIDR, one safe-key guard), and rename security/crypto.ts to client token-store and move it to the web or client layer.

##### SHR-15. Oversized, mixed-responsibility files

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** god-file
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Large files with mixed concerns hide dead exports and make vertical slicing harder.

**Evidence:**

- modules/core/admin/admin.schemas.ts 983 LOC (38 of 92 exports unused externally)
- contracts/contract.auth.ts 828 LOC (63 endpoints)
- modules/comms/notifications/notifications.push.schemas.ts 817 LOC, which re-aliases 17 types from notifications.types.ts (354 LOC) as Shared*
- modules/realtime/realtime.ts 798, db/search/schemas.ts 756, db/search/query.builder.ts 738, modules/system/errors/errors.ts 657
- modules/core/jobs/jobs.ts mixes types, schemas, domain logic (canRetry, calculateBackoff) and UI display (getJobStatusLabel/Tone at :387-392)

**Direction.** Split per slice into schemas / logic / display; drop dead halves first.

##### SHR-16. Inconsistent naming conventions for files, modules and UI tone vocabularies

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** naming-inconsistency
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Inconsistent naming makes files hard to find and blurs where things belong. The tone mismatch leaks into UI badge consistency.

**Evidence:**

- Folder kebab vs file dots: modules/core/feature-flags/feature.flags.ts, audit-log/audit.log.*.ts, usage-metering/usage.metering.ts; vs kebab files api-keys.schemas.ts, contracts/contract.api-keys.ts vs contract.feature.flags.ts, contracts/edition-ports.ts, helpers/postgres-dsn.ts, system/cache/cache-aside.ts; camelCase comms/webhooks/webhookUrl.ts
- Suffix roles inconsistent: .schemas/.types/.logic/.display/.policy/.permissions/.errors/.form vs bare jobs.ts, files.ts, media.ts, realtime.ts, webhooks.ts that mix everything
- Near-collisions: core/auth/auth.session.logic.ts vs auth.sessions.logic.ts; auth.webauth.schemas.ts vs auth.passkey.schemas.ts
- Misleading module names: 'db' holds pagination/search/pubsub (no DB code); 'contracts' holds HTTP contracts, server DI ports, request context and the native bridge
- UI tone vocabularies differ: billing.display.ts:20 StatusVariant 'success'|'warning'|'error'|'neutral' vs admin.display.ts:24 and jobs.ts:392 'info'|'success'|'warning'|'danger'

**Direction.** Adopt one convention for the new topology (kebab-case files, fixed per-slice file roles), rename 'db' to 'data' or split it, separate 'ports' from 'contracts', and use one shared Tone type for all display helpers.

##### SHR-17. Stale docs and config describing the old shared layout

- **Area:** main/shared (@bslt/shared): src/{api,constants,contracts,helpers,schema,modules/*}, package.json subpath exports, custom schema system, contracts/apiRouter and their consumers
- **Category:** docs
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Docs and lint config describe a topology that has since moved, which misleads both humans and agents working from docs/CLAUDE.md.

**Evidence:**

- main/shared/README.md lists src/config/ (actual: src/modules/system/config) and says the root barrel may use export * (DIRECTION.md:388 says the count is 0)
- eslint.config.ts:235 boundary element 'shared-config' targets main/shared/src/config, which does not exist, so the rule at :340 never applies
- docs/architecture/api-contract-standard.md (2026-02-12) references @bslt/shared/api (no such export), an 'auditLog' router domain, and envelope schemas in modules/core/schemas.ts (now system/http/response.ts)
- docs/architecture/layer-map.md recommends @bslt/shared/workers (not in package.json exports)
- docs/DIRECTION.md:420 and docs/specs/principles.md:296 require 'pnpm audit:api-contract-sync:strict', which no longer exists (absorbed into route-contract-coverage / audit:api-governance:strict per route-contract-coverage.ts:9-11)
- docs/DIRECTION.md:385 states 'no structural refactor is needed', which conflicts with the current restructure goal
- main/shared/package.json declares license MIT, publishConfig.access public and repository github.com/bslt/bslt for a private repo

**Direction.** Rewrite the shared README, layer-map and api-contract-standard after the restructure. Fix or remove the shared-config boundary element. Update the audit command names in DIRECTION and principles. Decide on publish metadata.

#### SHR strengths (preserve)

- Zero runtime dependencies (main/shared/package.json has only devDependencies). The custom Schema<T> core is tiny (schema/factory.ts 35 LOC, types.ts 47 LOC), portable, and has no third-party lock-in; this is documented in docs/DIRECTION.md:20.
- Schemas are effectively single-sourced. Only 1 createSchema exists outside shared (apps/web/src/lib/consent/model.ts), and server routes (e.g. main/server/core/src/users/routes.ts:23-34) and client/api (main/client/api/src/api/client.ts:4-30) import the same schema objects.
- DB row types reuse shared enum vocabularies instead of redeclaring them (main/server/db/src/schema/*.ts import UserRole, OAUTH_PROVIDERS, NOTIFICATION_LEVELS, INVITATION_STATUSES, etc. from @bslt/shared). This is a natural seam for content-rating and payout enums.
- Strict barrel discipline: every directory has index.ts, 0 `export *`, no non-index re-exports, and curated barrels with stated intent (modules/index.ts, modules/core/index.ts headers).
- Internal layering is enforced with eslint-plugin-boundaries (eslint.config.ts:276-345): constants and helpers import nothing, schema imports only constants, modules import primitives plus narrowly named split-out elements (shared-errors, shared-http, shared-pagination). The narrowing is documented (2026-08-04 comments).
- Strong governance tooling worth keeping: route-contract-coverage (209 routes, 0 drift), api-response-sync, api-client-sync, verify-shared-exports, shared-export-usage, shared-boundaries-report, graph-shared, and prune manifests and feature scaffolder that already encode the feature-to-file map.
- High test density with colocated *.test.ts: about 40.2k test LOC against about 40.6k source LOC; helpers, schema, db and realtime are heavily tested.
- Domain folder names under modules/core/* align with server/core/src/* (activities, admin, analytics, api-keys, billing, compliance, feature-flags, support, tasks, tenant(s), users), so they are a usable starting map for vertical slices.
- Typed error model with kind/code/status separation (modules/system/errors/errors.ts AppError plus docs/specs/errors.md) and a framework-agnostic HttpRequest/HttpReply contract (system/http/http.ts).
- Branded-ID infrastructure (schema/ids.ts, createBrandedUuidSchema) and capability-scoped env schemas (env.<capability>.ts composed by env.validation.ts) are good primitives, even though adoption is uneven.

#### SHR inventory

| Path                                           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Size                        | Notes                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main/shared/package.json                       | Package manifest: 36 subpath export keys (source/types/default conditions), scripts incl. verify-exports                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 7.4 KB                      | Duplicate aliases (./config vs ./system/config, ./constants/system vs ./system/constants); no ./api, ./workers, ./media/_, ./realtime/_; wildcard leaf-file exports |
| main/shared/src/index.ts                       | Root barrel (named exports of api, constants, helpers, curated modules, schema)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 371 LOC, 357 exports        | 56 exports used externally; web uses it only from tests                                                                                                             |
| main/shared/src/api/                           | EndpointDef/Contract/ContractRouter vocabulary types, envelope types, ErrorCode union, apiRouter composing 18 HTTP contracts                                                                                                                                                                                                                                                                                                                                                                                                                                         | 240 LOC                     | apiRouter consumed only by tools/audits/docs; not exported as a subpath                                                                                             |
| main/shared/src/contracts/                     | 18 HTTP contract files (209 router endpoints + realtime 2 + health 3), plus contract.ports.ts (server DI ports), context.ts (server request context), contract.native.ts, edition-ports.ts                                                                                                                                                                                                                                                                                                                                                                           | 4,412 LOC; 82 test LOC      | Largest: contract.auth.ts 828, contract.admin.ts 594, contract.ports.ts 506, contract.tenants.ts 331                                                                |
| main/shared/src/schema/                        | Custom validation core: Schema<T>, createSchema, parsers (string/number/boolean/object/record/coerce), composites (enum/brand/array/literal/union), scalars (email/uuid/url/password/isoDateTime), branded ids                                                                                                                                                                                                                                                                                                                                                       | 758 LOC; 2,316 test LOC     | No object combinator; parseObject duplicates parseRecord                                                                                                            |
| main/shared/src/constants/                     | Primitive constants: breakpoints, config defaults, media/MIME, regex, time, plus core/* (auth, billing, compliance, geo, i18n, iam, notifications, policy, ui.defaults) and system/* (audit, comms, errors, geo, http, i18n, jobs, limits, log, logger, platform, security, tenancy)                                                                                                                                                                                                                                                                                 | 2,581 LOC                   | Alias shim files (system/platform.ts, system/logger.ts, core/i18n.ts); duplicated values with limits.ts/media.ts                                                    |
| main/shared/src/helpers/                       | async (DeferredPromise/delay), crypto (token/uuid/constantTimeCompare), date (en-US formatters), object (guards/deepEqual/prototype safety), parse (env strings), postgres-dsn, response (envelope types), result (Result monad), string (case/slug/email canonicalization)                                                                                                                                                                                                                                                                                          | 1,350 LOC; 4,096 test LOC   | result.ts and response.ts unused outside shared                                                                                                                     |
| main/shared/src/modules/system/                | cache (LRU/memoize/errors/types), config (env.*.ts schemas, ~2.7k LOC), errors (AppError hierarchy), http (cookies, csrf, multipart, proxy/IP, request, response envelopes, user-agent), logger types, observability (MetricsCollector), runtime (health checks), security (CSP, headers, input/injection, ip, rate limit, sanitization, token store)                                                                                                                                                                                                                | 7,657 LOC; 10,320 test LOC  | Mostly server-only consumers; contains Node globals (process.uptime)                                                                                                |
| main/shared/src/modules/core/                  | Business domains: activities, admin (+security), analytics, api-keys, audit-log, auth (core/devices/email/magic-link/mfa/oauth/otp/passkey/sessions/tos/webauthn + passwords/ + policy + roles), billing (schemas/admin/display/entitlements/errors/form/logic/service types), compliance (+deletion, legal), feature-flags, geo, jobs (+batched queue, reactive map), support, tasks, tenant (membership/roles/permissions/settings/domain restrictions), usage-metering, users (lifecycle/username/roles/permissions/attestation); schemas.ts common field schemas | 13,881 LOC; 12,569 test LOC | admin.schemas.ts 983 LOC; mixes wire DTOs, persistence shapes, logic and display                                                                                    |
| main/shared/src/modules/db/                    | pagination (offset/cursor schemas, helpers, HTTP parsing), pubsub (WS protocol types, subscription manager, Postgres pubsub, authorize), search (query builder DSL, schemas, errors, types)                                                                                                                                                                                                                                                                                                                                                                          | 4,084 LOC                   | Search DSL unused outside shared; cursor.ts uses Buffer                                                                                                             |
| main/shared/src/modules/comms/                 | email (template/log schemas, unused), notifications (types, schemas, push schemas, errors, display, logic), sms, webhooks (entities, schemas, URL validation)                                                                                                                                                                                                                                                                                                                                                                                                        | 3,034 LOC                   | notifications.push.schemas.ts 817 LOC re-aliases notifications.types.ts                                                                                             |
| main/shared/src/modules/realtime/realtime.ts   | Realtime transaction/record schemas and a duplicate realtimeContract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 798 LOC                     | Consumed only by server/realtime                                                                                                                                    |
| main/shared/src/modules/media/                 | File-type detection (Buffer magic numbers), media types/moderation result types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 785 LOC                     | Server-only consumers                                                                                                                                               |
| main/shared/src/modules/storage/files/files.ts | File entity/upload schemas and purposes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 446 LOC                     |                                                                                                                                                                     |
| main/shared/src/modules/workers/workers.ts     | ScheduledTask/executor types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 32 LOC                      | Imported as @bslt/shared/workers, which is not in package exports                                                                                                   |

#### SHR wiring points

- `main/shared/package.json (exports)`: 36 public subpaths incl. wildcards exposing every file under constants/, helpers/, schema/, contracts/, system/config/, system/security/, system/constants/, core/_, comms/_, db/_, storage/_
- `tsconfig.json:6-23 (root paths)`: @bslt/shared and subpath to src mapping (comms/_, config, contracts/_, core/_, db, modules/realtime, realtime, storage/_, system, system/_, system/constants, catch-all @bslt/shared/_)
- `main/{server,client,apps}/*/tsconfig*.json (27 files)`: Per-package re-statements of shared path aliases (e.g. main/server/realtime/tsconfig.json has 21 lines; main/server/workers/tsconfig.json:16 adds @bslt/shared/workers)
- `main/tools/scripts/audit/shared-vitest-aliases.ts`: Vitest/Vite alias generator for shared module and foundation roots, imported by ~12 vitest configs and main/apps/web/vite.config.ts
- `main/server/core/vitest.config.ts, main/server/system/vitest.config.ts, tests/vitest.config.ts`: Hand-written regex aliases for shared subpaths (in addition to the helper)
- `eslint.config.ts:197-345`: Boundary elements for each shared folder (shared-constants/helpers/schema/errors/http/pagination/system/db/core/comms/realtime/media/storage/workers/contracts/config/api/root) and allowed import edges, plus restricted deprecated paths (@bslt/shared/system/native|ports)
- `main/shared/src/api/router.ts`: apiRouter: 18 domain contracts (excludes realtime and health)
- `main/shared/src/contracts/index.ts`: All contract objects, port/context types, edition ports
- `main/shared/src/index.ts and main/shared/src/modules/index.ts`: Root package API (curated)
- `main/shared/src/modules/core/index.ts, modules/comms/index.ts, modules/system/index.ts, modules/db/index.ts, constants/index.ts, constants/system/index.ts, constants/core/index.ts, schema/index.ts`: Aggregate barrels that prune and scaffold tooling text-edit
- `main/shared/src/modules/system/config/index.ts + env.validation.ts`: Composition of all env.<capability>.ts schemas into the server env schema
- `main/shared/src/schema/ids.ts`: Branded ID types and schemas for every domain (edited by prune manifests per feature)
- `main/tools/scripts/starter/prune-manifests*.ts`: Per-feature deletePaths and text-anchor edits into shared files and barrels
- `main/tools/scripts/starter/feature.ts:139-260,1208-1232`: Scaffolds modules/core/<x>/ and contracts/contract.<x>.ts and patches contracts/index.ts and api/router.ts
- `main/tools/scripts/audit/route-contract-coverage.ts, api-response-sync.ts, api-client-sync.ts`: Cross-checks the server route manifest, apiRouter contracts and client/api call sites (with EXEMPTION_RULES for system/realtime/files/webhook callbacks/OAuth redirects)
- `main/tools/scripts/refactor/shared/verify-shared-exports.ts`: Export-map integrity, canonical key order and stale alias detection

#### SHR creator-platform notes

- Build the new creator domains (creators/profiles, fan subscriptions, pay-per-view unlocks, live tips, payouts incl. crypto, content, moderation queue, age verification) as vertical shared slices from day one. Adding them in today's layout would spread each across constants/core, schema/ids.ts, modules/core, contracts, env config and 5+ barrels, repeating the webhooks pattern (23 shared files).
- Content-rating separation (SFW/softcore) should start as one shared enum and schema (e.g. ContentRating plus an audience/visibility schema) that server/db row types import. server/db/src/schema/*.ts already reuses shared enums this way, so the rating vocabulary can be single-sourced from shared down to RLS policies.
- Money needs a primitive. Billing today models SaaS plans (Plan/Subscription/Invoice, BILLING_PROVIDERS ['stripe','paypal'] in constants/core/billing.ts:40, CURRENCIES fiat-only in constants/system/i18n.ts:19). Creator payouts, tips and crypto need a Money/minor-units plus asset type and ledger-entry schemas that do not belong under SaaS billing.
- The live layer is the weakest-linked part of shared. The WS protocol is invalidation-only, lives under modules/db/pubsub, the realtime contract is duplicated and server-only, and realtime/files are exempt from contract coverage. Live tipping, chat and presence need a typed, validated event protocol in a single 'live' slice included in the router and audits.
- Age verification currently consists of a self-attestation (modules/core/users/attestation.policy.ts: MINIMUM_SIGNUP_AGE=13, SIGNUP_ATTESTATION_VERSION). A verification-status model (provider, level, verifiedAt, jurisdiction) is new domain work, and the minimum age constant will need to become per-content-rating policy.
- Moderation will sit on the authorization layer, which is currently fragmented (two permission models, dead can() policy, two isModerator semantics). Consolidate authz before adding creator, fan and moderator roles.
- Adopt branded IDs (CreatorId, ContentId, PayoutId, TipId) for new domains at every boundary. Today TenantId is used in 0 files outside shared, so the safety net does not reach server/db or the client.
- Before the fork's rename and prune, flatten the shared export map and alias tables (package.json + 27 tsconfigs + ~14 vitest configs) and switch pruning to folder deletes. Otherwise renaming the @bslt scope and removing docs and features will mean editing many path tables and text-anchored barrels.
- Resolve the error-code and envelope duplication first. Payment, entitlement and paywall errors (PAYMENT_FAILED, INSUFFICIENT_ENTITLEMENTS already appear only in api/api.ts's union) need one registry that client paywall UX can branch on.
- Fix the username/handle policy divergence before launch. Creator handles are public identity, and today admin-create (1-15 chars) and self-service (2-30, letter-first) disagree.

#### SHR open questions

- Is the zero-dependency custom schema system a hard constraint (DIRECTION.md:20), or would adopting Standard Schema (or Valibot/Zod) be acceptable if it removes the interface-plus-parser duplication?
- Should contracts become runtime wiring (server route registration and typed client generation), or stay documentation and audit artifacts with three hand-written copies kept in sync by tooling?
- Should env config schemas (modules/system/config, ~2.7k LOC) remain in shared as principles.md:299 documents, given that only server packages consume them and FrontendEnvSchema is unused by the web app?
- Which error-code namespace is the target: 'system.*' (docs/specs/errors.md:128), the SCREAMING constants used by auth, or a per-feature namespaced registry?
- Is @bslt/shared meant to be published (publishConfig public, prepack script, MIT license) or only workspace-internal and edition-exported? This decides how much public subpath surface must be preserved.
- Should branded IDs be adopted repo-wide, including server/db rows, or removed? And should OrganizationId or TenantId be the canonical concept?
- Are the unused subsystems (SearchQueryBuilder DSL, Result monad, email template schemas, BatchedQueue, ReactiveMap, NativeBridge, can() policy) planned for future use, or safe to delete before the restructure?
- Should UI display helpers (labels, tones, form adapters, breakpoints) move to client/ui, or stay in a shared 'presentation' subpath so a future native or mobile client can reuse them?

### B.DB. main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)

**Summary.** @bslt/db is a 19.0k-line (non-test; 27.0k test) hand-rolled persistence package: a parameterized SQL builder (2.2k), 40 functional repositories (7.6k), hand-written TS row types + *_COLUMNS maps (3.4k), and some unrelated runtime pieces (job-queue engine, write service, LISTEN/NOTIFY pubsub, SQL search, tenancy toolkit). Once the 37 SQL migrations are applied there are 46 live public tables plus the runner's `migrations` table. They use 16 Postgres enums, 24 JSONB columns and no GIN indexes. The migration numbering started as hundreds-blocks per domain (00 identity, 01 tenancy, 02 billing, 03 comms, 04 system, 05 compliance, 06 files/activities, 07 realtime, 08 product, 09 RLS). That broke down: 0903-0917 are chronological patches across every domain, several of them fix-forward reverts. The history was already squashed once, on 2026-02-19. RLS is written for 24 tables but is not enforced at runtime. Every dev, CI, test and prod config connects as the `postgres` superuser, the policies are `TO authenticated`, and nothing grants that role or switches into it. Isolation is therefore purely app-level: contextualizeRequest checks membership, and repositories add owner-scoped WHERE clauses. The billing tenant-scope work stopped at Phase 0. Tenant columns are nullable, and no query, policy or service uses them. The schema mixes user-owned, tenant-owned and mixed tables with no single rule. The hand-maintained TS layers have drifted from the SQL: 21 column maps lack `version`, and one map holds a column that does not exist. The repository layer is also bypassed by about 25 server/core files that compose SQL directly. The email_templates/email_log orphans in docs/todo are already gone: 0917 dropped them on 2026-08-06, so TODO.md is stale. Today's orphans are `jobs`, `tenant_settings` and `billing_tenant_backfill_audit`. server-rust's migrations are a separate `bslt_rust` schema for the Kanu Rust backend, meant for a separate database. That is a deliberate, documented second identity store that is not linked to the TS users. Its runner (checksums plus advisory lock) is better than the TS runner.

#### Findings

##### DB-01. RLS policies exist but cannot apply at runtime: the app connects as superuser `postgres`, the policies target role `authenticated`, and nothing grants or SETs that role

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** db-security
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The whole RLS layer is inert. A superuser session bypasses RLS completely. Even under a non-superuser role, a policy written `TO authenticated` applies only when the current role is a member of `authenticated`, and nothing makes it one. Every request still pays for the session plumbing (SET LOCAL per query). The schema-per-tenant isolation test proves search_path routing, not RLS. This matters a lot for the creator platform: 'SFW/softcore separation enforced at the data layer' cannot rest on these policies until the role model is fixed.

**Evidence:**

- main/server/db/migrations/0900_rls.sql:10-15 creates role `authenticated`; every policy in 0900/0901/0904/0909/0911/0912 is `FOR ... TO authenticated`
- Repo-wide grep for `SET ROLE|SET LOCAL ROLE|GRANT ... TO|BYPASSRLS` outside migrations returns nothing; main/server/db/src/client.ts:200-220 only sets GUCs app.user_id/app.tenant_id/app.role/search_path
- config/env/.env.{development,local,test,production}(.example): POSTGRES_USER=postgres; infra/docker/production/docker-compose.prod.yml:75,111,182 (POSTGRES_USER default postgres, also used by pgbouncer and api); .github/workflows/continuous-integration.yml:129,198 DATABASE_URL postgresql://postgres:postgres@...; infra/docker/demo/generate-env.sh:61
- FORCE ROW LEVEL SECURITY only on tenants, tenant_settings, activities, files (0901_rls_tenant_trust_boundary.sql:150-153). Superusers bypass even FORCE
- tests/integration/api/db-harness.ts:89 runs CREATE DATABASE with the same superuser connection; no integration test asserts a policy denial (tenants.real-db.test.ts checks only app-level 403s)
- docs/specs/specs.md:373 claims 'request context -> DB session vars -> RLS policies -> membership checks' defense-in-depth; docs/DIRECTION.md:112,171 mark RLS done
- docs/DIRECTION.md:206: the SQL search returned every user's email cross-tenant until it was made admin-only. A leak like this is what an enforced DB layer would have caught
- infra/cloud/gcp/main.tf:229 creates a non-superuser google_sql_user that also runs migrations (so it owns the tables). With FORCE on 4 tables and no policy for that role, those tables would be default-deny on that path (unverified)

**Direction.** Introduce explicit DB roles. `bslt_owner` runs migrations and owns schemas/tables. `bslt_app` is the runtime role: LOGIN, NOSUPERUSER, NOBYPASSRLS, not an owner, granted only DML. `bslt_worker` is for cron, retention and backfills, with BYPASSRLS or explicit system policies. Rewrite policies `TO bslt_app` (or keep `authenticated` and GRANT it to bslt_app), and FORCE RLS on every user-owned or tenant-owned table. Split DATABASE_URL into DATABASE_URL (app) and MIGRATION_DATABASE_URL (owner) in config, compose and CI. Add a real-DB test suite that connects as bslt_app and, for every RLS table, proves cross-user and cross-tenant SELECT/UPDATE/DELETE are denied. Add a db:audit check that every table is either RLS-forced or explicitly listed as global.

##### DB-02. RLS policy set is inconsistent, partly unsafe if it were enforced, and covers only 24 of 46 tables

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** db-security
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The policies were written in three styles over time (raw cast, NULLIF helpers, SECURITY DEFINER membership proof) and were never exercised, because nothing enforces them. Some are looser than the app rules they are meant to back up. The raw `''::uuid` cast raises an error on a pooled connection after a previous SET LOCAL has expired. That is exactly why 0901 added the helpers.

**Evidence:**

- 18 live user-scoped policies cast `current_setting('app.user_id', true)::uuid` directly: 0900_rls.sql (15 still live after 0901: subscriptions, customer_mappings, invoices, payment_methods, notifications, notification_preferences, push_subscriptions, trusted_devices, webauthn_credentials, sms_verification_codes, user_sessions, oauth_connections, refresh_tokens, security_events, data_export_requests), 0904_tasks_rls.sql:11-12, 0909_api_keys.sql:35-36, 0912_events.sql:57-58. 0901:9-21 introduced NULLIF-safe app_current_user_id()/app_current_tenant_id() but only the tenant policies use them
- 0901:78-83 membership_insert_policy allows `user_id = app_current_user_id()`, so a user could insert their own membership into any tenant; 0901:57-66 lets any member (including viewer) UPDATE/DELETE the tenant row
- 0901:111-127 activity policy exposes every tenant_id IS NULL activity to all authenticated sessions (cross-user feed leak)
- No RLS on: users, auth_tokens, login_attempts, totp_backup_codes, invitations (tenant-scoped), webhooks (tenant-scoped), webhook_deliveries, tenant_feature_overrides (tenant-scoped), usage_snapshots (tenant-scoped), audit_events, consent_records, email_unsubscribes, plans, billing_events, jobs, job_queue, cron_jobs, feature_flags, usage_metrics, legal_documents, support_requests, billing_tenant_backfill_audit
- 0914_email_unsubscribes.sql:25 says '0900 enables RLS only on tenant-owned tables', which is false (0900 covers 15 user-owned tables)
- app.role is SET LOCAL on every scoped query (client.ts:208-210) but no policy reads it

**Direction.** Write one policy template per scope class and generate all policies from it. User-owned: `owner_id = app.current_user_id()`. Tenant-owned: `tenant_id = app.current_tenant_id() AND app.is_member(tenant_id)`. Role-gated writes: check membership role or permission bits via a SECURITY DEFINER helper. Global/public-read gets explicit SELECT-only policies. Colocate each table's policies with its DDL in the same migration and drop the raw casts. Use set_config() with bind parameters instead of escapeLiteral interpolation (client.ts:192).

##### DB-03. Billing tenant-scope stopped at Phase 0, so user vs tenant ownership is unresolved across the schema

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** db-schema
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** No single rule says who owns a row. Billing is user-scoped with a dormant tenant column. Metering is tenant-scoped but fed user ids. Files, activities and audit events are both. Every new domain will have to choose ad hoc, and the creator platform has several owners at once: creator (org), fan (user) and platform.

**Evidence:**

- 0902_billing_tenant_scope.sql:16-18 'Phase 1 will switch to tenant-scoped policies once the service layer is rewritten'; it adds nullable tenant_id to subscriptions, customer_mappings and payment_methods but not invoices
- Billing repositories never filter on tenant_id (only column mappings: main/server/db/src/schema/billing.ts:390,412,445); grep of main/server/core/src/billing finds no subscription/invoice tenantId use
- canManageBilling (main/shared/src/modules/core/tenant/membership.logic.ts:103) has no server caller; is_billing_admin is only toggled (core/src/tenants/membership-service.ts:335)
- main/server/core/src/billing/usage-metering-handlers.ts:87-89 falls back to `tenantId = user.userId` when no x-tenant-id header is sent
- billing_tenant_backfill_audit (0902) is never read by code
- Scope classes in the live schema. User-owned: 22 tables (auth, sessions, billing, notifications, api_keys, tasks via owner_id, events, consent, exports, email_unsubscribes). Tenant-owned: memberships, invitations, tenant_settings, tenant_roles, tenant_feature_overrides, usage_snapshots, webhooks (nullable tenant). Mixed (nullable tenant_id + user/actor): files, activities, audit_events. Billing: user-owned with nullable tenant_id
- docs/DIRECTION.md:409 says the product surface is account-scoped, yet every signup creates a personal tenant (core/src/auth/personal-tenant.ts)

**Direction.** Decide the ownership model before adding creator domains. Recommended: keep users as the person/fan principal and tenants (renamed `org.organizations` or `accounts`) as the owning principal for creators and teams. Every row gets exactly one owner column (`owner_user_id` or `org_id`, never both nullable). Finish or revert Phase 1: either drop subscriptions.tenant_id and friends (pure B2C) or make them NOT NULL and tenant-policied. Remove the userId-as-tenantId fallback.

##### DB-04. Prune tooling can break the migration chain because some migrations alter other modules' tables

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** tooling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** A fork that prunes `activities` or `webhooks` and then runs `pnpm db:migrate` on an empty database fails with 'relation does not exist'. That is exactly the planned fork workflow. The cause is migrations organised by concern (versions, RLS) instead of by owning module.

**Evidence:**

- main/tools/scripts/starter/prune-manifests-features.ts:20 deletes 0601_activities.sql, but 0900_rls.sql:20 (ENABLE RLS + policy) and 0901_rls_tenant_trust_boundary.sql:111,152 still reference `activities`
- prune-manifests-features.ts:665 deletes 0402_webhooks.sql, but 0700_realtime_versions.sql:110 still runs `ALTER TABLE webhooks ADD COLUMN version`
- main/tools/scripts/starter/prune-proof.ts:67 scans only .ts/.tsx/.js/.jsx/.json for dangling tokens; it never scans .sql or runs migrations against a fresh DB
- Cross-cutting migrations that touch many modules: 0700 (22 tables), 0900 (20 tables), 0901, 0902

**Direction.** Make every migration module-owned: it may only CREATE/ALTER tables of its own module. RLS policies, triggers and version columns ship with the table's own migration. Give each module a migration manifest (module id, owned tables), and make prune-proof spin up Postgres, apply the pruned chain and run db:audit. Consolidating into a fresh baseline (see creator_platform_notes) is the moment to do this.

##### DB-05. Concrete schema bugs: index name collision, unconditional 'pending' unique on invitations, unmaintained event partitions, phantom column

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** db-schema
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** These are latent production defects that come from schema intent drifting away from the DDL. Each one would be inherited by the fork.

**Evidence:**

- 0000_users.sql:179 creates idx_refresh_tokens_family_active ON (user_id, family_id) WHERE family_revoked_at IS NULL. 0906_refresh_token_rotated_at.sql:16 uses `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_active ON (family_id) WHERE rotated_at IS NULL`, so the reuse-detection index is silently never created
- 0100_tenants.sql:77 `CONSTRAINT invitations_pending_unique UNIQUE (tenant_id, email)` is not partial. core/src/tenants/invitation-service.ts:300 checks only pending invites, and revoke keeps the row (status 'revoked', line 523). Re-inviting a revoked, expired or accepted email therefore hits a 23505
- 0912_events.sql provisions only the current and next month plus events_default; ensure_events_partition() is never called from any code or cron (grep across main/tests). After month 2 all rows go to events_default, and creating that month's partition later fails while default holds matching rows
- main/server/db/src/schema/tenant.ts:270 maps reminderSentAt -> reminder_sent_at and repositories/tenant/invitations.ts:218-227 updateReminderSentAt() writes it, but no migration creates that column (would fail with 42703; currently uncalled)

**Direction.** In the consolidated baseline: give every index a unique name (a convention plus an audit check for duplicate names and IF NOT EXISTS shadowing). Use a partial unique `(tenant_id, lower(email)) WHERE status = 'pending'`. Add a cron job that pre-creates N future partitions (and a check that events_default stays empty), or use pg_partman. Delete updateReminderSentAt or add the column.

##### DB-06. Four hand-maintained representations per table have drifted (SQL DDL, TS row types, *_COLUMNS maps, shared domain types)

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Every table change needs coordinated edits in 3-4 places, and the hand-written maps silently drop columns. The domain-type duplication between @bslt/db and @bslt/shared is the persistence-level version of the fragmentation the owner describes.

**Evidence:**

- The `version` column added by 0700_realtime_versions.sql to 22 tables is missing from 21 *_COLUMNS maps (all except users): webauthn, trusted_devices, user_sessions, oauth, tenants, memberships, invitations, tenant_settings, plans, subscriptions, invoices, payment_methods, notifications, push_subscriptions, notification_preferences, jobs, webhooks, feature_flags, tenant_feature_overrides, usage_snapshots, files
- Subscription is defined both in main/server/db/src/schema/billing.ts:136 and main/shared/src/modules/core/billing/billing.schemas.ts:127; Membership in schema/tenant.ts and shared/.../membership.schemas.ts:41
- Postgres enum oauth_provider lacked 'kakao' until 0903 although shared constants and routes already supported it
- main/server/db/src/validation.ts:18-72 REQUIRED_TABLES omits api_keys, support_requests, tenant_roles, events and email_unsubscribes, and its comments cite nonexistent files 0400_system.sql, 0450_features.sql, 0460_metering.sql
- 0405_job_queue.sql header: the table 'previously existed only in the dev schema push' (an earlier drift between push.ts DDL and migrations)

**Direction.** Generate TS row types, column maps, table constants and enum unions from the migrated catalog (a `db:codegen` that introspects information_schema/pg_enum into main/server/db/src/generated). Fail CI on diff. Derive REQUIRED_TABLES from the same output. Keep shared domain types as API contracts and map explicitly, but source enum values from one place (DB enums or a shared constant that codegen checks against).

##### DB-07. Repository layer is bypassed: about 25 server/core files build SQL directly while some repositories have zero callers

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** layering-violation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** There are two parallel data-access paths per table. Table ownership is unclear, owner-scoping lives in some places and not others, and a schema change (rename, move to a Postgres schema) needs a repo-wide hunt instead of a one-module change.

**Evidence:**

- Builder or raw SQL with *_TABLE constants outside @bslt/db: core/src/auth/utils/refresh-token.ts (16 builder calls), auth/totp.ts (15 db.raw), auth/sms-2fa/service.ts (5) + rate-limit.ts (4), auth/handlers/phone.ts (3), tenants/service.ts (7), notifications/subscriptions.ts (6), auth/otp, magic-link, password and verification services, auth/security/lockout.ts, auth/security/events/core.ts, admin/securityService.ts (5), admin/tenantService.ts, admin/webhookHandlers.ts, users/{data-hygiene,pii-anonymization,unverified-cleanup}.ts, notifications/unsubscribe.ts (4 raw statements), realtime/src/service.ts, workers/src/scheduler/{scheduler,register}.ts
- Repositories with no production callers: repos.jobs, repos.securityEvents, repos.totpBackupCodes, repos.notificationPreferences (0 uses); repos.loginAttempts has 1 (workers/src/service.ts:147)
- Tables with no repository at all: sms_verification_codes, cron_jobs, email_unsubscribes, tenant_settings, job_queue (handled by queue/postgres-store.ts)
- docs/specs/principles.md:300 says to 'query through explicit repositories and SQL helpers'

**Direction.** Each table is owned by exactly one module repository. Move the inline SQL in auth/totp, sms-2fa, refresh-token, lockout, security events, preferences, unsubscribe and cron into repositories. Stop exporting *_TABLE constants from the @bslt/db public barrel, and add a lint/audit rule banning builder imports outside main/server/db.

##### DB-08. Dead or orphaned schema and wiring

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** dead-code
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Dead tables still raise the startup-validation bar (REQUIRED_TABLES includes `jobs`), widen RLS surface, and make the schema look more complete than it is.

**Evidence:**

- `jobs` table (0400_jobs.sql) + createJobRepository (repositories/system/jobs.ts, 184 lines) are wired in factory.ts:170,265 and REQUIRED_TABLES, but nothing calls repos.jobs. The admin job UI uses job_queue through PostgresQueueStore (core/src/admin/jobsService.ts)
- tenant_settings (0100_tenants.sql:85-101) has no repository and no reads or writes, yet it has RLS + FORCE (0901:99,151); tenants.metadata JSONB covers a similar need
- billing_tenant_backfill_audit (0902) is a one-off migration log with no readers
- The 0700 `version` columns on 21 tables are unused: realtime only registers `users` (main/server/realtime/src/service.ts:36), and WriteService is constructed in apps/server/src/bootstrap/phases/data.ts:121 but has no callers
- main/server/db/package.json lists ioredis but nothing in main/server/db/src imports it
- docs/todo/TODO.md:24-28 still lists email_templates/email_log as orphaned; 0917_drop_orphaned_email_tables.sql dropped them (commit 07d9bb1f, 2026-08-06)
- jobs vs job_queue: two queue tables with the same status vocabulary, one a Postgres enum (job_status) and one free TEXT (0405_job_queue.sql:22, no CHECK)

**Direction.** In the baseline, drop jobs, billing_tenant_backfill_audit and either drop or wire tenant_settings (pick one of tenant_settings or tenants.metadata). Keep `row_version` only on tables that actually join realtime sync, or adopt it everywhere through the WriteService with a registry. Remove the WriteService wiring if realtime is not adopted. Fix TODO.md.

##### DB-09. Migration numbering scheme has decayed and the runner is minimal (no checksums, no lock, three entry points)

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** tooling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Historical intent is hard to see: reading one table's final shape needs up to 6 files (users: 0000, 0701, 0905, 0916, 0700 note, 0900). An edited file is undetectable after it has been applied.

**Evidence:**

- Domain hundreds-blocks 0000-0800, then 0900_rls.sql:4 'must run last', followed by 17 cross-domain patches 0901-0917 in calendar order
- Fix-forward reverts: 0701 CHECK locale constraint reverted by 0905; 0301 tables dropped by 0917; 0405 restores a table that existed only in dev push DDL
- 0913_legal_document_templates.sql is 313 lines of legal copy seeded in a migration (deliberate and documented in its header)
- git history: 2026-02-19 commit 89f7efe6 deleted 0000_init..0028 (an earlier squash); 2026-05-31 e8ce986c deleted 0101_api_keys (later re-added as 0909)
- main/server/db/src/migrations.ts:50-89 tracks by filename only (no checksum), takes no advisory lock, wraps each file in a transaction (no CREATE INDEX CONCURRENTLY possible), and has no down path
- Three entry points to the same runner: main/tools/scripts/db/migrate.ts, main/tools/scripts/db/push.ts (identical behavior, 'db:push' kept as an alias), main/apps/server/src/migrate.ts (container); package.json:118-119
- docs/deploy/migrations.md:5,41-50 still describes the pre-squash `0000_init.sql … 0026_performance_indexes.sql` sequential scheme
- By contrast main/apps/server-rust/src/platform/db/mod.rs:81-148 verifies checksums and contiguity under pg_advisory_xact_lock

**Direction.** Consolidate into a reviewed baseline and port the Rust runner's guarantees to TS: a schema_migrations table with checksum, an advisory lock, a strict ordered version and a per-file `-- migrate:no-transaction` directive. Reduce to one entry point (db:migrate) and keep db:push only as an alias. Move seed content (legal templates) into versioned seed fixtures applied by an idempotent `db:seed:required` step that also runs in prod.

##### DB-10. users is a god table that mixes credentials, profile, lockout, lifecycle and attestation; DOB is self-reported

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** db-schema
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Every auth, profile or lifecycle feature touches the same row and type. Secrets sit next to public profile fields. There is no place to put verified age or identity evidence.

**Evidence:**

- 0000_users.sql:34-85 has 33 columns, plus eligibility_attested_at/version (0916) = 36: password_hash and totp_secret (credentials), first/last name, bio, website, city/state/country, phone, gender, date_of_birth (profile), failed_login_attempts/locked_until/lock_reason (security), deactivated_at/deleted_at/deletion_grace_period_ends (lifecycle), token_version, version
- date_of_birth is TIMESTAMPTZ (0000_users.sql:66) and is written through profile handlers (core/src/users/handlers/profile.ts, users/service.ts), while 0916_user_eligibility_attestation.sql:21 states 'No date of birth is collected'
- users has no RLS and is read through 105 repos.users call sites plus direct builder access in about 12 core files

**Direction.** Split into identity.users (id, email, canonical_email, username, platform role, status, timestamps), identity.credentials (password_hash, totp_secret_enc, token_version), identity.lockouts (or reuse login_attempts), and profile.user_profiles (display fields, locale). Store verified age only in compliance.age_verifications, and drop or rename the self-reported DOB (DATE, 'self_reported').

##### DB-11. Financial records are cascade-deleted with users; the money model has no ledger

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** db-schema
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** This is acceptable for a SaaS mirror of Stripe. It is not acceptable for a platform that holds creator balances, pays out, and must keep tax and chargeback evidence for years.

**Evidence:**

- 0200_billing.sql:53,80,94,123: subscriptions, customer_mappings, invoices and payment_methods all have user_id ON DELETE CASCADE
- main/server/core/src/users/data-hygiene.ts:447 hard-deletes anonymized users after the retention window, which cascades away invoice history
- Money is INTEGER cents (plans.price_in_cents, invoices.amount_due/amount_paid, int4) and currency is free TEXT default 'usd' with no CHECK; billing_provider enum is only ('stripe','paypal') (0200:11)
- plans.features is a JSONB array (0200:32), so entitlements are encoded in JSON rather than rows

**Direction.** Financial tables reference users ON DELETE RESTRICT (anonymize instead of delete). Introduce ledger/commerce schemas (see creator_platform_notes) with BIGINT/NUMERIC minor units, an asset/currency table and an append-only journal. Keep billing.* as a thin provider mirror and inbox.

##### DB-12. @bslt/db mixes persistence with queue, pubsub, search and tenancy runtime; adding one table touches about 9 files

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** wiring-sprawl
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The package is the hub most server packages depend on, and its flat 40-repository container plus hand-written barrels is where per-feature wiring piles up.

**Evidence:**

- Non-test LOC: builder 2,183; repositories 7,563; schema (TS types) 3,420; queue (memory store, client, postgres store, write service) 1,918; search 1,171; pubsub 246; tenancy 268; client 478; index.ts 580
- index.ts re-exports about 466 symbols explicitly (schema and repositories listed by hand, lines 35-413) besides 9 subpath exports in package.json
- A new table needs: the migration, schema/<x>.ts, schema/index.ts, index.ts (schema block), repositories/<x>/{x,index}.ts, repositories/index.ts, factory.ts (import, Repositories interface, createRepositories), index.ts (repository block), validation.ts REQUIRED_TABLES, and optionally tenancy.ts registry or realtime tableNameMap
- createRepositories() builds all 40 repositories again for every scoped request (apps/server/src/bootstrap/phases/data.ts:141-143)

**Direction.** Split into @bslt/db (client, builder, migrations runner, tenancy/session, codegen output) and per-domain repository modules colocated with their owning server module, or at least under db/src/modules/<domain>/ with a generated barrel. Move the queue engine, write service and pubsub to server/workers and server/realtime. Replace the flat Repositories literal with a module registry (each module contributes its repositories) so pruning or adding a domain is a single registration.

##### DB-13. Naming inconsistencies across tables, columns, logs and folders

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** naming-inconsistency
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Each mismatch is small, but together they make it hard to find a table's owner and are a big part of the 'scattered' feel.

**Evidence:**

- 'event' is overloaded: events (product analytics, 0912), billing_events (provider webhook inbox), security_events, audit_events, activities, plus webhook_deliveries. There are three severity vocabularies: audit_severity enum info/warn/error/critical (0401:11), security_events.severity TEXT low/medium/high/critical (shared/src/modules/core/admin/admin.security.schemas.ts:71), and notifications.type holding a 'level' (schema/notifications.ts:13,77)
- jobs / job_queue / cron_jobs; `version` means optimistic lock (users, 0700), document version (legal_documents), token_version and eligibility_attestation_version
- Owner columns: tasks.owner_id, tenants.owner_id, invitations.invited_by_id, audit_events.actor_id, everything else user_id
- Trigger names: update_<t>_updated_at vs trg_files_updated_at; cron_jobs has updated_at but no trigger; tenant_feature_overrides has no timestamps
- Status modelling mixes 16 enums, CHECK-lists (auth_tokens.type, files.purpose and storage_provider, data_export_requests, support_requests.status) and free TEXT (job_queue.status, legal_documents.type, security_events.event_type, email_unsubscribes.category)
- Folder names disagree: db repositories `tenant` vs core `tenants`; `features` vs `feature-flags`; `metering` vs shared `usage-metering` vs core/billing/usage-metering; repositories/push holds notification_preferences; repositories/system holds audit, webhooks and jobs while core has audit/ and webhooks/; schema/events.ts vs repositories/analytics; schema/sessions.ts has user_sessions but refresh_tokens lives in schema/users.ts
- 'schema' means TS row types in db/src/schema, Postgres schemas in tenancy.ts, and validation schemas in @bslt/shared

**Direction.** Write a docs/specs/db-conventions.md and enforce it in db:audit. Plural snake_case tables, one `<module>` folder name used in shared, core, db and web, `<entity>_id` FKs, `owner_user_id`/`org_id`, `row_version` for locks, `*_log`/`*_events` only for append-only streams with a common shape (id, occurred_at, actor_id, subject_type, subject_id, payload), status as Postgres enums, and constraint/index prefixes pk_/fk_/uq_/ck_/ix_.

##### DB-14. Redundant indexes and missing uniqueness on provider identifiers

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** db-schema
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The redundant indexes add write amplification. The missing uniqueness pushes webhook idempotency into application code.

**Evidence:**

- Indexes duplicating UNIQUE/PK: idx_users_email, idx_users_canonical_email, idx_users_username (0000), idx_refresh_tokens_token + idx_refresh_tokens_token_expires, idx_webauthn_cred_id (0001), idx_tenants_slug, idx_memberships_tenant (0100), idx_customer_mappings_user, idx_billing_events_provider (0200), idx_jobs_idempotency (0400), idx_tenant_feature_overrides_tenant (0403), idx_usage_snapshots_tenant + tenant_period (covered by lookup/unique, 0404), idx_api_keys_token_hash (0909)
- No UNIQUE on subscriptions(provider, provider_subscription_id), invoices(provider, provider_invoice_id), payment_methods(provider, provider_payment_method_id), customer_mappings(provider, provider_customer_id) or push_subscriptions(endpoint); no partial unique for one default payment method per user
- 24 JSONB columns and no GIN index; job_queue has only a pending index (0405) although cleanup and stats filter completed/failed

**Direction.** Drop the duplicates in the baseline and add provider-id unique constraints. Add an audit query (pg_index overlap) to CI.

##### DB-15. Session scoping costs about 5 round trips per query and opens one transaction per repository call

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** other
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Because RLS is not enforced, this is pure overhead today. Once enforced it is the right mechanism, but it should be cheap.

**Evidence:**

- main/server/db/src/client.ts:223-244: with a session, every query()/execute() runs sql.begin(), then up to 4 `SET LOCAL` statements (user_id, tenant_id, role, search_path), then the query, then COMMIT
- Values are interpolated with escapeLiteral (client.ts:192) rather than bound
- contextualizeRequest applies the session to every authenticated request (apps/server/src/bootstrap/context.ts:268-297; router.ts:55-67)

**Direction.** Use a single `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)` inside the request transaction. Prefer one transaction per request or unit of work (a request-scoped tx) over one per statement.

##### DB-16. schema-per-tenant mode is a second, TS-defined schema source with a single demo table

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** fragmentation
- **Severity:** low
- **Intentional?** yes (deliberate/documented)

**Description.** This is deliberate and well guarded (isValidSchemaName injection boundary), but it is a parallel migration system that the creator platform is unlikely to need.

**Evidence:**

- main/server/db/src/tenancy.ts:146-180: TENANT_PARTITIONED_TABLES contains only the demo `tenant_items`; its DDL is a TS string, not an SQL migration; no FK to public.tenants and no RLS
- Replay is a manual call (replayPartitionedMigrations); docs/dev/tenancy.md and DIRECTION.md:120 document it as opt-in, default shared-rls

**Direction.** Keep it as an optional module but move its DDL into versioned SQL templates run by the same runner, or prune it from the creator fork. Do not confuse it with the proposed domain namespaces (static Postgres schemas per module), which are a different use of schemas.

##### DB-17. server-rust keeps its own `bslt_rust` schema, users and sessions for the Kanu Rust backend

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** fragmentation
- **Severity:** low
- **Intentional?** yes (deliberate/documented)

**Description.** This is a second identity store by design, not a second schema for the same app. It is unrelated to the creator platform.

**Evidence:**

- main/apps/server-rust/migrations/0001_foundation.sql: CREATE SCHEMA bslt_rust + schema_migrations(version, name, checksum); 0002_access.sql: bslt_rust.users (text ids, auth_epoch) and bslt_rust.sessions
- main/apps/server-rust/compose.yaml uses a separate DB (bslt_rust_dev on 127.0.0.1:55432, postgres:17); README.md:39,48,76 says it does not migrate TS users, must use a separate database, and rejects legacy DB names
- docs/dev/rust-backend.md: deliberate reusable Rust foundation for the Kanu product; TS starter stays authoritative

**Direction.** Exclude it from the creator fork. Port its migration-runner guarantees (checksums, contiguous versions, advisory lock) to the TS runner.

##### DB-18. Postgres major version differs across environments

- **Area:** main/server/db (@bslt/db) + all SQL migrations (main/server/db/migrations, main/apps/server-rust/migrations)
- **Category:** config
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Feature choices such as NULLS NOT DISTINCT, MERGE RETURNING and uuidv7() (PG18) depend on the floor version.

**Evidence:**

- postgres:16-alpine in infra/docker/{development,production,demo} and continuous-integration.yml:116,185
- postgres:17 in editions.yml, publish-core.yml, storefront-deploy.yml, rust-backend.yml and server-rust compose.yaml

**Direction.** Pin one supported major (17 or 18) for app, CI and editions, and record it in db conventions.

#### DB strengths (preserve)

- SQL migrations are already the single source of schema truth: db:push was rewritten to apply them (main/tools/scripts/db/push.ts:4-9), and db:audit cross-checks migrations, REQUIRED_TABLES and schema constants (main/tools/scripts/audit/db-schema-audit.ts)
- Unusually good migration rationale comments (0906, 0914, 0915, 0916, 0917) that record why, what was verified and who approved. Keep this culture
- Good constraint hygiene in newer DDL: named CHECKs on lengths and formats, the both-or-neither attestation CHECK (0916), audit action format CHECK (0401:33), slug regex (0100:30), non-negative money checks and paid<=due (0200:98)
- TIMESTAMPTZ everywhere, UUID PKs, money in integer minor units, hashed tokens (auth_tokens.token_hash, api_keys.token_hash), and app-level encryption of OAuth tokens and TOTP seeds (core/src/auth/oauth/token-crypto.ts, auth/totp-secret.ts)
- A small, readable, parameterized SQL builder with identifier escaping, schema-qualified TableSpec support (builder/types/types.ts:156-170), JSONB operators and window functions. Easy to extend to Postgres namespaces
- Functional repositories with explicit column maps and owner-scoped methods (e.g. repositories/tasks/tasks.ts updateForOwner/deleteForOwner). createRepositories(scopedDb) gives a clean seam for per-request DB sessions
- Request pipeline already resolves and verifies the tenant from token or header against memberships before scoping (apps/server/src/bootstrap/context.ts:243-297)
- The 0901 RLS helper pattern (NULLIF-safe app_current_*(), SECURITY DEFINER membership proof with pinned search_path) is the right template to generalize
- Solid infrastructure primitives: SKIP LOCKED job queue with idempotency key (queue/postgres-store.ts, 0915), advisory-lock leader cron (workers/scheduler), LISTEN/NOTIFY pubsub, a monthly-partitioned analytics table (0912)
- Real-DB integration harness that creates an isolated database per suite and applies the real migrations (tests/integration/api/db-harness.ts)
- Startup/health schema validation (validation.ts, wired in apps/server/src/bootstrap/phases/workers.ts:155)
- Injection-safe tenant schema naming and search_path guard (tenancy.ts isValidSchemaName, client.ts:211-219)
- The Rust runner's checksum + advisory lock + contiguity design (server-rust/src/platform/db/mod.rs) is a ready reference implementation

#### DB inventory

| Path                                                                                                                                                                   | Purpose                                                                                                                                                                                   | Size                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main/server/db/migrations/0000_users.sql                                                                                                                               | users (identity + profile + lockout + lifecycle, 36 cols after 0916), refresh_tokens, login_attempts, auth_tokens, security_events; uuid-ossp; update_updated_at_column(); enum user_role | 214 lines                                  | users: repos.users (105 refs), direct builder in about 12 core files (auth/*, users/data-hygiene, pii-anonymization, unverified-cleanup), realtime/service.ts (only realtime table), tools/scripts/db/{seed,bootstrap-admin,backfill-totp-secrets}, admin SQL search (apps/server/.../phases/data.ts:21). refresh_tokens: repos.refreshTokens (11) + core/auth/utils/refresh-token.ts direct (16 calls). login_attempts: core/auth/security/lockout.ts direct; repo used once (workers cleanup). auth_tokens: repos.authTokens (20) + otp/magic-link/password/verification services direct. security_events: written by core/auth/security/events/core.ts and read by admin/securityService.ts directly; its repository is unused |
| main/server/db/migrations/0001_auth_extensions.sql                                                                                                                     | totp_backup_codes, sms_verification_codes, webauthn_credentials, trusted_devices                                                                                                          | 101 lines                                  | totp_backup_codes: core/auth/totp.ts raw SQL (repo unused). sms_verification_codes: no repo; core/auth/sms-2fa/{service,rate-limit}.ts and auth/handlers/phone.ts raw. webauthn_credentials: repos (10). trusted_devices: repos (8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| main/server/db/migrations/0002_sessions.sql                                                                                                                            | user_sessions, oauth_connections; enum oauth_provider (+kakao in 0903)                                                                                                                    | 76 lines                                   | user_sessions: repos (4) + refresh-token.ts direct. oauth_connections: repos (13) + core/auth/oauth/service.ts direct                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| main/server/db/migrations/0100_tenants.sql                                                                                                                             | tenants, memberships, invitations, tenant_settings; enums tenant_role, invitation_status                                                                                                  | 124 lines                                  | tenants: repos (26) + core/tenants/service.ts, admin/tenantService.ts, workers/scheduler/register.ts:55 raw. memberships: repos (38) + tenants/service.ts. invitations: repos (10). tenant_settings: ORPHANED (no repo, no reads or writes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| main/server/db/migrations/0200_billing.sql                                                                                                                             | plans (TEXT PK, JSONB features), subscriptions, customer_mappings, invoices, payment_methods, billing_events (provider webhook inbox); 5 billing enums                                    | 197 lines                                  | All accessed via repositories: plans 27, subscriptions 54, customerMappings 12, invoices 9, paymentMethods 3, billingEvents 3 refs. User-scoped with ON DELETE CASCADE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| main/server/db/migrations/0300_notifications.sql                                                                                                                       | notifications (in-app), push_subscriptions, notification_preferences (JSONB quiet_hours/types); enum notification_type (actually a level)                                                 | 83 lines                                   | notifications: repos (13). push_subscriptions: repos (3) + core/notifications/subscriptions.ts direct. notification_preferences: core/notifications/preferences.ts direct (repo unused)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| main/server/db/migrations/0301_email.sql                                                                                                                               | email_templates, email_log (DROPPED by 0917)                                                                                                                                              | 59 lines                                   | Historical only; docs/todo/TODO.md:24 is stale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| main/server/db/migrations/0400_jobs.sql                                                                                                                                | jobs table + enum job_status                                                                                                                                                              | 52 lines                                   | DEAD: JobRepository wired, zero callers; still in REQUIRED_TABLES                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| main/server/db/migrations/0401_audit.sql                                                                                                                               | audit_events (append-only, tenant/actor nullable); enums audit_category, audit_severity                                                                                                   | 47 lines                                   | repos.auditEvents (39) + core/audit/service.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| main/server/db/migrations/0402_webhooks.sql                                                                                                                            | webhooks (outbound endpoints, tenant nullable), webhook_deliveries; enum webhook_delivery_status                                                                                          | 64 lines                                   | repos webhooks (13), webhookDeliveries (10) + admin/webhookHandlers.ts raw. Prunable feature (breaks 0700)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| main/server/db/migrations/0403_feature_flags.sql                                                                                                                       | feature_flags (TEXT PK), tenant_feature_overrides                                                                                                                                         | 50 lines                                   | repos featureFlags (5), tenantFeatureOverrides (4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| main/server/db/migrations/0404_metering.sql                                                                                                                            | usage_metrics (TEXT PK), usage_snapshots (per tenant per period); enum aggregation_type                                                                                                   | 60 lines                                   | repos usageMetrics (6), usageSnapshots (6); hourly cron in workers/scheduler/register.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| main/server/db/migrations/0405_job_queue.sql (+0915 idempotency_key)                                                                                                   | job_queue: PG-backed task queue (TEXT id, TEXT status)                                                                                                                                    | 32 + 33 lines                              | queue/postgres-store.ts (SKIP LOCKED); used by bootstrap data phase, workers and the admin jobs UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| main/server/db/migrations/0500_compliance.sql (+0913 seed)                                                                                                             | legal_documents (versioned), consent_records (unified legal acceptance + consent prefs), data_export_requests                                                                             | 81 + 313 lines                             | repos legalDocuments (4) + core/auth/tos-gating.ts; consentRecords (8) + core/auth/consented-user.ts direct; dataExportRequests (9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| main/server/db/migrations/0600_files.sql                                                                                                                               | files (multi-provider uploads; tenant nullable + user)                                                                                                                                    | 41 lines                                   | repos.files (32)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| main/server/db/migrations/0601_activities.sql                                                                                                                          | activities (user-facing feed); enum actor_type                                                                                                                                            | 41 lines                                   | repos.activities (19). Prunable feature (breaks 0900/0901)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| main/server/db/migrations/0700_realtime_versions.sql                                                                                                                   | Adds `version INTEGER` to 22 tables for optimistic locking/realtime                                                                                                                       | 135 lines                                  | Cross-module ALTERs; versions unused except users                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| main/server/db/migrations/0701_user_locale.sql / 0905_users_language_freeform.sql                                                                                      | Adds a locale CHECK and default to users.language, then reverts both                                                                                                                      | 46 + 14 lines                              | Fix-forward revert pair                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| main/server/db/migrations/0800_tasks.sql (+0904 RLS)                                                                                                                   | tasks (starter product feature, owner_id)                                                                                                                                                 | 23 + 13 lines                              | repos.tasks (4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/migrations/0900_rls.sql / 0901_rls_tenant_trust_boundary.sql                                                                                            | Create role authenticated; ENABLE RLS on 20 tables; 20 policies; NULLIF helpers + SECURITY DEFINER membership proof; FORCE on 4 tables                                                    | 144 + 156 lines                            | Not enforced at runtime (superuser connection)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| main/server/db/migrations/0902_billing_tenant_scope.sql                                                                                                                | Phase 0: memberships.is_billing_admin; nullable tenant_id on subscriptions/customer_mappings/payment_methods; backfill fn + billing_tenant_backfill_audit                                 | 237 lines                                  | Phase 1 not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| main/server/db/migrations/0903,0906,0908                                                                                                                               | oauth kakao enum value; refresh_tokens.rotated_at (+ index that collides by name); auth_tokens type 'email_otp'                                                                           | 6 / 18 / 15 lines                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/migrations/0907_cron_jobs.sql                                                                                                                           | cron_jobs registry for the leader-elected scheduler                                                                                                                                       | 27 lines                                   | workers/src/scheduler/scheduler.ts raw SQL; no repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| main/server/db/migrations/0909_api_keys.sql                                                                                                                            | api_keys (hashed, user-owned, RLS)                                                                                                                                                        | 38 lines                                   | repos.apiKeys (5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| main/server/db/migrations/0910_support_requests.sql                                                                                                                    | support_requests (anonymous-writable contact form, no RLS by design)                                                                                                                      | 29 lines                                   | repos.supportRequests (3); prunable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| main/server/db/migrations/0911_tenant_roles.sql                                                                                                                        | tenant_roles (custom roles, BIGINT permission bitmask) + memberships.custom_role_id                                                                                                       | 65 lines                                   | repos.tenantRoles (9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| main/server/db/migrations/0912_events.sql                                                                                                                              | events: product analytics, RANGE partitioned monthly + default partition, ensure_events_partition()                                                                                       | 59 lines                                   | repos.analyticsEvents (2); partition maintenance never scheduled; prunable (analytics)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| main/server/db/migrations/0914_email_unsubscribes.sql                                                                                                                  | email_unsubscribes suppression list (PK user_id, category)                                                                                                                                | 46 lines                                   | core/notifications/unsubscribe.ts raw SQL (4 statements); no repository; not in REQUIRED_TABLES                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/migrations/0916_user_eligibility_attestation.sql                                                                                                        | users.eligibility_attested_at + eligibility_attestation_version (age/jurisdiction attestation, not verification)                                                                          | 44 lines                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/migrations/0917_drop_orphaned_email_tables.sql                                                                                                          | Drops email_log and email_templates                                                                                                                                                       | 30 lines                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| public.migrations (created by main/server/db/src/migrations.ts:50-56)                                                                                                  | Applied-migration bookkeeping (name only)                                                                                                                                                 |                                            | No checksum or lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| main/apps/server-rust/migrations/0001_foundation.sql, 0002_access.sql                                                                                                  | bslt_rust schema: schema_migrations (checksummed), users (text id), sessions                                                                                                              | 9 + 20 lines                               | Separate DB for the Kanu Rust backend; intentional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| main/server/db/src/tenancy.ts                                                                                                                                          | schema-per-tenant toolkit (naming, provisioning, replay); demo tenant_items table DDL in TS                                                                                               | 268 lines                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/src/client.ts                                                                                                                                           | postgres.js wrapper: query/queryOne/execute/raw/transaction, withSession (SET LOCAL app.* + search_path), connection-string builders                                                      | 478 lines                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/src/builder/                                                                                                                                            | SQL builder: select/insert/update/delete, conditions incl. JSONB, window functions, TableSpec with schema                                                                                 | 2,183 lines (9 files)                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/src/repositories/                                                                                                                                       | 40 functional repositories in 18 folders                                                                                                                                                  | 7,563 lines                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/src/schema/                                                                                                                                             | Hand-written TS row types, *_TABLE constants and *_COLUMNS maps (21 files)                                                                                                                | 3,420 lines                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/src/queue/                                                                                                                                              | Queue client, memory store, Postgres store (job_queue), WriteService (unused)                                                                                                             | 1,918 lines                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/src/search/, pubsub/                                                                                                                                    | Generic SQL search provider (admin users search); LISTEN/NOTIFY adapter                                                                                                                   | 1,171 + 246 lines                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/server/db/src/factory.ts, index.ts, validation.ts, migrations.ts                                                                                                  | Repository container; 466-symbol barrel; REQUIRED_TABLES startup check; migration runner                                                                                                  | 331 / 580 / 141 / 98 lines                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main/tools/scripts/db/{migrate,push,reset,seed,bootstrap-admin,backfill-totp-secrets}.ts; main/apps/server/src/migrate.ts; main/tools/scripts/audit/db-schema-audit.ts | Migration, seed and reset entry points (migrate and push are identical) plus the static schema audit                                                                                      | 1,774 lines (scripts/db incl. tests) + 216 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

#### DB wiring points

- `main/server/db/src/factory.ts`: Repositories interface + createRepositories(): all 40 repositories (3 edit spots per new repository)
- `main/server/db/src/repositories/index.ts and main/server/db/src/index.ts`: Hand-written barrels re-exporting every repository and schema symbol (about 466 exports)
- `main/server/db/src/schema/index.ts`: Table constants, column maps and row types per table
- `main/server/db/src/validation.ts`: REQUIRED_TABLES checked at startup/health (stale: missing 5 live tables, includes dead `jobs`)
- `main/server/db/src/tenancy.ts`: TENANT_PARTITIONED_TABLES for schema-per-tenant mode
- `main/server/realtime/src/service.ts:36-77`: Realtime-syncable table allowlist (only users) / registerRealtimeTable
- `main/apps/server/src/bootstrap/phases/data.ts`: DB client, repositories, PostgresQueueStore, WriteService, SQL search table config, contextualize() (session -> withSession + search_path)
- `main/apps/server/src/bootstrap/context.ts:268-297 + main/apps/server/src/http/router.ts:55-67`: Per-request RLS session (userId/role, membership-verified tenantId) in the auth guard
- `main/server/workers/src/scheduler/register.ts`: Cron jobs that touch tables (usage snapshots, cleanups); where partition maintenance should live
- `main/tools/scripts/starter/prune-manifests*.ts`: Feature -> owned migration files (0402, 0601, 0910, 0912) for prune
- `main/apps/server/src/migrate.ts, main/tools/scripts/db/{migrate,push}.ts, package.json:116-124`: Migration entry points and db:* scripts
- `main/server/db/package.json exports`: 9 subpath entry points (client, schema, repositories, factory, migrations, builder, utils, queue, testing)

#### DB creator-platform notes

- Prerequisite: fix enforcement before trusting RLS. That means the owner/app/worker roles, FORCE RLS everywhere, a real-DB denial test per table, and set_config-based session vars. 'SFW/softcore enforced at the data layer' is not real until this ships; today any query from any handler sees every row.
- Proposed Postgres namespaces (static schemas, one per module, each owned by one migration set). meta: schema_migrations, seeds. identity: users (slim), credentials, mfa_totp, mfa_backup_codes, webauthn_credentials, sessions, refresh_tokens, auth_tokens, oauth_connections, trusted_devices, api_keys, login_attempts, security_events. profile: user_profiles. org: organizations (today tenants), memberships, invitations, roles, settings. billing: provider_customers, payment_methods, provider_events (inbox), plans/prices, platform_subscriptions, invoices. comms: notifications, push_subscriptions, notification_preferences, email_suppressions. ops: job_queue, cron_jobs, outbound_webhooks, webhook_deliveries, feature_flags, flag_overrides, usage_metrics, usage_snapshots, audit_log, support_requests. analytics: events (partitioned). New creator domains: content, live, commerce, ledger, payouts, moderation, compliance. The builder already supports TableSpec {schema,name}; turn *_TABLE constants into specs, not dotted strings, because escapeIdentifier would quote 'a.b' as one identifier (builder/types/types.ts:143-150).
- Ownership rule for creator domains: a creator is an org (content.creators.org_id UNIQUE FK org.organizations), so managers, editors and moderators reuse memberships and tenant_roles bitmasks. Fans are identity.users. Fan-side records (entitlements, purchases, tips) are owned by owner_user_id. Creator-side records (content, payouts, balances) are owned by org_id. Never both nullable.
- content.content_items(id, creator_id, kind, status, rating content.rating_enum NOT NULL CHECK IN ('sfw','softcore'), access content.access_enum ('public','subscribers','ppv'), price_minor, published_at, row_version). Rating changes only via a moderation decision (a trigger rejects direct UPDATE of rating unless app.actor_role = 'moderator', with a case id recorded). The RLS SELECT policy for softcore requires compliance.viewer_is_age_verified(app.current_user_id()) AND app.surface <> 'sfw', so SFW-only surfaces (app stores, public discovery) set app.surface='sfw' and physically cannot read softcore rows. Media goes in content.media_assets (link to files) with rating inherited from the item.
- commerce: offers/prices (subscription tier, ppv unlock, tip), orders (idempotency_key UNIQUE, provider refs UNIQUE), and entitlements(id, user_id, resource_type, resource_id, source_type, source_id, valid_from, valid_until, revoked_at) as the single access-check table. This replaces plans.features JSONB as the source of truth for 'can X see Y', and is enforced by a content RLS policy (`EXISTS entitlement`).
- ledger: assets(code, kind fiat|crypto, decimals, chain); accounts(id, owner_type, owner_id, kind creator_payable|platform_revenue|processor_clearing|fan_wallet|reserve|payout_clearing, asset); journal_entries(id, idempotency_key UNIQUE, kind, source_type, source_id, occurred_at); postings(entry_id, account_id, amount NUMERIC(39,0) minor units, CHECK amount<>0). A DEFERRABLE constraint trigger enforces SUM(amount)=0 per entry and asset. The ledger is append-only (REVOKE UPDATE/DELETE from bslt_app plus a trigger) with balances materialized per account. Financial FKs to users are ON DELETE RESTRICT (unlike 0200's CASCADE).
- payouts: payout_methods(org_id, kind bank|crypto, chain, address, verified_at, screening_status), payout_requests, payout_batches, payout_attempts(provider_ref or tx_hash UNIQUE, confirmations, status), holds/reserves linked to ledger entries; KYC and tax-form references stored as provider tokens, not raw documents.
- moderation: reports(reporter_id, subject_type, subject_id, reason), cases(id, subject_type, subject_id, status enum, priority, assigned_to, opened_at, closed_at), case_events (append-only), decisions(action takedown|rating_change|strike|restore, case_id), strikes, appeals. Dequeue with SKIP LOCKED like job_queue. Unify the moderator-action trail with ops.audit_log instead of a fourth 'events' table.
- compliance: age_verifications(user_id, method, provider, provider_ref, status, verified_at, expires_at, jurisdiction, evidence_hash) storing outcome plus reference only, with no raw ID images or DOB. creator_identity_verifications for creators/performers with tightly restricted access (owner role only). Keep legal_documents/consent_records/data_export_requests. Treat users.date_of_birth as self-reported or remove it; 0916 attestation is not verification.
- live: streams, stream_sessions, chat_messages (partitioned by time with automated partition maintenance, unlike events today), tips linked 1:1 to ledger journal_entries.
- Migration consolidation strategy: (1) Freeze the current 37 files and generate a reviewed baseline from `pg_dump --schema-only` of a fully migrated DB. Hand-clean it: drop jobs, tenant_settings or tenants.metadata, the backfill audit and redundant indexes; fix the invitation partial unique, the 0906 index and provider uniques; move tables into namespaces; colocate RLS with DDL. (2) Ship it as one file per module (meta, identity, org, ...), each touching only its own tables, so prune can remove a module's files cleanly. (3) For existing databases (bslt.dev demo), have the runner detect a legacy `migrations` table containing all 37 names and apply a one-time bridge migration (ALTER TABLE ... SET SCHEMA, renames, drops) that records the baseline as applied. (4) Adopt checksums, an advisory lock and a per-file no-transaction directive. (5) Add `db:codegen` so TS types and column maps come from the catalog.
- Conventions to codify for future TS platforms: plural snake_case tables in module schemas; ids via gen_random_uuid() or app-generated UUIDv7 (drop the uuid-ossp dependency); owner_user_id/org_id; row_version for optimistic locking only; created_at/updated_at with one trigger function per DB; statuses as enums; *_events only for append-only streams with a shared shape; constraint and index prefixes; every table classified in db:audit as rls_user | rls_org | public_read | system.

#### DB open questions

- Does any deployed database (app.bslt.dev demo or another environment) hold data that must survive the restructure? That decides between a non-destructive bridge migration and a clean history reset for bslt-main and the fork.
- Has the GCP Terraform path (non-superuser google_sql_user that owns the tables) ever been run? With FORCE RLS on tenants/tenant_settings/activities/files and policies only TO authenticated, those tables would probably be default-deny there.
- Billing direction: does bslt-main stay B2C (user-scoped, so drop the dormant tenant_id) or finish Phase 1 tenant billing? For the creator platform, who is merchant of record? Stripe and PayPal (the only billing_provider enum values) may not accept softcore content, which changes the provider mirror and whether the internal ledger is authoritative or a shadow.
- Are crypto payouts custodial (the platform holds keys and balances) or non-custodial (sends to creator wallets only)? This decides the ledger asset precision and the payout_attempts/tx tracking design.
- Age verification: third-party provider (store result plus reference only) or in-house? Which jurisdictions must be supported at launch? Should verification gate viewing softcore only, or also creator onboarding?
- Should realtime sync and the WriteService be adopted platform-wide (then keep row_version on every table) or removed (then drop the 0700 version columns)?
- Is schema-per-tenant mode worth keeping in bslt-main as a reusable option, given it has one demo table and a TS-defined DDL path, or should it be pruned before the fork?
- Should jobs/job_queue/cron_jobs and audit_events/security_events/activities be unified into one queue and one append-only audit stream before the creator domains add moderation and ledger logs?
- Which Postgres major is the floor (16 in app/CI vs 17 in editions/rust CI)? PG18 would allow native uuidv7().

### B.SRV. Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles

**Summary.** The server boots in clear phases from main/apps/server/src/bootstrap/system.ts: infra (logger, cache, pub/sub manager, error tracker), data (DB, repos, Postgres LISTEN/NOTIFY, queue store, WriteService, search), comms (email, storage, push, SMS, billing notifier), http (App DI container plus Fastify), then workers. Shutdown runs in reverse order. Route registration rests on a good framework-agnostic RouteMap contract in server/system. But routes are assembled in six places, and the edition-export and starter-prune tools edit them through exact-string anchors. The answer to the central question is mostly side by side, with a few real links. Notifications from the notification send path push a payload-less invalidation through pub/sub to the WebSocket. Media reuses the core files service and storage. Storage backs avatars, files, the audit archive and data hygiene. Workers run cron jobs for usage snapshots, analytics export and webhook retries. Everything else is disconnected. Nothing consumes or produces jobs: the job_queue table and QueueServer are idle and the jobs table is dead. There is no outbox or domain-event mechanism. WriteService is built but never called, and 11 of 13 webhook event types are never emitted. The cache reaches domains only as a {getStats} stub. About 95% of @bslt/media (FFmpeg, its own queue, its own HTTP module) is unwired, and about 900 lines of realtime permission code is exported but never used. Optional capabilities load by dynamic import of bare package names. From the dev checkout this cannot resolve @bslt/realtime, @bslt/media, @bslt/workers or ws (checked with require.resolve). The repo's own packaging test says this design took production down twice. Two real bugs: the App container drops billingNotifier, so billing-webhook notifications never fire, and the realtime write and read endpoints are an unscoped proxy onto the users table. Config is spread across duplicate loaders, and several adapters read process.env directly. server-rust is a separate, deliberate, loopback-only Rust auth slice for another product (Kanu), with its own schema and CI; it is not part of the TypeScript runtime.

#### Findings

##### SRV-01. Realtime record API is an unscoped read/write proxy onto the users table

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** db-security
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** When the realtime capability is on (the full profile and the Pro edition), any logged-in user can read complete user rows, including the password hash, and can set mutable columns on any user, for example role='admin', through POST realtime/write. A permission layer exists and is integration-tested in isolation, but nothing wires it in. This is accidental: DIRECTION.md:182 says the client sync engine that used this API was removed on 2026-06-12, so the endpoints are leftovers.

**Evidence:**

- main/server/realtime/src/service.ts:35-37 (tableNameMap = { users: USERS_TABLE }, the only registered table; registerRealtimeTable has no runtime caller)
- main/server/realtime/src/service.ts:144-148 loadRecords does select(tableName).where(inArray('id', ids)), which returns every column (password_hash, MFA fields, locked_until, role) to POST /api/realtime/getRecords
- main/server/realtime/src/handlers/subscribe.ts:66-107 checks only that the caller is authenticated, with no ownership check
- main/server/realtime/src/handlers/sync.ts:147-157 checks only that authorId equals the caller; there is no check that the target record belongs to the caller
- main/shared/src/modules/realtime/realtime.ts:178-185 PROTECTED_FIELDS covers only id, version, created_at, updated_at, password_hash and passwordHash; realtime.ts:609-615 is the only field guard, so role, email, email_verified and locked_until are writable on any user id
- main/server/db/migrations/0000_users.sql defines no RLS policy on users (grep for POLICY ... ON users finds none)
- main/server/realtime/src/permissions/* (913 LOC: permission.filter.ts, permission.middleware.ts, permission.propagation.ts) is exported from realtime/src/index.ts:63-78 but has no runtime consumer; it is exercised only by tests/integration/api/realtime-permissions.integration.test.ts

**Direction.** Delete the generic realtime/write and getRecords routes, or put them behind an explicit per-table policy: an owner column, read and write column allow-lists, and RLS. Keep realtime as a server-authored invalidation and event bus. Domain services publish; clients only subscribe. Replace the canSubscribeToKey deny-list with an allow-list resolver per channel namespace.

##### SRV-02. App DI container silently drops billingNotifier; billing service slot is never filled

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** coupling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The composition root defines the same service list four times: the PlatformContext, DataContext and InfraContext interfaces, IServiceContainer, the App getters, and the App.context object literal. Because the fields are optional, TypeScript does not catch a missing entry. That has already caused one silent production bug, and it leaves billing DI half built.

**Evidence:**

- main/apps/server/src/bootstrap/phases/comms.ts:108 and :198 build billingNotifier into InfraContext
- main/apps/server/src/bootstrap/context.ts:67 and :146 declare billingNotifier (optional) on InfraContext and IServiceContainer
- main/apps/server/src/bootstrap/app.ts:522-543 the App.context getter lists services by hand and omits billingNotifier; App has no billingNotifier getter
- main/apps/server/src/http/route-modules.ts:125 and :196 pass ctx.billingNotifier (always undefined) to the Stripe and PayPal webhook handlers
- main/server/core/src/billing/webhooks/shared.ts:101 does nothing when notifier is undefined, so dunning emails and payment alerts from webhooks never send
- context.ts:66/:143 and app.ts:530,575 expose `billing: BillingService` but no phase sets it; core handlers instead call createBillingProvider(ctx.config.billing) on every request (core/billing/handlers/payment-methods.ts:97,164,227,297; subscriptions.ts:84,132,202)

**Direction.** Replace the getter mirror with one immutable context object: AppContext = Object.freeze({ ...infraContext, log }), built once. Contextualize by spreading only db and repos. Remove optional fields, or add a compile-time exhaustiveness test such as `satisfies Record<keyof InfraContext, unknown>`. Create the billing provider once in a payments phase and inject it.

##### SRV-03. No working job queue: three job tables, an idle QueueServer, an in-memory media queue, and setInterval tasks

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The workers package is a scheduler, not a job runner. Domains cannot hand work to the background, so email, exports, webhook fan-out and media processing all run in the request or not at all. Job-shaped persistence exists in three tables, but only cron_jobs is live.

**Evidence:**

- main/server/db/migrations/0400_jobs.sql creates the jobs table; repos.jobs (server/db/src/factory.ts:265) has zero consumers
- main/server/db/migrations/0405_job_queue.sql plus 0915 add job_queue with an idempotency_key; PostgresQueueStore is used only for stats (apps/server/src/bootstrap/phases/data.ts:94-100), the admin job list (server/core/src/admin/jobsService.ts) and the weekly queue-cleanup task (server/workers/src/service.ts:258-275)
- server/db/src/queue/client.ts:331 createQueueServer is never called; there are no enqueue() call sites anywhere in server, apps or shared
- server/db/migrations/0907_cron_jobs.sql backs the leader-elected cron (server/workers/src/scheduler/scheduler.ts), the only durable scheduler
- server/workers/src/service.ts:78-362: 13 setInterval tasks run on every replica and also once at boot (line 351)
- server/media/src/queue/queue.ts is an in-memory CustomJobQueue ('Replaces BullMQ') that is never instantiated
- server/system/src/config/infra/queue.ts loads poll, concurrency and backoff settings that are only printed (server/system/src/runtime/health.ts:323)
- Work done inline in request handlers: data export (server/core/src/compliance/data-export/handlers.ts:117) and first webhook delivery (server/core/src/webhooks/emit.ts:59-79, which calls deliverEvent)
- docs/DIRECTION.md:186 marks 'Background job queue ✅ main/server/workers/'

**Direction.** Keep job_queue plus PostgresQueueStore and QueueServer, and drop the jobs table. Start a QueueServer consumer in the workers phase. Make cron handlers enqueue jobs rather than doing the work. Move the setInterval tasks onto cron. Let each domain module declare its job handlers in its module manifest, the same way it declares routes.

##### SRV-04. No outbox or domain-event mechanism; side effects are hand-wired fire-and-forget calls

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Each domain decides which side effects to fire, one call at a time. This is the clearest source of the owner's 'not linked together' feeling. Nothing guarantees that a write produces its webhook, notification, realtime update and activity entry. Results are inconsistent: billing notifications never wake the bell over WebSocket, and most webhook event types never fire.

**Evidence:**

- server/core/src/tenants/handlers/members.ts:118-150: after addMember, three separate `.catch(() => {})` calls (audit record, logActivity, emitWebhookEvent) run outside any transaction; there is no notification to the added user and no realtime publish
- shared/src/constants/system/comms.ts:12-26 declares 13 WEBHOOK_EVENT_TYPES; only member.added and member.removed are ever emitted (members.ts:145, :300). user._, tenant._, subscription.* and invoice.* are subscribable but never fire
- server/db/src/queue/write-service.ts:1-60 WriteService ('automatic pubsub publishing ... afterWrite hooks') is created in apps/server/src/bootstrap/phases/data.ts:121-125 and placed on the context, with zero callers
- Notification realtime publish happens only in server/core/src/notifications/send.ts:106; these producers write repos.notifications directly and never publish: billing/payment-notifications.ts:138,206,282, billing/handlers/support.ts:58, notifications/admin-alerts.ts:161
- Separate event stores with no shared emitter: audit_events (5 writer call sites in core), security_events (22), activities (17), events (analytics), billing_events, webhook_deliveries

**Direction.** Add a domain_events (outbox) table written in the same transaction as the business write. A single dispatcher, as a queue job, fans out to webhooks, notifications plus realtime, activities and audit, and analytics. Domain code publishes typed events from shared contracts and stops calling individual sinks. Either reuse WriteService's afterWrite hooks as the transaction hook point or delete it.

##### SRV-05. Optional capabilities load by bare-specifier dynamic import and do not resolve outside the Pro export

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** coupling
- **Severity:** high
- **Intentional?** yes (deliberate/documented)

**Description.** The design is deliberate and documented: optional packages must stay deletable by starter:prune. In practice it leaves capabilities that only run in the Pro export, a Dockerfile copy workaround, an unsupported media capability in the image, and a likely missing ws at runtime. All of this exists to avoid one edit to package.json.

**Evidence:**

- main/apps/server/src/bootstrap/optional-import.ts:7-22 calls import(specifier) for @bslt/realtime, @bslt/workers, @bslt/media and @bslt/comms
- main/apps/server/package.json declares only comms, core, db, server-system, shared and storage; apps/server/tsconfig.json paths and references omit realtime, media and workers
- main/tools/scripts/audit/profile-boundaries.ts:41-75 forbids @bslt/server from depending on @bslt/media, @bslt/realtime, @bslt/workers or 'ws'
- Checked read-only from main/apps/server: require.resolve fails (MODULE_NOT_FOUND) for @bslt/realtime, @bslt/media, @bslt/workers and ws, and succeeds for comms and storage
- main/tools/scripts/profiles/apply.ts:99-113 writes only the generated .ts files and adds no dependencies, yet docs/DIRECTION.md:65-70 says to enable media with `pnpm profiles:apply --profile custom ...`
- main/apps/server/src/bootstrap/optional-capability-packaging.test.ts:1-60 says the mechanism 'took production down twice' and lists @bslt/media as KNOWN_UNSHIPPED: 'enabling it will fail at boot'
- infra/docker/Dockerfile:58-105 hand-copies the realtime and workers dist folders into the image
- main/server/realtime/src/websocket/lifecycle.ts:14 imports 'ws', but pnpm-lock.yaml:422-448 lists ws only as a devDependency of main/server/realtime (an optional peer in its package.json), so the deployed closure probably has no ws
- main/tools/scripts/editions/export.ts:390-396 adds media, realtime and workers as dependencies only when exporting Pro

**Direction.** Generate one capability registry module that statically imports each enabled capability's plugin entry, and have profiles:apply and starter:prune rewrite that registry and package.json together. For the creator fork, make realtime, media and workers mandatory dependencies and remove the gating.

##### SRV-06. The workers phase owns WebSocket registration and the startup summary

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** coupling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Capability lifecycles are not modular. The 'workers' phase is really a 'late optional stuff' phase, so turning off background jobs also turns off live updates and the startup health report.

**Evidence:**

- main/apps/server/src/bootstrap/system.ts:76-78: workers are enabled, or createDisabledWorkersState runs
- main/apps/server/src/bootstrap/phases/workers.ts:107-120: realtime.registerWebSocket(app.server, ...) is called inside startWorkersPhase
- main/apps/server/src/http/route-modules.ts:32-44 registers realtime HTTP routes behind the realtime flag alone, so realtime without workers serves /api/realtime/* but has no /ws
- workers.ts:148-172 runs logStartupSummary and the schema-validation health summary only on the workers path; the disabled state is a no-op (system.ts:44)
- system.ts:58-67 stops workers through a second dynamic import

**Direction.** Give each capability a module with start(ctx), stop() and health() hooks (realtime, jobs, cron, media), and register them through the capability registry. The startup summary should belong to the http phase.

##### SRV-07. Retention and anonymization exist three times with incompatible email formats, so hard-delete never runs in the workers profile

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Domain jobs live in the workers package, not in their domains, and the starter fallback re-implements them. The copies have already drifted into a GDPR bug: in the workers and full profiles, anonymized users are never hard-deleted.

**Evidence:**

- main/apps/server/src/bootstrap/phases/retention.ts:54-85 copies the workers hard-ban job (the comment at :47-52 says 'Minimal in-process counterpart')
- main/server/workers/src/pii-anonymization.ts:52-63 writes `deleted-<16hex>@anonymized.local`
- main/server/core/src/users/pii-anonymization.ts:80-130 writes `<sha256>@anonymized.local`
- main/server/core/src/users/data-hygiene.ts:392 ANONYMIZED_EMAIL_PATTERN = /^[a-f0-9]{64}@anonymized\.local$/; hardDeleteAnonymizedUsers (:423-445) deletes only matching rows
- main/server/workers/src/service.ts:222-240 schedules workers' own anonymizeDeletedUsers, not core's anonymizeExpiredUsers, so users anonymized under the workers profile never match the hard-delete pattern
- main/server/db/src/repositories/users/users.ts:385-394 listAnonymizationCandidates excludes only 'deleted-%', so the workers job re-anonymizes core-format rows into the format hard-delete cannot match
- retention.ts:96-99 says core's function is 'the only producer of the 64-hex@anonymized.local addresses that hard-delete-anonymized purges'
- Billing trial-expiry rules live inside the infrastructure package: workers/src/service.ts:106-134

**Direction.** Move every retention job into core/users as named job definitions, with one anonymization format. The starter in-process runner and the workers cron should schedule the same definitions. Billing jobs belong to the billing module.

##### SRV-08. @bslt/media is about 95% unwired, and there are two media HTTP modules

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** dead-code
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Media and uploads are linked at the CRUD level: the app reuses core/files and storage. The processing pipeline (async jobs, video, thumbnails, scanning) exists only as unreachable library code with an in-memory queue and an in-memory database.

**Evidence:**

- main/apps/server/src/http/media/engine.ts:38-43: the app uses only getImageFormat, validateImage, resizeImage and optimizeImage (from image-processing.ts, 274 LOC)
- main/server/media/src/http/* (891 LOC) has its own mediaRoutes, handlers and service, which hardcode storageProvider 'local' and queue.addJob; no package imports it
- Code with no consumer outside the package: ffmpeg-wrapper.ts (609 LOC, incl. createHLSStream and generateThumbnail), processors/ (744), queue/ (1027), processor.ts (297), facade.ts ServerMediaQueue (213), database.ts InMemoryMediaDatabase (393), utils/streaming.ts (363), security.ts BasicSecurityScanner (156)
- The app-side duplicate: main/apps/server/src/http/media/{routes,handlers,service,types,engine}.ts (about 667 LOC), which does processing synchronously in the request
- docs/DIRECTION.md:183 claims 'File / media processing (resize, EXIF, FFmpeg) ✅'
- main/server/media/package.json:24-28 depends on server-system and sharp; docs/architecture/server-dependency-dag.md lists only db and shared

**Direction.** Keep image-processing and the ffmpeg wrapper as a pure library. Delete media/http, facade, the in-memory database, the custom queue and the retry handler. Rebuild processing as queue jobs triggered by a file.uploaded domain event.

##### SRV-09. apps/server ships about 1.4k lines of tested but unwired middleware and plugins

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** dead-code
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The composition app's barrels look like a feature set, but app.ts registers only cookie, CSRF, geo, security headers, static, validation, multipart, raw-body, correlation-id, request-info, logger and errors. The tests on the dead modules inflate apparent coverage.

**Evidence:**

- main/apps/server/src/http/file-server.ts (372 LOC): registerFileServer is only re-exported (http/index.ts:10) and never called; its HMAC logic duplicates server/storage/src/signing.ts
- main/apps/server/src/middleware/permissions.ts (510 LOC): createPermissionMiddleware and createStandalonePermissionGuard are only re-exported (middleware/index.ts:83-92); the same name exists in server/realtime/src/permissions/permission.middleware.ts:139
- main/apps/server/src/middleware/locale.ts (205 LOC): registerLocaleHook is never registered
- main/apps/server/src/middleware/pagination.ts (107 LOC): createPaginationMiddleware is never used
- main/apps/server/src/plugin/api.versioning.ts plus .types.ts (237 LOC): apiVersioningPlugin is never registered
- Each of these has a colocated *.test.ts (file-server, permissions, locale and pagination tests are in src/)

**Direction.** Delete these modules, or wire the ones the creator platform needs (locale; signed file serving through storage) into a single middleware registration list in app.ts.

##### SRV-10. Configuration is split across duplicate loaders, direct process.env reads and leftover provider configs

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** config
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Config ownership is documented ('do not read process.env directly in business logic') but the adapters and entry points do not follow it. The migrate entry point and the server can build different connection strings. Push and SMS settings never pass through validated AppConfig.

**Evidence:**

- main/server/system/src/config/factory.ts:151-231 is the intended single loadConfig()
- main/server/comms/src/sms/factory.ts:66-76 and notifications/providers/factory.ts:104-111 read process.env directly (SMS__, TWILIO__, VAPID_*), called from apps/server/src/bootstrap/phases/comms.ts:147-165
- main/apps/server/src/bootstrap/phases/infra.ts:54 reads process.env SENTRY_DSN
- main/server/system/src/config/services/notifications.ts:20-118 models OneSignal, Courier, Knock, SNS and Braze, none of which is implemented; the config is only validated and printed (factory.ts:263, runtime/health.ts:327)
- Duplicate loaders: server/system/src/cache/config.ts:30 loadCacheConfig() (process.env) vs server/system/src/config/infra/cache.ts:17 loadCacheConfig(env); server/storage/src/config.ts:10-44 loadStorageConfig() (process.env, default './storage', region 'us-east-1') vs server/system/src/config/infra/storage.ts:87-128 (default apps/server/uploads)
- Two buildConnectionString: server/db/src/client.ts:376 (raw env, default db 'app_dev', used by apps/server/src/migrate.ts) vs server/system/src/config/infra/database.ts:70 (typed config, used by phases/data.ts:73)
- main/server/system/src/config/infra/storage.ts:113-114 hardcodes resolve(currentDir, '../../../../../apps/server/uploads'), so the infrastructure package knows the app's path
- A stray nested upload directory, main/apps/server/main/apps/server/uploads/, results from STORAGE_ROOT_PATH variants (config/env/.env.development:115 './uploads' vs .env.local:168 'main/apps/server/uploads')
- main/server/system/src/config/README.md:13-23 describes main/apps/server/src/config/, which no longer exists

**Direction.** Use one config pipeline: initEnv, then EnvSchema, then AppConfig. Every adapter factory takes typed config slices only, and the *FromEnv factories and duplicate loaders are removed. Delete the leftover notification provider configs. Have the migrate entry point use loadConfig().

##### SRV-11. The cache is built but never handed to domains; user cache-aside is a silent no-op

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** coupling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** A clear example of a capability built next to the domains rather than inside them. The domains defensively probe for a cache that the composition root never passes them.

**Evidence:**

- main/apps/server/src/bootstrap/phases/infra.ts:46-49 creates the cacheProvider but puts only { getStats } on the context
- main/server/core/src/users/handlers/profile.ts:57-59 reads through the cache only if hasUserCache(ctx.cache), which is always false
- main/server/core/src/users/handlers/avatar.ts:295, account.ts:312 and username.ts:106 guard invalidation with typeof ctx.cache.delete === 'function', which is always false
- main/server/system/src/cache/ is 1,779 LOC (LRU, memory and Redis providers)

**Direction.** Expose a narrow CacheProvider port, defined in shared contracts, on AppContext, or remove the dead cache-aside code. Reuse the same Redis connection for rate limiting and pub/sub where possible.

##### SRV-12. Infrastructure helpers are duplicated across apps/server, server/system and shared

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The split between apps/server (Fastify composition) and server/system (reusable runtime) is sound in principle, but code has been moved back and forth. The leftovers are copies with diverging behavior and stale docs.

**Evidence:**

- Port utilities: apps/server/src/bootstrap/phases/http.ts:27-52 (isPortFree, pickAvailablePort) vs server/system/src/runtime/port.ts:19,71, whose exports have no external consumers
- CIDR parsing: shared/src/modules/system/http/proxy.ts:46 parseCidr vs server/system/src/security/ip-blocklist.ts:137 parseCidr (different return types, same name)
- Rate limiters: shared/src/modules/system/security/rate.limit.ts:38 createRateLimiter (used by apps/server/src/middleware/static.ts:13-20) vs server/system/src/security/rate-limit.ts:628 (used by app.ts:215)
- HMAC URL signing: server/storage/src/signing.ts:20-40 vs apps/server/src/http/file-server.ts:31-52
- hasMethod/callIfMethod copied in apps/server/src/bootstrap/phases/infra.ts:20-37 and data.ts:50-67
- Email templates: server/core/src/auth/email-templates.ts (plain-text fallback) vs server/comms/src/email/templates/templates.ts (1,024 LOC)
- server/system/README.md lists correlation-id, multipart, prototype-pollution and request-info hooks under @bslt/server-system/http, but they live in apps/server/src/plugin/*; the ./routing subpath alias has 0 consumers; @simplewebauthn/server is declared in server/system/package.json:100 but used only in core
- Ten separate `declare module 'fastify'` augmentations across apps/server/src (types/fastify.d.ts, plugin/_, middleware/_)

**Direction.** Give each concern one home: Fastify-specific code in the app or a server-http package, framework-agnostic code in server/system. Delete the shared copies with lower usage. Collect all Fastify type augmentations in one file.

##### SRV-13. Route registration is spread across six places plus text-patch anchors in tools

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** wiring-sprawl
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** Adding a domain means touching several registries. The bootstrap files are effectively frozen, because three tools (edition export, starter prune, recipes) match their exact text. Any restructure of apps/server/src/bootstrap or http will break those tools unless the tools are reworked first.

**Evidence:**

- main/server/core/src/route-modules.ts:36-53 (18 core modules)
- main/apps/server/src/http/route-modules.ts:53-76 (core with auth and user overrides, realtime, media, system)
- main/apps/server/src/http/router.ts:88-95 registers billingRoutes unconditionally, outside both registries; raw Stripe and PayPal webhooks are gated (:93-95)
- main/apps/server/src/bootstrap/app.ts:340-343 raw /api/csrf-token route; :355-437 Swagger docs plus a docs auth hook
- main/apps/server/src/http/auth-route-overrides.ts:101-165 filters routes by auth strategy
- main/editions/core/main/apps/server/src/{http/route-modules.ts.template, extensions/index.ts.template}: an extension-pack route and signed-webhook registrar that exists only in exported Core (the dev root has no src/extensions, yet middleware/csrf.ts:107-114 exempts /api/extensions/_/webhooks/_)
- main/tools/scripts/editions/export.ts:297-311 rewrites router.ts by exact string (removeExact)
- main/tools/scripts/starter/prune-manifests-packages.ts:132-625 and prune-manifests-features.ts:1123-1127 pin 13 anchors in bootstrap/system.ts, phases/workers.ts, phases/retention.ts, http/route-modules.ts and http/system-routes.ts

**Direction.** Define one module manifest type (id, routes, jobs, cron, event handlers, capability requirements, OpenAPI annotations) and have each module export one. Generate a single installed-modules registry, which the dev root, Core export, prune and features:add all edit as data. Retire removeExact string patches.

##### SRV-14. Local storage serves uploads publicly, unsigned and without auth, unlike S3

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** other
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Private file attachments and media are reachable by URL in local mode. Signing utilities exist but the local provider does not use them. That is tolerable for a dev-only provider, but it is a trap for any paid or private content.

**Evidence:**

- main/server/storage/src/providers/local.ts:114-121 getSignedUrl returns `${publicBaseUrl}/${key}` (or file://) with no signature or expiry
- main/apps/server/src/bootstrap/app.ts:347-352 registers /uploads/ static serving whenever storage.provider === 'local'
- main/apps/server/src/middleware/static.ts:17-21,106-119 protects /uploads/ with rate limiting only, with no auth or ownership check
- main/server/storage/src/providers/s3.ts:118-124 returns real presigned URLs with an expiry, so the security meaning depends on the provider
- main/server/storage/src/signing.ts (HMAC sign and verify) has no runtime consumer; the only importer of @bslt/storage is apps/server/src/bootstrap/phases/comms.ts:5
- main/server/storage has 0 test files (904 LOC including key normalization and the S3 wrapper)

**Direction.** Have LocalStorageProvider issue HMAC-signed, expiring URLs using storage/signing.ts, verified by a single file-serving route that checks access through a policy hook. Use the same access interface for S3 presigning. Add a storage test suite.

##### SRV-15. Capability profile model is inconsistent; several flags gate nothing

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** config
- **Severity:** low
- **Intentional?** yes (deliberate/documented)

**Description.** Edition, profile, recipe and flag are four overlapping ideas of 'what is installed', and only four capability flags change behavior. This is deliberate and documented (core-and-extensions.md:14-16, DIRECTION.md:40-70), but it adds conceptual weight with little runtime effect.

**Evidence:**

- main/profiles/capability-registry.ts:76-84 marks storage as tier 'optional', enabledByDefault false, but storage is always constructed (apps/server/src/bootstrap/phases/comms.ts:91-94,107,195) and nothing calls isServerCapabilityEnabled('storage')
- main/profiles/capability-registry.ts:49-57 marks comms as tier 'minimal', yet capability-groups.ts:12 lists it under 'optional', and comms is both a static dependency (apps/server/package.json) and dynamically imported (phases/comms.ts:118-165)
- The core, db and system flags have no runtime gate; only 9 isServerCapabilityEnabled call sites exist (system.ts, phases/workers.ts, route-modules.ts, system-routes.ts)
- main/profiles/profiles.core.ts aliases the starter profile as CORE_PROFILE, which clashes with the 'core' source edition (docs/architecture/core-and-extensions.md:9-16)
- main/profiles/generated/enabled-capabilities.generated.ts has no runtime importer, only tools and tests; the active profile is 'starter' (apps/server/src/bootstrap/generated/profile.generated.ts:20-21)
- The Postgres LISTEN/NOTIFY adapter starts in every profile (phases/data.ts:81-92), even without the realtime capability that consumes it

**Direction.** Merge profile gating into the module manifest: a module is installed (statically registered) or it is absent. Keep env flags for provider configuration only.

##### SRV-16. Tests give false confidence for unwired code and leave wired adapters untested

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** test-topology
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Coverage is concentrated on code that does not run, while the composition root and production adapters lack end-to-end tests. That is how the billingNotifier drop and the optional-capability resolution failures went unnoticed.

**Evidence:**

- tests/integration/api/realtime-permissions.integration.test.ts imports @bslt/realtime/permissions/* internals that the runtime never uses
- apps/server/src/http/file-server.test.ts, middleware/permissions.test.ts, middleware/locale.test.ts and middleware/pagination.test.ts test unwired modules
- main/server/storage: 0 tests; main/server/comms/src/email/smtp.client.ts (501 LOC hand-rolled SMTP 'Replaces nodemailer') has no test; comms has 4 test files, for SMS factory, templates and web-push
- docs/CLAUDE.md:71-73 lists 'booting the cross-domain smoke through the real composition root' as remaining debt

**Direction.** Add one composition-root smoke test that boots bootstrapServerSystem with each profile and asserts every InfraContext field reaches AppContext, every capability module resolves, and /ws accepts a connection. Move tests to follow wiring.

##### SRV-17. server-rust is a separate, deliberate experiment for another product

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** other
- **Severity:** low
- **Intentional?** yes (deliberate/documented)

**Description.** It is live as an isolated, actively gated slice (its own CI lane), but it shares nothing with the TypeScript runtime: no shared schema, auth, contracts or deployment. It is not fragmentation of the TypeScript platform, but it adds weight to the repo.

**Evidence:**

- main/apps/server-rust/README.md: 'opt-in, loopback-only development backend, not a production release or a drop-in replacement for the TypeScript starter'
- Own schema bslt_rust: main/apps/server-rust/migrations/0001_foundation.sql, 0002_access.sql (users and sessions independent of the TypeScript users table)
- API /api/rust/auth/*; web entry main/apps/web/rust.html with vite.rust.config.ts and playwright.rust.config.ts; CI in .github/workflows/rust-backend.yml
- docs/dev/rust-backend.md: 'Kanu's application backend is Rust'; reusable generic slice only
- 1,243 LOC of Rust; last commit touching it is a4fb5d9d (2026-10-01); excluded from editions (docs/architecture/core-and-extensions.md:117-120)

**Direction.** Leave it out of the creator-platform fork. For bslt-main, consider moving it to its own repository with the Rust React entry, since it only reuses the Vite workspace.

##### SRV-18. Status docs overstate how far several capabilities are integrated

- **Area:** Server composition and runtime capabilities: main/apps/server, main/server/system, main/server/realtime, main/server/media, main/server/workers, main/server/storage, main/server/comms, main/apps/server-rust, main/profiles
- **Category:** docs
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The docs are extensive but describe modules as done when they exist, not when they are wired. Restructure planning should not rely on the ✅ markers for this area.

**Evidence:**

- docs/DIRECTION.md:186 'Background job queue ✅ main/server/workers/' (no consumer exists)
- docs/DIRECTION.md:183 'File / media processing (resize, EXIF, FFmpeg) ✅' (FFmpeg is unwired)
- docs/DIRECTION.md:141 'In-app notifications (websocket-driven) ✅' (4 producers bypass the publish)
- docs/DIRECTION.md:173 'Hard-delete + PII anonymization ✅ main/server/workers/' (format mismatch; see the retention finding)
- main/server/core/src/notifications/send.ts:5-7 says 'web-push package removed', but main/server/comms/package.json has web-push and core/notifications/push-dispatch.ts is wired
- docs/architecture/server-dependency-dag.md is 'Last verified: 2026-06-08' and omits media's server-system dependency

**Direction.** Re-baseline DIRECTION.md status against the runtime wiring map after the restructure, or generate the capability status table from the module manifest.

#### SRV strengths (preserve)

- Phased bootstrap with symmetric shutdown and frozen per-phase contexts: apps/server/src/bootstrap/system.ts:69-92, phases/infra.ts:72-78, phases/data.ts:129-145. A good skeleton to keep: the phases just need to become capability modules.
- Framework-agnostic RouteMap contract with scoped helpers, default-protected routes and a route registry. The registry feeds the admin route manifest, route governance and API client generation: server/system/src/http/routing.ts and route.registry.ts, tools/scripts/audit/route-manifest.ts.
- One protected-route pipeline: JWT guard, then RLS contextualization (tenant header checked against membership before SET LOCAL), then the ToS gate: apps/server/src/http/router.ts:55-68 and bootstrap/context.ts:243-297. Tenancy mode (shared RLS vs schema-per-tenant) is abstracted in phases/data.ts:137-144.
- Leader-elected durable cron scheduler using a transaction-scoped advisory lock, atomic claim and catch-up replay: server/workers/src/scheduler/scheduler.ts. A solid base for a unified job system.
- Realtime bus design: payload-less {key, version} invalidations, a Postgres LISTEN/NOTIFY adapter for multiple instances, and per-user channel authorization: shared/src/modules/db/pubsub/authorize.ts and server/core/src/notifications/publish.ts. Safe by construction for notifications.
- Hardened WebSocket lifecycle: CSRF validated on upgrade, 64 KB max payload, heartbeat reaping, exactly-once teardown, token from subprotocol or cookie with no query tokens: server/realtime/src/websocket/lifecycle.ts.
- Security middleware ordering and production strictness: IP blocklist first, Redis required for rate limiting in production (app.ts:158-182), geo gate after CORS so the SPA can read the block (app.ts:288-325), CSRF double-submit, HTTPS-only URLs enforced in production config (server/system/src/config/factory.ts:268-280), exact port binding in production (phases/http.ts:63-90).
- StorageClient port in shared contracts with local and S3 providers, atomic local writes and key normalization; already used by avatars, files, media, audit archiving and data hygiene.
- Adapters behind interfaces with dev-friendly fallbacks: console email and SMS, an inert web push when VAPID is unset, and a fallback comms state.
- The app media module reuses core/files for CRUD with owner-or-admin checks instead of keeping a parallel files table: apps/server/src/http/media/service.ts:99-165.
- Guardrails worth keeping as patterns: drift tests on generated profile files, the optional-capability packaging test that documents real failure modes, and audit:profile-boundaries.

#### SRV inventory

| Path                            | Purpose                                                                                                                                                                                                                                          | Size                                   | Notes                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| main/apps/server/src/bootstrap  | Composition root: phases (infra, data, comms, http, workers, retention), App DI container, Fastify server factory, request context and RLS contextualization, DB health sampler, generated profile flags                                         | 2,156 LOC src / 1,365 test             | app.ts 613, context.ts 297, phases/comms.ts 215, phases/workers.ts 178, phases/data.ts 175, phases/retention.ts 162 |
| main/apps/server/src/http       | App route composition (router.ts, route-modules.ts, auth-route-overrides.ts), health and metrics routes, app-owned media capability module, unused file-server                                                                                   | 1,719 LOC src                          | file-server.ts (372) unwired; http/media/* about 667 LOC                                                            |
| main/apps/server/src/middleware | Cookie, CSRF, geo, security headers and CORS, static /uploads with Range support, input validation; plus unwired locale, pagination and permissions                                                                                              | 1,920 LOC src / 3,932 test             | permissions.ts 510, locale.ts 205, pagination.ts 107 are not registered                                             |
| main/apps/server/src/plugin     | Fastify plugins: correlation id, request info, logger, error handler, multipart, raw body, prototype pollution; unused API versioning                                                                                                            | 670 LOC src                            |                                                                                                                     |
| main/apps/server/src/migrate.ts | Container migration entry point (uses @bslt/db buildConnectionString from raw env)                                                                                                                                                               | 76 LOC                                 |                                                                                                                     |
| main/server/system/src          | Reusable runtime: config loading and validation (config/), cache providers, logger, observability (Sentry, metrics), security (JWT, CSRF tokens, rate limiter, IP blocklist), HTTP RouteMap and registry, health and port runtime, error mapping | 8,428 LOC src / 3,856 test             | config 1,958; cache 1,779 (only getStats reaches domains); security 1,685                                           |
| main/server/realtime/src        | WebSocket server (/ws), realtime/write and getRecords record API (users table only), unwired permission filter, middleware and propagation                                                                                                       | 2,546 LOC src / 1,721 test             | permissions/ 913 LOC with no runtime consumer                                                                       |
| main/server/media/src           | Image processing (sharp), FFmpeg wrapper, audio/video/image processors, in-memory job queue and retry, in-memory media DB, facade, own HTTP module                                                                                               | 5,294 LOC src / 4,004 test             | Runtime uses only 4 image functions; http/ (891) and queue/ (1,027) unwired                                         |
| main/server/workers/src         | 13 setInterval maintenance tasks (service.ts) plus a leader-elected cron scheduler with 3 cron jobs (usage snapshot, analytics export, webhook retry)                                                                                            | 1,419 LOC src / 1,081 test             | Depends on @bslt/core; domain logic (trial expiry, anonymization) lives here                                        |
| main/server/storage/src         | StorageClient providers (local, S3), S3 presigner, HMAC signing utilities, env-based config loader                                                                                                                                               | 904 LOC src / 0 test                   | signing.ts and loadStorageConfig are unused at runtime                                                              |
| main/server/comms/src           | Hand-rolled SMTP client and email service, console email, HTML email templates (auth, billing, tenants), SMS (Twilio, console), web push (VAPID) provider service                                                                                | 2,460 LOC src / 420 test               | smtp.client.ts 501 LOC untested; templates.ts 1,024 LOC                                                             |
| main/apps/server-rust           | Opt-in loopback-only Rust (axum, tokio-postgres) auth and session slice for Kanu reuse; own bslt_rust schema                                                                                                                                     | 1,243 LOC Rust plus 578 LOC Rust tests | Separate CI workflow rust-backend.yml; excluded from editions                                                       |
| main/profiles                   | Capability registry (8 capabilities), groups, starter/core/full presets, selection parsing, generated enabled-capabilities file                                                                                                                  | 340 LOC src / 82 test                  | Not a workspace package; consumed by main/tools scripts and the generated-file tests; active-profile.json = starter |

#### SRV wiring points

- `main/apps/server/src/main.ts`: Process entry: loadConfig() from @bslt/server-system/config, then ServerRuntime.start() and signal handlers
- `main/apps/server/src/bootstrap/system.ts`: Phase order infra → data → comms (or fallback) → http → workers (or in-process retention sweeps) → listen; reverse-order stop; capability gates for comms and workers
- `main/apps/server/src/bootstrap/phases/infra.ts`: Logger, cache provider (exposed as {getStats} only), SubscriptionManager pub/sub, error tracker (SENTRY_DSN read from process.env)
- `main/apps/server/src/bootstrap/phases/data.ts`: DbClient, 40 repositories, Postgres LISTEN/NOTIFY pub/sub adapter, PostgresQueueStore (stats only), WriteService (unused), SQL search provider (users table), contextualize() for RLS and tenant schema
- `main/apps/server/src/bootstrap/phases/comms.ts`: Email service (SMTP or console via dynamic @bslt/comms import), auth, billing and tenant email templates, storage (always), web push service, SMS provider, billingNotifier
- `main/apps/server/src/bootstrap/phases/http.ts`: Creates App (DI container) and runs app.init() (createServer plus registerRoutes); port binding policy
- `main/apps/server/src/bootstrap/app.ts`: Fastify plugins and hooks (compress, prototype pollution, multipart, raw body, correlation id, request info, logger), IP blocklist, security headers, CORS, rate limit, geo gate, cookies, CSRF, /api/csrf-token, error handler, /uploads static, input validation, Swagger at /api/docs; App getters and App.context (hand-listed; omits billingNotifier)
- `main/apps/server/src/bootstrap/context.ts`: PlatformContext, DataContext, InfraContext, IServiceContainer and AppContext types; contextualizeRequest (tenant header and membership check before RLS session)
- `main/apps/server/src/http/router.ts`: Auth guard factory (JWT, then contextualize, then ToS gate with exempt paths); registers every route module plus billingRoutes; raw Stripe and PayPal webhooks when billing is enabled
- `main/apps/server/src/http/route-modules.ts`: coreRouteModuleRegistrations with auth and user overrides, realtimeRoutes (dynamic, gated), mediaRoutes (gated), systemRoutes; Stripe and PayPal webhook handlers
- `main/apps/server/src/http/system-routes.ts`: /health, /health/geo, /health/ready, /health/live, /health/detailed (admin), /metrics, /metrics/prometheus (public)
- `main/apps/server/src/bootstrap/phases/workers.ts`: registerWebSocket (realtime) plus registerScheduledTasks (13 interval tasks) plus startCronScheduler (3 cron jobs) plus startup summary; only when the workers capability is on
- `main/apps/server/src/bootstrap/phases/retention.ts`: Starter fallback: daily in-process anonymization, hard-delete and token/unverified-user cleanup when workers is off
- `main/apps/server/src/bootstrap/generated/profile.generated.ts`: ENABLED_SERVER_CAPABILITIES and isServerCapabilityEnabled(), generated by main/tools/scripts/profiles/render.ts from main/profiles/active-profile.json
- `main/apps/server/src/bootstrap/optional-import.ts`: importOptionalCapability(): bare-specifier dynamic import for @bslt/comms, @bslt/realtime, @bslt/workers and @bslt/media
- `main/server/core/src/route-modules.ts`: The 18 core route modules (dependency outside this area)
- `main/server/workers/src/scheduler/register.ts`: Cron jobs usage-snapshot, analytics-export and webhook-retry
- `main/server/workers/src/service.ts`: Interval tasks: oauth-refresh, trial-expiry, login, auth-token, push, session, audit-retention, billing-events, pii-anonymization, hard-ban-anonymization, data-export, queue cleanup, hard-delete, data-hygiene-files
- `main/server/realtime/src/service.ts`: Realtime table allow-list (users only), resolveTableName injected into WebSocket deps
- `main/shared/src/modules/db/pubsub/authorize.ts`: canSubscribeToKey deny-list for per-user channels (notifications); used by realtime/src/websocket/lifecycle.ts:474
- `main/server/core/src/notifications/send.ts`: The only domain path that publishes to realtime (publishNotificationCreated at :106)
- `main/tools/scripts/editions/export.ts`: Text patches to router.ts, core/src/index.ts and server-system observability for Core; adds media, realtime and workers deps to @bslt/server for Pro
- `main/editions/core/main/apps/server/src/**/*.template`: Core-edition composition: route-modules, extensions registry (featureRouteModules, registerFeatureWebhooks), stub workers phase, comms phase
- `main/tools/scripts/starter/prune-manifests-packages.ts`: Anchored text deletions in bootstrap/system.ts, phases/workers.ts, phases/retention.ts, http/route-modules.ts and http/system-routes.ts when pruning workers, realtime or media
- `infra/docker/Dockerfile`: Builds and copies the realtime and workers dist folders into the deploy image (lines 58-105) because they are not graph dependencies

#### SRV creator-platform notes

- Realtime must become central for a live-first product. Keep the SubscriptionManager plus Postgres NOTIFY bus, the WebSocket hardening and the payload-less invalidation pattern for feeds. Add server-authored channels that carry payloads for live tips, chat and presence (rooms per stream). Authorize channels with an allow-list tied to entitlements (subscriber, PPV purchase, age-verified). Delete the generic realtime/write and getRecords API. NOTIFY's roughly 8 KB payload limit and per-instance sockets point to Redis pub/sub at scale.
- Media needs a durable async pipeline built on the unified queue: direct-to-S3 presigned upload, then a file.uploaded event, then virus/type scan, then transcode to HLS (the existing ffmpeg-wrapper createHLSStream and generateThumbnail are reusable), then a blurred or teaser derivative for PPV, then moderation and rating classification (SFW/softcore), then publish. Nothing in media, storage or comms has a moderation hook today; the ContentModerationResult type in shared/media is unused.
- Storage must enforce the SFW/softcore split and paid access at the data layer: separate buckets or prefixes per rating, short-lived signed URLs (or CDN signed cookies for HLS) issued only after an entitlement check, and no public /uploads path for paid content. LocalStorageProvider currently returns unsigned public URLs.
- Payments, tips and payouts (including crypto) need a transactional outbox and an idempotent job queue (job_queue already has idempotency_key from migration 0915) for ledger postings, payout batches, chain confirmations, webhook fan-out and notifications. The current fire-and-forget pattern (members.ts) and inline webhook delivery are not safe for money movement.
- Fix the composition root before building on it. Remove the hand-written App getter mirror (the billingNotifier drop), inject the billing and payment provider once rather than calling createBillingProvider per request, and replace the six route-registration places with one module manifest. Creator modules (subscriptions, PPV, tips, payouts, moderation, age verification) then each register routes, jobs, cron and event handlers in one place.
- In the fork, make realtime, media and workers mandatory. Drop profile gating, the bare-specifier dynamic imports, the Dockerfile copy workaround, starter:prune anchors and edition text patches for these packages.
- Consolidate configuration into typed AppConfig before adding many new secrets (payment processors, crypto payout keys, KYC and age-verification vendors, CDN signing keys). Adapters must take typed config, not process.env.
- The starter retention fallback and the workers jobs disagree on the anonymization format. Unify them in core before adding creator-specific data-retention duties (2257-style records, payout tax data, moderation evidence holds), or GDPR deletion will break again.
- Leave server-rust out of the fork. It is a separate Kanu-oriented auth slice with its own schema and no shared contracts.

#### SRV open questions

- Does any client still call POST /api/realtime/write or /api/realtime/getRecords? DIRECTION.md:182 says the client sync engine was removed on 2026-06-12. If nothing calls them, deleting them closes the users-table exposure.
- Has the full or a custom profile with realtime, media or workers ever booted from the dev checkout? require.resolve from main/apps/server fails for all three and for ws. Check whether integration tests hide this through vitest aliases in tools/scripts/audit/shared-vitest-aliases.
- Does the production Docker image with realtime enabled fail on import 'ws'? The lockfile shows ws only as a realtime devDependency, and the packaging test checks only `dependencies`, not peers. This needs an image build to confirm.
- Should the 13 setInterval tasks keep running on every replica? trial-expiry, cleanups and anonymization run once per replica per interval, and once at every boot.
- Which queue table should survive, job_queue (QueueStore, idempotency key) or jobs (enum status, priority)? Neither currently has a producer.
- Are /metrics and /metrics/prometheus meant to be public (system-routes.ts:132-144), or should they sit behind the admin guard or a scrape token?
- Does the Core/Pro edition export, storefront and extension-pack machinery move into the creator fork? It pins bootstrap and router source text and keeps a second composition root in main/editions.
- Is the web-push path (comms WebPushProvider and core push-dispatch.ts) used in production, given that core/notifications/send.ts:5-7 says it was removed?

### B.TOOL. Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files

**Summary.** This area is BSLT's control plane: about 28.6k non-test LOC of tooling in main/tools (plus about 8k LOC of tool tests), 156 root scripts (not ~200), 19 GitHub workflows (3,257 lines), 2 Woodpecker pipelines, Terraform for DO and GCP, 4 compose stacks, and a commercialization layer (Core/Pro editions, feature packs, storefront). Roughly 19k non-test LOC (about 27k with tests) is "productization machinery": editions, profiles, recipes, setup wizard, prune, feature installer, storefront. Each piece has its own feature vocabulary and registry, and the code already admits this in places (main/tools/setup/manifest.ts:5-8 says "Setup knowledge was historically fragmented"; prune-manifests.ts:268-280 needs a FEATURE_TO_PRUNE_ID translation table). The tooling is unusually rigorous. Exact-match prune anchors, gate-coverage, vite-build-args and drift audits all fail loudly. But that rigor turns into a heavy relocation tax. Prune manifests pin 239 edits across 133 files. 2,368 of 2,374 TS files carry path headers. About 410 tsconfig path aliases sit in 27 files. 22 scripts detect "am I main?" by matching a hardcoded path string, so moving one of them silently turns its gate into a no-op. 14 package builds and 13 vite/vitest configs reach into main/tools by relative path, even though main/tools is not a workspace package. The tooling also has accumulated drift: about 25 root scripts with zero consumers, orphaned scripts, ESLint rules aimed at a directory that no longer exists, dead turbo tasks, Node versions split across 20/22/24, workflow counts documented as 13/15 when there are 19, and a starter:verify that names a test deleted in July. Delivery is spread across six hosting paths (Terraform VM + prod compose, demo droplet, Cloudflare Workers, storefront systemd, Woodpecker on the droplet, public Core repo), with image builds duplicated in 4 workflows. For the restructure, almost all of this has to move in lockstep or be removed first. For the creator-platform fork, the editions/storefront/starter-minimalism machinery is irrelevant, and in places it actively works against needs like realtime, media, workers and billing being on by default.

#### Findings

##### TOOL-01. Root script surface: 156 scripts, about 25 with zero consumers, 127 hardcoded --filter flags, near-duplicate ci:* chains

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** wiring-sprawl
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The root package.json is the de facto CLI for the repo, but it has grown by accretion. Composite gates are long && chains with copy-pasted turbo filter lists. Several script families (graph:_, export:_, line-count, health-check, port-variant e2e) have no callers. Verbs are used interchangeably (audit/check/verify/lint), and script prefixes do not match the folder a script lives in. The local pre-push gate (ci:fast via main/tools/scripts/dev/pre-push.ts) uses an 8-package filter that excludes @bslt/core (45k LOC), server-system, comms, storage, media, realtime, workers, tests and storefront. Local fast checks therefore never type-check or test the largest backend package.

**Evidence:**

- package.json: 156 scripts by prefix: audit 27, test 15, lint 12, ci 9, starter 9, db 9, sync 6, export 6, api 5, docker 5, graph 5, editions 4, features 4, ...
- package.json references 101 distinct main/tools/*.ts entry points (120 non-test TS files exist in main/tools)
- Zero references anywhere (package.json, workflows, hooks, tools, docs, README): test:e2e:8081/8082/8083, ci:fast:local, ci:local, api:check:fix, assets:web-icons, audit:local-env-secrets, health-check, db:audit:db, docker:dev:postgres, lint:boundaries:error, audit:shared-boundaries, audit:shared-export-usage, graph:shared, graph:server, graph:server-system, graph:server-system:full, graph:db, check:shared-exports, line-count, export:errors, export:error (an alias of export:errors), export:logger, export:server-main
- package.json:44-48: ci:fast, ci:merge-gate, ci:fast:local and ci:merge-gate:local differ only in --output-logs and in which filter list they use; 127 '--filter=@bslt/*' flags are repeated across lint:fast, lint:merge-gate, ci:fast(x2), ci:merge-gate(x2), ci:fast:local(x2), ci:merge-gate:local(x2)
- The 17-package merge-gate filter list equals the entire workspace (17 package.json files under main/apps, main/server, main/client, main/shared, tests), so it is equivalent to no filter; main/tools/scripts/audit/gate-coverage.ts check #2 exists only to guard this redundant list
- package.json:114 ci:verify contains '(pnpm -w run lint:boundaries:warn || true)', a step that can never fail
- package.json:43 postbuild re-runs ensure-js-extensions over 14 hardcoded dist dirs (fix:esm-dist, package.json:106) that every package build already processed (e.g. main/server/core/package.json:100)

**Direction.** Collapse to about 35-40 scripts: dev, dev:all, build, start, clean, lint, lint:fix, format, format:check, type-check, test, test:integration, test:real-db, test:e2e, test:coverage, sync [--check], db:migrate/seed/reset/push/admin, api:generate, docs:api, setup, rename, feature:new, plus `gate <name>` and `check`. Back `gate` with a typed registry (e.g. main/tools/gates/registry.ts) where each check declares id, entry, and gate membership (merge|template|nightly|manual). `pnpm gate merge` replaces ci:merge-gate, and `pnpm gate --only csp` replaces the 27 audit:* scripts and 4 lint:css* scripts. Drop all --filter lists (turbo already runs every package), delete the zero-consumer scripts, and make pre-push call the same gate with a --changed flag so local and CI behavior match.

##### TOOL-02. Moving a tool script can silently turn its gate into a no-op (hardcoded main-module path guards)

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** tooling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** If one of these scripts moves to a new directory without its guard string being updated, `node --import tsx <new path>` imports the module, never calls main(), and exits 0. Inside a && gate chain (audit:template, ci:merge-gate, lint:css), the audit vanishes without any failure. A file-topology refactor of main/tools is exactly the change that triggers this.

**Evidence:**

- 22 files under main/tools guard execution with process.argv[1].includes('main/tools/...'), e.g. main/tools/scripts/lint/lint-css-tokens.ts:317-321, audit/starter-defaults.ts:275-276, audit/gate-coverage.ts:155-156, audit/csp-sync.ts:142-143, audit/manifest-sync.ts:87-88, audit/local-env-secrets.ts:158-159, audit/health-check.ts:294-295, audit/starter-docs.ts:235-236
- 11 more use basename substrings, e.g. main/tools/scripts/db/push.ts:48 includes('push'), db/seed.ts:157,166 includes('seed'), db/reset.ts:93-94 includes('reset'), dev/bootstrap.ts:71 includes('bootstrap.ts')
- Only 10 tool files use the robust import.meta.url === pathToFileURL(process.argv[1]).href check (main/tools/features/_.ts, main/tools/scripts/editions/_.ts)

**Direction.** Before moving anything, change all 33 substring guards to the pathToFileURL comparison already used in main/tools/features, or have the future gate registry import each audit and call an exported run() so no file needs a self-detection guard. Add a gate-coverage check that runs each registered gate with --self-test and asserts it produced output.

##### TOOL-03. Prune manifests pin 239 exact-match anchors across 133 files: any restructure must edit them in lockstep

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** coupling
- **Severity:** high
- **Intentional?** yes (deliberate/documented)

**Description.** The pruner is well built: dry-run by default, refuses to run on drift, and covered by an end-to-end proof (prune-proof.ts). But because anchors are verbatim source lines, every move, rename or reformat of a registration line in 133 files breaks the merge gate until the manifest is updated. The manifests are also the most precise record available of how scattered one feature is: a single feature registers itself in up to 17 top-level areas. That scatter is the 'not one breathing ecosystem' problem expressed as data.

**Evidence:**

- main/tools/scripts/starter/prune-manifests.ts (293), prune-manifests-features.ts (1,485), prune-manifests-packages.ts (640), prune.ts (543): 9 manifests, 239 edit entries targeting 133 distinct files, 76 deletePaths, and 4 owned migrations (0402_webhooks, 0601_activities, 0910_support_requests, 0912_events)
- Per-feature edit surface: ACTIVITIES 66 edits across 10 areas (server/core, shared, server/db, apps/web, client/api, tools/scripts, tools/setup, config, infra, tests); WEBHOOKS 60 edits across 12 areas; REALTIME 28 edits across 17 areas, including eslint.config.ts, root tsconfig.json and package.json
- Most-anchored files: main/tools/scripts/recipes/registry.ts (7), main/shared/src/contracts/index.ts (7), main/shared/src/api/router.ts (6), main/server/core/src/route-modules.ts (6), main/client/api/src/index.ts (6), main/apps/web/src/app/routes.tsx (6), main/server/db/src/{factory,index,schema/index,repositories/index}.ts (4 each)
- main/tools/scripts/starter/prune.test.ts:233-245 'real manifests — anchors hold against the actual tree' runs inside test:tools, which is part of ci:merge-gate
- prune.ts:19-20 and :135-136: billing, tenants, advanced-auth and notifications are documented as not prunable (entangled)

**Direction.** Use the manifests as the input map for consolidation: each feature's registration lines show which registries should merge into a single per-module manifest. During the restructure, either (a) delete starter:prune and its manifests up front (the creator fork does not need clone-time pruning), or (b) replace anchor editing with module self-registration (one module index exporting server routes, contracts, repos, web routes and nav), so pruning becomes 'delete the module directory and its entry in one registry'.

##### TOOL-04. Ten overlapping 'feature' vocabularies and registries across the productization machinery (about 19k non-test LOC)

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** fragmentation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** The same feature is named differently in each layer: activities vs activity-feed, media vs media-processing, admin vs advanced-admin, organization/teams vs tenants. Each layer has its own registry and its own audit. The definitions of 'minimal' also contradict each other. starterSurface.ts makes dashboard, tasks and files default product routes, but editions/catalog.ts treats dashboard, tasks and files as PAID and removes them from Core. CAPABILITY_GROUPS.optional (main/profiles/capability-groups.ts) contains comms while the registry marks comms tier 'minimal'. The storage capability is enabledByDefault:false and absent from the starter profile, yet @bslt/storage is always compiled into apps/server (docs/architecture/server-dependency-dag.md). The layer separation (edition / version / profile / env flag) is documented clearly in docs/architecture/core-and-extensions.md, but nothing ties those layers to a single module identity.

**Evidence:**

- Runtime capabilities: main/profiles/capability-registry.ts (8 ids: core, system, db, comms, media, realtime, storage, workers), generated three times (main/profiles/generated/enabled-capabilities.generated.ts, main/apps/server/src/bootstrap/generated/profile.generated.ts, main/apps/web/src/bootstrap/generated/profile.generated.ts)
- Recipes: main/tools/scripts/recipes/registry.ts (716 LOC; 11 ids: activity-feed, advanced-admin, advanced-auth, billing, feature-flags, media-processing, push-notifications, realtime, s3-storage, webhooks, workers)
- Setup manifest: main/tools/setup/manifest.ts FEATURE_BRIDGES layers capabilities, webFolders and integrations over recipes (header :5-8 says 'historically fragmented')
- Prune units: PRUNE_MANIFESTS (analytics, status, search, activities, webhooks, support, workers, realtime, media) plus the FEATURE_TO_PRUNE_ID bridge (prune-manifests.ts:268-280)
- Editions: main/editions/catalog.ts CORE_/PAID_ server modules, web features and API modules (activities, admin, analytics, billing, feature-flags, files, search, status, support, tasks, tenants, webhooks, teams, organization, ...)
- Feature packs: main/extensions/{billing,account-insights}/feature.json plus main/tools/features (2,049 LOC)
- Build-time flags: 9 VITE_ENABLE_* flags (VITE_ENABLE_ACTIVITY_FEED 38 refs, VITE_ENABLE_BILLING 27, VITE_ENABLE_ADVANCED_ADMIN 25, ...)
- UI surfaces: main/apps/web/src/app/starterSurface.ts and main/apps/web/src/features/admin/adminSurface.ts (tier: 'core'|'optional', starter: boolean)
- DB-backed runtime feature flags (server/core feature-flags module) and the server AUTH_STRATEGIES env
- LOC: starter 6,145, recipes 1,193, setup 1,519, profiles 289+340, editions 956+818, features 2,049, extensions 1,761, storefront 1,867+858, infra/storefront 364, starter/profile audits 1,047

**Direction.** Introduce a single module manifest per feature (id, package/dir, server routes, contracts, repos, migrations, web routes/nav, env schema, capability deps, distribution tier). Derive profiles, recipes, wizard options, prune plans and edition membership from it, or delete the consumers the fork does not need. For the creator fork: drop editions, feature packs, storefront, recipes and prune, and keep one module registry plus one runtime flag system (DB feature flags plus a typed env).

##### TOOL-05. Package builds and test configs depend on main/tools by relative path; main/tools is not a workspace package

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** layering-violation
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** A build-time alias helper lives in the 'audit' folder, and every package reaches up two directories into an unpackaged tools tree. That is a hidden dependency edge turbo cannot see. It causes possible stale cache hits, breaks any move of main/tools, and makes main/tools half-tooling and half-build-infrastructure.

**Evidence:**

- pnpm-workspace.yaml lists 'main/tools', but main/tools has no package.json (git ls-files main/tools: 170 files, none of them package.json)
- 14 package build scripts run 'node --import tsx ../../tools/scripts/build/ensure-js-extensions.ts dist' (e.g. main/server/core/package.json:100, main/client/ui/package.json:42, main/shared/package.json:205 uses ../tools/...)
- 13 configs import '../../tools/scripts/audit/shared-vitest-aliases', including the production build config main/apps/web/vite.config.ts:6 and main/apps/server/vitest.config.ts:5, main/server/{core,db,comms,media,realtime,workers}/vitest.config.ts, main/client/{api,engine,react}/vitest.config.ts
- main/shared/package.json:209 verify-exports runs ../tools/scripts/refactor/shared/verify-shared-exports.ts, which writes to docs/archive/refactor/baseline/
- turbo.json:76-82 globalDependencies include ensure-js-extensions.ts but not shared-vitest-aliases.ts; package test inputs are package-local ('**/*.{ts,tsx}'), so editing the alias helper does not invalidate cached web/server builds or tests
- main/tools/scripts/editions/export.ts:54-62 must ship shared-vitest-aliases.ts and ensure-js-extensions.ts into every edition as 'support files'

**Direction.** Create a small workspace package (e.g. main/config or @bslt/build-config) that holds the vite/vitest alias factory and the ESM extension fixer, imported by package name and declared as a devDependency so turbo tracks it. Make main/tools a real workspace package (@bslt/tools with a 'bslt' bin) with its own lint/type-check/test tasks, which also removes the special root type-check:tools and test:tools scripts.

##### TOOL-06. Delivery sprawl: 19 workflows, 6 hosting paths, a Woodpecker mirror, image builds duplicated in 4 places

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** CI/CD grew by feature: each new distribution or hosting experiment added a workflow, and nothing was consolidated. The result is several ways to build the same images, several deploy targets for one commit, a second CI system that has to be hand-mirrored, and documentation that cannot keep the workflow count straight.

**Evidence:**

- .github/workflows: 19 files, 3,257 lines. docs/DIRECTION.md:222 and docs/CLAUDE.md say 13 workflows; infra/ci/woodpecker/README.md says 15
- Hosting paths: (1) Terraform VM + infra/docker/production/docker-compose.prod.yml via application-deploy.yml (workflow_run after CI on main) + deployment-rollback.yml + staging-deploy.yml; (2) demo droplet via demo-deploy.yml + infra/docker/demo/* (local-deploy.sh 235 lines); (3) Cloudflare Workers via web-deploy-cloudflare.yml (workflow_run after CI on main); (4) storefront systemd on the demo droplet via storefront-deploy.yml + infra/storefront/* (deploy.sh:16 requires /opt/bslt/demo/Caddyfile and an external bslt-marketing build); (5) Woodpecker server on the droplet plus a WSL agent (infra/ci/woodpecker); (6) public Core repo via publish-core.yml
- A push to main can trigger application-deploy, demo-deploy and web-deploy-cloudflare together
- docker/build-push-action for both images appears in continuous-integration.yml (docker-build-publish), demo-deploy.yml, pr-preview.yml and staging-deploy.yml
- CI setup is duplicated: continuous-integration.yml inlines pnpm/setup-node/install 5 times even though .github/actions/setup-node-pnpm exists (12 uses vs 8 inline setups repo-wide)
- .woodpecker/quality.yaml re-implements the merge gate as 12 steps and says GitHub 'remain the authoritative merge checks'; .woodpecker/quick.yaml adds a per-push lint lane
- Rust paths-ignore list (8 entries) duplicated in continuous-integration.yml:6-15 and demo-deploy.yml:6-14
- pr-preview.yml cleanup job (lines 119-134) is a no-op that reports 'Preview environment removed'
- auto-merge-claude-sessions.yml runs every 30 minutes and merges into 'dev', but the remote has no dev branch (git branch -r: main plus dependabot branches only); CI and Woodpecker also trigger on dev
- dependency-audit.yml (pnpm audit --prod daily) overlaps the dependency-scan job in security-scanning.yml (pnpm audit + OSV)
- 6 action refs are tag-pinned (demo-deploy.yml:33,35,38,45,57; web-deploy-cloudflare.yml:82); the other 107 are SHA-pinned

**Direction.** Keep one CI workflow that calls reusable workflows (setup, build-images, deploy), driven by the gate runner, and one deploy path (Terraform VM + prod compose, with staging as an environment). Pick either Cloudflare static hosting or the nginx web image, not both. Treat the demo as a deploy environment rather than a separate compose stack. Remove auto-merge-claude-sessions, pr-preview (until a real preview exists), rust-backend (or move the Rust slice out) and dependency-audit (merge it into security-scanning). Either retire Woodpecker or make it the only runner. In the creator fork, drop editions.yml, publish-core.yml and storefront-deploy.yml.

##### TOOL-07. Node and Postgres version drift across CI, containers and engines

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** config
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The repo has no single runtime pin. Production, CI, the self-hosted CI mirror and the distribution checks each run different Node and Postgres majors, so 'green CI' does not describe the production runtime. Storefront tests would likely fail under Woodpecker's Node 20.

**Evidence:**

- GitHub CI and .github/actions/setup-node-pnpm/action.yml:8 default to Node 24 (commit ff07d363 'standardize Node 24 across workflows')
- .github/workflows/security-scanning.yml:19 NODE_VERSION '20'; .woodpecker/quality.yaml:39 and quick.yaml:27 'node:20'; infra/docker/Dockerfile.web:2 NODE_VERSION=20; infra/docker/development/docker-compose.yml:59 node:20-alpine
- infra/docker/Dockerfile:2 NODE_VERSION=22, so the production API runtime differs from CI's 24
- Root package.json engines '>=18.19 <25'; main/apps/storefront/package.json engines '>=24 <25'; storefront store.ts:3 imports node:sqlite (added in Node 22.5), yet Woodpecker on node:20 runs pnpm test and lint:merge-gate, which include @bslt/storefront
- No .nvmrc or .node-version at the root
- Postgres: 16-alpine in CI, Woodpecker, compose and Terraform (digitalocean/main.tf:114, gcp/main.tf:185); postgres:17 in editions.yml:28, publish-core.yml:35, storefront-deploy.yml:43, rust-backend.yml:33

**Direction.** Add a single .node-version (24) and have engines, the setup action, the Dockerfiles (ARG default) and Woodpecker read it. Pin one Postgres major in one place (e.g. infra/versions.env) and reference it from every compose file and workflow service. Add a gate check that greps for divergent pins.

##### TOOL-08. ESLint and turbo config carry dead or stale targets; editor config is in a location editors never search

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** config
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Several guardrails look active but match nothing. The shared-config env-loading ban is the important one: it is documented as a principle but enforced against a path that does not exist. There is no current violation (grep found no process.env or dotenv in main/shared/src/modules/system/config), so the gap is latent.

**Evidence:**

- eslint.config.ts:235 boundary element 'shared-config' → main/shared/src/config (does not exist; shared config lives at main/shared/src/modules/system/config)
- eslint.config.ts:768 ignores 'main/shared/src/config/index.ts' (nonexistent)
- eslint.config.ts:876-893 rule 5f (no dotenv / no process.env in shared config) targets 'main/shared/src/config/**', so the runtime-agnostic config guard matches no files
- eslint.config.ts:177 ignores '**/drizzle.config.ts' (no Drizzle in the repo); the file is 1,082 lines with ~30 blocks and 99 hardcoded path globs
- turbo.json:7-11 'build:theme' task with outputs main/client/ui/src/generated/** — no package defines build:theme, and sync-css-theme.ts:18 actually writes main/client/ui/src/styles/theme.css; turbo.json:13 build dependsOn build:theme therefore does nothing
- turbo.json 'lint:css' and 'validate' (:61) tasks are defined by no package
- turbo.json:5,14,16 VERCEL_ENV, .next/**, NEXT_PUBLIC_* are leftovers from a Next.js/Vercel setup
- turbo.json:79-80 globalDependencies '.editorconfig' and '.pnpmrc' do not exist at the root; the EditorConfig file is config/.editorconfig, which editors never find because config/ is not an ancestor of source files
- main/tools/sync/sync-css-theme.ts:19 caches to main/node_modules/.cache (a stray main/node_modules dir exists)

**Direction.** Point the shared-config rules at main/shared/src/modules/system/config, or delete them. Add a gate check that every ESLint 'files'/'pattern' glob and every turbo input/output glob matches at least one path. Remove the Next/Vercel/drizzle leftovers and the dead turbo tasks. Move .editorconfig to the root.

##### TOOL-09. About 24k LOC of tooling and 2.8k LOC of .template TypeScript have no CI lint coverage

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** test-topology
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The tooling that enforces strict rules on application code is itself checked less strictly. Templates are a blind spot: they are real TypeScript compiled into the shipped Core distribution, but they get type-checked only in a separate export job, and lint/format never run on them.

**Evidence:**

- main/tools has no package.json, so 'turbo run lint' (lint, lint:merge-gate) never reaches it; eslint.config.ts:1041-1070 defines a tools block that only lint-staged (pre-commit) and starter:tools:lint (package.json:89, a hand-picked file list) exercise, and starter:tools:lint is not in ci:merge-gate
- type-check:tools and test:tools (package.json) were bolted on to close part of this gap (see gate-coverage.ts:7-9: 'main/tools was invisible to turbo')
- main/editions/**/\*.template and main/extensions/**/*.template total 2,801 lines of TS/TSX that dev-repo eslint, tsc, prettier and sync:headers never see; they compile only inside exported editions on the heavy editions.yml PR job
- Example escape hatch that lint would flag: main/extensions/account-insights/src/server/index.ts.template uses 'user as unknown as Record<string, unknown>'

**Direction.** Once main/tools is a package it gets turbo lint/type-check/test for free. For templates, either store them as real .ts under a tsconfig/eslint project with path mappings that simulate the export layout, or (in the creator fork) delete the editions/extensions machinery entirely.

##### TOOL-10. Dead or vestigial tool code and stale references

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** dead-code
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The tools tree has never been pruned the way the app tree has. Some leftovers are harmless clutter. Others are actively misleading: a gate that quietly lost a test, generated output nobody reads, and READMEs describing directories that are not there.

**Evidence:**

- Orphan scripts with no script/import/CI reference: main/tools/scripts/audit/bundle-monitor.ts (337), audit/bundle-size.ts (123), audit/check-smtp-env.ts (21), dev/run-tests.ts (204), export/server/server-all.ts (194), server-db-clean.ts (168), server-db.ts (84), server-engine.ts (149)
- main/tools/scripts/export/errors.ts:13 and export/logger.ts glob main/shared/src/infra/... (missing); export/server/server-config.ts globs main/shared/src/config and main/apps/server/src/config (missing)
- graph:* scripts (main/tools/scripts/audit/graph-*.ts) shell out to 'npx madge', which is not a devDependency (it downloads at run time); graph-server-system-full.ts references infra/errors/ and infra/index.ts (missing)
- main/tools/scripts/audit/temp-exceptions.ts has a test but no script wires it into any gate
- package.json:95 starter:verify runs src/features/dashboard/components/GettingStartedChecklist.test.tsx, which was deleted in commit 7ca08080 (2026-07-06); vitest skips non-matching filters, so the gate silently shrank
- main/tools/scripts/audit/api-client-surfaces.ts references main/apps/web/src/features/shared/hooks/useUndoRedoIntegration.ts (removed with the sync engine)
- main/tools/scripts/audit/route-manifest.ts header says 'pnpm route:manifest', a script that does not exist; main/tools/scripts/dev/bootstrap.ts header says 'pnpm bootstrap', but that maps to dev/setup.ts (db:bootstrap is a 79-line wrapper that only runs pnpm db:seed)
- main/profiles/generated/enabled-capabilities.generated.ts is generated by profiles/render.ts:107,133 but has zero importers
- api:check (client freshness) is not wired into any gate (docs/HANDOFF-2026-06-19.md:38-42 notes it was unreliable)
- .playwright-mcp/page-2026-05-18*.yml agent snapshots are committed
- main/tools/README.md lists a planned 'release/' and omits features/ and setup/; infra/README.md lists caddy/ and nginx/ directories that do not exist and omits cloud/, ci/, runtime/, storefront/, git-hooks/

**Direction.** Delete the orphans and the export:* and graph:* families (or move them to a scratch 'contrib' folder outside the gate). Fix the starter:verify list, or replace hardcoded test paths with a vitest tag/project. Stop generating main/profiles/generated. Rewrite main/tools/README.md and infra/README.md from the actual tree (or generate them).

##### TOOL-11. Terraform maintains DO/GCP parity behind a root wrapper that cannot be applied

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** duplication
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** Two clouds are kept at parity, the root wrapper is dead, and the real deployment target is a single DigitalOcean droplet that also hosts the demo, the storefront and the CI server.

**Evidence:**

- infra/cloud/main.tf:62-103 has both 'module digitalocean' and 'module gcp' commented out, while infra/cloud/outputs.tf:6,11,21 references module.digitalocean/module.gcp, so the root config is not valid as written
- Workflows bypass the root: infrastructure-deploy.yml:74 'cd infra/cloud/$PROVIDER'; infrastructure-test.yml:80,105 per-provider
- GCP module: gcp/main.tf 235 + outputs 78 + variables 96 + startup-script.sh 99 (~508 LOC) for VM + VPC + Cloud SQL + DNS, reachable only through workflow_dispatch provider choice
- Everything that actually runs uses DigitalOcean: application-deploy.yml default provider digitalocean, staging-deploy.yml hardcodes provider: digitalocean, the demo droplet (infra/cloud/digitalocean/bootstrap-once.sh), the storefront and Woodpecker on the same droplet
- docs/DIRECTION.md:30 lists cross-cloud abstraction as a non-goal

**Direction.** Keep one provider module (DO) as the reference, delete the root wrapper (or make it a working module selector), and move GCP to an optional recipe/doc or delete it in the creator fork. Split 'demo droplet that also runs storefront + CI server' from production infrastructure.

##### TOOL-12. Docker and proxy config duplication

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** duplication
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Each deployment flavor carries its own near-copy of the proxy and web-server config. The full-stack dev compose appears to be dead apart from the renamer's file list.

**Evidence:**

- 4 compose files: infra/docker/development/docker-compose.yml (85 lines; postgres+api+web, container 'abe-postgres', referenced only by starter/rename.ts:75), development/docker-compose.dev.yml (68; postgres only; used by dev/postgres.ts:31 and dev/setup.ts:117), production/docker-compose.prod.yml (291; caddy, postgres, pgbouncer, redis, api, web), demo/docker-compose.demo.yml (90)
- infra/docker/nginx.conf and infra/docker/demo/nginx.conf differ by one line ('listen [::]:80')
- 4 Caddyfiles: infra/runtime/caddy/Caddyfile, Caddyfile.dev, infra/docker/demo/Caddyfile (185), infra/storefront/Caddyfile (merged into the demo Caddy by activate.sh:88)
- 3 backup mechanisms: .github/workflows/database-backup.yml, main/tools/scripts/deploy/backup-database.sh (host cron, doc-referenced), infra/storefront/backup.mjs + systemd timer

**Direction.** Use one compose base with profiles or override files (dev/prod/demo), one nginx.conf with IPv6 enabled, and one Caddyfile template. Remove the dev full-stack compose or make it the only dev compose.

##### TOOL-13. Editions maintain hand-written parallel composition roots (17 Core templates)

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** coupling
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** Core is produced by swapping app composition files for slimmer hand-written copies. Every change to routing, bootstrap phases or the layout shell that Core needs must be made twice. Every directory rename in server/core, apps/web/features or client/api must also be mirrored in the catalog. This is deliberate and well documented (docs/architecture/core-and-extensions.md), but it is a large tax on topology changes.

**Evidence:**

- main/editions/catalog.ts:79-97 CORE_COMPOSITION_PATHS: 17 output paths replaced at export by main/editions/core/**/*.template
- Template vs dev size: routes.tsx 110 vs 636, apps/server/src/http/route-modules.ts 25 vs 217, bootstrap/phases/comms.ts 71 vs 215, bootstrap/phases/workers.ts 23 vs 178, AppLayout.tsx 59 vs 145, lib/sentry.ts 23 vs 388, server/core/src/route-modules.ts 22 vs 54
- main/editions/catalog.ts:99-126 isPaidSource hardcodes 7 directory roots plus module-name lists that must track server/core, apps/web/features and client/api directory names
- main/tools/scripts/editions/export.ts:38-73 hardcodes PACKAGE_ROOTS (12), PRO_PACKAGES, SUPPORT_FILES and FEATURE_TOOLS; export.ts:425-487 rewrites every package.json and the root scripts for the distribution
- The core/paid import boundary is enforced only by exporting and compiling in .github/workflows/editions.yml (matrix core+pro, each doing install+type-check+build+tests on every PR touching main/**); there is no lint rule for it in the dev tree
- main/extensions/billing/feature.json:21-30 maps 8 pack files onto main/server/core/src/billing/* paths

**Direction.** For the creator-platform fork: delete main/editions, main/extensions, main/tools/features, main/tools/scripts/editions and the related workflows outright. For bslt-main as a foundation: replace the template override with composition driven by the same module manifest proposed above (an edition is just a module allow-list), so no composition file is written twice.

##### TOOL-14. The clean extension contract exists only in exported Core, not in the dev tree

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** fragmentation
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The best-designed module boundary in the repo, a feature exporting routes, webhooks and a page and inheriting auth/RLS guards, exists only in the distributed artifact. The dev repo, where every feature actually lives, has nothing equivalent.

**Evidence:**

- main/editions/core/main/apps/server/src/extensions/types.ts.template: InstalledServerFeature { id, routes, webhooks? } with FeatureWebhook (raw-body signature verification)
- main/editions/core/main/apps/server/src/extensions/index.ts.template: forces authenticated, relative routes under /api/extensions/<id> and registers signed webhooks with a body limit
- main/editions/core/main/apps/web/src/extensions/types.ts.template: InstalledWebFeature { id, name, Page }
- The dev tree has no main/apps/{server,web}/src/extensions (paths flagged missing in main/editions/catalog.ts and main/tools/features/manifest.ts); dev features register through route-modules.ts, routes.tsx, starterSurface.ts, adminSurface.ts, shared router and contracts barrels, client/api index and db factory instead

**Direction.** Promote an expanded version of this contract (server routes + contracts + repos + migrations + jobs + web routes/nav) into the dev tree as the single way a feature plugs in, and migrate existing features onto it. This is the main lever for turning scattered features into one composed system.

##### TOOL-15. Storefront is a parallel mini-SaaS that reuses nothing from BSLT

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** duplication
- **Severity:** medium
- **Intentional?** yes (deliberate/documented)

**Description.** The storefront sells BSLT's own source packs. To do that it re-implements accounts, magic tokens, orders, Stripe webhooks with idempotency, rate limits and email outside the platform's own auth/billing/db packages. It is deliberately standalone (private delivery, docs/deploy/storefront.md), but it means the repo holds two billing stacks and two auth stacks.

**Evidence:**

- main/apps/storefront/package.json: dependencies only fastify, nodemailer, stripe; no @bslt/* imports in main/apps/storefront/src/*.ts
- main/apps/storefront/src/store.ts:3 uses node:sqlite; :57-67 creates its own accounts, demo_accounts, stripe_customers, tokens, orders, revoked_payments, revoked_subscriptions, events, limits and release_publications tables
- main/apps/storefront/src/commerce.ts (388) has its own Stripe checkout/webhooks, separate from main/server/core/src/billing
- Deploy coupled to the demo droplet and an external repo: infra/storefront/deploy.sh:6,16 (STOREFRONT_MARKETING_DIST, /opt/bslt/demo/Caddyfile); storefront-deploy.yml checks out a marketing repo using MARKETING_READ_SSH_KEY
- main/editions/catalog.ts:104 marks main/apps/storefront as paid source

**Direction.** Remove it from the creator-platform fork. In bslt-main, either move it to its own repository or rebuild it on @bslt/core billing and auth as a dogfooding app. Its entitlement and digital-delivery model (perpetual grants, signed downloads, revocation tables) is a useful reference for pay-per-view entitlements.

##### TOOL-16. Path-alias and module-resolution config is defined in 5+ independent places

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** wiring-sprawl
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Every file move inside shared, server or client needs coordinated edits to tsconfig paths, export maps, vitest aliases and lint resolver settings. sync:ts automates only project references, not paths.

**Evidence:**

- 41 tsconfig files; 27 define 'paths', totalling ~410 alias entries (tsconfig.json 53, tests/tsconfig.json 40, main/server/realtime/tsconfig.json 31, main/tools/tsconfig.json 18, main/apps/server/tsconfig.json 18, main/apps/web/tsconfig{,.lint}.json 17 each, ...)
- 106 package.json export-map entries (@bslt/shared 34, @bslt/core 17, @bslt/server-system 12, @bslt/db 10, ...)
- main/tools/scripts/audit/shared-vitest-aliases.ts (vite/vitest alias factory), main/tools/vitest.config.ts:29-38 (its own regex aliases plus a comment explaining why subpaths cannot be resolved), vitest.config.ts:3 vite-tsconfig-paths, eslint.config.ts:23-36 resolverProjects
- Duplicate or legacy aliases in the root tsconfig.json: '@bslt/shared/realtime' and '@bslt/shared/modules/realtime', '@hooks' → client/react hooks; eslint.config.ts bans legacy @bslt/engine/* and @bslt/websocket

**Direction.** Make package.json exports (with a 'source' condition) the only alias source. Drop tsconfig 'paths' in favor of customConditions ['source'] (export.ts:493 already does this for editions) and derive vitest aliases from the export maps. Generate any remaining aliases with sync:ts.

##### TOOL-17. Other move-sensitive hardcoded path lists

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** coupling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Beyond prune anchors, the gate stack contains many more lists keyed by repo path. Some fail loudly on a move (headers, test-pairs debt, starter-docs). Others silently weaken (vitest filter lists, documentation code spans).

**Evidence:**

- Path headers: 2,368 of 2,374 tracked TS/JS files under main/ start with '// <repo path>'; sync:headers:check is the first step of ci:merge-gate (auto-fixable with pnpm sync:headers)
- main/tools/scripts/audit/test-pairs-debt.json: ~338 file paths; colocated-test-pairs.ts:196-197 treats a moved debt file as a regression until --update is run
- tests/package.json test:real-db lists real-DB files explicitly (guarded by gate-coverage check #1)
- main/tools/scripts/starter/rename.ts:46-80: ~30 env/doc/infra files; main/tools/scripts/audit/starter-docs.ts:36-147: 13 doc files must contain or ban phrases (e.g. README must say 'clone-and-own SaaS starter'); starter-defaults.ts pins 4 env example files
- main/tools/scripts/audit/vite-build-args.ts:33,36 anchors infra/docker/Dockerfile.web and .github/workflows/continuous-integration.yml; csp-sync.ts:17 anchors infra/runtime/caddy/Caddyfile; security-scanning.yml:161-168 requires 5 specific package.json paths; infra/setup-github.sh checks infra/README.md as its repo-root sentinel
- About 35 tool files compute the repo root from depth ('../../../..'), and 33 rely on process.cwd()
- 354 backticked main/... paths in docs (excluding docs/log) are not validated by audit:docs-links, which only checks markdown links (9 links into main/)

**Direction.** Sequence the restructure as: (1) convert the main-module guards, (2) move files, (3) run sync:headers / sync:ts / lint:test-pairs --update, (4) regenerate path lists from a single repo-paths constants module (main/tools/lib/paths.ts) that every tool imports instead of hardcoding strings. Delete the starter-docs, starter-defaults and rename lists in the fork.

##### TOOL-18. Naming collisions: 'core', 'bootstrap', 'starter', and audit/check/verify/lint

- **Area:** Tooling, distribution & delivery: main/tools (scripts, features, setup, sync), main/profiles, main/editions, main/extensions, main/apps/storefront, infra/, .github/workflows, .woodpecker, root package.json, eslint.config.ts, turbo.json, tsconfig/config files
- **Category:** naming-inconsistency
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** These overloaded terms make it harder to tell what a script or module is for, and they will be confusing in a fork that adds its own 'creator' and 'core' concepts.

**Evidence:**

- 'core' means: the @bslt/core package (main/server/core), the 'core' capability id (capability-registry.ts), the 'core' profile (profiles.core.ts, an alias of starter), the 'core' edition (editions/catalog.ts), adminSurface tier 'core' (adminSurface.ts:28), and shared/src/modules/core
- 'bootstrap' means: pnpm bootstrap (dev/setup.ts env wizard, 1,488 LOC), pnpm db:bootstrap (dev/bootstrap.ts → db:seed), pnpm db:bootstrap:admin (db/bootstrap-admin.ts), and main/apps/server/src/bootstrap (composition root)
- Folder vs. script prefix: lint:test-pairs → audit/colocated-test-pairs.ts; graph:*, line-count, health-check, shared-vitest-aliases, route-manifest (a codegen input) all live in audit/; API codegen is split across scripts/api, scripts/build/generate-api-client.ts and scripts/audit/route-manifest.ts
- Verbs: profiles:check, recipes:check, api:check, check:shared-exports, starter:verify, editions:verify, features:verify, audit:_, lint:_ are used interchangeably for 'fail on drift'

**Direction.** Reserve 'core' for the domain package only (rename the profile and edition, e.g. 'minimal' and 'community'). Rename dev/setup.ts to init/env, delete db:bootstrap, and group tools by verb: tools/gates (all fail-on-drift checks), tools/codegen, tools/db, tools/dev, tools/scaffold.

#### TOOL strengths (preserve)

- Drift-detection culture is real and mostly well executed. gate-coverage.ts guards hand-maintained lists. vite-build-args.ts checks the Dockerfile ARG to workflow build-arg chain, a silent failure mode that is easy to miss. csp-sync, env-examples, manifest-sync, generated-artifacts, package-exports and esm-dist each cover a concrete past failure.
- The prune engine (main/tools/scripts/starter/prune.ts) is a solid design pattern: dry run by default, exact-match anchors that throw on drift or ambiguity, planning that never writes, an end-to-end proof in a scratch copy (prune-proof.ts), and a test that validates the real manifests against the tree in the merge gate. The manifests are also an exact map of every feature's registration surface, which is valuable input for the restructure.
- Tools are tested: about 8k LOC of tests under main/tools and main/profiles run in test:tools in the merge gate. The wizard plan is a pure, unit-tested function, and commands run as argv arrays with no shell (setup/wizard.ts header).
- Clear conceptual documentation of edition vs version vs runtime profile vs env flag (docs/architecture/core-and-extensions.md); publish-core never force-pushes, checks inventory drift, and isolates the deploy-key credential in a separate job.
- The Core extension contract (InstalledServerFeature/InstalledWebFeature with authenticated-only routes under /api/extensions/<id> and raw-body signed webhooks) is a good module boundary to promote into the dev tree.
- CI hygiene: 107 of 113 action refs are SHA-pinned, concurrency groups are set, a real Postgres merge gate (real-db-gate) runs on every PR, coverage is a non-blocking report on purpose (vitest.config.ts comments), and OOM mitigations are documented in place.
- Starter tooling that is directly reusable for a fork: starter:rename and starter:rename-scope (a full @bslt to @acme scope migration), and the starter:feature scaffolder (shows every layer a feature must touch).
- sync:headers and sync:ts make path headers and project references self-healing; turbo caching with stated inputs; the colocated test-pair debt ratchet (fails on regressions, reports fixes).
- The Woodpecker config is explicit that it is additive and not authoritative, and documents its routing (heavy/light agents) clearly.

#### TOOL inventory

| Path                                                          | Purpose                                                                                                                                                                                                | Size                                                                                      | Notes                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| package.json                                                  | Root CLI surface (scripts), lint-staged, pnpm overrides                                                                                                                                                | 156 scripts; 101 distinct main/tools entry points; 127 --filter flags; 24 devDependencies | About 25 scripts have zero consumers; ci:* chains are near-duplicates; engines >=18.19 <25                                    |
| turbo.json                                                    | Task graph and cache config                                                                                                                                                                            | 83 lines                                                                                  | Dead tasks build:theme, lint:css, validate; Next/Vercel leftovers; globalDependencies reference missing .editorconfig/.pnpmrc |
| eslint.config.ts                                              | Flat ESLint config incl. boundaries DAG mirror, import governance, UI raw-element bans, tools block                                                                                                    | 1,082 lines, ~30 blocks, 99 hardcoded path globs                                          | Stale main/shared/src/config targets (lines 235, 768, 877); BSLT_BOUNDARY_LEVEL switch                                        |
| tsconfig.json + config/tsconfig.{base,node,react,eslint}.json | Root path aliases and project references (refs maintained by sync:ts); shared compiler base                                                                                                            | 41 tsconfig files repo-wide; 27 define paths (~410 alias entries)                         | Duplicate aliases (@bslt/shared/realtime vs modules/realtime, @hooks)                                                         |
| pnpm-workspace.yaml                                           | Workspace globs                                                                                                                                                                                        | 6 globs                                                                                   | Includes main/tools, which has no package.json                                                                                |
| vitest.config.ts                                              | Shared vitest base merged by packages                                                                                                                                                                  | ~45 lines                                                                                 | Excludes .claude worktrees; coverage is report-only by design                                                                 |
| main/tools/scripts/audit                                      | ~30 drift audits plus graph, line-count, export and alias helpers                                                                                                                                      | 52 files, 7,958 non-test LOC, 1,174 test LOC                                              | Mixes gates with non-gates (shared-vitest-aliases build helper, route-manifest codegen input, graph/madge, bundle-* orphans)  |
| main/tools/scripts/starter                                    | Clone-and-own tooling: prune engine and manifests, feature scaffolder, rename, scope-rename, smoke, prune-proof                                                                                        | 6,145 non-test LOC, 1,722 test LOC                                                        | prune-manifests-features.ts 1,485 and feature.ts 1,482 are god files; 239 anchored edits across 133 files                     |
| main/tools/scripts/dev                                        | Dev orchestrator (main.ts), env bootstrap wizard (setup.ts), pre-push, cache maintenance, workflow dump, docker postgres                                                                               | 2,792 LOC                                                                                 | setup.ts is 1,488 LOC; run-tests.ts is an orphan; bootstrap.ts only wraps db:seed                                             |
| main/tools/scripts/{api,build,docs}                           | API client and hooks codegen, API docs, web icons, ESM .js-extension fixer                                                                                                                             | 452 + 689 + 289 LOC                                                                       | ensure-js-extensions is called by 14 package builds; api:check is not gated                                                   |
| main/tools/scripts/db                                         | migrate, push, seed, reset, bootstrap-admin, backfill-totp                                                                                                                                             | 639 LOC + 1,135 test LOC                                                                  | Basename-substring main guards (includes('push'/'seed'/'reset'))                                                              |
| main/tools/scripts/editions                                   | Core/Pro source export, verify, pack, publish-core, request publication                                                                                                                                | 956 LOC + 432 test LOC                                                                    | Hardcodes package roots and rewrites package.json scripts for distributions                                                   |
| main/tools/scripts/export                                     | Dump source subsets to .tmp/*.txt (LLM context exports)                                                                                                                                                | 10 files, 1,191 LOC                                                                       | 4 orphans; globs reference removed paths                                                                                      |
| main/tools/scripts/lint                                       | CSS token, responsive, dead-class and undefined-token lints (lint:css)                                                                                                                                 | 1,188 LOC + 809 test LOC                                                                  | Part of the merge gate                                                                                                        |
| main/tools/scripts/{profiles,recipes,refactor,deploy}         | Profile apply/render; recipe registry/enable; shared export verification; host-cron DB backup                                                                                                          | 289 + 1,193 + 613 + 142 LOC                                                               | recipes/registry.ts (716) is anchored 7 times by the prune manifests                                                          |
| main/tools/features                                           | Feature-pack system: pack, verify, install, catalog, CLI, browser UI, storefront release                                                                                                               | 20 files, 2,049 LOC + 1,821 test LOC                                                      | Only shipped into exported Core (features:add etc. are injected by editions export)                                           |
| main/tools/setup                                              | Unified wizard, feature selection, integration walkthroughs, feature manifest                                                                                                                          | 1,519 LOC + 544 test LOC                                                                  | manifest.ts explicitly bridges recipe and capability registries                                                               |
| main/tools/sync                                               | File path headers, TS project references, theme.css generation                                                                                                                                         | 495 LOC                                                                                   | Headers on 2,368 of 2,374 main/ TS files                                                                                      |
| main/profiles                                                 | Runtime capability registry, profiles (starter/core/full/custom), selection                                                                                                                            | 12 files, 340 LOC                                                                         | Non-workspace dir; generates 3 copies of the manifest, one unused                                                             |
| main/editions                                                 | Edition catalog plus 17 Core composition templates and 2 shared templates                                                                                                                              | 21 files, 818 LOC (incl. templates)                                                       | Templates invisible to dev-repo lint/tsc                                                                                      |
| main/extensions                                               | Private feature packs: account-insights, billing (Stripe)                                                                                                                                              | 14 files, 1,761 LOC                                                                       | billing/feature.json maps 8 files from main/server/core/src/billing                                                           |
| main/apps/storefront                                          | Standalone commerce site selling source packs (Fastify + Stripe + nodemailer + node:sqlite)                                                                                                            | 1,867 src + 858 public LOC; ~3k test LOC                                                  | No @bslt/* deps; Node >=24                                                                                                    |
| infra/cloud                                                   | Terraform: root wrapper (modules commented out), digitalocean, gcp                                                                                                                                     | 1,302 LOC                                                                                 | Root not applyable; workflows use per-provider directories                                                                    |
| infra/docker                                                  | API and web Dockerfiles, dev/prod/demo compose, nginx, demo deploy scripts                                                                                                                             | 1,678 LOC                                                                                 | 4 compose files, 2 near-identical nginx.conf                                                                                  |
| infra/runtime                                                 | Caddy (prod/dev) and Prometheus alert/config examples                                                                                                                                                  | 5 files                                                                                   | Caddyfile anchored by csp-sync audit                                                                                          |
| infra/storefront                                              | Storefront systemd units, Caddy merge, deploy/activate, backup, release import                                                                                                                         | 364 LOC                                                                                   | Deploys onto the demo droplet                                                                                                 |
| infra/ci/woodpecker                                           | Self-hosted Woodpecker server and agent compose                                                                                                                                                        | 5 files                                                                                   | Server on the droplet, heavy agent on the WSL dev box                                                                         |
| infra/git-hooks, infra/setup-github.sh, infra/test-config.sh  | pre-commit/pre-push hooks; GitHub secrets helper; Terraform validation helper                                                                                                                          | ~290 LOC                                                                                  | hooks installed via core.hooksPath in the prepare script                                                                      |
| .github/workflows                                             | CI, deploys (prod, staging, demo, Cloudflare, storefront), infra apply/test/destroy, rollback, security, deps audit, backups, editions, publish-core, rust, PR preview, template readiness, auto-merge | 19 files, 3,257 lines                                                                     | Docs claim 13 (DIRECTION.md) or 15 (Woodpecker README)                                                                        |
| .github/actions/setup-node-pnpm                               | Composite pnpm + Node setup and install                                                                                                                                                                | 46 lines                                                                                  | Used 12 times; 8 jobs still inline the same steps                                                                             |
| .woodpecker                                                   | quality.yaml (merge-gate mirror + real-DB + main build), quick.yaml (per-push lint/type-check)                                                                                                         | 229 lines                                                                                 | node:20 vs Node 24 in GitHub CI                                                                                               |
| config/                                                       | tsconfig bases, prettier, editorconfig, env examples, playwright config                                                                                                                                | 15 tracked files                                                                          | .editorconfig is in config/, where editors do not find it                                                                     |

#### TOOL wiring points

- `package.json (scripts)`: Every tool entry point (101 main/tools files), composite gates (ci:*, audit:template, lint:css, starter:verify), turbo filter lists, the hooks install path
- `pnpm-workspace.yaml`: Workspace package globs (main/apps/_, main/server/_, main/shared, main/client/*, main/tools, tests)
- `turbo.json`: Task graph, task inputs/outputs, env hashing, globalDependencies (incl. main/tools/scripts/build/ensure-js-extensions.ts)
- `tsconfig.json (root) + sync:ts`: Project references (generated by main/tools/sync/sync-ts-references.ts, which excludes main/profiles and main/tools) and 53 root path aliases
- `eslint.config.ts`: Boundary element map (shared sub-layers, server/client packages, apps, profiles, tests, docs) and allowed edges; per-directory rule blocks
- `main/profiles/capability-registry.ts + profiles.*.ts + active-profile.json`: Capabilities and profiles; rendered by main/tools/scripts/profiles/render.ts into main/apps/server/src/bootstrap/generated/profile.generated.ts, main/apps/web/src/bootstrap/generated/profile.generated.ts, main/profiles/generated/enabled-capabilities.generated.ts
- `main/tools/scripts/recipes/registry.ts`: Opt-in recipes (env, commands, routes, verification)
- `main/tools/setup/manifest.ts`: Wizard features = recipes + capabilities + webFolders + integrations
- `main/tools/scripts/starter/prune-manifests*.ts`: PRUNE_MANIFESTS (9 features) and FEATURE_TO_PRUNE_ID; anchored edits into 133 files
- `main/editions/catalog.ts + main/editions/core/**/*.template`: Core/Pro module membership, isPaidSource roots, the 17 Core composition overrides
- `main/extensions/*/feature.json`: Feature-pack id/version/coreVersion/files/sources
- `main/tools/scripts/audit/test-pairs-debt.json`: Path-keyed colocated-test debt baseline (~338 files)
- `tests/package.json (test:real-db)`: Explicit list of real-DB integration test files (guarded by gate-coverage.ts)
- `main/tools/scripts/audit/shared-vitest-aliases.ts`: Vite/vitest alias map imported by 13 package configs including main/apps/web/vite.config.ts
- `.github/actions/setup-node-pnpm/action.yml`: Shared CI setup (Node 24 default, pnpm 10.26.2)
- `infra/git-hooks/{pre-commit,pre-push}`: Local gates: sync:headers:staged + lint-staged; hooks:cache:maintain + pre-push (ci:fast)
- `main/tools/scripts/starter/rename.ts (DEPLOY_IDENTITY_FILES)`: ~30 files whose product identity is rewritten on rename
- `main/tools/scripts/audit/starter-docs.ts / starter-defaults.ts`: Required and banned phrases in 13 docs; required starter env defaults in 4 env examples

#### TOOL creator-platform notes

- About 27k LOC (with tests) of BSLT-specific productization machinery can be dropped in the fork: main/editions, main/extensions, main/tools/features, main/tools/scripts/editions, main/apps/storefront, infra/storefront, the starter prune/recipes/starter-docs/starter-defaults audits, and the editions.yml, publish-core.yml and storefront-deploy.yml workflows. Remove them before moving files, so the prune anchors and edition catalogs do not have to be kept in sync during the restructure.
- The profile system defaults realtime, media, workers and storage to OFF, and the starter audits enforce minimal defaults (starter-defaults.ts keeps VITE_ENABLE_BILLING and friends commented). A live-first creator platform needs realtime (live/tipping), media (content), workers (payouts, moderation queues, age-verification callbacks), storage and billing ON. Replace profiles with an always-on composition plus DB feature flags, or the fork will fight its own gates.
- SFW/softcore separation, age verification and moderation must be enforced at the data and API layer (RLS, policies). Nothing in the profile/edition/VITE_ENABLE_* machinery should be reused for it: those are build-time or source-level switches, not access control.
- Reuse the Core extension contract idea as the creator platform's module API, so subscriptions, PPV, tipping, payouts and moderation each register through one manifest instead of 10-17 scattered registration points (the prune manifests show the current spread, e.g. webhooks touches 12 areas).
- The storefront's entitlement and delivery patterns (orders, revoked_payments/subscriptions tables, idempotent Stripe event log, signed downloads) are a useful reference for PPV entitlements and creator payout reconciliation, but the code should not be reused because it bypasses @bslt/core billing and auth.
- Crypto payouts will add a new provider class; follow the existing adapter-interface pattern (BillingProvider, StorageAdapter, etc. in docs/CLAUDE.md) and make sure the gate registry covers its env/secrets and CSP needs (the csp-sync and env-examples audits are worth keeping).
- Settle the deploy topology early. Live streaming needs media/realtime infrastructure (RTMP/WebRTC ingest, Redis pub/sub, workers) that the current single 1 GB DigitalOcean droplet plus demo compose cannot host. Keep the Terraform DO module as a starting point and drop GCP parity unless it is needed.
- Keep the generic gates worth carrying into any future TS platform: sync:headers/ts, gate-coverage, vite-build-args, csp-sync, env-examples, generated-artifacts, package-exports/esm-dist, route-contract-coverage/api governance, i18n, docs-links, lint:css, test-pairs ratchet, real-db gate.

#### TOOL open questions

- Is Woodpecker actually live (server on the droplet, WSL agent online)? If not, .woodpecker/ and infra/ci/woodpecker can be removed. If it is, its node:20 image probably fails storefront tests (node:sqlite).
- Is the public Core repo (abrahamahn/bslt-core) still published, and does bslt-main need to keep producing editions after the restructure? This decides whether main/editions, main/extensions, main/tools/features and the storefront stay in bslt-main or move to a separate 'distribution' repo.
- Which hosting path is canonical for the foundation: Terraform VM + prod compose, the demo droplet, or Cloudflare Workers for the SPA? Today a push to main can deploy to all three.
- Is GCP Terraform parity a requirement for future TS platforms, or can it become documentation only?
- Should the clone-and-own starter features (prune, rename, scope-rename, feature scaffolder, wizard) survive in bslt-main as foundation tooling for future platforms, or only rename/scope-rename plus the scaffolder?
- Is the Rust slice (main/apps/server-rust, web rust-access feature, rust-backend.yml) still active, or can it be moved out before the restructure?
- The auto-merge-claude-sessions workflow merges claude/** branches into a 'dev' branch that does not exist on the remote. Is that workflow still wanted?
- Is the external bslt-marketing repo (needed by infra/storefront/deploy.sh and storefront-deploy.yml) part of the planned ecosystem or legacy?

### B.TEST. Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)

**Summary.** Tests are split into three places. (1) 768 colocated test files in main/: apps/web has 206, shared 136, client/ui 84, server/core 73 and server/db 64, about 202k LOC in total. (2) A central @bslt/tests package with 95 integration files (57.5k LOC with e2e) and 41 Playwright e2e files (about 10k LOC). (3) Assorted package-local test folders (apps/web/tests, storefront/test, server-rust/tests). The central suite is not purely cross-package. 19 files (11.3k LOC) under tests/integration/{auth,ui,engine,web} test a single package. They duplicate colocated tests and inflate the shrink-only colocation debt list (338 files, 142 of them in server/core). The 38 `*.integration.test.ts` files run against a hand-built Fastify "mini app" over mock DBs, so none of them touch Postgres. The 26 `*.real-db.test.ts` files are the real database tier. They share a good isolated-database harness, but each one copies the same reachability-gate boilerplate. Fixtures and mocks are heavily duplicated: there are 30 local createMockLogger, 22 createMockRepos and 22 createMockDbClient copies. The canonical @bslt/db/testing mock has no consumers. e2e seeds Postgres with raw SQL against hard-coded table names, which directly exposes it to a DB restructure. Test tooling hardcodes paths in many places: 17 vitest configs with hand-written aliases, about 90 tsconfig paths in tests/, a 26-file real-db list, a 338-path debt list, prune manifests, editions template mirrors, and two package configs that reach into ../../../tests/utils. docs/ has 95 markdown files (19.3k lines) plus 10 package READMEs. Its core architecture docs and DIRECTION.md path claims mostly hold. Testing and workflow docs, the client/engine README, the docs/CLAUDE.md status report and the untracked .claude agent specs are materially stale. docs/ also doubles as runtime content (legal pages, the dev-tools docs browser) and as a tooling output directory.

#### Findings

##### TEST-01. Single-package tests misplaced in central tests/integration (19 files, 11.3k LOC), duplicating colocated tests and inflating colocation debt

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** test-topology
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Of tests/integration, only api/ (68 files, 35.2k LOC) and database/ (1 file) are cross-package. auth/ (3 files, 2.8k), ui/ (7, 4.5k), engine/ (1, 0.5k) and web/ (8, 3.5k) each exercise one package. They are invisible to the colocated-pair audit, so the debt list counts server/core auth handlers as untested even though handlers.test.ts covers them. The same components are tested twice in two styles.

**Evidence:**

- tests/integration/auth/handlers.test.ts (1,009 LOC) header: 'Tests the auth handler functions by mocking service layer dependencies' — a unit test of @bslt/core
- tests/integration/auth/login-edge-cases.test.ts:2 still carries legacy header '// backend/core/src/auth/**tests**/login-edge-cases.test.ts'
- main/tools/scripts/audit/test-pairs-debt.json lists 16 of 19 files in main/server/core/src/auth/handlers/ (login.ts, register.ts, refresh.ts, logout.ts, ...) as untested; only handlers/totp.test.ts is colocated
- tests/integration/ui/*.integration.test.tsx: 7 files, 4,486 LOC, import only @bslt/ui and @bslt/react
- tests/integration/web/auth-modal.test.tsx duplicates main/apps/web/src/features/auth/components/AuthModal.test.tsx; tests/integration/web/dashboard.test.tsx duplicates main/apps/web/src/features/dashboard/pages/DashboardPage.test.tsx
- tests/integration/engine/api-client-errors.integration.test.ts (501 LOC) tests only the client/api error mapping
- docs/dev/testing.md says only 'tests/integration/api/' is the integration suite

**Direction.** Move tests/integration/auth/* to main/server/core/src/auth/** and split handlers.test.ts per handler file, which retires about 16 debt entries. Move ui/* to main/client/ui/src as _.integration.test.tsx, engine/_ to main/client/api, and web/* to main/apps/web/src/**integration** after merging the duplicate utils. Reserve tests/ for cross-package HTTP, real-DB and e2e suites.

##### TEST-02. 'Integration' tier is mock-based and parallels the real-DB tier per domain; the docs define integration as 'against test database'

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** test-topology
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** There are effectively four tiers: colocated unit, mock HTTP 'integration', real-DB, and e2e. The mock HTTP tier cannot catch SQL, RLS or constraint bugs, yet the docs describe it as DB-backed. Per-domain behavior is split across up to four files in three folders, with no per-domain grouping.

**Evidence:**

- 25 of 38 tests/integration/api/*.integration.test.ts explicitly build mocks (createMockDb/createMockRepos/vi.mock); createTestServer defaults `db = createMockDb()` (tests/integration/api/test-utils.ts:651-660); no *.integration.test.ts uses createDbHarness (27 hits = 26 real-db files + db-harness.ts)
- docs/specs/principles.md:268 'Integration | Vitest + inject | Service + DB + HTTP round-trips against test database'
- Auth is covered four ways: auth.integration.test.ts 2,597 + auth.real-db.test.ts 457 + tests/integration/auth/* 2,801 + 20 colocated server/core/src/auth/**/*.test.ts
- Billing: billing.integration 1,440 + billing.real-db 237 + billing-webhooks.integration 301 + billing-webhook.real-db 211 + golden-path-billing-checkout.integration 570 + 10 colocated billing tests
- tests/package.json 'test:integration' excludes '**/*.real-db.test.ts'; real-db runs in a separate CI job (continuous-integration.yml real-db-gate)

**Direction.** Name the tiers explicitly. Rename mock HTTP suites to *.http.test.ts (contract/route tests) and keep *.real-db.test.ts for persistence. Group them per domain, e.g. tests/integration/api/<domain>/{http,real-db}.test.ts, and retire overlapping assertions. Update principles.md and testing.md to match.

##### TEST-03. createTestServer re-implements the composition root and a full AppConfig by hand

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** coupling
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Every HTTP-level suite runs on a parallel mini-app whose hook order, config defaults and middleware set can drift from production bootstrap. A restructure of apps/server bootstrap will not break these tests even when it changes runtime behavior, and vice versa.

**Evidence:**

- tests/integration/api/test-utils.ts:307-570 createTest() builds an entire AppConfig literal (~260 lines)
- tests/integration/api/test-utils.ts:651-800 registers prototype-pollution, correlation-id, request-info, security headers, CORS and rate-limit hooks manually instead of using main/apps/server/src/bootstrap
- docs/CLAUDE.md 'Remaining' lists 'booting the cross-domain smoke through the real composition root' as test debt
- The real-db suites also build their own servers: auth.real-db.test.ts imports registerRouteMap and createAuthGuard and wires routes itself

**Direction.** Export a pure buildApp({config, deps, profile}) factory from apps/server/bootstrap that both main.ts and tests use. Derive test config from the shared config factory plus overrides rather than a hand-written literal.

##### TEST-04. Tests encode the DB schema in raw SQL through three independent seeding paths; schema setup differs per CI lane

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** db-schema
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** A database restructure such as table renames, tenant/content-rating columns or new RLS policies will break e2e at runtime rather than at compile time, and there are three places to fix. db:push and migrations are two schema sources, so e2e may run against a schema that differs from production.

**Evidence:**

- tests/e2e/fixtures/auth.ts:116-300 uses postgres() + argon2 directly to INSERT INTO users, login_attempts, auth_tokens, tenants, memberships
- tests/e2e/specs/system/api-routes.e2e.ts imports postgres + argon2 itself, with POSTGRES_FALLBACK_PORTS [5432,5433,5434] and fixed UUIDs
- tests/e2e/specs/notifications/notifications.e2e.ts contains raw INSERT INTO statements
- tests/integration/api/seed-helpers.ts instead uses USERS_TABLE from @bslt/db and hashPassword from @bslt/core
- Raw-SQL table refs across tests: 'FROM users' 25, 'INSERT INTO tenants' 5, notifications 4, users/memberships/legal_documents/job_queue/audit_events 3 each
- Schema setup: db-harness.ts runs runSqlMigrations on an isolated DB; CI real-db job runs `pnpm db:migrate` (~continuous-integration.yml:138); CI e2e job runs `pnpm db:push` (~line 222)

**Direction.** Create one repository-based seed module (e.g. @bslt/db/testing/seed: seedUser, seedTenant, seedMembership) used by e2e globalSetup, the api-routes smoke and the real-db suites. Make every lane apply migrations, and drop db:push from CI.

##### TEST-05. Real-DB gate boilerplate copied into all 26 real-db suites

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The skip-or-fail policy for real-DB tests is copied 26 times. Changing it, for example to require a DB locally or support a template database, means 26 edits, and new creator-platform suites would add more copies.

**Evidence:**

- `async function isDatabaseReachable` defined in 26 files under tests/integration/api/*.real-db.test.ts
- `const realDbRequired = process.env['CI'] !== undefined || process.env['REQUIRE_REAL_DB'] === '1'` defined in 26 files (e.g. auth.real-db.test.ts:32-50)
- Each file repeats initEnv() + buildConnectionString() + describe.runIf(dbAvailable)

**Direction.** Add a describeRealDb(name, (h: DbHarness) => void) helper to db-harness.ts that owns reachability, the CI requirement, harness creation, migration and teardown.

##### TEST-06. Mock factory sprawl; the canonical @bslt/db testing mock is unused

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Each package and test file invents its own fakes for RawDb, Repositories, Logger and email templates. When a repository or DB-client interface changes, which a DB restructure guarantees, dozens of hand-rolled mocks must be updated and some will silently keep stale shapes.

**Evidence:**

- Local (non-exported) definitions inside test files: createMockLogger x30, createMockRepos x22, createMockDbClient x22, createMockEmailTemplates x13, createMockDb x10, createMockRequest x7
- main/server/db/src/testing/mocks.ts:30 exports createMockDb, published via main/server/db/package.json:54 './testing', with 0 importers outside its own folder
- A second exported createMockDb in tests/integration/api/test-utils.ts:76 (MockDbClient interface at :35), used by 27 files
- main/server/db/src/repositories/users/users.test.ts:25-33 re-declares a RawDb mock inline

**Direction.** Give each layer a typed testing subpath that owns its fakes (@bslt/db/testing, @bslt/core/testing, @bslt/server-system/testing) and delete local copies. Optionally add an audit that flags new local createMock* definitions that shadow an exported one.

##### TEST-07. Web test helpers duplicated between tests/ and apps/web

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** duplication
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Two divergent renderWithProviders and auth-service mocks exist for the same app.

**Evidence:**

- tests/integration/web/utils.tsx (655 LOC) exports mockUser, mockAdminUser, mockConfig, createMockAuthService, createMockEnvironment, renderWithProviders
- main/apps/web/src/**tests**/utils.tsx (209 LOC) exports the same six names
- DIRECTION.md names main/apps/web/src/**tests**/utils.tsx as the frontend test helper location

**Direction.** Keep one helper in apps/web (a ./testing subpath or src/**tests**/utils.tsx) and have the relocated web integration tests import it.

##### TEST-08. Dead test scaffolding, placeholder fixtures and unconditional skips

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** dead-code
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Leftover scaffolding misleads readers about which setup is authoritative. The skipped security-header tests and the cross-tenant todo are real coverage holes, not just clutter.

**Evidence:**

- tests/utils/react-setup.ts, tests/utils/ui-setup.ts and tests/utils/mocks/react-router-dom.tsx have 0 importers (only their own header line matches)
- main/apps/web/src/testing/index.ts has 2 lines and 0 importers; it imports main/apps/web/src/**tests**/setup.ts (2 lines), which docs/dev/testing.md calls the 'Golden Standard' setup
- tests/e2e/fixtures/oauth-mock.ts, user-factory.ts ('placeholder ... In a real implementation') and email-interceptor.ts have 0 importers; email-interceptor calls /api/test/emails, which no route serves, and returns any[]
- main/apps/web/vitest.config.ts maps @bslt/kernel/* in workspaceSubpaths, but no source uses @bslt/kernel
- main/apps/server/src/middleware/security.test.ts:32-283 contains 8 unconditional test.skip calls
- 12 it.todo in tests/integration/api (media x4, webhooks x4, openapi-spec x2, security-notifications x2), including a cross-tenant webhook isolation todo (webhooks.integration.test.ts:554)

**Direction.** Delete the dead setup, fixture and alias files during the restructure. Turn the security.test.ts skips into real assertions or remove them. Promote the cross-tenant webhook todo to a real-DB test.

##### TEST-09. Package unit tests depend on central tests/utils, and turbo has no graph edge for @bslt/tests

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** coupling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Editing tests/utils/web-setup.ts probably does not invalidate @bslt/web's cached test result, since the file is outside the package inputs. A source change in main/server/core may not invalidate @bslt/tests' cached integration result, because no workspace dependency edge exists. Both can let cached green results hide real breakage. App-specific mocks also leak into the shared setup.

**Evidence:**

- main/apps/web/vitest.config.ts:203 setupFiles: ['../../../tests/utils/web-setup.ts']
- main/apps/server/vitest.config.ts:14 setupFiles: [path.resolve(__dirname, '../../../tests/utils/server-setup.ts')]
- tests/utils/web-setup.ts mocks the web-internal module '@demo/ui-library/hooks' and is also a setup file for @bslt/tests (tests/vitest.config.ts setupFiles)
- turbo.json 'test' inputs are ['**/\*.{ts,tsx}', 'vitest.config.ts'] (package-scoped); globalDependencies do not include tests/utils/**
- tests/package.json declares no @bslt/* workspace dependencies, yet tests import @bslt/core x113, @bslt/server x95, @bslt/db x63, @bslt/server-system x55 via tests/tsconfig.json paths
- CI restores node_modules/.cache/turbo with a prefix restore-key (continuous-integration.yml:70-75), and the merge gate runs `turbo run test --filter=@bslt/tests`

**Direction.** Move setup files into each package, or into a dedicated @bslt/testing workspace package declared as a devDependency. Declare @bslt/* devDependencies in tests/package.json so turbo hashes them. Confirm with `turbo run test --filter=@bslt/tests --dry=json`.

##### TEST-10. Vitest config sprawl with hand-maintained, inconsistent alias plumbing

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** config
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Every package re-declares how @bslt/shared and its siblings resolve to source, and the declarations disagree. Any topology move (renaming shared/src/modules, moving packages) touches 17 configs and 3 tsconfigs by hand.

**Evidence:**

- 17 package vitest configs plus root vitest.config.ts; alias blocks: main/server/core/vitest.config.ts 117 lines, main/client/ui/vitest.config.ts 113, main/apps/web/vitest.config.ts 220 (including a custom resolveWorkspaceToSource plugin)
- main/server/core, main/server/db, main/shared and main/apps/storefront use defineConfig and do not extend baseConfig; globals is false in core and shared and true elsewhere; testTimeout is 60s for core/db and 10s otherwise
- The alias helper lives at main/tools/scripts/audit/shared-vitest-aliases.ts (an audit folder); its vitestAliasTargets lists 7 configs, but 12 configs import it
- tests/tsconfig.json has about 90 path entries, including ambiguous multi-target aliases: '@components/_' maps to both client/ui components and web admin components, '@types' to ui types and server types, '@config/_' to web and server config
- main/tools/vitest.config.ts header: subpaths 'resolve three different ways' so tests reaching server code 'cannot run under this config'

**Direction.** Adopt a single root vitest 'projects' config, and resolve workspace packages through a 'source' export condition in each package.json exports (already used by `node --conditions=source`) instead of per-config regex aliases. Make all projects extend one base with uniform globals and timeouts. Remove app-internal aliases (@components, @types, @config) from tests/tsconfig.json.

##### TEST-11. Hard-coded path registries a topology restructure must update

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** tooling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Moving tests or packages is mechanically feasible because the headers can be auto-synced and gate-coverage catches real-db list drift. But at least 10 independent registries encode paths, and several (prune manifests, editions mirror, debt list) fail only when their specific command runs.

**Evidence:**

- tests/package.json 'test:real-db' names 26 file paths (guarded by main/tools/scripts/audit/gate-coverage.ts)
- main/tools/scripts/audit/test-pairs-debt.json (338 paths) plus ORPHAN_TEST_ALLOWLIST (9 paths) and ROOTS in colocated-test-pairs.ts
- main/tools/scripts/audit/shared-vitest-aliases.ts expectedTsconfigAliasMap and vitestAliasTargets
- config/playwright.config.ts testDir '../tests/e2e/specs', globalSetup/globalTeardown '../tests/e2e/*', outputDir '../tests/e2e/reports/test-results'
- tests/integration/api/db-harness.ts MIGRATIONS_DIR = '../../../main/server/db/migrations'
- about 25 'tests/...' paths in main/tools/scripts/starter/prune-manifests-features.ts (e.g. :551-611, :658-660, :1318-1371) and prune-manifests-packages.ts (:25-52, :238-259, :431-491)
- main/editions/core/main/** mirrors the main/ tree as .template files, including main/editions/shared/main/apps/server/src/edition-smoke.test.ts.template
- eslint.config.ts:201, :568, :963-964 (tests/** globs, './tests/tsconfig.json'); root tsconfig.json '@tests/*' and project reference './tests'
- sync:headers:check (merge gate) enforces a '// <repo path>' first line; 2,494 of 2,500 sampled TS files carry it

**Direction.** Do the restructure as one codemod commit that rewrites every registry above. Where possible replace lists with globs plus an audit (as gate-coverage does), and regenerate test-pairs-debt.json with --update after the moves.

##### TEST-12. CI e2e report upload points at a path Playwright never writes

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** tooling
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** When e2e fails in CI no report artifact is produced, and continue-on-error hides this.

**Evidence:**

- continuous-integration.yml (e2e job) uploads 'playwright-report/' with continue-on-error: true
- config/playwright.config.ts uses reporter [['github'],['blob']] in CI and writes HTML to '../tests/e2e/reports/html' locally

**Direction.** Upload blob-report/ (or tests/e2e/reports/**) and set if-no-files-found: error.

##### TEST-13. Oversized test files

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** god-file
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Large multi-concern test files make per-domain ownership and pruning hard. The prune manifests already need anchored edits inside these files.

**Evidence:**

- tests/e2e/specs/system/api-routes.e2e.ts: 3,128 lines, 75 'path:' fixtures, its own DB seeding, 18 test.skip calls
- tests/integration/api/auth.integration.test.ts: 2,597 lines
- tests/integration/api/notifications.integration.test.ts 1,616; media 1,516; billing 1,440; login-edge-cases.test.ts 1,518
- tests/integration/api/test-utils.ts: 901 lines (mocks + config + server + cookies)

**Direction.** Split the api-routes smoke per route module, driven by generatedRouteDefinitions with per-module fixture files. Split test-utils into config, server, mocks and http helpers.

##### TEST-14. Uneven unit coverage by package

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** test-topology
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Part of server/core's thin colocated coverage is an artifact of the misplaced auth tests and HTTP-level suites. storage and comms, which payouts, uploads and notifications for a creator platform depend on, are genuinely thin.

**Evidence:**

- server/storage: 0 test files ('test': 'vitest run ... --passWithNoTests'), 8 debt entries
- server/comms: 4 test files / 420 test LOC vs 2.5k source
- server/core: 73 test files / 14.7k test LOC vs 45.2k source; 142 of 338 debt entries
- server/system: 3.9k test LOC vs 8.5k; tools/scripts 5.8k vs 24.4k
- main/shared is excluded from strict pairing by design (colocated-test-pairs.ts shouldRequireColocatedTest comment)

**Direction.** After relocating tests, re-measure the debt. Add storage adapter contract tests (local/S3) and comms provider tests before building media and payout features on them.

##### TEST-15. Inconsistent test-kind naming and package-local test folders

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** naming-inconsistency
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** Tier membership is inferred from a mix of folder and suffix, which the audits must special-case (isIntegrationStyleTest).

**Evidence:**

- `.integration.test.ts(x)` x48 vs integration-folder files without the infix (tests/integration/auth/_.test.ts, tests/integration/web/_.test.tsx)
- `.unit.test.ts` used once (main/server/db/src/rls.unit.test.ts)
- e2e: `.e2e.ts` x40 vs `main/apps/web/tests/rust-access.e2e.spec.ts`; storefront uses `main/apps/storefront/test/storefront.smoke.mjs`
- Root baseConfig excludes '**/*.spec.ts' to keep Playwright specs out of vitest

**Direction.** Standardize suffixes per tier (.test, .http.test, .real-db.test, .e2e) and use them for gating instead of folder location.

##### TEST-16. Testing, workflow and onboarding docs are materially wrong about the current test system

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** docs
- **Severity:** high
- **Intentional?** no (accidental)

**Description.** Spot-checks found seven inaccurate claims across testing.md, principles.md, ONBOARDING.md and workflow.md. These are the docs an agent or new contributor reads first when restructuring tests.

**Evidence:**

- docs/dev/testing.md 'Runner: Vitest v4' vs package.json:200 'vitest': '^5.1.0'
- docs/dev/testing.md says the web config uses setupFiles ['./src/**tests**/setup.ts']; actual is '../../../tests/utils/web-setup.ts' (main/apps/web/vitest.config.ts:203). The 'Golden Standard' main/apps/web/src/**tests**/setup.ts is 2 lines
- docs/dev/testing.md lists `pnpm test:verbose`; no such script exists among the 156 root scripts. Last commit to testing.md: 2026-03-15
- docs/specs/principles.md:268 says integration runs 'against test database'; it does not (see the mock-tier finding)
- docs/ONBOARDING.md:93 and :182 point to main/apps/server/src/**tests**/integration/, which does not exist
- docs/dev/workflow.md:166 says pre-push runs `turbo run validate`; infra/git-hooks/pre-push runs main/tools/scripts/dev/pre-push.ts (sync:headers:check, lint, ci:fast:local or ci:full)
- docs/dev/workflow.md:168 says CI on push runs `pnpm ci:verify`; no workflow references ci:verify (continuous-integration.yml:78 runs ci:merge-gate)
- docs/specs/principles.md:381 cites dev/testing.md for 'Adversarial testing patterns and agent role'; that content exists only in the untracked .claude/agents/testing.md

**Direction.** Rewrite a single canonical testing doc after the test restructure. Generate its config facts (versions, setup files, scripts) or pin them with a small audit, as documents.test.ts does for the legal docs.

##### TEST-17. Competing status docs with contradictory claims

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** docs
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Three docs claim to describe current state and disagree. docs/CLAUDE.md is also easily confused with the agent guide .claude/CLAUDE.md.

**Evidence:**

- docs/CLAUDE.md (last verified 2026-07-07): '13 workflows' (actual 19 in .github/workflows), '16/16 packages' (actual 17 workspace packages incl. @bslt/storefront and @bslt/tests), '~7K unit tests' (about 13.9k it/test calls in main/), 'Gate health 95'
- docs/DIRECTION.md:424 says it 'Absorbed the former ... CLAUDE.md completeness report', yet docs/CLAUDE.md still exists and docs/todo/TODO.md links to it
- docs/todo/TODO.md: 'CI has not succeeded in 100+ runs (back to 2026-07-08)' and real-db-gate/e2e failed, which contradicts docs/CLAUDE.md 'pnpm ci:merge-gate 16/16 on HEAD'
- docs/HANDOFF-2026-06-19.md: a branch-specific handoff (codex/product-completeness, Vercel to Cloudflare) at the docs root with no inbound links
- docs/todo/TODO.md 'Colocated test coverage — 340 files ... 143 in server/core, 88 in apps/web' vs current debt 338/142/86

**Direction.** Keep DIRECTION.md as the only status doc and fold TODO.md's open items into it. Move HANDOFF and the CLAUDE.md completeness report into docs/log/ (or delete them), and stop hand-writing counts that drift.

##### TEST-18. Package READMEs are sparse, and the client/engine README describes removed APIs

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** docs
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The largest server packages, the ones being restructured, have no README, while one README documents a deleted subsystem.

**Evidence:**

- READMEs exist for 5 of 17 workspace packages (shared, server-system, client/ui, client/engine, apps/web), plus non-packages server-rust, tools and editions. None for server/core (45k LOC), server/db, client/api, client/react, apps/server, storefront, comms, media, realtime, storage, workers or tests
- main/client/engine/README.md: 14 of 28 imported names in its examples are not exported anywhere (RecordCache, LoaderCache, WebsocketPubsubClient, createTransactionQueue, createUndoRedoStack, createRecordStorage, createMutationQueue, useRecord, useWrite ...); main/client/engine/src contains only index.ts, query, storage, theme, types, ui. DIRECTION.md says these were removed 2026-06-12
- main/client/ui/README.md: 92 of 93 example imports valid (Tag missing), but it lists useUndoRedoShortcuts, which exists nowhere
- main/server/system/src/config/README.md: 5 of 10 path refs missing (main/apps/server/src/config, main/shared/src/config)

**Direction.** Rewrite client/engine/README.md, or cut it to what exists. Add short generated READMEs (purpose, public exports from package.json exports, dependencies) for every package. A script could derive these from package.json, as the DAG doc claims to.

##### TEST-19. Docs gates do not catch dead inline path references (73 across 26 docs)

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** docs
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** After a topology restructure, every moved path will rot silently inside prose unless the gate learns to read inline paths.

**Evidence:**

- main/tools/scripts/audit/docs-links.ts validates only Markdown link and href destinations
- Backtick path refs to nonexistent files: docs/dev/PORTING-FROM-GANBATE.md 8 (including main/ganbate), docs/dev/security.md 4 (main/apps/server/src/config, main/server/system/src/security/jwt.rotation.ts), docs/specs/specs.md 2 (core/src/billing/middleware.ts, db/src/queue/redis-queue-store.ts), docs/specs/principles.md 1 (main/client/api/src/generated/hooks.ts), docs/dev/workflow.md 1 (main/dev), docs/deploy/migrations.md 1 (0027_add_user_timezone.sql), docs/dev/rust-backend.md 1
- Deliberately missing (generated or snapshot): docs/architecture/installable-features.md 4 (main/apps/*/src/extensions/** are created at install time in Core); docs/architecture/core-and-extensions.md 1 (core-ci.yml generated from main/editions/core/.github/workflows/core-ci.yml.template); docs/architecture/api-contract-matrix.md 4 (self-declared Feb 2026 snapshot)

**Direction.** Extend docs-links.ts to resolve backtick repo paths (main/, tests/, config/, docs/), with an allowlist for edition- or install-generated paths. Run it after the codemod.

##### TEST-20. Docs sprawl: orphans, unindexed files, overlapping topics

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** docs
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The structure is mostly sound (start-here, direction, how-we-build, ship, history), but files added since mid-2026 were never indexed, and two topics have two competing docs.

**Evidence:**

- docs/ holds 95 .md files / 19,269 lines: api 19/5,262 (generated), deploy 17/3,752, dev 20/3,357, log 13/2,666, specs 5/1,423, architecture 9/1,218, top-level 6/1,101
- 16 docs have zero inbound Markdown links, including HANDOFF-2026-06-19.md, user-flows.md, todo/TODO.md, specs/README.md, architecture/responsive.md, dev/responsive.md, architecture/feature-installer-review.md, deploy/migrations.md and log W23/W24/W29/W41
- Section indexes omit: dev/{tenancy,stripe,PORTING-FROM-GANBATE,rust-backend,setup,responsive}.md; architecture/{feature-installer-review,responsive,installable-features}.md; deploy/{migrations,storefront,env}.md
- docs/log/README.md 'Last Updated: August 3, 2026' and omits W23, W24, W28, W29, W41
- Overlapping pairs: docs/architecture/responsive.md vs docs/dev/responsive.md; docs/dev/staging.md vs infra/cloud/staging-setup.md
- docs/user-flows.md step 2 'review the activity feed', but the activity feed is off in the starter profile (tests/e2e/fixtures/capabilities.ts VITE_ENABLE_ACTIVITY_FEED)
- Large single docs: log/2026-W32.md 1,615 lines, api/auth.md 1,520, dev/PORTING-FROM-GANBATE.md 1,103

**Direction.** Merge the responsive docs and the staging docs. Move PORTING-FROM-GANBATE, HANDOFF and feature-installer-review into an archive (or log). Regenerate section indexes from the folder contents, or add an audit that every docs/**/*.md is reachable from docs/README.md.

##### TEST-21. docs/ doubles as runtime content and a tooling output directory

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** coupling
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** The planned fork step 'remove docs' would break the legal pages, the dev-tools docs browser, the scaffolder link and the starter-docs gate. Docs reorganization also changes the web bundle. Part of this coupling is intentional (legal docs as file-owned content pinned by tests); the rest is accidental.

**Evidence:**

- main/apps/web/src/demo/home/data/docsMeta.ts:15-39 globs '../../../../../../../docs/**/*.md' and the root README into the dev-tools bundle; its CATEGORY_LABELS include 'quickstart' and 'reference', which are not docs folders, and lack architecture/api/legal/recipes
- docs/legal/*.md are shipped legal pages: main/shared/src/constants/core/compliance.ts:72, main/server/core/src/compliance/legal/service.ts:75, main/apps/web/src/**tests**/documents.test.ts, turbo.json globalDependencies 'docs/legal/**', main/tools/scripts/editions/export.ts:63 SUPPORT_ROOTS
- main/tools/scripts/refactor/shared/verify-shared-exports.ts:63 writes its report to docs/archive/refactor/baseline/phase7.verify-shared-exports.json (the only file in docs/archive)
- main/tools/scripts/starter/feature.ts:1092 scaffolds a link to docs/deploy/migrations.md
- main/tools/scripts/audit/starter-docs.ts requires phrases in README.md, docs/README.md and docs/ONBOARDING.md
- docs/api/*.md are generated by `pnpm docs:api`, but `audit:api-docs` runs only in .github/workflows/pr-preview.yml:39, not in ci:merge-gate

**Direction.** Move docs/legal into a content location owned by the web/compliance packages (e.g. main/apps/web/content/legal), and point turbo and editions at it. Move tool reports out of docs/. Make docsMeta read an explicit docs-root constant and an index. Add audit:api-docs to the merge gate.

##### TEST-22. Agent instructions are untracked and stale; stray artifacts are tracked

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** docs
- **Severity:** medium
- **Intentional?** no (accidental)

**Description.** Docs and principles treat the adversarial-TDD agent role and the docs-updater workflow as mandatory, but those specs live only on one machine and point at paths that do not exist. Any other agent or worktree runs without them.

**Evidence:**

- .gitignore:7 ignores '.claude/', so .claude/CLAUDE.md (188), CLAUDE-v2.md (422), CLAUDE-original.md (388), agents/testing.md and agents/docs-updater.md are not versioned
- The .claude/agents/docs-updater.md workflow targets docs/AGENTS.md, docs/agent/, docs/dev/architecture.md, shared/core/README.md, client/README.md and 'TODO.md Sprint 7'; none exist
- The .claude/agents/testing.md role prompt targets 'abe-stack' (old project name)
- The .claude/CLAUDE.md 'Last reviewed: 2026-05-15' quality section says `pnpm build # build + lint + type-check + test`
- The repo has no root AGENTS.md or CLAUDE.md; the tracked docs/CLAUDE.md is a status report, not an agent guide
- git ls-files shows 2 tracked .playwright-mcp/*.yml files despite .gitignore:11

**Direction.** Decide on a versioned root AGENTS.md or CLAUDE.md built from .claude/CLAUDE.md. Delete CLAUDE-v2.md and CLAUDE-original.md, fix or retire both agents, and remove the tracked .playwright-mcp files.

##### TEST-23. Architecture docs mostly accurate, with two drifts (media deps; @bslt/shared/workers not exported)

- **Area:** Tests (tests/, colocated _.test._, test-pairs-debt.json, vitest/playwright configs) and Docs (docs/**, package READMEs, .claude/agents)
- **Category:** docs
- **Severity:** low
- **Intentional?** no (accidental)

**Description.** The DAG and layer map are among the most trustworthy docs; their small drifts have no automated check.

**Evidence:**

- docs/architecture/server-dependency-dag.md (last verified 2026-06-08) lists @bslt/media deps as @bslt/db and @bslt/shared; main/server/media/package.json also declares @bslt/server-system, and media/src imports it twice. The other 8 package rows match package.json exactly
- docs/architecture/layer-map.md says 'Use @bslt/shared/workers'; main/shared/package.json exports have no './workers' key, yet main/server/workers/src/types.ts and dist/types.d.ts import '@bslt/shared/workers', so it resolves only through tsconfig and vitest aliases (a latent packaging issue for the shared/packaging area)
- layer-map.md: all 17 referenced shared/server paired paths exist; the 6 deprecated import paths are ESLint-restricted (eslint.config.ts:133-154)

**Direction.** Generate the DAG table from package.json, as the doc's own 'verified against package.json' line implies. Add './workers' to shared exports, or change the canonical import, and flag this to the shared/packaging area.

#### TEST strengths (preserve)

- gate-coverage audit (main/tools/scripts/audit/gate-coverage.ts) fails when a *.real-db.test.ts is missing from tests/package.json or a workspace package is missing from the merge-gate filters, so hand-maintained lists cannot silently shrink coverage
- Shrink-only colocation ratchet (colocated-test-pairs.ts + test-pairs-debt.json, 0 stale entries) with a documented orphan allowlist whose bar ('no source peer by design') is written in the code
- Real-DB harness (tests/integration/api/db-harness.ts): a per-suite isolated database built from the canonical SQL migrations, deadlock-retrying TRUNCATE, createRawDb deliberately chosen over the singleton client (documented). CI makes real-DB mandatory (fail, not skip) through the CI/REQUIRE_REAL_DB check
- Coverage is a deliberate non-blocking report with a written rationale (root vitest.config.ts, continuous-integration.yml coverage-report job)
- Capability-aware e2e: tests/e2e/fixtures/capabilities.ts skips optional surfaces cleanly per profile flag, and tests/e2e/fixtures/auth-contracts.ts builds mocked responses through the shared Zod-style contracts so contract drift fails at mock construction
- axe a11y gate in tests/e2e/specs/system/a11y.e2e.ts and a route-wide API smoke driven by generatedRouteDefinitions
- Docs pinned by tests: main/apps/web/src/**tests**/documents.test.ts pins factual claims in docs/legal; audit:starter-docs and audit:docs-links run in audit:template; docs/api is generated from the contract registry
- DIRECTION.md path claims held up: 25 of 25 sampled 'What's Built' paths exist, 9 locales, the raw <img> lint rule and migrations 0911/0912 all verified. layer-map.md pairings and ESLint-enforced deprecated imports are accurate
- Uniform '// <repo path>' file headers (2,494 of 2,500 sampled) with an auto-fix sync tool make mass file moves mechanical
- Weekly engineering log discipline (docs/log) and explicit snapshot disclaimers (api-contract-matrix.md) keep history separate from current-state docs
- Comments throughout the test configs and audit scripts explain why each choice was made, which preserves decision context through a restructure

#### TEST inventory

| Path                                                                    | Purpose                                                                                                                                                                                                                                     | Size                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tests/integration/api                                                   | Cross-package HTTP suites: 38 *.integration.test.ts (mock DB via createTestServer) + 26 *.real-db.test.ts + helpers (test-utils.ts 901, db-harness.ts 128, seed-helpers.ts 37, index.ts 30)                                                 | 68 files / 35,199 LOC    | Only truly cross-package integration tier; mock vs real-DB split per domain                                                                                                                                                                                                                                                                                                                                                                               |
| tests/integration/auth                                                  | Unit-style tests of @bslt/core auth handlers, login edge cases and refresh-token rotation                                                                                                                                                   | 3 files / 2,801 LOC      | Belongs colocated in main/server/core/src/auth                                                                                                                                                                                                                                                                                                                                                                                                            |
| tests/integration/ui                                                    | Cross-component @bslt/ui tests (focus, keyboard, modals, theme, layout)                                                                                                                                                                     | 7 files / 4,486 LOC      | Single-package; candidate to move into main/client/ui                                                                                                                                                                                                                                                                                                                                                                                                     |
| tests/integration/engine                                                | client/api error mapping tests                                                                                                                                                                                                              | 1 file / 501 LOC         |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| tests/integration/web                                                   | Web app flows (auth, dashboard, navigation, webhook admin) plus duplicated render helpers utils.tsx                                                                                                                                         | 8 files / 3,466 LOC      | utils.tsx duplicates main/apps/web/src/**tests**/utils.tsx                                                                                                                                                                                                                                                                                                                                                                                                |
| tests/integration/database/postgres-smoke.test.ts                       | Postgres smoke (POSTGRES_SMOKE_REQUIRED)                                                                                                                                                                                                    | 638 LOC                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| tests/e2e                                                               | Playwright specs (account, admin, auth, billing, media, notifications, system), fixtures, page-objects, global setup/teardown                                                                                                               | 41 files / 9,952 LOC     | api-routes.e2e.ts is 3,128 LOC; 3 fixtures unused; raw-SQL seeding                                                                                                                                                                                                                                                                                                                                                                                        |
| tests/utils                                                             | Vitest setup files (server-setup, web-setup, react-setup, ui-setup) and browser/canvas/console mocks                                                                                                                                        | 8 files / 294 LOC        | react-setup, ui-setup and mocks/react-router-dom are dead; web-setup and server-setup are used by apps/web and apps/server package configs                                                                                                                                                                                                                                                                                                                |
| tests/package.json, tests/tsconfig.json, tests/vitest.config.ts         | @bslt/tests package: scripts (test:integration, test:real-db with a 26-file list, test:postgres-smoke, test:e2e), about 90 path aliases, alias overrides                                                                                    | 32 + 113 + 39 lines      | No @bslt/* workspace deps declared                                                                                                                                                                                                                                                                                                                                                                                                                        |
| vitest.config.ts (root)                                                 | baseConfig shared by most packages; excludes .claude/** and *.spec.ts; coverage reporting only                                                                                                                                              | ~45 lines                |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| main/**/vitest.config.ts                                                | 17 per-package configs (apps/web 220, server/core 117, client/ui 113, apps/server 70, workers 64, media 63 ...)                                                                                                                             | 17 files                 | 4 do not extend baseConfig; hand-written source aliases                                                                                                                                                                                                                                                                                                                                                                                                   |
| config/playwright.config.ts                                             | Main e2e config: boots Vite + API dev servers, mock Stripe env, chromium + mobile-chrome projects                                                                                                                                           | ~150 lines               |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| main/apps/web/playwright.rust.config.ts                                 | Separate e2e for the opt-in Rust backend slice (rust-access.e2e.spec.ts)                                                                                                                                                                    | 17 lines                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| main/tools/scripts/audit/colocated-test-pairs.ts + test-pairs-debt.json | Colocation gate (lint:test-pairs:strict in lint:merge-gate) and shrink-only debt list                                                                                                                                                       | ~240 lines + 338 paths   | Debt by package: server/core 142, apps/web 86, server/db 27, server/system 17, client/ui 15, apps/server 12, client/react 9, server/storage 8, other 22                                                                                                                                                                                                                                                                                                   |
| main/tools/scripts/audit/gate-coverage.ts                               | Checks that every real-db test and workspace package is reached by the gates                                                                                                                                                                | ~170 lines               |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| main/tools/scripts/audit/shared-vitest-aliases.ts                       | Shared vitest alias factory plus expected tsconfig alias map (used by a sync audit)                                                                                                                                                         | ~120 lines               | Lives in audit/ although it is runtime test config                                                                                                                                                                                                                                                                                                                                                                                                        |
| main/server/db/src/testing                                              | Exported @bslt/db/testing mocks (createMockDb)                                                                                                                                                                                              | 2 files                  | 0 external importers                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| main/apps/web/src/**tests** + src/testing                               | Web test helpers (utils.tsx 209 LOC, documents.test.ts) and a 2-line setup.ts; src/testing/index.ts is dead                                                                                                                                 | 4 files                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Colocated tests in main/                                                | Unit tests next to source                                                                                                                                                                                                                   | 768 files / ~202k LOC    | apps/web 206 files (49.4k LOC), shared 136 (40.2k), client/ui 84 (16.9k), server/core 73 (14.7k), server/db 64 (27.0k), client/react 40 (15.0k), tools/scripts 32 (5.8k), apps/server 32 (7.6k), server/system 21 (3.9k), client/api 18 (6.8k), server/media 16 (4.0k), apps/storefront 9, tools/features 8, client/engine 7, server/realtime 6, tools/setup 5, server/workers 5, server/comms 4, profiles 2, server/storage 0; about 13.9k it/test calls |
| docs/ (top level)                                                       | README index, ONBOARDING, DIRECTION (status/roadmap), CLAUDE.md (stale completeness report), HANDOFF-2026-06-19 (stale), user-flows                                                                                                         | 6 files / 1,101 lines    |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/api                                                                | Generated per-domain API reference (pnpm docs:api)                                                                                                                                                                                          | 19 files / 5,262 lines   |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/architecture                                                       | layer-map, server-dependency-dag, api-contract-standard/matrix, core-and-extensions, installable-features, feature-installer-review, responsive                                                                                             | 9 files / 1,218 lines    |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/deploy                                                             | Deploy overview, env reference, migrations, backups, Postgres, reverse proxy, runbooks, release checklist, storefront, providers/*                                                                                                          | 17 files / 3,752 lines   |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/dev                                                                | workflow, configuration, testing, security, tenancy, stripe, prune/rename, rust-backend, responsive, PORTING-FROM-GANBATE (1,103) ...                                                                                                       | 20 files / 3,357 lines   |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/specs                                                              | principles (canonical standards), specs (ownership/entrypoints), auth, errors                                                                                                                                                               | 5 files / 1,423 lines    |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/log                                                                | Weekly/monthly engineering journal (W15–W41, M03)                                                                                                                                                                                           | 13 files / 2,666 lines   | Index stale                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| docs/legal                                                              | File-owned legal pages shipped in the web bundle (runtime content)                                                                                                                                                                          | 4 files / 156 lines      |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| docs/recipes, docs/todo, docs/archive                                   | Opt-in recipes; TODO plan; one tool-generated JSON report                                                                                                                                                                                   | 1 + 1 md files; 1 json   |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Package READMEs                                                         | main/client/ui (404), main/client/engine (414, half stale), main/apps/web (331), main/apps/server-rust (148), main/shared (74), main/server/system (69) + src/config (84), main/editions (31), main/tools (17), main/apps/web/src/demo (21) | 10 files / 1,593 lines   |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| .claude/                                                                | Agent guide (CLAUDE.md), two superseded versions, agents/testing.md, agents/docs-updater.md, settings                                                                                                                                       | 5 md files / 1,118 lines | Gitignored (.gitignore:7)                                                                                                                                                                                                                                                                                                                                                                                                                                 |

#### TEST wiring points

- `package.json (root)`: test, test:fast, test:integration, test:real-db, test:postgres-smoke, test:e2e(:8081-8083), test:tools, test:profiles, test:editions, test:features, lint:test-pairs(:strict), ci:merge-gate/ci:fast/ci:full/ci:everything turbo --filter lists, audit:docs-links, audit:starter-docs, docs:api/audit:api-docs, sync:headers*
- `tests/package.json`: @bslt/tests scripts; test:real-db hard-codes 26 real-db file paths; test:e2e points at ../config/playwright.config.ts
- `tests/vitest.config.ts`: integration include globs, setupFiles (utils/server-setup.ts, utils/web-setup.ts), shared alias overrides
- `tests/tsconfig.json`: about 90 path aliases into ../main/** (packages plus web/ui-internal aliases) and @tests/*
- `vitest.config.ts (root)`: baseConfig (globals, excludes incl. **/.claude/** and **/*.spec.ts, coverage reporters)
- `main/*/*/vitest.config.ts (17)`: Per-package environment, setupFiles, include patterns and source aliases; apps/web and apps/server pull setup from ../../../tests/utils
- `main/tools/scripts/audit/shared-vitest-aliases.ts`: createSharedVitestAliases plus expected tsconfig alias map and vitest alias target list
- `config/playwright.config.ts`: e2e testDir ../tests/e2e/specs, testMatch *.e2e.ts, globalSetup/Teardown, report dirs, webServer commands (pnpm --filter @bslt/web / @bslt/server), mock Stripe env
- `main/apps/web/playwright.rust.config.ts`: Rust-slice e2e (tests/rust-access.e2e.spec.ts)
- `main/tools/scripts/audit/colocated-test-pairs.ts`: ROOTS, ORPHAN_TEST_ALLOWLIST, DEBT_FILE (test-pairs-debt.json); runs in lint:merge-gate
- `main/tools/scripts/audit/gate-coverage.ts`: Checks the test:real-db list and merge-gate --filter coverage; runs in ci:merge-gate
- `turbo.json`: test task inputs ['**/\_.{ts,tsx}','vitest.config.ts'], env DATABASE_URL/TEST\__, globalDependencies incl. docs/legal/** and root vitest.config.ts
- `.github/workflows/continuous-integration.yml`: quality-merge-gate (ci:merge-gate), coverage-report (non-blocking), real-db-gate (db:migrate + test:real-db + test:postgres-smoke), e2e job (db:push + test:e2e + playwright-report upload)
- `.github/workflows/pr-preview.yml`: audit:api-docs (only place generated API docs are checked)
- `infra/git-hooks/pre-push -> main/tools/scripts/dev/pre-push.ts`: Local pre-push gate (sync:headers:check, lint, ci:fast:local or ci:full)
- `eslint.config.ts`: tests/** globs (:201, :963-964), tests/tsconfig.json project (:568), test-file ignores for restricted rules (:668, :750, :788, :878, :920)
- `tsconfig.json (root)`: @tests/* alias and project reference ./tests
- `main/tools/scripts/starter/prune-manifests*.ts`: About 25 tests/ file paths deleted or edited when features/packages are pruned
- `main/editions/core/main/** and main/editions/shared/**`: Template mirror of main/ paths, including edition-smoke.test.ts.template and core-ci.yml.template
- `main/tools/scripts/audit/docs-links.ts, starter-docs.ts`: Markdown link validation for docs/ and the root README; required/banned phrases in README, docs/README and ONBOARDING
- `main/tools/scripts/docs/generate-api-docs.ts`: Writes docs/api/*.md from the contract registry
- `main/apps/web/src/demo/home/data/docsMeta.ts`: import.meta.glob of docs/**/*.md and the root README into the dev-tools docs browser
- `main/tools/scripts/editions/export.ts:63`: SUPPORT_ROOTS ['config','docs/legal'] copied into exported editions
- `main/tools/scripts/refactor/shared/verify-shared-exports.ts:63`: Writes its report into docs/archive/refactor/baseline/

#### TEST creator-platform notes

- SFW/softcore separation 'enforced at the data layer' can only be proven by real-DB tests. The mock createTestServer tier cannot exercise RLS. Build a describeRealDb helper and a repository-based seed module first, or the new content-rating, age-gate and tenant-isolation suites will copy the 26x boilerplate and raw SQL.
- The DB restructure will break e2e seeding first: tests/e2e/fixtures/auth.ts, api-routes.e2e.ts and notifications.e2e.ts INSERT directly into users/tenants/memberships/auth_tokens. Centralize seeding before renaming or adding tables (creators, subscriptions, ppv_purchases, tips, payouts, content_ratings).
- Live-first means realtime becomes core, but server/realtime has only 6 test files (1.7k LOC) and realtime integration tests are mock-based and profile-optional. Promote the realtime suites into the default merge-gate profile and add real websocket e2e coverage for live tipping.
- Payments, tips and payouts: e2e runs with a fake Stripe key (config/playwright.config.ts mock billing env) and server/storage and server/comms are thinly tested. Add provider test-mode and contract harnesses, including a crypto payout adapter fake, before building on them.
- Moderation and age verification need e2e fixtures for roles beyond admin/user (globalSetup seeds admin/user/billing/notif/viewer/tenant-admin). Extend the seed module with creator, fan, moderator and age-verified/unverified personas.
- For the fork step that removes docs: docs/legal is shipped runtime content, docsMeta.ts globs docs/**, the starter-docs audit requires phrases in README/docs/README/ONBOARDING, and feature.ts scaffolds a docs link. Use starter:prune manifests and update these consumers rather than deleting docs/ wholesale.
- The rename step must touch tests/tsconfig.json (about 45 @bslt/* paths), 17 vitest configs, shared-vitest-aliases expectedTsconfigAliasMap, the playwright webServer --filter names, prune manifests, editions templates and every '// path' header. Plan a single codemod.
- Moving tests into packages before the fork would let starter:prune delete feature tests with their feature folders instead of relying on the about 25 hand-listed tests/ paths in the prune manifests. This makes a cleaner foundation for future TypeScript platforms as well.

#### TEST open questions

- Should HTTP-level suites (tests/integration/api) stay a top-level @bslt/tests package or move under apps/server as composition-root tests once a buildApp() factory exists?
- Is the mock HTTP 'integration' tier worth keeping per domain alongside real-DB suites, or should it shrink to route-contract checks only?
- Is .claude/ intentionally untracked? Should agent guidance (the adversarial-TDD role and docs-updater) become a versioned root AGENTS.md/CLAUDE.md?
- Does turbo invalidate @bslt/tests and @bslt/web cached test results when main/* sources or tests/utils change? This can be verified with `turbo run test --filter=@bslt/tests --dry=json` (not run here because the task was read-only).
- Is CI currently green? docs/todo/TODO.md says no success in 100+ runs since 2026-07-08 and real-db-gate/e2e failing; docs/CLAUDE.md claims 16/16.
- Should docs/legal remain under docs/ (shipped runtime content) or move to an app-owned content directory before the fork removes docs?
- Is docs/CLAUDE.md meant to survive, given DIRECTION.md:424 says it was absorbed?
- Should the e2e lane switch from `pnpm db:push` to migrations to match production and the real-DB harness?

## C. Feature traces (full)

### C.BILL. Billing: plans, subscriptions, payment methods, invoices, inbound Stripe/PayPal webhooks, usage metering, dunning, admin plan management

- **Packages touched:** 12
- **Total files:** 263
- **Wiring points:** 40

#### T-BILL per-layer file list

**1. SQL migrations (3 owned + 3 touching)** (6 files)

- `main/server/db/migrations/0200_billing.sql (owned: plans, subscriptions, customer_mappings, invoices, payment_methods, billing_events, 5 enums)`
- `main/server/db/migrations/0404_metering.sql (owned: usage_metrics, usage_snapshots, aggregation_type)`
- `main/server/db/migrations/0902_billing_tenant_scope.sql (owned: nullable tenant_id on subscriptions/customer_mappings/payment_methods, memberships.is_billing_admin, billing_tenant_backfill_audit, billing_resolve_primary_tenant())`
- `main/server/db/migrations/0900_rls.sql (touch: user-scoped billing RLS policies, lines 82-96; usage_snapshots has NO RLS)`
- `main/server/db/migrations/0700_realtime_versions.sql (touch: version columns on plans/subscriptions/invoices/payment_methods/usage_snapshots, lines 64-77,127)`
- `main/server/db/migrations/0401_audit.sql (touch: audit_category 'billing')`

**2. server/db schema + repositories (12 owned, 4 wiring, 8 tests)** (24 files)

- `main/server/db/src/schema/billing.ts`
- `main/server/db/src/schema/metering.ts`
- `main/server/db/src/repositories/billing/index.ts`
- `main/server/db/src/repositories/billing/plans.ts`
- `main/server/db/src/repositories/billing/subscriptions.ts`
- `main/server/db/src/repositories/billing/customer-mappings.ts`
- `main/server/db/src/repositories/billing/invoices.ts`
- `main/server/db/src/repositories/billing/payment-methods.ts`
- `main/server/db/src/repositories/billing/billing-events.ts`
- `main/server/db/src/repositories/metering/index.ts`
- `main/server/db/src/repositories/metering/usage-metrics.ts`
- `main/server/db/src/repositories/metering/usage-snapshots.ts`
- `main/server/db/src/repositories/index.ts (wiring)`
- `main/server/db/src/factory.ts (wiring)`
- `main/server/db/src/schema/index.ts (wiring)`
- `main/server/db/src/index.ts (wiring)`
- `main/server/db/src/repositories/billing/billing-events.test.ts`
- `main/server/db/src/repositories/billing/customer-mappings.test.ts`
- `main/server/db/src/repositories/billing/invoices.test.ts`
- `main/server/db/src/repositories/billing/payment-methods.test.ts`
- `main/server/db/src/repositories/billing/plans.test.ts`
- `main/server/db/src/repositories/billing/subscriptions.test.ts`
- `main/server/db/src/repositories/metering/usage-metrics.test.ts`
- `main/server/db/src/repositories/metering/usage-snapshots.test.ts`

**3a. server/core/src/billing module (40 non-test, 9 tests)** (49 files)

- `main/server/core/src/billing/index.ts`
- `main/server/core/src/billing/types.ts`
- `main/server/core/src/billing/factory.ts`
- `main/server/core/src/billing/routes.ts`
- `main/server/core/src/billing/stripe-provider.ts`
- `main/server/core/src/billing/mock-provider.ts`
- `main/server/core/src/billing/billing-notifier.ts`
- `main/server/core/src/billing/payment-notifications.ts`
- `main/server/core/src/billing/usage-metering.ts`
- `main/server/core/src/billing/usage-metering-handlers.ts`
- `main/server/core/src/billing/handlers/index.ts`
- `main/server/core/src/billing/handlers/invoices.ts`
- `main/server/core/src/billing/handlers/payment-methods.ts`
- `main/server/core/src/billing/handlers/plans.ts`
- `main/server/core/src/billing/handlers/subscriptions.ts`
- `main/server/core/src/billing/handlers/support.ts`
- `main/server/core/src/billing/routes/helpers.ts`
- `main/server/core/src/billing/routes/invoices.ts`
- `main/server/core/src/billing/routes/payment-methods.ts`
- `main/server/core/src/billing/routes/plans.ts`
- `main/server/core/src/billing/routes/subscription.ts`
- `main/server/core/src/billing/routes/usage.ts`
- `main/server/core/src/billing/service/index.ts`
- `main/server/core/src/billing/service/catalog.ts`
- `main/server/core/src/billing/service/invoices.ts`
- `main/server/core/src/billing/service/payment-methods.ts`
- `main/server/core/src/billing/service/subscriptions.ts`
- `main/server/core/src/billing/service/support.ts`
- `main/server/core/src/billing/paypal/api.ts`
- `main/server/core/src/billing/paypal/mappers.ts`
- `main/server/core/src/billing/paypal/metadata.ts`
- `main/server/core/src/billing/paypal/provider.ts`
- `main/server/core/src/billing/paypal/types.ts`
- `main/server/core/src/billing/paypal/webhooks.ts`
- `main/server/core/src/billing/webhooks/index.ts`
- `main/server/core/src/billing/webhooks/shared.ts`
- `main/server/core/src/billing/webhooks/stripe/events.ts`
- `main/server/core/src/billing/webhooks/stripe/handler.ts`
- `main/server/core/src/billing/webhooks/paypal/events.ts`
- `main/server/core/src/billing/webhooks/paypal/handler.ts`
- `main/server/core/src/billing/billing-notifier.test.ts`
- `main/server/core/src/billing/mock-provider.test.ts`
- `main/server/core/src/billing/stripe-provider.test.ts`
- `main/server/core/src/billing/usage-metering.test.ts`
- `main/server/core/src/billing/service/subscriptions.test.ts`
- `main/server/core/src/billing/paypal/provider.test.ts`
- `main/server/core/src/billing/paypal/webhooks.test.ts`
- `main/server/core/src/billing/webhooks/stripe/events.test.ts`
- `main/server/core/src/billing/webhooks/paypal/events.test.ts`

**3b. server/core admin billing + cross-module touchpoints** (17 files)

- `main/server/core/src/admin/billingHandlers.ts`
- `main/server/core/src/admin/billingService.ts`
- `main/server/core/src/admin/billingHandlers.test.ts`
- `main/server/core/src/admin/billingService.test.ts`
- `main/server/core/src/admin/routes.ts (admin billing routes lines 396-530)`
- `main/server/core/src/admin/index.ts`
- `main/server/core/src/admin/types.ts (HasBilling, config.billing)`
- `main/server/core/src/admin/userHandlers.ts (hard-ban inline subscription cancel, lines 466-478)`
- `main/server/core/src/audit/types.ts (billing.* audit actions, lines 20-26)`
- `main/server/core/src/audit/service.ts (category inference, lines 26-27)`
- `main/server/core/src/compliance/data-export/service.ts (aggregateSubscriptions, lines 129,194-199)`
- `main/server/core/src/users/data-hygiene.ts (deletion blockers on subs/unpaid invoices, lines 328-367)`
- `main/server/core/src/tenants/routes.ts (tenants/:id/members/:userId/billing-admin, line 223)`
- `main/server/core/src/tenants/handlers/members.ts`
- `main/server/core/src/tenants/membership-service.ts`
- `main/server/core/src/auth/personal-tenant.ts (isBillingAdmin: true, line 92)`
- `main/server/core/src/index.ts (export billingRoutes, line 18)`

**4. Other server packages (system config, workers, comms, media)** (10 files)

- `main/server/system/src/config/services/billing.ts`
- `main/server/system/src/config/services/billing.test.ts`
- `main/server/system/src/config/services/index.ts`
- `main/server/system/src/config/factory.ts (lines 15,188,248-250)`
- `main/server/system/src/config/index.ts`
- `main/server/system/src/runtime/health.ts (line 326)`
- `main/server/workers/src/scheduler/register.ts (usage-snapshot cron, lines 48-63)`
- `main/server/workers/src/service.ts (trial-expiry 107-134, billing-events-cleanup 206-216)`
- `main/server/comms/src/email/templates/templates.ts (paymentFailed/paymentRecovered/accountSuspended, lines 839-942)`
- `main/server/media/src/facade.ts (MediaEntitlements gate, lines 35-176; never fed)`

**5. apps/server registration** (6 files)

- `main/apps/server/src/http/router.ts (lines 18,88-95)`
- `main/apps/server/src/http/route-modules.ts (registerBillingWebhookRoutes, lines 85-217)`
- `main/apps/server/src/plugin/raw-body.ts`
- `main/apps/server/src/bootstrap/context.ts (billing/billingNotifier slots lines 66-67,143-146)`
- `main/apps/server/src/bootstrap/app.ts (lines 530,575-576)`
- `main/apps/server/src/bootstrap/phases/comms.ts (lines 33-36,108,198-204)`

**6. shared (14 owned, 9 tests, 14 wiring/touching)** (37 files)

- `main/shared/src/modules/core/billing/index.ts`
- `main/shared/src/modules/core/billing/billing.schemas.ts`
- `main/shared/src/modules/core/billing/billing.admin.schemas.ts`
- `main/shared/src/modules/core/billing/billing.service.types.ts`
- `main/shared/src/modules/core/billing/billing.errors.ts`
- `main/shared/src/modules/core/billing/billing.logic.ts`
- `main/shared/src/modules/core/billing/billing.entitlements.ts`
- `main/shared/src/modules/core/billing/billing.display.ts`
- `main/shared/src/modules/core/billing/billing.form.ts`
- `main/shared/src/modules/core/usage-metering/index.ts`
- `main/shared/src/modules/core/usage-metering/usage.metering.ts`
- `main/shared/src/constants/core/billing.ts`
- `main/shared/src/contracts/contract.billing.ts`
- `main/shared/src/modules/system/config/env.billing.ts`
- `main/shared/src/modules/core/billing/billing.admin.schemas.test.ts`
- `main/shared/src/modules/core/billing/billing.display.test.ts`
- `main/shared/src/modules/core/billing/billing.entitlements.test.ts`
- `main/shared/src/modules/core/billing/billing.errors.test.ts`
- `main/shared/src/modules/core/billing/billing.form.test.ts`
- `main/shared/src/modules/core/billing/billing.logic.test.ts`
- `main/shared/src/modules/core/billing/billing.schemas.test.ts`
- `main/shared/src/modules/core/usage-metering/usage.metering.test.ts`
- `main/shared/src/modules/system/config/env.billing.test.ts`
- `main/shared/src/constants/core/index.ts (wiring)`
- `main/shared/src/modules/core/index.ts (wiring)`
- `main/shared/src/index.ts (wiring)`
- `main/shared/src/contracts/index.ts (wiring)`
- `main/shared/src/api/router.ts (wiring, line 38)`
- `main/shared/src/contracts/contract.admin.ts (admin billing contract entries)`
- `main/shared/src/contracts/edition-ports.ts (BillingNotifier port)`
- `main/shared/src/contracts/context.ts (HasBilling { billing?: unknown }, lines 74-76)`
- `main/shared/src/modules/system/config/index.ts`
- `main/shared/src/modules/system/config/env.validation.ts`
- `main/shared/src/constants/system/audit.ts (AUDIT_CATEGORIES incl. billing)`
- `main/shared/src/constants/system/comms.ts (WEBHOOK_EVENT_TYPES subscription.*/invoice.*, lines 21-25)`
- `main/shared/src/modules/core/activities/activities.types.ts (BILLING_* activity types, lines 65-73)`
- `main/shared/src/modules/core/tenant/membership.schemas.ts (billing-admin schema)`

**7. client/api** (7 files)

- `main/client/api/src/billing/client.ts`
- `main/client/api/src/billing/admin.ts`
- `main/client/api/src/billing/index.ts`
- `main/client/api/src/billing/client.test.ts`
- `main/client/api/src/billing/admin.test.ts`
- `main/client/api/src/index.ts (lines 57-64)`
- `main/client/api/src/generated/client.ts (generated route manifest, lines 16-34,170-188)`

**8. client/react (0 tests)** (4 files)

- `main/client/react/src/billing/hooks.ts`
- `main/client/react/src/billing/admin.ts`
- `main/client/react/src/billing/index.ts`
- `main/client/react/src/index.ts (lines 174-192)`

**9. client/ui** (20 files)

- `main/client/ui/src/components/billing/index.ts`
- `main/client/ui/src/components/billing/InvoiceRow.tsx`
- `main/client/ui/src/components/billing/PaymentMethodCard.tsx`
- `main/client/ui/src/components/billing/PlanCard.tsx`
- `main/client/ui/src/components/billing/PlanChangeDialog.tsx`
- `main/client/ui/src/components/billing/PricingTable.tsx`
- `main/client/ui/src/components/billing/SubscriptionStatus.tsx`
- `main/client/ui/src/components/billing/TenantUsageOverrideEditor.tsx`
- `main/client/ui/src/components/billing/UsageBar.tsx`
- `main/client/ui/src/components/billing/UsageDashboard.tsx`
- `main/client/ui/src/components/billing/UsageSummary.tsx`
- `main/client/ui/src/components/billing/InvoiceRow.test.tsx`
- `main/client/ui/src/components/billing/PaymentMethodCard.test.tsx`
- `main/client/ui/src/components/billing/PlanCard.test.tsx`
- `main/client/ui/src/components/billing/PricingTable.test.tsx`
- `main/client/ui/src/components/billing/SubscriptionStatus.test.tsx`
- `main/client/ui/src/components/billing/TenantUsageOverrideEditor.test.tsx`
- `main/client/ui/src/components/billing/UsageDashboard.test.tsx`
- `main/client/ui/src/components/index.ts (wiring)`
- `main/client/ui/src/index.ts (wiring)`

**10. apps/web (17 owned incl. CSS, 9 tests, 20 wiring/touching)** (46 files)

- `main/apps/web/src/features/billing/index.ts`
- `main/apps/web/src/features/billing/defaultPlans.ts`
- `main/apps/web/src/features/billing/components/StripeCardForm.tsx`
- `main/apps/web/src/features/billing/components/StripeElementsCardForm.tsx`
- `main/apps/web/src/features/billing/pages/index.ts`
- `main/apps/web/src/features/billing/pages/BillingSettingsPage.tsx`
- `main/apps/web/src/features/billing/pages/BillingSettingsPage.css`
- `main/apps/web/src/features/billing/pages/BillingUnavailablePage.tsx`
- `main/apps/web/src/features/billing/pages/CheckoutCancelPage.tsx`
- `main/apps/web/src/features/billing/pages/CheckoutSuccessPage.tsx`
- `main/apps/web/src/features/billing/pages/CheckoutResultPage.css`
- `main/apps/web/src/features/billing/pages/PricingPage.tsx`
- `main/apps/web/src/features/billing/pages/PricingPage.css`
- `main/apps/web/src/features/admin/pages/PlanManagementPage.tsx`
- `main/apps/web/src/features/admin/pages/PlanManagementPage.css`
- `main/apps/web/src/features/admin/components/GrantSubscriptionCard.tsx`
- `main/apps/web/src/features/admin/components/StripeStatusCard.tsx`
- `main/apps/web/src/features/billing/components/StripeCardForm.test.tsx`
- `main/apps/web/src/features/billing/components/StripeElementsCardForm.test.tsx`
- `main/apps/web/src/features/billing/pages/BillingSettingsPage.test.tsx`
- `main/apps/web/src/features/billing/pages/BillingUnavailablePage.test.tsx`
- `main/apps/web/src/features/billing/pages/CheckoutCancelPage.test.tsx`
- `main/apps/web/src/features/billing/pages/CheckoutSuccessPage.test.tsx`
- `main/apps/web/src/features/billing/pages/PricingPage.test.tsx`
- `main/apps/web/src/features/admin/pages/PlanManagementPage.test.tsx`
- `main/apps/web/src/features/admin/components/GrantSubscriptionCard.test.tsx`
- `main/apps/web/src/app/routes.tsx (lines 87-95,124-126,192-225,367-369,555-557)`
- `main/apps/web/src/app/capabilities.ts (VITE_ENABLE_BILLING, line 25)`
- `main/apps/web/src/app/starterSurface.ts (lines 15-23)`
- `main/apps/web/src/app/queryPersistencePolicy.ts (line 27)`
- `main/apps/web/src/config.ts (VITE_STRIPE_PUBLISHABLE_KEY, lines 59,97)`
- `main/apps/web/src/features/settings/settingsTabs.ts (lines 61-69)`
- `main/apps/web/src/features/settings/components/AccountModal.tsx (lines 333-359,430)`
- `main/apps/web/src/features/settings/pages/AccountModalRoute.tsx (lines 28-39)`
- `main/apps/web/src/features/admin/adminSurface.ts (lines 104-107)`
- `main/apps/web/src/features/admin/pages/UserDetailPage.tsx (line 266)`
- `main/apps/web/src/features/admin/pages/UserListPage.tsx (line 42)`
- `main/apps/web/src/features/admin/pages/AdminDashboardPage.tsx (lines 208-251,354-359,500-507)`
- `main/apps/web/src/features/command-palette/data/commands.ts (lines 59,107-117)`
- `main/apps/web/src/features/notifications/utils/getNotificationRoute.ts (lines 23,42-43)`
- `main/apps/web/src/features/activities/components/ActivityFeed.tsx (lines 36-43)`
- `main/apps/web/src/pages/LandingPage.tsx (lines 26-28)`
- `main/apps/web/src/demo/api-routes/routeCoverage.ts`
- `main/apps/web/vite.config.ts (@billing alias, line 250)`
- `main/apps/web/tsconfig.json (@billing alias, lines 30-31)`
- `main/apps/web/package.json (@stripe/react-stripe-js, @stripe/stripe-js)`

**11. Repo-level tests** (7 files)

- `tests/integration/api/billing.integration.test.ts (1440 lines)`
- `tests/integration/api/billing.real-db.test.ts`
- `tests/integration/api/billing-webhook.real-db.test.ts`
- `tests/integration/api/billing-webhooks.integration.test.ts`
- `tests/integration/api/golden-path-billing-checkout.integration.test.ts`
- `tests/integration/api/usage-metering.real-db.test.ts`
- `tests/e2e/specs/billing/billing.e2e.ts`

**12. Editions / extensions gating** (12 files)

- `main/extensions/billing/feature.json`
- `main/extensions/billing/smoke.ts.template`
- `main/extensions/billing/src/server/index.ts.template`
- `main/extensions/billing/src/server/webhooks.ts.template`
- `main/extensions/billing/src/web/index.tsx.template`
- `main/extensions/billing/src/web/styles.css.template`
- `main/extensions/billing/verify-web.mjs`
- `main/extensions/billing/web.test.tsx.template`
- `main/editions/catalog.ts (lines 28,42,69,113)`
- `main/editions/core/main/apps/web/src/app/capabilities.ts.template (isBillingEnabled() returns false)`
- `main/editions/core/main/apps/server/src/http/route-modules.ts.template (route-modules without billing webhooks)`
- `main/editions/core/main/apps/server/src/bootstrap/phases/comms.ts.template (comms phase without billing notifier)`

**13. Tools / audits / codegen** (9 files)

- `main/tools/scripts/editions/export.ts (string surgery on router.ts, lines 292-311; Stripe dep handling 398-412)`
- `main/tools/scripts/starter/prune-manifests-features.ts (activities prune splices billing handler source text, lines 117-184)`
- `main/tools/scripts/audit/api-response-sync.ts (billing contract checks, lines 66-68,220-280)`
- `main/tools/scripts/audit/route-manifest.ts`
- `main/tools/scripts/audit/test-pairs-debt.json (billing entries lines 59,107-108,127-129,213-236)`
- `main/tools/scripts/audit/starter-defaults.ts`
- `main/tools/scripts/docs/generate-api-docs.ts`
- `main/tools/scripts/recipes/registry.ts`
- `main/tools/setup/integrations.ts`

**14. Docs (9 primary; 42 docs files mention billing/stripe/paypal)** (9 files)

- `docs/api/billing.md (generated, 340 lines)`
- `docs/dev/stripe.md`
- `docs/DIRECTION.md (Billing & Payments table lines 122-133)`
- `docs/CLAUDE.md (lines 40,55,79-80,96)`
- `docs/architecture/api-contract-matrix.md (stale billing rows lines 52-69,111)`
- `docs/architecture/core-and-extensions.md`
- `docs/architecture/installable-features.md`
- `docs/dev/prune.md (billing not prunable, line 89)`
- `docs/deploy/env.md`

#### T-BILL wiring points

- `main/server/db/src/factory.ts`: Instantiates plans/subscriptions/customerMappings/invoices/paymentMethods/billingEvents and usageMetrics/usageSnapshots into the global Repositories object (lines 136-142,184-186,231-237,279-281)
- `main/server/db/src/repositories/index.ts`: Barrel re-export of billing (lines 50-66) and metering (126-135) repos
- `main/server/db/src/schema/index.ts`: Re-exports billing table constants/types (lines 87-113) incl. constants originally from @bslt/shared/core
- `main/server/core/src/billing/service/support.ts`: createTransactionalBillingRepos: tx-scoped repo bundle for payment-method mutations
- `main/server/core/src/billing/webhooks/shared.ts`: createTransactionalWebhookRepos + processBillingWebhook: tx, idempotency (billing_events), post-commit notifier dispatch
- `main/server/core/src/billing/routes.ts`: Assembles billingRoutes from routes/{plans,subscription,invoices,usage,payment-methods}.ts
- `main/server/core/package.json`: './billing' subpath export (lines 30-34) consumed by apps/server and workers
- `main/server/core/src/index.ts`: Root export of billingRoutes (line 18); Core edition export strips this line by regex
- `main/server/core/src/admin/routes.ts`: Admin billing endpoints (plans CRUD, sync-stripe, stripe-status, grant subscription) registered inside the admin route map (lines 396-530)
- `main/apps/server/src/http/router.ts`: Special-cased registerRouteMap(billingRoutes, module:'billing') outside coreRouteModuleRegistrations, plus conditional webhook registration (lines 88-95)
- `main/apps/server/src/http/route-modules.ts`: Raw Fastify POST /api/webhooks/stripe and /api/webhooks/paypal with signature header assembly and error-to-status mapping (lines 85-217)
- `main/apps/server/src/plugin/raw-body.ts`: Captures raw request body for provider signature verification
- `main/apps/server/src/bootstrap/phases/comms.ts`: Creates BillingNotifier with branded dunning templates and URLs from config.billing.urls (lines 33-36,108,198-204)
- `main/apps/server/src/bootstrap/context.ts`: AppContext.billing (never populated) and AppContext.billingNotifier slots (lines 66-67,143-146); contextualizeRequest validates x-tenant-id membership (lines 243-297)
- `main/server/system/src/config/factory.ts`: loadBillingConfig/validateBillingConfig into AppConfig.billing (lines 15,188,248-250)
- `main/server/system/src/config/services/billing.ts`: Resolves active provider from env (BILLING_PROVIDER, STRIPE__, PAYPAL__), URLs, unused PLAN_*_ID map
- `main/server/workers/src/scheduler/register.ts`: Leader-elected hourly 'usage-snapshot' cron calling createUsageSnapshot per active tenant (lines 48-63)
- `main/server/workers/src/service.ts`: Interval-registry tasks 'trial-expiry' (lines 107-134) and 'billing-events-cleanup' 90d (lines 206-216)
- `main/shared/src/api/router.ts`: apiRouter.billing = billingContract (line 38); consumed only by audit scripts
- `main/shared/package.json`: './core/*' wildcard makes @bslt/shared/core/billing and /usage-metering resolvable
- `main/client/api/src/index.ts`: Exports createBillingClient/createAdminBillingClient (lines 57-64); createBillingClient has no runtime consumer
- `main/client/api/src/generated/client.ts`: Generated route manifest including all /api/billing/* and /api/admin/billing/* routes (not the raw webhook routes)
- `main/client/react/src/index.ts`: Exports billing hooks and query keys (lines 174-192)
- `main/client/ui/src/index.ts`: Exports billing components (lines 63-127); TenantUsageOverrideEditor and UsageDashboard are not exported from root
- `main/apps/web/src/app/routes.tsx`: Lazy billing pages, billingRoutes(enabled) for pricing/settings/billing/billing/success/billing/cancel, admin billing/plans (lines 87-95,124-126,192-225,367-369,555-557)
- `main/apps/web/src/app/capabilities.ts`: isBillingEnabled() from VITE_ENABLE_BILLING (line 25), independent of server config.billing.enabled
- `main/apps/web/src/app/starterSurface.ts`: Declares billing routes as part of starter surface (lines 15-23)
- `main/apps/web/src/features/settings/settingsTabs.ts`: Adds Billing settings tab when billingEnabled (lines 61-69)
- `main/apps/web/src/features/settings/components/AccountModal.tsx`: Billing tab navigates out of modal to /settings/billing (lines 333-359)
- `main/apps/web/src/features/settings/pages/AccountModalRoute.tsx`: Redirects ?section=billing to /settings/billing (lines 28-39)
- `main/apps/web/src/features/admin/adminSurface.ts`: Admin nav entry 'Billing' -> /admin/billing/plans (lines 104-107)
- `main/apps/web/src/features/command-palette/data/commands.ts`: 'Go to Billing' command, navigates to /pricing (lines 107-117)
- `main/apps/web/src/features/notifications/utils/getNotificationRoute.ts`: Routes billing.* actions and billing_* notification types to /settings/billing (lines 23,42-43)
- `main/apps/web/src/app/queryPersistencePolicy.ts`: Excludes 'billing' query keys from persisted cache (line 27)
- `main/apps/web/src/config.ts`: stripePublishableKey from VITE_STRIPE_PUBLISHABLE_KEY (lines 59,97)
- `main/editions/catalog.ts`: Lists billing as paid server module, paid web feature, paid API module, and paid client/react dir (lines 28,42,69,113)
- `main/tools/scripts/editions/export.ts`: Core edition removes billing by exact-text patching of server/core/src/index.ts and apps/server/src/http/router.ts (lines 292-311) and strips @stripe deps (398-412)
- `main/editions/core/main/apps/web/src/app/capabilities.ts.template`: Core edition hard-codes isBillingEnabled() => false
- `main/extensions/billing/feature.json`: Installable Stripe-only billing for Core: copies 8 server/core billing source files and adds its own server/web templates
- `main/tools/scripts/starter/prune-manifests-features.ts`: Activities prune manifest text-splices tryActivity blocks out of billing handlers (lines 117-184)

#### T-BILL adding an endpoint

1. Example: a provider-backed user endpoint with UI (e.g. POST /api/billing/portal-session or GET /api/billing/invoices/:id/pdf), no new table. 22+ files across 7 packages:
2. main/shared/src/modules/core/billing/billing.schemas.ts - request/response schema + types (and billing.schemas.test.ts)
3. main/shared/src/modules/core/billing/index.ts - re-export (main/shared/src/modules/core/index.ts too if consumed via @bslt/shared/core root)
4. main/shared/src/contracts/contract.billing.ts - contract entry (only audits read it, but docs/api-contract-standard.md rule 1 requires it)
5. main/shared/src/modules/core/billing/billing.service.types.ts - add method to BillingService port if the provider must act
6. main/server/core/src/billing/stripe-provider.ts - implement provider method
7. main/server/core/src/billing/paypal/provider.ts - implement or explicitly reject
8. main/server/core/src/billing/mock-provider.ts - implement for e2e/mock mode
9. main/server/core/src/billing/factory.ts - add method to DisabledBillingProvider
10. main/server/core/src/billing/service/<area>.ts + service/index.ts - business logic
11. main/server/core/src/billing/handlers/<area>.ts + handlers/index.ts - HTTP handler (user lookup, enabled check, tryAudit/tryActivity/tryNotification, handleError)
12. main/server/core/src/billing/handlers/support.ts - extend handleError name list if a new error class is introduced
13. main/server/core/src/billing/routes/<area>.ts (and routes.ts if a new slice) - route entry with schema
14. main/server/core/src/billing/index.ts - public export if other packages need it
15. main/client/api/src/billing/client.ts - BillingClient interface + implementation (+ client.test.ts); note: no runtime consumer today
16. main/client/react/src/billing/hooks.ts - ALSO add to the private BillingApiClient interface and its private createBillingClient, add query key + hook
17. main/client/react/src/billing/index.ts and main/client/react/src/index.ts - export hook
18. main/client/ui/src/components/billing/<Component>.tsx + components/billing/index.ts + components/index.ts + src/index.ts - presentational component (if reusable)
19. main/apps/web/src/features/billing/pages/BillingSettingsPage.tsx (or new page + features/billing/index.ts + pages/index.ts + app/routes.tsx + app/starterSurface.ts + settingsTabs.ts/commands.ts for nav)
20. main/client/api/src/generated/client.ts and docs/api/billing.md - regenerate (route manifest / generate-api-docs)
21. main/apps/web/src/demo/api-routes/routeCoverage.ts - add 'METHOD /api/billing/...'
22. tests/integration/api/billing.integration.test.ts - integration coverage (handlers have no co-located unit tests; otherwise add to main/tools/scripts/audit/test-pairs-debt.json)
23. If it needs persistence: + new migration in main/server/db/migrations, main/server/db/src/schema/billing.ts (types + *_COLUMNS), repositories/billing/<repo>.ts + index.ts, repositories/index.ts, factory.ts, server/core/src/billing/types.ts (BillingRepositories, BillingAppContext.repos), service/support.ts and webhooks/shared.ts tx repo builders, and 0900-style RLS policy
24. If admin-facing: + main/server/core/src/admin/routes.ts, admin/billingHandlers.ts, admin/billingService.ts, shared contract.admin.ts, billing.admin.schemas.ts, client/api/src/billing/admin.ts, client/react/src/billing/admin.ts, apps/web/src/features/admin/pages/PlanManagementPage.tsx
25. If Core-edition parity is wanted: main/extensions/billing/src/server/index.ts.template and src/web/index.tsx.template (different API shape) and feature.json sources

#### T-BILL inconsistencies

**T-BILL-I01.** [ACCIDENTAL] SQL enums and shared TS constants have drifted. payment_method_type: SQL has card/bank_transfer/paypal/crypto/other, TS has card/bank_account/paypal. plan_interval: SQL adds 'lifetime', TS does not. invoice_status: TS adds 'past_due', SQL does not. billing_events.event_type is free TEXT in SQL but a 7-value union in TS. This is latent today because providers only write 'card' (stripe-provider.ts:319,336). It will break once bank, crypto or lifetime plans arrive, all of which the creator platform needs.

Evidence:

- main/server/db/migrations/0200_billing.sql:12,17,18,146
- main/shared/src/constants/core/billing.ts:41,47,71-78,84-92
- main/server/core/src/billing/handlers/support.ts:123 (formatPaymentMethod type 'card'|'bank_account'|'paypal')
- main/shared/src/modules/core/billing/billing.display.ts:198,212 ('bank_account' labels)

**T-BILL-I02.** [ACCIDENTAL] There are 3 copies of the default plan catalog, and they match line for line. No SQL seed for plans exists (tools/scripts/db/seed.ts has no plan or metric rows).

Evidence:

- main/server/core/src/billing/handlers/plans.ts:12-121 (DEFAULT_BILLING_PLANS, served when billing disabled)
- main/apps/web/src/features/billing/defaultPlans.ts:7-116 (DEFAULT_PRICING_PLANS, fallback in PricingPage.tsx:85)
- main/shared/src/constants/core/billing.ts:50-54 (PLAN_FEES pro 2900 / enterprise 29900)

**T-BILL-I03.** [ACCIDENTAL] There are 2 separate billing HTTP clients. client/react billing hooks carry a private createBillingClient with their own CSRF cache. It duplicates @bslt/api createBillingClient, which therefore has no runtime consumer. The private client skips the shared factory's refresh-on-401 default and its x-tenant-id header. Admin billing hooks do use @bslt/api, so the two halves of the same feature disagree.

Evidence:

- main/client/react/src/billing/hooks.ts:64-275 (private BillingApiClient, csrfTokenCache line 95)
- main/client/api/src/billing/client.ts:127-286 (only consumers: its test and the barrel)
- main/client/api/src/utils.ts:40-90 (onUnauthorized default + applyTenantHeader skipped by the private client)
- main/client/react/src/billing/admin.ts:9,71 (uses createAdminBillingClient from @bslt/api)
- main/client/react/src/oauth/hooks.ts:58-165 (same copy-paste pattern)

**T-BILL-I04.** [ACCIDENTAL] The same route path strings are hand-maintained in 7 places. docs/architecture/api-contract-standard.md rule 5 says paths must come from contract constants. The contract also declares an {ok,data} success envelope that the server never emits: handlers return raw bodies and clients parse the raw schemas. The contract is read only by audit scripts.

Evidence:

- main/server/core/src/billing/routes/subscription.ts ('billing/checkout')
- main/shared/src/contracts/contract.billing.ts:62 and :42 (successResponseSchema envelope)
- main/client/api/src/billing/client.ts:151
- main/client/react/src/billing/hooks.ts:191
- main/client/api/src/generated/client.ts:170
- main/apps/web/src/demo/api-routes/routeCoverage.ts:70
- docs/api/billing.md:9
- main/tools/scripts/audit/api-response-sync.ts:220-280 (validates envelope shape that runtime never produces)
- main/shared/src/modules/system/http/response.ts:37-49

**T-BILL-I05.** [ACCIDENTAL] PayPal is not truly a peer provider. Self-serve checkout and plan change always take the provider price id from plans.stripe_price_id: getRequiredPlanPriceId throws 'no Stripe price ID configured', and PayPal sends params.priceId as plan_id. plans.paypal_plan_id is never written: admin createPlan hard-codes null and there is no PayPal sync. Scheduled-downgrade promotion exists only in the Stripe webhook path. Admin grant is Stripe-only. These gaps contradict DIRECTION.md:128 and CLAUDE.md:55 ('Stripe + PayPal both fully verified').

Evidence:

- main/server/core/src/billing/service/support.ts (getRequiredPlanPriceId reads stripePriceId)
- main/server/core/src/billing/paypal/provider.ts:89 (plan_id: params.priceId)
- main/server/core/src/admin/billingService.ts:113-115 (paypalPlanId: null), 35-58 (no provider id params)
- main/server/core/src/billing/webhooks/stripe/events.ts:144-160 (scheduledPlanId promotion) vs webhooks/paypal/events.ts:122-180 (none)
- main/apps/web/src/features/admin/components/GrantSubscriptionCard.tsx:32-34 (filters on stripePriceId)
- main/server/core/src/billing/paypal/provider.ts:75-81 (createSubscription rejects)

**T-BILL-I06.** [DELIBERATE but UNFINISHED] Phase 0 tenant scoping added nullable tenant_id to 3 billing tables and memberships.is_billing_admin. No repository, service, RLS policy or UI uses them: every billing read and write is keyed by user_id. invoices was not given tenant_id at all. customer_mappings UNIQUE(user_id, provider) rules out tenant-level or multi-role customers.

Evidence:

- main/server/db/migrations/0902_billing_tenant_scope.sql:16-18,28-51 (comment: 'Phase 1 will switch')
- main/server/db/src/repositories/billing/*.ts (0 non-test references to tenant)
- main/server/db/migrations/0900_rls.sql:82-96 (user_id policies only)
- main/server/core/src/billing/service/subscriptions.ts:27,46,88,118,154 (findActiveByUserId everywhere)
- main/server/db/migrations/0200_billing.sql:85 (UNIQUE (user_id, provider))

**T-BILL-I07.** [ACCIDENTAL] Usage metering cannot produce meaningful data end to end. (1) Plan feature keys use colons ('projects:limit') but usage_metrics.key CHECK only allows ^[a-z][a-z0-9_]+$, so limits never match metrics. (2) The handler reads the raw x-tenant-id header (not the verified context) and falls back to user.userId as the tenant id. The user hook never sends the header. (3) Limits come from the user's subscription while usage is per tenant. (4) recordUsage, recordUsageWithinLimit and assertWithinUsageLimit have zero production callers. (5) The handler casts ctx.repos to Record<string, unknown> because BillingAppContext omits the metering repos.

Evidence:

- main/server/db/migrations/0404_metering.sql:26
- main/shared/src/constants/core/billing.ts:13-21
- main/server/core/src/billing/usage-metering-handlers.ts:30-43,87-91,123-161
- main/apps/web/src/features/billing/pages/BillingSettingsPage.tsx:121-130 (metricKey -> featureKey)
- main/client/ui/src/components/billing/UsageSummary.tsx:18-27,57
- main/server/core/src/billing/types.ts:168-180
- main/tools/scripts/audit/api-response-sync.ts:235 (sample key 'storage.bytes' would violate the DB CHECK)

**T-BILL-I08.** [ACCIDENTAL] Error handling and HTTP semantics are inconsistent. User billing handlers map errors by matching error.name strings, even though every class already carries its status. Unmapped classes such as CannotDowngradeInTrialError, PaymentMethodValidationError and CheckoutSessionError become 500. Admin billing uses instanceof. 'Billing disabled' returns 500, while the extension uses UnavailableError (503). Route style is mixed: DELETE billing/payment-methods/:id versus POST admin/billing/plans/:id/delete, plus verb-in-path POSTs (plans/create, payment-methods/add).

Evidence:

- main/server/core/src/billing/handlers/support.ts:151-153,159-200
- main/server/core/src/admin/billingHandlers.ts:75-102
- main/shared/src/modules/core/billing/billing.errors.ts:138,177,238,248
- main/extensions/billing/src/server/index.ts.template:38-42
- main/server/core/src/billing/routes/payment-methods.ts
- main/server/core/src/admin/routes.ts:435,478,520

**T-BILL-I09.** [ACCIDENTAL] Name collisions and duplicate symbols for different shapes cross package boundaries.

Evidence:

- UsageMetric: main/client/ui/src/components/billing/UsageSummary.tsx:18 vs main/shared/src/modules/core/usage-metering/usage.metering.ts
- SubscriptionState: main/shared/src/modules/core/billing/billing.entitlements.ts vs main/client/react/src/billing/hooks.ts:352
- BillingClientConfig: main/client/api/src/billing/client.ts:54 (=BaseClientConfig) vs main/client/react/src/billing/hooks.ts:64 (pages import the @bslt/api type and pass it to @bslt/react hooks, BillingSettingsPage.tsx:53,78)
- BillingProvider: main/shared/src/modules/system/config/env.billing.ts:27 vs main/shared/src/modules/core/billing/billing.schemas.ts:40
- hasActiveSubscription: billing.logic.ts:121 (subscription,planId) vs billing.entitlements.ts:197 (entitlements); barrel exports the latter
- getPlanById: main/server/core/src/billing/service/catalog.ts vs main/server/core/src/admin/billingService.ts:84
- formatPlan (billing/handlers/support.ts:63) vs formatAdminPlan (admin/billingHandlers.ts:55)
- deletePaymentMethod (contract.billing.ts:187) vs removePaymentMethod (clients) vs handleRemovePaymentMethod (server)

**T-BILL-I10.** [ACCIDENTAL] Audit and activity use parallel vocabularies for the same events with different tense ('billing.subscription_canceled' vs 'billing.subscription_cancel'). Outbound webhook types use a third spelling ('subscription.cancelled', 'invoice.failed') against BILLING_EVENT_TYPES ('subscription.canceled', 'invoice.payment_failed'). webhooks/shared.ts re-declares BILLING_EVENT_TYPES as a local union.

Evidence:

- main/server/core/src/audit/types.ts:20-26
- main/shared/src/modules/core/activities/activities.types.ts:65-73
- main/shared/src/constants/system/comms.ts:21-25
- main/shared/src/constants/core/billing.ts:84-92
- main/server/core/src/billing/webhooks/shared.ts:23-30

**T-BILL-I11.** [ACCIDENTAL] Logic is duplicated or done twice. Handlers re-read the active subscription that the service reads again (non-transactional). The checkout handler computes a priceId the service ignores. Two transactional repo-bundle builders exist. Admin hard-ban reimplements immediate cancel inline. The provider is constructed per request in 11 call sites while AppContext.billing is never populated.

Evidence:

- main/server/core/src/billing/handlers/subscriptions.ts:95-96,133-135,203-205,266-269
- main/server/core/src/billing/service/support.ts (createTransactionalBillingRepos) vs webhooks/shared.ts (createTransactionalWebhookRepos)
- main/server/core/src/admin/userHandlers.ts:466-478
- main/apps/server/src/bootstrap/context.ts:66,143; app.ts:530,575 (never assigned)
- createBillingProvider callers: billing/handlers/payment-methods.ts:97,164,227,297; billing/handlers/subscriptions.ts:84,132,202,265; admin/userHandlers.ts:470; admin/billingHandlers.ts:246,325

**T-BILL-I12.** [ACCIDENTAL] DB types omit columns that migrations add. version (0700) is missing from the Plan, Subscription, Invoice and PaymentMethod TS types and repos. 0700 calls customer_mappings append-only, yet 0902 UPDATEs it.

Evidence:

- main/server/db/migrations/0700_realtime_versions.sql:17,67-77
- main/server/db/src/schema/billing.ts:69-85,136-153,230-246,290-301
- main/server/db/migrations/0902_billing_tenant_scope.sql:155-181

**T-BILL-I13.** [DELIBERATE, documented] Gating is spread across 5 independent switches that are not linked: server env (config.billing.enabled), web env (VITE_ENABLE_BILLING), Core/Pro edition export, the installable Stripe-only extension, and the storefront feature pack. Runtime profiles are package-granular and cannot gate billing, because billing lives inside @bslt/core. starter:prune explicitly excludes billing.

Evidence:

- main/server/system/src/config/services/billing.ts:59-62
- main/apps/web/src/app/capabilities.ts:25
- main/apps/server/src/bootstrap/generated/profile.generated.ts (capabilities: comms|core|db|media|realtime|storage|system|workers)
- main/editions/catalog.ts:28,42,69,113
- docs/dev/prune.md:89

**T-BILL-I14.** [DELIBERATE but costly] The Core edition and the installable extension are a third billing implementation with a different API (overview/checkout/cancel/resume/plans/import), different plan-id scheme (randomUUID vs slug from createPlanId) and a generic createFeatureClient. The Core export removes billing by exact-string patches to router.ts, so any refactor of the wiring silently breaks the export. The activities prune manifest likewise splices literal billing handler code.

Evidence:

- main/extensions/billing/src/server/index.ts.template:318-393
- main/extensions/billing/src/web/index.tsx.template:2,41-141
- main/server/core/src/admin/billingService.ts:63
- main/tools/scripts/editions/export.ts:292-311
- main/tools/scripts/starter/prune-manifests-features.ts:117-184

**T-BILL-I15.** [ACCIDENTAL] Scheduling is split. Trial expiry runs on the per-replica setInterval registry and mutates status locally from payment-method presence, overriding provider truth. It also uses findByUserId+some(isDefault) instead of the dedicated findDefaultByUserId. Usage snapshot runs on the leader-elected cron.

Evidence:

- main/server/workers/src/service.ts:107-134,136-138
- main/server/workers/src/scheduler/register.ts:42-63
- main/server/db/src/repositories/billing/payment-methods.ts (findDefaultByUserId unused)

**T-BILL-I16.** [ACCIDENTAL] Layout is asymmetric. Stripe is a single 588-line root file. PayPal is a 6-file subfolder. Webhook verification lives inside the Stripe provider but in paypal/webhooks.ts for PayPal. stripe/events.ts (431 lines) and paypal/events.ts (448 lines) define the same handler set in parallel, rather than provider normalizers feeding provider-agnostic handlers. billing/index.ts has empty section headers.

Evidence:

- main/server/core/src/billing/stripe-provider.ts
- main/server/core/src/billing/paypal/
- main/server/core/src/billing/webhooks/stripe/events.ts:34-399
- main/server/core/src/billing/webhooks/paypal/events.ts:44-422
- main/server/core/src/billing/index.ts:77-80

**T-BILL-I17.** [ACCIDENTAL] Docs overclaim or are stale. api-contract-matrix.md reports contract path mismatches that no longer exist and references a nonexistent billing.contracts.ts. DIRECTION.md marks seat-based and resource-based limits as done, but nothing enforces them: TEAM_MEMBERS appears only in default plan data, and no server code calls resolveEntitlements, assertEntitled or getEntitlements.

Evidence:

- docs/architecture/api-contract-matrix.md:52-69,111
- docs/DIRECTION.md:131
- main/server/core/src/billing/handlers/plans.ts:76

**T-BILL-I18.** [ACCIDENTAL] Test distribution is uneven. Repos and shared logic are heavily unit-tested (db billing tests ~4.7k lines). All 6 billing handler files, all route files, factory.ts, service/payment-methods.ts, service/invoices.ts and usage-metering-handlers.ts are listed as test-pair debt. client/react billing hooks (757 lines) have no tests. PlanChangeDialog, UsageBar, UsageSummary and StripeStatusCard have none.

Evidence:

- main/tools/scripts/audit/test-pairs-debt.json:59,107-108,127-129,213-236

#### T-BILL proposed vertical module tree

```text
main/modules/billing/                      # one workspace package @bslt/billing; subpath exports ./contract ./db ./server ./client ./react ./ui ./web
  module.ts                                 # manifest: id, edition tier, profile capability, env schema, migrations dir, route maps, raw webhook routes, cron jobs, notifier, web routes/nav/settings-tab/admin-surface/command entries. The app shell, Core export and prune read this instead of string-patching router.ts
  contract/                                 # isomorphic, client-safe
    enums.ts                                # SINGLE source: providers, plan intervals, subscription/invoice statuses, payment-method types, domain event names. A generator/check asserts SQL enums match (fixes 0200 vs constants drift)
    schemas.ts                              # request/response DTOs (today billing.schemas.ts + billing.admin.schemas.ts)
    endpoints.ts                            # method+path+schemas: the ONLY place paths live. Server routes, typed client and docs derive from it. Drop the {ok,data} envelope or adopt it everywhere
    errors.ts                               # AppError subclasses; HTTP status comes from the class (removes the string-name tables)
    logic/{proration.ts, plan-change.ts, entitlements.ts, display.ts, form.ts}   # merge billing.logic + billing.entitlements into one entitlement model keyed by metric/feature keys that satisfy the DB key format
    defaults.ts                             # ONE default catalog (replaces 3 copies), also used by a db seed
  db/
    migrations/                             # 0200, 0404, 0902 + a Phase-1 migration (tenant_id NOT NULL incl. invoices, tenant RLS, RLS on usage_snapshots, billing_account table replacing UNIQUE(user_id,provider))
    schema.ts                               # include version columns
    repositories/{plans,subscriptions,billing-accounts,invoices,payment-methods,billing-events,usage-metrics,usage-snapshots}.ts
    index.ts                                # createBillingRepositories(db) used for both request and tx scopes (replaces the 2 tx builders)
  server/
    providers/port.ts                       # BillingService (moved from shared; server-only)
    providers/{stripe/{provider,webhook,mappers}.ts, paypal/{provider,webhook,mappers,api}.ts, mock.ts, disabled.ts, registry.ts}   # symmetric. registry builds ONE instance at boot and injects it via ctx.billing (today unused)
    providers/catalog-sync.ts               # provider-neutral plan->price sync (Stripe AND PayPal; writes provider_price_ids map, not per-provider columns)
    services/{catalog,subscriptions,invoices,payment-methods,usage,entitlements,admin-plans,grants}.ts   # admin plan service folds in here. Hard-ban and data-export call these instead of re-implementing
    webhooks/{pipeline.ts (tx + idempotency + post-commit), handlers/{subscription,invoice,refund,dispute}.ts}   # providers only normalize; scheduled-downgrade promotion written once
    events.ts                               # emits billing.* domain events once; adapters fan out to audit, activities, notifications, outbound webhooks, realtime
    http/{routes.ts, admin-routes.ts, webhook-routes.ts, handlers.ts}   # raw-body webhook routes registered by the module, not by apps/server
    jobs/{usage-snapshot.ts, trial-reconcile.ts, events-retention.ts}   # all on the leader-elected cron
    middleware/require-entitlement.ts       # the missing enforcement hook other modules (media, files, tenants seats) call
    index.ts
  client/
    api.ts                                  # thin typed client generated from contract/endpoints.ts on the shared request factory (CSRF, 401 refresh, x-tenant-id)
    hooks.ts, admin-hooks.ts, query-keys.ts # one set; no private fetch client
  ui/                                       # PricingTable, PlanCard, PlanChangeDialog, SubscriptionStatus, InvoiceList, PaymentMethodCard, UsageMeter (merge UsageSummary/UsageDashboard/UsageBar); TenantUsageOverrideEditor only if an endpoint backs it
  web/
    pages/{PricingPage, BillingSettingsPage, CheckoutSuccessPage, CheckoutCancelPage, BillingUnavailablePage}.tsx
    admin/{PlanManagementPage, GrantSubscriptionCard, ProviderStatusCard}.tsx
    stripe/{StripeCardForm, StripeElementsCardForm}.tsx
    routes.ts, nav.ts                       # route, settings-tab, admin-surface, command-palette and notification-route contributions consumed by apps/web
  tests/{unit, integration (moved from tests/integration/api/billing*), e2e}
  README.md

Future creator-platform sub-areas (same module, or sibling modules on the same provider port and ledger): payments/ (one-time PPV, tips via payment intents), payouts/ (connected accounts, crypto rails), ledger/ (double-entry balances, refunds, disputes). Today nothing like this exists: no payout, transfer, ledger or one-time payment primitives in server/core/src/billing or shared/.../billing.

PRESERVE through the restructure (good today):
- Provider port with Stripe/PayPal/Mock/Disabled implementations and a factory switch (shared billing.service.types.ts, billing/factory.ts). The mock provider keyed off a mock sk_test secret enables e2e without Stripe.
- Webhook pipeline (webhooks/shared.ts): one DB transaction, idempotency via billing_events UNIQUE(provider, provider_event_id), notifications collected inside the tx and dispatched only after commit.
- BillingNotifier as an edition port (shared/contracts/edition-ports.ts) with branded comms templates and an inline fallback.
- Raw-body capture plugin and signature verification before parsing. Duplicate deliveries map to 200, bad signatures to 400.
- Full-refund vs partial-refund revocation rule (stripe/events.ts:357-376).
- Plan-change direction and proration rules shared by client preview and server (determinePlanChangeDirection, prorationBehaviorForDirection); downgrades scheduled at period end.
- Shared request schemas used at the server route boundary AND before the client sends (routes/subscription.ts, client.ts).
- Route slicing with scoped route helpers (billing/routes/*.ts, createScopedRouteHelpers).
- Repository layer on the SQL builder with cursor pagination and extensive real-DB tests.
- 0902 migration hygiene: idempotent guards, a backfill decision audit table, and a single-source SQL helper for the backfill rule.
- Generated route manifest and API docs (client/api/src/generated/client.ts, docs/api/billing.md).
- Web: Stripe SDK lazy-loaded, billing excluded from persisted query cache, billing routes registered before settings/:tab, graceful BillingUnavailablePage.
- Config validation that requires the webhook secret in production (server/system config/services/billing.ts:147-156).
- Membership-verified x-tenant-id in contextualizeRequest (apps/server/src/bootstrap/context.ts:268-297), the right hook for tenant-scoped billing.
```

#### T-BILL cross-feature links

- Notifications (linked): handlers write in-app notifications via tryNotification (billing/handlers/support.ts:55-61). Webhook dunning goes through BillingNotifier -> payment-notifications.ts -> comms templates (server/comms/src/email/templates/templates.ts:839-942), wired in apps/server/src/bootstrap/phases/comms.ts. Web maps billing notifications to /settings/billing (getNotificationRoute.ts:23,42). Gap: the webhook-originated subscription-created event produces no in-app notification.
- Audit (partially linked): only user-initiated actions (cancel/resume/plan change/payment method) are audited, best-effort and fire-and-forget. Provider-originated changes are never audited: subscription created, payment failed, refunds, chargebacks, revocations. 'billing.subscription_created' is declared (audit/types.ts:22) but never recorded. Admin plan CRUD and grant need verification separately.
- Activities (partially linked): user actions log ACTIVITY_TYPES.BILLING_*. BILLING_SUBSCRIPTION_CREATE, BILLING_PAYMENT_SUCCESS and BILLING_PAYMENT_FAILED are defined and labelled in ActivityFeed.tsx:36-43 but never emitted. The activities prune manifest text-splices billing handlers (prune-manifests-features.ts:117-184).
- Outbound webhooks (NOT linked): WEBHOOK_EVENT_TYPES declares subscription.created/updated/cancelled and invoice.paid/failed (shared/src/constants/system/comms.ts:21-25), but only tenants/handlers/members.ts calls emitWebhookEvent. Billing never emits, so tenants cannot subscribe to billing events.
- Realtime (NOT linked): 0700 adds version columns to plans/subscriptions/invoices/payment_methods/usage_snapshots for realtime sync. The billing code never publishes, and the TS types omit version.
- Jobs/workers (linked, split): hourly leader-elected usage-snapshot cron (scheduler/register.ts:48-63). Hourly per-replica trial-expiry interval task (service.ts:107-134). Daily billing-events cleanup at 90 days (service.ts:206-216), which also deletes the idempotency records.
- Admin (linked but scattered): plan CRUD, Stripe sync, Stripe status and grant live in server/core/src/admin/billing*.ts and admin/routes.ts, not in the billing module. AdminDashboardPage shows plan counts. UserDetailPage hosts GrantSubscriptionCard. Hard-ban cancels subscriptions inline (admin/userHandlers.ts:466-478). There is no PayPal admin surface and no subscription, invoice or revenue admin views (AdminBillingStats schema exists but is unused).
- Tenants (NOT linked in practice): tenant_id phase-0 columns, an is_billing_admin endpoint (tenants/routes.ts:223) and a client method (client/api/src/workspace/client.ts:146-151), and personal tenants default isBillingAdmin=true (auth/personal-tenant.ts:92). Billing ignores all of it: user-scoped reads, no billing-admin authorization check, no web UI for the flag.
- Feature flags (NOT linked): tenant_feature_overrides and plan features are separate systems. 0403_feature_flags.sql:10 even cites 'billing.seat_based' as an example flag key, yet nothing ties flags to plans.
- Media/files/entitlements (NOT linked): server/media/src/facade.ts:159-176 can gate media:processing and media:max_file_size on entitlements, but no caller passes entitlements. resolveEntitlements, assertEntitled and getEntitlements in shared have zero non-test consumers.
- Compliance (partially linked): data export includes subscriptions only, not invoices or payment methods (compliance/data-export/service.ts:129,194-199). Account deletion blocks on active subscriptions or unpaid invoices (users/data-hygiene.ts:345-367) and deletes customer mappings (deleteByUserId).
- Auth/security (linked): billing protected routes run authGuard -> contextualizeRequest (membership-verified tenant) -> ToS gate (apps/server/src/http/router.ts:55-68). CSRF applies to mutations (middleware/csrf.test.ts). Webhook routes are public raw Fastify endpoints outside the route map, so they are absent from the generated manifest, OpenAPI docs and route-coverage audits.
- Editions/storefront (deliberately separate): the Core edition strips billing (tools/scripts/editions/export.ts). extensions/billing re-adds a Stripe-only variant. apps/storefront has its own Stripe SDK integration (src/commerce.ts:2) with no @bslt dependencies, documented in docs/deploy/storefront.md.
- Health: runtime/health.ts:326 reports the active billing provider.

#### T-BILL dead ends

- Usage recording: recordUsage, recordUsageWithinLimit and assertWithinUsageLimit (server/core/src/billing/usage-metering.ts) have zero production callers. Nothing writes usage, so the hourly snapshot and GET /api/billing/usage aggregate nothing. usage_metrics has no seed rows.
- Entitlement engines: shared billing.entitlements.ts (resolveEntitlements, isEntitled, assertEntitled, assertWithinLimit) and billing.logic.ts (getEntitlements, hasFeature, isOverLimit, getFeatureValue, getEffectivePlan, canCancelSubscription, canResumeSubscription, isSubscriptionActive/PastDue/Inactive) have no non-test consumers. MediaEntitlements is never supplied.
- plans.paypal_plan_id plus PlanRepository.findByPaypalPlanId: the column is never written and the method never called.
- Tenant scoping: subscriptions/customer_mappings/payment_methods.tenant_id, idx_*_tenant indexes, billing_resolve_primary_tenant() and memberships.is_billing_admin (with its PATCH endpoint and client method) have no effect on billing. No web UI calls updateMemberBillingAdmin.
- AppContext.billing (apps/server/src/bootstrap/context.ts:66,143; app.ts:530,575) is never assigned. HasBilling.billing is typed unknown (shared/src/contracts/context.ts:75-76).
- config.billing.plans (PLAN_FREE_ID/PLAN_PRO_ID/PLAN_ENTERPRISE_ID) is loaded in server/system/src/config/services/billing.ts:88-95 and never read. PLAN_FEES is used only by the unused getEntitlements.
- @bslt/api createBillingClient (client/api/src/billing/client.ts, 286 lines, 1027-line test) has no runtime consumer. The React hooks use a private copy.
- Outbound webhook billing event types (shared/src/constants/system/comms.ts:21-25) are never emitted.
- Activity types BILLING_SUBSCRIPTION_CREATE, BILLING_PAYMENT_SUCCESS and BILLING_PAYMENT_FAILED, and audit action 'billing.subscription_created', are declared but never recorded.
- client/ui TenantUsageOverrideEditor (240 lines + 178-line test): no backend endpoint and not exported from client/ui/src/index.ts. UsageDashboard (207 lines) is exported only from components/index.ts and used nowhere.
- Unused repository methods (no non-test callers): billingEvents.findByProviderEventId and listByType, invoices.updateByProviderInvoiceId, paymentMethods.clearDefaultForUser, deleteByProviderPaymentMethodId, findByProviderPaymentMethodId and findDefaultByUserId (its 'hot path' index idx_payment_methods_user_default serves no query), plans.activate, existsByName, findByPaypalPlanId and findByStripePriceId (the latter used only by the extension template), subscriptions.findPastDue and updateByProviderSubscriptionId.
- AdminBillingStats/adminBillingStatsSchema and adminPlanSchema (shared billing.admin.schemas.ts) have no consumers.
- Web: the @billing path alias (apps/web/vite.config.ts:250, tsconfig.json:30-31) is never imported. features/billing/pages/index.ts duplicates features/billing/index.ts and is never imported.
- plan_interval 'lifetime' (0200_billing.sql:12) cannot be produced or parsed by TS (PLAN_INTERVALS month|year). payment_method_type crypto/other/bank_transfer are unreachable from TS.
- billing_tenant_backfill_audit table: written once by 0902, with no tooling or UI to review it.
- Empty 'Subscription Lifecycle' and 'Middleware' sections in server/core/src/billing/index.ts:77-80.

#### T-BILL must remain shared

- Contract layer that both server and browser import (contract/enums, DTO schemas, endpoint definitions, error classes with codes, pure proration/plan-change/display/form helpers). It can live in the billing module's isomorphic ./contract subpath, but it must stay importable from client/* without pulling server code.
- Schema primitives and branded ids (@bslt/shared/schema: createSchema, createEnumSchema, PlanId/SubscriptionId/UserId) and AppError base classes (@bslt/shared/system errors).
- HTTP route infrastructure: createScopedRouteHelpers, registerRouteMap, RouteDefinition, emptyBodySchema (@bslt/server-system/http).
- DB infrastructure: RawDb and transaction, the SQL builder, toCamelCase/toSnakeCase/parseJsonb, cursor pagination, the migration runner and global numbering, and RLS session-variable plumbing (server/db/src/client.ts).
- Request contextualization and tenancy (contextualizeRequest membership check, app_current_user_id()/app_current_tenant_id() SQL helpers from 0901), plus the auth guard, ToS gate, CSRF and the raw-body plugin.
- Cross-cutting sinks billing emits into: audit record(), logActivity, NotificationRepository, emitWebhookEvent, realtime pubsub. Billing should depend on these through a domain-event port, not own them.
- Edition ports (shared/src/contracts/edition-ports.ts: BillingNotifier, PendingBillingNotification) and the comms email-template registry that implements the dunning templates.
- Config/env loading framework (server/system config factory, env.validation). The billing env schema itself can move into the module and register with it.
- Client request factory (client/api/src/utils.ts: CSRF cache, refresh-on-401 default, x-tenant-id) and the query engine (client/react useQuery/useMutation, QueryKey), so billing stops shipping its own fetch layer.
- UI primitives and styling (@bslt/ui elements Button/Card/Alert/Input, cn, components.css). Billing-specific composite components can move into the module.
- Cron scheduler (leader-elected) and the worker task registry interfaces in server/workers.
- Entitlement resolution as a cross-module capability (a requireEntitlement port consumed by media, files, tenants seats, and later creator content gating), owned by billing but exposed via a shared interface so other modules don't import billing internals.
- Codegen/audit tooling (route manifest, generate-api-docs, editions export, prune). These should read the billing module manifest instead of hard-coded file paths and text anchors.

### C.AUTH. Authentication & Account (registration, login, sessions/refresh tokens, MFA [TOTP/backup codes/SMS], passkeys, OAuth, magic-link/email-OTP, sudo, ToS gate, account settings, profile/username/avatar, devices, phone, API keys, account deactivation/deletion/anonymization). Size: ~46k non-test LOC (core/auth 15.8k, core/users 3.3k, core/api-keys 0.3k, shared auth+users+api-keys+contracts ~5.1k, db schema+repos 3.0k, migrations 0.6k, client/api 1.8k, client/react 0.8k, client/ui 0.5k, web/auth 5.6k, web/settings 9.4k) and ~54k test LOC (web/settings tests alone 15.2k; tests/integration auth-related 13.5k). The feature is functionally deep and security-hardened, but it is split across 3 server modules (auth, users, api-keys) plus compliance/consent, reaches the DB through both repositories and raw SQL, and reaches the browser through 5 different client-access patterns.

- **Packages touched:** 14
- **Total files:** 550
- **Wiring points:** 27

#### T-AUTH per-layer file list

**1. SQL migrations (main/server/db/migrations)** (12 files)

- `main/server/db/migrations/0000_users.sql (users, refresh_tokens, login_attempts, auth_tokens, security_events)`
- `main/server/db/migrations/0001_auth_extensions.sql (totp_backup_codes, sms_verification_codes, webauthn_credentials, trusted_devices)`
- `main/server/db/migrations/0002_sessions.sql (user_sessions, oauth_connections, oauth_provider enum)`
- `main/server/db/migrations/0700_realtime_versions.sql (partial: version cols on webauthn_credentials/trusted_devices/user_sessions/oauth_connections, lines 31-45)`
- `main/server/db/migrations/0701_user_locale.sql`
- `main/server/db/migrations/0900_rls.sql (partial: auth tables lines 29-36, policies ~107-130)`
- `main/server/db/migrations/0903_oauth_provider_kakao.sql`
- `main/server/db/migrations/0905_users_language_freeform.sql (reverts 0701)`
- `main/server/db/migrations/0906_refresh_token_rotated_at.sql`
- `main/server/db/migrations/0908_email_otp.sql`
- `main/server/db/migrations/0909_api_keys.sql`
- `main/server/db/migrations/0916_user_eligibility_attestation.sql`

**2. server/db schema types + DB wiring** (10 files)

- `main/server/db/src/schema/{users,auth,sessions,oauth,trusted-devices,api-keys}.ts`
- `main/server/db/src/schema/index.ts`
- `main/server/db/src/index.ts`
- `main/server/db/src/factory.ts (Repositories interface lines 118-160, createRepositories 213-255)`
- `main/server/db/src/validation.ts (REQUIRED_TABLES)`

**3. server/db repositories** (17 files)

- `main/server/db/src/repositories/auth/{auth-tokens,login-attempts,refresh-tokens,security-events,totp-backup-codes,trusted-devices,webauthn-credentials,index}.ts`
- `main/server/db/src/repositories/users/{users,index}.ts`
- `main/server/db/src/repositories/sessions/{user-sessions,index}.ts`
- `main/server/db/src/repositories/oauth/{oauth-connections,index}.ts`
- `main/server/db/src/repositories/api-keys/{api-keys,index}.ts`
- `main/server/db/src/repositories/index.ts`

**4. server/core auth module (96 non-test files)** (96 files)

- `main/server/core/src/auth/{index,routes,service,types,results,errors,middleware,liveness-cache,attestation,consented-user,email-change,email-templates,personal-tenant,tos-gating,totp,totp-secret}.ts`
- `main/server/core/src/auth/routes/{account,factors,helpers,password,session,verification}.ts`
- `main/server/core/src/auth/handlers/{index,devices,email-change,invalidate-sessions,login,logout,logout-all,password,phone,refresh,register,sms-challenge,strategies,sudo,tos,totp,verify,webauthn}.ts`
- `main/server/core/src/auth/magic-link/{index,handlers,routes,service}.ts`
- `main/server/core/src/auth/oauth/{index,handlers,routes,service,state,refresh,provider-client,token-crypto,types}.ts`
- `main/server/core/src/auth/oauth/providers/{index,apple,github,google,kakao}.ts`
- `main/server/core/src/auth/otp/{index,handlers,routes,service}.ts`
- `main/server/core/src/auth/webauthn/{index,routes,service}.ts`
- `main/server/core/src/auth/sms-2fa/{index,rate-limit,service,types}.ts`
- `main/server/core/src/auth/password/service.ts`
- `main/server/core/src/auth/verification/service.ts`
- `main/server/core/src/auth/support/email.ts`
- `main/server/core/src/auth/security/{index,captcha,device-fingerprint,lockout,rateLimitPresets,totp-challenge-guard,types}.ts`
- `main/server/core/src/auth/security/events/{index,alerts,core,magic-link,oauth,otp,standard,types}.ts`
- `main/server/core/src/auth/utils/{index,cookies,crypto,jwt,password,refresh-token,response,user-agent,username}.ts`

**5. server/core users module (account/profile/sessions/lifecycle/retention)** (17 files)

- `main/server/core/src/users/{index,routes,service,types,errors,cache,data-hygiene,pii-anonymization,unverified-cleanup}.ts`
- `main/server/core/src/users/handlers/{index,account,avatar,lifecycle,profile,profile-completeness,sessions,username}.ts`

**6. server/core api-keys module + core registry** (6 files)

- `main/server/core/src/api-keys/{index,routes,handlers,service,types}.ts`
- `main/server/core/src/route-modules.ts`

**7. Other server packages touched** (10 files)

- `main/server/system/src/config/auth/ (4 src: AUTH_STRATEGIES parsing auth.ts:76, jwt, rate-limit)`
- `main/server/workers/src/{service,pii-anonymization,hard-ban-anonymization}.ts`
- `main/server/comms/src/email/templates/templates.ts (branded auth templates)`
- `main/server/comms/src/sms/ (SMS provider for phone/SMS-2FA)`
- `main/server/realtime/src/websocket/lifecycle.ts (injected verifyToken, line 437)`

**8. apps/server composition root** (9 files)

- `main/apps/server/src/http/auth-route-overrides.ts`
- `main/apps/server/src/http/route-modules.ts`
- `main/apps/server/src/http/router.ts (auth guard chain + TOS_EXEMPT_PATHS)`
- `main/apps/server/src/bootstrap/context.ts`
- `main/apps/server/src/bootstrap/system.ts`
- `main/apps/server/src/bootstrap/phases/comms.ts`
- `main/apps/server/src/bootstrap/phases/retention.ts`
- `main/apps/server/src/middleware/csrf.ts`
- `main/apps/server/src/types/fastify.d.ts`

**9. shared contracts/schemas/constants** (43 files)

- `main/shared/src/modules/core/auth/{index,roles,auth.core.schemas,auth.devices.schemas,auth.email.schemas,auth.helpers.logic,auth.magic.link.schemas,auth.mfa.schemas,auth.oauth.schemas,auth.otp.schemas,auth.passkey.schemas,auth.policy,auth.session.logic,auth.sessions.logic,auth.sessions.schemas,auth.tos.schemas,auth.webauth.schemas}.ts`
- `main/shared/src/modules/core/auth/passwords/{index,auth.password,auth.password.patterns,auth.password.scoring,auth.password.strength}.ts`
- `main/shared/src/modules/core/users/{index,attestation.policy,lifecycle.logic,lifecycle.schemas,username.schemas,users.permissions,users.roles,users.schemas}.ts`
- `main/shared/src/modules/core/api-keys/{index,api-keys.schemas}.ts`
- `main/shared/src/contracts/{contract.auth,contract.users,contract.api-keys}.ts`
- `main/shared/src/api/router.ts (apiRouter registers auth/users/apiKeys)`
- `main/shared/src/constants/core/{auth,iam,compliance}.ts`
- `main/shared/src/constants/{config,regex}.ts`
- `main/shared/src/modules/system/config/env.auth.ts`
- `main/shared/src/modules/core/schemas.ts (usernameSchema/phone/name primitives)`

**10. client/api** (16 files)

- `main/client/api/src/api/{client,features,index,instance,login-response,types}.ts (client.ts = ~1.1k LOC ApiClient god object)`
- `main/client/api/src/settings/{client,index}.ts`
- `main/client/api/src/devices/{client,index}.ts`
- `main/client/api/src/phone/{client,index}.ts`
- `main/client/api/src/api-keys/{client,index}.ts`
- `main/client/api/src/generated/client.ts (generated route defs)`
- `main/client/api/src/index.ts`

**11. client/react** (9 files)

- `main/client/react/src/devices/{hooks,index}.ts`
- `main/client/react/src/oauth/{hooks,index}.ts`
- `main/client/react/src/phone/{hooks,index}.ts`
- `main/client/react/src/hooks/{useAuthModeNavigation,useResendCooldown}.ts`
- `main/client/react/src/index.ts`

**12. client/ui + client/engine** (8 files)

- `main/client/ui/src/elements/{Avatar,PasswordInput,OAuthButton}.tsx`
- `main/client/ui/src/components/{SessionCard,AuthForm}.tsx`
- `main/client/ui/src/layouts/containers/AuthLayout.tsx`
- `main/client/ui/src/layouts/layers/ProtectedRoute.tsx`
- `main/client/engine/src/storage/userScopedStorage.ts`

**13. apps/web features/auth** (38 files)

- `main/apps/web/src/features/auth/{index,authModalStore}.ts`
- `main/apps/web/src/features/auth/components/{AccountLockedMessage,AuthForms,AuthModal,EmailOtpForm,ForgotPasswordForm,LoginForm,MagicLinkForm,NewDeviceBanner,OAuthButtons,OAuthProviderIcons,PasskeyLoginButton,RegisterForm,ResetPasswordForm,SmsChallenge,TosAcceptanceModal,TurnstileWidget}.tsx + components/index.ts`
- `main/apps/web/src/features/auth/hooks/{index,useAuth,useAuthMutations,useWebauthn}.ts`
- `main/apps/web/src/features/auth/pages/{AuthModalRoute,ConfirmEmailChangePage,ConfirmEmailPage,ConnectedAccountsPage,MagicLinkVerifyPage,ReactivatePromptPage,ResetPasswordPage,RevertEmailChangePage}.tsx + pages/index.ts`
- `main/apps/web/src/features/auth/services/{AuthService,authHelpers,index}.ts`
- `main/apps/web/src/features/auth/utils/{attestation,index,redirects}.ts`

**14. apps/web features/settings (account settings modal; ~10 of these are compliance/notification sections hosted here)** (54 files)

- `main/apps/web/src/features/settings/{index,accountModalStore,settingsTabs}.ts`
- `main/apps/web/src/features/settings/components/{AccountModal,ApiKeysSection,AvatarUpload,BackupCodesDisplay,ConsentPreferences,CookieConsentBanner,DangerZone,DataControlsSection,DataExportSection,DeletionStatusIndicator,DevicesList,DoNotSellControl,EmailChangeForm,ForgotPasswordShortcut,LanguageSelector,LegalDocumentsSection,NotificationPreferencesForm,OAuthConnectionsList,PasskeyManagement,PasswordChangeForm,PasswordSetupForm,PhoneManagement,PreferencesSection,ProfileCompleteness,ProfileForm,SessionCard,SessionsList,SudoModal,TotpManagement,TotpQrCode,UsernameForm}.tsx + AccountModal.css + components/index.ts`
- `main/apps/web/src/features/settings/hooks/{index,useAccountLifecycle,useApiKeys,useAvatarUpload,useBackupCodes,useConsent,useDataExport,usePasswordChange,useProfile,useProfileCompleteness,useSessions,useSudo,useTotpManagement,useUsername}.ts`
- `main/apps/web/src/features/settings/pages/{AccountModalRoute.tsx,index.ts}`
- `main/apps/web/src/features/settings/utils/{phoneFormatting,profileOptions}.ts`

**15. apps/web shell, routes, gating, profile stub** (9 files)

- `main/apps/web/src/features/profile/{index,queryKeys}.ts (5 LOC total)`
- `main/apps/web/src/app/routes.tsx (auth pages 440-482, advancedAuthRoutes 257-266, settings modal 485)`
- `main/apps/web/src/app/capabilities.ts (isAdvancedAuthEnabled:41)`
- `main/apps/web/src/app/ClientEnvironment.tsx`
- `main/apps/web/src/app/App.tsx`
- `main/apps/web/src/app/authToken.ts`
- `main/apps/web/src/app/tosHandler.ts`
- `main/apps/web/src/app/starterSurface.ts`
- `main/apps/web/src/app/siteMap.ts`

**16. Editions / extensions / tools / env gating** (11 files)

- `main/editions/catalog.ts (CORE_SERVER_MODULES auth/users/api-keys; CORE_API_MODULES api/api-keys/devices/phone/settings/generated)`
- `main/extensions/account-insights/{feature.json,src/server/index.ts.template,src/web/index.tsx.template}`
- `main/tools/scripts/recipes/registry.ts (advanced-auth recipe: VITE_ENABLE_ADVANCED_AUTH + AUTH_STRATEGIES)`
- `main/tools/scripts/audit/{route-contract-coverage,api-client-sync,api-response-sync,starter-defaults}.ts`
- `main/tools/scripts/api/generate-client.ts`
- `config/env/.env.local.example (AUTH_STRATEGIES line 47, VITE_ENABLE_ADVANCED_AUTH line 34)`

**17. Colocated unit tests** (133 files)

- `main/server/db/src/repositories/{auth/*7,users,sessions,oauth,api-keys}/*.test.ts (11)`
- `main/server/core/src/auth/**/*.test.ts (21; handlers/ has only totp.test.ts)`
- `main/server/core/src/users/handlers/lifecycle.test.ts (1 of 17 users files tested)`
- `main/server/core/src/api-keys/{handlers,routes,service}.test.ts (3)`
- `main/shared/src/modules/core/{auth (15), users (6), api-keys (1)}/*.test.ts`
- `main/server/system/src/config/auth/{auth,jwt,rate-limit}.test.ts (3)`
- `main/client/api/src/{api (4), settings, devices, phone, api-keys}/*.test.ts (8)`
- `main/client/react/src/oauth/hooks.test.ts (1; devices & phone hooks untested)`
- `main/apps/web/src/features/auth/**/*.test.ts(x) (24)`
- `main/apps/web/src/features/settings/**/*.test.ts(x) (39)`

**18. Integration + e2e tests (tests/)** (45 files)

- `tests/integration/api/{account-lifecycle.real-db,admin-user-mgmt.real-db,api-keys.integration,api-keys.real-db,auth.integration,auth.real-db,login-failure.integration,sessions.integration,sessions.real-db,tos-gating.real-db,tos.integration,tos.real-db,user-management.integration,users-settings.real-db,webauthn-passkeys.real-db,webauthn.integration,websocket-auth.integration}.test.ts`
- `tests/integration/auth/{handlers,login-edge-cases,session-binding}.test.ts`
- `tests/integration/web/{auth-flow,auth-modal,auth-page}.test.tsx`
- `tests/e2e/specs/auth/{auth-forms,auth-pages,auth-strategies,auth,email-otp,login-totp,magic-link,oauth,passkey-login,resend-verification,sms-2fa,token-refresh}.e2e.ts`
- `tests/e2e/specs/account/{account,compliance-data-rights,compliance,settings,tos}.e2e.ts`
- `tests/e2e/specs/admin/sessions.e2e.ts`
- `tests/e2e/specs/system/device-detection.e2e.ts`
- `tests/e2e/fixtures/{auth-contracts,auth,oauth-mock,user-factory}.ts`

**19. Docs** (7 files)

- `docs/api/auth.md (generated, 63 endpoints)`
- `docs/api/users.md (generated)`
- `docs/api/apiKeys.md (generated)`
- `docs/specs/auth.md`
- `docs/user-flows.md`
- `docs/DIRECTION.md (status rows 93-118, surface table line 57)`
- `docs/dev/module-creation.md`

#### T-AUTH wiring points

- `main/server/db/src/factory.ts`: Repositories interface (lines 118-160) + createRepositories (213-255): users, refreshTokens, authTokens, loginAttempts, securityEvents, totpBackupCodes, trustedDevices, webauthnCredentials, oauthConnections, userSessions, apiKeys
- `main/server/db/src/repositories/index.ts`: Barrel for all repo factories/types (auth, oauth, sessions, users, api-keys)
- `main/server/db/src/schema/index.ts + main/server/db/src/index.ts`: Two barrels re-exporting table-name constants, column maps and row types (e.g. SMS_VERIFICATION_CODES_TABLE at index.ts:107)
- `main/server/db/src/validation.ts`: REQUIRED_TABLES startup schema check (lists auth tables lines 20-32; api_keys missing)
- `main/server/core/src/auth/routes.ts`: Aggregates 9 auth route slices: session, account, password, verification, factors, magic-link, otp, oauth, webauthn
- `main/server/core/src/route-modules.ts`: coreRouteModuleRegistrations: registers 'auth', 'api-keys', 'users' (plus 'legal','consent','data-export' that also own users/me/* paths)
- `main/apps/server/src/http/auth-route-overrides.ts`: App-level strategy filtering of auth routes (LOCAL_AUTH_ROUTES, magic-link prefix, OAUTH_STRATEGY_KEYS) + OpenAPI overrides for auth/login and users/me
- `main/apps/server/src/http/route-modules.ts`: Swaps core 'auth' and 'users' route maps for the composed/filtered versions; adds realtime/media/system modules
- `main/apps/server/src/http/router.ts`: createAppAuthGuardFactory: createAuthGuard (JWT/API key + liveness) -> contextualizeRequest (RLS SET LOCAL) -> ToS gate; TOS_EXEMPT_PATHS list
- `main/server/core/src/auth/middleware.ts`: resolveAuthPayload: JWT first, then bslt_ API key via api-keys/service.authenticateApiKey; liveness cache check
- `main/apps/server/src/bootstrap/context.ts`: AppContext/InfraContext: email, emailTemplates, sms, storage, cache (stats-only), pubsub; duplicate RequestWithCookies/ReplyWithCookies types
- `main/apps/server/src/bootstrap/phases/comms.ts`: Chooses comms HTML templates vs core plain-text createAuthEmailTemplates fallback; loads optional SMS provider
- `main/apps/server/src/bootstrap/system.ts + phases/retention.ts`: In-process retention sweeps (anonymize, hard-delete, token cleanup, unverified cleanup) when workers capability disabled
- `main/server/workers/src/service.ts`: Scheduled jobs: login-attempts cleanup, user_sessions cleanup, pii-anonymization, hard-ban-anonymization, hard-delete-anonymized, data-hygiene-files
- `main/server/system/src/config/auth/auth.ts`: Parses AUTH_STRATEGIES env (default 'local') into ctx.config.auth.strategies
- `main/shared/src/api/router.ts`: apiRouter registers authContract, usersContract, apiKeysContract
- `main/shared/src/contracts/contract.auth.ts / contract.users.ts / contract.api-keys.ts`: Hand-maintained endpoint contracts (method/path/schemas) mirrored against server route maps by audits
- `main/tools/scripts/audit/route-contract-coverage.ts + api-client-sync.ts + api-response-sync.ts`: Drift gates keeping server routes, contracts and client calls aligned (pnpm audit:api-governance:strict)
- `main/client/api/src/generated/client.ts`: Generated route-definition manifest (pnpm api:generate); typed generic client largely unused
- `main/client/api/src/index.ts + api/instance.ts`: Public barrel; getApiClient() singleton for the ApiClient god object
- `main/client/react/src/index.ts`: Exports useDevices, usePhone, useOAuthConnections, useEnabledOAuthProviders, useEnabledAuthStrategies (lines 206-232)
- `main/apps/web/src/app/routes.tsx`: Auth pages (login/register/reset/confirm/change-email/reactivate), settings modal route, advancedAuthRoutes (magic-link verify, settings/accounts)
- `main/apps/web/src/app/capabilities.ts`: isAdvancedAuthEnabled() from VITE_ENABLE_ADVANCED_AUTH (independent of server AUTH_STRATEGIES)
- `main/apps/web/src/app/ClientEnvironment.tsx + App.tsx + authToken.ts + tosHandler.ts`: AuthService instance, token getter, ToS 403 interception wiring
- `main/apps/web/src/features/settings/components/AccountModal.tsx + settingsTabs.ts`: Mounts every account/security section into settings tabs; tab ids/aliases/deep-link resolution
- `main/apps/web/src/app/starterSurface.ts`: Starter route surface manifest (settings, settings/:tab, auth/magic-link/verify, settings/accounts)
- `main/editions/catalog.ts`: Edition ownership: auth/users/api-keys core server modules; auth/settings/profile core web features; api/api-keys/devices/phone/settings/generated core API modules

#### T-AUTH adding an endpoint

1. Example: add GET /api/users/me/login-history shown as a card in Settings > Security. Paths are written in 4+ places by hand and kept consistent only by audits.
2. 1. main/shared/src/modules/core/auth/auth.<area>.schemas.ts: request/response interfaces and createSchema parsers (or users/users.schemas.ts if the endpoint is account-owned)
3. 2. main/shared/src/modules/core/auth/index.ts: barrel export
4. 3. main/shared/src/modules/core/index.ts: re-export, because contracts import from '../modules/core'
5. 4. main/shared/src/contracts/contract.auth.ts (or contract.users.ts): endpoint def. This is path string #1
6. 5. If new storage is needed: main/server/db/migrations/09NN_<name>.sql, with the RLS policy in the same file (0909 pattern)
7. 6. If new storage is needed: main/server/db/src/schema/<table>.ts + main/server/db/src/schema/index.ts + main/server/db/src/index.ts (3 barrels)
8. 7. If new storage is needed: main/server/db/src/repositories/<area>/<repo>.ts + <area>/index.ts + main/server/db/src/repositories/index.ts
9. 8. If new storage is needed: main/server/db/src/factory.ts (Repositories interface + createRepositories)
10. 9. If new storage is needed: main/server/db/src/validation.ts (REQUIRED_TABLES)
11. 10. main/server/core/src/auth/handlers/<name>.ts + main/server/core/src/auth/handlers/index.ts. For a users/me route, logic is often inlined in main/server/core/src/users/routes.ts instead
12. 11. main/server/core/src/auth/routes/<slice>.ts (or users/routes.ts): route entry with schema + openapi meta. This is path string #2
13. 12. main/server/core/src/auth/index.ts: export the handler or service if the app, admin or tests need it
14. 13. main/apps/server/src/http/auth-route-overrides.ts: only if strategy-gated (LOCAL_AUTH_ROUTES/OAuth filters) or it needs an OpenAPI override
15. 14. main/apps/server/src/http/router.ts: TOS_EXEMPT_PATHS, only if the endpoint must work while the ToS gate is pending
16. 15. main/client/api/src/generated/client.ts: regenerate with pnpm api:generate. This is path string #3
17. 16. main/client/api/src/api/client.ts (ApiClient interface + implementation) OR main/client/api/src/settings/client.ts (SettingsClient). This is path string #4; it must be parsed with the shared response schema or the api-response-sync audit flags it
18. 17. main/client/api/src/index.ts: re-export new types/client
19. 18. Hook: main/apps/web/src/features/settings/hooks/use<Name>.ts + hooks/index.ts (copying the module-level settingsApi ??= createSettingsApi singleton), OR main/client/react/src/<area>/hooks.ts + index.ts + main/client/react/src/index.ts
20. 19. Query key: inline, or main/apps/web/src/features/profile/queryKeys.ts if it hangs off the current-user profile
21. 20. main/apps/web/src/features/settings/components/<Name>.tsx + components/index.ts
22. 21. main/apps/web/src/features/settings/components/AccountModal.tsx: mount the section in the right tab (pass baseUrl/getToken props if the hook lives in client/react)
23. 22. main/apps/web/src/features/settings/settingsTabs.ts: only if adding a tab
24. 23. main/apps/web/src/features/settings/index.ts: export if consumed elsewhere (e.g. DashboardPage uses useSessions)
25. 24. If a page instead of a modal section: main/apps/web/src/app/routes.tsx + main/apps/web/src/app/starterSurface.ts (+ siteMap.ts)
26. 25. docs/api/auth.md or docs/api/users.md: regenerate with pnpm docs:api
27. 26. Tests: shared *.schemas.test.ts, core handler test, client/api client.test.ts, hook test, component test, tests/integration/api/<name>.real-db.test.ts
28. Net: about 14-16 files without new storage and 22-27 with storage, across 6-7 packages, plus 2 regenerated artifacts.

#### T-AUTH inconsistencies

**T-AUTH-I01.** [ACCIDENTAL] Five server modules own the users/me/* URL namespace, so one account page depends on routes registered by auth, users, compliance/data-export, compliance/legal and consent.

Evidence:

- main/server/core/src/users/routes.ts:140-365 (users/me, update, password, avatar, sessions, username, deactivate, delete, reactivate)
- main/server/core/src/auth/routes/account.ts:73-129 (users/me/devices*, users/me/phone*)
- main/server/core/src/auth/webauthn/routes.ts:89-112 (users/me/passkeys*)
- main/server/core/src/compliance/data-export/routes.ts:61-85 (users/me/export*)
- main/server/core/src/compliance/legal/routes.ts:96 (users/me/agreements)
- main/server/core/src/consent/routes.ts:61-67 (users/me/consent*)

**T-AUTH-I02.** [ACCIDENTAL] Removal endpoints mix HTTP verbs and path shapes, and one route doc comment is stale.

Evidence:

- main/server/core/src/api-keys/routes.ts:39 POST api-keys/:id/delete
- main/server/core/src/auth/webauthn/routes.ts:112 DELETE users/me/passkeys/:id/delete
- main/server/core/src/auth/routes/account.ts:95 DELETE users/me/devices/:id; :125 DELETE users/me/phone/delete
- main/server/core/src/users/routes.ts:220 users/me/avatar/delete (client calls it with POST: main/client/api/src/settings/client.ts:83); :265 DELETE users/me/sessions/:id
- main/server/core/src/auth/oauth/routes.ts:107-112 comment says 'DELETE /api/auth/oauth/:provider' but the actual route is DELETE auth/oauth/:provider/unlink (line 93)

**T-AUTH-I03.** [ACCIDENTAL] Inside core/auth, sub-features follow 4 different layouts, so the code for one capability has no predictable home.

Evidence:

- Self-contained handlers+routes+service: main/server/core/src/auth/{magic-link,oauth,otp}/
- Routes+service in a subfolder but handlers in auth/handlers: auth/webauthn/routes.ts imports '../handlers/webauthn'
- Service in a subfolder, handler in auth/handlers, route in auth/routes: auth/sms-2fa/service.ts + handlers/sms-challenge.ts + routes/factors.ts; auth/password/service.ts + handlers/password.ts + routes/password.ts
- Loose top-level files: auth/totp.ts, totp-secret.ts, email-change.ts (handler in handlers/email-change.ts), tos-gating.ts, personal-tenant.ts, attestation.ts, consented-user.ts

**T-AUTH-I04.** [ACCIDENTAL] Repositories are bypassed. 17 core auth/users files issue raw SQL through @bslt/db/builder or db.raw, and several repositories have zero production callers while their tables are written directly.

Evidence:

- SecurityEventRepository: 0 prod call sites; writes go through raw insert in main/server/core/src/auth/security/events/core.ts:11, reads through main/server/core/src/admin/securityService.ts
- TotpBackupCodeRepository: 0 prod call sites; main/server/core/src/auth/totp.ts uses TOTP_BACKUP_CODES_TABLE directly
- LoginAttemptRepository: only .deleteOlderThan in main/server/workers/src/service.ts:147; writes are raw in auth/security/lockout.ts
- UserSessionRepository.create/update never called; sessions are inserted raw in main/server/core/src/auth/utils/refresh-token.ts:83
- sms_verification_codes has no repository at all: raw SQL in auth/sms-2fa/service.ts:93-209, rate-limit.ts:40-73, handlers/phone.ts:123-166
- consent_records written raw in main/server/core/src/auth/consented-user.ts:25; users updated raw in auth/handlers/phone.ts:136,166

**T-AUTH-I05.** [ACCIDENTAL] 'Session' is modelled 3 times. user_sessions.id is implicitly equal to refresh_tokens.family_id (no FK). The Sessions UI reads refresh-token families, while 'Devices' is a third concept (trusted_devices). There are 3 different TS shapes.

Evidence:

- main/server/core/src/auth/utils/refresh-token.ts:83-96 inserts user_sessions with id: familyId
- main/server/db/src/repositories/auth/refresh-tokens.ts:110 LEFT JOIN user_sessions us ON us.id = rt.family_id
- main/server/core/src/users/handlers/sessions.ts:122,161,193 list/revoke via repos.refreshTokens families
- main/shared/src/modules/core/users/users.schemas.ts:173 Session vs main/shared/src/modules/core/auth/auth.sessions.schemas.ts:39 UserSession vs main/server/db/src/schema/sessions.ts:25 UserSession
- Devices are a separate auth-module surface: main/server/core/src/auth/handlers/devices.ts + main/client/react/src/devices/hooks.ts

**T-AUTH-I06.** [ACCIDENTAL] There are three 'sign out everywhere' endpoints. Two are functionally identical; the third does not bump tokenVersion, so access tokens on other devices stay valid until expiry.

Evidence:

- main/server/core/src/auth/handlers/logout-all.ts:45-48 incrementTokenVersion + invalidateLiveness + revokeAllUserTokens + clear cookie
- main/server/core/src/auth/handlers/invalidate-sessions.ts (same 4 calls, different message/error style)
- main/server/core/src/users/routes.ts:299-316 + users/handlers/sessions.ts:186-205 revokeAllSessions revokes families only, with no tokenVersion bump

**T-AUTH-I07.** [ACCIDENTAL] Session issuance is copy-pasted across about 8 login paths, and only password login runs the full post-login pipeline (same-device revoke, max-concurrent-session eviction, trusted-device/new-device alert, personal tenant). The rememberMe session span is honoured only for password login and refresh.

Evidence:

- main/server/core/src/auth/handlers/login.ts:218-273 (revokeOlderSessionsForLoginDevice, maxConcurrentSessions, recordDeviceAccess, ensurePersonalTenant)
- main/server/core/src/auth/handlers/totp.ts:290-310, sms-challenge.ts:183-203, webauthn.ts:190-209 call createRefreshTokenFamily(..., ctx.config.auth.refreshToken.expiryDays) with none of the above
- ensurePersonalTenant only in handlers/login.ts:266, oauth/handlers.ts:383, magic-link/handlers.ts:150 (not otp, webauthn, totp, sms, verify)
- main/server/core/src/auth/service.ts:494-534: the TOTP/SMS challenge JWT carries no span; spanDays only in login.ts:172 and refresh.ts:65
- docs/DIRECTION.md:112 claims the personal tenant is 'auto-created on signup'

**T-AUTH-I08.** [ACCIDENTAL] Username rules disagree across layers: registration accepts any string of 2+ chars, username change requires a lowercase regex plus a reserved list, a third schema allows 1-15 alphanumerics, and auto-generated names cap at 15. Both the regex and the reserved list are duplicated.

Evidence:

- main/shared/src/modules/core/auth/auth.core.schemas.ts:150 registerRequestSchema username parseString min:2 only
- main/shared/src/modules/core/users/username.schemas.ts:43 /^[a-z][a-z0-9_]{1,29}$/ + RESERVED_USERNAMES:16
- main/shared/src/constants/regex.ts:17 same regex; main/apps/web/src/features/settings/components/UsernameForm.tsx:21 same regex again
- main/shared/src/modules/core/schemas.ts:30 USERNAME_REGEX_LOCAL /^[a-zA-Z0-9_]{1,15}$/ (usernameSchema, used by admin)
- RESERVED_USERNAMES duplicated verbatim: main/shared/src/constants/core/iam.ts:57 and username.schemas.ts:16
- main/shared/src/constants/system/limits.ts:31 MAX_USERNAME_LENGTH 15; main/server/core/src/auth/service.ts:93 docstring says 1-15 chars

**T-AUTH-I09.** [ACCIDENTAL, security-relevant] The profile update writes users.phone without resetting phone_verified or using the SMS verification flow, yet SMS 2FA sends codes to users.phone whenever phoneVerified is true. Phone validation is also triplicated.

Evidence:

- main/shared/src/modules/core/users/users.schemas.ts:236-262 updateProfileRequestSchema accepts phone (plain parseString)
- main/server/core/src/users/handlers/account.ts:153 updatePayload['phone'] = data.phone (phone_verified untouched)
- main/apps/web/src/features/settings/components/ProfileForm.tsx:90-99 sends phone via PATCH users/me/update
- main/server/core/src/auth/handlers/sms-challenge.ts:86-89 uses user.phone when phoneVerified === true; dedicated flow at auth/handlers/phone.ts:136
- PHONE_REGEX in main/server/core/src/auth/handlers/phone.ts:33, main/shared/src/modules/core/schemas.ts:86, main/shared/src/constants/regex.ts:21

**T-AUTH-I10.** [ACCIDENTAL] UpdateProfileRequest accepts fields the server ignores or that no UI collects (email, dateOfBirth, gender). This contradicts the 0916 statement that date of birth is not collected.

Evidence:

- main/shared/src/modules/core/users/users.schemas.ts:90-104,247 email: parseOptional(emailSchema), but main/server/core/src/users/handlers/account.ts:140-161 has no email branch (silently dropped)
- dateOfBirth/gender carried through main/server/db/migrations/0000_users.sql:61-62, db/src/schema/users.ts, shared User, handlers, anonymizers, but referenced in apps/web only by tests/fixtures
- main/server/db/migrations/0916_user_eligibility_attestation.sql:21-23 'No date of birth is collected'

**T-AUTH-I11.** [ACCIDENTAL] At least 5 hand-written DB-User to API-User mappers diverge. Login, refresh and OAuth responses null out storage-key avatars, while users/me resolves them, and the OAuth mapper omits lifecycle fields.

Evidence:

- main/server/core/src/auth/utils/response.ts:13-22,129-150 toAuthUser + normalizeNullableUrl (non-URL key becomes null)
- main/server/core/src/users/handlers/profile.ts:68-90 handleMe uses resolveAvatarUrl (users/handlers/avatar.ts:303)
- main/server/core/src/users/handlers/account.ts:76-100 toProfileUser
- main/server/core/src/users/service.ts:95-112
- main/server/core/src/auth/oauth/service.ts:285-300 inline mapping without deactivatedAt/deletedAt

**T-AUTH-I12.** [ACCIDENTAL] OAuth provider and strategy lists exist in 6 places that disagree. facebook and microsoft are valid config values with no implementation and no DB enum value.

Evidence:

- main/server/db/migrations/0002_sessions.sql:13 enum google,github,apple + 0903 adds kakao
- main/shared/src/constants/core/auth.ts:19 OAUTH_PROVIDERS (4)
- main/shared/src/constants/config.ts:15-25 AUTH_STRATEGIES incl. facebook, microsoft
- main/apps/server/src/http/auth-route-overrides.ts:24-31 OAUTH_STRATEGY_KEYS (6)
- main/server/core/src/auth/oauth/routes.ts:38-43 OAUTH_ROUTE_PROVIDERS (4); providers/ has only apple, github, google, kakao
- main/shared/src/contracts/contract.auth.ts:468-624 hand-enumerates 16 provider paths

**T-AUTH-I13.** [PARTLY DELIBERATE] Capability gating is doubled server-side and decoupled client-side. Routes are both removed at app level and re-checked in each handler (about 20 isStrategyEnabled calls). OTP and webauthn are gated only at handler level. The web uses a separate env flag, and LOCAL_AUTH_ROUTES names a route that does not exist.

Evidence:

- main/apps/server/src/http/auth-route-overrides.ts:13-22 LOCAL_AUTH_ROUTES includes 'auth/password/change' (no such route; the real one is users/me/password and stays reachable when 'local' is off)
- isStrategyEnabled in auth/handlers/{login,register,password,verify,webauthn}.ts, otp/handlers.ts:48,102, magic-link/handlers.ts:49,121, oauth/handlers.ts:135
- main/apps/web/src/app/capabilities.ts:41 VITE_ENABLE_ADVANCED_AUTH vs main/server/system/src/config/auth/auth.ts:76 AUTH_STRATEGIES; main/server/core/src/auth/otp/handlers.ts:44-47 comment asks humans to keep them in sync
- GET auth/strategies + useEnabledAuthStrategies exist but only PasskeyLoginButton/PasskeyManagement use them

**T-AUTH-I14.** [ACCIDENTAL; ApiClient size DELIBERATE per DIRECTION god-file policy] Web code reaches the API 5 different ways, response-schema parsing is uneven, and components bypass the hook layer.

Evidence:

- getApiClient() singleton god object main/client/api/src/api/client.ts (ApiClient mixes auth with consent, data export, files, feature flags, impersonation, legal: lines 141-238)
- 8 copies of 'settingsApi ??= createSettingsApi(...)' in apps/web/src/features/settings/hooks/{useSudo,useAccountLifecycle,usePasswordChange,useSessions,useAvatarUpload,useProfileCompleteness,useUsername,useProfile}.ts
- client/react hooks taking clientConfig props: useDevices/usePhone (AccountModal.tsx:214,256 passes baseUrl/getToken)
- Components calling getApiClient directly: settings/components/{EmailChangeForm,PasswordSetupForm,SessionsList,ForgotPasswordShortcut}.tsx, auth/pages/{ConfirmEmailChangePage,RevertEmailChangePage}.tsx
- Shared response schemas referenced 67 times in api/client.ts, 0 in settings/client.ts and api-keys/client.ts (request<T> casts)
- Inline shapes instead of shared types: api/client.ts webauthnRegisterVerify/webauthnLoginVerify Record<string, unknown>, smsSendCode {challengeToken}

**T-AUTH-I15.** [ACCIDENTAL] React hook and query-key placement is split between client/react and apps/web, and the OAuth connections UI is built twice.

Evidence:

- client/react/src/{devices,oauth,phone}/hooks.ts vs apps/web/src/features/settings/hooks/* (sessions, totp, backup codes, api keys, profile) vs apps/web/src/features/auth/hooks/useWebauthn.ts
- Query keys: client/react devicesQueryKeys/oauthQueryKeys; apps/web/src/features/profile/queryKeys.ts; inline ['sessions'] in apps/web/src/features/settings/hooks/useSessions.ts:48
- apps/web/src/features/auth/pages/ConnectedAccountsPage.tsx (284 LOC, route settings/accounts) and apps/web/src/features/settings/components/OAuthConnectionsList.tsx (287 LOC, in AccountModal.tsx:238)
- apps/web/src/features/profile/ contains only queryKeys (5 LOC); profile UI lives in settings

**T-AUTH-I16.** [ACCIDENTAL] Module context types are inconsistent and duplicated, and core modules import each other in cycles.

Evidence:

- main/server/core/src/auth/types.ts:254 AuthModuleDeps uses 'logger' while AppContext:321 uses 'log'; users/types.ts:83 UsersModuleDeps; api-keys/types.ts:9 ApiKeysAppContext (Pick-narrowed)
- RequestWithCookies defined in main/server/core/src/auth/types.ts:291 and again in main/apps/server/src/bootstrap/context.ts:91
- Cycle auth<->users: users/routes.ts, users/handlers/{account,lifecycle,sessions}.ts import '../auth'; auth/utils/index.ts imports '../../users/errors'
- Cycle auth<->api-keys: auth/middleware.ts:16 imports '../api-keys/service'; api-keys/service.ts imports '../auth/utils/crypto'
- Role arg mixes [] and 'user' within the same slice files (auth/routes/account.ts, auth/webauthn/routes.ts)

**T-AUTH-I17.** [ACCIDENTAL, data-protection bug] Account-deletion anonymization exists in 3+ implementations with 2 incompatible output formats. Under the workers profile, soft-deleted users are anonymized to deleted-<16hex>@anonymized.local, which hardDeleteAnonymizedUsers (64-hex pattern) never matches, so they are never purged, and canonical_email and username are left intact.

Evidence:

- main/server/workers/src/pii-anonymization.ts:55-63 email `deleted-${16hex}@anonymized.local`, no canonical_email/username/city/etc.
- main/server/core/src/users/pii-anonymization.ts:113-120 `${sha256(email)}@anonymized.local` + canonical_email + username (used by in-process retention)
- main/server/core/src/users/data-hygiene.ts:162-170 anonymizeUserPII (exported, no prod caller) and :392 ANONYMIZED_EMAIL_PATTERN /^[a-f0-9]{64}@anonymized\.local$/ used by hardDeleteAnonymizedUsers:441
- main/apps/server/src/bootstrap/phases/retention.ts:54-80 inline hard-ban anonymizer (deleted- scheme, no canonical_email) and main/server/workers/src/hard-ban-anonymization.ts:86
- main/server/workers/src/service.ts:228 (anonymizeDeletedUsers) and :285 (hardDeleteAnonymizedUsers) both scheduled

**T-AUTH-I18.** [ACCIDENTAL] There are two parallel audit trails for auth (security_events vs audit_events), and API key create/revoke writes to neither.

Evidence:

- main/server/core/src/auth/security/events/core.ts raw INSERT security_events
- audit/service record() at auth/{service.ts:253,email-change.ts:214,handlers/login.ts:326,password/service.ts:139,magic-link/handlers.ts:173,oauth/handlers.ts:394}, users/handlers/{lifecycle,avatar,account,username}.ts
- main/server/core/src/api-keys/handlers.ts: no record()/logSecurityEvent; keys also need no sudo, have no scopes or tenant, and inherit the user's full role (auth/middleware.ts:75-106)

**T-AUTH-I19.** [ACCIDENTAL] Migrations and TS schema have drifted.

Evidence:

- main/server/db/migrations/0906_refresh_token_rotated_at.sql:16 'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_active ON refresh_tokens (family_id) WHERE rotated_at IS NULL' is a silent no-op because 0000_users.sql:179 already created an index with that name on (user_id, family_id) WHERE family_revoked_at IS NULL
- 0700_realtime_versions.sql:31-45 adds version to webauthn_credentials/trusted_devices/user_sessions/oauth_connections, but main/server/db/src/schema/{auth,trusted-devices,sessions,oauth}.ts types omit it
- main/server/db/src/validation.ts REQUIRED_TABLES has no 'api_keys'
- main/server/db/src/schema/auth.ts:310 '@see 0023_sms_verification.sql' (nonexistent); schema/users.ts:5 mentions Drizzle
- 0701 adds a locale CHECK, 0905 reverts it: users.language means spoken languages while i18n 'locale' is a separate concept

**T-AUTH-I20.** [ACCIDENTAL] Shared-layer duplication and naming drift.

Evidence:

- main/shared/src/modules/core/auth/auth.webauth.schemas.ts vs auth.passkey.schemas.ts (same capability, two files, 'webauth' typo)
- auth.session.logic.ts (span/idle) vs auth.sessions.logic.ts (isSessionActive) side by side
- isModerator(user: User) in main/shared/src/modules/core/users/users.permissions.ts:64 vs isModerator(role: AppRole) in users.roles.ts:23
- Path strings live in 4 places (server route, contract, generated client, hand client), against docs/architecture/api-contract-standard.md rule 5; enforced only by audits

**T-AUTH-I21.** [DELIBERATE, documented] Fragmentation that is intentional and should be judged on purpose rather than treated as debt.

Evidence:

- Route slices: main/server/core/src/auth/routes.ts header ('slices live under auth/routes/*; this file stays as the stable public entrypoint')
- App-local strategy filtering: main/apps/server/src/http/auth-route-overrides.ts header
- Core plain-text email templates as a no-comms fallback: main/server/core/src/auth/email-templates.ts vs main/server/comms/src/email/templates/templates.ts; docs/DIRECTION.md:144
- In-process retention fallback when workers are off: main/apps/server/src/bootstrap/phases/retention.ts:1-11, system.ts:33-45
- Shared DB schema across editions: docs/architecture/core-and-extensions.md 'Database compatibility' (auth uses tenant membership primitives)
- AuthService as the sanctioned web service wrapper: docs/DIRECTION.md:79; god files deferred: docs/DIRECTION.md:390
- Advanced-auth e2e specs mock the API: tests/e2e/fixtures/auth-contracts.ts header; docs/CLAUDE.md 'Remaining'
- SessionCard shim: main/apps/web/src/features/settings/components/SessionCard.tsx re-exports @bslt/ui

**T-AUTH-I22.** [ACCIDENTAL] i18n is effectively unused in auth and settings even though 9 locales ship. Docs also contradict the code.

Evidence:

- useTranslation/useLocale used only in apps/web/src/features/auth/pages/ConnectedAccountsPage.tsx and settings/components/{PreferencesSection,LanguageSelector}.tsx out of ~92 auth+settings source files
- docs/specs/auth.md:102 lists a 'refresh_token_families' table that does not exist (family data is denormalized on refresh_tokens per 0000_users.sql:95-111)
- docs/DIRECTION.md:103 places session management in auth/handlers/devices.ts, but the sessions list is main/server/core/src/users/handlers/sessions.ts
- docs/specs/principles.md:296 references 'pnpm audit:api-contract-sync:strict', which is not a script in package.json (the actual one is audit:api-governance:strict)

#### T-AUTH proposed vertical module tree

```text
main/modules/identity/                      # one owner for auth + account + api-keys
├── module.ts                               # SINGLE manifest: routes, repos, jobs, events, capabilities (strategies), web routes/settings sections, nav, edition tag
├── contracts/                              # isomorphic (was shared/modules/core/{auth,users,api-keys} + shared/contracts/contract.{auth,users,api-keys})
│   ├── endpoints.ts                        # path constants + EndpointDefs; server routes and clients derive paths from here (no hand-copied strings)
│   ├── session.ts  registration.ts  factors.ts  passwordless.ts  oauth.ts  account.ts  api-keys.ts   # schemas + types
│   └── policy/  username.ts (ONE regex + reserved list)  password/  attestation.ts  session-span.ts  roles.ts  phone.ts
├── db/
│   ├── migrations/                         # identity-owned SQL (0000-0002, 0906, 0908, 0909, 0916, folded into a clean baseline at fork time)
│   ├── schema.ts                           # users, credentials, sessions (merge user_sessions into refresh-family table or add FK), auth_tokens, mfa factors, oauth, devices, api_keys, security_events
│   └── repositories/                       # the ONLY SQL path: users, sessions, auth-tokens, mfa (totp+backup+sms+webauthn), oauth-connections, devices, api-keys, security-events, login-attempts
├── server/
│   ├── session/                            # issueSession() pipeline used by EVERY login method: family+session row, span, device/new-device, session cap, audit, emits identity.session.created
│   ├── methods/{password,magic-link,email-otp,oauth/providers,webauthn,totp,sms}/   # each: service.ts handlers.ts routes.ts (one layout)
│   ├── account/{profile,username,avatar,email-change,phone,lifecycle,sudo,tos,sessions,devices}/
│   ├── api-keys/                           # + scopes/tenant binding, audit, sudo on create
│   ├── guards/                             # jwt|api-key resolution, liveness, sudo, ToS gate, strategy gate (one place, not route-filter + handler re-check)
│   ├── retention/                          # ONE anonymizer + hard-delete + unverified cleanup; called by workers job AND in-process sweep
│   ├── dto.ts                              # ONE toUserDto (avatar resolution, lifecycle fields)
│   └── events.ts                           # domain events: user.registered/updated/deleted, session.revoked, factor.changed, api_key.created/revoked
├── client/
│   ├── identity-client.ts                  # one client generated from contracts/endpoints.ts, always schema-parsed
│   └── hooks/                              # useSession/useAuth, useProfile, useSessions, useDevices, usePasskeys, useTotp, usePhone, useOAuthConnections, useApiKeys, useAccountLifecycle + ONE queryKeys.ts
├── web/
│   ├── pages/                              # login, register, reset, verify-email, magic-link, change-email confirm/revert, reactivate
│   ├── settings-sections/                  # Profile, Security (password, email, TOTP, backup codes, passkeys, phone, OAuth), Sessions & Devices, API keys, Danger zone; registered into the settings shell
│   └── components/                         # LoginForm, RegisterForm, SudoModal, ... (i18n keys, not literals)
└── tests/                                  # unit + real-db integration + e2e for identity

Subscribers outside the module react to identity events and are not called inline: audit (records), notifications (in-app + email alerts), webhooks (user.* events, now emitted), realtime (close sockets on session.revoked), tenancy (personal-tenant provisioning on user.registered or first session), analytics (signup/login funnel).

PRESERVE through the restructure (good today): refresh-token family rotation with reuse detection + grace window (main/server/core/src/auth/utils/refresh-token.ts, 0906); tokenVersion + liveness cache revocation (auth/liveness-cache.ts, middleware.ts); hashed-at-rest secrets (auth_tokens.token_hash, api_keys SHA-256 + prefix/last4, totp-secret.ts encryption, oauth/token-crypto.ts); the unified auth_tokens table for reset/verify/email-change/revert/magic/otp; versioned eligibility attestation with a both-or-neither CHECK (0916 + shared/users/attestation.policy.ts), directly reusable for creator-platform age verification; email change with a revert token; sudo mode for destructive actions; composition-root guard order auth -> RLS SET LOCAL -> ToS gate with an explicit exempt list (apps/server/src/http/router.ts); typed route helpers (auth/routes/helpers.ts) and route slices; drift audits (route-contract-coverage, api-client-sync, api-response-sync) and generated docs/route manifest; e2e mocks parsed through shared contracts (tests/e2e/fixtures/auth-contracts.ts); OAuthProvider type single-sourced from shared constants; presentational auth primitives in client/ui (AuthLayout, AuthFormLayout, PasswordInput, OAuthButton, SessionCard); real-DB integration suites (tests/integration/api/*.real-db.test.ts).
```

#### T-AUTH cross-feature links

- Tenancy: personal tenant is provisioned only on password login, OAuth callback and magic-link (main/server/core/src/auth/personal-tenant.ts called from handlers/login.ts:266, oauth/handlers.ts:383, magic-link/handlers.ts:150), not on OTP/passkey/TOTP/SMS/verify paths. editions/catalog.ts marks 'tenants' as PAID while core auth imports tenant/membership repos; core-and-extensions.md documents this entanglement as deliberate.
- Audit: dual trail. security_events is written raw (auth/security/events/core.ts) and read raw by admin (admin/securityService.ts); audit_events is written via audit/service record() from about 16 auth/users call sites. API key create/revoke are not audited.
- Notifications: auth only calls notifyAdmins (admin alerts: login.ts:295,360, service.ts:243 user_signup, password/service.ts:151, users/handlers/lifecycle.ts:187, account.ts). User-facing security alerts are email-only (auth/security/events/alerts.ts), with no in-app notification for new device, password change or session revocation.
- Webhooks: USER_CREATED/USER_UPDATED/USER_DELETED are declared and subscribable (main/shared/src/constants/system/comms.ts:12-15) but never emitted; emitWebhookEvent is only called from tenants/handlers/members.ts and is tenant-scoped (webhooks/emit.ts:60), while users are global. This is a broken link.
- Realtime: websocket auth uses an injected JWT-only verifyToken (main/server/realtime/src/websocket/lifecycle.ts:437) with no tokenVersion/lock liveness check and no API keys. Logout-all and session revoke do not publish to pubsub (AppContext.pubsub is typed 'unknown' and unused in auth/types.ts:335), so open sockets survive revocation.
- Jobs/workers: retention runs either in-process (apps/server/src/bootstrap/phases/retention.ts, starter) or as workers jobs (server/workers/src/service.ts:147,184,228,238,285, full profile), with different anonymization formats. The workers path never hard-deletes and keeps canonical_email/username.
- Compliance/consent/legal: data export reads user_sessions (core/compliance/data-export/service.ts:256); signup consent rows are written raw by auth/consented-user.ts instead of the consent module; the ToS gate (auth/tos-gating.ts) is wired in apps/server/src/http/router.ts; users/me/{export,agreements,consent} are owned by other modules.
- Admin: admin/userHandlers.ts reimplements lifecycle operations (lock/unlock, hard-ban, force-logout, reset-password, delete) and uses sudo; admin search and security-event pages read auth tables directly.
- Billing: account deletion checks subscriptions/invoices (repos.subscriptions/invoices referenced from users handlers); billing tables are user-scoped (0900_rls.sql) while 0902 adds tenant scope, so the identity-to-billing relationship is not modelled in one place.
- Storage/media: avatars go through ctx.storage; resolveAvatarUrl (users/handlers/avatar.ts:303) is applied only in users/me, while login/refresh/OAuth responses (auth/utils/response.ts toAuthUser) return null for storage-key avatars.
- Comms: auth email templates exist twice (core plain-text fallback vs comms branded); the SMS provider loads only when the comms capability is loaded (apps/server/src/bootstrap/phases/comms.ts:158-197), so the fallback state has no sms.
- Cache: the users/me cache-aside and invalidation code (users/cache.ts, users/handlers/profile.ts:56-103, account.ts:312, username.ts:106, avatar.ts:290) is inert, because ctx.cache is a stats-only wrapper ({getStats}) built in apps/server/src/bootstrap/phases/infra.ts:46-49. Auth-side user mutations (phone, email change, lifecycle) would not have invalidated it anyway.
- Analytics: no product analytics events for signup/login/MFA adoption; only metrics.recordLoginSuccess in handlers/login.ts:216.
- Feature flags/profiles: auth is absent from profiles/capability-registry.ts. Gating is AUTH_STRATEGIES env (server) plus VITE_ENABLE_ADVANCED_AUTH (web), two switches not derived from each other; the runtime feature-flags module is not used for auth.
- Editions/extensions: auth, users and api-keys are Core server modules (main/editions/catalog.ts:13-22). The Account Insights pack (main/extensions/account-insights/src/server/index.ts.template) re-implements profile-completeness math already served by users/me/profile-completeness (users/handlers/profile-completeness.ts).

#### T-AUTH dead ends

- SecurityEventRepository (main/server/db/src/repositories/auth/security-events.ts, 104 LOC + 243 LOC tests): 0 production call sites; core writes and reads the table with raw SQL.
- TotpBackupCodeRepository (main/server/db/src/repositories/auth/totp-backup-codes.ts, 127 LOC + 246 LOC tests): 0 production call sites; main/server/core/src/auth/totp.ts uses raw SQL.
- UserSessionRepository create/update/revoke (main/server/db/src/repositories/sessions/user-sessions.ts): never called; only findActiveByUserId and deleteRevokedBefore are used. Writes happen raw in auth/utils/refresh-token.ts:83,283,331,363.
- sms_verification_codes table: has schema types (db/src/schema/auth.ts:312-354) but no repository; accessed only by raw SQL.
- Shared session schemas and logic with no consumers: userSessionSchema, createUserSessionSchema, updateUserSessionSchema, CreateUserSession (main/shared/src/modules/core/auth/auth.sessions.schemas.ts); isSessionActive, getSessionAge (auth.sessions.logic.ts); getAllRoles, getRoleDisplayName (users/users.roles.ts). Referenced only by their own file and barrel.
- AuthModuleDeps (main/server/core/src/auth/types.ts:254): exported, never used.
- users.date_of_birth and users.gender: present in DB, db types, shared User/UpdateProfileRequest, server handlers and anonymizers, but no web UI collects them (only tests/fixtures), and 0916 says DOB is not collected.
- UpdateProfileRequest.email (shared/modules/core/users/users.schemas.ts:247): validated client- and server-side, then silently dropped by users/handlers/account.ts.
- The username branch in users/handlers/account.ts:141-149 cannot be reached over HTTP because updateProfileRequestSchema has no username field.
- users/me response cache (users/cache.ts + cache paths in users/handlers/{profile,account,username,avatar}.ts): inert at runtime because AppContext.cache only exposes getStats.
- Webhook event types user.created / user.updated / user.deleted (shared/src/constants/system/comms.ts:13-15): declared, never emitted.
- AUTH_STRATEGIES values 'facebook' and 'microsoft' (shared/src/constants/config.ts:22-23) and OAUTH_STRATEGY_KEYS (apps/server/src/http/auth-route-overrides.ts:24-31): accepted by config validation, but there is no provider implementation, no oauth_provider enum value and no contract.
- LOCAL_AUTH_ROUTES entry 'auth/password/change' (apps/server/src/http/auth-route-overrides.ts:21): matches no route.
- Migration 0906's partial index (0906_refresh_token_rotated_at.sql:16): never created, because the name collides with 0000_users.sql:179.
- createGeneratedApiClient (main/client/api/src/generated/client.ts:312): the only consumer is apps/web/src/pages/EmailUnsubscribePage.tsx; auth uses hand-written clients. The generated hooks generator is retired (main/tools/scripts/api/generate-hooks.ts).
- anonymizeUserPII (main/server/core/src/users/data-hygiene.ts:140): exported, no production caller (a third anonymizer).
- auth/invalidate-sessions vs auth/logout-all: duplicate endpoints with identical effects (handlers/invalidate-sessions.ts vs handlers/logout-all.ts:45-48); both are wired through to the client (client/api/src/devices/client.ts:66 uses invalidate-sessions).
- apps/web/src/features/profile/: a feature folder holding only two query-key constants (5 LOC); profile UI lives in features/settings.
- client/react devices/phone hooks (client/react/src/{devices,phone}/hooks.ts) and client/ui auth primitives (AuthForm, SessionCard, OAuthButton, AuthLayout, ProtectedRoute): no colocated tests.
- Stale references: db/src/schema/auth.ts:310 '@see 0023_sms_verification.sql'; db/src/schema/users.ts:5 'replace Drizzle'; docs/specs/auth.md:102 'refresh_token_families' table.

#### T-AUTH must remain shared

- Schema/validation primitives: main/shared/src/schema (createSchema, parseString, parseOptional, emailSchema, passwordSchema scalars) and the Contract/EndpointDef types in main/shared/src/api/api.ts
- HTTP infrastructure: @bslt/server-system/http (createRouteMap, createScopedRouteHelpers, registerRouteMap, AuthGuardFactory, getAuthenticatedUser), error mapping (@bslt/server-system/errors), JWT/crypto primitives (@bslt/server-system/security)
- DB runtime: main/server/db/src/client.ts (RLS SET LOCAL app.user_id/tenant_id/role), query builder, withTransaction, migration runner and global migration ordering; the users table stays the root FK target for every other domain
- RLS helper functions and the authenticated role (0900_rls.sql, 0901_rls_tenant_trust_boundary.sql app_current_user_id/app_current_tenant_id)
- Comms adapters (EmailProvider/SmtpEmailService, SmsProvider) and the branded template registry in server/comms; storage adapter (avatars)
- Cross-cutting subscribers that identity emits to but does not own: audit recorder (core/audit), notifications/admin alerts, webhooks emitter, realtime pubsub, analytics events, tenancy/personal-tenant provisioning
- Permission/role model shared with tenants and admin: APP_ROLES/TENANT_ROLES/PERMISSIONS (shared/constants/core), permissions checker
- Client foundations: client/react query core (useQuery/useMutation/QueryCacheProvider), client/ui presentational primitives (AuthLayout, AuthFormLayout, PasswordInput, Avatar, OAuthButton, SessionCard, ProtectedRoute), client/engine userScopedStorage, the CSRF request factory in client/api/src/utils.ts
- Settings shell (AccountModal frame + tab registry) and app shell (routes.tsx, ClientEnvironment, ToS handler), both of which identity registers into; the i18n provider and locales
- Composition roots apps/server and apps/web (guard chain order, ToS exempt list, capability/profile resolution) and the edition catalog
- Env/config schema (shared/modules/system/config/env.auth.ts) and server config parsing (server/system/src/config/auth), ideally with one strategy list consumed by both server and web
- Retention constants (RETENTION_PERIODS) and the workers scheduler that runs identity retention jobs

### C.FILES. Files, uploads, storage and media processing: the files table, the @bslt/storage local and S3 providers, signed and presigned URLs, @bslt/media processors, the avatar upload, the Files page and the Media Studio. Top findings: (1) SECURITY: with the default local provider, the "signed" download URL is not signed. LocalStorageProvider.getSignedUrl (main/server/storage/src/providers/local.ts:114-121) returns `${publicBaseUrl}/${key}`, and every file is served by an unauthenticated static route, /uploads/* (main/apps/server/src/bootstrap/app.ts:347-352 -> main/apps/server/src/middleware/static.ts, with `Cache-Control: public` at ~L187), so the link never expires and needs no auth. A working HMAC-signed file server exists (main/apps/server/src/http/file-server.ts) but is never registered. Only S3 issues real presigned GETs. This must be fixed before pay-per-view. (2) There are three separate upload paths that each validate, sign and call the API differently: /api/files from core, /api/users/me/avatar from core users, and /api/media from the app. (3) About 4.1k of the 5.3k LOC in @bslt/media cannot be reached at runtime. The app uses 4 image functions; the package's own HTTP module, in-memory queue, FFmpeg wrapper, processors, scanner and in-memory DB have no consumer. (4) Per main/apps/server/src/bootstrap/optional-capability-packaging.test.ts:51-58, @bslt/media is deliberately not shipped in the production Docker image. (5) Storage blobs are orphaned when a user is deleted, and in starter nothing ever deletes them (main/apps/server/src/bootstrap/phases/retention.ts). Fragmentation is a mix of deliberate (edition and profile gating, storage owned by the composition shell, lazy media import) and accidental (duplicated types, signing, MIME tables and limits, dead modules, docs drift).

- **Packages touched:** 14
- **Total files:** 223
- **Wiring points:** 28

#### T-FILES per-layer file list

**SQL migrations / tables** (5 files)

- `main/server/db/migrations/0600_files.sql`
- `main/server/db/migrations/0700_realtime_versions.sql (L131-135 adds files.version)`
- `main/server/db/migrations/0900_rls.sql (L21 enable, L75 file_isolation_policy)`
- `main/server/db/migrations/0901_rls_tenant_trust_boundary.sql (L128-145 policy, L153 FORCE RLS)`
- `main/server/db/migrations/0000_users.sql (L40 users.avatar_url, the avatar storage key lives here, not in files)`

**server/db (schema, repository, barrels)** (8 files)

- `main/server/db/src/schema/files.ts`
- `main/server/db/src/repositories/files/files.ts`
- `main/server/db/src/repositories/files/index.ts`
- `main/server/db/src/repositories/files/files.test.ts`
- `main/server/db/src/schema/index.ts`
- `main/server/db/src/repositories/index.ts`
- `main/server/db/src/factory.ts`
- `main/server/db/src/index.ts`

**server/storage (@bslt/storage adapters; 0 tests, test script uses --passWithNoTests)** (12 files)

- `main/server/storage/package.json`
- `main/server/storage/src/index.ts`
- `main/server/storage/src/types.ts`
- `main/server/storage/src/config.ts`
- `main/server/storage/src/errors.ts`
- `main/server/storage/src/factory.ts`
- `main/server/storage/src/signing.ts`
- `main/server/storage/src/providers/index.ts`
- `main/server/storage/src/providers/local.ts`
- `main/server/storage/src/providers/s3.ts`
- `main/server/storage/src/providers/s3.client.wrapper.ts`
- `main/server/storage/src/providers/presigner.ts`

**server/media (@bslt/media engine: 25 src + 16 tests, 5.3k src LOC; only image-processing.ts reachable from app)** (42 files)

- `main/server/media/package.json`
- `main/server/media/src/index.ts`
- `main/server/media/src/image-processing.ts`
- `main/server/media/src/image-processing.test.ts`
- `main/server/media/src/audio-metadata.ts`
- `main/server/media/src/audio-metadata.test.ts`
- `main/server/media/src/database.ts`
- `main/server/media/src/database.test.ts`
- `main/server/media/src/facade.ts`
- `main/server/media/src/facade.test.ts`
- `main/server/media/src/ffmpeg-wrapper.ts`
- `main/server/media/src/ffmpeg-wrapper.test.ts`
- `main/server/media/src/file-type.ts`
- `main/server/media/src/file-type.test.ts`
- `main/server/media/src/processor.ts`
- `main/server/media/src/processor.test.ts`
- `main/server/media/src/security.ts`
- `main/server/media/src/security.test.ts`
- `main/server/media/src/validation.ts`
- `main/server/media/src/validation.test.ts`
- `main/server/media/src/processors/index.ts`
- `main/server/media/src/processors/audio.ts`
- `main/server/media/src/processors/audio.test.ts`
- `main/server/media/src/processors/image.ts`
- `main/server/media/src/processors/image.test.ts`
- `main/server/media/src/processors/video.ts`
- `main/server/media/src/processors/video.test.ts`
- `main/server/media/src/queue/index.ts`
- `main/server/media/src/queue/jobs.ts`
- `main/server/media/src/queue/jobs.test.ts`
- `main/server/media/src/queue/queue.ts`
- `main/server/media/src/queue/queue.test.ts`
- `main/server/media/src/queue/retry.ts`
- `main/server/media/src/queue/retry.test.ts`
- `main/server/media/src/utils/index.ts`
- `main/server/media/src/utils/streaming.ts`
- `main/server/media/src/utils/streaming.test.ts`
- `main/server/media/src/http/index.ts`
- `main/server/media/src/http/routes.ts`
- `main/server/media/src/http/handlers.ts`
- `main/server/media/src/http/service.ts`
- `main/server/media/src/http/types.ts`

**server/core (files module + avatar + cross-domain consumers; files has no unit tests)** (20 files)

- `main/server/core/src/files/index.ts`
- `main/server/core/src/files/types.ts`
- `main/server/core/src/files/service.ts`
- `main/server/core/src/files/handlers.ts`
- `main/server/core/src/files/routes.ts`
- `main/server/core/src/users/handlers/avatar.ts`
- `main/server/core/src/users/handlers/index.ts`
- `main/server/core/src/users/handlers/profile.ts`
- `main/server/core/src/users/handlers/account.ts`
- `main/server/core/src/users/routes.ts`
- `main/server/core/src/users/data-hygiene.ts`
- `main/server/core/src/users/index.ts`
- `main/server/core/src/users/service.ts`
- `main/server/core/src/compliance/data-export/service.ts`
- `main/server/core/src/audit/retention.ts`
- `main/server/core/src/admin/healthHandler.ts`
- `main/server/core/src/auth/utils/response.ts`
- `main/server/core/src/route-modules.ts`
- `main/server/core/src/index.ts`
- `main/server/core/package.json`

**server/system (config + routing)** (4 files)

- `main/server/system/src/config/infra/storage.ts`
- `main/server/system/src/config/infra/storage.test.ts`
- `main/server/system/src/config/factory.ts`
- `main/server/system/src/http/routing.ts (per-route bodyLimit)`

**server/workers** (3 files)

- `main/server/workers/src/service.ts (data-hygiene-files daily job L296-330)`
- `main/server/workers/src/pii-anonymization.ts`
- `main/server/workers/src/hard-ban-anonymization.ts`

**apps/server (composition, app-owned media routes, upload/serve plumbing)** (26 files)

- `main/apps/server/package.json`
- `main/apps/server/src/http/media/index.ts`
- `main/apps/server/src/http/media/routes.ts`
- `main/apps/server/src/http/media/handlers.ts`
- `main/apps/server/src/http/media/service.ts`
- `main/apps/server/src/http/media/service.test.ts`
- `main/apps/server/src/http/media/types.ts`
- `main/apps/server/src/http/media/engine.ts`
- `main/apps/server/src/http/file-server.ts`
- `main/apps/server/src/http/file-server.test.ts`
- `main/apps/server/src/http/index.ts`
- `main/apps/server/src/http/route-modules.ts`
- `main/apps/server/src/middleware/static.ts`
- `main/apps/server/src/middleware/static.test.ts`
- `main/apps/server/src/middleware/index.ts`
- `main/apps/server/src/plugin/multipart.ts`
- `main/apps/server/src/plugin/multipart.test.ts`
- `main/apps/server/src/plugin/index.ts`
- `main/apps/server/src/bootstrap/app.ts`
- `main/apps/server/src/bootstrap/context.ts`
- `main/apps/server/src/bootstrap/phases/comms.ts`
- `main/apps/server/src/bootstrap/phases/workers.ts`
- `main/apps/server/src/bootstrap/phases/retention.ts`
- `main/apps/server/src/bootstrap/optional-import.ts`
- `main/apps/server/src/bootstrap/optional-capability-packaging.test.ts`
- `main/apps/server/src/bootstrap/generated/profile.generated.ts`

**shared (contracts, schemas, constants, ports, env, multipart)** (25 files)

- `main/shared/src/contracts/contract.files.ts`
- `main/shared/src/contracts/contract.ports.ts`
- `main/shared/src/contracts/edition-ports.ts`
- `main/shared/src/contracts/context.ts`
- `main/shared/src/contracts/index.ts`
- `main/shared/src/contracts/contract.users.ts`
- `main/shared/src/api/router.ts`
- `main/shared/src/modules/storage/index.ts`
- `main/shared/src/modules/storage/files/index.ts`
- `main/shared/src/modules/storage/files/files.ts`
- `main/shared/src/modules/storage/files/files.test.ts`
- `main/shared/src/modules/media/index.ts`
- `main/shared/src/modules/media/media.ts`
- `main/shared/src/modules/media/media.types.ts`
- `main/shared/src/modules/media/media.test.ts`
- `main/shared/src/constants/media.ts`
- `main/shared/src/constants/index.ts`
- `main/shared/src/constants/system/limits.ts`
- `main/shared/src/constants/core/billing.ts`
- `main/shared/src/modules/core/billing/billing.entitlements.ts`
- `main/shared/src/modules/system/config/env.storage.ts`
- `main/shared/src/modules/system/config/env.storage.test.ts`
- `main/shared/src/modules/system/http/multipart.ts`
- `main/shared/src/modules/system/http/multipart.test.ts`
- `main/shared/src/modules/core/users/users.schemas.ts`

**client/api** (3 files)

- `main/client/api/src/api/client.ts (L153-156 interface, L400-460 requestMultipart, L547-557 files methods)`
- `main/client/api/src/generated/client.ts (L191-195 /api/files, L230-231 avatar; no /api/media)`
- `main/client/api/src/settings/client.ts (L72-86 avatar upload/delete)`

**client/react (no feature hooks: files/media/avatar hooks live in apps/web, unlike billing/devices/legal/oauth/phone/webhooks which live in client/react/src/\*)** (0 files)

- (none)

**client/ui** (10 files)

- `main/client/ui/src/components/media/MediaGallery.tsx`
- `main/client/ui/src/components/media/MediaGallery.test.tsx`
- `main/client/ui/src/components/media/index.ts`
- `main/client/ui/src/components/index.ts`
- `main/client/ui/src/index.ts`
- `main/client/ui/src/elements/FileInput.tsx`
- `main/client/ui/src/elements/FileInput.test.tsx`
- `main/client/ui/src/elements/Avatar.tsx`
- `main/client/ui/src/components/Image.tsx`
- `main/client/ui/src/components/billing/UsageSummary.tsx`

**apps/web (features, routes, nav)** (29 files)

- `main/apps/web/src/features/files/FEATURE.md`
- `main/apps/web/src/features/files/index.ts`
- `main/apps/web/src/features/files/hooks/index.ts`
- `main/apps/web/src/features/files/hooks/useFiles.ts`
- `main/apps/web/src/features/files/pages/index.ts`
- `main/apps/web/src/features/files/pages/FilesPage.tsx`
- `main/apps/web/src/features/files/pages/FilesPage.css`
- `main/apps/web/src/features/files/pages/FilesPage.test.tsx`
- `main/apps/web/src/features/media/index.ts`
- `main/apps/web/src/features/media/hooks/index.ts`
- `main/apps/web/src/features/media/hooks/mediaClient.ts`
- `main/apps/web/src/features/media/hooks/mediaClient.test.ts`
- `main/apps/web/src/features/media/hooks/useMedia.ts`
- `main/apps/web/src/features/media/pages/index.ts`
- `main/apps/web/src/features/media/pages/MediaStudioPage.tsx`
- `main/apps/web/src/features/media/pages/MediaStudioPage.css`
- `main/apps/web/src/features/settings/components/AvatarUpload.tsx`
- `main/apps/web/src/features/settings/components/AvatarUpload.test.tsx`
- `main/apps/web/src/features/settings/hooks/useAvatarUpload.ts`
- `main/apps/web/src/features/settings/hooks/useAvatarUpload.test.ts`
- `main/apps/web/src/app/routes.tsx`
- `main/apps/web/src/app/layouts/AppLeftMenu.tsx`
- `main/apps/web/src/app/starterSurface.ts`
- `main/apps/web/src/app/capabilities.ts`
- `main/apps/web/src/bootstrap/generated/profile.generated.ts`
- `main/apps/web/src/features/dashboard/pages/DashboardPage.tsx`
- `main/apps/web/src/features/command-palette/data/commands.ts`
- `main/apps/web/src/demo/api-routes/routeCoverage.ts`
- `main/apps/web/vite.config.ts`

**tests (integration + e2e)** (6 files)

- `tests/integration/api/media.integration.test.ts (despite the name, it tests /api/files only)`
- `tests/integration/api/files.real-db.test.ts`
- `tests/integration/api/feature-flags-files.integration.test.ts`
- `tests/integration/api/data-hygiene.real-db.test.ts (avatar section L281+)`
- `tests/integration/database/postgres-smoke.test.ts (L452-471 files repo)`
- `tests/e2e/specs/media/media.e2e.ts (all tests skip without E2E creds)`

**docs** (9 files)

- `docs/api/files.md`
- `docs/api/users.md`
- `docs/DIRECTION.md`
- `docs/architecture/layer-map.md`
- `docs/architecture/server-dependency-dag.md`
- `docs/architecture/core-and-extensions.md`
- `docs/dev/horizontal-scaling.md`
- `docs/deploy/reverse-proxy.md`
- `docs/dev/prune.md`

**editions / profiles / flags / tooling gating** (20 files)

- `main/profiles/capability-registry.ts`
- `main/profiles/capability-groups.ts`
- `main/profiles/profiles.starter.ts`
- `main/profiles/profiles.full.ts`
- `main/profiles/generated/enabled-capabilities.generated.ts`
- `main/editions/catalog.ts`
- `main/editions/core/main/apps/server/src/bootstrap/phases/comms.ts.template`
- `main/editions/core/main/server/core/src/route-modules.ts.template`
- `main/editions/core/main/apps/server/src/http/route-modules.ts.template`
- `main/editions/core/main/apps/web/src/app/routes.tsx.template`
- `main/tools/scripts/starter/prune-manifests-packages.ts`
- `main/tools/scripts/starter/prune-manifests.ts`
- `main/tools/scripts/starter/prune-proof.ts`
- `main/tools/scripts/recipes/registry.ts`
- `main/tools/setup/manifest.ts`
- `main/tools/scripts/editions/export.ts`
- `main/tools/scripts/audit/profile-boundaries.ts`
- `main/tools/scripts/audit/test-pairs-debt.json`
- `main/tools/scripts/api/generate-client.ts`
- `main/tools/scripts/docs/generate-api-docs.ts`

**parallel file delivery (separate system that does not use @bslt/storage)** (1 files)

- `main/apps/storefront/src/server.ts (L110-111 canDownload, L329-337 entitled /api/downloads/:file)`

#### T-FILES wiring points

- `main/server/db/migrations/0600_files.sql + 0700_realtime_versions.sql:134 + 0900_rls.sql:21,75 + 0901_rls_tenant_trust_boundary.sql:128-153`: files table, version column, and the RLS policy (owner OR tenant member). The policy is defined in a different migration from the table.
- `main/server/db/src/factory.ts:59,178,273`: Adds repos.files to the global Repositories container, which is then available everywhere.
- `main/server/db/src/schema/index.ts:313-318, main/server/db/src/repositories/index.ts:148, main/server/db/src/index.ts:65-66,318,363`: Three barrel re-export points for the files schema and repository.
- `main/server/core/package.json:55-58`: The ./files subpath export. Consumed by apps/server media service.ts:11-18 and server/workers service.ts:21.
- `main/server/core/src/route-modules.ts:18,52`: Registers fileRoutes unconditionally in the core route registry. No profile or flag gate.
- `main/server/core/src/users/routes.ts:204-226`: Avatar PUT /users/me/avatar (with bodyLimit) and POST /users/me/avatar/delete. These are a separate upload path.
- `main/apps/server/src/bootstrap/phases/comms.ts:5,63-94,107,195`: Creates the storage client inside the comms phase, in both the fallback and full paths, and sets ctx.storage. The core edition template copies this logic (main/editions/core/.../comms.ts.template).
- `main/apps/server/src/bootstrap/context.ts:64,134`: Types `storage?: StorageClient` on InfraContext and AppContext.
- `main/apps/server/src/bootstrap/app.ts:144`: registerMultipartFormParser. The global buffer-based multipart parser that every upload route depends on.
- `main/apps/server/src/bootstrap/app.ts:347-352`: When the provider is local, registers an unauthenticated static GET /uploads/* serving rootPath (Range-capable, Cache-Control public).
- `main/apps/server/src/http/route-modules.ts:19,46-51,73`: Registers app-owned media routes only when isServerCapabilityEnabled('media').
- `main/apps/server/src/http/media/engine.ts:38-56`: Lazily loads @bslt/media through importOptionalCapability and asserts 4 required exports.
- `main/apps/server/src/bootstrap/phases/workers.ts:128 -> main/server/workers/src/service.ts:296-330`: Passes storage to workers for the daily data-hygiene-files job. Runs only when the workers capability is on.
- `main/shared/src/contracts/contract.files.ts + main/shared/src/contracts/index.ts:19 + main/shared/src/api/router.ts:18,41`: Files contract feeding the route manifest, generated client and API docs. Media has no contract.
- `main/client/api/src/generated/client.ts:191-195 (generated by main/tools/scripts/api/generate-client.ts)`: Route metadata for /api/files. /api/media is absent.
- `main/client/api/src/api/client.ts:153-156,547-557`: Hand-written files methods: listFiles, uploadFile, deleteFile, downloadFile.
- `main/client/api/src/settings/client.ts:72-86`: Avatar upload and delete through a different request helper and form field ('avatar').
- `main/apps/web/src/app/routes.tsx:171-188`: Lazy FilesPage, always on. MediaStudioPage only when isMediaEnabled().
- `main/apps/web/src/app/layouts/AppLeftMenu.tsx:45-56,76,95-97`: Nav metadata and links for Files (always) and Media (capability-gated).
- `main/apps/web/src/app/starterSurface.ts:12`: Lists 'files' as a starter product route.
- `main/apps/web/src/app/capabilities.ts:21-22`: isMediaEnabled() reads the generated web profile.
- `main/apps/web/src/features/dashboard/pages/DashboardPage.tsx:183,282 and main/apps/web/src/features/command-palette/data/commands.ts:89`: Hard-coded deep links to /files.
- `main/apps/web/src/demo/api-routes/routeCoverage.ts:208-212`: API explorer coverage list. Includes /api/files but not /api/media.
- `main/profiles/capability-registry.ts:58-84, main/profiles/profiles.starter.ts:7, main/apps/{server,web}/src/bootstrap/generated/profile.generated.ts`: Capability definitions for media and storage. Starter excludes both, but storage is never checked at runtime.
- `main/editions/catalog.ts:30,45-46,117-121 + main/editions/core/** templates`: Edition source split. The files module and web files/media are Pro, while storage and avatars are Core. Core templates replace route-modules.ts and routes.tsx wholesale.
- `main/tools/scripts/starter/prune-manifests-packages.ts:467-640 (MEDIA_MANIFEST), main/tools/scripts/recipes/registry.ts:393-512, main/tools/setup/manifest.ts:71-75`: Prune and recipe wiring for media and s3-storage. Files has no prune manifest.
- `main/tools/scripts/audit/profile-boundaries.ts:41-52`: Audit rule that exempts @bslt/storage from the optional-package boundary.
- `main/server/core/src/users/data-hygiene.ts:240, main/server/core/src/compliance/data-export/service.ts:221-233, main/server/core/src/admin/healthHandler.ts:82`: Cross-domain consumers: GDPR file cleanup, data export of file metadata, and the storage health probe.

#### T-FILES adding an endpoint

1. Example: add a 'rename file' endpoint with UI to the canonical /api/files path.
2. main/shared/src/modules/storage/files/files.ts: add a request schema, type and response schema.
3. main/shared/src/modules/storage/files/index.ts: re-export. This is the first of two barrels.
4. main/shared/src/modules/storage/index.ts: re-export again. This is the second barrel.
5. main/shared/src/modules/storage/files/files.test.ts: add a schema test.
6. main/shared/src/contracts/contract.files.ts: add the contract entry (method, path, pathParams, body, responses).
7. main/server/db/src/repositories/files/files.ts: only if a new query is needed. update() already exists but is unused.
8. main/server/core/src/files/types.ts: update the duplicate FileMetadata if the response shape changes.
9. main/server/core/src/files/service.ts: add the service function, repeating the owner-or-admin check.
10. main/server/core/src/files/handlers.ts: add the handler, repeating the toFileStorageProvider and getStorageProvider boilerplate.
11. main/server/core/src/files/routes.ts: add the route tuple, using a unique map key and the POST '/x/:id/verb' convention.
12. main/server/core/src/files/index.ts: export the handler and service.
13. main/server/core/src/files/service.test.ts: create it. No unit tests exist for this module; it is listed in main/tools/scripts/audit/test-pairs-debt.json.
14. main/client/api/src/api/client.ts: add the method to the ApiClient interface (~L153) and the implementation (~L547).
15. main/client/api/src/generated/client.ts: regenerate with `pnpm api:generate` (CI freshness check: main/tools/scripts/api/check-client-freshness.ts).
16. main/apps/web/src/features/files/hooks/useFiles.ts: add a useMutation hook that invalidates ['files']. If the media list should refresh too, also invalidate ['media'], since both read the same table.
17. main/apps/web/src/features/files/hooks/index.ts: export the hook.
18. main/apps/web/src/features/files/index.ts: export it again.
19. main/apps/web/src/features/files/pages/FilesPage.tsx: add the UI.
20. main/apps/web/src/features/files/pages/FilesPage.test.tsx: add the UI test.
21. main/apps/web/src/demo/api-routes/routeCoverage.ts: add the route (also covered by routeCoverage.test.ts).
22. tests/integration/api/files.real-db.test.ts or tests/integration/api/media.integration.test.ts: add an HTTP integration test.
23. docs/api/files.md: regenerate with `pnpm docs:api`.
24. main/apps/web/src/features/files/FEATURE.md: update the touch points if the shape changes.
25. Total: about 20 files across 5 packages for one endpoint.
26. Doing the same on the media path (/api/media) skips contract, generated client and docs, and touches instead: main/apps/server/src/http/media/{types,service,handlers,routes}.ts, main/apps/server/src/http/media/service.test.ts, main/apps/web/src/features/media/hooks/{mediaClient,useMedia,index}.ts, main/apps/web/src/features/media/index.ts and main/apps/web/src/features/media/pages/MediaStudioPage.tsx (about 10 files). Response types are hand-mirrored between server types.ts and mediaClient.ts.

#### T-FILES inconsistencies

**T-FILES-I01.** [ACCIDENTAL, SECURITY] Local-provider 'signed' URLs are not signed. getSignedUrl returns a permanent public URL, and the static /uploads route serves it with no auth and `Cache-Control: public`. The HMAC-signed file server that would fix this is exported and tested but never registered. Every list call hands out these URLs (listFiles signs every row). For S3 they are real 1h presigned URLs, so security semantics depend on the provider.

Evidence:

- main/server/storage/src/providers/local.ts:114-121
- main/apps/server/src/bootstrap/app.ts:347-352
- main/apps/server/src/middleware/static.ts (no auth check; 'Cache-Control public' ~L187)
- main/apps/server/src/http/file-server.ts:260 registerFileServer (not called; only exported at main/apps/server/src/http/index.ts:10)
- main/server/system/src/config/infra/storage.ts:72-84,125 (publicBaseUrl defaults to <api>/uploads)
- config/env/.env.production.example:175-176 (STORAGE_PUBLIC_BASE_URL=https://your-app.com/uploads)
- main/server/core/src/files/service.ts:135-139

**T-FILES-I02.** [ACCIDENTAL] There are three incompatible HMAC signing implementations. storage/signing.ts signs {method,fileId,filename,expirationMs} as base64url. file-server.ts verifies {method,id,filename,expirationMs}, so a URL from createSignedUrl() would fail verification there even though both use the /uploads/:id/:filename path. providers/presigner.ts is a third variant using base64 and generic data.

Evidence:

- main/server/storage/src/signing.ts:13-27,48-64
- main/apps/server/src/http/file-server.ts:20-52,213-214
- main/server/storage/src/providers/presigner.ts (createSignature/verifySignature, sha512 base64)

**T-FILES-I03.** [ACCIDENTAL] The set of storage providers differs at every layer. DB CHECK and STORAGE_PROVIDERS allow 'gcs'. StorageBackend lists 6 (local, s3, gcs, azure, database, memory). The env schema allows only local and s3. The factory implements only local and s3. Handlers still coerce 'gcs' as valid. DIRECTION.md admits GCS is not implemented.

Evidence:

- main/server/db/migrations/0600_files.sql:19
- main/shared/src/constants/media.ts:187
- main/shared/src/contracts/contract.ports.ts:48-54
- main/shared/src/modules/system/config/env.storage.ts:28,82-84
- main/server/storage/src/factory.ts:15-24
- main/server/core/src/files/handlers.ts:28-31
- main/apps/server/src/http/media/service.ts:57-60
- docs/DIRECTION.md:185

**T-FILES-I04.** [ACCIDENTAL] There are 7 interfaces for one storage port, plus 3 hand-written adapters. Two StorageConfig types also exist. One carries maxFileSize/allowedTypes that comms.ts fills with ['*'] and that no provider reads. There are also two loadStorageConfig/validateStorage pairs; only the server-system one is used.

Evidence:

- main/shared/src/contracts/contract.ports.ts:72 (StorageClient), :393 (StorageService), :104-156 (StorageConfig w/ maxFileSize)
- main/shared/src/contracts/context.ts:58-66 (HasStorage inline anonymous type)
- main/shared/src/contracts/edition-ports.ts:5 (FileStorageProvider)
- main/server/media/src/http/types.ts (MediaStorageProvider)
- main/server/core/src/users/handlers/avatar.ts:36 (local StorageProvider)
- main/server/storage/src/types.ts (StorageProvider = StorageClient alias)
- main/shared/src/modules/system/config/env.storage.ts:37-55 (second StorageConfig)
- main/server/core/src/files/handlers.ts:16-26 and main/apps/server/src/http/media/service.ts:63-73 (duplicate toFileStorageProvider)
- main/server/core/src/users/handlers/avatar.ts:280-288 (createStorageProvider)
- main/apps/server/src/bootstrap/phases/comms.ts:63-67 (allowedTypes ['*'])
- main/server/storage/src/config.ts vs main/server/system/src/config/infra/storage.ts:86,133

**T-FILES-I05.** [ACCIDENTAL] There are four or more file record shapes. The DB FileRecord uses plain string IDs. The shared FileRecord uses branded IDs. Core FileMetadata has purpose: string, while shared FileMetadata has purpose: FilePurpose. The web side aliases them again. Media probe and output-format types are hand-copied between server and web, and media 'kind' classification is implemented twice.

Evidence:

- main/server/db/src/schema/files.ts:30-45
- main/shared/src/modules/storage/files/files.ts:56-71,237-249
- main/server/core/src/files/types.ts:42-54
- main/apps/web/src/features/media/hooks/mediaClient.ts:16,24-34
- main/apps/server/src/http/media/types.ts:33-43,59-64
- main/apps/server/src/http/media/engine.ts:14
- main/apps/web/src/features/media/pages/MediaStudioPage.tsx:34,38

**T-FILES-I06.** [ACCIDENTAL] The schema has drifted from the DB. Migration 0700 adds files.version (optimistic concurrency for realtime), but FileRecord and FILE_COLUMNS omit it, and toCamelCase passes it through untyped. size_bytes is BIGINT, and the postgres.js driver returns int8 as a string (the repo itself notes this in tenant-roles.ts). The files repo does not coerce it, so `sizeBytes: number` is very likely a string at runtime. FilesPage sums it. No response-schema validation or test catches this. (PLAUSIBLE bug.)

Evidence:

- main/server/db/migrations/0700_realtime_versions.sql:134-135
- main/server/db/src/schema/files.ts:30-45,99-114
- main/server/db/src/utils/database.ts:45-63
- main/server/db/src/repositories/tenant/tenant-roles.ts:91-98
- main/server/db/src/repositories/files/files.ts:110-112
- main/server/db/src/client.ts:166-177 (no int8 type parser)
- main/apps/web/src/features/files/pages/FilesPage.tsx:122

**T-FILES-I07.** [ACCIDENTAL] Responses for the same record differ by route. Files GET returns {file}, media GET returns {media}. Files delete returns {success,message,fileId}, which fileDeleteResponseSchema requires, while media delete returns {success,fileId}. The files contract reuses the upload response schema for GET. Error codes are FILE_* or MEDIA_* for the same row. 'Storage unavailable' is 500 InternalError in files/media but 503 in avatar.

Evidence:

- main/server/core/src/files/handlers.ts:76-78,194
- main/apps/server/src/http/media/handlers.ts:83,95
- main/shared/src/modules/storage/files/files.ts:300-310
- main/shared/src/contracts/contract.files.ts:55
- main/apps/server/src/http/media/service.ts:87-90
- main/server/core/src/users/handlers/avatar.ts:362,413

**T-FILES-I08.** [ACCIDENTAL] Size limits are scattered across at least 10 values, and the plan limit is never enforced: 10MB (LIMITS and storage default), a hard-coded 10MB in FilesPage, 5MB avatar, 200MB for app media routes, 100MB in the dead media HTTP module, 1GB MAX_UPLOAD_FILE_SIZE (unused), 2MB MAX_LOGO_SIZE (unused), and a 10MB entitlement 'media:max_file_size' that is not enforced. Uploads up to 200MB are fully buffered in memory because the multipart parser uses parseAs 'buffer'.

Evidence:

- main/shared/src/constants/system/limits.ts:10
- main/server/storage/src/config.ts (DEFAULT_STORAGE_MAX_FILE_SIZE)
- main/apps/web/src/features/files/pages/FilesPage.tsx:28
- main/shared/src/constants/media.ts:192,195,202,256
- main/apps/server/src/http/media/types.ts:56
- main/shared/src/modules/core/billing/billing.entitlements.ts:58,62
- main/apps/server/src/plugin/multipart.ts:12-14

**T-FILES-I09.** [ACCIDENTAL] Validation is repeated in up to 5 places, and UI and server disagree. The avatar UI accepts GIF but the server allows only jpeg/png/webp. Upload checks run in the UI, then route bodyLimit, then fileUploadRequestSchema, then handlers re-checking buffer/mimetype, then the service. MIME is always the client-declared Content-Type: the magic-byte detectors in shared and media are never used on upload. text/csv is allowed but missing from MIME_TO_EXT, so it is stored as .bin.

Evidence:

- main/apps/web/src/features/settings/components/AvatarUpload.tsx:67,147
- main/shared/src/constants/media.ts:32
- main/server/core/src/users/handlers/avatar.ts:140
- main/server/core/src/files/routes.ts:72-80 + handlers.ts:72-74 + service.ts:72-90
- main/shared/src/modules/system/http/multipart.ts (mimetype = part Content-Type header)
- main/server/core/src/files/types.ts:85-94
- main/server/core/src/files/service.ts:93

**T-FILES-I10.** [ACCIDENTAL] MIME, extension and magic-number tables are duplicated and wrong in places. MAGIC_NUMBERS exists twice: exported in constants and as a private copy in modules/media. m4a maps to 'audio/m4a' in the magic table but 'audio/mp4' in EXT_TO_MIME. The RIFF signature is mapped to both webp and wav, so WAV files are detected as webp. file-server.ts has its own getMimeType map, and static.ts uses the shared one.

Evidence:

- main/shared/src/constants/media.ts:88,136-180 (L152 webp RIFF, L157 wav RIFF, L163 audio/m4a)
- main/shared/src/modules/media/media.ts:69-120
- main/apps/server/src/http/file-server.ts:230-249
- main/apps/server/src/middleware/static.ts:13

**T-FILES-I11.** [ACCIDENTAL] There are three client upload patterns. Files use requestMultipart from the typed client with form field 'file'. Avatars use the settings client's request() with form field 'avatar'. Media uses a hand-rolled fetch with its own module-level CSRF cache and no refresh-on-401. The server multipart parser takes the first file part whatever the field name.

Evidence:

- main/client/api/src/api/client.ts:400-460,547-557
- main/client/api/src/settings/client.ts:72-80
- main/apps/web/src/features/media/hooks/mediaClient.ts:42-78
- main/shared/src/modules/system/http/multipart.ts:70-140

**T-FILES-I12.** [ACCIDENTAL] avatarUrl is emitted three different ways. Profile and account endpoints re-sign the storage key. Auth responses run normalizeNullableUrl, which turns an 'avatars/...' key into null, so login and session payloads lose uploaded avatars. users/service getUserById returns the raw storage key.

Evidence:

- main/server/core/src/users/handlers/profile.ts:79
- main/server/core/src/users/handlers/account.ts:320
- main/server/core/src/auth/utils/response.ts:13-22,144
- main/server/core/src/users/service.ts:99

**T-FILES-I13.** [ACCIDENTAL] Avatars bypass the files table, and blob lifecycle is inconsistent. FILE_PURPOSES includes 'avatar', but avatars live only in users.avatar_url, and uploadFile hard-codes purpose 'document' for every upload, including media. Files delete removes the blob first. Avatar delete never removes the blob. Anonymization nulls avatar_url without deleting the blob, hard-delete cascades the files rows, and the starter retention sweep never calls cleanupUserFiles. Even the workers job only covers the files table, despite describing itself as 'avatars, uploads'.

Evidence:

- main/shared/src/constants/media.ts:189
- main/server/core/src/files/service.ts:116,226-230
- main/server/core/src/users/handlers/avatar.ts:158,217-222
- main/apps/server/src/bootstrap/phases/retention.ts:72,97-110
- main/server/workers/src/pii-anonymization.ts:64
- main/server/workers/src/service.ts:296-330
- main/server/core/src/users/data-hygiene.ts:240-280
- main/server/db/migrations/0600_files.sql:14

**T-FILES-I14.** [ACCIDENTAL] Authorization rules diverge, and tenant scoping cannot be reached. RLS allows owner OR tenant member. The services allow owner OR global admin. The uploadFile tenantId parameter is never passed by either handler, so tenant_id is always NULL and RLS tenant sharing never applies. findByTenantId is unused. There is no RLS test for files.

Evidence:

- main/server/db/migrations/0901_rls_tenant_trust_boundary.sql:128-145
- main/server/core/src/files/service.ts:181,222,267
- main/apps/server/src/http/media/service.ts:89
- main/server/core/src/files/handlers.ts:81-86
- main/apps/server/src/http/media/handlers.ts (uploadMedia called without tenantId)

**T-FILES-I15.** [ACCIDENTAL] Each file has two IDs. The storage key uses generateFileId() (32 hex characters, also stored in the filename column), while the row id is uuid_generate_v4(). NewFileRecord.id is optional and never set.

Evidence:

- main/server/core/src/files/service.ts:94-95,110
- main/shared/src/modules/media/media.ts:548-550
- main/server/db/migrations/0600_files.sql:12
- main/server/db/src/schema/files.ts:57

**T-FILES-I16.** [ACCIDENTAL] Files and media are one dataset seen through two lenses with separate caches. /api/media reuses the files table but lists the first 100 files and then filters to media types, so `total` is not a real count and a user with more than 100 documents loses media from the list. /files shows media rows (up to 200MB) and can delete them, but caches ['files'] and ['media'] never cross-invalidate. Derived images from transform are not linked to their source (no parent id).

Evidence:

- main/apps/server/src/http/media/service.ts:120-133,223-263
- main/server/core/src/files/service.ts:128-145
- main/apps/web/src/features/files/hooks/useFiles.ts:15
- main/apps/web/src/features/media/hooks/useMedia.ts:15

**T-FILES-I17.** [DOCUMENTED BUT MISLEADING] Storage is called both 'optional' and 'on'. DIRECTION.md says server/storage is ON in starter. The starter profile, capability registry and generated profiles all exclude 'storage', yet @bslt/storage is statically imported and always constructed, and no code checks the storage capability. The profile-boundaries audit carves out an explicit exception. Separately, DIRECTION.md says file surfaces are opt-in, but files routes, nav and starterSurface are unconditional, and the editions catalog marks files as Pro-only.

Evidence:

- docs/DIRECTION.md:40,63,284,307
- main/profiles/profiles.starter.ts:7
- main/profiles/capability-registry.ts:76-84
- main/apps/server/src/bootstrap/generated/profile.generated.ts (ENABLED_SERVER_CAPABILITIES = comms, core, db, system)
- main/apps/server/src/bootstrap/phases/comms.ts:5,91-94
- main/tools/scripts/audit/profile-boundaries.ts:41-52
- main/server/core/src/route-modules.ts:52
- main/apps/web/src/app/starterSurface.ts:12
- main/editions/catalog.ts:30,45

**T-FILES-I18.** [ACCIDENTAL] Docs and tests have drifted. server-dependency-dag.md says media depends on db and shared, but its package.json also depends on server-system, needed only by the dead HTTP module. docs/api/files.md says upload 'accepts a JSON body'. horizontal-scaling.md calls local-FS uploads stateless. media.integration.test.ts tests only /api/files and fakes a processing queue through metadata. Nothing tests /api/media over HTTP. feature-flags-files.integration.test.ts bundles two unrelated domains.

Evidence:

- docs/architecture/server-dependency-dag.md:59
- main/server/media/package.json (dependencies)
- docs/api/files.md:107-127
- docs/dev/horizontal-scaling.md:105
- tests/integration/api/media.integration.test.ts:11,432,857-929
- tests/integration/api/feature-flags-files.integration.test.ts:15-16,241

**T-FILES-I19.** [ACCIDENTAL] Hooks are placed inconsistently. Domain hooks for billing, devices, legal, oauth, phone and webhooks live in client/react, but files, media and avatar hooks live in apps/web features. Each creates its own API client instance (useFiles creates one per call; settings memoizes).

Evidence:

- main/client/react/src (billing, devices, legal, oauth, phone, webhooks dirs)
- main/apps/web/src/features/files/hooks/useFiles.ts:17-22
- main/apps/web/src/features/settings/hooks/useAvatarUpload.ts:22-30

**T-FILES-I20.** [DELIBERATE, documented] Some fragmentation is intentional and should be preserved, not undone. Media routes are app-owned and lazily import @bslt/media so starter never loads sharp. Storage is owned by the composition shell, and core domain code imports only ports. Paid files code is split by edition while FileStorageProvider sits in shared/edition-ports so core's cleanup does not import paid code. Media is explicitly unsupported in the Docker image.

Evidence:

- main/apps/server/src/http/media/engine.ts:1-12,38-56
- main/apps/server/src/http/route-modules.ts:46-51
- docs/specs/principles.md:79-80
- docs/architecture/core-and-extensions.md:103-104
- main/shared/src/contracts/edition-ports.ts:4-10
- main/apps/server/src/bootstrap/optional-capability-packaging.test.ts:51-58
- main/editions/catalog.ts:106-128

#### T-FILES proposed vertical module tree

```text
main/modules/assets/                          # ONE module owning files + media + avatar blobs (id 'assets'; edition: core for avatar/upload, pro for library/studio via manifest flags)
├── module.ts                                 # manifest: id, edition, requires ['storage'], optional ['media','workers'], routes, web routes+nav, jobs, events, migrations, prune paths, recipes (replaces scattered registrations in route-modules.ts, routes.tsx, AppLeftMenu, starterSurface, catalog.ts, prune-manifests)
├── FEATURE.md
├── db/
│   ├── migrations/
│   │   ├── 0600_assets.sql                   # assets: id (= storage key id), owner_id, tenant_id, purpose (avatar|document|media|attachment|export|...), kind, mime, size_bytes, checksum, storage_provider (local|s3 only), storage_key, visibility (private|tenant|public|entitled), content_rating (sfw|softcore) NOT NULL, moderation_status, parent_asset_id, version, metadata
│   │   ├── 0601_asset_variants.sql           # thumbnails/transcodes/derivatives (replaces orphan 'transform' copies)
│   │   ├── 0602_upload_sessions.sql          # presigned-PUT intents (pending → finalized/expired) for large/direct-to-S3 uploads
│   │   └── 0603_assets_rls.sql               # policy co-located with table (owner | tenant member | entitlement grant), rating guard
│   ├── schema.ts                             # single AssetRecord + column map incl. version; BIGINT→number coercion
│   ├── repository.ts                         # paginated list (cursor + true total), byOwner/byTenant, variants
│   ├── repository.test.ts
│   └── repository.real-db.test.ts            # incl. RLS isolation + rating enforcement
├── contract/                                 # isomorphic (published as @bslt/shared/assets or module subpath)
│   ├── schemas.ts                            # AssetMetadata, UploadIntent, FinalizeUpload, Variant, ProbeResult, TransformRequest (one copy, used by server AND client)
│   ├── contract.ts                           # one contract: list/get/intent/finalize/upload(small multipart)/download-url/delete/probe/transform
│   ├── limits.ts                             # per-purpose MIME allowlist + max size (single source; UI reads the same)
│   └── policy.ts                             # pure canRead/canWrite(asset, viewer, entitlements) — owner/tenant/admin/PPV/rating
├── server/
│   ├── ports.ts                              # AssetStore (StorageClient subset), MediaEngine, JobQueue, Entitlements, Metering, EventSink
│   ├── service/
│   │   ├── upload.ts                         # multipart (small) + intent/finalize (large, presigned PUT)
│   │   ├── finalize.ts                       # magic-byte sniff, size/quota check, EXIF strip enqueue, moderation enqueue
│   │   ├── access.ts                         # signed GET for ALL providers (local via HMAC file route, S3 presign), short TTL
│   │   ├── list.ts / delete.ts / probe.ts / transform.ts
│   │   └── *.test.ts
│   ├── avatar.ts                             # avatar = asset with purpose 'avatar' + users.avatar_asset_id; one resolveAvatarUrl used by auth/profile/admin
│   ├── processing/jobs.ts                    # workers-queue job handlers (thumbnail, transcode, strip-metadata, scan) writing variants + status
│   ├── hygiene.ts                            # user deletion + orphan sweep for ALL blobs; registered with retention (starter) and workers (full)
│   ├── events.ts                             # audit + activity + realtime (upload/processing progress) + webhook events
│   └── http/{routes,handlers}.ts             # one route map; signed /assets/blob/:id route replaces unauthenticated /uploads static
├── client/
│   ├── api.ts                                # contract-derived client (no hand-rolled fetch/CSRF)
│   └── hooks.ts                              # useAssets(filter), useUploadAsset(progress, intent/finalize), useAssetUrl, useTransformAsset, useAvatar
├── ui/
│   ├── AssetLibraryPage.tsx                  # replaces FilesPage + MediaStudioPage (kind filter, MediaGallery-based)
│   ├── AssetUploader.tsx / AssetPicker.tsx / AvatarField.tsx
│   └── routes.ts / nav.ts                    # consumed by manifest-driven router + menu
└── tests/
    ├── assets.integration.test.ts            # HTTP for every route incl. media/probe/transform
    └── assets.e2e.ts
```

**[synth]** In the must-remain-shared list below, one entry contains a self-corrected path; the correct path is `main/apps/server/src/http/media/engine.ts:38-56`.

#### T-FILES cross-feature links

- Audit and activity: only avatar upload and delete record audit and activity events (main/server/core/src/users/handlers/avatar.ts:168,180,225,236). Files upload and delete and media upload, transform and delete emit nothing (main/server/core/src/files/service.ts, main/apps/server/src/http/media/service.ts). This is a gap for moderation and payout audit trails.
- Notifications: no link. There are no 'upload processed' or 'file shared' notifications.
- Realtime: no link. Migration 0700 adds files.version for realtime versioning, but nothing publishes file or processing events, and there is no upload-progress channel. The dead media HTTP module has a processing-status endpoint that nothing serves.
- Jobs and workers: the only link is the daily data-hygiene-files job (main/server/workers/src/service.ts:296-330), which is off in starter. Media processing is never enqueued. @bslt/media ships its own in-memory CustomJobQueue and retry handler (main/server/media/src/queue/*), duplicating the Postgres job_queue (0405_job_queue.sql) and workers. The 'media-processing' recipe turns on the workers capability for jobs that do not exist (main/tools/scripts/recipes/registry.ts:478-512, main/tools/setup/manifest.ts:72-75).
- Billing, entitlements and metering: FEATURE_KEYS.STORAGE, MEDIA_PROCESSING and MEDIA_MAX_FILE_SIZE_MB, plus free-tier max_storage_mb (100) and media:max_file_size (10), are defined (main/shared/src/constants/core/billing.ts:13-20, main/shared/src/modules/core/billing/billing.entitlements.ts:58-62) and shown in UsageSummary (main/client/ui/src/components/billing/UsageSummary.tsx:60-63), but no upload path checks quota or entitlement, and the 'storage_gb' metric is never recorded. The key vocabulary also differs: 'storage:limit' vs 'max_storage_mb', and GB in billing.logic.ts:59 vs MB. Pay-per-view and subscription gating has nowhere to attach.
- Entitled downloads exist only in the storefront (main/apps/storefront/src/server.ts:110-111,329-337), via SQLite plus archives, completely separate from @bslt/storage. This is the only entitlement-checked download pattern in the repo and the closest precedent for pay-per-view.
- Tenants: RLS supports tenant-shared files (0901:128-145), but uploads never set tenant_id and services allow only owner or admin, so tenancy is effectively disconnected.
- Admin and moderation: the admin side only gets a storage health status (main/server/core/src/admin/healthHandler.ts:82). StorageClient has no healthCheck, so storage always reports as operational or unknown. There is no admin file browser, moderation queue or takedown. A 'moderator' role exists (main/shared/src/constants/core/auth.ts:13) and ContentModerationResult is typed (main/shared/src/modules/media/media.types.ts:138), but nothing uses either. There are no content-rating or visibility columns, so SFW/softcore separation would be new.
- Compliance and GDPR: data export includes file metadata but not avatars or download links (main/server/core/src/compliance/data-export/service.ts:221-233). Account deletion orphans blobs (retention.ts:72, pii-anonymization.ts:64, CASCADE in 0600:14). Uploaded images keep EXIF and GPS data: avatars and files are stored raw with no sharp pass.
- Auth and users: avatar storage keys are dropped from auth payloads (main/server/core/src/auth/utils/response.ts:13-22,144), so the avatar link to the auth session is broken.
- Feature flags: no link. Gating uses profile capabilities (media) and edition source selection (files), never runtime feature flags. The name feature-flags-files.integration.test.ts implies a link that does not exist.
- Search: no link. Files are not indexed.
- Edition and profile system: files is Pro (main/editions/catalog.ts:30,45), media is Pro and capability-gated, and storage plus avatars are Core. Core edition templates replace route-modules.ts and routes.tsx wholesale, so every new file route also requires editing the edition templates.
- HTTP infrastructure: every upload relies on the global buffer-based multipart parser (main/apps/server/src/bootstrap/app.ts:144). There is no streaming path, so large video uploads for a live-first platform would hold up to 200MB in memory per request.

#### T-FILES dead ends

- main/server/media/src/http/{index,routes,handlers,service,types}.ts (891 LOC): a second media HTTP API with DELETE-method routes, a processing-status endpoint and a queue port. It is exported from @bslt/media and its './http' subpath but has no consumer, and its route keys collide with the app's media routes. It is listed in main/tools/scripts/audit/test-pairs-debt.json:306-308.
- About 3.5k LOC of @bslt/media cannot be reached at runtime: ffmpeg-wrapper.ts (609), processors/{audio,image,video}.ts, queue/{queue,retry,jobs}.ts, utils/streaming.ts, processor.ts (orchestrator), database.ts (InMemoryMediaDatabase), facade.ts (ServerMediaQueue with an entitlement hook), security.ts (BasicSecurityScanner), validation.ts. The app engine uses only getImageFormat, validateImage, resizeImage and optimizeImage (main/apps/server/src/http/media/engine.ts:38-43).
- main/apps/server/src/http/file-server.ts: a signed PUT/GET /uploads file server. It is exported (main/apps/server/src/http/index.ts:10) and tested (file-server.test.ts) but never registered, while app.ts registers an unsigned static route on the same prefix.
- @bslt/storage signing.ts (createSignedUrl, parseSignedUrl, verify, normalizeFilename and others), providers/presigner.ts and config.ts (loadStorageConfig, validateStorage) have zero consumers outside the package, and the package has no tests.
- StorageClient.downloadStream is implemented by both providers and never called. FileRepository.findByTenantId and update are never called at runtime.
- Shared helpers with no consumers outside shared: detectFileType, isAllowedFileType and validateUploadConfig (main/shared/src/modules/media/media.ts); generateUniqueFilename, joinStoragePath, normalizeStoragePath, fileRecordSchema, createFileRecordSchema and updateFileRecordSchema (main/shared/src/modules/storage/files/files.ts); MAX_LOGO_SIZE, MAX_UPLOAD_FILE_SIZE, MAX_CHUNK_SIZE and MAX_UPLOAD_TIMEOUT_MS (main/shared/src/constants/media.ts); the ContentModerationResult type.
- main/client/ui/src/components/media/MediaGallery.tsx (519 LOC plus a test) is exported from @bslt/ui but no app uses it. MediaStudioPage builds its own grid.
- The 'storage' profile capability is checked nowhere at runtime, so toggling it (or the 's3-storage' recipe, main/tools/setup/manifest.ts:71) has no effect.
- FILE_PURPOSES values 'avatar', 'export', 'attachment' and 'other' are never written. Every row is 'document' (main/server/core/src/files/service.ts:116).
- Billing entitlement and metering keys for storage and media are never enforced or recorded.
- /api/media has no shared contract, no generated client entry, no docs/api page, no routeCoverage entry and no HTTP integration test. It is only reachable through the hand-written mediaClient.ts.
- main/apps/web/vite.config.ts:225 aliases the server-only @bslt/media into the web build, and main/server/db/tsconfig.json:25-26 and main/server/realtime/tsconfig.json:37-38 declare @bslt/media path aliases for packages that never import it.

#### T-FILES must remain shared

- Storage adapters stay as an infrastructure package (@bslt/storage: LocalStorageProvider and S3StorageProvider). PRESERVE: atomic temp-then-rename writes with mode 0o600 (local.ts:21-34), key normalization, S3 with endpoint and forcePathStyle for MinIO, R2 and Spaces, real presigned GETs with configurable expiry, and stream releaseLock that closes S3 sockets (s3.ts). Consolidate onto one signing implementation and add tests.
- Keep the StorageClient port in @bslt/shared/contracts (main/shared/src/contracts/contract.ports.ts:72) as the single storage interface, and drop StorageService, the inline HasStorage type, FileStorageProvider, MediaStorageProvider and the avatar StorageProvider. PRESERVE the edition-ports idea (main/shared/src/contracts/edition-ports.ts) that keeps core cleanup free of paid code.
- The @bslt/media engine stays an optional capability adapter behind a narrow MediaEngine port, loaded lazily through importOptionalCapability. PRESERVE engine.ts's lazy load plus export assertion (main/apps/server/src/apps/server/src/http/media/engine.ts:38-56 is wrong path; correct: main/apps/server/src/http/media/engine.ts:38-56) and the well-tested sharp image operations (image-processing.ts, 905-line test). Re-home the FFmpeg processors behind the workers job queue rather than deleting them.
- HTTP infrastructure stays shared: the binary-safe multipart parser (main/shared/src/modules/system/http/multipart.ts, tested); the Range-capable, path-contained, rate-limited static streamer (main/apps/server/src/middleware/static.ts parseRangeHeader), to be reused behind signed access; and route helpers (createScopedRouteHelpers, withRouteOptions bodyLimit).
- The upload-route registration shell stays in the composition app: comms or a new storage phase builds ctx.storage, and the app decides which provider runs.
- Keep one MIME, extension and magic-number table plus file-type sniffing in @bslt/shared (merge the two MAGIC_NUMBERS copies and fix the m4a and RIFF entries). PRESERVE the regex-free wildcard MIME matcher validateFileType (main/shared/src/modules/storage/files/files.ts:379-446) and sanitizeFilename.
- Generic UI primitives stay in @bslt/ui: FileInput, Image and Avatar (lint-enforced sanctioned image primitives, per docs/DIRECTION.md:162), plus MediaGallery as a presentational component the module consumes.
- Shared ID schemas (fileIdSchema), error classes (BadRequestError and others) and the contract and router machinery (main/shared/src/api/router.ts) feeding the generated client, route manifest and API docs stay shared. PRESERVE the contract-first flow that /api/files already uses.
- Cross-cutting services the module consumes but does not own: audit record() and logActivity, the workers job queue (0405), billing entitlement resolution plus usage metering, tenant membership RLS helpers (app_current_user_id, app_current_tenant_id, app_current_user_is_tenant_member from 0901), and the retention sweep runner.
- Edition, profile and prune machinery stays central (main/editions/catalog.ts, main/profiles/_, main/tools/scripts/starter/_), but each module should register itself through a manifest instead of being hard-coded in about 6 places. PRESERVE the explicit packaging guard documenting that media is unshipped (main/apps/server/src/bootstrap/optional-capability-packaging.test.ts:51-58) and the precise MEDIA prune manifest.
- PRESERVE the core files layering (pure service taking explicit storage and repos ports, thin handlers, route map), the repository pattern with column maps, DB CHECK constraints and indexes, FORCE RLS on files, the avatar design that stores the key rather than a URL and re-signs on read, cleanupUserFiles and data-export hooks for GDPR, and the storefront's entitlement-checked, throttled download route (main/apps/storefront/src/server.ts:329-337) as the template for pay-per-view access.

### C.NOTIF. Notifications + Realtime. Scope: in-app feed, preferences and quiet hours, Web Push (VAPID), email one-click unsubscribe, the declared email/SMS channels, admin alerts and broadcast, the Postgres LISTEN/NOTIFY invalidation bus, the /ws gateway and the /api/realtime record-sync API. SUMMARY: The feature spans 217 files across 11 workspace packages and 6 non-package roots. That is about 12.5k non-test LOC and about 16k test LOC in the core sets. Only one path runs end to end: an admin sends from /admin/notifications to POST /api/notifications/send, which checks preferences, writes a row, publishes a payload-free invalidation and pushes over Web Push; the bell then refetches. Every other emitter writes notification rows directly through the repository and skips that pipeline: admin alerts, billing, dunning and invitations. The email and SMS channels, the email unsubscribe gate, the alternative provider config (OneSignal/Courier) and the realtime record-sync API are mostly declared but not connected. DELIBERATE and documented: realtime is an optional Pro capability loaded dynamically (docs/architecture/server-dependency-dag.md:5; docs/DIRECTION.md:40,63,182). Comms adapters are owned by the composition root, so core never imports @bslt/comms (docs/specs/principles.md:79). The client sync engine was removed on 2026-06-12. The socket-plus-poll dual path is intentional (main/apps/web/src/lib/realtime.ts header; docs/log/2026-W32.md:294-335). Notifications are documented as not prunable (docs/dev/prune.md:89). ACCIDENTAL: two persistence paths for preferences and push subscriptions; two different shouldSendNotification models; four emitters that bypass the pipeline; stale code comments that say push is disabled; dead provider config; mismatched data keys for click-routing; a duplicated realtimeContract; the pubsub bus living under shared/db instead of realtime; the web client opening the socket without checking the profile; stale docs/architecture/api-contract-matrix.md. GOOD, PRESERVE: the payload-free {key, version} invalidation plus server-bound per-user channel authorization (main/server/core/src/notifications/publish.ts; main/shared/src/modules/db/pubsub/authorize.ts; main/server/realtime/src/websocket/lifecycle.ts:465-470). The single shared browser socket with backoff, token-reject handling and poll fallback (main/apps/web/src/lib/realtime.ts). Cross-instance fan-out over LISTEN/NOTIFY with instanceId echo suppression (main/server/db/src/pubsub/postgres-pubsub.ts; docs/dev/horizontal-scaling.md). The readPreferences vs getPreferences split, so deciding whether to deliver never writes a row (main/server/core/src/notifications/preferences.ts:52-110). The pure isNotificationAllowed with an injected clock, where quiet hours only gate push/sms. Owner-scoped repository mutations (markAsRead/markManyAsRead/delete take userId). Best-effort push with 404/410 pruning (main/server/core/src/notifications/push-dispatch.ts). The PushNotificationProvider adapter interface. The VAPID capability endpoint answers enabled:false instead of erroring. The HMAC unsubscribe token uses a constant-time compare, and the email_unsubscribes primary key is the invariant. WebSocket hardening: 64KB maxPayload, ping/pong reaping, idempotent teardown, CSRF on upgrade. queryPersistencePolicy excludes notifications. main/tools/scripts/audit/test-pairs-debt.json and main/server/db/src/schema-coverage.test.ts track test and schema gaps honestly. SECURITY (found by code reading, not executed): when the realtime capability is enabled (full profile / Pro), POST /api/realtime/getRecords returns whole users rows, including password_hash, for any id. POST /api/realtime/write can change non-protected users columns such as role on any row, because no ownership check exists and canWriteRecord is never called.

- **Packages touched:** 11
- **Total files:** 217
- **Wiring points:** 30

#### T-NOTIF per-layer file list

**SQL migrations/tables (notifications, push_subscriptions, notification_preferences, email_unsubscribes; dropped email_templates/email_log; version columns; RLS)** (6 files)

- `main/server/db/migrations/0300_notifications.sql`
- `main/server/db/migrations/0301_email.sql`
- `main/server/db/migrations/0700_realtime_versions.sql`
- `main/server/db/migrations/0900_rls.sql`
- `main/server/db/migrations/0914_email_unsubscribes.sql`
- `main/server/db/migrations/0917_drop_orphaned_email_tables.sql`

**server/db (@bslt/db): row types, repositories, pubsub adapter, write-service, barrels/factory** (20 files)

- `main/server/db/src/schema/notifications.ts`
- `main/server/db/src/schema/push.ts`
- `main/server/db/src/schema/index.ts`
- `main/server/db/src/repositories/notifications/index.ts`
- `main/server/db/src/repositories/notifications/notifications.ts`
- `main/server/db/src/repositories/notifications/notifications.test.ts`
- `main/server/db/src/repositories/push/index.ts`
- `main/server/db/src/repositories/push/push-subscriptions.ts`
- `main/server/db/src/repositories/push/push-subscriptions.test.ts`
- `main/server/db/src/repositories/push/notification-preferences.ts`
- `main/server/db/src/repositories/push/notification-preferences.test.ts`
- `main/server/db/src/repositories/index.ts`
- `main/server/db/src/factory.ts`
- `main/server/db/src/index.ts`
- `main/server/db/src/validation.ts`
- `main/server/db/src/pubsub/index.ts`
- `main/server/db/src/pubsub/postgres-pubsub.ts`
- `main/server/db/src/pubsub/postgres-pubsub.test.ts`
- `main/server/db/src/queue/write-service.ts`
- `main/server/db/src/schema-coverage.test.ts`

**server/core notifications module (@bslt/core/notifications): handlers, routes, send pipeline, preferences, push dispatch, realtime publish, unsubscribe, admin alerts** (18 files)

- `main/server/core/src/notifications/index.ts`
- `main/server/core/src/notifications/types.ts`
- `main/server/core/src/notifications/routes.ts`
- `main/server/core/src/notifications/handlers.ts`
- `main/server/core/src/notifications/handlers.test.ts`
- `main/server/core/src/notifications/send.ts`
- `main/server/core/src/notifications/send.test.ts`
- `main/server/core/src/notifications/preferences.ts`
- `main/server/core/src/notifications/preferences.test.ts`
- `main/server/core/src/notifications/subscriptions.ts`
- `main/server/core/src/notifications/subscriptions.test.ts`
- `main/server/core/src/notifications/push-dispatch.ts`
- `main/server/core/src/notifications/push-dispatch.test.ts`
- `main/server/core/src/notifications/publish.ts`
- `main/server/core/src/notifications/publish.test.ts`
- `main/server/core/src/notifications/unsubscribe.ts`
- `main/server/core/src/notifications/admin-alerts.ts`
- `main/server/core/src/notifications/admin-alerts.test.ts`

**server/core cross-module emitters and wiring (call notifyAdmins, or write repos.notifications directly)** (15 files)

- `main/server/core/src/route-modules.ts`
- `main/server/core/src/index.ts`
- `main/server/core/package.json`
- `main/server/core/src/auth/handlers/login.ts`
- `main/server/core/src/auth/service.ts`
- `main/server/core/src/auth/password/service.ts`
- `main/server/core/src/users/handlers/lifecycle.ts`
- `main/server/core/src/users/handlers/account.ts`
- `main/server/core/src/billing/handlers/support.ts`
- `main/server/core/src/billing/handlers/subscriptions.ts`
- `main/server/core/src/billing/handlers/payment-methods.ts`
- `main/server/core/src/billing/payment-notifications.ts`
- `main/server/core/src/billing/billing-notifier.ts`
- `main/server/core/src/tenants/invitation-service.ts`
- `main/server/core/src/compliance/data-export/service.ts`

**server/comms (@bslt/comms): Web Push provider, email header support, SMS provider (only used by 2FA)** (9 files)

- `main/server/comms/src/index.ts`
- `main/server/comms/src/notifications/providers/index.ts`
- `main/server/comms/src/notifications/providers/types.ts`
- `main/server/comms/src/notifications/providers/factory.ts`
- `main/server/comms/src/notifications/providers/factory.test.ts`
- `main/server/comms/src/notifications/providers/web-push-provider.ts`
- `main/server/comms/src/notifications/providers/web-push-provider.test.ts`
- `main/server/comms/src/email/smtp.client.ts`
- `main/server/comms/src/sms/factory.ts`

**server/realtime (@bslt/realtime, optional/Pro): /ws gateway, stats, record-sync HTTP API, unused permission engine** (22 files)

- `main/server/realtime/package.json`
- `main/server/realtime/src/index.ts`
- `main/server/realtime/src/types.ts`
- `main/server/realtime/src/routes.ts`
- `main/server/realtime/src/routes.test.ts`
- `main/server/realtime/src/service.ts`
- `main/server/realtime/src/service.test.ts`
- `main/server/realtime/src/handlers/index.ts`
- `main/server/realtime/src/handlers/subscribe.ts`
- `main/server/realtime/src/handlers/subscribe.test.ts`
- `main/server/realtime/src/handlers/sync.ts`
- `main/server/realtime/src/handlers/sync.test.ts`
- `main/server/realtime/src/permissions/index.ts`
- `main/server/realtime/src/permissions/permissions.ts`
- `main/server/realtime/src/permissions/permission.filter.ts`
- `main/server/realtime/src/permissions/permission.middleware.ts`
- `main/server/realtime/src/permissions/permission.propagation.ts`
- `main/server/realtime/src/websocket/index.ts`
- `main/server/realtime/src/websocket/lifecycle.ts`
- `main/server/realtime/src/websocket/lifecycle.test.ts`
- `main/server/realtime/src/websocket/stats.ts`
- `main/server/realtime/src/websocket/stats.test.ts`

**server/system (@bslt/server-system): provider config and health** (5 files)

- `main/server/system/src/config/services/notifications.ts`
- `main/server/system/src/config/services/notifications.test.ts`
- `main/server/system/src/config/factory.ts`
- `main/server/system/src/config/index.ts`
- `main/server/system/src/runtime/health.ts`

**server/workers (@bslt/workers): scheduled jobs** (1 files)

- `main/server/workers/src/service.ts`

**apps/server composition root and registration** (9 files)

- `main/apps/server/src/bootstrap/phases/infra.ts`
- `main/apps/server/src/bootstrap/phases/data.ts`
- `main/apps/server/src/bootstrap/phases/comms.ts`
- `main/apps/server/src/bootstrap/phases/workers.ts`
- `main/apps/server/src/bootstrap/app.ts`
- `main/apps/server/src/bootstrap/context.ts`
- `main/apps/server/src/bootstrap/generated/profile.generated.ts`
- `main/apps/server/src/http/route-modules.ts`
- `main/apps/server/src/http/system-routes.ts`

**shared (@bslt/shared): contracts, ports, router, constants, comms/notifications schemas and types, db/pubsub bus, realtime ops, env config** (39 files)

- `main/shared/src/contracts/contract.notifications.ts`
- `main/shared/src/contracts/contract.realtime.ts`
- `main/shared/src/contracts/contract.ports.ts`
- `main/shared/src/contracts/context.ts`
- `main/shared/src/contracts/index.ts`
- `main/shared/src/api/router.ts`
- `main/shared/src/constants/core/notifications.ts`
- `main/shared/src/modules/comms/index.ts`
- `main/shared/src/modules/comms/notifications/index.ts`
- `main/shared/src/modules/comms/notifications/notifications.types.ts`
- `main/shared/src/modules/comms/notifications/notifications.schemas.ts`
- `main/shared/src/modules/comms/notifications/notifications.schemas.test.ts`
- `main/shared/src/modules/comms/notifications/notifications.push.schemas.ts`
- `main/shared/src/modules/comms/notifications/notifications.push.schemas.test.ts`
- `main/shared/src/modules/comms/notifications/notifications.logic.ts`
- `main/shared/src/modules/comms/notifications/notifications.logic.test.ts`
- `main/shared/src/modules/comms/notifications/notifications.display.ts`
- `main/shared/src/modules/comms/notifications/notifications.display.test.ts`
- `main/shared/src/modules/comms/notifications/notifications.errors.ts`
- `main/shared/src/modules/comms/notifications/notifications.errors.test.ts`
- `main/shared/src/modules/comms/email/email.ts`
- `main/shared/src/modules/comms/sms/sms.ts`
- `main/shared/src/modules/db/pubsub/index.ts`
- `main/shared/src/modules/db/pubsub/types.ts`
- `main/shared/src/modules/db/pubsub/types.test.ts`
- `main/shared/src/modules/db/pubsub/authorize.ts`
- `main/shared/src/modules/db/pubsub/authorize.test.ts`
- `main/shared/src/modules/db/pubsub/helpers.ts`
- `main/shared/src/modules/db/pubsub/helpers.test.ts`
- `main/shared/src/modules/db/pubsub/subscription.manager.ts`
- `main/shared/src/modules/db/pubsub/subscription.manager.test.ts`
- `main/shared/src/modules/db/pubsub/postgres.pubsub.ts`
- `main/shared/src/modules/realtime/index.ts`
- `main/shared/src/modules/realtime/realtime.ts`
- `main/shared/src/modules/realtime/realtime.test.ts`
- `main/shared/src/modules/system/config/env.notification.ts`
- `main/shared/src/modules/system/config/env.notification.test.ts`
- `main/shared/src/modules/system/runtime/health.ts`
- `main/shared/src/schema/ids.ts`

**client/api (@bslt/api): hand-written NotificationClient, browser push helpers, generated route table** (6 files)

- `main/client/api/src/notifications/client.ts`
- `main/client/api/src/notifications/client.test.ts`
- `main/client/api/src/notifications/index.ts`
- `main/client/api/src/index.ts`
- `main/client/api/src/generated/client.ts`
- `main/client/api/src/utils.ts`

**client/react, client/ui, client/engine: no notification- or realtime-specific code. Hooks live in apps/web, unlike billing/devices/legal/oauth/phone/webhooks hooks in main/client/react/src/\*. Only generic Badge/Button/useQuery/useMutation are consumed.** (0 files)

- (none)

**apps/web: feature module, realtime client, layout mount, settings tab, admin sender, unsubscribe page, service worker, route coverage** (36 files)

- `main/apps/web/src/features/notifications/index.ts`
- `main/apps/web/src/features/notifications/components/index.ts`
- `main/apps/web/src/features/notifications/components/NotificationBell.tsx`
- `main/apps/web/src/features/notifications/components/NotificationBell.test.tsx`
- `main/apps/web/src/features/notifications/components/NotificationDropdown.tsx`
- `main/apps/web/src/features/notifications/components/NotificationDropdown.test.tsx`
- `main/apps/web/src/features/notifications/hooks/index.ts`
- `main/apps/web/src/features/notifications/hooks/useNotifications.ts`
- `main/apps/web/src/features/notifications/hooks/useNotifications.test.ts`
- `main/apps/web/src/features/notifications/hooks/useNotificationPreferences.ts`
- `main/apps/web/src/features/notifications/hooks/useNotificationPreferences.test.tsx`
- `main/apps/web/src/features/notifications/hooks/usePushNotifications.ts`
- `main/apps/web/src/features/notifications/hooks/usePushNotifications.test.ts`
- `main/apps/web/src/features/notifications/utils/index.ts`
- `main/apps/web/src/features/notifications/utils/getNotificationRoute.ts`
- `main/apps/web/src/features/notifications/utils/getNotificationRoute.test.ts`
- `main/apps/web/src/lib/realtime.ts`
- `main/apps/web/src/lib/realtime.test.ts`
- `main/apps/web/src/app/layouts/AppTopLayout.tsx`
- `main/apps/web/src/app/routes.tsx`
- `main/apps/web/src/app/queryPersistencePolicy.ts`
- `main/apps/web/src/features/settings/components/NotificationPreferencesForm.tsx`
- `main/apps/web/src/features/settings/components/NotificationPreferencesForm.test.tsx`
- `main/apps/web/src/features/settings/components/AccountModal.tsx`
- `main/apps/web/src/features/settings/components/index.ts`
- `main/apps/web/src/features/settings/settingsTabs.ts`
- `main/apps/web/src/features/settings/accountModalStore.ts`
- `main/apps/web/src/features/admin/pages/NotificationSenderPage.tsx`
- `main/apps/web/src/features/admin/pages/index.ts`
- `main/apps/web/src/features/admin/adminSurface.ts`
- `main/apps/web/src/features/admin/components/ActiveConnectionsWidget.tsx`
- `main/apps/web/src/pages/EmailUnsubscribePage.tsx`
- `main/apps/web/public/sw.js`
- `main/apps/web/src/sw.test.ts`
- `main/apps/web/src/demo/api-routes/routeCoverage.ts`
- `main/apps/web/src/bootstrap/generated/profile.generated.ts`

**tests (repo-level integration + e2e; colocated unit tests are counted in their own layers)** (8 files)

- `tests/integration/api/notifications.integration.test.ts`
- `tests/integration/api/notifications.real-db.test.ts`
- `tests/integration/api/admin-alerts.real-db.test.ts`
- `tests/integration/api/security-notifications.integration.test.ts`
- `tests/integration/api/realtime.integration.test.ts`
- `tests/integration/api/realtime-permissions.integration.test.ts`
- `tests/integration/api/websocket-auth.integration.test.ts`
- `tests/e2e/specs/notifications/notifications.e2e.ts`

**docs** (9 files)

- `docs/api/notifications.md`
- `docs/DIRECTION.md`
- `docs/CLAUDE.md`
- `docs/dev/configuration.md`
- `docs/dev/horizontal-scaling.md`
- `docs/architecture/api-contract-matrix.md`
- `docs/architecture/layer-map.md`
- `docs/recipes/README.md`
- `docs/log/2026-W32.md`

**editions / profiles / flags / tooling / config / infra gating** (14 files)

- `main/editions/catalog.ts`
- `main/editions/core/main/apps/server/src/bootstrap/phases/comms.ts.template`
- `main/editions/core/main/apps/web/src/app/layouts/AppLayout.tsx.template`
- `main/profiles/capability-registry.ts`
- `main/profiles/capability-groups.ts`
- `main/profiles/profiles.starter.ts`
- `main/profiles/profiles.full.ts`
- `main/tools/scripts/recipes/registry.ts`
- `main/tools/scripts/starter/prune.ts`
- `main/tools/scripts/starter/prune-manifests-packages.ts`
- `main/tools/scripts/audit/route-contract-coverage.ts`
- `main/tools/scripts/audit/test-pairs-debt.json`
- `config/env/.env.production.example`
- `infra/runtime/caddy/Caddyfile`

#### T-NOTIF wiring points

- `main/server/db/src/factory.ts:132-134,153-154,227-229,248-249`: Registers the pushSubscriptions, notificationPreferences and notifications repositories in the Repositories container
- `main/server/db/src/repositories/index.ts:42-48,83-84; main/server/db/src/index.ts:85-100,324-375,556-558; main/server/db/src/schema/index.ts:69-85,174-183`: Three hand-maintained barrels re-export schema constants, row types, repo factories and PostgresPubSub
- `main/server/db/src/validation.ts:45-48`: REQUIRED_TABLES lists notifications, push_subscriptions and notification_preferences; email_unsubscribes is not listed
- `main/server/db/migrations/0900_rls.sql:26-28,99-110`: User-scoped RLS policies on the three notification tables
- `main/server/core/src/route-modules.ts:19,41`: Adds notificationRoutes to coreRouteModuleRegistrations (module 'notifications')
- `main/server/core/package.json:35-38`: Exposes @bslt/core/notifications as a subpath export
- `main/apps/server/src/http/route-modules.ts:32-43,58,72`: Dynamically imports @bslt/realtime realtimeRoutes when isServerCapabilityEnabled('realtime')
- `main/apps/server/src/bootstrap/phases/infra.ts:51`: Always constructs the SubscriptionManager (ctx.pubsub), whatever the profile
- `main/apps/server/src/bootstrap/phases/data.ts:81-92,121-125`: Always starts the Postgres LISTEN/NOTIFY adapter (two dedicated connections) and builds the unused WriteService
- `main/apps/server/src/bootstrap/phases/comms.ts:146-155,179-201`: Loads the Web Push provider through createNotificationProviderServiceFromEnv (reads process.env, bypassing AppConfig), loads SMS, and builds billingNotifier with repos.notifications
- `main/apps/server/src/bootstrap/phases/workers.ts:71-85,107-120,159-161`: Registers the /ws WebSocket upgrade and its stats. This realtime wiring sits in the 'workers' phase and is gated on the realtime capability
- `main/apps/server/src/http/system-routes.ts:85-93,175-178`: Puts WebSocket stats into detailed health (not into /api/admin/metrics)
- `main/apps/server/src/bootstrap/app.ts:490-491,529-535,572-573; main/apps/server/src/bootstrap/context.ts:46,58,65,137-158`: Exposes pubsub, notifications (NotificationService) and write on the handler context
- `main/server/workers/src/service.ts:165-174`: Weekly push-cleanup job (repos.pushSubscriptions.deleteExpired); there is no notifications retention job
- `main/server/system/src/config/factory.ts:17,191,263; main/server/system/src/runtime/health.ts:327`: Loads and validates the OneSignal/Courier config into AppConfig.notifications; its only consumer is the startup summary line
- `main/shared/src/api/router.ts:20,43; main/shared/src/contracts/index.ts:23-24`: notificationsContract is in apiRouter; realtimeContract is exported but absent from apiRouter
- `main/client/api/src/index.ts:145-163; main/client/api/src/generated/client.ts:189-222`: Public export of createNotificationClient, plus the generated route table for the 12 notification routes (no realtime routes)
- `main/apps/web/src/app/layouts/AppTopLayout.tsx:21-25,113-128,254-271`: The only mount point of the bell and dropdown; calls useNotifications (poll and socket) and getNotificationRoute
- `main/apps/web/src/app/routes.tsx:132-134,377-379,476-477`: Admin route /admin/notifications (NotificationSenderPage) and public route email/unsubscribe/:token
- `main/apps/web/src/features/settings/components/AccountModal.tsx:52,262-268,394-395; main/apps/web/src/features/settings/settingsTabs.ts:15,32,44,52; main/apps/web/src/features/settings/accountModalStore.ts:17`: Notifications settings tab that renders NotificationPreferencesForm
- `main/apps/web/src/features/admin/adminSurface.ts:120-123`: Admin navigation entry for Notifications
- `main/apps/web/src/app/queryPersistencePolicy.ts:28`: Keeps the 'notifications' query keys out of the persisted cache
- `main/apps/web/public/sw.js:409-537`: Untyped push, notificationclick and notificationclose service-worker handlers
- `main/profiles/capability-registry.ts:65-73; main/profiles/profiles.starter.ts:8; main/profiles/profiles.full.ts:12-14; main/apps/server/src/bootstrap/generated/profile.generated.ts:20-21; main/apps/web/src/bootstrap/generated/profile.generated.ts:20-21`: Realtime capability flag: off in starter, on in full. comms is minimal (on)
- `main/editions/catalog.ts:11,20,60,116-124`: Edition ownership: notifications web, server and API are Core; main/server/realtime and features/admin are Pro
- `main/editions/core/main/apps/server/src/bootstrap/phases/comms.ts.template:5-6,60-61`: Core-edition copy of the comms wiring (a second place to keep in sync)
- `main/tools/scripts/audit/route-contract-coverage.ts:73`: Exempts the realtime module from route-contract coverage
- `main/tools/scripts/starter/prune.ts:136; main/tools/scripts/starter/prune-manifests-packages.ts:233-461`: Realtime prune manifest; notifications explicitly listed as not prunable
- `main/tools/scripts/recipes/registry.ts:520-604`: Realtime and push-notifications recipes (still advertise OneSignal placeholders)
- `infra/runtime/caddy/Caddyfile:71-82`: /ws upgrade proxy

#### T-NOTIF adding an endpoint

1. Worked example: a user-scoped endpoint with UI in the bell, such as POST /api/notifications/mark-unread.
2. main/shared/src/modules/comms/notifications/notifications.schemas.ts: add the request/response interfaces and schemas.
3. main/shared/src/modules/comms/notifications/index.ts: re-export the new symbols (first explicit barrel).
4. main/shared/src/modules/comms/index.ts: re-export them again (second explicit barrel; contract.notifications.ts imports from '../modules/comms').
5. main/shared/src/contracts/contract.notifications.ts: add the contract entry (method, path, body, responses).
6. main/server/db/src/repositories/notifications/notifications.ts and main/server/db/src/repositories/notifications/notifications.test.ts: add the repository method and its test (interface and implementation, owner-scoped).
7. main/server/core/src/notifications/handlers.ts and main/server/core/src/notifications/handlers.test.ts: add the handler and its test (repeats the req.user guard and the try/catch/log boilerplate).
8. main/server/core/src/notifications/routes.ts: add the route-map entry (path string written a second time).
9. main/server/core/src/notifications/index.ts: export the handler.
10. main/server/core/src/notifications/publish.ts: only needed if the change must wake other tabs; publishNotificationCreated is named for creates only.
11. main/client/api/src/notifications/client.ts and main/client/api/src/notifications/client.test.ts: add the method to the NotificationClient interface and implementation (path string written a third time) and test it.
12. main/client/api/src/index.ts: export any new response type.
13. main/client/api/src/generated/client.ts: regenerate with main/tools/scripts/build/generate-api-client.ts.
14. main/apps/web/src/features/notifications/hooks/useNotifications.ts and main/apps/web/src/features/notifications/hooks/useNotifications.test.ts: add the mutation and its result field, with a test.
15. main/apps/web/src/features/notifications/components/NotificationDropdown.tsx and main/apps/web/src/features/notifications/components/NotificationDropdown.test.tsx: add the UI action prop and its test.
16. main/apps/web/src/app/layouts/AppTopLayout.tsx: plumb the new callback from useNotifications into NotificationDropdown.
17. main/apps/web/src/demo/api-routes/routeCoverage.ts: add the route to MUTATION_SMOKE_ROUTE_KEYS and FRONTEND_CALLER_ROUTE_KEYS.
18. tests/integration/api/notifications.integration.test.ts: add the auth-guard and behaviour cases.
19. tests/e2e/specs/notifications/notifications.e2e.ts: add the UI flow.
20. docs/api/notifications.md: regenerate with main/tools/scripts/docs/generate-api-docs.ts.
21. main/tools/scripts/audit/test-pairs-debt.json: update only if a new file ships without a paired test.
22. Total: about 20 files in 6 packages, with no i18n file because the notification UI has no locale keys.

#### T-NOTIF inconsistencies

**T-NOTIF-I01.** [ACCIDENTAL] The SQL enum named notification_type holds severity LEVELS (info/success/warning/error), while the TS type NotificationType is the CATEGORY (system/security/marketing/social/transactional). The notifications table has no category column, so the category ends up in untyped data.notificationType JSON, and preferences (keyed by category) can never be queried against stored rows.

Evidence:

- main/server/db/migrations/0300_notifications.sql:11,20
- main/shared/src/constants/core/notifications.ts:26-34
- main/server/db/src/schema/notifications.ts:33-43 (type: NotificationLevel)
- main/server/core/src/notifications/send.ts:38-46 (category stored as data.notificationType)

**T-NOTIF-I02.** [ACCIDENTAL] There are two persistence paths for the same tables. db repositories createNotificationPreferenceRepository (upsert) and createPushSubscriptionRepository.create/findByEndpoint are registered in the repo factory, but core re-implements the same SQL inline with the query builder plus toCamelCase. Production calls only deleteExpired, findByUserId and deleteByEndpoint.

Evidence:

- main/server/db/src/repositories/push/notification-preferences.ts:84-121
- main/server/db/src/repositories/push/push-subscriptions.ts:84-129
- main/server/core/src/notifications/preferences.ts:9-17,38-50,92-120,135-218
- main/server/core/src/notifications/subscriptions.ts:9-16,38-99
- main/server/db/src/factory.ts:228-229

**T-NOTIF-I03.** [ACCIDENTAL] There are two shouldSendNotification functions with incompatible preference models. shared/notifications.logic.ts uses {emailEnabled, pushEnabled, categories} (NotificationPreferencesConfig, an unused schema). core/preferences.ts uses the stored {globalEnabled, quietHours, types{enabled, channels}}. Both are exported publicly.

Evidence:

- main/shared/src/modules/comms/notifications/notifications.logic.ts:19-34
- main/shared/src/modules/comms/notifications/notifications.schemas.ts:76-81,142
- main/server/core/src/notifications/preferences.ts:237-263
- main/server/core/src/notifications/index.ts:37

**T-NOTIF-I04.** [ACCIDENTAL] Code comments contradict the implementation. send.ts and three handler doc blocks say Web Push is removed or disabled, while push-dispatch.ts delivers it and handleSendNotification calls deliverWebPush. handleTestNotification really is in-app only, yet the 'Send Test' button sits in the settings 'Push Device' row.

Evidence:

- main/server/core/src/notifications/send.ts:6-7
- main/server/core/src/notifications/handlers.ts:93,347,390 vs 458
- main/server/core/src/notifications/handlers.ts:354-379 (test = in-app only)
- main/apps/web/src/features/settings/components/NotificationPreferencesForm.tsx:222-257

**T-NOTIF-I05.** [ACCIDENTAL] The provider config is split and partly dead. AppConfig.notifications loads OneSignal/Courier/Knock/SNS/Braze and validates it, but only the startup summary reads it. The real push provider (VAPID) is read straight from process.env in comms, bypassing the validated env schema that also declares VAPID_*. The env example lists 'fcm', which is not in the enum. Provider lists are defined twice.

Evidence:

- main/server/system/src/config/services/notifications.ts:61-150
- main/server/system/src/runtime/health.ts:327
- main/server/comms/src/notifications/providers/factory.ts:105-115
- main/shared/src/modules/system/config/env.notification.ts:245-252,281-314,378-384
- main/shared/src/constants/core/notifications.ts:13-20
- config/env/.env.production.example:49

**T-NOTIF-I06.** [ACCIDENTAL] Contract, handler and client shapes drift apart. The contract declares markRead/markAllRead 200 as {message}, but the handler returns {message, count} and the client parses markReadResponseSchema {message, count}. The contract's listNotifications declares no query, while the handler parses limit/offset by hand. The shared notificationsListRequestSchema uses CURSOR pagination and is never used. handleDeleteNotification takes an inline {id: string} instead of NotificationDeleteRequest.

Evidence:

- main/shared/src/contracts/contract.notifications.ts:27-30,107-136
- main/server/core/src/notifications/handlers.ts:500-511,563-583,646-650
- main/client/api/src/notifications/client.ts:250-275
- main/shared/src/modules/comms/notifications/notifications.schemas.ts:84-87,176-187

**T-NOTIF-I07.** [ACCIDENTAL] Route paths are hand-written in four places and drift. They appear in the contract, the core route map, client/api and generated/client.ts. The handler doc says 'PUT /api/notifications/preferences' while the route is /preferences/update. All mutations are RPC-style POSTs, including /delete.

Evidence:

- main/shared/src/contracts/contract.notifications.ts:35-151
- main/server/core/src/notifications/routes.ts:80-197
- main/client/api/src/notifications/client.ts:141-275
- main/client/api/src/generated/client.ts:189-222
- main/server/core/src/notifications/handlers.ts:293

**T-NOTIF-I08.** [ACCIDENTAL] Four or more emitters bypass the pipeline. Only createInAppNotification checks preferences, publishes the realtime invalidation and sends push. notifyAdmins, billing tryNotification, payment-notifications and invitation-service write repos.notifications.create directly, so those notifications never wake the bell (they wait up to the 60s poll), never push, and ignore preferences.

Evidence:

- main/server/core/src/notifications/send.ts:88-107 (only publishNotificationCreated call site)
- main/server/core/src/notifications/admin-alerts.ts:159-169
- main/server/core/src/billing/handlers/support.ts:55-60
- main/server/core/src/billing/payment-notifications.ts:143-147,211-214,287-291
- main/server/core/src/tenants/invitation-service.ts:335-343

**T-NOTIF-I09.** [ACCIDENTAL] The untyped data payload means click-routing mismatches the emitters. getNotificationRoute matches data.notificationType values 'invite_received', 'security_alert' and 'billing_*', which no server code emits (the server writes category names). Billing emits data.action 'billing.subscription_cancel', which does route, but payment-notifications emits action 'payment_failed', which does not. Admin alerts use data.eventType, which is never routed. The query-string routes '/settings?tab=…' do not match the 'settings/:tab' route.

Evidence:

- main/apps/web/src/features/notifications/utils/getNotificationRoute.ts:14-46
- main/server/core/src/notifications/send.ts:38-46
- main/server/core/src/notifications/admin-alerts.ts:152-157
- main/server/core/src/billing/payment-notifications.ts:143-147
- main/shared/src/modules/core/activities/activities.types.ts:66,71
- main/apps/web/src/app/routes.tsx:559

**T-NOTIF-I10.** [ACCIDENTAL] Types and constants are duplicated across layers. NOTIFICATION_LEVELS is defined in both constants and schemas. NotificationTypePreference is in types.ts and push.schemas.ts. Quiet hours appears as QuietHours (push.schemas), QuietHoursConfig (db schema/push.ts) and inline in NotificationPreferences. PushSubscription means three different things: the shared browser shape, the db row and the DOM global used in client/api. ProviderNotConfiguredError is declared in both the notifications and billing errors. The web form and admin page redeclare NOTIFICATION_TYPES/CHANNELS/PRIORITIES locally.

Evidence:

- main/shared/src/constants/core/notifications.ts:34
- main/shared/src/modules/comms/notifications/notifications.schemas.ts:43
- main/shared/src/modules/comms/notifications/notifications.types.ts:90-118
- main/shared/src/modules/comms/notifications/notifications.push.schemas.ts:271,317
- main/server/db/src/schema/push.ts:97-102
- main/shared/src/modules/comms/notifications/notifications.errors.ts:129
- main/shared/src/modules/core/billing/billing.errors.ts:224
- main/apps/web/src/features/settings/components/NotificationPreferencesForm.tsx:47-62
- main/apps/web/src/features/admin/pages/NotificationSenderPage.tsx:34-42

**T-NOTIF-I11.** [DELIBERATE, but it costs type safety] Ports are typed as unknown, so core duck-types at runtime. HasPubSub.pubsub is unknown and NotificationService.getWebPushProvider() returns unknown. As a result core re-declares local PushProvider and NotificationPubSub interfaces with runtime guards. The comms PushNotificationProvider interface is a third definition. This follows from the rule that core must not import comms.

Evidence:

- main/shared/src/contracts/context.ts:85-87
- main/shared/src/contracts/contract.ports.ts:416-421
- main/server/core/src/notifications/push-dispatch.ts:20-40
- main/server/core/src/notifications/publish.ts:31-44
- main/server/core/src/notifications/handlers.ts:118-130
- main/server/comms/src/notifications/providers/types.ts:25-67
- docs/specs/principles.md:79

**T-NOTIF-I12.** [ACCIDENTAL] realtimeContract is defined twice, byte-for-byte equivalent, and neither copy is registered in apiRouter. The realtime routes are also exempt from route-contract coverage, while docs/CLAUDE.md claims zero audit exemptions.

Evidence:

- main/shared/src/modules/realtime/realtime.ts:456-493
- main/shared/src/contracts/contract.realtime.ts:15-41
- main/shared/src/api/router.ts:32-51
- main/tools/scripts/audit/route-contract-coverage.ts:73
- docs/CLAUDE.md:44-46

**T-NOTIF-I13.** [ACCIDENTAL] The realtime transport is split across capabilities. The bus (SubscriptionManager, channel keys, authorization, frame types) lives in shared/modules/db/pubsub, which belongs to capability 'db' and is always on, and is always started by apps/server. Only the WS gateway lives in the optional 'realtime' package, whose sharedModuleRoot points at modules/realtime (record-sync ops only). The shared PostgresPubSub type mirror has drifted from the server class: default channel 'pubsub' vs 'app_events', and no onMessage or ssl.

Evidence:

- main/shared/src/modules/db/pubsub/index.ts:1-40
- main/profiles/capability-registry.ts:65-73
- main/apps/server/src/bootstrap/phases/infra.ts:51
- main/apps/server/src/bootstrap/phases/data.ts:81-92
- main/shared/src/modules/db/pubsub/postgres.pubsub.ts:29-36
- main/server/db/src/pubsub/postgres-pubsub.ts:23-35,47

**T-NOTIF-I14.** [ACCIDENTAL] The web realtime client ignores profile and edition gating. useNotifications always calls subscribeToKey, which opens /ws even in the starter profile (realtime off, so no upgrade handler is registered) and in the Core edition (realtime is a Pro package). The client then reconnects with backoff forever. The web generated profile is 'starter' with realtime disabled.

Evidence:

- main/apps/web/src/features/notifications/hooks/useNotifications.ts:104-114
- main/apps/web/src/lib/realtime.ts:136-195
- main/apps/web/src/bootstrap/generated/profile.generated.ts:20-21
- main/apps/server/src/bootstrap/phases/workers.ts:107-120
- main/editions/catalog.ts:116-124

**T-NOTIF-I15.** [ACCIDENTAL, SECURITY] Code reading shows the realtime record API is reachable without any record-level authorization when the capability is enabled. getRecords runs select(tableName) on 'users' with no column projection and no ownership check. write only checks that authorId equals the caller, and PROTECTED_FIELDS does not include role, email or token_version. The permission engine (canWriteRecord, filterRecordsForUser) exists but is never called. The tests cover the auth guards and the authorId mismatch, but not cross-user reads or writes. Not executed.

Evidence:

- main/server/realtime/src/service.ts:34-36,108-155,232-251
- main/server/realtime/src/handlers/sync.ts:144-170
- main/server/realtime/src/handlers/subscribe.ts:73-108
- main/shared/src/modules/realtime/realtime.ts:176-183,506-508
- main/server/realtime/src/permissions/permissions.ts:84,139
- tests/integration/api/realtime.integration.test.ts:304-590

**T-NOTIF-I16.** [ACCIDENTAL] Push subscription constraints exist in code but not in the DB. Code treats endpoint as unique (check-then-insert in subscribe, and findByEndpoint/deleteByEndpoint), but no UNIQUE index exists, so the check-then-insert can race. repo.deleteByEndpoint is not user-scoped. is_active is never set false, and last_used_at is never touched on send.

Evidence:

- main/server/db/migrations/0300_notifications.sql:31-43,77-80
- main/server/core/src/notifications/subscriptions.ts:44-99
- main/server/db/src/repositories/push/push-subscriptions.ts:110-115
- main/server/core/src/notifications/push-dispatch.ts:64-93

**T-NOTIF-I17.** [ACCIDENTAL] Migration commentary contradicts schema and code. 0914 says 0900 enables RLS only on tenant-owned tables, but 0900 enables user-scoped RLS on the three notification tables. 0914 also says the unsubscribe URL goes in the List-Unsubscribe header of every email, but generateUnsubscribeHeaders has no caller. It says one-click (RFC 8058) is advertised, but only a GET route exists, while one-click requires POST.

Evidence:

- main/server/db/migrations/0914_email_unsubscribes.sql:9-30
- main/server/db/migrations/0900_rls.sql:26-28,99-110
- main/server/core/src/notifications/unsubscribe.ts:113-126
- main/server/core/src/notifications/routes.ts:192-196

**T-NOTIF-I18.** [ACCIDENTAL] Three different client-construction patterns exist inside one feature. useNotifications builds its own client from useClientEnvironment. useNotificationPreferences and usePushSubscription require a caller-supplied clientConfig. NotificationSenderPage and NotificationPreferencesForm each rebuild the same {baseUrl, getToken, onUnauthorized} triple. EmailUnsubscribePage uses createGeneratedApiClient instead. Notification hooks live in apps/web, while comparable domain hooks live in client/react/src/{billing,devices,phone,webhooks}.

Evidence:

- main/apps/web/src/features/notifications/hooks/useNotifications.ts:58-71
- main/apps/web/src/features/notifications/hooks/useNotificationPreferences.ts:42-58
- main/apps/web/src/features/settings/components/NotificationPreferencesForm.tsx:73-86
- main/apps/web/src/features/admin/pages/NotificationSenderPage.tsx:75-84
- main/apps/web/src/pages/EmailUnsubscribePage.tsx:37-43
- main/client/react/src/billing

**T-NOTIF-I19.** [ACCIDENTAL] The unsubscribe UX is duplicated. The API handler returns a full inline HTML page in JSON (body.html), which the SPA page ignores. Meanwhile generateUnsubscribeHeaders would point mail clients at the raw /api URL, not the SPA route.

Evidence:

- main/server/core/src/notifications/handlers.ts:748-775
- main/apps/web/src/pages/EmailUnsubscribePage.tsx:55-61
- main/server/core/src/notifications/unsubscribe.ts:120

**T-NOTIF-I20.** [ACCIDENTAL] Docs have drifted. api-contract-matrix says there is no notifications contract file, yet contract.notifications.ts exists. send.ts's header and DIRECTION.md disagree about push. The realtime recipe tunes Redis, but the bus is Postgres LISTEN/NOTIFY.

Evidence:

- docs/architecture/api-contract-matrix.md:70-76,119,148
- main/shared/src/contracts/contract.notifications.ts:32
- docs/DIRECTION.md:145
- main/tools/scripts/recipes/registry.ts:520-533
- docs/dev/horizontal-scaling.md:13,140

**T-NOTIF-I21.** [ACCIDENTAL] There is no i18n anywhere in the feature. The en-US locale has 0 notification keys. Every UI string in the dropdown, preferences form, sender page and unsubscribe page is hard-coded English, and the server stores pre-rendered English title/message text instead of a template key plus params.

Evidence:

- main/apps/web/src/i18n/locales/en-US.ts (0 matches for 'notif')
- main/apps/web/src/features/notifications/components/NotificationDropdown.tsx:88
- main/server/core/src/notifications/admin-alerts.ts:79-88

#### T-NOTIF proposed vertical module tree

```text
Two cohesive vertical modules. Notifications is a product feature; realtime is a platform service it consumes, because live tipping and chat will need realtime too.

main/platform/realtime/                       # owns the WHOLE bus. Today it is split across shared/db/pubsub, server/db/pubsub, server/realtime and apps/web/lib
  module.ts                                   # capability manifest: id 'realtime', edition, server/web entry points, health contributor
  contracts/
    channels.ts                               # typed ChannelKey registry: key builder + authorize(userId, tenantId) per namespace (from authorize.ts + SubKeys)
    frames.ts                                 # ClientMessage / ServerMessage (from db/pubsub/types.ts)
  server/
    bus.ts                                    # SubscriptionManager (from shared/db/pubsub/subscription.manager.ts)
    postgres-adapter.ts                       # LISTEN/NOTIFY (from server/db/pubsub)
    gateway.ts                                # /ws upgrade, CSRF, heartbeat, token + liveness re-check (from websocket/lifecycle.ts)
    publish.ts                                # publish(channelKey) port that features call; no-op when the capability is off
    stats.ts
  client/
    connection.ts                             # from apps/web/src/lib/realtime.ts, gated by the capability flag
    useChannel.ts                             # hook: subscribe(key) -> invalidate a query key
  (record-sync write/getRecords: delete it, or move it behind channels.authorize plus per-table policies before re-enabling)

main/modules/notifications/
  module.ts                                   # manifest: routes, jobs, event subscriptions, nav (bell slot, settings tab, admin page), edition=core, prunable
  db/
    migrations/03xx_*.sql                     # notifications(+category, tenant_id, kind, params, actor_id, dedupe_key, expires_at), push_subscriptions(UNIQUE endpoint), preferences, email_suppressions
    schema.ts                                 # one row-type file (merge schema/notifications.ts + schema/push.ts)
    repositories/{notifications,push-subscriptions,preferences,suppressions}.repo.ts   # the ONLY SQL; core stops inlining builders
  contracts/                                  # browser-safe, re-exported through @bslt/shared/notifications
    contract.ts                               # single source: client, routes, docs and route-coverage are derived from it
    schemas.ts                                # request/response schemas (merge schemas + push.schemas + types)
    catalog.ts                                # NotificationKind registry: key, category, level, default channels, suppressible, route, i18n keys
    channels.ts                               # in_app | push | email | sms
  server/
    notify.ts                                 # THE pipeline: notify({kind, recipients|audience, params, tenantId}) -> preferences -> suppressions -> channel fan-out
    channels/{in-app,web-push,email,sms}.channel.ts   # in-app writes the row + realtime.publish; email adds List-Unsubscribe; push/sms via ports
    preferences.ts  unsubscribe.ts
    handlers.ts  routes.ts                    # routes generated from the contract
    events.ts                                 # subscribes to auth.* / users.* / billing.* / tenants.invitation.* and maps them to notify(); replaces notifyAdmins/tryNotification/direct repo writes
    jobs/{broadcast-fanout,push-cleanup,retention}.job.ts   # broadcast goes through the queue instead of in-request Promise.all
    export.ts                                 # compliance data-export contributor (full history, preferences, push, suppressions)
  client/
    api.ts                                    # generated from contract.ts
    hooks/{useNotifications,usePreferences,usePushSubscription}.ts   # one client factory; realtime via platform useChannel
  ui/
    NotificationBell.tsx  NotificationCenterPage.tsx  PreferencesPanel.tsx  AdminComposer.tsx  UnsubscribePage.tsx
    routes.ts  nav.ts                         # registered through the module manifest, not hand-edited in routes.tsx/AppTopLayout/AccountModal/adminSurface
  sw/push-handler.ts                          # typed; bundled into sw.js; payload type shared with web-push.channel.ts
  i18n/{en-US,…}.ts
  tests/{unit,integration,e2e}

PRESERVE THROUGH THE RESTRUCTURE:
- payload-free {key, version} frames
- server-bound per-user channel authorization
- poll fallback alongside the socket
- readPreferences vs getPreferences split (no write on the decision path)
- pure isNotificationAllowed with an injected clock
- owner-scoped repository mutations
- best-effort push with 404/410 pruning
- capability-style vapid-key response
- HMAC unsubscribe token with constant-time compare
- WebSocket payload cap, heartbeat and idempotent teardown
- persistence exclusion for notification query keys
- test-pairs-debt and schema-coverage guards
```

#### T-NOTIF cross-feature links

- auth/users -> notifications: password_changed, new_device_login, account_locked, signup, deactivate, delete and reactivate events call notifyAdmins (main/server/core/src/auth/handlers/login.ts:295,360; auth/service.ts:243; auth/password/service.ts:151; users/handlers/lifecycle.ts:187,273,357; users/handlers/account.ts:273). They produce in-app rows for admins and moderators only. There is no realtime publish, no push, no preference check, and the end user gets no in-app security notice. User-facing security mail goes through auth email templates (main/server/core/src/auth/email-templates.ts) outside the notifications module.
- billing -> notifications: tryNotification writes rows directly (main/server/core/src/billing/handlers/support.ts:55-60, used in subscriptions.ts:159,226,304 and payment-methods.ts:126,188,255). Dunning sends email plus in-app through payment-notifications/billing-notifier (main/server/core/src/billing/payment-notifications.ts; main/apps/server/src/bootstrap/phases/comms.ts:186-201). There is no realtime publish, no preference or suppression check, and data keys are inconsistent ('action' vs 'category'+'action').
- tenants/invitations -> notifications: invitation-service notifies the INVITER ('Invitation sent', main/server/core/src/tenants/invitation-service.ts:335-343), not the invitee. The invitation email ignores the 'social' unsubscribe category, which the settings UI describes as including invitations (NotificationPreferencesForm.tsx:51).
- audit/activities: event sites hand-call audit, activity and notification separately (e.g. recordInvitationEvent followed by repos.notifications.create). There is no shared domain-event bus. The admin broadcast POST /api/notifications/send writes no audit record (main/server/core/src/notifications/handlers.ts:397-474).
- jobs/workers/queue: broadcast fan-out runs synchronously in the HTTP request. resolveTargetUserIds pages through every active user, then runs Promise.all of create plus push (main/server/core/src/notifications/send.ts:57-86; handlers.ts:428-458). It does not use the job queue. The only scheduled job is weekly push-cleanup (main/server/workers/src/service.ts:165-174), and there is no notifications retention job.
- compliance/data-export: the GDPR export includes notifications through repos.notifications.findByUserId(userId) with the default limit of 50 (main/server/core/src/compliance/data-export/service.ts:241; repo default at main/server/db/src/repositories/notifications/notifications.ts:139). The export is silently truncated and omits message/data, preferences, push subscriptions and email_unsubscribes.
- admin console: NotificationSenderPage lives in the Pro admin feature (main/apps/web/src/features/admin/pages/NotificationSenderPage.tsx) and reaches nav through adminSurface.ts:120-123. The connections widget never receives WebSocket stats.
- realtime: notifications are the ONLY live producer on the bus (main/server/core/src/notifications/publish.ts:59). The other publishers are the unused WriteService and the unused record-sync write handler (main/server/realtime/src/handlers/sync.ts:226). No tasks, activities, billing or tenant change publishes anything.
- moderation/bans/sessions: WebSocket auth is a synchronous JWT signature check only (main/server/realtime/src/websocket/lifecycle.ts:436; main/server/core/src/auth/utils/jwt.ts:85). It does not check tokenVersion, liveness or bans, so a banned or revoked user's open socket keeps receiving frames until it disconnects, and the user can reconnect until token expiry.
- tenancy/RLS: notification rows carry no tenant_id. RLS policies are user-scoped (0900_rls.sql:99-110). Handlers rely on explicit user_id predicates instead of db.withSession, which is good as defence in depth, but there is no creator- or tenant-scoped notification concept.
- feature flags/profiles/editions: realtime is gated on the server (isServerCapabilityEnabled) but not in the web app. Notifications are Core while realtime and admin are Pro (main/editions/catalog.ts). Notifications are not prunable (main/tools/scripts/starter/prune.ts:136).
- i18n: the feature has no locale keys and the server stores English text, so it is disconnected from the 9-locale i18n system.
- search/analytics/webhooks: no linkage. Notification events are not emitted as outbound webhooks or analytics events.

#### T-NOTIF dead ends

- repos.notificationPreferences (findByUserId/upsert) is registered at main/server/db/src/factory.ts:229 but has no production caller; core/preferences.ts writes the same table with inline SQL.
- repos.pushSubscriptions.create/findByEndpoint have no production caller (core/subscriptions.ts duplicates them). Only deleteExpired (workers), findByUserId and deleteByEndpoint (push-dispatch) are used.
- shared shouldSendNotification + NotificationPreferencesConfig + notificationPreferencesSchema (main/shared/src/modules/comms/notifications/notifications.logic.ts, notifications.schemas.ts:76,142): a parallel preference model with no consumer.
- core shouldSendNotification, shouldSendEmail and generateUnsubscribeHeaders (main/server/core/src/notifications/preferences.ts:237, unsubscribe.ts:113,244) have no production caller. No outgoing email (auth, billing dunning, workspace invitation) consults email preferences or the email_unsubscribes table, or adds List-Unsubscribe headers, even though SmtpClient supports custom headers (main/server/comms/src/email/smtp.client.ts:38,286).
- getUnsubscribedCategories, resubscribeUser and isUnsubscribed-as-API (main/server/core/src/notifications/unsubscribe.ts) have no route and no UI, although 0914 claims the preferences UI loads them.
- The 'sms' and 'email' notification channels appear as checkboxes in NotificationPreferencesForm.tsx:55 and are stored in preferences.types[*].channels, but no SMS or email notification delivery channel exists. comms SMS is only used by auth sms-2fa.
- OneSignal/Courier/Knock/SNS/Braze config (main/shared/src/modules/system/config/env.notification.ts, main/server/system/src/config/services/notifications.ts, main/shared/src/constants/core/notifications.ts:13-20, recipe placeholders in main/tools/scripts/recipes/registry.ts:579-593) has no adapter. The only consumer is the startup summary at main/server/system/src/runtime/health.ts:327.
- The server/realtime permissions engine (main/server/realtime/src/permissions/*, about 900 LOC: canReadRecord/canWriteRecord/filterRecordsForUser/createPermissionMiddleware/createPermissionChangeHandler) is exported but never wired into the gateway or handlers. Only tests/integration/api/realtime-permissions.integration.test.ts imports it, and the files are listed in test-pairs-debt.json:309-312.
- The /api/realtime/write and /api/realtime/getRecords API has no client caller (the client sync engine was removed 2026-06-12 per docs/DIRECTION.md:182). It is not in apiRouter or the generated client. registerRealtimeTable is never called in production, so only 'users' is reachable.
- WriteService with automatic pubsub publishing (main/server/db/src/queue/write-service.ts) is constructed at main/apps/server/src/bootstrap/phases/data.ts:121 and only ever closed; nothing writes through it. publishAfterWrite (main/shared/src/modules/db/pubsub/helpers.ts) has no caller.
- The SubscriptionManager delta-sync path (sync_request plus messageHistory) is never used, because the web client (main/apps/web/src/lib/realtime.ts) never sends sync_request.
- sw.js posts a NOTIFICATION_CLICK message to window clients (main/apps/web/public/sw.js:500-506) and nothing in apps/web listens for it.
- Admin ActiveConnectionsWidget shows metrics.activeConnections (main/apps/web/src/features/admin/components/ActiveConnectionsWidget.tsx:102), but /api/admin/metrics never produces that field; the client normalizer defaults it to 0 (main/client/api/src/admin/client.ts:337). WebSocket stats only reach /health.
- The shared email template and email log schemas (main/shared/src/modules/comms/email/email.ts and its re-exports in main/shared/src/modules/comms/index.ts:10-25) describe tables dropped by 0917_drop_orphaned_email_tables.sql.
- These shared symbols are defined but never referenced: InvalidPreferencesError, QuietHoursActiveError, NotificationRateLimitError, VapidNotConfiguredError, PayloadTooLargeError, getNotificationLevelTone, NOTIFICATION_LEVEL_MAP, notificationsListRequestSchema, StoredPushSubscription, NotificationMessage. Core getSubscriptionCount (main/server/core/src/notifications/subscriptions.ts:150) has no caller.
- The 0700_realtime_versions.sql version columns on notifications, push_subscriptions and notification_preferences are missing from the TS row types and are never incremented. push_subscriptions.is_active is never set false.
- In the Core edition the core web feature 'notifications' (bell and dropdown) has no mount point, because main/editions/core/main/apps/web/src/app/layouts/AppLayout.tsx.template renders no bell. The core POST /api/notifications/send endpoint's only UI lives in the Pro admin feature.
- main/server/core/src/notifications/unsubscribe.ts and routes.ts have no unit tests, and no integration test calls GET /api/email/unsubscribe/:token (main/tools/scripts/audit/test-pairs-debt.json:251-252).

#### T-NOTIF must remain shared

- Kernel ports and types: EmailService (main/shared/src/contracts/contract.ports.ts:165), a typed PushProvider/NotificationService port (it should stop returning unknown), SmsProvider (main/shared/src/modules/comms/sms/sms.ts), Logger, BaseContext/HasPubSub, typed as a realtime Publisher port.
- Infrastructure adapters, kept as adapters and injected through ports: SMTP/console email, Twilio/console SMS, WebPushProvider (main/server/comms/*).
- DB kernel: DbClient/RawDb, withSession/RLS session vars, query builder, toCamelCase/toSnakeCase, the migration runner and REQUIRED_TABLES/schema-coverage mechanism (main/server/db/src/client.ts, builder, utils, validation.ts).
- HTTP kernel: createRouteMap/createScopedRouteHelpers, protectedRoute/publicRoute auth guards, successResponseSchema/errorResponseSchema, HTTP_STATUS, AppError/isAppError (main/server/system/src/http, main/shared/src/modules/system).
- Schema primitives and branded IDs: createSchema/parse*, notificationIdSchema/userIdSchema (main/shared/src/schema, main/shared/src/schema/ids.ts).
- The realtime platform service as a whole (channel-key registry plus authorize, bus, Postgres adapter, WS gateway, browser connection), since live tipping, chat and presence will reuse it.
- Auth primitives: verifyToken plus a liveness/tokenVersion check for the socket, CSRF token utilities, and getCsrfToken on the client (main/server/core/src/auth/utils/jwt.ts, main/server/system/src/security, main/client/api/src/utils.ts).
- users repository (recipient resolution: findActiveByRoles, listWithFilters) and audit record(), consumed through ports.
- Job queue/scheduler (for broadcast fan-out and retention) and the capability/profile/edition registry that a module manifest registers into (main/profiles/*, main/editions/catalog.ts).
- Client kernel: @bslt/react useQuery/useMutation/useQueryCache, the @bslt/ui primitives (Badge, Button, Switch, Checkbox, Card, Alert), the i18n runtime, the router, and the layout slot API used to mount the bell.
- Service-worker shell (main/apps/web/public/sw.js caching and lifecycle); only the push handler moves into the notifications module.

## D. Synthesizer spot-check log

Commands were run read-only inside WSL (`cd ~/projects/library/bslt/bslt-main`). Results:

- `grep -rlE getAccessToken main/apps/web/src` (non-test): 63 files; importers of `@app/authToken`: 60.
- `grep -rl useClientEnvironment main/apps/web/src` (non-test): 51.
- `find main/apps/web/src -name '*.test.ts*'`: 205.
- `ls main/server/db/migrations/*.sql`: 37. `.github/workflows`: 19 files. Root package.json scripts: 156. tsconfig*.json with `paths`: 27.
- `grep -n billingNotifier main/apps/server/src/bootstrap/*.ts`: only `context.ts:67` and `context.ts:146` (type declarations); none in `app.ts`.
- `main/server/realtime/package.json`: dependencies are @bslt/db, @bslt/server-system, @bslt/shared; `ws` 8.22.1 is a devDependency and `^8.0.0` an optional peer.
- `grep -rn 'catch(() => {})' main/server/core/src` (non-test): 49.
- `main/server/realtime/src/service.ts`: `tableNameMap = { users: USERS_TABLE }`. `main/shared/src/modules/realtime/realtime.ts:178-185` PROTECTED_FIELDS = id, version, created_at, updated_at, password_hash, passwordHash.
- `main/server/storage/src/providers/local.ts:114-121`: getSignedUrl returns `${publicBaseUrl}/${key}` or `file://...`.
- `idx_refresh_tokens_family_active` created in `0000_users.sql:179` and again with IF NOT EXISTS in `0906_refresh_token_rotated_at.sql:16`.
- `0100_tenants.sql:77`: `CONSTRAINT invitations_pending_unique UNIQUE (tenant_id, email)` (not partial).
- `grep "queryKey: \['"` in web non-test: 17 (narrow pattern).
- `find main/server/core/src -name '*.test.ts'`: 73.
- `main/server/db/src/pubsub/postgres-pubsub.ts:47`: `DEFAULT_CHANNEL = 'app_events'`.
