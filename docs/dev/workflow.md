# Development Workflow

## Quick Start

```bash
pnpm install          # Install all dependencies
pnpm dev              # Start server + web dev servers (with sync scripts)
pnpm dev:all          # Start all available dev servers
```

The `pnpm dev` command runs sync scripts (file headers, theme CSS) alongside the Vite dev server (port 5173) and Fastify API server (port 8080).

## Core Commands

| Command                          | Purpose                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                       | Start dev servers (web + API)                                           |
| `pnpm bslt gate merge --changed` | The merge gate for what changed since the merge base (pre-push default) |
| `pnpm gate`                      | The full merge gate (`bslt gate merge`, what CI runs)                   |
| `pnpm build`                     | Full build                                                              |
| `pnpm test`                      | Run all tests (turbo cached, errors-only output)                        |
| `pnpm test:coverage`             | Run tests with coverage enabled                                         |
| `pnpm test:e2e`                  | Run Playwright E2E suites                                               |
| `pnpm lint`                      | Test-pair audit, then lint all packages via turbo                       |
| `pnpm lint:fix`                  | Lint with auto-fix                                                      |
| `pnpm type-check`                | Type-check all packages via turbo                                       |
| `pnpm format`                    | Format all files with Prettier                                          |
| `pnpm format:check`              | Check formatting without writing                                        |
| `pnpm clean`                     | Remove all dist/build/node_modules                                      |

Repository tooling runs through `bslt`, the bin of `@bslt/tools` (`main/tools`). `pnpm bslt --help`
lists its commands; `pnpm bslt gate --list` lists every registered gate and its lanes.

### Gates and lanes

Every check lives in the gate registry (`main/tools/gates/registry.ts`) with the lanes it runs in:

