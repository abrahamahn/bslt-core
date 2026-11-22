# BSLT Repository Instructions (`bslt-main`)

`bslt-main` is a reusable, self-owned TypeScript platform foundation (`foundation-v1`; see [`docs/DIRECTION.md`](./docs/DIRECTION.md) and [`docs/architecture/restructure/README.md`](./docs/architecture/restructure/README.md)).

---

## 1. Canonical Reading & Architecture

| Topic                                       | Canonical Document                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Platform status & capability inventory**  | [`docs/DIRECTION.md`](./docs/DIRECTION.md)                                             |
| **Coding standards & anti-patterns**        | [`docs/specs/principles.md`](./docs/specs/principles.md)                               |
| **Vertical module spec & recipe**           | [`docs/specs/modules.md`](./docs/specs/modules.md)                                     |
| **Database, RLS, migrations & backups**     | [`docs/specs/data.md`](./docs/specs/data.md)                                           |
| **Error model**                             | [`docs/specs/errors.md`](./docs/specs/errors.md)                                       |
| **Testing & real-DB isolation**             | [`docs/dev/testing.md`](./docs/dev/testing.md)                                         |
| **Demo deployment (`utility/auto-deploy`)** | [`docs/deploy/demo-manual-deploy.md`](./docs/deploy/demo-manual-deploy.md)             |
| **21-phase restructure record**             | [`docs/architecture/restructure/README.md`](./docs/architecture/restructure/README.md) |

### Topology

- `main/kernel/*` — Platform kernel (`@bslt/schema`, `@bslt/contract`, `@bslt/protocols`, `@bslt/db`, `@bslt/server-system`, `@bslt/realtime`, `@bslt/storage`, `@bslt/comms`, `@bslt/client-engine`, `@bslt/react`, `@bslt/ui`, `@bslt/web-platform`).
- `main/modules/*` — Self-contained vertical modules registered in [`bslt.config.ts`](./bslt.config.ts) (`module.ts`, `contract/`, `server/`, `web/`, `i18n/`).
- `main/apps/{server,web}` — Thin composition roots (`PROCESS_ROLE` server runtime and SPA + public-only prerender web app).
- `main/testing` (`@bslt/testing`) — `buildTestApp`, `describeRealDb`, `describeOwnerIsolation`, `runSubscriberTwice`, and kernel port fakes.
- `main/tools` (`@bslt/tools`, `bslt` CLI) — Gate registry, `bslt sync` generators, surface snapshots, catalog audit, and deploy/backup tooling.

---

## 2. Branch, Workstation & Cloud Agent Rules

1. **Workstation sessions (`main` only):**
   - `main` is the single persistent branch locally and on GitHub. Fetch `origin/main` before editing, commit cleanly on `main`, and push directly to `origin/main` (do not create or leave feature/`claude/**` branches from workstation sessions).
   - Accepted `main` commits deploy to `https://app.bslt.dev` via the workstation runner (`utility/auto-deploy`). Never overwrite `/opt/bslt/demo/Caddyfile` or recreate `bslt-demo-caddy-1`.
2. **Cloud coding sandboxes (Claude Code on the Web, Codex Cloud):**
   - Cloud git proxies isolate sessions to their assigned session branch (e.g. `claude/<session>`) and reject direct pushes to `main` (HTTP 403), and cloud containers lack workstation SSH keys.
   - In a cloud environment: run `pnpm install --frozen-lockfile` if not already run by `.claude/hooks/session-start.sh`, keep `TURBO_CONCURRENCY=2` and `NODE_OPTIONS="--max-old-space-size=4096"`, verify with `pnpm bslt gate merge --concurrency=2`, push to your assigned cloud session branch, and open a pull request into `main` without merging. A workstation session lands it onto `main` and deletes the temporary branch.
   - In shallow or single-branch cloud clones without `origin/main`, `pnpm pre-push` automatically falls back from `--changed` to the full `--concurrency=2` merge lane.

---

## 3. Non-Negotiable Engineering Rules

- **Read before writing.** Always read target files and existing module patterns before editing.
- **Adversarial TDD.** Write the failing test first, verify it fails, then implement. Maintain >= 60% failure-state assertions.
- **Zero escape hatches.** No `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `export *`, or `import * as` (except `vi.spyOn` in tests). Named imports only.
- **Dependency ownership.** Own every runtime dependency except `react` and `react-dom` (`deps-allowlist` gate). Never add npm runtime packages.
- **Owned `@bslt/schema` combinators.** Module contracts use `@bslt/schema` combinators (`object`, `string`, `optional`, etc.), never opaque `createSchema(fn)` wrappers (`opaque-schema` = `0`).
- **Zero dead exports.** Every exported symbol must have a caller (`unused-exports` = `0`).
- **Database, migrations & RLS safety.**
  - One flat `public` schema with `<module>_` table prefixes and forced RLS (`SELECT sys_apply_rls(...)`).
  - Shipped migration SHA-256 checksums are locked in `bslt.lock.json` (`pnpm bslt sync permissions`); never edit an already-shipped SQL migration in place.
  - Never overwrite local `config/env/.env.*` files or development Postgres volumes; run `test:real-db` and `test:e2e` against an isolated scratch PostgreSQL 17 instance (`postgres:17.11-alpine -c max_connections=200`) with explicit `DATABASE_URL`.
- **Never run `git checkout` or `git reset`** to discard work unless explicitly asked. Never log secrets or PII.

---

## 4. Verification Commands

Always cap Turbo concurrency (`--concurrency=2` or `TURBO_CONCURRENCY=2`) and V8 heap (`NODE_OPTIONS="--max-old-space-size=4096"`) to prevent container/workstation OOMs:

```bash
pnpm --filter @bslt/<pkg> type-check          # Type-check one package
pnpm --filter @bslt/<pkg> test                # Unit-test one package
pnpm bslt sync modules && pnpm bslt sync rows # Regenerate module & DB row bindings
pnpm bslt sync openapi && pnpm bslt sync docs # Regenerate OpenAPI + docs/reference/*.md
pnpm bslt gate merge --concurrency=2          # Full 50-gate static + unit merge lane
```
