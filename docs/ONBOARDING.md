# Developer Onboarding

Get productive in 30 minutes on `bslt-main` (`foundation-v1`). Action-oriented; deep dives live in the docs linked at the bottom.

---

## What is BSLT?

A clone-and-own TypeScript SaaS & platform foundation with production-safe defaults. Web (Vite + React 19) and API (`node:http` + PostgreSQL 17) live in one Turborepo monorepo with 12 kernel packages (`main/kernel/*`) and self-contained vertical modules (`main/modules/*`), forced Row-Level Security, checked `@bslt/schema` contracts, contract-inferred HTTP SDKs and React hooks, and zero third-party runtime npm packages outside `react` and `react-dom`.

See [DIRECTION.md](./DIRECTION.md) for the live module inventory and capability ledger.

---

## Prerequisites

| Tool    | Version    | Check                                  |
| ------- | ---------- | -------------------------------------- |
| Node.js | 24 (`<25`) | `node --version` (see `.node-version`) |
| pnpm    | 10.26.2    | `pnpm --version`                       |
| Docker  | recent     | `docker --version`                     |
| Git     | any        | `git --version`                        |

PostgreSQL 17 runs via Docker — no local Postgres installation required.

---

## 5-Minute Quick Start

```bash
# Option A: Scaffold a brand-new personalized project directory (create-bslt)
pnpm bslt create ../my-saas --name "Acme Cloud" --domain acme.com --scope @acme --preset ai-saas --yes
cd ../my-saas && pnpm install && pnpm dev

# Option B: Initialize this checkout in place
pnpm install --frozen-lockfile
pnpm quickstart -- --preset b2b-saas --name "Acme Cloud" --domain acme.com --scope @acme --with-postgres --yes
pnpm dev
```

Available presets: `core` (identity + compliance + audit), `solo-saas` (billing + notifications + files), `b2b-saas` (multi-tenant orgs + projects + growth + enterprise SSO), and `ai-saas` (adds zero-dep `@bslt/ai` SSE streaming + token metering).

### Deploy in Under 5 Minutes

Ready-made production templates ship in `infra/deploy/` alongside DigitalOcean and GCP:

- **Fly.io:** `infra/deploy/fly/fly.toml` + `fly.web.toml` — see [`deploy/providers/fly.md`](./deploy/providers/fly.md)
- **Railway:** `infra/deploy/railway/railway.json` + `railway.web.json` — see [`deploy/providers/railway.md`](./deploy/providers/railway.md)
- **Render Blueprint:** `infra/deploy/render/render.yaml` — see [`deploy/providers/render.md`](./deploy/providers/render.md)
- **DigitalOcean Droplet / GCP / Cloudflare:** see [`deploy/providers/README.md`](./deploy/providers/README.md)

For manual step-by-step setup (`pnpm bslt rename` + `pnpm bootstrap`), see [`dev/rename.md`](./dev/rename.md) and [`config/env/README.md`](../config/env/README.md). To install, remove, package, or export optional vertical modules (`bslt-core` distribution):

```bash
pnpm bslt module list
pnpm bslt module add billing tasks --catalog /path/to/modules.catalog.json
pnpm bslt module remove billing
pnpm bslt module release --out .tmp/module-releases
pnpm bslt export core --out ../bslt-core --verify
```

| Service    | URL                   |
| ---------- | --------------------- |
| Web app    | http://localhost:5173 |
| API server | http://localhost:8080 |

The HTTP API, database tables, events/jobs/cron, web routes, and module DAG are documented in [`reference/`](./reference/api.md) (`pnpm bslt sync docs`) and [`reference/openapi.json`](./reference/openapi.json) (`pnpm bslt sync openapi`).

---

## Where is X? (Directory Map)

