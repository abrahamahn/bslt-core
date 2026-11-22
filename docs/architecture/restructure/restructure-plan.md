# bslt-main restructure: final design

Status: final architecture spec, ready to implement. Date: 2026-11-10. Author: lead architect (synthesis of three proposals and three judge panels).
Repo: `~/projects/library/bslt/bslt-main` (Windows: `\\wsl.localhost\ubuntu-24.04\home\abe\projects\library\bslt\bslt-main`). Structural baseline: commit `ff07d363`. Every path, line number and count below was checked against `ff07d363` unless marked otherwise.

Inputs: `fragmentation-map.md` (RC1-RC9, P1-P22, D1-D22, preserve list, risks), `stack-review.md` (section 3a "foundation now"), `ownership-rescore.md` (runtime replacement list), `docs/specs/principles.md`, `docs/DIRECTION.md`, `docs/architecture/*.md`, `.claude/CLAUDE.md`, the three proposals (`incremental`, `target-first`, `generation`) and three judgements. Judge totals: incremental 178, target-first 167, generation 155.

**Base: the `incremental` proposal** (strangler fig, one composition seam per runtime, shrink-only legacy shim, frozen oracles). It is grafted with the best of the other two and corrected for every judge-reported fatal flaw and decision violation (section 2.3).

---

## Contents

1. Summary and goals
2. Binding decisions, and how this design honours them
3. Target topology
4. Kernel packages and dependency DAG
5. Modules and the canonical module shape
6. The module manifest (TypeScript)
7. Contract to route/SDK pipeline
8. Events, outbox, jobs and cron
9. Data layer
10. Gating, capability context and authorization
11. Web platform layer and public-route SSR seam
12. UI system
13. Runtime dependency replacement plan
14. Tooling, CI and docs
15. Extraction: distribution repo and Kanu
16. Coexistence rules (strangler discipline)
17. Phased plan
18. Module migration order and walkthroughs
19. Risks and mitigations
20. Remaining owner decisions
21. Appendix A: deletion ledger. Appendix B: spot-check log

---

## 1. Summary and goals

bslt-main becomes a **generic, reusable foundation for TypeScript platforms** with this shape:

- About 12 small, **domain-free kernel packages** under `main/kernel/*`.
- About 19 **vertical modules** under `main/modules/*`. Each is one workspace package with **one manifest** (`module.ts`) plus type-checked server and web bindings.
- Two thin **composition apps**: `main/apps/server` and `main/apps/web`.
- **One install list**: `bslt.config.ts`.

The creator platform fork later changes the install list and adds modules (ledger, wallet, live, content, payouts) on the same kernel.

The migration is a strangler, so main stays green on every commit:

1. **Make the repo safe to move.** Extract the distribution machinery and Rust, harden the tooling guards, collapse aliases into package exports, pin versions.
2. **Freeze three oracles.** API surface, DB catalog and web routes.
3. **Reset the migration history once** into one baseline file per owner. Baselines stay editable until the `foundation-v1` tag.
4. **Build one composition seam per runtime**, fed only by manifests plus one shrink-only legacy input.
5. **Migrate one module at a time**, smallest first. Each migration deletes the old path and records tombstones.
6. **Replace third-party runtime packages behind seams**, last of all fastify, WebAuthn and the Postgres driver.
7. **Delete the legacy layers and tag `foundation-v1`.**

### 1.1 Goals (measurable at `foundation-v1`)

| #   | Goal                                                                                                                                                                      | Measured by                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| G1  | A feature lives in one folder. Adding an endpoint touches 3 files in 1 package (contract, handler, optional hook). Today it touches about 20 files in 5-7 packages.       | `bslt module new` output; tasks walkthrough                        |
| G2  | No hand-written registries. Routes, nav, settings, admin, palette, jobs, cron, subscribers, migrations, permissions, CSP and env examples are all derived from manifests. | `legacy-shim` ratchet = 0; registry files deleted                  |
| G3  | Facts happen once. Every side effect is an outbox subscriber.                                                                                                             | `swallowed-catch` = 0; `events` gate (every event has a producer)  |
| G4  | The database enforces ownership. The app runs as `bslt_app` (NOBYPASSRLS), and every table is classified and forced.                                                      | `bslt db audit`; real-DB suite runs as `bslt_app`                  |
| G5  | One gating model: installed/absent, plus one capability context, plus one authorization model.                                                                            | `git grep VITE_ENABLE_` = 0; `main/profiles` absent                |
| G6  | The only runtime npm packages are `react` and `react-dom`.                                                                                                                | `deps-allowlist.json` = `[react, react-dom]`                       |
| G7  | Public routes are server-rendered through an owned seam. The logged-in app stays an SPA.                                                                                  | crawler test; hydration test                                       |
| G8  | One CI workflow and one deploy path. Node 24 and Postgres 17 everywhere.                                                                                                  | `.github/workflows/` = `ci.yml`, `deploy.yml`; `version-pins` gate |
| G9  | Docs cannot overstate status.                                                                                                                                             | `DIRECTION.md` status block generated from manifests               |

### 1.2 Root cause to structural fix

| Root cause                        | Structural fix in this design                                                                                                                                                               | Where        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| RC1 horizontal layering           | One package per module, holding contract, server, web, migrations and i18n                                                                                                                  | §5, §18      |
| RC2 hand-written registries       | Manifest-fed seams (`buildApp`, `createWebApp`); generated install lists checked with `satisfies`                                                                                           | §6, §11, §16 |
| RC3 source-editing productization | Extracted to `bslt-distribution`. Generators write whole files only and never use anchors.                                                                                                  | §15, §14.2   |
| RC4 no domain events              | `publish(tx, event, payload)` writes to an outbox. Audit, notifications, webhooks, analytics and realtime are metadata-driven projections.                                                  | §8           |
| RC5 contracts as docs             | The endpoint definition drives route registration, the inferred SDK, query keys, invalidation, OpenAPI and the API snapshot                                                                 | §7           |
| RC6 scattered gating              | Installed/absent, plus one capability context, plus one isomorphic `evaluate()`. Profiles and VITE flags are deleted.                                                                       | §10          |
| RC7 exists treated as done        | Wired-or-deleted gates (unused exports, event producers, orphan generated files, kernel-only-with-consumer rule)                                                                            | §14.3        |
| RC8 undefined data ownership      | Flat public schema. Strict `<module>_` prefixes, module-owned migration files, catalog attribution, FKs only along `dependsOn`, one owner column, forced RLS classes, private repositories. | §9           |
| RC9 hand-synced duplication       | Package `exports` replace aliases. Generated rows, catalog, install lists, docs, CSP, env and permission bits follow the derivation ladder.                                                 | §14.2        |

---

## 2. Binding decisions, and how this design honours them

### 2.1 Owner decisions (binding)

| Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | How it is honoured                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foundation first, creator fork later. Creator-specific domains go to the fork.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Foundation modules are generic only. The ledger, creator payments, live video, moderation vendors and the rating **taxonomy** stay out. The foundation gets the generic mechanisms from stack-review §3a: entitlements, Money/Asset, PaymentIngress/HostedCheckout, payment_inbox, a taxonomy-free audience mechanism, moderation ports, AgeAssurance/Jurisdiction ports, realtime grants, upload sessions, process roles. See §5.3. |
| Extract and freeze editions, storefront, feature packs, recipes and prune/anchor tooling into a separate repo                                                                                                                                                                                                                                                                                                                                                                                                                 | Phase 1 (§15.1)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Move `main/apps/server-rust` and web `rust-access` to Kanu                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Phase 1 (§15.2)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Migrations: clean baseline reset, no data preserved, no bridge                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Phase 6. Baselines are editable in place until `foundation-v1` (§9.3).                                                                                                                                                                                                                                                                                                                                                               |
| Postgres: ONE flat `public` schema (schema-per-module rejected)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Ownership is expressed by table prefixes, module-owned migration files, the manifest `tables` list and a generated catalog with apply-diff attribution (§9.1). No `CREATE SCHEMA` anywhere. The schema-per-tenant toolkit is deleted.                                                                                                                                                                                                |
| Security defects first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 0 is the in-flight `fix/security-defects` work. No structural PR touches its files until it merges.                                                                                                                                                                                                                                                                                                                            |
| SSR for public routes only via an owned `renderToString`/`hydrateRoot` seam                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Phase 18 (§11.3). The logged-in app stays an SPA. DIRECTION.md records the reversal in the same PR.                                                                                                                                                                                                                                                                                                                                  |
| WCAG control contrast over the hairline look                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `--ui-color-border-control` at ≥3:1 lands early (Phase 5), and a contrast gate is added (§12)                                                                                                                                                                                                                                                                                                                                        |
| Own all runtime code except react/react-dom. Dev tooling is exempt. A CI allowlist blocks new runtime deps. External services only behind owned ports over HTTP.                                                                                                                                                                                                                                                                                                                                                              | `deps-allowlist` gate from Phase 5, with a `removeBy` phase per entry (§13). There are no permanent exceptions other than react/react-dom. Fastify, `postgres` and WebAuthn go last (Phase 19).                                                                                                                                                                                                                                      |
| Accepted defaults (hybrid kernel and modules with one manifest each, contracts drive SDK and routes, own schema lib with combinators and Standard Schema, events and outbox, one queue, one owner column with "org", one authz model, installed/absent plus capability context, recipe UI with layout primitives and tokens, named shells, i18n en-US only with `t()` required in modules, one CI and one deploy, Node 24 and one PG major, DIRECTION.md as single status doc, tasks as the reference module, dev tools kept) | All adopted. See the section of the same name.                                                                                                                                                                                                                                                                                                                                                                                       |
| Repo conventions (frameworks are renderers, no escape hatches, colocated tests, adversarial TDD, path headers, named exports, guardrail culture retargeted to manifests)                                                                                                                                                                                                                                                                                                                                                      | Kept. Path headers are synced by every move codemod (§14.1). Each audit is retargeted, not dropped (§14.3).                                                                                                                                                                                                                                                                                                                          |

### 2.2 What this design adds to the incremental base (grafts)

| Graft                                                                                                                                                                                        | From                       | Section               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------- |
| `satisfies ServerImpls<typeof config>` / `WebImpls<...>` on the generated install lists, so a missing or extra binding is a tsc error                                                        | target-first               | §6.4                  |
| A separate generic **entitlements** module, migrated before billing. Billing and later the fork's PPV write grants to it.                                                                    | target-first               | §5.2                  |
| Per-module `privacy` export/erase hooks orchestrated by compliance, plus `sealed()` schemas for secrets in outbox payloads                                                                   | target-first               | §6.3, §8.1            |
| Endpoint `cache: { public: seconds }`, plus a gate that SSR `load()` may call only public cacheable endpoints with an anonymous SDK; plus a run-every-subscriber-twice idempotency assertion | target-first               | §7, §11.3, §8.5       |
| Guard conversion to the `import.meta.url` form as the first PR of Phase 1                                                                                                                    | target-first               | §17 Phase 1           |
| Strict `<module>`/`<module>_<entity>` prefixes on every table, applied inside each module's migration PR                                                                                     | target-first               | §9.1                  |
| The module id as the one namespace: table prefix, event names, error codes, i18n keys, permission/flag/entitlement ids, package name                                                         | target-first               | §6.1                  |
| Projection modules (audit, notifications, webhooks, analytics) may never appear in a `dependsOn`. They consume event metadata, and a lint rule enforces this.                                | target-first               | §8.3                  |
| Money/Asset contract, plus `bigintString`, `brand` and `sealed` combinators                                                                                                                  | target-first               | §7.4                  |
| Inbound provider webhooks as ordinary contract endpoints (`auth: { webhook, rawBody: true }`)                                                                                                | target-first, generation   | §7.2                  |
| Typed eligibility fields in the capability context, plus ONE client interceptor for requirement 403s                                                                                         | target-first               | §10.3                 |
| Full realtime channel registry (deny-by-default, signed grants, tickets, re-auth on revocation, anonymous public channels, sequences, history, backpressure) in the notifications wave       | target-first               | §8.6                  |
| `@bslt/protocols`: one home for owned standard-protocol code under the rule "conformance vectors in the same PR"                                                                             | target-first               | §4                    |
| Append-only permission-bit lockfile `bslt.lock.json`                                                                                                                                         | generation                 | §10.4                 |
| Provenance comments, `bslt gen explain`, orphan-generated-file gate, DB-free `bslt sync` reading a committed catalog snapshot                                                                | generation                 | §14.2                 |
| The derivation ladder rule (type inference, then a runtime flatMap, then a committed file) written into principles.md                                                                        | generation                 | §14.2                 |
| Generated per-table RLS **structural** tests, plus per-class **behavioural** tests on fixtures, plus a required per-table owner-isolation test through a helper                              | generation (+ incremental) | §9.4                  |
| Manifest `env` feeds config parsing and `.env.example`. Manifest `csp` feeds one generated CSP/Permissions-Policy.                                                                           | generation                 | §6.1, §14.2           |
| Emit-site gate (every declared event has a statically found `publish`)                                                                                                                       | generation                 | §14.3                 |
| One isomorphic `evaluate(requirement, ctx)` shared by the server guard, SPA guards, nav and SSR                                                                                              | generation                 | §10.3                 |
| `deps-allowlist` entries carry a `removeBy` phase and fail CI when overdue                                                                                                                   | generation                 | §13                   |
| P2 and P4 of the base split into smaller phases, each with its own exit criteria                                                                                                             | judges                     | §17 (Phases 2-5, 7-9) |
| Creator-relevant generic mechanisms (base P12) folded into the module waves **before** the v1 freeze                                                                                         | judges                     | §17 Phases 14-15      |

### 2.3 Judge-reported flaws and violations: resolution

| Finding                                                                          | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base P2 and P4 were really XL and risked long red branches                       | Split into Phases 2/3/4/5 and 7/8/9, each independently green with its own exit criteria                                                                                                                                                                                                                                                                                                                                             |
| Base grandfathered legacy table names, leaving RC8 half-closed                   | Strict prefixes. Each module PR renames its tables in its still-editable baseline. A shrink-only legacy-name list reaches 0 by Phase 16 and the gate goes strict in Phase 20.                                                                                                                                                                                                                                                        |
| Base kept 4 workflow files against "one CI + one deploy"                         | End state is `ci.yml` and `deploy.yml` only. Security scanning (CodeQL, Semgrep, OSV, Gitleaks, Trivy, `pnpm audit --prod`) becomes jobs inside `ci.yml` on PR, push and a nightly schedule. Backups leave GitHub Actions: in-network encrypted backups plus PITR in infra (Phase 20). Until then `database-backup.yml` survives as the one transitional file, counted by a ratchet. Rollback and Terraform are `deploy.yml` inputs. |
| Base P12 rating column risked pulling the fork's taxonomy into the foundation    | Only a **taxonomy-free audience mechanism** lands: an integer `audience_level`, the GUC `app.max_audience`, a restrictive RLS policy, and fail-closed handling of unrated (NULL) rows. Labels such as sfw/softcore are fork configuration. It lands in the files wave (Phase 14), before the freeze.                                                                                                                                 |
| Base buried entitlements inside billing                                          | A separate `entitlements` module (Phase 15, before billing)                                                                                                                                                                                                                                                                                                                                                                          |
| Base P12 mechanisms landed after the `foundation-v1` freeze                      | Folded into Phases 14 and 15, before the freeze in Phase 20                                                                                                                                                                                                                                                                                                                                                                          |
| target-first: kernel built before any consumer                                   | Rejected. Kernel code lands only in the PR whose module calls it (§4.2 rule K1).                                                                                                                                                                                                                                                                                                                                                     |
| target-first: `main/` dropped and `@bslt/server` name reused                     | Rejected. `main/` stays, surviving package names stay, and no package name is ever reused.                                                                                                                                                                                                                                                                                                                                           |
| target-first: URLs changed to `/api/<module>` with REST verbs during the moves   | Rejected. URLs stay byte-identical during migration (the api-surface oracle). Normalization is an owner decision after v1 (§20 D3).                                                                                                                                                                                                                                                                                                  |
| target-first: deleted status/support/search by default                           | Not pre-empted. They migrate as small modules in Wave A unless the owner deletes them (§20 D2).                                                                                                                                                                                                                                                                                                                                      |
| target-first: offered postgres/fastify/WebAuthn as permanent exceptions          | Rejected. The binding rule allows only react/react-dom. These are planned replacements.                                                                                                                                                                                                                                                                                                                                              |
| generation: tasks moved before the baseline reset (double move)                  | Reset (Phase 6) precedes tasks (Phase 8)                                                                                                                                                                                                                                                                                                                                                                                             |
| generation: profiles extracted while boot still depended on them                 | Profiles are not extracted. They are deleted in place in Phase 11 when the capability context replaces them.                                                                                                                                                                                                                                                                                                                         |
| generation: full generator framework before any consumer                         | No generator framework. `bslt sync` is a set of small, pure, individually justified commands added with their first consumer (§14.2).                                                                                                                                                                                                                                                                                                |
| generation: per-request `repos` intersection exposed other modules' repositories | Repositories are private to their module (not exported, and lint bans the builder outside `server/repository*.ts`). Cross-module reads go through typed `api` ports from `dependsOn`.                                                                                                                                                                                                                                                |
| generation: `@bslt/contract` type-imported `IconName` from `@bslt/ui`            | Web data (routes, nav, icons) lives in the **web binding** (`@bslt/web-platform` types). `@bslt/contract` imports only `@bslt/schema`.                                                                                                                                                                                                                                                                                               |
| generation: argon2 hash compatibility tests under a clean reset                  | Not needed. Hash format may change (no data is preserved).                                                                                                                                                                                                                                                                                                                                                                           |

---

## 3. Target topology

End state after Phase 20. Surviving package names are kept, so import specifiers do not churn.

```
bslt-main/
├─ bslt.config.ts                 HAND  installedModules (manifest refs), devOnly, product name, brand, locales: the ONE install list
├─ bslt.lock.json                 GEN   append-only org-permission bit allocation (+ tombstones); migration checksums after v1
├─ .node-version                  HAND  24.x (engines, setup action, Dockerfiles read it)
├─ package.json                   HAND  ~35 scripts, all thin `bslt ...` calls; engines node ">=24 <25"
├─ pnpm-workspace.yaml            HAND  main/kernel/*, main/modules/*, main/apps/*, main/tools, main/build-config, main/testing, tests
├─ tsconfig.base.json             HAND  strict, customConditions: ["source"], NO paths
├─ tsconfig.json                  GEN   project references (bslt sync refs)
├─ turbo.json  eslint.config.ts   HAND  boundaries elements read the generated module DAG (main/tools/generated/module-graph.json)
├─ infra/
│  ├─ versions.env                HAND  NODE_MAJOR=24, POSTGRES_MAJOR=17, PGBOUNCER_IMAGE=<digest>
│  ├─ docker/                     Dockerfile (one image, PROCESS_ROLE), Dockerfile.web (static + public SSR), compose.dev.yml, compose.prod.yml (no DB)
│  ├─ runtime/caddy/              Caddyfile; security-headers.generated.caddy (GEN from manifests' csp + deploy config)
│  ├─ runtime/backup/             in-network encrypted backup job + PITR config (Phase 20)
│  └─ terraform/digitalocean/     one reference module, remote locked encrypted state
├─ .github/workflows/             ci.yml (static, unit, real-db, e2e, security, images; PR/push/nightly) + deploy.yml (envs, terraform, rollback)
├─ docs/
│  ├─ DIRECTION.md                single status doc; <!-- bslt:generated status --> block from manifests
│  ├─ specs/                      principles.md (new placement table + derivation ladder), modules.md, data.md, auth.md, errors.md
│  ├─ reference/                  GEN api.md, openapi.json, events.md, jobs.md, db-catalog.md, module-dag.md, env.md
│  ├─ archive/                    stale docs moved here
│  └─ log/                        weekly engineering log (kept)
├─ AGENTS.md                      tracked agent guide (replaces untracked .claude/CLAUDE.md content; .claude/CLAUDE.md points here)
├─ main/
│  ├─ kernel/                     domain-free; MUST NOT import main/modules/* or main/apps/* (eslint boundaries)
│  │  ├─ schema/      @bslt/schema          owned validation lib + combinators + Infer + Standard Schema `~standard`
│  │  ├─ contract/    @bslt/contract        endpoint/event/job/defineModule/defineConfig, Requirement + evaluate, ErrorCode registry, envelope, Money/Asset, ids
│  │  ├─ protocols/   @bslt/protocols       owned standard protocols on node built-ins; one subpath each, each with conformance vectors
│  │  ├─ db/          @bslt/db              RawDb port, builder, tx/UoW, migration runner, catalog + rows codegen, sql/0001_sys.sql, outbox/queue/cron stores
│  │  ├─ server/      @bslt/server-system   HTTP adapter, module host, guard chain, config, logger, metrics, events dispatch, QueueServer, leader cron, capability ctx, PROCESS_ROLE
│  │  ├─ realtime/    @bslt/realtime        RFC 6455 gateway, channel registry, grants, tickets, PubSubAdapter (pg | resp)
│  │  ├─ storage/     @bslt/storage         StorageProvider (local signed, SigV4 S3), upload sessions, DeliverySigner
│  │  ├─ comms/       @bslt/comms           Mailer / SmsSender / PushSender ports + console, SMTP, HTTP-SMS, VAPID adapters
│  │  ├─ client/      @bslt/client-engine   one transport, createEndpointClient (inferred SDK), query cache, IDB persister (allowlist)
│  │  ├─ react/       @bslt/react           router, useEndpoint/useEndpointMutation, forms, stores (no domain hooks)
│  │  ├─ ui/          @bslt/ui              tokens, recipes, layout primitives, Dialog/Toast/AsyncBoundary, Icon set, named shells
│  │  └─ web/         @bslt/web-platform    createWebApp, ClientEnvironment, requirement interceptor, PublicRoute SSR seam
│  ├─ modules/                    vertical; one package each: @bslt/<id>; subpaths ./module ./contract ./server ./web (./testing optional)
│  │  ├─ tasks/                   reference module (full shape in §5.4)
│  │  ├─ identity/  orgs/  entitlements/  billing/  compliance/
│  │  ├─ audit/  notifications/  webhooks/  analytics/                 projection modules (never in dependsOn)
│  │  ├─ files/  moderation/  flags/  search/  support/  status/
│  │  └─ admin/  devtools/                                              devtools is devOnly
│  ├─ apps/
│  │  ├─ server/  @bslt/server    src/main.ts (PROCESS_ROLE), src/buildApp.ts, src/generated/modules.ts (GEN)
│  │  └─ web/     @bslt/web       src/entry-client.tsx (SPA), src/entry-public.tsx (hydrateRoot), src/server/serve.ts (PROCESS_ROLE=web), src/generated/modules.ts (GEN)
│  ├─ tools/        @bslt/tools          `bslt` CLI: gates/registry.ts, sync/*, db/*, snapshot/*, module new, codemods, lib/paths.ts
│  ├─ build-config/ @bslt/build-config   vite/vitest factories (source condition), ESM extension fixer, eslint preset
│  └─ testing/      @bslt/testing        buildTestApp (= production buildApp), describeRealDb (as bslt_app), describeOwnerIsolation, port fakes
└─ tests/           @bslt/tests          cross-module HTTP journeys, real-DB RLS suites, Playwright e2e only
```

