# BSLT Engineering Principles

**Canonical specification** for coding standards, module placement, derivation rules, anti-patterns, and testing methodology. Where any other document conflicts with this file, **this file wins.**

---

## Core Philosophy

BSLT is a **self-owned, zero-bloat TypeScript platform foundation** (`foundation-v1`):

- **Correctness over convenience.** Explicit error paths, strict runtime validation, zero silent fallbacks.
- **Clarity over cleverness.** Boring, auditable code beats meta-programming.
- **Vertical modularity.** Every domain capability lives in one self-contained module directory (`main/modules/<id>/`); kernel packages own generic transport, protocol, database, and UI primitives.
- **Layer separation.** React renders only. Domain business logic lives in `main/modules/<id>/server/`; data access lives in `repository.ts`.
- **Total runtime ownership.** `deps-allowlist.json` permits only `["react", "react-dom"]` in runtime dependencies across the entire workspace. HTTP routing, PostgreSQL wire v3.0, S3 SigV4, RESP, WebSocket, WebPush, TOTP, CBOR/COSE/WebAuthn, Multipart, and OTLP/HTTP are owned in-repo packages.
- **Strict TypeScript.** Zero `any`, zero `@ts-ignore` / `@ts-expect-error`, zero `eslint-disable`, zero barrel `export *`.
- **Adversarial TDD.** Red -> Green -> Refactor, with >= 60% failure-state assertions.

---

## Core Stack

Turbo · pnpm · Vite · React 19 · owned `node:http` server (`@bslt/server-system/http`) · PostgreSQL 17 (`@bslt/protocols/pg` + `@bslt/db`) · `@bslt/schema` & `@bslt/contract`

---

## Code Placement

Every file belongs in exactly one layer:

| Location                | Package                | Responsibility                                                                                                               |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `main/kernel/schema`    | `@bslt/schema`         | Pure combinator validation (`object`, `string`, `number`, `optional`, `union`, `refine`, `brand`), JSON Schema / OpenAPI AST |
| `main/kernel/contract`  | `@bslt/contract`       | `defineModule`, `endpoint`, `defineErrors`, `event`, `job`, capability & permission lockfile helpers                         |
| `main/kernel/protocols` | `@bslt/protocols`      | Zero-dep wire protocols (`pg`, `s3`, `resp`, `ws`, `webpush`, `totp`, `cbor`, `cose`, `multipart`, `otlp`)                   |
| `main/kernel/db`        | `@bslt/db`             | Composable SQL builder, transaction/RLS session runner, role bootstrap, append-only migration runner, `sys_*` tables         |
| `main/kernel/server`    | `@bslt/server-system`  | Owned `node:http` router, module host (`implementServer`), outbox/job/cron runtimes, security headers/CSRF, OTLP & metrics   |
| `main/kernel/comms`     | `@bslt/comms`          | Email (SMTP / HTTP providers), SMS, and Web Push delivery ports & adapters                                                   |
| `main/kernel/storage`   | `@bslt/storage`        | Local and S3-compatible object storage drivers, presigned URLs, multipart upload sessions                                    |
| `main/kernel/realtime`  | `@bslt/realtime`       | Owned RFC 6455 WebSocket pub/sub hub, channel authorization, Valkey/RESP horizontal fan-out                                  |
| `main/kernel/client`    | `@bslt/client-engine`  | Contract-inferred HTTP `fetch` transport (`createEndpointClient`), query cache, resumable uploader, token refresh            |
| `main/kernel/react`     | `@bslt/react`          | Headless React bindings (`useEndpoint`, `useEndpointMutation`, `CapabilityProvider`, auth/form/i18n hooks)                   |
| `main/kernel/ui`        | `@bslt/ui`             | Owned accessible design system, CSS custom-property tokens, generated SVG icons, component story index                       |
| `main/kernel/web`       | `@bslt/web-platform`   | Declarative web module host (`implementWeb`, `createWebApp`), shells, router, public-only `AnonymousSdk` prerender seam      |
| `main/modules/<id>/`    | `@bslt/<id>`           | Vertical domain module (`module.ts`, `contract/`, `server/`, `web/`, `i18n/en-US.json`); see [`modules.md`](./modules.md)    |
| `main/apps/server`      | `@bslt/server`         | Thin server composition root (`buildApp`, `PROCESS_ROLE` entrypoint)                                                         |
| `main/apps/web`         | `@bslt/web`            | Thin SPA + build-time public prerender composition root                                                                      |
| `main/testing`          | `@bslt/testing`        | `buildTestApp`, `describeRealDb`, `describeOwnerIsolation`, `runSubscriberTwice`, kernel port fakes                          |
| `main/tools`            | `@bslt/tools` (`bslt`) | Gate registry, `bslt sync` generators, surface snapshots, catalog audit, deploy/backup scripts                               |
| `infra/runtime/backup`  | —                      | In-network AES-256-GCM encrypted PostgreSQL backups, PITR WAL hooks, and automated restore drills                            |