| Command                          | Lane      | Runs                                                                                                                                                                                                       |
| -------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt gate merge`           | `merge`   | Header and tsconfig sync, the repository audits, the oracle snapshots, the CSS lints, gate coverage, tombstones, the ratchets, Prettier, test pairs, then turbo lint, type-check and test in every package |
| `pnpm bslt gate merge --changed` | `changed` | The same gates; turbo on the changed packages and their dependents, Prettier on the changed files                                                                                                          |
| `pnpm bslt gate nightly`         | `nightly` | The merge lane plus `pnpm build`                                                                                                                                                                           |
| `pnpm bslt gate run <id...>`     | any       | Named gates; `--update` records a new ratchet ceiling (`test-pairs`, `dead-classes`, and the ratchets below)                                                                                               |
| `pnpm bslt gate --self-test`     |           | Every registered gate once, fast and without a database; fails on a gate that returns no result                                                                                                            |

Turbo selects packages from the workspace graph: a new package is linted, type-checked and tested
because it exists (gate coverage fails if it does not define `lint`, `type-check` and `test`). Pass
`--concurrency=2` locally when memory is tight; CI sets `TURBO_CONCURRENCY`. `--dry-run` prints the
plan of a lane without running it.

`--changed` is the inner loop. Files turbo lists in `globalDependencies` (`eslint.config.ts`,
`tsconfig.json`, `vitest.config.ts`, `config/*`, `main/build-config/{bin,src}/**`) fan out to every
package. The repository audits always read the whole tree.

### Oracle snapshots

A snapshot is a committed JSON file that records a surface of the product as it is. A command
derives it from the code, and a gate compares the committed file with what the command derives now.
They exist so that a restructuring step can prove it changed no surface, or show exactly which part
it changed. The API and web route snapshots are under `main/tools/snapshots/`; the database catalog
is next to the migrations it is computed from ([The database catalog](#the-database-catalog)).

| Snapshot     | File                                    | Derived from                                                                                                                                                                                                                  | Checked by                             |
| ------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `api`        | `main/tools/snapshots/api-surface.json` | The server composed by `buildApp()`, without a database: every route it serves, with method, path, declared auth and roles, the schema the route validates its body with, and the schema expressions of its contract endpoint | `snapshot-api` gate, merge lane        |
| `web-routes` | `main/tools/snapshots/web-routes.json`  | The web app's own definitions, loaded through Vite without rendering: every page with its path, guard and layouts, the primary navigation, footer and command palette, the settings tabs and the admin surfaces               | `snapshot-web-routes` gate, merge lane |

Each file is deterministic (byte-identical on every run), sorted wherever order carries no meaning,
and starts with a `generated` key that names its command. Where order is content it is kept:
table columns, enum labels, and the navigation, settings and admin entries as the user sees them. Do not edit one by hand, and do not format one (`.prettierignore` lists them).

**When a snapshot gate fails**, it prints the changed lines (`-` committed, `+` current) and the
command. Read the difference first:

- You did not mean to change that surface: fix the code. The snapshot is right.
- You meant to change it: update the snapshot on purpose.

```bash
pnpm bslt snapshot api            # rewrite main/tools/snapshots/api-surface.json
pnpm bslt snapshot web-routes     # rewrite main/tools/snapshots/web-routes.json
git diff main/tools/snapshots     # read what changed
pnpm bslt snapshot api --check    # what the gate runs; changes nothing
```

Commit the snapshot in the same commit as the change that caused it, and describe the difference in
the pull request (a new route, a role that changed, a schema that was replaced). A reviewer reads the
snapshot diff as the list of surface changes of the pull request.

What the `api` snapshot records and what it cannot:

- The server is composed for a pinned environment (`API_SNAPSHOT_ENV` in
  `main/tools/snapshot/api.ts`): every auth strategy, billing on, local storage. That is the widest
  route set one configuration gives. Nothing is read from `process.env`.
- `registeredBy: "server"` marks a route registered straight on the Fastify instance (provider
  webhooks, the CSRF token, uploads). Its `auth` is `undeclared`: whatever it checks, it checks in
  its handler.
- A schema is an opaque parser, so its identity is the expression the contract declares
  (`successResponseSchema(logoutResponseSchema)`). A change inside a schema that keeps its name does
  not show. `request` is the schema the route really validates with; it can differ from the
  `body` of its contract.

What the `web-routes` snapshot records:

- Two configurations: `starter` (every optional surface off, what a clone runs) and `everything`
  (every one on). The builders get explicit flags; no `VITE_*` variable or env file is read.
- `guard` is `protected` (signed-in only) or `publicOnly` (signed-out only), set on the route or on a
  layout above it. A role check is done by a layout: an admin page has `AdminLayout` in `layouts`.
- Routes are sorted by path. The router takes the first match, so where two patterns overlap the
  earlier one lists the later in `takesPrecedenceOver` (`/settings/billing` over `/settings/:tab`).
- A page is named by its component, a code-split page by the module export it is loaded from. A
  route added with an anonymous component stops the command: give the component a name.

### The OpenAPI document

`docs/reference/openapi.json` is the OpenAPI 3.1 document of the API, for consumers that do not read
TypeScript. `pnpm bslt sync openapi` writes it from the composition the `api` snapshot is written
from: one operation per snapshot row, with its auth requirement, module, deprecation and the schemas
of its contract. The `generated-openapi` gate (merge lane) fails when the committed file differs from
what the command writes now; it is not formatted either.

```bash
pnpm bslt sync openapi            # rewrite docs/reference/openapi.json
pnpm bslt sync openapi --check    # what the gate runs; changes nothing
```

A schema states only what `describe()` of `@bslt/schema` exposes. A hand-written `createSchema(fn)`
parser is `{"x-bslt-opaque": true}` (validated, not described); an opaque request body is `*/*` and
does not claim `required`, since whether the parser accepts no body cannot be seen. Checks JSON Schema
cannot express are `x-bslt-*` keywords; `info.description` in the file lists them. The document gets more precise as
the `opaque-schema` ratchet goes down, without a change to the generator.

### The database catalog

`main/server/db/catalog.snapshot.json` is the one committed description of the database: roles,
extensions, types, functions, and per table its columns, constraints, indexes, policies with their
text, grants, row security and `rls:<class>` comment. Every type, sequence, function, table and view
carries `source`: the migration source that created it.

It is computed, not parsed. `pnpm bslt db catalog` creates a scratch database, applies the migration
sources one at a time as `bslt_owner` (the kernel, then the owners in dependency order), reads
`pg_catalog` after each, and attributes what is new to the source just applied. It needs a Postgres
it may create a database on, the one the real-DB suites use (`DATABASE_URL` or the `POSTGRES_*`
parts; `DATABASE_ADMIN_URL` under the role split):

```bash
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5432 POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \
  POSTGRES_DB=postgres pnpm bslt db catalog      # compute and write
