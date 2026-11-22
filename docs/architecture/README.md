# Architecture

Architectural standards and historical restructure records for BSLT (`foundation-v1`).

Live structural maps are **generated directly from manifests and snapshots** via `pnpm bslt sync docs` so they never drift:

- [`../reference/module-dag.md`](../reference/module-dag.md) — installed & dev-only vertical modules, Mermaid DAG, and dependency table
- [`../reference/api.md`](../reference/api.md) — every HTTP endpoint attributed to `kernel` or its owning module
- [`../reference/database.md`](../reference/database.md) — every PostgreSQL table, owner, and RLS class
- [`../reference/events-jobs-cron.md`](../reference/events-jobs-cron.md) — outbox events, `sys_jobs` workers, and cron schedules
- [`../reference/web-routes.md`](../reference/web-routes.md) — web routes, shells, and auth/flag guards

| Document                                                 | Purpose                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`api-contract-standard.md`](./api-contract-standard.md) | Rules for declaring `@bslt/schema` + `@bslt/contract` endpoints, error catalogs, and response envelopes. |
| [`responsive.md`](./responsive.md)                       | Breakpoints, fluid container/grid rules, and mobile-first responsive contract enforced by `responsive`.  |
| [`restructure/README.md`](./restructure/README.md)       | Complete 21-phase (`Phase 0` – `Phase 20`) modular restructure plan, owner decisions, and phase log.     |

For canonical module, data, and runtime entrypoint specs, see [`../specs/README.md`](../specs/README.md).