| You're looking for                            | It lives at                                                        |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Installed module list                         | `bslt.config.ts`                                                   |
| Permission bitmasks & migration checksums     | `bslt.lock.json`                                                   |
| Vertical domain modules (`tasks`, `identity`) | `main/modules/<id>/` (`module.ts`, `contract/`, `server/`, `web/`) |
| Auth, MFA, OAuth, passkeys, API keys          | `main/modules/identity/`                                           |
| Organizations, memberships, invitations       | `main/modules/orgs/`                                               |
| Billing (Stripe, PayPal, plans, invoices)     | `main/modules/billing/` & `main/modules/entitlements/`             |
| Files, multipart uploads, `ffmpeg` worker     | `main/modules/files/` & `main/kernel/storage/`                     |
| Compliance (ToS, consent, GDPR, geo, age)     | `main/modules/compliance/`                                         |
| Audit log, notifications, webhooks, analytics | `main/modules/{audit,notifications,webhooks,analytics}/`           |
| Schema & contract combinators                 | `main/kernel/schema/`, `main/kernel/contract/`                     |
| Owned wire protocols (`pg`, `s3`, `ws`, ...)  | `main/kernel/protocols/src/`                                       |
| SQL builder, RLS helpers, migration runner    | `main/kernel/db/src/`, `main/kernel/db/sql/0001_sys.sql`           |
| `node:http` router, module host, jobs, cron   | `main/kernel/server/src/`                                          |
| Browser HTTP SDK & query cache                | `main/kernel/client/src/`                                          |
| React hooks (`useEndpoint`, capabilities)     | `main/kernel/react/src/`                                           |
| Design-system components & CSS tokens         | `main/kernel/ui/src/`                                              |
| Web module host, shells & public prerender    | `main/kernel/web/src/`                                             |
| Server & web composition roots                | `main/apps/server/src/`, `main/apps/web/src/`                      |
| Testing harness (`buildTestApp`, real-DB)     | `main/testing/src/`, `tests/`                                      |
| CLI, merge gates & `bslt sync` generators     | `main/tools/`                                                      |
| Encrypted PostgreSQL backups & PITR           | `infra/runtime/backup/`                                            |
| GitHub Actions (`ci.yml`, `deploy.yml`)       | `.github/workflows/`                                               |

---

## First-Task Recipes

### Add your first product feature module

```bash
pnpm bslt module new notes
pnpm bslt gate merge --concurrency=2
```

This scaffolds a complete vertical slice under `main/modules/notes/` (`contract/`, `server/`, `web/`, `i18n/`, unit tests, and real-DB RLS isolation tests), registers `notesModule` in `bslt.config.ts`, and syncs generated files.

### Add a new API endpoint to an existing module

1. Add combinator **schemas** (`@bslt/schema`) in `main/modules/<id>/contract/schemas.ts`.
2. Declare any new **error codes** in `main/modules/<id>/contract/errors.ts`.
3. Add the **`endpoint(...)` definition** in `main/modules/<id>/contract/endpoints.ts`.
4. Write failing tests first, then implement the **handler** in `main/modules/<id>/server/` (`implementServer` enforces exhaustiveness).
5. Consume it on the web with `useEndpoint` or `useEndpointMutation` in `main/modules/<id>/web/hooks.ts`.
6. Refresh `pnpm bslt snapshot api`, `pnpm bslt sync openapi`, and `pnpm bslt sync docs`.

See [`specs/modules.md`](./specs/modules.md) and [`dev/module-creation.md`](./dev/module-creation.md).

### Run focused checks

```bash
# Type-check or unit-test one package
pnpm --filter @bslt/tasks type-check
pnpm --filter @bslt/tasks test

# Run a single gate
pnpm bslt gate run docs-links

# Run the full 49-gate merge lane
pnpm bslt gate merge --concurrency=2
```

---

## Conventions Cheat Sheet

Full specification in [`specs/principles.md`](./specs/principles.md):

- **Adversarial TDD:** Write the failing test first; maintain >= 60% failure-state assertions.
- **Strict TypeScript:** Zero `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `export *`, or `import * as` (except `vi.spyOn` in tests).
- **Owned runtime:** Never add npm runtime packages (`deps-allowlist` allows only `react` and `react-dom`).
- **Combinator schemas:** Always use `@bslt/schema` combinators (`object`, `string`, `optional`, etc.), never `createSchema(fn)`.
- **Forced RLS:** Every table uses `<module>_` naming and `SELECT sys_apply_rls(...)`; raw SQL lives only in `repository.ts`.
- **Tokenized UI:** Use `@bslt/ui` components and `--ui-*` CSS tokens; never write inline `style={{ ... }}` or raw English strings (`t('<id>.*')`).

---

## Where to Go Next

| Topic                                | Document                                     |
| ------------------------------------ | -------------------------------------------- |
| Live status & module inventory       | [DIRECTION.md](./DIRECTION.md)               |
| Coding standards & derivation ladder | [specs/principles.md](./specs/principles.md) |
| Vertical module architecture         | [specs/modules.md](./specs/modules.md)       |
| Database, RLS & PITR backup spec     | [specs/data.md](./specs/data.md)             |
| Runtime entrypoints & ownership      | [specs/specs.md](./specs/specs.md)           |
| Daily workflow & git hooks           | [dev/workflow.md](./dev/workflow.md)         |
| Testing & real-DB isolation          | [dev/testing.md](./dev/testing.md)           |
| Deployment & environment variables   | [deploy/README.md](./deploy/README.md)       |
