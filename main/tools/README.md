# Tools (`@bslt/tools`)

Repository tooling: dev tooling only, never shipped. `main/tools` is the `@bslt/tools` workspace
package, so `turbo run lint`, `type-check` and `test` cover it like any other package.

Everything runs through the `bslt` bin (`bin/bslt.ts`, run with tsx): `pnpm bslt --help`.

## Directory structure

- `bin/bslt.ts` - the CLI entry; `cli/` - command dispatch (`main.ts`) and script subcommands (`scripts.ts`)
- `gates/` - the gate registry (`registry.ts`), its runner, the turbo and Prettier gates,
  `tombstones.ts` (deleted paths, scripts and symbols), `merge-parity.ts` (the record of the
  deleted `ci:merge-gate` chain), `ratchets/` (the counts that may only go down, with
  `budgets.json`) and `deps-allowlist.ts` with `deps-allowlist.json` (the runtime dependencies that
  remain, each with the phase it leaves in). See "Ratchets" and "Runtime dependency allowlist" in
  `docs/dev/workflow.md`
- `lib/` - `paths.ts` (the single repository-paths module), `phase.ts` (the restructure phase in
  progress), `merge-base.ts`, `env-file.ts`
- `scripts/` - audits, codegen, database, dev and export scripts; each exports its entry and none
  runs on import
- `catalog/` - the database catalog: `bslt db catalog` computes it on a scratch database and
  attributes every object to its migration source, `bslt db audit` checks the committed file
  (`main/server/db/catalog.snapshot.json`). See "The database catalog" in `docs/dev/workflow.md`
- `snapshot/` - the oracle snapshot commands (`bslt snapshot api | web-routes`);
  `snapshots/` - the committed snapshot files they write. See "Oracle snapshots" in
  `docs/dev/workflow.md`
- `sync/` - file headers, CSS theme generation, TypeScript project references and the OpenAPI
  document (`bslt sync openapi`, `docs/reference/openapi.json`). See "The OpenAPI document" in
  `docs/dev/workflow.md`

## Gates

| Command                          | What it runs                                                           |
| -------------------------------- | ---------------------------------------------------------------------- |
| `pnpm bslt gate merge`           | The merge lane (CI)                                                    |
| `pnpm bslt gate merge --changed` | The merge lane narrowed to the changes since the merge base (pre-push) |
| `pnpm bslt gate nightly`         | The merge lane plus the build                                          |
| `pnpm bslt gate run <id...>`     | Named gates                                                            |
| `pnpm bslt gate --self-test`     | Every registered gate once, fast and without a database                |
| `pnpm bslt gate --list`          | The registry                                                           |

A new audit exports `run(): CheckResult` and gets a registry entry; `registry.test.ts` fails on an
audit or lint script that is neither a gate nor a report.