pnpm bslt sync rows                              # regenerate what is derived from it
pnpm bslt db catalog --check                     # compute and compare; writes nothing
```

The command writes nothing and fails when:

- a source alters or drops an object another source created (a column, an index, a policy, a grant,
  a trigger, a function body: a source changes only its own objects);
- an object was there before any source ran (it is unattributed);
- the catalog is not sound: see the audit below.

Everything else reads the committed file and needs no database:

| Reader                                 | What it does                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt db audit` (`db-audit` gate) | Merge lane. Every object is attributed to a known source; every table is classified, has row security enabled and forced, and its policies and grants equal the template of its class; an `owner_user` or `owner_org` table has a NOT NULL owner column and a `describeOwnerIsolation` case; a foreign key stays within `dependsOn` |
| `db-legacy-names` ratchet              | Merge lane. Counts the objects whose name does not carry the prefix of their source (`<moduleId>` or `<moduleId>_<entity>`, the kernel `sys_*`); the count only goes down                                                                                                                                                           |
| `pnpm bslt sync rows`                  | Generates the row types, column maps and table lists of `@bslt/db`, and the structural RLS test                                                                                                                                                                                                                                     |

The real-DB lane recomputes the catalog: the `Catalog recomputed` step of the CI `real-db` job
(`pnpm bslt db catalog --check`) and `tests/integration/database/db-catalog.real-db.test.ts`.
`pnpm bslt db audit --db` also compares the connected database with the catalog, table by table
(the `Catalog check` step, after the migrations ran). `pnpm bslt gate run db-catalog` is the
recomputation by name.

A baseline that changes the schema changes the catalog: run the commands and commit the files with
the baseline. Do not edit the catalog by hand, and do not format it (`.prettierignore` lists it).

Left out, because it does not come from the migrations alone: objects that belong to an extension;
the partitions of a partitioned table (the migrations create them for the current and the next
month, so their names depend on the day; the parent records its partition key and default
partition); the privileges an owner holds on its own object; cluster roles the catalog does not
name. Roles, extensions and schemas belong to the cluster and the database and carry no source. A
function is recorded with its signature, attributes, grants and the SHA-256 of its body. The output
is the same on Postgres 16 and 17.

#### Generated rows

`pnpm bslt sync rows` reads the committed catalog (no database) and writes:

| File                                                       | Holds                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `main/server/db/src/legacy-generated/<owner>.ts`           | Per table of a legacy owner: `<TABLE>_TABLE`, `<Table>Row`, `<Table>Insert`, `<Table>Update`, `<TABLE>_COLUMNS`   |
| `main/server/db/src/generated/rows.ts`                     | The same for the kernel's tables (`sys_*`)                                                                        |
| `main/server/db/src/generated/tables.ts`                   | `TABLES_BY_SOURCE` and `TABLES`: `REQUIRED_TABLES`, the startup check, is `TABLES`                                |
| `tests/integration/database/generated/rls.real-db.test.ts` | One structural row-level security case per table: forced, equal to the template of its class, the listed commands |

The type map is fixed: uuid is `string`, timestamptz is `Date`, bigint is `bigint`, numeric is
`string`, jsonb is `JsonValue`, an enum and a text column with an `= ANY (ARRAY[...])` check are
unions of their labels; a type the map does not know stops the command. Each file starts with a
header that names the command, and each derived line ends with `// <- <key>`, the key of the catalog
it comes from. Do not edit a generated file: the `generated-rows` gate of the merge lane regenerates
them in memory and fails on a stale file and on a file in one of these directories that the command
does not produce.

`main/server/db/src/schema/*.ts` keeps the names the code base uses (`User`, `NewUser`,
`USER_COLUMNS`) as expressions over the generated rows, and states only what differs from the
catalog: the shape stored in a JSON column, a column a type leaves out (`version` in most rows), a
column an insert requires although the database has a default, and three unions of billing that do
not match their enum (`PlanInterval`, `InvoiceStatus`, `PaymentMethodType`). A module that migrates
gets its own `server/generated/rows.ts` and drops its expressions.

### Ratchets

A ratchet counts a construct the restructure removes. The count may only go down. Each has one number
in `main/tools/gates/ratchets/budgets.json`, and each is a gate of the merge lane.