---

## Generation: The Derivation Ladder

Before generating code, climb from Rung 1 upward and stop at the lowest rung that works:

1. **Rung 1 — Type inference.** Handler and job exhaustiveness (`implementServer`), contract-inferred client SDKs, query keys, `Infer<typeof schema>` DTOs, install-list `satisfies` checks, i18n keys, and permission/requirement unions.
2. **Rung 2 — Runtime `flatMap` over installed modules.** HTTP routes, web routes, navigation slots, command palette actions, settings tabs, admin pages, dashboard cards, outbox subscribers, cron schedules, channel authorizers, and `GET /api/platform/context`.
3. **Rung 3 — Committed generated file.** Permitted **only** when crossing a bundler, language, or external-tool boundary:

| Command                      | Output                                                                                                                                          | Boundary Justified                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `pnpm bslt sync modules`     | `main/apps/{server,web}/src/generated/modules.ts`, app `package.json` deps, `main/tools/generated/module-graph.json`, module `README.md` blocks | Static bundler imports; pnpm & ESLint configs |
| `pnpm bslt db catalog`       | `main/kernel/db/catalog.snapshot.json`                                                                                                          | SQL -> JSON catalog boundary                  |
| `pnpm bslt sync rows`        | `main/kernel/db/src/generated/*`, `main/modules/<id>/server/generated/{rows.ts,rls.real-db.test.ts}`                                            | SQL -> TypeScript row types & RLS proofs      |
| `pnpm bslt sync permissions` | `bslt.lock.json` (`orgPermissions` bit positions + `migrations` SHA-256 checksums)                                                              | Persisted bitmask & immutable SQL stability   |
| `pnpm bslt sync docs`        | `docs/reference/{api,database,events-jobs-cron,web-routes,module-dag}.md`, `docs/DIRECTION.md` status block                                     | Human-readable reference documentation        |
| `pnpm bslt sync openapi`     | `docs/reference/openapi.json`                                                                                                                   | OpenAPI 3.1 for external / non-TS consumers   |
| `pnpm bslt sync csp`         | `infra/runtime/caddy/security-headers.generated.caddy`, server CSP/Permissions-Policy constants                                                 | Caddy reverse-proxy config                    |
| `pnpm bslt sync icons`       | `main/kernel/ui/src/icons.generated.ts`                                                                                                         | Raw `.svg` assets -> typed React icon map     |
| `pnpm bslt sync stories`     | `main/modules/devtools/web/generated/story-index.generated.ts`                                                                                  | `@bslt/ui` exports -> `/ui-library` catalog   |
| `pnpm bslt sync ts`          | Root `tsconfig.json` project references                                                                                                         | `tsc --build` graph                           |
| `pnpm bslt sync headers`     | `// path/to/file.ts` first-line path comments                                                                                                   | Source provenance                             |
| `pnpm bslt sync theme`       | `main/kernel/ui/src/styles/theme.css`                                                                                                           | TypeScript design tokens -> CSS variables     |

**Anti-magic rules:**

- Generated files are committed, sorted, and deterministic; generators emit declarations, imports, and single-call delegations — never business logic.
- Generators never overwrite hand-written prose outside explicit `<!-- bslt:generated ... -->` markers or owned JSON keys.
- Every `generated-*` gate re-runs its generator in memory and fails on drift **or** orphan files in `generated/` and `docs/reference/`.

---

## Kernel & Module Boundary Rules

1. **Kernel never imports modules.** Packages under `main/kernel/*` may never import `@bslt/<module>`.
2. **Acyclic module DAG.** Modules declare upstream dependencies in `module.ts` (`dependsOn`). Cross-module imports may target `@bslt/<dep>/contract` and `@bslt/<dep>/module` only when declared in `dependsOn` (`module-graph` gate).
3. **Projection isolation.** Projection modules (`audit`, `notifications`, `webhooks`, `analytics`) subscribe to outbox events and may never appear in another module's `dependsOn`.
4. **Owned `@bslt/schema` combinators only.** Every schema uses composable `@bslt/schema` combinators (`object`, `string`, `number`, `boolean`, `array`, `optional`, `nullable`, `enums`, `union`, `record`, `refine`, `brand`) so OpenAPI and reference docs introspect full structure (`opaque-schema` budget = `0`).
5. **Single transport & single queue.** Browser calls go exclusively through `@bslt/client-engine` (`api-client-surfaces` gate). Background work goes exclusively through `sys_jobs` + `sys_outbox`.
6. **Zero dead exports.** Every exported symbol across kernel, modules, and apps must have a live caller (`unused-exports` budget = `0`).