Deleted by v1: `main/shared`, `main/server/core`, `main/client/api`, `main/server/workers`, `main/server/media` (folded into files), `main/profiles`, `main/editions`, `main/extensions`, `main/apps/storefront`, `main/apps/server-rust`, `main/server/db/migrations`.

---

## 4. Kernel packages and dependency DAG

### 4.1 Package list

| Package               | Path                                             | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Created / changed in                    |
| --------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `@bslt/schema`        | `main/kernel/schema`                             | Owned zero-dependency validation, extracted from `main/shared/src/schema`. Existing parsers plus combinators: `object` (strict, rejects unknown keys and `__proto__`), `optional`, `nullable`, `array`, `record`, `union`, `discriminated`, `literal`, `enumOf`, `brand`, `refine`, `bigintString`, `sealed`. Provides `Infer<S>`, a `describe()` node for OpenAPI and docs, and the Standard Schema v1 `~standard` property (in-house, type-only spec, no dependency). Isomorphic, compiled without Node or DOM types.                      | Phase 8                                 |
| `@bslt/contract`      | `main/kernel/contract`                           | `endpoint()`, `event()`, `job()`, `defineModule()`, `defineConfig()`. The `Auth` union, `Requirement` codes and `evaluate()`, the ErrorCode registry plus `defineErrors(moduleId, ...)`, the single envelope, `Money`/`Asset` (bigint minor units serialized as string, exponent table), branded ids, capability-context types. It replaces `main/shared/src/api/api.ts` and the contract half of `@bslt/shared`. Depends only on `@bslt/schema`.                                                                                            | Phase 8                                 |
| `@bslt/protocols`     | `main/kernel/protocols`                          | Owned standard protocols, one subpath each, added only with its first consumer and its vectors in the same PR. Subpaths: `totp` (RFC 6238/4226), `s3` (SigV4, presign, multipart), `ws` (RFC 6455 framing), `webpush` (VAPID ES256 + RFC 8291), `resp` (RESP2/3), `smtp`, `otlp` (HTTP/JSON), `cbor` + `cose` (used by identity's WebAuthn verifier), `pg` (wire protocol v3, SCRAM-SHA-256). Node-only subpaths are marked by an export condition.                                                                                          | Phase 12 (first: totp)                  |
| `@bslt/db`            | `main/kernel/db` (from `main/server/db`)         | `RawDb` driver port (postgres.js until Phase 19, then `protocols/pg`), SQL builder, `tx()` unit of work (retry on 40001/40P01, per-transaction `statement_timeout`/`lock_timeout` honouring `QueryOptions.timeout`, `skipLocked()`/`noWait()`, bigint decoding), one-call RLS session (`set_config` ×N in one statement), the multi-source migration runner, catalog introspection plus rows codegen, `sql/0001_sys.sql` (roles, `sys_apply_rls`, `sys_*` tables), and outbox/queue/cron stores. **Domain repositories leave this package.** | Phase 6 (runner, reset), Phase 7 (move) |
| `@bslt/server-system` | `main/kernel/server` (from `main/server/system`) | HTTP adapter (Fastify until Phase 19, then owned `node:http`) behind the existing framework-agnostic `RouteMap`/`registerRouteMap` (`main/server/system/src/http/routing.ts:398`). Also the module host (`implementServer`, `buildApp` support), guard chain, config, owned logger, metrics, the events dispatcher, QueueServer, leader cron, capability-context aggregation and `PROCESS_ROLE` startup and drain. Absorbs the `main/apps/server/src/bootstrap/phases/*` logic.                                                              | Phases 5, 8, 10, 11                     |
| `@bslt/realtime`      | `main/kernel/realtime`                           | Gateway role: RFC 6455 on the `node:http` upgrade event (owned in Phase 14), channel registry, signed grants, single-use tickets, invalidation and payload classes, PubSubAdapter. Started by `PROCESS_ROLE=realtime                                                                                                                                                                                                                                                                                                                         | all`.                                   | Phase 0 (lockdown), Phase 14 (upgrade) |
| `@bslt/storage`       | `main/kernel/storage`                            | `StorageProvider` (local with signed expiring URLs; S3 over `protocols/s3`), upload sessions (presigned PUT, multipart into a quarantine prefix), head/copy/stream/sha256, bucket classes, `DeliverySigner` (minute-scale, viewer-bound, prefix-scoped).                                                                                                                                                                                                                                                                                     | Phase 0 (signing), Phase 14             |
| `@bslt/comms`         | `main/kernel/comms`                              | Transport ports only: `Mailer`, `SmsSender`, `PushSender`, with console, SMTP (`protocols/smtp`), HTTP-SMS and VAPID (`protocols/webpush`) adapters. Templates and the decision of what to send live in modules.                                                                                                                                                                                                                                                                                                                             | Phase 14                                |
| `@bslt/client-engine` | `main/kernel/client`                             | ONE transport: CSRF double-submit, memory-only bearer, org header, refresh with backoff, requirement-403 interception hook, envelope decoding. Also `createEndpointClient(contract, transport)` with types inferred from the contract, the query cache, and the IndexedDB persister driven by an allowlist (`persist: true` endpoints). Absorbs the transport half of `@bslt/api`.                                                                                                                                                           | Phase 8                                 |
| `@bslt/react`         | `main/kernel/react`                              | Owned router, `useEndpoint`, `useEndpointMutation` (keys `[moduleId, endpointName, input]`, invalidation from `invalidates`), `useSchemaForm`, store helper. Domain hooks leave.                                                                                                                                                                                                                                                                                                                                                             | Phase 8                                 |
| `@bslt/ui`            | `main/kernel/ui`                                 | Domain-free DS (§12). Its only peers are react and react-dom. No imports of `@bslt/contract`.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Phases 5, 17                            |
| `@bslt/web-platform`  | `main/kernel/web`                                | `createWebApp({ modules, legacy })`, `ClientEnvironment`, the requirement interstitial, shell selection, and the `PublicRoute` SSR seam (`./ssr` subpath).                                                                                                                                                                                                                                                                                                                                                                                   | Phases 9, 11, 18                        |

Kernel packages that will **not** exist, and why:

- `@bslt/media`: the ffmpeg runner has one consumer (files), so it moves to `main/modules/files/server/media/`. It is promoted only if a second consumer appears.
- `@bslt/workers`: retention and anonymization become compliance orchestration over per-module privacy hooks, scheduled as cron jobs.
- Separate `events` and `jobs` packages: both live in `@bslt/db` (stores) and `@bslt/server-system` (runtime).

### 4.2 Kernel rules

- **K1 (wired or deleted):** a kernel PR may add only an API that the same PR's module (or the next queued module, named in the PR) calls. Manifest fields arrive with their first consumer (table in §6.1).
- **K2:** kernel packages import only kernel packages lower in the DAG. Never modules, never apps. This is enforced by eslint-plugin-boundaries elements.
- **K3:** `@bslt/schema` and `@bslt/contract` are isomorphic (no `node:*`, no DOM lib in their tsconfig).
- **K4:** `@bslt/protocols` subpaths ship RFC or conformance vectors in the same PR as the code.

### 4.3 Kernel dependency DAG

```
@bslt/schema ─────────────► (none)
@bslt/contract ───────────► schema
@bslt/protocols ──────────► (none; node built-ins only)
@bslt/db ─────────────────► contract, schema, protocols
@bslt/server-system ──────► contract, schema, db, protocols
@bslt/realtime ───────────► server-system, db, contract, protocols
@bslt/storage ────────────► contract, protocols
@bslt/comms ──────────────► contract, protocols
@bslt/client-engine ──────► contract, schema
@bslt/react ──────────────► client-engine, contract
@bslt/ui ─────────────────► (react, react-dom peers only)
@bslt/web-platform ───────► react, ui, client-engine, contract
apps/server ──────────────► server-system, realtime, db, storage, comms, + generated module server entries
apps/web ─────────────────► web-platform, ui, react, client-engine, + generated module web entries
modules/<id>/contract ────► contract, schema, + ./contract of dependsOn modules
modules/<id>/server ──────► server-system, db, storage, comms, protocols, + ./contract and ./server api of dependsOn modules
modules/<id>/web ─────────► web-platform, ui, react, + ./contract and ./web public exports of dependsOn modules
```

---

## 5. Modules and the canonical module shape

### 5.1 Module list and module DAG

| Module (package)        | Tables (prefix)                                                                                                                                                                                                                                                           | dependsOn          | Kind       | Notes                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tasks` (`@bslt/tasks`) | `tasks`                                                                                                                                                                                                                                                                   | identity           | reference  | First migrated; the scaffolder template                                                                                                                                                                                                                      |
| `identity`              | `identity_users`, `identity_credentials`, `identity_lockouts`, `identity_profiles`, `identity_sessions`, `identity_refresh_tokens`, `identity_auth_tokens`, `identity_api_keys`, `identity_passkeys`, `identity_oauth_accounts`, `identity_mfa_*`, `identity_eligibility` | none               | domain     | Merges core auth, users and api-keys, which removes the cycle. One `issueSession` pipeline for every login method. Migrated last.                                                                                                                            |
| `orgs`                  | `orgs`, `orgs_members`, `orgs_invitations`, `orgs_roles`                                                                                                                                                                                                                  | identity           | domain     | tenant→org rename. Exists as a shell (events only) from Phase 10.                                                                                                                                                                                            |
| `entitlements`          | `entitlements_grants`                                                                                                                                                                                                                                                     | orgs               | domain     | Generic grants (key, source, source_ref, valid_from/to, revoked_at). Capability-context source. Requirement `entitlement:<key>`.                                                                                                                             |
| `billing`               | `billing_plans`, `billing_subscriptions`, `billing_invoices`, `billing_payment_methods`, `billing_payment_inbox`, `billing_provider_events`, `billing_usage_*`                                                                                                            | orgs, entitlements | domain     | Provider mirror, insert-first inbox, PaymentIngress/HostedCheckout ports, provider registry (TEXT, not ENUM), REST adapters (Stripe, PayPal, Mock), dunning as `notify` metadata                                                                             |
| `compliance`            | `compliance_legal_documents`, `compliance_acceptances`, `compliance_consents`, `compliance_data_requests`, `compliance_legal_holds`, `compliance_retention_policies`, `compliance_age_assurance_checks`, `compliance_jurisdiction_rules`                                  | identity           | domain     | ToS requirement, consent, export/erase orchestration over privacy hooks (one anonymizer per owner), retention registry, legal holds, AgeAssuranceProvider (attestation adapter = today's 0916), JurisdictionResolver, configurable minimum age               |
| `audit`                 | `audit_log`, `audit_activity`                                                                                                                                                                                                                                             | none               | projection | One append-only stream (REVOKE UPDATE/DELETE plus trigger) and an activity projection. Merges audit_events, security_events and activities.                                                                                                                  |
| `notifications`         | `notifications`, `notifications_preferences`, `notifications_push_subscriptions`, `notifications_unsubscribes`                                                                                                                                                            | none               | projection | ONE `notify()` pipeline fed by event `notify` metadata. Owns delivery jobs through kernel comms.                                                                                                                                                             |
| `webhooks`              | `webhooks`, `webhooks_deliveries`                                                                                                                                                                                                                                         | none               | projection | Endpoints are org-owned, by org id carried in the event, with no FK across a non-dependency. Fan-out of `webhook: true` events, signing, retries, replay, SSRF target policy.                                                                                |
| `analytics`             | `analytics_events` (partitioned)                                                                                                                                                                                                                                          | none               | projection | Partition and retention cron, consent-gated anonymous events, canonical server events from `analytics` metadata, rollup path                                                                                                                                 |
| `files`                 | `files`, `files_variants`, `files_upload_sessions`, `files_avatars`                                                                                                                                                                                                       | identity           | domain     | One asset record and state machine, upload sessions, signed delivery, media jobs (ffmpeg) on the `media` queue, `access_class`, the audience mechanism, `legal_hold`/`retain_until`, ContentScanner port with a fail-closed publish gate. Avatars are files. |
| `moderation`            | `moderation_reports`, `moderation_cases`, `moderation_decisions`, `moderation_appeals`                                                                                                                                                                                    | identity, files    | domain     | Generic reports, cases, decisions with statements of reasons, appeals, executor of module-declared `actions` (`files.quarantine`, `identity.suspend`), ModerationProvider port (fail closed). No vendors, no taxonomy.                                       |
| `flags`                 | `flags_overrides`                                                                                                                                                                                                                                                         | orgs               | platform   | Flag keys declared in manifests. Overrides per org (and per jurisdiction later). Capability-context source.                                                                                                                                                  |
| `search`                | `search_documents` (or none if FTS columns live on owner tables)                                                                                                                                                                                                          | identity           | leaf       | Postgres FTS (`websearch_to_tsquery`, `ts_rank`, `pg_trgm`). Admin-only until tenant-scoped hits exist. Subject to owner decision D2.                                                                                                                        |
| `support`               | `support_requests`                                                                                                                                                                                                                                                        | identity           | leaf       | Anonymous public endpoint plus admin inbox contribution. Subject to owner decision D2.                                                                                                                                                                       |
| `status`                | `status_components`, `status_incidents`                                                                                                                                                                                                                                   | none               | leaf       | Public status page, the first `PublicRoute` consumer. Subject to owner decision D2.                                                                                                                                                                          |
| `admin`                 | none                                                                                                                                                                                                                                                                      | identity           | console    | Console shell routes plus residue no module owns (system stats, impersonation, audited via events). Every other admin screen is a contribution of its owning module.                                                                                         |
| `devtools`              | none                                                                                                                                                                                                                                                                      | none               | devOnly    | API route explorer and UI catalog. Absent from production lists.                                                                                                                                                                                             |

Module DAG (no cycles; the arrow points to the dependency):

```
tasks ─► identity
orgs ─► identity          entitlements ─► orgs          billing ─► orgs, entitlements
compliance ─► identity    files ─► identity             moderation ─► identity, files
flags ─► orgs             search ─► identity            support ─► identity
admin ─► identity         status, audit, notifications, webhooks, analytics, devtools ─► (none)
```

Rules:

- **M1:** FKs only to tables of modules in `dependsOn`. The catalog gate enforces this.
- **M2:** projection modules (audit, notifications, webhooks, analytics) never appear in any `dependsOn`. A lint rule plus the module-graph check enforce this. They receive events through metadata, and their dependencies on users or orgs are id columns with no FK. Rows survive anonymization by design.
- **M3:** cross-module calls go only through an `api` port typed from `dependsOn`, for synchronous reads and commands. Everything else is an event.
- **M4:** privacy hooks, capability contributions, moderation actions and NotificationKind templates are **kernel slots** that every module may fill. Compliance, the kernel capability aggregator, moderation and notifications read the slots from the module host, so they need no `dependsOn` toward the modules that fill them.

### 5.2 Avatar ownership

This resolves the identity↔files cycle. `files` depends on `identity` because it has an FK to `identity_users`, so identity cannot call files. The current avatar pointer therefore lives in files (`files_avatars(user_id PK, file_id)`), and the web reads it with `useEndpoint(files.avatar.get)`.

The user DTO drops `avatarUrl`. This is an intended api-surface diff, committed in the files PR. It removes the T-AUTH-I11 null-out defect by construction. There are no external API consumers. Owner decision D9 confirms this.

### 5.3 Foundation versus fork boundary

| Foundation (bslt-main)                                                                                                 | Fork (creator platform)                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Entitlements grants; Money/Asset; payment_inbox; PaymentIngress/HostedCheckout ports; N providers; reconciliation hook | Ledger (double-entry), wallet, tips, PPV, payouts, reserves, CCBill/Segpay/Verotel adapters, crypto |
| Integer audience mechanism, GUC, RLS backstop, fail-closed unrated                                                     | Concrete rating taxonomy (`unrated`, `sfw`, `suggestive`, `softcore`), hostnames, buckets           |
| Moderation ports, cases, appeals, executor, legal holds, retention registry                                            | Thorn/Hive/Sightengine adapters, NCMEC workflow, PDQ, TAKE IT DOWN/DMCA forms                       |
| AgeAssuranceProvider port + attestation adapter, JurisdictionResolver, configurable min age                            | Yoti/Ondato/Incode adapter, KYC, performer releases, 18+ config                                     |
| Realtime payload channels, grants, tickets, presence primitive                                                         | Live-room protocol (chat, tip, goal), LiveVideoProvider, WHIP/WHEP, HLS player                      |
| Upload sessions, DeliverySigner, files state machine, metadata strip                                                   | Bunny storage/CDN/Stream adapters, watermarking, previews                                           |

The ledger stays in the fork per the binding decision. Owner decision D1 offers reclassification.

### 5.4 Canonical module shape

```
main/modules/<id>/
├─ package.json             @bslt/<id>; exports { "./module", "./contract", "./server", "./web", ("./testing") }, each with { source, types, default }
├─ tsconfig.json            two composite projects: isomorphic+dom (module.ts, contract/, web/) and node (server/)
├─ vitest.config.ts         from @bslt/build-config
├─ module.ts                THE manifest (pure data; imports only @bslt/contract, @bslt/schema, ./contract/*, dependsOn ./module)
├─ contract/
│  ├─ schemas.ts            combinator schemas; types via Infer<>
│  ├─ endpoints.ts          endpoint({...}) const object; the ONLY place a path is written
│  ├─ events.ts             event(...) defs with projection metadata (omitted until the module publishes)
│  └─ errors.ts             defineErrors('<id>', { TASK_NOT_FOUND: 404 })
├─ server/
│  ├─ index.ts              implementServer(module, {...}): the type-checked binding (no registry)
│  ├─ service.ts            business logic (framework-free); + service.test.ts
│  ├─ repository.ts         the ONLY SQL in the module; built per tx; + repository.test.ts, repository.real-db.test.ts
│  ├─ migrations/0001_<id>.sql   owned DDL; ends with SELECT sys_apply_rls(...) per table
│  ├─ generated/rows.ts     GEN from the catalog snapshot (Row/Insert/Update, COLUMNS, TableSpec, enum unions, branded ids)
│  ├─ generated/rls.real-db.test.ts  GEN structural RLS test per table
│  └─ jobs.ts subscribers.ts     only if declared
├─ web/
│  ├─ index.ts              implementWeb(module, {...}): routes, nav, settings, admin, dashboard, publicRoutes, messages
│  ├─ <Page>.tsx/.css/.test.tsx
│  └─ hooks.ts              thin useEndpoint wrappers only when they add logic (e.g. optimistic delete)
├─ i18n/en-US.json          keys namespaced "<id>.*"
└─ README.md                hand intro + <!-- bslt:generated reference --> block (endpoints, events, jobs, tables, RLS, status)
```

The `module-shape` gate checks that `module.ts` exists, that `contract/endpoints.ts` exists when `endpoints` is non-empty, that `server/index.ts` exists, that `web/index.ts` exists or the manifest sets `web: false`, that the README generated block is current, that `i18n/en-US.json` exists when web exists, and that every `owner_user`/`owner_org` table has an owner-isolation test.

---

## 6. The module manifest (TypeScript)

### 6.1 `module.ts`: the ONE manifest

```ts
// main/kernel/contract/src/module.ts
import type { Schema } from '@bslt/schema';
import type { Endpoint } from './endpoint';
import type { EventDef } from './event';
import type { JobDef } from './job';

/** Lowercase, no separators: it is the table prefix, the API mount, and the event/error/i18n/permission namespace. */
export type ModuleId = string;

export interface FlagDef {
  readonly default: boolean;
  readonly summary: string;
}
export interface CspNeeds {
  readonly 'connect-src'?: readonly string[];
  readonly 'img-src'?: readonly string[];
  readonly 'media-src'?: readonly string[];
  readonly 'frame-src'?: readonly string[];
  readonly 'worker-src'?: readonly string[];
}

export interface ModuleDefinition<
  Id extends ModuleId = ModuleId,
  C extends Readonly<Record<string, Endpoint>> = Readonly<Record<string, Endpoint>>,
  E extends Readonly<Record<string, EventDef>> = Readonly<Record<string, EventDef>>,
  J extends Readonly<Record<string, JobDef>> = Readonly<Record<string, JobDef>>,
> {
  readonly id: Id;
  readonly summary: string; // -> generated README + DIRECTION.md status block
  readonly status: 'stable' | 'beta' | 'experimental';
  readonly dependsOn: readonly ModuleDefinition[]; // the module DAG, by reference (typed api ports, lint boundaries, migration order, FK rule)
  readonly endpoints: C; // contract (Phase 8)
  readonly events: E; // events this module PUBLISHES (Phase 10)
  readonly jobs: J; // job definitions (Phase 10)
  readonly tables: readonly (Id | `${Id}_${string}`)[]; // must equal catalog attribution (Phase 8)
  readonly web?: false; // explicit omission of a web binding
  readonly permissions?: readonly `${Id}.${string}`[]; // org bitmask permissions; bits allocated in bslt.lock.json (Phase 15, orgs)
  readonly flags?: Readonly<Record<`${Id}.${string}`, FlagDef>>; // runtime flag keys (Phase 11, flags)
  readonly entitlements?: readonly `${Id}.${string}`[]; // entitlement keys this module grants or checks (Phase 15)
  readonly env?: Schema; // config parse + .env.example section (first consumer: webhooks, Phase 10)
  readonly csp?: CspNeeds; // generated CSP/Permissions-Policy (first consumer: files, Phase 14)
}

/** Identity function; `const` inference keeps ids, paths and keys literal. Boot and `bslt sync modules` validate it. */
export const defineModule = <const M extends ModuleDefinition>(m: M): M => m;

export interface BsltConfig<Ms extends readonly ModuleDefinition[] = readonly ModuleDefinition[]> {
  readonly name: string;
  readonly installedModules: Ms; // the ONE install list
  readonly devOnly: readonly ModuleDefinition[];
  readonly locales: readonly ['en-US'];
  readonly brand: { readonly accent: string; readonly logo: string };
}
export const defineConfig = <const C extends BsltConfig>(c: C): C => c;
```

Validated at `bslt sync modules` and at boot:

- the id matches `^[a-z][a-z0-9]*$` and is unique;
- `dependsOn` closure is installed and the graph is acyclic;
- no projection module appears in a `dependsOn`;
- `tables` carry the id prefix;
- events are named `<id>.<noun>.<verb>`;
- error codes are registered under `<id>`;
- permission, flag and entitlement keys are prefixed with `<id>.`;
- method+path pairs are unique across modules, and no param route shadows a static one.

### 6.2 Endpoint, event and job definitions (in `@bslt/contract`)

```ts
// main/kernel/contract/src/endpoint.ts
import type { Infer, Schema } from '@bslt/schema';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** ONE authorization vocabulary (route level + org bitmask permission); RLS is below. */
export type Auth =
  | 'public'
  | 'user'
  | 'admin'
  | { readonly org: `${string}.${string}` } // org permission id -> bit via bslt.lock.json
  | { readonly webhook: string; readonly rawBody: true }; // named verifier in the server binding; bytes verified before parse
export type Requirement =
  | 'tos.accepted'
  | 'email.verified'
  | `entitlement:${string}`
  | `flag:${string}`
  | `age.verified:${number}`;

export interface Endpoint {
  readonly method: HttpMethod;
  readonly path: `/api/${string}`; // byte-identical to today's path during migration (api-surface oracle)
  readonly auth: Auth;
  readonly params?: Schema;
  readonly query?: Schema;
  readonly body?: Schema;
  readonly response: Schema; // the data inside the single envelope
  readonly status?: 200 | 201 | 202 | 204;
  readonly errors?: readonly string[]; // codes from the ErrorCode registry (typed per module)
  readonly requires?: readonly Requirement[];
  readonly invalidates?: readonly string[]; // sibling endpoint names to refetch on success
  readonly cache?: { readonly public: number }; // seconds; legal only with auth 'public'; the only endpoints SSR load() may call
  readonly persist?: true; // IndexedDB persistence allowlist (default: never persisted)
  readonly rateLimit?: { readonly perMinute: number };
  readonly summary: string;
}
export const endpoint = <const E extends Endpoint>(e: E): E => e;
export type InputOf<E extends Endpoint> = (E['params'] extends Schema
  ? { readonly params: Infer<E['params']> }
  : unknown) &
  (E['query'] extends Schema ? { readonly query: Infer<E['query']> } : unknown) &
  (E['body'] extends Schema ? { readonly body: Infer<E['body']> } : unknown);
export type OutputOf<E extends Endpoint> = Infer<E['response']>;

// main/kernel/contract/src/event.ts : projection metadata is generic platform vocabulary
export interface NotifyMeta<P> {
  readonly kind: string; // '<id>.<kind>'; template contributed in the server binding
  readonly recipients: (p: P) => readonly string[]; // user ids
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly category: string;
  readonly channels: readonly ('in_app' | 'email' | 'push')[];
  readonly route?: string;
  readonly title: string; // i18n keys
}
export interface EventDef<N extends string = string, S extends Schema = Schema> {
  readonly name: N; // '<id>.<noun>.<verb>'; also the audit action name
  readonly payload: S; // ids and facts; secrets only via sealed()
  readonly version?: number;
  readonly audit?: {
    readonly category: 'security' | 'data' | 'billing' | 'trust_safety' | 'compliance' | 'admin';
    readonly severity: 'info' | 'warn' | 'critical';
  };
  readonly activity?: true; // user-visible activity projection
  readonly webhook?: true; // advertised to outbound webhooks
  readonly notify?: NotifyMeta<Infer<S>>;
  readonly realtime?: (p: Infer<S>) => {
    readonly channel: string;
    readonly invalidate?: readonly string[];
  };
  readonly analytics?: string; // canonical analytics event name
}
export const event = <const N extends string, S extends Schema>(
  name: N,
  payload: S,
  meta: Omit<EventDef<N, S>, 'name' | 'payload'> = {},
): EventDef<N, S> => ({ name, payload, ...meta });

// main/kernel/contract/src/job.ts
export interface JobDef<N extends string = string, S extends Schema = Schema> {
  readonly name: N;
  readonly payload: S;
  readonly queue: 'default' | 'media';
  readonly maxAttempts: number;
  readonly timeoutMs: number;
}
```

### 6.3 Server binding (in `@bslt/server-system`)

```ts
// main/kernel/server/src/module/server-module.ts
export interface KernelServices {
  readonly db: { system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }; // bslt_worker; explicit system policies
  readonly events: {
    publish<D extends EventDef>(tx: Tx, def: D, payload: Infer<D['payload']>): Promise<void>;
  };
  readonly jobs: {
    enqueue<D extends JobDef>(
      tx: Tx,
      def: D,
      payload: Infer<D['payload']>,
      o?: { idempotencyKey?: string; runAt?: Date },
    ): Promise<void>;
  };
  readonly log: Logger;
  readonly clock: Clock;
  readonly storage: StorageProvider;
  readonly signer: DeliverySigner;
  readonly comms: CommsTransports;
}
export interface RequestContext {
  readonly viewer: Viewer | null; // { userId, role, actingOrg?: { orgId, permissions: bigint } }
  readonly caps: CapabilityContext;
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>; // bslt_app; one set_config statement; retry 40001/40P01
  fail(code: string, details?: unknown): never; // typed against the endpoint's `errors`
}
type DepApis<D extends readonly ModuleDefinition[]> = {
  readonly [M in D[number] as M['id']]: PublicApi<M['id']>;
};

export interface ServerModule<M extends ModuleDefinition, S, A = never> {
  readonly module: M;
  readonly migrations: URL; // new URL('./migrations/', import.meta.url)
  readonly create: (k: KernelServices, deps: DepApis<M['dependsOn']>) => S;
  /** Exactly one handler per endpoint; missing or extra keys are tsc errors (replaces api-contract-sync). */
  readonly handlers: {
    readonly [K in keyof M['endpoints']]: (
      input: InputOf<M['endpoints'][K]>,
      req: RequestContext,
      s: S,
    ) => Promise<OutputOf<M['endpoints'][K]>>;
  };
  readonly api?: (s: S) => A; // port for modules listing this one in dependsOn
  readonly subscribers?: readonly Subscription<S>[]; // on(dep.events.x, { id, handle }) | onFlagged('webhook'|'audit'|'notify'|'analytics', ...)
  readonly jobs?: {
    readonly [K in keyof M['jobs']]: (
      payload: Infer<M['jobs'][K]['payload']>,
      s: S,
    ) => Promise<void>;
  };
  readonly cron?: readonly {
    readonly job: keyof M['jobs'] & string;
    readonly schedule: string;
    readonly catchUp?: boolean;
  }[];
  readonly verifiers?: Readonly<Record<string, WebhookVerifier>>; // for auth: { webhook }
  readonly context?: (s: S, viewer: Viewer | null) => Promise<CapabilityContribution>; // kernel slot
  readonly privacy?: {
    // kernel slot, orchestrated by compliance
    exportUser(s: S, userId: UserId): Promise<Readonly<Record<string, unknown>>>;
    eraseUser(s: S, tx: Tx, userId: UserId): Promise<void>; // only this module's rows
  };
  readonly actions?: Readonly<Record<string, (s: S, tx: Tx, input: unknown) => Promise<void>>>; // kernel slot, invoked by moderation
  readonly notificationKinds?: Readonly<Record<string, NotificationTemplate>>; // kernel slot, read by notifications
}
export const implementServer = <M extends ModuleDefinition, S, A = never>(
  module: M,
  impl: Omit<ServerModule<M, S, A>, 'module'>,
): ServerModule<M, S, A> => ({ module, ...impl });

/** Install agreement: the generated list must bind exactly the installed manifests, in order. */
export type ServerImpls<C extends BsltConfig> = {
  readonly [K in keyof C['installedModules']]: ServerModule<
    C['installedModules'][K],
    unknown,
    unknown
  >;
};
```

A slot exists only once its first consumer exists. The order is: `verifiers` with billing, `context` with flags, `privacy` with compliance, `actions` with moderation, `notificationKinds` with notifications.

### 6.4 Web binding (in `@bslt/web-platform`)

```ts
// main/kernel/web/src/web-module.ts
import type { IconName } from '@bslt/ui';
export type ShellName = 'public' | 'auth' | 'app' | 'console';
export type NavSlot = 'app.primary' | 'app.settings' | 'console.primary' | 'palette' | 'dashboard';
export interface WebRoute {
  readonly path: string;
  readonly shell: ShellName;
  readonly auth: Auth;
  readonly requires?: readonly Requirement[];
  readonly page: LazyPage;
  readonly title: MessageKey;
  readonly unlisted?: true; // reachable by deep link only (siteMap reachability test)
}
export interface WebModule<M extends ModuleDefinition> {
  readonly module: M;
  readonly routes: readonly WebRoute[];
  readonly nav?: readonly {
    readonly to: string;
    readonly slot: NavSlot;
    readonly label: MessageKey;
    readonly icon: IconName;
    readonly order: number;
  }[];
  readonly settings?: readonly SettingsSection[];
  readonly admin?: readonly AdminSurface[];
  readonly dashboard?: readonly DashboardTile[];
  readonly notificationRoutes?: Readonly<Record<string, (payload: unknown) => string>>;
  readonly publicRoutes?: readonly PublicRoute<unknown>[]; // SSR seam (Phase 18)
  readonly messages: () => Promise<Readonly<Record<string, string>>>; // en-US
}
export const implementWeb = <M extends ModuleDefinition>(
  module: M,
  impl: Omit<WebModule<M>, 'module'>,
): WebModule<M> => ({ module, ...impl });
export type WebImpls<C extends BsltConfig> = {
  readonly [K in keyof C['installedModules']]: WebModule<C['installedModules'][K]> | null;
};
```

### 6.5 Install list and generated composition

```ts
// bslt.config.ts (HAND: the only app-level registry)
import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { tasksModule } from '@bslt/tasks/module';
import { devtoolsModule } from '@bslt/devtools/module';
export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule, tasksModule /* topological order, validated */] as const,
  devOnly: [devtoolsModule],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});

