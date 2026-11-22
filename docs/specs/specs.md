# BSLT Codebase Ownership & Runtime Entrypoints Spec

Operational map of runtime entrypoints, composition roots, and cross-cutting request flows (`foundation-v1`).

---

## 1. Monorepo Layer Split

- **Kernel (`main/kernel/*`):** Generic runtime, protocol, SQL, transport, React, UI, and web-host primitives (`@bslt/schema`, `@bslt/contract`, `@bslt/protocols`, `@bslt/db`, `@bslt/server-system`, `@bslt/comms`, `@bslt/storage`, `@bslt/realtime`, `@bslt/client-engine`, `@bslt/react`, `@bslt/ui`, `@bslt/web-platform`). Kernel packages never import vertical modules.
- **Vertical Modules (`main/modules/<id>/`):** Self-contained product & platform capabilities registered in [`bslt.config.ts`](../../bslt.config.ts). Each owns its `module.ts`, `contract/`, `server/`, `web/`, and `i18n/en-US.json` (see [`modules.md`](./modules.md)).
- **Composition Roots (`main/apps/{server,web}`):** Thin runtime wiring over generated install lists (`src/generated/modules.ts`). Domain logic never accumulates in `main/apps/*`.
- **Testing & Tooling (`main/testing`, `main/tools`):** Production-parity test harness (`@bslt/testing`) and CLI/gates/generators (`@bslt/tools`).

---

## 2. Canonical Runtime Entrypoints

### Server (`@bslt/server`)

- **Process entry:** `main/apps/server/src/main.ts`
- **Role orchestrator (`PROCESS_ROLE`):** `main/apps/server/src/bootstrap/runtime.ts` — boots `api`, `realtime`, `worker`, `media-worker`, or `all`.
- **Single composition function:** `main/apps/server/src/bootstrap/build-app.ts` (`buildApp()`) — used identically by production `main.ts`, `buildTestApp()` (`@bslt/testing`), OpenAPI generation, and surface snapshots.
- **HTTP & module host assembly:** `main/apps/server/src/bootstrap/app.ts` — mounts security headers/CSP, geo/IP guards, rate limiting, OTLP/metrics hooks, kernel health/context routes, and all installed `@bslt/<module>/server` implementations on `@bslt/server-system/http`.

### Web (`@bslt/web`)

- **SPA entry:** `main/apps/web/src/main.tsx` (authenticated `/app`, `/admin`, and interactive flows).
- **Public prerender client entry:** `main/apps/web/src/entry-public.tsx` (public marketing, legal, pricing, support, and status routes).
- **Shared client bootstrap & fail-safe splash:** `main/apps/web/src/bootstrap/client.tsx` and `main/apps/web/src/bootstrap/splash.ts`.
- **Public SSR server & static prerender entry:** `main/apps/web/src/server/serve.ts` — serves public routes over `AnonymousSdk` (`cache.public` endpoints only, enforced by `ssr-public-only`) plus `/sitemap.xml`.

---

## 3. End-to-End Request & Side-Effect Flows

### 3.1 HTTP Endpoint Execution

1. Browser calls `useEndpoint` / `useEndpointMutation` (`@bslt/react`) -> `createEndpointClient` (`@bslt/client-engine`).
2. `@bslt/server-system/http` matches the radix route, enforces body/timeout limits, and invokes the `@bslt/server-system/module-host` dispatcher.
3. The module host authenticates the caller (Bearer JWT, `bslt_` API key, or webhook verifier), checks endpoint `auth` / `permissions` / `entitlement` / `requirements`, validates `params`, `query`, and `body` with `@bslt/schema`, and opens a RLS-scoped transaction (`SET LOCAL ROLE authenticated` + `app.user_id` / `app.org_id`).
4. Module handler in `main/modules/<id>/server/` delegates to `service.ts` -> `repository.ts` and publishes any domain events into `sys_outbox` inside the same transaction.
5. Response is schema-validated (in dev/test) and serialized.

### 3.2 Compliance, Consent & Legal Surfaces (`@bslt/compliance`)

- **Legal documents:** Versioned Terms & Privacy documents are published and accepted through `@bslt/compliance` (`compliance_legal_documents`, `compliance_legal_acceptances`, `tos.accepted` requirement); static policy templates seed cleanly and render on public routes.
- **Jurisdiction & age gates:** `@bslt/compliance` owns `JurisdictionResolver` (`BLOCKED_REGIONS`, empty by default) and `AgeAssuranceProvider` (`age.verified:<n>` requirement + registration attestation).
- **Script consent:** `main/apps/web/src/lib/consent/` gates third-party script injection (`loadConsentedScript`), honors Global Privacy Control (GPC), and syncs signed-in consent choices to `@bslt/compliance`.
- **Privacy orchestration:** GDPR export and erasure/anonymization iterate over every module's `privacy` slot registered in `implementServer`.

### 3.3 Billing & Entitlements (`@bslt/billing` -> `@bslt/entitlements`)

1. Provider webhooks (`Stripe`, `PayPal`) authenticate through raw-body `verifiers` (`auth: { webhook }`) and record idempotently in `billing_payment_inbox` before state projection.
2. Subscription lifecycle transitions update `billing_subscriptions` (`owner_org` RLS, `RESTRICT` financial FKs), write capability grants via `@bslt/entitlements` (`entitlements_grants`), and publish `billing.*` outbox events consumed by `audit`, `notifications`, `webhooks`, and `analytics`.

For the live module dependency graph and route/table attributions, see [`../reference/module-dag.md`](../reference/module-dag.md), [`../reference/api.md`](../reference/api.md), and [`../reference/database.md`](../reference/database.md).