---

## Strict Coding Rules

### Complexity Thresholds

| Metric                | Limit  | Action when exceeded                         |
| --------------------- | ------ | -------------------------------------------- |
| Cyclomatic complexity | <= 12  | Extract focused pure helpers                 |
| Cognitive complexity  | <= 15  | Flatten via early returns / guard clauses    |
| Function length       | <= 50  | Split validation, orchestration, persistence |
| File length           | <= 400 | Split along cohesive sub-responsibilities    |
| Parameter count       | <= 4   | Accept a typed options object                |

### Forbidden Constructs

- **TypeScript:** `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, unsafe double casts (`as unknown as T` outside low-level wire decoders with unit proof), `!` non-null assertions without prior guard.
- **Imports / Exports:** `export *` (`no-barrel-wildcards`), `import * as` (except `vi.spyOn` targets in tests), default exports (except lazy route pages required by code splitting), relative imports crossing package boundaries, deep subpath imports bypassing `package.json#exports`.
- **Async & timers:** Unawaited promises, swallowed `catch {}` blocks (`swallowed-catch` = `0`), raw `setInterval` outside kernel runtimes (`setinterval` ratchet).
- **SQL & Security:** Raw SQL outside `repository.ts` (`raw-sql-outside-repos` = `0`), string-concatenated SQL, logging secrets/tokens/passwords/PII (`SENSITIVE_KEYS` redaction), `Math.random()` for tokens or IDs (use `node:crypto`).
- **UI & Styling:** Inline `style={{ ... }}` attributes (`inline-style` = `0`), hardcoded hex/px values bypassing design tokens (`css-tokens`, `undefined-tokens`), dead CSS selectors (`dead-classes`), raw English literals in module UIs (`i18n` gate).

---

## Error Model

Domain and transport errors follow [`errors.md`](./errors.md):

- Modules declare semantic error catalogs in `contract/errors.ts` via `defineErrors('<id>', { CODE: status })` and list possible codes on each `endpoint({ errors: ['<id>.CODE'] })`.
- Server handlers fail explicitly via `req.fail('CODE', optionalMessage, optionalDetails)`.
- Unexpected exceptions are normalized at the HTTP boundary into correlation-tagged `500` responses without leaking stack traces or SQL internals.

---

## Testing Methodology (Adversarial TDD)

See [`../dev/testing.md`](../dev/testing.md) for harness details:

1. **Write the failing test first (RED),** observe it fail for the expected reason, then write the minimal code to pass (GREEN).
2. **>= 60% failure-state assertions:** boundary values, malformed payloads, unauthorized/forbidden callers, cross-user/cross-org RLS denial, idempotency replay (`runSubscriberTwice`), and upstream adapter failures.
3. **Colocated unit pairs:** Every non-trivial source file has a colocated `.test.ts` / `.test.tsx` (`test-pairs` gate).
4. **Real PostgreSQL 17 verification:** Repository, migration, RLS (`describeOwnerIsolation`), and backup/restore suites run against real PostgreSQL 17 via `describeRealDb` as `bslt_app` / `bslt_worker` — never mocked SQL.
5. **Public-only SSR verification:** Public marketing/legal/status pages prerender via `AnonymousSdk`; authenticated shells never prerender (`ssr-public-only` gate).

---

## Verification Checklist (Definition of Done)

Cap concurrency (`--concurrency=2` or `TURBO_CONCURRENCY=2`) and V8 heap (`NODE_OPTIONS="--max-old-space-size=4096"`):

1. All derived artifacts and snapshots are clean:
   - `pnpm bslt sync modules`
   - `pnpm bslt sync rows`
   - `pnpm bslt sync permissions`
   - `pnpm bslt sync openapi`
   - `pnpm bslt sync csp`
   - `pnpm bslt sync icons`
   - `pnpm bslt sync stories`
   - `pnpm bslt sync docs`
   - `pnpm bslt sync ts` & `pnpm bslt sync headers`
   - `pnpm bslt snapshot api` & `pnpm bslt snapshot web-routes`
2. `pnpm build --concurrency=2` builds all workspace packages cleanly (`esm-dist` verified).
3. `pnpm bslt gate merge --concurrency=2` passes all **49** static, lint, boundary, ratchet, generated, type-check, and unit-test gates.
4. `REQUIRE_REAL_DB=1 pnpm test:real-db` and `pnpm test:postgres-smoke` pass against PostgreSQL 17 when database, migration, RLS, or backup code changes.