// main/apps/server/src/generated/modules.ts
// @generated by `bslt sync modules` from bslt.config.ts. Do not edit; run `pnpm bslt sync modules`.
import type { ServerImpls } from '@bslt/server-system/module';
import type config from '../../../../bslt.config';
import { identityServer } from '@bslt/identity/server'; // <- bslt.config.ts#installedModules[0]
import { tasksServer } from '@bslt/tasks/server'; // <- bslt.config.ts#installedModules[1]
export const installedServerModules = [identityServer, tasksServer] as const satisfies ServerImpls<
  typeof config
>;

// main/apps/server/src/main.ts (hand, ~40 lines)
const app = await buildApp({
  config: loadConfig(),
  modules: installedServerModules,
  legacy: legacyServerInput,
}); // `legacy` deleted in Phase 20
await app.start(processRoleFromEnv()); // api | realtime | worker | media-worker | all

// coexistence only: main/apps/server/src/legacy/legacy-modules.ts (shrink-only; ratchet counts entries)
export interface LegacyServerInput {
  readonly routeModules: readonly { readonly module: string; readonly routes: RouteMap }[]; // today's core/route-modules.ts + app route-modules
  readonly cron: readonly LegacyCron[];
  readonly migrationSources: readonly string[]; // legacy-migrations/<owner>
  readonly context: readonly LegacyContextContribution[];
}
```

`bslt sync modules` writes three things:

- the static imports for both apps;
- the `@bslt/<id>` `dependencies` keys in the two app `package.json` files (it owns exactly those keys);
- `main/tools/generated/module-graph.json`, which ESLint boundaries and docs read.

No other app-level list exists.

---

## 7. Contract to route/SDK pipeline

### 7.1 Source and flow

```
modules/<id>/contract/endpoints.ts  (endpoint({...}) objects, ONE source)
        │
        ├─► server (rung 2, runtime): module host maps each endpoint to a RouteMap entry
        │      └─ existing registerRouteMap (main/server/system/src/http/routing.ts:398) → Fastify adapter → owned node:http (Phase 19)
        ├─► client (rung 1, inference): createEndpointClient(contract, transport) → typed { list(input), create(input), ... }
        │      └─ useEndpoint / useEndpointMutation: keys [moduleId, name, input]; `invalidates`; `persist` allowlist
        └─► committed artifacts (rung 3, non-TS consumers only): docs/reference/openapi.json, docs/reference/api.md,
               main/tools/snapshots/api-surface.json (method, path, auth, requires, sha256 of canonical schema describe())
```

There is **no SDK codegen**. Types are inferred from the same object, so the client cannot drift.

### 7.2 Server registration (kernel module host)

For each installed module and endpoint, the host builds a `RouteDefinition` and appends it to one `RouteMap`. The per-request chain, in order:

1. IP blocklist.
2. CORS, then the geo gate.
3. CSRF for cookie auth.
4. Authentication: JWT (tokenVersion liveness), API key (scoped, audited), or webhook verifier for `{ webhook, rawBody }`. The verifier works on raw bytes before parsing.
5. RLS session context: the membership-verified org header becomes `actingOrg`.
6. `auth` level: public/user/admin, or the org bitmask bit from `bslt.lock.json`.
7. `requires`: `evaluate()` against the capability context. A failure returns a typed 403 with the `{ requirement }` code.
8. Parse params, query and body with the endpoint schemas. A failure returns 400 `VALIDATION_ERROR`.
9. Call the handler with typed input.
10. Wrap the result in the single envelope. In dev and test the response is validated against `response`.
11. Map thrown `AppError`s through the ErrorCode registry.

The envelope is the one `registerRouteMap` already emits (`docs/specs/errors.md`). It becomes the only one. Any legacy route that emits a different shape is fixed as an intended diff inside its module's PR (SHR-06).

Inbound provider webhooks (Stripe, PayPal, and later the fork's processors) are ordinary endpoints, for example `auth: { webhook: 'stripe', rawBody: true }`. That puts them in OpenAPI, the api-surface snapshot and route coverage, and deletes the five billing special cases (CORE-08) and `registerBillingWebhookRoutes`.

### 7.3 Client

`createEndpointClient(tasksContract, transport)` returns callables typed by inference. `ClientEnvironment.sdk` holds one client per installed module over **one** transport. React uses `useEndpoint(sdk.tasks.list)` and `useEndpointMutation(sdk.tasks.create)`. The following are deleted module by module: the 19 hand client factories, the 15 client-factory names, the 66 construction sites, `getAccessToken` imports in 60 files, and hand query-key literals.

In Phase 8, legacy `createCsrfRequestClient` is re-pointed at the new transport. The private billing client gains org headers and refresh at that moment (T-BILL-I03).

### 7.4 Schema library extensions

Combinators remove the interface-plus-parser double declaration across 416 schemas, module by module. An `opaque-schema` ratchet counts legacy `createSchema(fn)` parsers that `describe()` cannot introspect, and they reach 0 by Phase 16.

- `bigintString` and `Money`/`Asset` (`{ amount: bigintString, asset: AssetCode }`) carry an exponent table: USD 2, USDC 6.
- `sealed(schema)` marks a field as secret. It is AES-256-GCM-encrypted when written to `sys_outbox.sealed`, decrypted only for the subscriber, and redacted in logs.

### 7.5 Gate changes

| Before                                                             | After                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-contract-sync:strict`                                         | A tsc error, because handlers are exhaustive per endpoint                                                                                      |
| `api-client-sync`, `api-response-sync`, generated-client freshness | Deleted. The client is inferred and responses are validated in dev and test.                                                                   |
| route-contract coverage                                            | Retargeted: every registered route comes from a contract. Legacy RouteMap entries without a contract are a ratcheted allowance that reaches 0. |
| `api:check` (not in the merge gate)                                | Part of `bslt gate merge` as `snapshot:api`                                                                                                    |
| Every endpoint                                                     | Must have at least one HTTP test with a failure assertion (`endpoint-tests` gate, retargeted from route coverage)                              |

---

## 8. Events, outbox, jobs and cron

### 8.1 Tables (kernel baseline `main/kernel/db/sql/0001_sys.sql`, owner `kernel`)

- `sys_outbox(id bigserial PK, name text, version int, payload jsonb, sealed bytea NULL, actor_user_id uuid NULL, org_id uuid NULL, occurred_at timestamptz, dispatched_at timestamptz NULL)`, with a partial index on undispatched rows.
- `sys_jobs`: the existing `job_queue` (0405) plus the 0915 idempotency key, renamed at reset. It adds `queue`, `priority`, `status` (adding `dead`), `last_error`, `dead_at`, a unique `(name, idempotency_key)`, and completed-row retention.
- `sys_cron`: the existing `cron_jobs` (0907), renamed.
- `sys_migrations(source, name, checksum, applied_at)`.
- The dead `jobs` table (0400) is dropped in the reset.

### 8.2 Publish

```ts
await req.tx(async (tx) => {
  const task = await repo(tx).create({ ownerUserId: req.viewer!.userId, title: body.title });
  await k.events.publish(tx, tasksEvents.created, { taskId: task.id, userId: task.ownerUserId });
  return { task: toTask(task) };
});
```

`publish` INSERTs into `sys_outbox` inside the caller's transaction. Nothing runs inline, and the event exists only if the transaction commits.

The 49 `.catch(() => {})` side-effect sites go to 0 through the `swallowed-catch` ratchet, and the lint rule `no-empty-catch-callback` blocks new ones.

Transactional auth emails (verify, reset, magic link, OTP) are **not** notifications. Identity enqueues a `identity.send_email` job in the same transaction, and the job calls the kernel `Mailer`.

### 8.3 Dispatch and subscribers

- **Wake-up.** The kernel job `sys.outbox.dispatch` runs on `PROCESS_ROLE=worker|all`. It wakes on `NOTIFY bslt_outbox` (dedicated `LISTEN_DATABASE_URL`) and polls every 1 s as a fallback.
- **Claim and fan-out.** It claims rows with `FOR UPDATE SKIP LOCKED`. In one transaction it:
  1. Publishes realtime projections for events with `realtime` metadata through the PubSubAdapter. These are ephemeral; clients refetch on reconnect.
  2. Enqueues **one `sys_jobs` row per durable subscriber**. The idempotency key is `${eventId}:${moduleId}.${subscriberId}`.
  3. Marks the outbox row dispatched.
- **Independence.** Each subscriber retries, backs off and dead-letters independently. A broken webhook endpoint cannot block audit.
- **Delivery semantics.** Delivery is at least once. Subscribers receive `eventId` and must be idempotent. Ordering is guaranteed only per subscriber per org (FIFO by id within a claim), and the docs say so.

Projection subscribers (all fed by metadata, never by `dependsOn`):

| Projection                               | Owner                     | Trigger                                                                       |
| ---------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| Audit stream and activity feed           | `audit`                   | `audit` / `activity` metadata                                                 |
| `notify()` pipeline                      | `notifications`           | `notify` metadata plus `notificationKinds` templates from the producer's slot |
| Outbound webhooks                        | `webhooks`                | `webhook: true`. The advertised list is derived from event defs.              |
| Analytics canonical events               | `analytics`               | `analytics` metadata                                                          |
| Realtime invalidation and payload frames | kernel (`@bslt/realtime`) | `realtime` metadata                                                           |

Direct subscribers (`on(def, handler)`) are allowed only for events of modules in `dependsOn`. One example is `orgs` provisioning the personal org on `identity.user.registered`.

### 8.4 Jobs and cron

- Jobs are declared in `module.ts` with a payload schema, `maxAttempts`, `timeoutMs` and `queue`. Handlers live in the binding and are type-checked for exhaustiveness. Enqueueing is transactional.
- `QueueServer` runs per queue with configured concurrency: `default` on `worker`, `media` on `media-worker`. Dev role `all` runs everything.
- Metrics cover depth, age, attempts and dead count. The console shows dead letters with retry and discard.
- Cron entries (`job`, `schedule`, `catchUp`) run on the existing advisory-lock leader. **Cron only enqueues jobs**, never does work on the request process.
- The 13 per-replica `setInterval` tasks move to cron in Phase 10. Legacy ones go through the legacy cron list until their module migrates.
- The lint rule `no-setinterval-in-server` allows `setInterval` only inside kernel runtimes.
- Kernel crons: outbox retention (dispatched rows older than 7 days), `sys_jobs` completed-row retention, dead-job metrics.

