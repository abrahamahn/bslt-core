# Sync Scripts (`bslt sync`)

Deterministic Rung-3 generators in `main/tools/sync/` executed via `pnpm bslt sync <target> [--check]` and verified in `pnpm bslt gate merge`.

## Overview

| Command                      | Source                                  | Output                                                                                                                     |
| ---------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bslt sync modules`     | `main/tools/sync/modules.ts`            | `main/apps/{server,web}/src/generated/modules.ts`, app `package.json` deps, `module-graph.json`, module `README.md` blocks |
| `pnpm bslt sync rows`        | `main/tools/sync/rows.ts`               | `main/kernel/db/src/generated/*`, `main/modules/<id>/server/generated/{rows.ts,rls.real-db.test.ts}`                       |
| `pnpm bslt sync permissions` | `main/tools/sync/permissions.ts`        | `bslt.lock.json` (`orgPermissions` bit positions + `migrations` SHA-256 checksums)                                         |
| `pnpm bslt sync docs`        | `main/tools/sync/docs.ts`               | `docs/reference/{api,database,events-jobs-cron,web-routes,module-dag}.md`, `docs/DIRECTION.md` status block                |
| `pnpm bslt sync openapi`     | `main/tools/sync/openapi.ts`            | `docs/reference/openapi.json`                                                                                              |
| `pnpm bslt sync csp`         | `main/tools/sync/csp.ts`                | `infra/runtime/caddy/security-headers.generated.caddy` + server CSP/Permissions-Policy constants                           |
| `pnpm bslt sync icons`       | `main/tools/sync/icons.ts`              | `main/kernel/ui/src/icons.generated.ts` (from `main/kernel/ui/icons/*.svg`)                                                |
| `pnpm bslt sync stories`     | `main/tools/sync/stories.ts`            | `main/modules/devtools/web/generated/story-index.generated.ts`                                                             |
| `pnpm sync:headers`          | `main/tools/sync/sync-file-headers.ts`  | `// path/to/file.ts` first-line path comments                                                                              |
| `pnpm sync:ts`               | `main/tools/sync/sync-ts-references.ts` | Root `tsconfig.json` project `references`                                                                                  |
| `pnpm build:theme`           | `main/tools/sync/sync-css-theme.ts`     | `main/kernel/ui/src/styles/theme.css` (from `main/kernel/ui/src/theme/*`)                                                  |

## Anti-Magic & Orphan Rules

- Every generator runs deterministically without network access (`bslt db catalog` is the sole database-backed snapshot step).
- Passing `--check` (or running `pnpm bslt gate merge`) verifies zero diff against committed files **and** fails if any orphan file exists in `generated/` or `docs/reference/`.
- Hand-written prose outside `<!-- bslt:generated ... -->` markers is never modified.

See [`../specs/principles.md`](../specs/principles.md) for the 3-rung Derivation Ladder.