| Gate                    | Counts                                                                                                                                                                                                          | Instead                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `swallowed-catch`       | Empty `catch` blocks, and rejection handlers that do nothing (`.catch(() => {})`, `.catch(() => undefined)`, the second argument of `.then`)                                                                    | Handle the error, log it, or let it reach the caller                |
| `raw-sql-outside-repos` | Statements started with the `@bslt/db` builder (`select`, `insert`, `update`, `deleteFrom`, ...) and SQL text handed to a client (`.raw`, `.unsafe`), outside `main/server/db/src/repositories` and the builder | Add a repository method                                             |
| `setinterval`           | `setInterval` calls in server code (`main/server`, `main/apps/server`)                                                                                                                                          | A cron job or a queued job                                          |
| `inline-style`          | JSX `style` props outside `@bslt/ui`. A style object that only sets CSS custom properties (`style={{ '--ui-progress': value }}`) is not counted                                                                 | A class or a `@bslt/ui` component                                   |
| `opaque-schema`         | `createSchema(fn)` calls outside `main/kernel/schema`: a schema that is a hand-written parser                                                                                                                   | The schema combinators of `@bslt/schema`                            |
| `unused-exports`        | Declarations a package source exports and no other file imports (tests count as importers; a re-export is not an import). Found with the TypeScript compiler                                                    | Import it where it is needed, drop the `export`, or delete the code |

All of them read production sources only: no test file, no `__tests__`, `tests` or `testing`
directory, no build output.

**When a ratchet fails because the count is over the budget**, you added one. The gate lists the
sites in the files you changed (all of them when it cannot tell). Remove yours; the budget is never
raised.

**When it fails because the count is under the budget**, you removed one. Lower the budget so the gap
cannot be refilled, and commit the file with your change:

```bash
pnpm bslt gate run swallowed-catch --update     # writes the lower count; never a higher one
pnpm bslt gate run swallowed-catch --verbose    # lists every counted site
```

### Runtime dependency allowlist

The rule the restructure ends on: the `dependencies`, `peerDependencies` and `optionalDependencies`
of every workspace package are `react`, `react-dom` and workspace packages. Dev dependencies are not
part of the rule. `main/tools/gates/deps-allowlist.json` lists every other runtime dependency that
exists today: `name`, `replacement` (what takes its place), `removeBy` (the phase it leaves in),
`conformance` (what proves the replacement), and `usedBy` (the packages that may declare it).

The `deps-allowlist` gate of the merge lane fails when:

- a manifest declares a runtime dependency that is not listed, or not listed for that package. Do not
  add an entry: own the code, or reach the service over HTTP behind an owned port;
- an entry's `removeBy` is a phase before the current one. The current phase is `CURRENT_PHASE` in
  `main/tools/lib/phase.ts`, the one place it is read from;
- an entry is declared by no package any more. The pull request that replaces a dependency deletes
  its entry, so the list only shrinks.

### Targeted Checks (During Development)

```bash
# Lint specific changed files
npx eslint src/path/to/file.ts

# Type-check a single package
pnpm --filter @bslt/web type-check
pnpm --filter @bslt/server type-check
pnpm --filter @bslt/ui type-check

# Run a specific test file
pnpm test -- --run src/path/to/file.test.ts

# Format specific files
npx prettier --config config/.prettierrc --write src/path/to/file.ts
```

## Git Hooks

Hooks are stored in `infra/git-hooks/` and installed via `pnpm prepare` (runs `git config --local core.hooksPath infra/git-hooks`).

### Pre-commit

Skips if no staged changes. Otherwise runs:

1. **Sync file headers** (`pnpm bslt sync headers --staged`) -- ensures `// path/to/file.ts` headers on staged files
2. **lint-staged** -- formats (Prettier) and lints (ESLint) staged `.ts/.tsx/.js/.jsx` files; formats staged `.json/.css/.md/.yml` files

### Pre-push

Skips if refs are already up-to-date. Otherwise runs **cache maintenance** (`pnpm bslt maintain-caches`)
and then `pnpm pre-push` (`bslt pre-push`, modes in `main/tools/scripts/dev/pre-push.ts`):

| Mode              | Set               | Runs                                                        |
| ----------------- | ----------------- | ----------------------------------------------------------- |
| Changed (default) | nothing           | `bslt gate merge --changed --concurrency=2`                 |
| Fast              | `PRE_PUSH_FAST=1` | `bslt gate run headers test-pairs lint --concurrency=2`     |
| Full              | `PRE_PUSH_FULL=1` | `bslt gate nightly --concurrency=2` (merge lane plus build) |