### 8.5 Gates and tests

- `events` gate (emit-site): every `EventDef` in a module's `events` has a statically found `publish(<tx>, <module>Events.<key>` call in that module's `server/`. Every `webhook: true` event appears in the generated docs.
- `@bslt/testing.runSubscriberTwice(subscriber, event)` asserts idempotency. It is mandatory for every subscriber test (module-shape gate).
- Real-DB test (Phase 10): a rolled-back transaction delivers nothing; a committed event is delivered exactly once per subscriber across a forced retry.

### 8.6 Realtime (upgrade lands with the notifications wave, Phase 14)

- `defineChannel(name, { auth: Auth | 'anonymous-read', authorize(viewer, params) })` registry. It is **deny-by-default**: only declared channels exist.
- Server-signed channel grants and a single-use WS ticket (`POST /api/realtime/ticket`) replace the JWT subprotocol.
- Re-authorization on the `identity.session.revoked` event closes the sockets.
- Two message classes:
  - invalidation `{ key, version }`, kept for CRUD;
  - typed payload frames with per-channel sequence numbers and bounded history.
- `bufferedAmount` slow-consumer policy, plus per-socket subscription and message caps.
- Anonymous read-only public channels and a generic presence primitive.
- `PubSubAdapter`: Postgres default, RESP over `protocols/resp` optional. The listener starts only on `realtime`/`worker` roles.
- Owned RFC 6455 on the `node:http` upgrade event, validated by Autobahn (a dev-only container in the nightly CI job). A k6 fan-out baseline is recorded before the switch and runs nightly.
- The `realtime/permissions` engine (913 LOC) is deleted. Channel authorizers use the one authz model.

---

## 9. Data layer

### 9.1 Ownership in ONE flat `public` schema

1. **Prefixes.**
   - Every table is `<moduleId>` or `<moduleId>_<entity>`. The kernel owns `sys_*`.
   - Enums carry the same prefix. The preferred form is TEXT with a CHECK constraint (for example, the `billing_provider` ENUM becomes TEXT plus a registry).
   - Functions and triggers carry the prefix or `sys_`.
   - Each module's migration PR renames its tables inside its still-editable baseline. Examples: `users` → `identity_users`, `tenants` → `orgs`, `webhook_deliveries` → `webhooks_deliveries`, `events` → `analytics_events`.
   - The prefix gate keeps a shrink-only legacy-name list that reaches 0 by Phase 16 and goes strict in Phase 20.
2. **Module-owned migration files.**
   - Modules own `main/modules/<id>/server/migrations/NNNN_<name>.sql`. The kernel owns `main/kernel/db/sql/`.
   - During coexistence, `main/kernel/db/legacy-migrations/<owner>/0001_<owner>.sql` holds tables whose module has not migrated yet. `<owner>` is the target module id.
   - Apply order is the kernel first, then modules topologically by `dependsOn`, then by file number.
3. **Catalog attribution, computed and not parsed.**
   - `bslt db catalog` applies the sources one at a time to a scratch database as `bslt_owner`. After each source it snapshots `pg_catalog`: tables, columns, constraints, indexes, triggers, functions, policies and grants.
   - Every object is attributed to the source that created it.
   - The gate fails if a source alters or drops another source's object. This is the 0700/0900/0901/0902 cross-module ALTER pattern (DB-04), and the gate catches it permanently.
   - The gate also fails if a FK targets a module outside `dependsOn` (M1), or if the attributed table set differs from `module.ts` `tables`.
4. **Committed snapshot.**
   - The catalog is written to `main/kernel/db/catalog.snapshot.json`.
   - Every other generator reads the committed snapshot, so `bslt sync` and `bslt gate merge` need no database.
   - The real-DB CI lane recomputes the catalog and fails on any diff.

### 9.2 One owner column per row; "org" is the term

- Each `owner_user` / `owner_org` table has exactly one NOT NULL owner column: `owner_user_id` or `org_id`, never both nullable. The catalog gate checks this through the RLS class.
- Child rows carry their own owner column.
- Org-owned: billing, entitlements, webhook endpoints, flags overrides. Recommended: every individual gets a personal org, provisioned on `identity.user.registered` on all login paths. This is owner decision D6.
- User-owned: tasks, sessions, notifications, files, preferences.
- `system` class: audit, analytics, sys_*. Actor ids have no FK.
- Financial FKs use `ON DELETE RESTRICT`.

### 9.3 Clean baseline reset (Phase 6; no bridge)

1. Merge `fix/security-defects` first, so its roles and RLS migrations are part of the input.
2. Apply `0000`-`0917` plus the security migrations to a scratch database. Run `pg_dump --schema-only`.
3. Hand-clean, with each item landing alongside a failing-then-passing test:
   - drop `jobs`, `tenant_settings`, `billing_tenant_backfill_audit`;
   - create the 0906 refresh-token index under a unique name (today it collides with `0000:179`, so `IF NOT EXISTS` makes it a no-op);
   - make the invitation unique partial (`WHERE status = 'pending'`; today `UNIQUE (tenant_id, email)` at `0100:77`);
   - add provider-id uniques and drop redundant indexes;
   - drop the phantom `reminder_sent_at`;
   - rename `notification_type` to `notifications_level`;
   - set financial FKs to `RESTRICT`;
   - rename `job_queue` → `sys_jobs` and `cron_jobs` → `sys_cron`.
4. Split by owner: `main/kernel/db/sql/0001_sys.sql` plus `main/kernel/db/legacy-migrations/{identity,orgs,billing,notifications,audit,webhooks,flags,files,compliance,analytics,tasks,support}/0001_<owner>.sql`. Owner-to-file mapping:

   | Today's migration                                                     | Goes to                          |
   | --------------------------------------------------------------------- | -------------------------------- |
   | `0000`/`0001`/`0002`/`0701`/`0903`/`0905`/`0906`/`0908`/`0909`/`0916` | identity                         |
   | `0100`/`0911`                                                         | orgs                             |
   | `0200`/`0404`/`0902`                                                  | billing                          |
   | `0300`/`0301`/`0914`/`0917`                                           | notifications                    |
   | `0401` (+ activities `0601`)                                          | audit                            |
   | `0402`                                                                | webhooks                         |
   | `0403`                                                                | flags                            |
   | `0500`/`0913`                                                         | compliance                       |
   | `0600`                                                                | files                            |
   | `0800`/`0904`                                                         | tasks                            |
   | `0910`                                                                | support                          |
   | `0912`                                                                | analytics                        |
   | `0700`/`0900`/`0901` (cross-cutting)                                  | dissolved into each owner's file |
   | `0405`/`0907`/`0915`                                                  | kernel                           |

5. **Oracle:** the `db-catalog` snapshot diff before vs after the reset must equal exactly the reviewed hand-clean list. Run the full real-DB and e2e suites on the reset before deleting the 37 numbered files.
6. **Pre-v1 policy:** baselines are editable in place until `foundation-v1` (Phase 20). A checksum mismatch prints `run: pnpm bslt db reset`. The deploy job recreates the demo database while the baseline is unfrozen. After v1, files are append-only and the runner refuses changed checksums (recorded in `bslt.lock.json`).
7. **Runner:**
   - It follows the Rust runner design: `sys_migrations(source,name,checksum)`, `pg_advisory_lock`, a `-- bslt:no-transaction` marker, and sources ordered by the DAG.
   - It has one entry point, `bslt db migrate`. `db:push`, `apps/server/src/migrate.ts` and the other entry points are deleted.
   - CI e2e, real-DB and dev all use it. This fixes TEST-04 and the `MIGRATIONS_DIR` hard-code.
   - Legal templates become idempotent required seeds owned by compliance.

### 9.4 Roles and RLS templates

Roles, in `0001_sys.sql`, completing the Phase 0 work:

- `bslt_owner`: owns all objects and runs migrations (`MIGRATION_DATABASE_URL`).
- `bslt_app`: LOGIN, NOSUPERUSER, NOBYPASSRLS, DML grants only (`DATABASE_URL`).
- `bslt_worker`: LOGIN, NOBYPASSRLS. It gets explicit `system` policies and narrow cross-owner policies per job (retention, rollup) (`WORKER_DATABASE_URL`).
- Plus `LISTEN_DATABASE_URL`. No environment, compose file or workflow uses `postgres` for the app.

```sql
-- main/kernel/db/sql/0001_sys.sql (excerpt)
CREATE FUNCTION sys_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION sys_current_org_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;
CREATE FUNCTION sys_max_audience() RETURNS smallint LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(NULLIF(current_setting('app.max_audience', true), '')::smallint, 0) $$;

/** ENABLE + FORCE RLS, (re)create rls_app_* / rls_worker_* policies from the class template, apply the grant matrix,
    and record COMMENT ON TABLE ... IS 'rls:<class>'. Classes: owner_user | owner_org | public_read | system | append_only. */
CREATE FUNCTION sys_apply_rls(tbl regclass, class text, owner_col name DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ ... $$;

/** Opt-in, taxonomy-free audience backstop: RESTRICTIVE policy `col IS NOT NULL AND col <= sys_max_audience()`
    for non-owners; NULL (unrated) is invisible to everyone but the owner (fail closed). Labels live in the fork. */
CREATE FUNCTION sys_apply_audience(tbl regclass, col name, owner_col name) RETURNS void LANGUAGE plpgsql AS $$ ... $$;
```

- **Session:** one bound statement per request transaction: `SELECT set_config('app.user_id',$1,true), set_config('app.org_id',$2,true), set_config('app.role',$3,true), set_config('app.max_audience',$4,true)`. This replaces 5 round trips (DB-15).
- **Proof that every table is protected:**
  1. **Generated structural test per table** (`server/generated/rls.real-db.test.ts`): FORCE is on, the policies equal the class template exactly, and the grants equal the role matrix.
  2. **Behavioural tests once per class** on kernel fixture tables (`main/kernel/db/src/rls.real-db.test.ts`), run as `bslt_app` and `bslt_worker`: cross-user and cross-org read, update and delete return 0 rows, a foreign-owner insert fails WITH CHECK, and audience fails closed.
  3. **Required owner-isolation test per `owner_user`/`owner_org` table** via `describeOwnerIsolation({ table, insert: (ownerId) => ... })` from `@bslt/testing`. The module supplies an insert factory and the helper runs insert-as-A, read/update/delete-as-B. The module-shape gate requires one per such table.
- `bslt db audit` fails on any unclassified table.
- The schema-per-tenant toolkit (`main/server/db/src/tenancy.ts`, `DB_TENANCY_MODE`) is deleted.

### 9.5 Codegen and repositories

- **Rows.** `bslt sync rows` (DB-free, from the snapshot) writes `server/generated/rows.ts` per module. Legacy owners get `main/kernel/db/legacy-generated/<owner>.ts` until they migrate. The fixed type map is: uuid → branded `Id<'<table>'>` (FK-derived brands), timestamptz → `Date`, bigint → `bigint`, numeric → `string`, jsonb → `JsonValue`, plus enum and CHECK unions. This replaces the hand `db/src/schema/*.ts` (3.4k LOC, with `version` missing from 21 column maps). `REQUIRED_TABLES` and startup validation derive from the snapshot.
- **Repositories** live only in `server/repository.ts`.
  - Lint bans the builder, `sql` and table specs outside `main/modules/*/server/repository*.ts` and `main/kernel/db`.
  - They are created per transaction from a cheap factory (`repo(tx)`), replacing the 40-repositories-per-request factory.
  - Table constants are never exported from a module package.
  - The `raw-sql-outside-repos` ratchet goes from about 25 core files to 0.

---

## 10. Gating, capability context and authorization

### 10.1 Installed or absent (static)

`bslt.config.ts` `installedModules` is the only switch. An absent module contributes no routes, tables, subscribers, jobs, nav or bundle code. `devOnly` modules are emitted only inside `if (import.meta.env.DEV)` lazy imports and are excluded from production server lists.

This deletes, in Phase 11:

- `main/profiles/**`
- the profile files `main/apps/server/src/bootstrap/generated/profile.generated.ts` and `main/profiles/generated/enabled-capabilities.generated.ts` (plus the web copy)
- `isServerCapabilityEnabled`
- `main/apps/server/src/bootstrap/optional-import.ts` (SRV-05)
- the 9 `VITE_ENABLE_*` flags
- the profile audits

### 10.2 Process roles (static, per deployment)

`PROCESS_ROLE = api | realtime | worker | media-worker | web | all`:

- One server image runs `api|realtime|worker|media-worker|all`. The web image runs `web` (static + SSR).
- The role decides which runtimes start: HTTP, WS gateway, which QueueServer queues, and leader cron.
- Each role has health checks, symmetric drain on SIGTERM (WS draining included), and histograms labelled by instance and role.
- A composition smoke test boots each role from `buildApp()`.

### 10.3 Runtime capability context (dynamic, per request and viewer)

```ts
// @bslt/contract
export interface CapabilityContext {
  readonly modules: ReadonlySet<string>;
  readonly flags: Readonly<Record<string, boolean>>;                 // flags module
  readonly entitlements: ReadonlySet<string>;                        // entitlements module
  readonly eligibility: {                                            // compliance (+ identity)
    readonly tosAccepted: boolean; readonly emailVerified: boolean;
    readonly ageVerifiedFor: number | null; readonly jurisdiction: string | null;
  };
  readonly viewer: Viewer | null;
  readonly actingAs: { readonly kind: 'user' } | { readonly kind: 'org'; readonly orgId: string; readonly permissions: bigint };
  readonly maxAudience: number;                                      // feeds app.max_audience; default 0
}
/** ONE isomorphic evaluator: server guard chain, SPA route guards, nav filtering, SSR (public only). */
export function evaluate(req: Requirement, ctx: CapabilityContext): { ok: true } | { ok: false; code: RequirementCode } { ... }
```

- The kernel defines only the shape and the merge. Each field comes from a module's `context` slot, memoized per request and invalidated through realtime when its source events fire.
- It is served at `GET /api/platform/context` and loaded at SPA boot. SSR uses an anonymous context.
- **One client interceptor** in `@bslt/client-engine` turns requirement 403s (`TOS_ACCEPTANCE_REQUIRED`, `EMAIL_NOT_VERIFIED`, `ENTITLEMENT_REQUIRED`, `AGE_ASSURANCE_REQUIRED`) into the owning module's interstitial route, registered via the web binding. This generalizes today's ToS gate. `TOS_EXEMPT_PATHS` become endpoints without the requirement.
- **As built in Phase 11 (2026-11-15), the SPA gates only legacy routes.** A legacy route with a `when` is absent from the settled table when the context denies it; while the viewer's context is loading (`CapabilityLoadStatus` `'loading'`, which includes a session still hydrating), every such route holds its slot with a placeholder (`createPendingAppRoutes`, pinned by `routes.test.ts`), so no URL is resolved against a context that is not the viewer's. A module's `WebRoute.requires` is not enforced yet. Before the first gated surface moves into a module (Phases 13 to 16), `createWebApp.getRoutes` must enforce `requires` through `canAccessCapability` and hold such routes while the status is `'loading'`, which moves the pending rule into the kernel. The settled SPA semantics are capability-first (an absent route), while the server checks auth first.
- An anonymous viewer's `flags` come from each row's untargeted global value; org overrides, allow-lists and partial rollouts apply only to a signed-in viewer. A module's anonymous read (`k.db.viewer(null)`) runs as `bslt_app` with no user id, never as the worker.

### 10.4 One authorization model

The model is route level, plus the org permission bitmask, plus RLS.

