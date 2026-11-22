# Specifications

Canonical system design, module boundaries, data/RLS invariants, and coding standards for BSLT (`foundation-v1`).

| Document                      | Description                                                                    | When to read                             |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| [Principles](./principles.md) | **Canonical** coding standards, code placement, derivation ladder, TDD rules   | Before any code change                   |
| [Modules](./modules.md)       | Vertical module folder shape, `defineModule`, `implementServer`/`implementWeb` | Creating or modifying any domain module  |
| [Data & RLS](./data.md)       | Flat `public` schema, roles, `sys_apply_rls`, locked migrations, PITR backups  | Writing SQL migrations, queries, or jobs |
| [Ownership Spec](./specs.md)  | Runtime entrypoints, composition roots, and end-to-end request/compliance map  | Modifying `main/apps/{server,web}`       |
| [Auth](./auth.md)             | Dual-token auth, session rotation, MFA, passkeys, and token hashing            | Modifying `@bslt/identity` auth flows    |
| [Errors](./errors.md)         | Semantic error definitions (`defineErrors`) and HTTP boundary presentation     | Adding or mapping error codes            |

For first-day setup and recipes, see [`../ONBOARDING.md`](../ONBOARDING.md). For the live workspace inventory, see [`../DIRECTION.md`](../DIRECTION.md).

---

## Reading Order

1. [`../ONBOARDING.md`](../ONBOARDING.md) — setup, codebase tour, recipes
2. [Principles](./principles.md) — standards applied on every change
3. [Modules](./modules.md) & [Data & RLS](./data.md) — vertical module and PostgreSQL invariants
4. [Ownership Spec](./specs.md) — app composition roots and runtime entrypoints
5. [Auth](./auth.md) & [Errors](./errors.md) — security and error transport contracts

---

## Related

- [Generated Reference](../reference/module-dag.md) — live module DAG, HTTP API, database tables, events/jobs/cron, and web routes
- [Architecture](../architecture/README.md) — API contract standard, responsive contract, and restructure history
- [Development guides](../dev/README.md) — workflow, testing, configuration, security
