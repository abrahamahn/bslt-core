# BSLT Documentation

Documentation for BSLT (`foundation-v1`), a self-owned TypeScript platform foundation with vertical modules, forced Row-Level Security, and zero-bloat runtime defaults.

## 1. Start Here — Onboarding

| Doc                                                  | For                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [ONBOARDING.md](./ONBOARDING.md)                     | First-day setup, the shortest clone -> product-feature path, "where is X", task recipes, troubleshooting. |
| [`dev/workflow.md`](./dev/workflow.md)               | Daily commands, git hooks, CI pipeline.                                                                   |
| [`dev/configuration.md`](./dev/configuration.md)     | Build tooling, module resolution, TypeScript config.                                                      |
| [`../config/env/README.md`](../config/env/README.md) | Env file loading priority and overrides.                                                                  |

## 2. Direction & Generated Reference (`pnpm bslt sync docs`)

| Doc                                                                | For                                                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [DIRECTION.md](./DIRECTION.md)                                     | Canonical platform status, module inventory, capability ledger, and adoption guide. |
| [`reference/module-dag.md`](./reference/module-dag.md)             | Generated module manifest table, Mermaid DAG, and dependency matrix.                |
| [`reference/api.md`](./reference/api.md)                           | Generated HTTP route catalog attributed to `kernel` and installed modules.          |
| [`reference/database.md`](./reference/database.md)                 | Generated PostgreSQL table & RLS classification catalog.                            |
| [`reference/events-jobs-cron.md`](./reference/events-jobs-cron.md) | Generated outbox events, `sys_jobs` workers, and cron schedule catalog.             |
| [`reference/web-routes.md`](./reference/web-routes.md)             | Generated web route, shell, and guard catalog.                                      |
| [`reference/openapi.json`](./reference/openapi.json)               | Generated OpenAPI 3.1 contract specification (`pnpm bslt sync openapi`).            |

## 3. How We Build — Architecture & Specifications

| Doc                                                  | For                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| [`specs/principles.md`](./specs/principles.md)       | **Canonical** coding standards, derivation ladder, testing rules.         |
| [`specs/modules.md`](./specs/modules.md)             | Vertical module shape, `defineModule`, server/web bindings, DAG rules.    |
| [`specs/data.md`](./specs/data.md)                   | Flat `public` schema, 3-role split, forced RLS, locked migrations, PITR.  |
| [`specs/specs.md`](./specs/specs.md)                 | Runtime entrypoints, composition roots, and end-to-end request flows.     |
| [`specs/auth.md`](./specs/auth.md)                   | Dual-token authentication, rotation, MFA, and passkey flows.              |
| [`specs/errors.md`](./specs/errors.md)               | Semantic error contracts and HTTP boundary normalization.                 |
| [`architecture/`](./architecture/README.md)          | API contract standard, responsive rules, and 21-phase restructure record. |
| [`dev/testing.md`](./dev/testing.md)                 | Adversarial TDD, `describeRealDb`, `describeOwnerIsolation`, Playwright.  |
| [`dev/module-creation.md`](./dev/module-creation.md) | Scaffolding a vertical module (`pnpm bslt module new <id>`).              |
| [`dev/rename.md`](./dev/rename.md)                   | Safe product identity and `@bslt/*` scope rename flow.                    |
| [`dev/security.md`](./dev/security.md)               | Security headers, CSRF, rate limiting, and redaction.                     |

## 4. How We Ship — Operations & Deploy

| Doc                                                                | For                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`deploy/README.md`](./deploy/README.md)                           | Deployment topology (`PROCESS_ROLE`, two-server split).       |
| [`deploy/env.md`](./deploy/env.md)                                 | Full env-var reference.                                       |
| [`deploy/backup-restore.md`](./deploy/backup-restore.md)           | Encrypted S3 backups, PITR WAL hooks, and restore drills.     |
| [`deploy/production-postgres.md`](./deploy/production-postgres.md) | PostgreSQL 17 tuning, roles, and recovery.                    |
| [`deploy/observability.md`](./deploy/observability.md)             | Prometheus metrics, OTLP/HTTP export, and `alerts.yml` rules. |
| [`deploy/release-checklist.md`](./deploy/release-checklist.md)     | Pre-release validation.                                       |
| [`deploy/reverse-proxy.md`](./deploy/reverse-proxy.md)             | Caddy setup and `bslt sync csp` security headers.             |
| [`deploy/providers/`](./deploy/providers/README.md)                | Provider-specific deploy guides.                              |
| [`dev/security-ci.md`](./dev/security-ci.md)                       | CI security scanning (CodeQL, Semgrep, OSV, Gitleaks, Trivy). |
| [`dev/staging.md`](./dev/staging.md)                               | Staging environment.                                          |
| [`dev/horizontal-scaling.md`](./dev/horizontal-scaling.md)         | Multi-instance architecture and Valkey/RESP pub/sub.          |

## 5. History

[`log/`](./log/README.md) — weekly engineering journal. Append-only.