- **Permission bits** are allocated append-only in `bslt.lock.json`, for example `{ "orgPermissionBits": { "orgs.members.manage": 0, "billing.manage": 1, ... }, "tombstoned": [...] }`. Removed bits are tombstoned and never reused, so installing or removing modules (including fork modules) never shifts stored `orgs_roles` bitmasks. `bslt sync permissions` appends. The `lockfile` gate fails on reordering or reuse.
- **API keys** are scoped (a subset of the user's access, plus an org binding). Creating one requires sudo, and every use is audited via events.
- **Deleted:** `main/server/core/src/permissions` (648 LOC), `apps/server` permission middleware (510 LOC), about 1.4k LOC of unregistered middleware and plugins, shared `can()`, the central policy files and `realtime/permissions`.

---

## 11. Web platform layer and public-route SSR seam

### 11.1 Platform layer

`createWebApp({ modules: installedWebModules, legacy })` derives the following at runtime with a flatMap (rung 2):

- the route table (shell, auth, requires);
- nav per slot and the command palette (from the `palette` slot; hidden when signed out);
- settings sections (one list for both the modal and the pages);
- admin surfaces and dashboard tiles (the dashboard becomes a hub);
- the notification-route map;
- the type-gated `siteMap`. The existing reachability test is retargeted: every route is reachable from a nav slot or marked `unlisted`.
- the persistence allowlist (from endpoint `persist`), replacing the `queryPersistencePolicy` denylist (WEB-06).

`ClientEnvironment` exposes exactly: `sdk`, `auth` (memory-only token), `capabilities`, `actingAs` (injected into transport headers **and** query keys, which fixes WEB-05), the realtime channel registry, `t()` and theme.

Deleted:

- the localStorage fallback in `main/apps/web/src/app/authToken.ts` (WEB-17);
- `app/capabilities.ts`;
- `starterSurface.ts`;
- adminSurface tier/starter fields;
- the ~10 hand registries.

Feature code imports only `@bslt/web-platform`, `@bslt/ui`, `@bslt/react`, its own module, and `./contract`/`./web` of modules in `dependsOn`. ESLint enforces this.

### 11.2 Coexistence (Phase 9)

Each hand registry becomes a reader of the aggregated contribution set, one consumer per commit, in this order:

1. `app/routes.tsx`
2. `AppLeftMenu.tsx` (hint map and links)
3. command palette data
4. `starterSurface.ts`
5. adminSurface
6. the 4 settings-section lists
7. `siteMap.ts`
8. notification-route map
9. `queryPersistencePolicy.ts`
10. dashboard tiles

Their data moves to `main/apps/web/src/legacy/contributions.ts` (shrink-only). `starterSurface.ts` is deleted then, because editions are gone.

### 11.3 Public SSR seam (approved reversal of DIRECTION.md's SPA-only stance)

```ts
// main/kernel/web/src/ssr/public-route.ts
export interface PublicRoute<D> {
  readonly path: string;
  load(ctx: {
    readonly sdk: AnonymousSdk;
    readonly params: Readonly<Record<string, string>>;
    readonly url: URL;
  }): Promise<D>;
  head(data: D): HeadTags; // title, description, canonical, og:*, twitter:card, robots, JSON-LD
  readonly Component: ComponentType<{ readonly data: D }>;
  sitemap?(sdk: AnonymousSdk): AsyncIterable<{ readonly path: string; readonly lastmod?: string }>;
  readonly cacheSeconds: number; // Infinity = also prerendered at build
}
export function renderPublic(
  url: URL,
  routes: readonly PublicRoute<unknown>[],
  env: SsrEnv,
): Promise<SsrResult>; // renderToString
export function hydratePublic(root: Element, routes: readonly PublicRoute<unknown>[]): void; // hydrateRoot
```

How it works:

- `AnonymousSdk` is typed to expose only endpoints with `auth: 'public'` and `cache.public`. A gate fails any other call. A test fails if a `load()` ever receives a session or cookie.
- **Server.** `main/apps/web/src/server/serve.ts` runs on `node:http` (owned, no framework) as `PROCESS_ROLE=web`. It serves fingerprinted assets as immutable. For a path matching a public route it:
  1. calls `load()` through the anonymous SDK against `API_INTERNAL_URL` (no cookies forwarded);
  2. `renderToString`s inside `PublicShell` with a per-request `QueryCache`;
  3. dehydrates the cache into `<script type="application/json" id="__BSLT_STATE__">` with `<` escaped;
  4. injects the head tags;
  5. sets `Cache-Control` from `cacheSeconds`.

  All other paths get the SPA `index.html`.

- **Client.** `entry-public.tsx` is a lean entry with no app shell, no auth restore and no IDE panes. It calls `hydrateRoot` when the state marker is present and skips the splash. A test asserts there is no client re-render of server markup.
- **Build.** A Vite client build plus a Vite SSR build of `serve.ts`. The server reads the client manifest by file path (no cross-app imports). `bslt web prerender` uses the same `renderPublic` for `cacheSeconds = Infinity` routes. This replaces `main/apps/web/src/ssr/{prerender.ts,ServerApp.tsx,SsrContext.tsx}` and `entry-server.tsx`.
- `/sitemap.xml` is a runtime sitemap index, and boot fails in production without `SITE_URL`. Lighthouse budgets apply to the public entry.
- Caddy routes `/api` to `api`, the generated public patterns to `web`, and everything else to static SPA assets.
- First consumers: `status` (Phase 18), then legal pages (compliance) and landing.
- Also in this area: the service worker caches only fingerprinted assets, honours `no-store`/`private`, and clears on logout. CSP and Permissions-Policy are generated (§14.2). The PWA manifest is completed.

---

## 12. UI system

There are no new runtime dependencies. `@bslt/ui` is the only place visual decisions live.

1. **Tokens.**
   - The TS sources to generated CSS pipeline and the pre-paint theme init are kept.
   - One theme module in `ui/theme` exports `THEME_STORAGE_KEYS`, which ends the `app-theme-mode` vs `theme-mode` split. High contrast is derived from tokens.
   - New tokens:
     - a brand accent scale (50-950) with on-accent, sourced from `bslt.config.ts` `brand`;
     - `--ui-color-border-control` at ≥3:1 against surface in both themes, used on every control including `.radio-circle`; the hairline survives only on decorative dividers;
     - `--ui-z-*` and `--ui-elevation-*`, replacing 13 raw z-indexes;
     - motion tokens that collapse under `prefers-reduced-motion`;
     - semantic tones (success, warn, danger, info, and neutral hooks `live`, `premium` and `locked` that the fork themes);
     - a display type scale and media aspect tokens.
   - The four token vocabularies collapse to `--ui-*`. Storefront and rust-access tokens leave with Phase 1.
2. **Contrast gate:** a token-pipeline unit test computes every fg/bg, `*-on-*`, control-border/surface and focus-ring pair in light, dark and high contrast. It fails below 4.5:1 for text and 3:1 for UI components (WCAG 1.4.11). The control token and the gate land in **Phase 5**.
3. **Styling contract:**
   - Recipe components with typed `variant`/`size` (`sm|md|lg`)/`tone` props rendered as `data-*` attributes, in layered CSS (`@layer ui.tokens, ui.base, ui.recipes, ui.utilities, app`).
   - Layout primitives `Stack`, `Inline`, `Grid`, `Cluster`, `Center`, `AspectRatio`. Utilities are cut to layout-only.
   - Inline style objects are banned outside `@bslt/ui` (ratchet from 129; runtime CSS variables excepted).
   - A stylelint rule bans descendant selectors against `.ui-*` (14 page BEM overrides).
   - `cn()` is mandatory. `forwardRef` is removed (React 19; 53 files). The four `lint:css` gates are kept.
4. **Consolidation:**
   - one Dialog core (modal, non-modal, Sheet/Drawer/BottomSheet);
   - one toast API, one `AsyncBoundary`, `PageShell`/`PageHeader`;
   - one `StatusBadge tone` (no `@bslt/shared/core` imports).
   - Domain components move to their modules: the 10 billing components (~43% of `components.css`) go to `billing/web/components`; session, device and profile cards go to identity; `ProtectedRoute` becomes a shell guard.
   - DS pieces with no consumer after the waves are deleted.
5. **Icons:** an owned SVG set in `main/kernel/ui/icons/*.svg`. `bslt sync icons` writes `icons.generated.ts` (an `IconName` union plus a sprite). `<Icon name>` and an `IconButton` `icon` slot replace 13 inline SVGs and text glyphs.
6. **Named shells,** chosen by `WebRoute.shell`:
   - `PublicShell`: marketing, legal, status; used by SSR.
   - `AuthShell`.
   - `AppShell`: fixed-height top bar, responsive left nav, `BottombarLayout` on mobile from slot `app.primary`.
   - `ConsoleShell`: the only resizable panes; admin and devtools.

   The IDE four-pane shell (`main/apps/web/src/app/layouts/*`, `AppShell.css`, `useAppShellPanes`) is deleted once every route declares a shell. The DS shell CSS prefixes are renamed (CLI-05).

7. **A11y gates:**
   - The axe gate fails on `serious`.
   - `eslint-plugin-jsx-a11y` (dev dependency).
   - DS strings arrive through props.
   - `react/jsx-no-literals` (plus aria-label/title/placeholder literals) applies to `main/modules/**/web/**`, so `t()` is required.
   - en-US only: the 8 other locale maps are deleted, and the locale-parity audit becomes an en-US key-usage check.
8. **Catalog as regression surface:** a generated story index (one story per DS export; a missing story fails CI) plus Playwright screenshots per story in both themes. The `/ui-library` key collision is fixed, and demo CSS stops shipping in the DS.

Sequencing:

- Phase 5: the contrast token.
- Each module wave: domain components move with their module.
- Phase 17: shells and recipes, once web bindings exist, so shell assignment is data rather than a rewrite.

---

## 13. Runtime dependency replacement plan

**Rule:** the runtime `dependencies`, `peerDependencies` and `optionalDependencies` of every workspace package must be a subset of `{react, react-dom, @bslt/*}`. Dev tooling is exempt (typescript, tsx, vite, vitest, playwright, eslint + jsx-a11y, prettier, turbo, knip). Configured infrastructure (Postgres, Valkey, ffmpeg, Caddy) is allowed. Vendors are reached over HTTP or standard protocols behind owned ports, with no SDK packages.

**Enforcement (Phase 5):** `bslt gate deps-allowlist` compares every `package.json` with `main/tools/gates/deps-allowlist.json`:

- Entries look like `{ name, replacement, removeBy: <phase>, conformance }`, seeded with today's set.
- The gate fails on any addition and on any entry whose `removeBy` phase is past.
- `react` and `react-dom` are marked `permanent`.
- Each replacement PR deletes its line and the old adapter.

| Order                  | Package(s)                                                                             | Replacement                                                                                                                                                                                                                | Phase              | Conformance                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| Leaves with extraction | `fastify`, `nodemailer`, `stripe` as used by `@bslt/storefront`                        | n/a (extracted)                                                                                                                                                                                                            | 1                  | lockfile has no storefront importer                                                                     |
| A1                     | `pino`, `pino-pretty`                                                                  | owned JSON logger in server-system (levels, redaction paths, child loggers, same output shape); dev pretty printer as a tools script                                                                                       | 12                 | log-shape snapshot                                                                                      |
| A2                     | `@fastify/compress`                                                                    | `node:zlib` br/gzip negotiation in the HTTP adapter                                                                                                                                                                        | 12                 | HTTP tests                                                                                              |
| A3                     | `otpauth`                                                                              | `@bslt/protocols/totp`                                                                                                                                                                                                     | 12                 | RFC 6238 App. B / RFC 4226 vectors                                                                      |
| A4                     | `argon2`                                                                               | `node:crypto` argon2 (verify the Node 24 minor in the PR and pin `.node-version`; hash format may change because no data is preserved)                                                                                     | 12                 | RFC 9106 vectors                                                                                        |
| A5                     | `@sentry/react`, `@sentry/node`                                                        | owned error reporter: `POST /api/platform/errors` (consent-gated, masked) plus server error events in the logger                                                                                                           | 12                 | tests                                                                                                   |
| A6                     | `@fastify/swagger`, `@fastify/swagger-ui`                                              | OpenAPI JSON generated from contracts (`docs/reference/openapi.json`)                                                                                                                                                      | 12 (after 8)       | snapshot                                                                                                |
| A7                     | `@simplewebauthn/browser`                                                              | `navigator.credentials` plus owned base64url/JSON helpers                                                                                                                                                                  | 12                 | passkey e2e                                                                                             |
| A8                     | `@stripe/stripe-js`, `@stripe/react-stripe-js`                                         | hosted-checkout redirect                                                                                                                                                                                                   | 15 (billing)       | billing e2e                                                                                             |
| B1                     | `ws`                                                                                   | owned RFC 6455 (`@bslt/protocols/ws` + realtime gateway)                                                                                                                                                                   | 14 (notifications) | Autobahn (nightly, dev container)                                                                       |
| B2                     | `web-push`                                                                             | `@bslt/protocols/webpush` (VAPID ES256 + RFC 8291 aes128gcm)                                                                                                                                                               | 14                 | RFC 8291 vectors                                                                                        |
| B3                     | `ioredis`                                                                              | `@bslt/protocols/resp` (GET/SET/INCR/EXPIRE/EVALSHA/PUBLISH/SUBSCRIBE, reconnect, TLS)                                                                                                                                     | 14                 | real Valkey service in CI                                                                               |
| B4                     | `@aws-sdk/client-s3`, `@aws-sdk/credential-providers`, `@aws-sdk/s3-request-presigner` | `@bslt/protocols/s3` (SigV4, presign, Put/Get/Head/Copy/Delete, multipart incl. ListParts/Abort)                                                                                                                           | 14 (files)         | AWS SigV4 test suite + MinIO lane                                                                       |
| B5                     | `sharp`                                                                                | ffmpeg in `files/server/media` (decode, autoOrient, resize, re-encode, metadata strip)                                                                                                                                     | 14                 | ffprobe asserts no metadata                                                                             |
| B6                     | `stripe`                                                                               | `billing/server/providers/stripe` over `fetch` plus owned `Stripe-Signature` HMAC on `node:crypto`                                                                                                                         | 15                 | recorded webhook fixtures                                                                               |
| C1                     | `fastify`, `fastify-plugin`                                                            | owned router on `node:http` behind the RouteMap adapter (radix match, body limits, raw body, cookies, streaming, timeouts, multipart for remaining uploads, graceful drain)                                                | 19                 | full HTTP suite + api-surface snapshot on **both** adapters in a CI matrix until the old one is deleted |
| C2                     | `@simplewebauthn/server`                                                               | identity's verifier on `@bslt/protocols/{cbor,cose}` + `node:crypto` (ES256/RS256/EdDSA; attestation scope per owner decision D11)                                                                                         | 19                 | W3C/FIDO vectors + recorded fixtures + passkey e2e                                                      |
| C3                     | `postgres`                                                                             | `@bslt/protocols/pg` behind `RawDb` (SCRAM-SHA-256, TLS, extended query with binary-safe params, pool with session reset, LISTEN/NOTIFY on a dedicated connection, statement timeout, cancel, bigint/timestamptz decoding) | 19                 | entire real-DB suite on **both** drivers in a CI matrix + protocol fault injection                      |

Exit: `deps-allowlist.json` = `[react, react-dom]`, and every `main/**` package's runtime dependencies are empty except `@bslt/*` and web's react/react-dom. The `security` job in `ci.yml` keeps `pnpm audit --prod`.

---

## 14. Tooling, CI and docs

### 14.1 `@bslt/tools` and the gate registry (Phase 2)

- `main/tools/package.json` (`@bslt/tools`, bin `bslt`) makes the tools a turbo-visible package. This deletes `type-check:tools`, `test:tools` and the hand-picked tools lint (TOOL-05, TOOL-09).
- `main/tools/gates/registry.ts` holds entries `{ id, run(ctx): Promise<CheckResult>, lanes: ('merge'|'changed'|'nightly'|'manual')[] }`. Every audit exports `run()` and is imported by the registry. The 33 `process.argv[1].includes(...)`/basename guards (TOOL-02) are first made safe in Phase 1 (`import.meta.url === pathToFileURL(process.argv[1]).href`) and then deleted in Phase 2, because scripts run only through the registry.
- `bslt gate --self-test` asserts that every registered check executed and produced a result.
- `bslt gate merge` replaces `ci:merge-gate`, `ci:fast`, `ci:verify` and 127 hardcoded `--filter` flags. It runs only after reproducing `ci:merge-gate` gate for gate. Pre-push runs `bslt gate merge --changed`, so `@bslt/core` is no longer skipped locally.
- `main/tools/lib/paths.ts` is the single repo-paths module. It replaces about 35 depth-relative roots, plus `vite-build-args`, csp-sync, real-DB file lists and the playwright config paths.
- `@bslt/build-config` replaces `main/tools/scripts/audit/shared-vitest-aliases.ts` and the relative `../../tools` imports in 14 builds and 13 configs.
- Aliases collapse to package `exports` with a `source` condition plus `customConditions` (Phase 3, one package per PR). This deletes about 410 tsconfig `paths` entries in 27 files and `vite-tsconfig-paths`. App-internal aliases become package.json `imports` (`#app/*`).
- Root scripts go from 156 to about 35, all `bslt ...` calls.
- Path headers are kept and maintained by `bslt sync headers`, which every move codemod and `bslt module new` call (D20).

### 14.2 Generation: the derivation ladder (written into `docs/specs/principles.md`)

1. **Rung 1, type inference.** Handler and job exhaustiveness, SDK types, query keys, install agreement (`satisfies`), i18n keys, requirement and permission unions.
2. **Rung 2, runtime flatMap over the installed list.** Routes, nav, palette, settings, admin, dashboard, notification routes, persistence allowlist, channels, subscribers, guards, capability context.
3. **Rung 3, committed generated file.** Only where something crosses a module, language or tool boundary, and each needs a written justification:

| Command                                          | Output                                                                                                            | Why rung 3                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `bslt sync modules`                              | `main/apps/*/src/generated/modules.ts`, app package.json `@bslt/*` deps, `main/tools/generated/module-graph.json` | static imports for bundling; pnpm and ESLint read files |
| `bslt db catalog` (DB)                           | `main/kernel/db/catalog.snapshot.json`                                                                            | language boundary (SQL)                                 |
| `bslt sync rows`                                 | `server/generated/rows.ts`, `server/generated/rls.real-db.test.ts`                                                | language boundary                                       |
| `bslt sync permissions`                          | `bslt.lock.json`                                                                                                  | stored bitmask stability                                |
| `bslt sync docs`                                 | `docs/reference/*`, module README blocks, the DIRECTION.md status block                                           | human docs                                              |
| `bslt sync openapi`                              | `docs/reference/openapi.json`                                                                                     | non-TS consumers                                        |
| `bslt sync csp`                                  | `infra/runtime/caddy/security-headers.generated.caddy` + server constant                                          | Caddy config (replaces 4 hand copies and csp-sync)      |
| `bslt sync env`                                  | `.env.example` sections from manifest `env` + kernel config                                                       | dotenv file (replaces env-examples sync)                |
| `bslt sync refs` / `headers` / `icons` / `theme` | `tsconfig.json` references, path headers, `icons.generated.ts`, token CSS                                         | tool configs and assets                                 |

Anti-magic rules:

- Generated files are committed, sorted and deterministic.
- Headers read `// @generated by bslt sync <cmd> from <sources>. Do not edit.`, and each derived line carries `// <- <file>#<key>`.
- `bslt gen explain <file:line>` resolves provenance.
- Generators emit lists, imports and single-call delegations only, never logic.
- A generator never rewrites hand-written text, except its owned JSON keys and the marked doc blocks.
- The `generated` gate re-runs every sync in memory, diffs the results, and **fails on any `*.generated.*`, `generated/` file or generated block that no command produced** (orphan rule).
- `bslt gate merge` needs no database. The real-DB lane runs `bslt db catalog --check`.

### 14.3 Gates and ratchets (all in `bslt gate merge` unless noted)

| Gate                                                                                                                                                              | Purpose                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot:api`, `snapshot:db-catalog`, `snapshot:web-routes`                                                                                                      | Oracles. An unintended diff fails. An intended diff is committed with the PR and called out in its description.                                                                         |
| `tombstones`                                                                                                                                                      | Deleted paths and symbols (`main/tools/gates/tombstones.ts`) must not reappear                                                                                                          |
| `legacy-shim`, `frozen-paths`                                                                                                                                     | Shrink-only counts. No new files under `main/shared/src/{modules,contracts,constants}`, `main/server/core/src`, `main/client/api/src` or `main/apps/web/src/features` (until Phase 20). |
| `deps-allowlist`                                                                                                                                                  | §13                                                                                                                                                                                     |
| `version-pins`                                                                                                                                                    | Node and PG are read from `.node-version` / `infra/versions.env` everywhere. Actions are pinned by SHA.                                                                                 |
| `module-shape`, `module-graph`                                                                                                                                    | §5.4. DAG acyclic; projection modules never in `dependsOn`; FK rule                                                                                                                     |
| `events` (emit-site)                                                                                                                                              | §8.5                                                                                                                                                                                    |
| `generated` (incl. orphans), `lockfile`                                                                                                                           | §14.2, §10.4                                                                                                                                                                            |
| `db:audit` (real-DB lane)                                                                                                                                         | ownership attribution, classification, FORCE, prefix (ratchet → strict)                                                                                                                 |
| `swallowed-catch`, `raw-sql-outside-repos`, `setinterval`, `opaque-schema`, `inline-style`, `unused-exports` (knip budget from 899 down)                          | Ratchets that can only go down, including on kernel exports (wired or deleted)                                                                                                          |
| `endpoint-tests`                                                                                                                                                  | Every endpoint has an HTTP test with a failure assertion                                                                                                                                |
| `contrast`, `axe-serious` (e2e), `jsx-a11y`, `i18n-literals`                                                                                                      | §12                                                                                                                                                                                     |
| `lint:css` (4 gates), test-pair ratchet (`bslt sync test-pairs` after moves), `docs-links` (with backticked `main/` paths, TEST-19), `package-exports`/`esm-dist` | Kept and retargeted                                                                                                                                                                     |
| `ssr-public-only`                                                                                                                                                 | `AnonymousSdk` may call only `cache.public` endpoints; logged-in routes are never server-rendered                                                                                       |

Audits deleted:

- `prune-proof`, prune manifests, editions export checks, `starter-docs`/`starter-defaults`, `template-readiness` (Phase 1);
- `api-client-sync`, `api-response-sync`, generated-client freshness (Phase 8);
- `profile-boundaries` (Phase 11);
- gate-coverage check #2 (filter list gone);
- locale parity;
- csp-sync and env-examples (replaced by generators).

### 14.4 Tests

- `@bslt/testing`:
  - `buildTestApp()` is the production `buildApp()`. `createTestServer`'s hand-built composition root is deleted (TEST-03).
  - `describeRealDb` gives an isolated database per suite from the real runner, connecting as `bslt_app` (TEST-05). It replaces 26 copies.
  - `describeOwnerIsolation`, `runSubscriberTwice`.
  - Fakes for kernel ports. The 30 `createMockLogger` copies are deleted.
  - One repository-based seeder (TEST-04).
- The 19 single-package files in `tests/integration` (11.3k LOC) move into their modules as those migrate. The mock "integration" tier is folded into unit tests or deleted (TEST-02).
- `tests/` keeps only cross-module HTTP journeys (`tests/integration/api/full-journey.real-db.test.ts` is the tasks oracle), real-DB RLS suites and Playwright e2e.
- A composition smoke test per `PROCESS_ROLE`, plus an image boot test.

### 14.5 CI and deploy: one of each

`.github/workflows/ci.yml` (triggers: pull_request, push to main, nightly schedule). Jobs:

- `setup`: composite action; Node from `.node-version`.
- `static`: `bslt gate merge` (types, lint, css, boundaries, deps, generated, snapshots).
- `unit`.
- `real-db`: PG 17 service from `infra/versions.env`; runner; catalog check; RLS suites as `bslt_app`/`bslt_worker`; role smoke tests.
- `e2e`: capability-aware smoke, axe serious, catalog screenshots.
- `security`: CodeQL, Semgrep, OSV, Gitleaks, Trivy on images, `pnpm audit --prod`. Blocking policy per `docs/dev/security-ci.md`.
- `nightly-only`: Autobahn, k6 fan-out, full Lighthouse.
- `images`: the server image with PROCESS_ROLE and the web image.

`.github/workflows/deploy.yml`:

- one deploy path: DO reference Terraform with remote, locked, encrypted state;
- prod compose with **no database**;
- health-gated rolling restart of stateless roles;
- environments `staging`, `demo`, `production`;
- `workflow_dispatch` inputs for `rollback <sha>` and `terraform plan|apply`;
- the demo database is reset on deploy while baselines are unfrozen.

Deleted:

- Phase 1: `editions.yml`, `publish-core.yml`, `storefront-deploy.yml`, `rust-backend.yml`, `template-readiness.yml`, `auto-merge-claude-sessions.yml`, `pr-preview.yml`, `.woodpecker/`, `infra/ci/woodpecker`.
- Phase 4: `continuous-integration.yml`, `security-scanning.yml`, `dependency-audit.yml` (folded into `ci.yml`); `application-deploy.yml`, `staging-deploy.yml`, `demo-deploy.yml`, `deployment-rollback.yml`, `infrastructure-deploy.yml`, `infrastructure-destroy.yml`, `infrastructure-test.yml` (folded into `deploy.yml`).
- `web-deploy-cloudflare.yml`: folded into a `deploy.yml` job in Phase 4, and that job is deleted in Phase 18 if owner decision D7 picks the web role.
- `database-backup.yml`: kept as the one transitional file and deleted in Phase 20 once in-network encrypted backups plus PITR run in `infra/runtime/backup` (verified by a restore drill).
- The GCP path becomes a docs note.

### 14.6 Docs

- `docs/DIRECTION.md` is the single status doc. Its status block is generated from manifests (`bslt sync docs`). The prose records the restructure and the SSR reversal.
- `docs/CLAUDE.md` (the completeness score) is folded in and deleted.
- `docs/specs/principles.md` is rewritten (Phases 8 and 20):
  - new Code Placement table (module folders, kernel rules);
  - the derivation ladder;
  - coexistence rules (removed at v1);
  - "Zod" references corrected to the owned schema library (also in the agent guide).
- New docs: `docs/specs/modules.md` (canonical shape, manifest, recipe "add a feature = `bslt module new`") and `docs/specs/data.md`.
- Generated: `docs/reference/*`.
- Deleted:
  - Phase 1: `docs/architecture/{core-and-extensions,installable-features,feature-installer-review}.md`, `docs/dev/prune.md`, `docs/deploy/storefront.md`.
  - `layer-map.md` and `server-dependency-dag.md` (replaced by generated `module-dag.md`).
  - `api-contract-matrix.md` and `docs/api/*.md` (generated `api.md`).
  - `FEATURE.md` per feature (module READMEs).
- `docs/legal` content moves to compliance seeds (TEST-21). Stale docs go to `docs/archive`.
- The agent guide becomes a tracked `AGENTS.md` at the root (the current `.claude/CLAUDE.md` is untracked and stale, TEST-22). `.claude/CLAUDE.md` points to it.

---

## 15. Extraction: distribution repo and Kanu

### 15.1 `bslt-distribution` (private, frozen)

- Created with `git filter-repo` (history preserved) from `ff07d363`. Contents:
  - `main/editions/**`, `main/extensions/**`, `main/apps/storefront/**`, `infra/storefront/**`;
  - `main/tools/features/**`, `main/tools/setup/**`, `main/tools/scripts/editions/**`, `main/tools/scripts/recipes/**`, `main/tools/scripts/profiles/**`;
  - `main/tools/scripts/starter/{prune.ts, prune-manifests.ts, prune-manifests-features.ts, prune-manifests-packages.ts, prune-proof.ts, smoke.ts}` and their tests;
  - workflows `editions.yml`, `publish-core.yml`, `storefront-deploy.yml`, `template-readiness.yml`;
  - docs `architecture/{core-and-extensions,installable-features,feature-installer-review}.md`, `dev/prune.md`, `deploy/storefront.md`.
- Tagged `frozen-ff07d363`. The README states: frozen, unmaintained against bslt-main, buildable only at its tag. Owner decision D10 covers whether it keeps CI.
- Kept in bslt-main: `starter/rename.ts` and `starter/scope-rename.ts` (fork tools, moved to `bslt rename` in Phase 2), and `starter/feature.ts` until Phase 8 rewrites it as `bslt module new`. `main/profiles` is not extracted; it is deleted in place in Phase 11.
- Seed carried forward: the `InstalledServerFeature`/`FeatureWebhook` contract (`main/editions/core/main/apps/server/src/extensions/types.ts.template`) is reproduced conceptually in `ServerModule` (`verifiers` + `auth: { webhook, rawBody }`) before extraction, so nothing in bslt-main imports it.

### 15.2 Kanu handoff

- With `git filter-repo`: `main/apps/server-rust/**` (1,821 lines of `.rs`, `bslt_rust` migrations), `main/apps/web/src/features/rust-access/**`, `main/apps/web/tests/rust-access.e2e.spec.ts`, `.github/workflows/rust-backend.yml`, and the Rust docs.
- Coordinated with the Kanu owner (owner decision D12).
- In bslt-main, the same PR removes:
  - the rust-access vite input, React entry and aliases;
  - the rust `paths-ignore` lists in `continuous-integration.yml` and `demo-deploy.yml`;
  - the `/api/session` api-client-sync exclusion.
- A pointer note goes in `docs/archive/server-rust.md`.

### 15.3 After `foundation-v1`: the distribution channel (owner direction, 2026-11-12)

The owner's product goal for bslt, beyond the foundation:

- **Core is free.** Anyone can download it and run it.
- **Extra features are bought and installed as plug-in modules.** The buyer picks features, installs them in one step, and each installed feature works completely: server, web, data and jobs.

The extracted machinery (§15.1) aimed at this goal and is not brought back. It installed and removed features by editing source text (RC3), so the features most worth selling (billing, organizations, advanced auth, notifications) were declared unprunable. The module system is the precondition. The channel is built on it after the tag and is not one of the phases in §17.

What the foundation keeps true, so that the channel stays a thin layer. These are G1, G2 and G5 seen from the channel's side; a phase that breaks one of them breaks the channel.

1. **Installing a module is one entry in `bslt.config.ts`** (§6.5, §10.1). `bslt sync modules` derives everything else, and removing the entry removes the feature. No other file is edited, by hand or by a tool.
2. **A module is a self-contained package.** It imports kernel packages and the public surface of the modules in its `dependsOn`, and nothing else, so it can be shipped apart from the repository.
3. **No optional module is entangled.** The app builds and passes `bslt gate merge` without any module that no installed module depends on. A gate that proves this for each optional module does not exist yet; it is part of the channel work.
4. **A module owns its migrations** (§9.1), so a module installed into a running product brings its own tables. After the tag the runner applies a new source forward.
5. **The kernel knows nothing about prices or licences.** Whether a module is free or paid is the channel's data, not a manifest field the kernel reads.

What the channel adds, after the tag:

- Core as a published repository: this repository with the install list of the free modules.
- A source for paid module packages (a store), and a licence check.
- `bslt module add <id>`: fetch the package, add the entry to `bslt.config.ts`, run `bslt sync modules` and `bslt db migrate`.
- A first-run picker that writes the install list from the features chosen.

Open: owner decision D14 (§20).

---

## 16. Coexistence rules (Phase 8 through Phase 20)

- **C1. One seam per runtime.** `buildApp({ modules, legacy })` and `createWebApp({ modules, legacy })`. No feature registers anywhere else. `legacy` is deleted in Phase 20.
- **C2. A feature lives in exactly one place at every commit.** A migration is `git mv` plus edits in one PR series. No dual-write and no re-export shims. Old symbols are deleted and tombstoned in the same PR.
- **C3. Import direction.** Modules import kernel packages and the public entries of `dependsOn` modules, never `@bslt/shared`, `@bslt/core`, `@bslt/api` or `main/apps/*`. Legacy code may import kernel packages and module public entries, never module internals.
- **C4. Frozen legacy.** No new files in frozen paths. Only deletions, defect fixes with tests, and calls into kernel APIs are allowed.
- **C5. One owner per DB object** at all times: `kernel`, a module id, or `legacy:<target>`.
- **C6. Oracles unchanged** in a migration PR unless the diff is intended, committed and described.
- **C7. Module shells allowed.** A module may first exist with only `module.ts` plus `contract/events.ts` (for example `orgs` in Phase 10), listing its remaining parts as pending in the legacy input.
- **C8. Green at every commit.** `bslt gate merge`, real-DB (as `bslt_app`) and e2e smoke pass on every commit. Ratchets only go down.
- **C9. Security-branch fence.** No structural PR touches files `fix/security-defects` owns until it merges. At the time of writing that is `main/server/realtime/src/**`, `main/shared/src/modules/db/pubsub/authorize*`, `tests/integration/api/websocket-auth.integration.test.ts` and `realtime.real-db.test.ts`, plus whatever it adds for roles, storage signing and anonymization.

---

## 17. Phased plan

### 17.1 Overview

| #   | Phase                                                                           | Depends on     | Parallel with | Effort |
| --- | ------------------------------------------------------------------------------- | -------------- | ------------- | ------ |
| 0   | Security defects (in flight)                                                    | none           | none          | M      |
| 1   | Extract distribution machinery and Rust                                         | 0              | none          | M      |
| 2   | Tools spine: `@bslt/tools`, gate registry, paths                                | 1              | none          | M      |
| 3   | Alias collapse and `@bslt/build-config`                                         | 2              | 4, 5          | L      |
| 4   | One CI, one deploy, version pins                                                | 2              | 3, 5          | M      |
| 5   | Oracles, `buildApp`, testing kit, ratchets, deps allowlist, contrast token      | 2              | 3, 4          | L      |
| 6   | DB foundation and clean baseline reset                                          | 0, 5           | 3, 4          | L      |
| 7   | Kernel mechanical move                                                          | 3, 5           | 6             | S      |
| 8   | Contract layer, module host, one transport, **tasks**                           | 6, 7           | none          | L      |
| 9   | Web contributions seam                                                          | 8              | 10            | M      |
| 10  | Events, outbox, one queue, cron; orgs shell; **webhooks**                       | 8              | 9             | L      |
| 11  | Capability context, **flags**, process roles; delete profiles/VITE flags        | 9, 10          | 12            | M      |
| 12  | Runtime deps tranche A                                                          | 5, 8           | 11, 13-17     | M      |
| 13  | Wave A: **support, status, search, analytics**                                  | 10, 11         | 12, 17        | M      |
| 14  | Wave B: **audit, notifications** (+realtime upgrade), **files**, **moderation** | 13             | 12, 17, 18    | XL     |
| 15  | Wave C: **compliance, orgs, entitlements, billing**                             | 14             | 17, 18        | XL     |
| 16  | Wave D: **identity, admin, devtools**                                           | 15             | 17, 18        | XL     |
| 17  | UI system and named shells                                                      | 9              | 12-16, 18     | L      |
| 18  | Public SSR seam                                                                 | 9, 13          | 14-17         | M      |
| 19  | Runtime deps tranche C (fastify, WebAuthn, postgres)                            | 16             | 17, 18        | XL     |
| 20  | Delete legacy, docs, ops hardening, tag `foundation-v1`                         | 16, 17, 18, 19 | none          | M      |

Critical path: 0 → 1 → 2 → 5 → 6/7 → 8 → 10 → 11 → 13 → 14 → 15 → 16 → 19 → 20. Phases 12, 17 and 18 run alongside the waves. Every phase leaves main green: type-check, lint, unit, real-DB as `bslt_app` and e2e smoke.

### 17.2 Phase detail

**Phase 0: Security defects** (in flight on `fix/security-defects`; owned by the concurrent workflow)

- Delete the realtime record `write`/`getRecords` proxy onto `users` (SRV-01), with an HTTP/WS regression test that `password_hash` is unreadable and `role` is unwritable.
- Signed, expiring local URLs and authenticated `/uploads`. Register the HMAC file server or delete it (SRV-14).
- Roles `bslt_owner`/`bslt_app`/`bslt_worker`, the app connecting as `bslt_app`, FORCE on policy tables, fixes for unsafe policies (DB-02), and a cross-user/cross-tenant denial suite as `bslt_app`.
- One anonymization format, with a test that workers-path users are hard-deleted (SRV-07).
- Cheap duplication defects, each with a failing test first: `billingNotifier` wiring (SRV-02), phone_verified reset (T-AUTH-I09), logout-all bumps tokenVersion (T-AUTH-I06), avatar null-out (T-AUTH-I11), invitation re-send (DB-05), username policy (SHR-05).

Exit criteria:

- Branch merged. `ci:merge-gate` and real-DB green.
- The real-DB suite connects as a NOSUPERUSER NOBYPASSRLS role in CI.
- The old path is deleted: realtime record API code and the unsigned `getSignedUrl` path are removed, not disabled.
- Exactly one anonymizer implementation remains.
- Each fixed defect has a test that failed before its fix.

**Phase 1: Extract distribution machinery and Rust**

- PR 1: convert the 33 argv/basename main-module guards to `import.meta.url === pathToFileURL(process.argv[1]).href`. Add a test that every audit script still runs when invoked by path.
- PR 2: create `bslt-distribution` (§15.1). PR 3: Kanu handoff (§15.2).
- PRs 4..n: delete the extracted paths in bslt-main together with:
  - their root scripts (`editions:*`, `features:*`, `recipes:*`, `starter:prune*`, `setup`, `enable`);
  - their audits;
  - ESLint blocks for `.template` files;
  - prune anchor comments;
  - the edition steps in `ci:merge-gate`.
    Each PR runs tools type-check and tests.
- Delete the workflows listed in §14.5 for Phase 1, and `.woodpecker/`.
- Update DIRECTION.md (no editions, no Rust). Add the first tombstones.

Exit criteria:

- **Old paths deleted and tombstoned:** `main/editions`, `main/extensions`, `main/apps/storefront`, `main/apps/server-rust`, `main/apps/web/src/features/rust-access`, `main/tools/{features,setup}`, `main/tools/scripts/{editions,recipes,profiles}`, prune files.
- No `@bslt/storefront` importer in `pnpm-lock.yaml`.
- `git grep -E 'editions/|storefront|server-rust|rust-access|prune-manifest|PRUNE_MANIFESTS|\.template'` matches only `docs/log` and `docs/archive`.
- Both receiving repos show history (`git log --follow` on a moved file).
- `ci:merge-gate`, real-DB and e2e green.

**Phase 2: Tools spine**

- Add `main/tools/package.json` (`@bslt/tools`, bin `bslt`). Turbo lint, type-check and test cover it.
- Add `main/tools/gates/registry.ts`. Convert every audit to an exported `run()`. Add `bslt gate --self-test`.
- Implement `bslt gate merge` reproducing `ci:merge-gate` gate for gate (diff the check lists in the PR), then delete the `ci:*` chains and the guards.
- Add `main/tools/lib/paths.ts` and repoint `vite-build-args`, csp-sync, test-pairs, real-DB lists and the playwright config.
- Move rename tools to `bslt rename`. Root scripts ≤ 45.

Exit criteria:

- **Old path deleted:** zero `process.argv[1].includes`/basename guards; `ci:merge-gate`/`ci:fast`/`ci:verify` scripts deleted.
- Every registered gate passes `--self-test`.
- Pre-push runs `bslt gate merge --changed`.

**Phase 3: Alias collapse and `@bslt/build-config`**

- Create `main/build-config` (vite/vitest factories, ESM extension fixer, eslint preset) and import it by package name in 14 builds and 13 configs.
- Package by package, one per PR: add `exports` with a `source` condition, `customConditions: ["source"]` in `tsconfig.base.json`, and `resolve.conditions` in vite and vitest. App-internal aliases become `imports` (`#app/*`). Each PR runs the web build, prerender and full vitest, with the turbo cache bypassed for the series.

Exit criteria:

- **Old path deleted:** zero tsconfig `paths` entries; `vite-tsconfig-paths` and `shared-vitest-aliases.ts` deleted and tombstoned.
- No relative `../../tools` import.
- The turbo graph includes `@bslt/tools` and `@bslt/build-config`.

**Phase 4: One CI, one deploy, version pins**

- `.node-version` (24.x), `infra/versions.env` (PG 17, PgBouncer digest), engines `>=24 <25`.
- Dockerfiles move off Node 22/20 and read the pins. Add a dedicated `LISTEN_DATABASE_URL`.
- Build `ci.yml` and `deploy.yml` (§14.5). The prod compose loses the database. Add remote locked Terraform state. Pin actions by SHA.

Exit criteria:

- **Old paths deleted:** the workflows listed for Phase 4 in §14.5.
- `.github/workflows/` contains `ci.yml`, `deploy.yml` and only the transitional `database-backup.yml`.
- The `version-pins` gate is green.
- Every lane runs Node 24 and PG 17.
- A staging rolling deploy succeeds with no DB restart.

**Phase 5: Oracles, `buildApp`, testing kit, ratchets, allowlist, contrast token**

- Add `bslt snapshot api` (composed router plus routes registered at boot), `bslt snapshot db-catalog` and `bslt snapshot web-routes` (paths, guards, nav, settings, admin entries). Commit the snapshots.
- Extract `buildApp()` from `main/apps/server/src/main.ts` and `bootstrap/*`.
- Create `main/testing` (`@bslt/testing`: `buildTestApp`, `describeRealDb` as `bslt_app`, fakes).
- Add the ratchets `deps-allowlist` (seeded, with `removeBy`), `tombstones`, `swallowed-catch` (49), `raw-sql-outside-repos`, `setinterval`, `unused-exports`, `inline-style` (129) and `opaque-schema`.
- Add `--ui-color-border-control` and apply it to every control border, including `.radio-circle`. Add the contrast check.

Exit criteria:

- Three snapshots committed and enforced. All ratchets active.
- **Old path deleted:** `createTestServer`'s hand composition root deleted; the 26 `describeRealDb` copies replaced.
- The composition smoke test passes on `buildApp()`.
- The contrast gate is green in both themes.

**Phase 6: DB foundation and clean baseline reset**

- Build the runner (§9.3.7) in `@bslt/db` and do the reset (§9.3).
- Add `sys_apply_rls`, `sys_apply_audience` and the `sys_*` helpers. Classify every table and FORCE the user/org classes.
- Add `bslt db catalog`, the snapshot and `bslt sync rows` (legacy-generated per owner). Replace the hand `db/src/schema/*.ts` and derive `REQUIRED_TABLES`.
- Harden the client: tx retry, timeouts, one `set_config`, `skipLocked`/`noWait`, bigint.
- Add the per-class behavioural RLS tests on kernel fixtures and the generated structural tests per table.
- Repoint the real-DB harness, e2e setup and CI to the runner.
- Delete `tenancy.ts`/`DB_TENANCY_MODE`.

Exit criteria:

- **Old paths deleted and tombstoned:** `main/server/db/migrations/0*.sql` (37 files), `db:push`, `apps/server/src/migrate.ts` entry points, `tenancy.ts`, the hand `schema/*.ts` row types and `*_COLUMNS`, the `REQUIRED_TABLES` literal.
- The `db-catalog` diff equals the reviewed hand-clean list.
- `bslt db audit` is green: every object attributed, every table classified, FORCE on user/org tables.
- The real-DB suite (as `bslt_app`) and e2e are green.

**Phase 7: Kernel mechanical move** (one commit series, no logic)

- `git mv`:
  - `main/server/{db,system,storage,comms,realtime}` → `main/kernel/{db,server,storage,comms,realtime}`;
  - `main/client/{engine,react,ui}` → `main/kernel/{client,react,ui}`.
- Package names are unchanged. Because aliases were collapsed in Phase 3, no import specifier changes.
- Update workspace globs, run `bslt sync headers`, and update the ESLint boundaries elements.

Exit criteria:

- **Old directories gone** (`main/server/{db,system,storage,comms,realtime}`, `main/client/{engine,react,ui}`).
- All suites green.
- Zero import specifier changes in the diff (checked).

**Phase 8: Contract layer, module host, one transport, tasks module**

- Create `@bslt/schema` from `main/shared/src/schema` (codemod imports), with the combinators, `Infer`, `describe()` and `~standard`.
- Create `@bslt/contract` (endpoint, `defineModule`, `defineConfig`, ErrorCode registry, envelope, `Requirement`/`evaluate` with `auth` levels only). `apiRouter` becomes `composeRouter(legacyRouter, installedModules)`.
- Add the module host in `@bslt/server-system` (`implementServer`, contract → RouteMap via `registerRouteMap`, guards from `auth`, validation, envelope). Add `buildApp({ modules, legacy })` with `legacy` = today's `core/route-modules.ts` plus the app route modules.
- Build one transport in `@bslt/client-engine`. Re-point `createCsrfRequestClient`. Add `createEndpointClient`, `useEndpoint` and `useEndpointMutation`.
- Add `bslt.config.ts` and `bslt sync modules` (with `satisfies ServerImpls`). Rewrite `starter:feature` as `bslt module new`.
- Migrate **tasks** (§18.2).
- Rewrite the principles.md Code Placement table.

Exit criteria:

- **Tasks old paths deleted and tombstoned** (§18.2 list). No tasks entry in `core/route-modules.ts`, `client/api` index, db factory or barrels, `routes.tsx` or `starterSurface.ts`.
- api-surface and web-routes snapshots unchanged. The db-catalog diff is only `tasks.owner_id → owner_user_id`.
- `bslt module new example` in a temp workspace passes `bslt gate merge`.
- The `legacy-shim` count drops by the tasks entries.
- The `api-client-sync` and `api-response-sync` audits are deleted.

**Phase 9: Web contributions seam**

- Add `createWebApp({ modules, legacy })` and `implementWeb`. Convert the ten registries one per commit (§11.2).
- Move tasks' route and nav to `tasks/web/index.ts`. Tasks becomes reachable from the palette, an intended web-routes diff that fixes "Tasks missing from the palette".

Exit criteria:

- **Old paths deleted:** `starterSurface.ts`, adminSurface tier/starter fields, and every hand list outside `legacy/contributions.ts`.
- The web-routes snapshot changes only by the reviewed palette entry.
- The `siteMap` reachability test retargeted and green.

**Phase 10: Events, outbox, one queue, cron; orgs shell; webhooks module**

- Start `QueueServer` on `worker` (and `all` in dev), with per-queue concurrency, dead letters, retention and metrics.
- Add `sys_outbox`, `events.publish`, the `sys.outbox.dispatch` job (NOTIFY wake plus SKIP LOCKED) and per-subscriber fan-out.
- Move the 13 `setInterval` tasks to cron (legacy ones through the legacy cron list), including the analytics partition-maintenance cron that stops rows landing in `events_default`.
- Create the **orgs shell** (`module.ts` plus `contract/events.ts`: `orgs.member.added`/`removed` with `webhook: true` and audit metadata). Legacy `tenants/handlers/members.ts:145,:300` publishes in-transaction.
- Migrate **webhooks** (§18.3). Add the manifest `env` field (first consumer: `env.webhooks.ts`).
- Delete `WriteService`, the in-memory `CustomJobQueue` and media orchestrator, and the duplicate `@bslt/media/http`.
- Enable the `events` gate and `runSubscriberTwice`.

Exit criteria:

- **Old paths deleted and tombstoned:** `emitWebhookEvent`, the `WEBHOOK_EVENT_TYPES` literal, the webhook retry interval, `WriteService`/`write-types`, `CustomJobQueue`, the media orchestrator, the duplicate media http module.
- `setInterval` exists only in kernel runtimes.
- Real-DB proof: rollback delivers nothing, and a commit delivers exactly once per subscriber across a forced retry.
- The webhook delivery integration tests are unchanged and green. The api-surface snapshot is unchanged.

**Phase 11: Capability context, flags module, process roles**

- Add `CapabilityContribution` aggregation, `GET /api/platform/context`, requirement codes in the guard chain with typed 403s, and the client interceptor.
- Migrate **flags** (`flags_overrides`, admin contribution, `context` slot, manifest `flags` field).
- Generalize the ToS gate into `tos.accepted`, contributed by legacy compliance through the legacy context list.
- Add `PROCESS_ROLE` startup: realtime, media-worker and worker start by role. Add role-labelled histograms and event-loop lag metrics.
- The SPA `CapabilityProvider` replaces `app/capabilities.ts`. Map each `VITE_ENABLE_*` to an installed module or a runtime flag. `AUTH_STRATEGIES` becomes `context.authStrategies`.

Exit criteria:

- **Old paths deleted and tombstoned:** `main/profiles`, both profile `*.generated.ts`, `isServerCapabilityEnabled`, `optional-import.ts`, profile audits, `core/feature-flags`, and `git grep VITE_ENABLE_` = 0.
- A contract test shows the server context and the SPA guards agree.
- A smoke test boots every role.

**Phase 12: Runtime deps tranche A** (A1-A7 in §13; parallel lane)

- Create `@bslt/protocols` with `totp`.

Exit criteria:

- Each package removed from every `package.json` and from the allowlist.
- Conformance green (RFC vectors, log-shape snapshot, passkey e2e).
- **Old adapter code deleted** in each PR.
- If the Node 24 minor lacks `crypto.argon2`, A4 waits on that release, with its `removeBy` moved by an owner-visible PR. It never switches algorithm silently.

**Phase 13: Wave A (support, status, search, analytics)**

- Each module follows the per-module DoD (§18.1).
- search: implements Postgres FTS, replacing the throwing `FullText`.
- analytics: partitioned `analytics_events`, consent-gated anonymous ingest, canonical events from `analytics` metadata, rollup.
- status: tables and public endpoints with `cache.public` (the SSR consumer in Phase 18).
- support: anonymous endpoint plus admin contribution.
- Any module the owner drops in D2 is deleted here instead.

Exit criteria:

- **The four modules' legacy paths deleted and tombstoned.** No legacy-shim entries remain for them.
- Tables prefixed.
- Ratchets lower.

**Phase 14: Wave B (audit, notifications, files, moderation)**

- **audit**:
  - merges `audit_events`, `security_events` and `activities` into `audit_log` (append-only, REVOKE UPDATE/DELETE plus trigger) and `audit_activity`;
  - one noun.verb catalog derived from event names;
  - console views;
  - the `trust_safety` and `compliance` categories;
  - KYC-access logging category.
  - tasks gains `tasks.task.created|updated|deleted` events with audit metadata and realtime invalidation (the reference module now demonstrates events).
- **notifications**:
  - the `notify()` pipeline, the `notificationKinds` slot, preferences, quiet hours, push subscriptions and unsubscribes;
  - the 4 bypassing emitters routed through events;
  - realtime upgrade §8.6 (B1 `ws`, B3 `ioredis`, B2 `web-push`);
  - `@bslt/comms` ports.
- **files**:
  - one record and state machine (uploaded → scanning → processing → pending_review → published | rejected | quarantined);
  - upload sessions in `@bslt/storage` (B4 SigV4) plus an owned resumable multipart upload client in `@bslt/client-engine`;
  - signed delivery for all providers;
  - media jobs on the `media` queue in the media-worker image (pinned ffmpeg, non-root; B5 replaces sharp; magic-byte sniff, pixel limit, autoOrient, metadata strip verified by ffprobe);
  - `access_class`, `sha256`, variants, `legal_hold`/`retain_until`;
  - the audience mechanism (`files.audience_level smallint NULL` plus `sys_apply_audience`; fail closed on NULL);
  - the ContentScanner port with a basic in-repo scanner (size, MIME, magic bytes) and a fail-closed publish gate;
  - avatars (§5.2);
  - manifest `csp` field;
  - `/api/media` routed through contracts.
- **moderation** (new, native):
  - reports (also the no-login notice form), cases, decisions with statements of reasons, appeals;
  - the executor over the `actions` slot (`files.quarantine` first);
  - the ModerationProvider port (fail closed; console adapter);
  - moderator roles.

Exit criteria:

- **Old paths deleted and tombstoned:** `core/{audit,activities,notifications,files}`, `main/server/media`, `apps/server/src/http/media`, the three upload paths, `realtime/permissions`, the JWT-subprotocol path, `tryNotification`/`notifyAdmins`/`logActivity`/inline `record()` call sites, the unused `MediaGallery`.
- `ws`, `web-push`, `ioredis`, `@aws-sdk/*` and `sharp` removed from the allowlist.
- Autobahn, RFC 8291 and SigV4 suites green.
- Real-DB proof that an unrated (NULL audience) asset is invisible to non-owners and that `max_audience` filters.
- Every channel has a deny-by-default authorizer test.

**Phase 15: Wave C (compliance, orgs, entitlements, billing)**

- **compliance**:
  - legal docs (docs/legal moves to seeds), ToS requirement, consent;
  - export/erase orchestration over the `privacy` slot with one anonymizer per owner;
  - retention registry and legal holds;
  - the AgeAssuranceProvider port (attestation adapter) with `compliance_age_assurance_checks` (outcomes only);
  - the JurisdictionResolver (geo gate) and a configurable minimum age (`age.verified:<n>`).
  - Deletes `@bslt/workers`.
- **orgs**:
  - absorbs the shell;
  - renames tenant → org across SQL, contracts and UI, in its own PR inside the wave, with the catalog diff and RLS suites as oracle;
  - partial invitation unique;
  - personal org on `identity.user.registered`;
  - org permission bits via `bslt.lock.json`;
  - acting-as context.
- **entitlements**: `entitlements_grants`, grant/revoke/check, the `context` slot, `entitlement:<key>` requirements.
- **billing**:
  - provider mirror, `billing_payment_inbox` (insert first);
  - PaymentIngress `verify({ rawBody, query, headers, sourceIp })` and HostedCheckout ports;
  - provider registry (TEXT);
  - webhook endpoints in the contract (`auth: { webhook }`; the `verifiers` slot);
  - one plans catalog;
  - org-owned tables, financial FKs RESTRICT;
  - grants written to entitlements; metering wired;
  - dunning via `notify` metadata;
  - reconciliation hook;
  - B6 and A8 (Stripe over REST, hosted checkout).
  - Billing DB-03 is decided by owner decision D6 beforehand.

Exit criteria:

- **Old paths deleted and tombstoned:** `core/{compliance,consent,tenants,billing}`, `registerBillingWebhookRoutes` and the 5 special cases, `shared/contracts/edition-ports.ts`, `BillingNotifier`, `@bslt/workers`.
- At least one endpoint protected by `entitlement:` with a denial test.
- GDPR export and erase covered for every installed module with user data (test enumerates the slot).
- `stripe`, `@stripe/*` removed.
- Billing real-DB suites pass with only the documented owner change in assertions.

**Phase 16: Wave D (identity, admin, devtools)**

- **identity**:
  - characterization first (refresh families, reuse detection and grace window, tokenVersion and liveness, ToS gate order, sudo, email-change revert, CSRF);
  - a mechanical move PR, then behavioural PRs;
  - merges auth, users and api-keys (the cycle disappears);
  - splits `identity_users` into identity, credentials, lockout and profile tables;
  - one `issueSession` for every method;
  - one username policy and one `toUserDto`;
  - scoped, sudo-gated, audited API keys;
  - repositories for all SQL (security events, backup codes, SMS codes);
  - the `privacy` slot;
  - renames `users` → `identity_users` and updates FK targets in the other modules' still-editable baselines in the same PR.
- **admin**: dissolve. Every panel moves to its owning module's `admin` contribution. Kernel jobs, outbox and health panels go in `ConsoleShell`. admin keeps only residue.
- **devtools**: devOnly module (route explorer reads the composed router; UI catalog).

Exit criteria:

- **Old paths deleted and tombstoned:** `core/{auth,users,api-keys,admin}`, `features/{auth,admin,...}`, `client/react` domain dirs.
- The `legacy-shim` ratchet is 0 for server, web, cron, context and migration sources.
- `swallowed-catch`, `raw-sql-outside-repos` and `opaque-schema` are all 0. The prefix legacy list is empty.
- Auth regression suites unchanged in their assertions and green.

**Phase 17: UI system and named shells** (parallel from Phase 9)

- Recipes, layout primitives, the new token families, the icon set, Dialog/Toast/AsyncBoundary consolidation, `forwardRef` removal.
- Every `WebRoute` declares a shell. Implement the four shells.
- Story index, screenshots, axe at serious, jsx-a11y, jsx-no-literals in modules. Delete the non-en-US locales.

Exit criteria:

- **Old paths deleted and tombstoned:** `main/apps/web/src/app/layouts/*` IDE shell, `AppShell.css`, `useAppShellPanes`, duplicate modal/toast/loading wrappers, 13 inline SVGs, 8 locale maps.
- `@bslt/ui` imports no domain type.
- 100% story coverage. axe serious = 0. Contrast green. Inline styles = 0 outside DS.

**Phase 18: Public SSR seam** (parallel after 9 and 13)

- Implement §11.3 with `status` as the first consumer, then legal pages and landing as compliance lands.
- Add the `web` role image and the Caddy routing.
- Implement `bslt web prerender`, sitemaps, Lighthouse budgets, and the SW and PWA fixes.
- Rewrite DIRECTION.md's rendering section.

Exit criteria:

- **Old paths deleted and tombstoned:** `src/ssr/{prerender.ts,ServerApp.tsx,SsrContext.tsx}`, `entry-server.tsx`, the hand list of 8 prerendered pages.
- A crawler fetch returns full content and head tags.
- A hydration test shows no remount.
- A test shows logged-in routes are never server-rendered.
- The `ssr-public-only` gate is green.

**Phase 19: Runtime deps tranche C** (C1 → C2 → C3 in §13, each its own PR series)

Exit criteria:

- `deps-allowlist.json` = `[react, react-dom]`.
- The dual-adapter and dual-driver matrices removed after green on the owned implementations.
- **Old adapters deleted:** Fastify adapter, `fastify.d.ts` types, postgres.js adapter, simplewebauthn wrappers.

**Phase 20: Delete legacy, docs, ops hardening, tag `foundation-v1`**

- Delete:
  - `@bslt/shared`, `@bslt/core` and `@bslt/api` and their files;
  - the `legacy` parameters, `main/apps/*/src/legacy/*`, `main/kernel/db/legacy-migrations`, `legacy-generated`;
  - the coexistence gates (`frozen-paths`, `legacy-shim`). Tombstones are kept.
- The prefix gate goes strict.
- Generate all docs. Rewrite principles.md and DIRECTION.md. Track `AGENTS.md`. Archive stale docs.
- Ops:
  - in-network encrypted backups plus PITR with a restore drill, then delete `database-backup.yml`;
  - the owned OTLP/HTTP exporter (`protocols/otlp`) behind a flag;
  - alert rules deployed with the deploy path.
- Write the migration checksums into `bslt.lock.json`. Tag `foundation-v1`.

Exit criteria:

- **Old paths deleted:** `main/shared`, `main/server/core`, `main/client/api`, `main/server/workers` absent; no `legacy` identifiers in apps.
- Every route, table, job, cron entry, nav item and event is attributed to a module or the kernel in the generated docs.
- `.github/workflows` = `ci.yml`, `deploy.yml`.
- The runner refuses an edited migration.
- Every kernel export has a caller (unused-exports at target).

---

## 18. Module migration order and walkthroughs

### 18.1 Per-module definition of done (every module PR series)

1. **Characterize.** Confirm the module's api-surface and web-routes entries. Add HTTP failure tests and `describeOwnerIsolation` tests for its tables. Land these separately, before any move.
2. **Move the baseline.** `git mv main/kernel/db/legacy-migrations/<id>/0001_<id>.sql main/modules/<id>/server/migrations/0001_<id>.sql`. Rename tables to the prefix and fix the owner column. Replace hand policies with `sys_apply_rls`.
3. **Contract.** Move the shared contracts to `contract/endpoints.ts`. Rewrite schemas with combinators. Paths stay byte-identical.
4. **Repository.** Move the repositories from `@bslt/db` into `server/repository.ts`. Fold in raw SQL from core files. Use `rows.ts`.
5. **Server binding.** Move services and handlers from core into `implementServer`. Delete per-module `routes.ts`, `types.ts` and context types.
6. **Side effects.** Convert them into events plus subscribers, and intervals into cron.
7. **Web.** Move pages, hooks and components from `apps/web/src/features`, `@bslt/react` and `@bslt/ui` into `web/`, using `useEndpoint` and `t()`.
8. **i18n.** Add the en-US keys.
9. **Privacy.** Fill the `privacy` slot once compliance exists.
10. **Delete and tombstone.** Delete the legacy entries and old directories. Add tombstones. Run `bslt sync test-pairs`.
11. **Check snapshots.** They are unchanged, or the intended diff is committed and described.

### 18.2 Order and rationale

| #   | Module                             | Phase | Why here                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | tasks                              | 8     | Smallest complete slice: 4 endpoints, 1 user-owned table with RLS, 1 page. Already covered end to end by `tests/integration/api/full-journey.real-db.test.ts`. Proves the manifest, contract → routes, inferred SDK, migration ownership, rows, repository, web and i18n. The scaffolder template. |
| 2   | webhooks (+ orgs events shell)     | 10    | Smallest real producer/consumer pair. `member.added/removed` already dispatch today, so moving them to outbox → subscriber proves events, jobs and retry cron with zero behaviour change.                                                                                                          |
| 3   | flags                              | 11    | Prerequisite for the capability context. Proves the `context` slot plus an admin contribution.                                                                                                                                                                                                     |
| 4   | support, status, search, analytics | 13    | Small leaves that prove variety: an anonymous endpoint, a public cacheable endpoint, FTS, and the partition cron plus the analytics projection (a live defect fix).                                                                                                                                |
| 5   | audit                              | 14    | First projection. It must precede the producers so their inline audit calls are deleted rather than moved.                                                                                                                                                                                         |
| 6   | notifications                      | 14    | The one `notify()` pipeline must exist before billing, orgs and identity migrate. The realtime upgrade and the ws/web-push/ioredis replacements ride with it.                                                                                                                                      |
| 7   | files                              | 14    | Collapses three upload paths and seven storage-port interfaces. Needs jobs. Carries the @aws-sdk and sharp replacements and the audience and scanner mechanisms. Identity's avatars depend on it.                                                                                                  |
| 8   | moderation                         | 14    | New and generic. First consumer is files (quarantine action and publish gate).                                                                                                                                                                                                                     |
| 9   | compliance                         | 15    | Owns the anonymizer orchestration and the ToS/age requirements. Must precede orgs, billing and identity so their privacy hooks have an orchestrator.                                                                                                                                               |
| 10  | orgs                               | 15    | The org vocabulary and owner model that entitlements, billing and flags key on.                                                                                                                                                                                                                    |
| 11  | entitlements                       | 15    | Billing writes grants rather than shipping unenforced entitlement code (CORE-04).                                                                                                                                                                                                                  |
| 12  | billing                            | 15    | Depends on orgs, entitlements and the projections. Rebuilt as ports plus inbox plus events in one pass.                                                                                                                                                                                            |
| 13  | identity                           | 16    | Highest risk and the FK root. Moves last, behind the full regression net, once every consumer uses its api port.                                                                                                                                                                                   |
| 14  | admin, devtools                    | 16    | Only residue remains after every module contributes its own console surfaces.                                                                                                                                                                                                                      |

### 18.3 First-module walkthrough: tasks (Phase 8)

Preconditions: Phase 6 produced `main/kernel/db/legacy-migrations/tasks/0001_tasks.sql` from `0800_tasks.sql` + `0904_tasks_rls.sql`. Phase 7 moved the kernel directories. Baseline `ff07d363` has 26 tasks files in 6 packages plus `docs/api/tasks.md`.

**Step 0: characterize** (separate PR)

- Snapshot entries: `GET /api/tasks`, `POST /api/tasks/create`, `POST /api/tasks/:id/update`, `POST /api/tasks/:id/delete`, all auth `user`.
- New real-DB test as `bslt_app`: user B cannot list, update or delete A's task, and an insert with a foreign owner fails WITH CHECK.
- `tests/integration/api/full-journey.real-db.test.ts` and `TasksPage.test.tsx` are untouched. They are the behavioural oracle.

**Step 1: moves and rewrites** (before → after)

| Before (`ff07d363`)                                                   | After                                                                                        | Action                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/shared/src/modules/core/tasks/tasks.schemas.ts`                 | `main/modules/tasks/contract/schemas.ts`                                                     | git mv. Rewrite with `object`/`optional`/`refine`; types via `Infer` (the 5 interfaces disappear).                                                                                                                                                                                                                                                                                  |
| `main/shared/src/contracts/contract.tasks.ts`                         | `main/modules/tasks/contract/endpoints.ts`                                                   | git mv. Each entry becomes `endpoint({ method, path, auth: 'user', params, body, response, errors: ['tasks.TASK_NOT_FOUND'], summary })`. create/update/delete gain `invalidates: ['list']`; list gains `persist: true`. **Paths byte-identical.**                                                                                                                                  |
| (new)                                                                 | `main/modules/tasks/contract/errors.ts`                                                      | `defineErrors('tasks', { TASK_NOT_FOUND: 404 })`                                                                                                                                                                                                                                                                                                                                    |
| `main/shared/src/modules/core/tasks/index.ts`                         | (deleted)                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                     |
| `main/server/core/src/tasks/service.ts` (+ `service.test.ts`)         | `main/modules/tasks/server/service.ts` (+ test)                                              | git mv. Takes `(tx, ownerUserId, ...)`.                                                                                                                                                                                                                                                                                                                                             |
| `main/server/core/src/tasks/handlers.ts`                              | `main/modules/tasks/server/index.ts`                                                         | git mv then rewrite as `implementServer`. `getId()`, `unauthorized()`, `notFound()` and try/catch-to-500 are deleted (params parsed by the kernel; `req.fail('TASK_NOT_FOUND')`).                                                                                                                                                                                                   |
| `main/server/core/src/tasks/{routes.ts,types.ts,index.ts}`            | (deleted)                                                                                    | Registration is derived. `TasksAppContext` is replaced by `RequestContext`.                                                                                                                                                                                                                                                                                                         |
| `main/kernel/db/legacy-migrations/tasks/0001_tasks.sql`               | `main/modules/tasks/server/migrations/0001_tasks.sql`                                        | git mv. `owner_id` → `owner_user_id` (intended catalog diff). The hand policy is replaced by `SELECT sys_apply_rls('tasks', 'owner_user', 'owner_user_id');`.                                                                                                                                                                                                                       |
| `main/kernel/db/src/repositories/tasks/tasks.ts` (+ `tasks.test.ts`)  | `main/modules/tasks/server/repository.ts` (+ `repository.test.ts`)                           | git mv. `createTaskRepository(raw)` becomes `tasksRepository(tx)` using generated `TASKS`/`COLUMNS`. The owner predicate is kept as defence in depth.                                                                                                                                                                                                                               |
| (new)                                                                 | `main/modules/tasks/server/repository.real-db.test.ts`                                       | `describeOwnerIsolation({ table: 'tasks', insert })`                                                                                                                                                                                                                                                                                                                                |
| `main/kernel/db/src/repositories/tasks/index.ts`                      | (deleted)                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                     |
| `main/kernel/db/legacy-generated/tasks.ts`                            | `main/modules/tasks/server/generated/rows.ts` + `generated/rls.real-db.test.ts`              | Generated by `bslt sync rows` (replaces hand `schema/tasks.ts`, already gone in Phase 6).                                                                                                                                                                                                                                                                                           |
| `main/client/api/src/tasks/{client.ts,index.ts}`                      | (deleted)                                                                                    | The client is inferred from the contract.                                                                                                                                                                                                                                                                                                                                           |
| `main/apps/web/src/features/tasks/hooks/useTasks.ts`                  | `main/modules/tasks/web/hooks.ts`                                                            | git mv. `useEndpoint(sdk.tasks.list)` and `useEndpointMutation(sdk.tasks.create/update)`. The optimistic delete with NotFound-is-success is kept (real product intent). `TASKS_QUERY_KEY`, the module-level client singleton and the `@app/authToken`/`@config` imports are deleted.                                                                                                |
| `main/apps/web/src/features/tasks/hooks/index.ts`                     | (deleted)                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                     |
| `main/apps/web/src/features/tasks/pages/TasksPage.{tsx,css,test.tsx}` | `main/modules/tasks/web/TasksPage.{tsx,css,test.tsx}`                                        | git mv. Literals become `t('tasks.*')`.                                                                                                                                                                                                                                                                                                                                             |
| `main/apps/web/src/features/tasks/{index.ts,pages/index.ts}`          | (deleted)                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                     |
| (new)                                                                 | `main/modules/tasks/web/index.ts`                                                            | `implementWeb(tasksModule, { routes: [{ path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.title', page: lazyPage(() => import('./TasksPage')) }], nav: [{ to: '/tasks', slot: 'app.primary', label: 'tasks.nav', icon: 'check-square', order: 40 }], messages: () => import('../i18n/en-US.json') })`. The nav entry lands through `legacy/contributions.ts` until Phase 9. |
| `main/apps/web/src/features/tasks/FEATURE.md`                         | `main/modules/tasks/README.md`                                                               | git mv. The hand intro is kept; the "touch points/registrations" tables are replaced by the generated block.                                                                                                                                                                                                                                                                        |
| `docs/api/tasks.md`                                                   | (deleted)                                                                                    | Now in `docs/reference/api.md` (generated).                                                                                                                                                                                                                                                                                                                                         |
| `main/tools/scripts/starter/feature.ts` (+ test)                      | `main/tools/module/new.ts` (+ test)                                                          | Scaffolds `example` and asserts the same file shape as `main/modules/tasks`.                                                                                                                                                                                                                                                                                                        |
| (new)                                                                 | `main/modules/tasks/{module.ts,package.json,tsconfig.json,vitest.config.ts,i18n/en-US.json}` | `defineModule({ id: 'tasks', summary: 'User-owned task list (reference module).', status: 'stable', dependsOn: [identityModule], endpoints: tasksEndpoints, events: {}, jobs: {}, tables: ['tasks'] })`. Until identity migrates, `identityModule` is a **shell** (`main/modules/identity/module.ts` with no endpoints and `tables: []`, listed as pending in the legacy input).    |

**Step 2: registration lines deleted** (line numbers at `ff07d363`; files moved by Phase 7 keep the same lines)

- `main/server/core/src/route-modules.ts:23` (import) and `:38` (`{ module: 'tasks', routes: tasksRoutes }`).
- `main/shared/src/contracts/index.ts:35`.
- `main/shared/src/api/router.ts:24`, `:47` (tasks now arrives through `composeRouter`).
- `main/client/api/src/index.ts:191-193`.
- `main/server/db/src/factory.ts:95`, `:156-157`, `:251-252`.
- `main/server/db/src/repositories/index.ts:86-87`.
- `main/server/db/src/schema/index.ts:185-192` and `main/server/db/src/index.ts:113` (`TASKS_TABLE`), if Phase 6 has not already removed them with the hand schemas.
- `main/server/db/src/validation.ts:74-75` (already gone with catalog-derived `REQUIRED_TABLES` in Phase 6).
- `main/apps/web/src/app/routes.tsx:170`, `:177-178`.
- `main/apps/web/src/app/layouts/AppLeftMenu.tsx:39-41` (hint map) and `:75` (link).
- `main/apps/web/src/app/starterSurface.ts:11`.
- `main/tools/scripts/audit/test-pairs-debt.json` entries (regenerated).
- `bslt.config.ts` gains `tasksModule`. `bslt sync modules` adds the `tasksServer`/`tasksWeb` imports to the generated lists, and tsc rejects either app until both bindings exist.

**Step 3: generated, never hand-edited.** `server/generated/rows.ts`, `server/generated/rls.real-db.test.ts`, `main/apps/*/src/generated/modules.ts`, README block, `docs/reference/api.md` and `openapi.json` sections, the DIRECTION.md status row.

**Step 4: tombstones** (`main/tools/gates/tombstones.ts`)

- Paths: `main/server/core/src/tasks`, `main/shared/src/modules/core/tasks`, `main/shared/src/contracts/contract.tasks.ts`, `main/kernel/db/src/repositories/tasks`, `main/client/api/src/tasks`, `main/apps/web/src/features/tasks`, `docs/api/tasks.md`.
- Symbols: `createTasksClient`, `TasksClient`, `tasksRoutes`, `TASKS_QUERY_KEY`, `TasksAppContext`, `createTaskRepository`.

**Step 5: gates in the same PR**

- `bslt gate merge`.
- api-surface unchanged.
- db-catalog diff = `{ tasks.owner_id → owner_user_id; policy task_owner_isolation_policy → rls_app_owner_user }`.
- web-routes unchanged.
- Real-DB (as `bslt_app`, including the new isolation test) and full-journey green.
- `legacy-shim` and `frozen-paths` counts lower.

**Result:** 26 files in 6 packages plus 11 registration sites become 1 folder: 1 manifest, 2 bindings, 1 migration and 2 generated files. Adding an endpoint now touches `contract/endpoints.ts` and `server/index.ts` (tsc forces the handler), plus optionally `web/hooks.ts`.

### 18.4 Second walkthrough: webhooks (Phase 10)

| Before (`ff07d363`)                                                                                                                                                 | After                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/server/db/migrations/0402_webhooks.sql` → (Phase 6) `legacy-migrations/webhooks/0001_webhooks.sql`                                                            | `main/modules/webhooks/server/migrations/0001_webhooks.sql`: `webhooks` (endpoints, `org_id NOT NULL`, no FK because webhooks is a projection), `webhook_deliveries` → `webhooks_deliveries`; `sys_apply_rls(..., 'owner_org', 'org_id')` |
| `main/shared/src/contracts/contract.webhooks.ts`, `main/shared/src/modules/comms/webhooks/{webhooks.ts,webhookUrl.ts,index.ts}`                                     | `main/modules/webhooks/contract/{endpoints.ts,schemas.ts}` (paths identical)                                                                                                                                                              |
| `main/shared/src/modules/system/config/env.webhooks.ts`                                                                                                             | `module.ts` `env` (first consumer of the field)                                                                                                                                                                                           |
| `main/server/core/src/webhooks/{service.ts,delivery.ts,dispatch.ts,target-policy.ts,handlers.ts}`                                                                   | `main/modules/webhooks/server/{service.ts,delivery.ts,target-policy.ts,index.ts}`; delivery is the job `webhooks.deliver` (`queue: 'default'`, retries, dead state); retry is cron; replay is an endpoint                                 |
| `main/server/core/src/webhooks/{emit.ts,routes.ts,types.ts,index.ts}`                                                                                               | deleted (`emitWebhookEvent` tombstoned); fan-out is `onFlagged('webhook', ...)`                                                                                                                                                           |
| `main/server/core/src/admin/webhookHandlers.ts`                                                                                                                     | merged into `server/index.ts` handlers (admin endpoints keep their paths)                                                                                                                                                                 |
| `main/server/db/src/repositories/system/{webhooks.ts,webhook-deliveries.ts}`                                                                                        | `main/modules/webhooks/server/repository.ts`                                                                                                                                                                                              |
| `main/client/api/src/webhooks/*`, `main/client/react/src/webhooks/*`                                                                                                | deleted (inferred client, `useEndpoint`)                                                                                                                                                                                                  |
| `main/apps/web/src/features/admin/{pages/Webhook*Page.tsx, components/{CreateWebhookDialog.*,WebhookDeliveryRow.tsx,WebhookStatusBadge.tsx}, hooks/useWebhook*.ts}` | `main/modules/webhooks/web/*`, contributed via `admin: [...]` (the status badge becomes `StatusBadge tone`)                                                                                                                               |
| `main/server/core/src/tenants/handlers/members.ts:145,:300` (`emitWebhookEvent(...)`)                                                                               | `k.events.publish(tx, orgsEvents.memberAdded/memberRemoved, ...)` inside the membership transaction; the events are defined in `main/modules/orgs/contract/events.ts` (shell)                                                             |

Inbound billing webhooks (`main/server/core/src/billing/webhooks/**`) are **not** part of this module. They become billing contract endpoints in Phase 15.

---

## 19. Risks and mitigations

| #   | Risk                                                                                                           | Mitigation                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Coexistence becomes permanent, with two patterns side by side                                                  | `legacy-shim`/`frozen-paths`/tombstone ratchets are shrink-only and visible on every PR. Phase 20 deletes the `legacy` parameter itself. Each phase exits on "old path deleted".                                                                                               |
| R2  | A gate silently stops gating during moves (TOOL-02 class)                                                      | Guard conversion is PR 1 of Phase 1. The registry plus `--self-test` comes in Phase 2, before any file move.                                                                                                                                                                   |
| R3  | The baseline reset drops a trigger, default, grant or function                                                 | The pg_catalog-level diff oracle must equal the reviewed list. The full real-DB and e2e suites run on the reset before the numbered files are deleted. Editable baselines allow in-place fixes until v1.                                                                       |
| R4  | Conflicts with the concurrent `fix/security-defects` workflow                                                  | Phase 0 lands first. Rule C9 fences its files. The Phase 6 baseline is cut only from the merged result.                                                                                                                                                                        |
| R5  | The kernel is over-generalized (RC7 inside the kernel)                                                         | Rule K1. Manifest fields and slots arrive with their first consumer. Unused-exports ratchet over the kernel.                                                                                                                                                                   |
| R6  | Auth or session regressions when identity moves                                                                | Identity moves last. Characterization first. A mechanical move PR is followed by behavioural PRs. Assertions stay unchanged. WebAuthn replacement only after identity is native.                                                                                               |
| R7  | The tenant→org rename or table prefixes break RLS or billing scope                                             | The rename is its own PR, with catalog diff, structural plus isolation RLS tests and billing suites as the oracle. D6 is decided first.                                                                                                                                        |
| R8  | Owned fastify, pg, WebAuthn, RFC 6455 or SigV4 code introduces protocol or security bugs                       | Each replacement lands behind a seam that is already the sole path. Dual-run CI matrices, RFC, Autobahn and FIDO vectors are required. No deadline coupling. The old package stays on the allowlist (with a `removeBy` moved by an owner-visible PR) until conformance passes. |
| R9  | The outbox adds latency or duplication to realtime and notifications                                           | NOTIFY wake with poll fallback, idempotency keys enforced by a unique index, `runSubscriberTwice`, an outbox-lag metric with an alert. CRUD invalidation stays cheap.                                                                                                          |
| R10 | The SSR process leaks per-request state or private data                                                        | Per-request SDK and QueryCache, `AnonymousSdk` limited to `cache.public` endpoints, no cookies forwarded, a never-SSR-logged-in test.                                                                                                                                          |
| R11 | Alias collapse breaks resolution in vite, vitest or eslint                                                     | One package per PR, with a full web build, prerender and vitest. Turbo cache bypassed for the series.                                                                                                                                                                          |
| R12 | Tests that deep-import code (~54 integration files) fail noisily on moves                                      | Tests move with code in the same PR. HTTP-level tests are the oracle and are never rewritten in a move PR.                                                                                                                                                                     |
| R13 | Creator-specific assumptions leak into the foundation                                                          | The §5.3 boundary table is a review checklist. A mechanism lands only with a generic foundation consumer. Taxonomy, ledger and vendors are fork-only.                                                                                                                          |
| R14 | Generated-file merge conflicts                                                                                 | Deterministic sorted output, one file per concern, and the documented resolution "take either side, run `bslt sync`". Provenance comments keep diffs readable.                                                                                                                 |
| R15 | argon2 availability depends on the Node 24 minor (`ownership-rescore.md` says 24.21, which is unverified here) | Verify in the Phase 12 PR and pin `.node-version`. Until then the package stays on the allowlist with an explicit `removeBy` change. The algorithm is never switched silently.                                                                                                 |
| R16 | Effort: Phases 14, 15, 16 and 19 are XL for a solo owner with agents                                           | Every phase is independently green and shippable, so the sequence can pause anywhere. Phases 12, 17 and 18 run in parallel lanes.                                                                                                                                              |
| R17 | Visual churn masks functional regressions                                                                      | The web-routes snapshot plus per-story screenshots. Shells change layout, not routes.                                                                                                                                                                                          |
| R18 | Turning on FORCE RLS breaks workers, retention, admin search or backfills                                      | `bslt_worker` with explicit system policies, per-table classification, and allowance tests next to the denial tests.                                                                                                                                                           |

---

## 20. Remaining owner decisions

| #   | Question                                                                                                                                        | Options                                                                                                                                  | Recommendation                                                                                                                                       | Why                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Does a generic double-entry ledger go in the foundation, or stay in the fork?                                                                   | (a) fork only; (b) generic optional `ledger` module in bslt-main after Phase 16                                                          | (a)                                                                                                                                                  | Binding decision lists ledger as fork. The foundation already ships Money/Asset, entitlements, payment_inbox and the ingress ports. Reclassify only if a second non-creator platform needs a ledger. |
| D2  | Which legacy leaves stay (D22): support inbox, status page, search, activity feed, media studio UI?                                             | keep each as a module, or delete in its wave                                                                                             | Keep support, status (first SSR consumer) and search (FTS is foundation-now). Activity feed becomes an audit projection. Delete the media studio UI. | Small, and each proves a distinct pattern. Deleting is cheap later.                                                                                                                                  |
| D3  | REST path normalization (for example `POST /api/tasks/:id/update` → `PATCH /api/tasks/:id`)?                                                    | never; post-v1 per module; during migration                                                                                              | Post-v1 per module, as an intended api-surface diff, or never                                                                                        | Changing URLs during moves destroys the cheapest oracle. There are no external consumers.                                                                                                            |
| D4  | Rename surviving packages (`@bslt/server-system`, `@bslt/client-engine`) to match kernel paths?                                                 | keep; rename in Phase 7                                                                                                                  | Keep                                                                                                                                                 | No import churn. Names never collide.                                                                                                                                                                |
| D5  | Path headers on every file                                                                                                                      | keep (auto-synced); drop                                                                                                                 | Keep                                                                                                                                                 | `bslt sync headers` runs inside every codemod, so the cost is nil (D20).                                                                                                                             |
| D6  | Billing and entitlement ownership (DB-03)                                                                                                       | org-owned with a personal org always provisioned; user-owned                                                                             | Org-owned plus a personal org on every registration path                                                                                             | Creator = org in the fork. Memberships and role bits are reused. One owner column.                                                                                                                   |
| D7  | Public SSR runtime                                                                                                                              | separate `PROCESS_ROLE=web` Node process behind Caddy (retire `web-deploy-cloudflare`); render inside the API process; Cloudflare Worker | Separate `web` role                                                                                                                                  | Keeps no cross-app imports and keeps Fastify out of rendering. Static assets can still sit behind the CDN.                                                                                           |
| D8  | When to tag `foundation-v1` (migrations become append-only)                                                                                     | end of Phase 20; at fork cut, whichever comes first                                                                                      | End of Phase 20, immediately before the fork                                                                                                         | Editable baselines are free until the first data must survive.                                                                                                                                       |
| D9  | User DTO drops `avatarUrl`; the avatar is read from files (§5.2)                                                                                | accept; keep identity→files coupling via a kernel enrichment slot                                                                        | Accept                                                                                                                                               | Avoids an identity↔files cycle and removes the T-AUTH-I11 class. No external consumers.                                                                                                              |
| D10 | Is `bslt-distribution` frozen without CI?                                                                                                       | frozen and archived; minimal CI kept buildable                                                                                           | Frozen and archived                                                                                                                                  | The owner chose extract-and-freeze. CI would be maintenance for a dead line.                                                                                                                         |
| D11 | WebAuthn attestation scope for the owned verifier                                                                                               | `none` only; `none` + `packed`                                                                                                           | `none` only                                                                                                                                          | Passkey login does not need attestation. This keeps the owned CBOR/COSE surface small.                                                                                                               |
| D12 | Kanu handoff: who receives server-rust (and its `bslt_rust` schema and CI lane), and when?                                                      | Kanu repo owner; separate bslt-rust repo                                                                                                 | Kanu repo, coordinated before Phase 1 PR 3                                                                                                           | The extraction PR needs the receiving repo ready.                                                                                                                                                    |
| D13 | Backups after `database-backup.yml` is retired                                                                                                  | managed Postgres PITR + snapshots; in-VPC cron container with encrypted off-site copy                                                    | Managed PG PITR plus a weekly in-VPC encrypted logical dump to a second provider                                                                     | Satisfies "one CI + one deploy" and the stack review's in-network backup requirement.                                                                                                                |
| D14 | The distribution channel after `foundation-v1` (§15.3): which modules are free, where paid module packages are hosted, how a licence is checked | a private package registry, or signed archives behind a store; a licence check at install, at build, or none                             | Decide after Phase 16, when every feature is a module                                                                                                |

---

## 21. Appendix A: deletion ledger (by phase)

- **P0:** realtime record write/getRecords proxy; unsigned local `getSignedUrl` and public `/uploads`; duplicate anonymizers.
- **P1:** `main/editions`, `main/extensions`, `main/apps/storefront`, `infra/storefront`, `main/tools/{features,setup}`, `main/tools/scripts/{editions,recipes,profiles}`, prune and smoke starter scripts (239 anchors, 17 templates, 27 core text edits), `main/apps/server-rust`, `features/rust-access`, rust e2e, 7 workflows, `.woodpecker/`, `infra/ci/woodpecker`, and the docs listed in §15.1.
- **P2:** 33 argv guards, `ci:*` chains, 127 `--filter` flags, about 110 root scripts.
- **P3:** about 410 tsconfig `paths` entries, `vite-tsconfig-paths`, `shared-vitest-aliases.ts`, relative tools imports.
- **P4:** 10 workflows folded into `ci.yml` and `deploy.yml`; Node 22/20 Dockerfile bases; the database in prod compose.
- **P5:** `createTestServer` composition root, 26 `describeRealDb` copies, 30 `createMockLogger` copies (progressively).
- **P6:** 37 numbered migrations, `db:push`, extra migration entry points, `jobs`, `tenant_settings`, `billing_tenant_backfill_audit`, phantom column, `notification_type` name, hand row types and `*_COLUMNS` (3.4k LOC), `REQUIRED_TABLES`, `tenancy.ts`.
- **P8:** tasks legacy slices (§18.3), `api-client-sync`/`api-response-sync` audits, generated client stub `main/client/api/src/generated/`, `main/tools/scripts/api/{generate-client,generate-hooks,check-client-freshness}.ts`.
- **P9:** `starterSurface.ts`, adminSurface tier/starter fields, the ~10 hand web registries.
- **P10:** `emitWebhookEvent`, `WEBHOOK_EVENT_TYPES`, `WriteService` and `write-types`, `CustomJobQueue`, media orchestrator, duplicate media http, 13 `setInterval` tasks.
- **P11:** `main/profiles`, profile generated files, `optional-import.ts`, `isServerCapabilityEnabled`, 9 `VITE_ENABLE_*` flags, `app/capabilities.ts`, `core/feature-flags`, `profile-boundaries`.
- **P12:** pino, pino-pretty, `@fastify/compress`, otpauth, argon2, `@sentry/*`, `@fastify/swagger(-ui)`, `@simplewebauthn/browser`.
- **P13-16:** all of `main/server/core/src/*`, `main/shared/src/{contracts,modules,constants}` domain parts, `main/client/api/src/*`, `main/client/react` domain hooks, `main/apps/web/src/features/*`, `main/server/media`, `@bslt/workers`, `core/permissions` (648 LOC), permission middleware (510 LOC), about 1.4k LOC of unregistered middleware, `can()`, `realtime/permissions` (913 LOC), the JWT subprotocol, `ACTIVITY_TYPES`, the `AuditAction` union, 49 swallowed catches, `edition-ports.ts`, `BillingNotifier`, `registerBillingWebhookRoutes`, ws, web-push, ioredis, `@aws-sdk/*`, sharp, stripe, `@stripe/*`, `app/authToken.ts` localStorage fallback, `queryPersistencePolicy` denylist.
- **P17:** IDE shell (`app/layouts/*`, `AppShell.css`, `useAppShellPanes`), duplicate overlays and toasts, 13 inline SVGs, 8 locale maps, DS domain components.
- **P18:** `src/ssr/{prerender.ts,ServerApp.tsx,SsrContext.tsx}`, `entry-server.tsx`, `web-deploy-cloudflare` job (per D7).
- **P19:** fastify, fastify-plugin, `@simplewebauthn/server`, postgres, and their adapters.
- **P20:** `@bslt/shared`, `@bslt/core`, `@bslt/api`, legacy seams, legacy migrations and generated rows, coexistence gates, `database-backup.yml`, `docs/CLAUDE.md`, stale architecture docs, `FEATURE.md` files, `docs/api/*.md`.

## 21. Appendix B: spot-check log (read-only, against `ff07d363`)

| Claim                                                                        | Check                                      | Result                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tasks spans 26 files in 6 packages                                           | `git ls-tree -r ff07d363 \| grep -i tasks` | 26 source files + `docs/api/tasks.md`                                                                                                                                                                                                                                                                                                                                                              |
| tasks registration lines                                                     | `git grep -n tasks` in the registries      | `route-modules.ts:23,38`; `contracts/index.ts:35`; `router.ts:24,47`; `client/api/src/index.ts:191-193`; `factory.ts:95,156-157,251-252`; `repositories/index.ts:86-87`; `schema/index.ts:185-192`; `db/src/index.ts:113`; `validation.ts:74-75`; `routes.tsx:170,177-178`; `AppLeftMenu.tsx:39-41,75`; `starterSurface.ts:11`. Command palette: no tasks entry (confirms "missing from palette"). |
| tasks contract paths                                                         | `contract.tasks.ts`                        | `GET /api/tasks`, `POST /api/tasks/create`, `POST /api/tasks/:id/update`, `POST /api/tasks/:id/delete`                                                                                                                                                                                                                                                                                             |
| tasks SQL                                                                    | `0800_tasks.sql`, `0904_tasks_rls.sql`     | `owner_id` FK `users` CASCADE; policy `TO authenticated` with raw `::uuid` cast (to be replaced by `sys_apply_rls`)                                                                                                                                                                                                                                                                                |
| `registerRouteMap` seam exists                                               | `git grep`                                 | `main/server/system/src/http/routing.ts:398` (framework-agnostic RouteMap → Fastify)                                                                                                                                                                                                                                                                                                               |
| Core extension contract seed                                                 | `git grep InstalledServerFeature`          | Only in `main/editions/core/.../extensions/types.ts.template` and `main/tools/features/manifest.ts` (both extracted)                                                                                                                                                                                                                                                                               |
| 37 migrations; job_queue 0405, cron 0907, idempotency 0915, dead `jobs` 0400 | `ls migrations`                            | Confirmed                                                                                                                                                                                                                                                                                                                                                                                          |
| 19 workflows, incl. `security-scanning.yml`, `database-backup.yml`           | `ls .github/workflows`                     | Confirmed. End state folds security into `ci.yml` and moves backups to infra.                                                                                                                                                                                                                                                                                                                      |
| Engines `>=18.19 <25`, no `.node-version`                                    | `package.json`                             | Confirmed, so the Node 24 pin is new work                                                                                                                                                                                                                                                                                                                                                          |
| Package names                                                                | each `package.json`                        | `@bslt/server`, `@bslt/web`, `@bslt/storefront`, `@bslt/api`, `@bslt/client-engine`, `@bslt/react`, `@bslt/ui`, `@bslt/comms`, `@bslt/core`, `@bslt/db`, `@bslt/media`, `@bslt/realtime`, `@bslt/storage`, `@bslt/server-system`, `@bslt/workers`, `@bslt/shared`                                                                                                                                  |
| Webhook emit sites                                                           | `git grep emitWebhookEvent(`               | Only `tenants/handlers/members.ts:145,300` (2 of 13 types)                                                                                                                                                                                                                                                                                                                                         |
| SSR files to replace                                                         | `ls main/apps/web/src/ssr`                 | `ServerApp.tsx`, `SsrContext.tsx`, `prerender.ts` (+ test); `entry-server.tsx`                                                                                                                                                                                                                                                                                                                     |
| Profiles used by boot                                                        | `ls bootstrap`                             | `bootstrap/generated/profile.generated.ts`, `optional-import.ts`, so profiles are deleted in place in Phase 11, not extracted                                                                                                                                                                                                                                                                      |
| Security workflow scope (fence C9)                                           | `git status` on `fix/security-defects`     | 15 working-tree changes under `main/server/realtime/src/**`, `shared/.../pubsub/authorize*`, two integration tests. No commits beyond `ff07d363` yet.                                                                                                                                                                                                                                              |
| Node `crypto.argon2` availability                                            | not verified                               | Risk R15                                                                                                                                                                                                                                                                                                                                                                                           |