The default mode takes the merge base of `HEAD` with the branch's upstream, or with `origin/main` when
the branch has none (it fails, naming `git fetch origin main`, when neither has a merge base). Unlike the
old `ci:fast`, it runs every merge gate and reaches every package, `@bslt/core` included.
`pnpm bslt pre-push --dry-run` prints the change set and each gate's command without running them.

## CI Pipeline

CI is one workflow, `.github/workflows/ci.yml`. It triggers on:

- **Pull requests** to any branch
- **Push** to `main`
- **Scheduled** daily at 02:00 UTC (the nightly lane)
- **Manual** dispatch (runs the nightly lane too)

### Lanes

| Event                         | Jobs                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Every run                     | `static`, `real-db`, the five `security-*` scanners and their `security` verdict; `infra` when a file under `infra/` changed |
| Push to `main` (in addition)  | `images`, after `static` and `real-db`                                                                                       |
| Nightly schedule, manual runs | `e2e`, `build`, `coverage`, `lighthouse`, and `infra` whatever changed                                                       |

| Job          | What it runs                                                                                                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static`     | `pnpm bslt gate --self-test`, then `pnpm bslt gate merge`: the audits, the CSS lints, Prettier, then lint, type-check and the unit tests of every package                                                                                                                  |
| `real-db`    | A Postgres service of the pinned image, on the production role split: `db:bootstrap:roles`, `db:migrate`, `db:audit --db` (the migrated database against the committed catalog), `bslt db catalog --check` (the catalog recomputed), `test:real-db`, `test:postgres-smoke` |
| `security-*` | CodeQL, Semgrep, `pnpm audit` and OSV, Gitleaks, Trivy; see [security-ci.md](./security-ci.md) for which of them block                                                                                                                                                     |
| `infra`      | `terraform fmt -check` and `terraform validate` for `infra/cloud/digitalocean` and `infra/cloud/gcp`, without a backend or credentials                                                                                                                                     |
| `images`     | Builds and pushes the server image and the web image, and uploads the `deployment-images` artifact the deploy reads                                                                                                                                                        |
| `e2e`        | Playwright against a Postgres service                                                                                                                                                                                                                                      |
| `build`      | `pnpm bslt gate run build` (every package, with the postbuild ESM checks) and the API response and client checks                                                                                                                                                           |
| `coverage`   | `pnpm test:coverage`, non-blocking                                                                                                                                                                                                                                         |
| `lighthouse` | Lighthouse CI against the built web app                                                                                                                                                                                                                                    |

There is no separate `unit` job: the merge gate's `test` gate is `turbo run test` over every package,
so the unit tests run once, in `static`. For the same reason the nightly `build` job runs
`bslt gate run build` and not `bslt gate nightly`, which would run the merge lane a second time.

In `real-db` the superuser appears only as `DATABASE_ADMIN_URL` (the role bootstrap and the test
harness's `CREATE DATABASE`) and as the smoke suite's own URL. The suites connect as `bslt_app` and
`bslt_worker`.

**Concurrency**: Cancels in-progress runs for the same branch (`ci-${{ github.ref }}`), except on `main`.

**Required checks**: `static`, `real-db` and `security` are the three job names to require in branch
protection.

### Version pins

Two files hold the runtime versions, and the `version-pins` merge gate
(`main/tools/scripts/audit/version-pins.ts`) fails when anything else names another one:

| Pin                  | Holds                                                                    | Read by                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.node-version`      | the exact Node.js version                                                | `actions/setup-node` (`node-version-file: .node-version`), the `ARG NODE_VERSION` default of both Dockerfiles, Node images in compose files, `engines.node` (`>=24 <25`)                                                                    |
| `infra/versions.env` | `POSTGRES_MAJOR`, `POSTGRES_IMAGE`, `PGBOUNCER_IMAGE` (pinned by digest) | every `image:` in the compose files and the CI service containers, the backup and deploy scripts (`. infra/versions.env`; the deploy also compares the database server's major with it), the managed-database version in `infra/cloud/*.tf` |

To move to a new Node.js or Postgres release, change the pin, run `pnpm bslt gate run version-pins`
and change each place it lists. A new Postgres major also needs the upgrade procedure in
[`docs/deploy/production-postgres.md`](../deploy/production-postgres.md).

The same gate requires every `uses:` in `.github/workflows` and `.github/actions` to name a full
commit SHA with the release in a trailing comment:

```yaml
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
```

A tag or a branch can be moved to other code; a commit cannot. To update an action, resolve the new
tag to its commit (`git ls-remote --tags https://github.com/<owner>/<repo> <tag>`; for an annotated
tag take the `^{}` line, which is the commit) and change the SHA and the comment together.

### Images (push to `main` only)

The `images` job builds and pushes the API and web images to the configured container registry
(default: `ghcr.io`) and produces a `deployment-images.json` artifact with their digests.

### Deploy

Deploys are one workflow too, `.github/workflows/deploy.yml`:

| What starts it                                | What it does                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| A push-triggered CI run on `main` that passed | production app server (by the image digests), the demo host, Cloudflare web |
| A push to `staging`                           | merge gate, staging images, the staging app server                          |
| Manual run                                    | the chosen environment's deploy, a rollback to `rollback_sha`, or Terraform |

A nightly or manual CI run deploys nothing. Because the deploy keys on the whole CI run, a red
`security` job on `main` also holds the deploy back, for a manual production deploy as well. The
nightly and manual CI runs queue apart from the pushes to `main`, so they never cancel the run a
deploy waits for. See
[`docs/deploy/README.md`](../deploy/README.md#automated-deployment-recommended).

## Docker Commands

```bash
# Development (local Docker Compose)
pnpm docker:dev           # Build and start dev containers
pnpm docker:dev:down      # Stop dev containers

# Production (local Docker Compose)
pnpm docker:prod          # Build and start prod containers
pnpm docker:prod:down     # Stop prod containers
```

Docker files are in `infra/docker/`:

- `Dockerfile` -- API server image
- `Dockerfile.web` -- Web client image
- `development/docker-compose.dev.yml` -- Dev compose stack
- `production/docker-compose.prod.yml` -- Production app server (no database)
- `production/docker-compose.db.yml` -- Production database server

## Database Commands

```bash
pnpm db:migrate           # Apply the pending migrations (bslt db migrate)
pnpm db:seed              # Seed database with sample data
pnpm db:bootstrap         # Bootstrap database (create + migrate + seed)
pnpm db:bootstrap:admin   # Bootstrap admin user
pnpm db:reset             # Reset database
pnpm db:audit             # Audit the committed database catalog (--db: also the connected database)
```

`pnpm db:reset` is the way out when the runner says a database cannot be migrated forward: baselines
are edited in place until `foundation-v1`. Adding a table and using the client are in
[Working with the database](./database.md).

## Branch Strategy

- `main` -- Production branch. A push runs CI, publishes the images and, when CI passed, deploys.
- Feature branches -- CI runs `static`, `real-db` and `security` on pull requests.
- `staging` -- A push deploys to the staging environment (see `docs/dev/staging.md`). CI does not
  run on it; the deploy runs the merge gate itself before it builds.

## Verification Gates

| Gate       | When          | Command                                                      |
| ---------- | ------------- | ------------------------------------------------------------ |
| Pre-commit | Every commit  | `pnpm pre-commit` (format + lint staged files)               |
| Pre-push   | Every push    | `pnpm pre-push` (changed packages and dependents; see above) |
| CI (PR)    | Pull requests | `static` (the merge gate), `real-db`, `security`             |
| CI (merge) | Push to main  | The same, then `images`; the nightly lane on schedule        |

## Troubleshooting

### Commands exit silently with no output

Symptom: `pnpm lint`, `pnpm test`, or any `node --import tsx ...` script exits non-zero with no
visible error -- ESLint and Vitest simply die -- or stderr is flooded with
`_load_nvm: command not found`.

Cause: `node` is resolving to an **nvm lazy-load shell function**, not a binary. When the
function's `_load_nvm` helper is missing from the current shell (common under WSL, and in any
non-login shell or tool that replays a stale shell snapshot), the function exits 1 while writing
only to stderr.

Diagnose:

```bash
type node        # "node is a function"       -> you have the problem
                 # "node is /path/to/node"    -> you do not
```

Fix, in the affected shell:

```bash
unset -f node npm npx nvm pnpm
# Put the real binary directory first on PATH (ls ~/.nvm/versions/node for yours):
export PATH="$HOME/.nvm/versions/node/<version>/bin:$PATH"
type node        # must now print a real path
```

If a tool (CI runner, editor terminal, agent harness) keeps reintroducing the shim, pin the real
binary directory first on `PATH` in that tool's environment instead of relying on nvm's lazy-load.
This only affects nvm-managed shells; direct Node installs are unaffected.
