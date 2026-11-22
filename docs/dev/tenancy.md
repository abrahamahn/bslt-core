# Tenancy

BSLT has one data-isolation model: one flat `public` schema, every table classified and under forced
Row-Level Security. A row belongs to a user or to an org, and the database decides who reaches it.

The second model this page once described, a Postgres schema per tenant selected with an environment
variable, was removed in restructure Phase 6 (plan section 9.4). It was opt-in, no deployment used
it, and it bypassed the model above: its example table had no row security at all, and `search_path`
was the only boundary. The toolkit, its environment variable, the `schema` field of a database
session and the provisioning hooks in login, OAuth, magic link and tenant creation are deleted and
tombstoned (`main/tools/gates/tombstones.ts`). A database session never changes the `search_path`.

## How isolation works

| Piece                 | Where                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles                 | `bslt_app` runs user sessions as `authenticated`; `bslt_worker` runs system work as `bslt_system`; neither owns a table or bypasses RLS ([roles](../deploy/env.md#database-roles))                                                            |
| Classes               | Every table is classified by its owner's baseline with `sys_apply_rls(table, class, owner column)`: `owner_user`, `owner_org`, `public_read`, `append_only`, `system`, `custom` ([classifying a table](../deploy/env.md#classifying-a-table)) |
| Org-owned rows        | Class `owner_org`: a row is reachable by members of the row's org (`sys_current_user_is_org_member`), never by the org a request merely names                                                                                                 |
| Audience              | Opt-in per table: `sys_apply_audience(table, rating column, owner column)`; an unrated row is the owner's alone                                                                                                                               |
| Session               | One `set_config` statement per transaction: the role `authenticated`, `app.user_id`, the org of the request (`app.org_id`), `app.role`, `app.max_audience` (`main/server/db/src/client.ts`)                                                   |
| The committed catalog | `main/server/db/catalog.snapshot.json`: every table with its class, policies and grants ([the database catalog](./workflow.md#the-database-catalog))                                                                                          |

## How it is proven

- `pnpm bslt db audit` (merge lane): every table is classified, forced, and equal to the template of
  its class; every `owner_user` and `owner_org` table has an owner-isolation test.
- `tests/integration/database/rls-classes.real-db.test.ts`: each class once, as `bslt_app` and as
  `bslt_worker`: cross-user and cross-org read, update and delete touch 0 rows, a foreign-owner insert
  fails, the audience backstop fails closed.
- `tests/integration/database/generated/rls.real-db.test.ts` (generated): per table, row security is
  forced and the policies and grants equal the class template.
- `tests/integration/api/owner-isolation.real-db.test.ts`: per owned table, another user or a member
  of another org does not see, change or delete the owner's row.

## A fork that needs harder isolation

A fork with data-residency or blast-radius requirements that row-level security does not meet deploys
one database per customer, or adds a restrictive policy of its own on top of a class. Both keep the
one model; neither needs code in the starter.
