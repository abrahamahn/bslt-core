# Configuration

This directory keeps shared tooling and environment documentation out of the repository root. App and package-specific config still lives next to the code it configures.

## What Lives Here

| File                   | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `env/`                 | Environment templates and loading guidance.                       |
| `playwright.config.ts` | End-to-end test runner configuration.                             |
| `tsconfig.base.json`   | Shared TypeScript defaults for workspace packages.                |
| `tsconfig.eslint.json` | TypeScript project used by typed ESLint rules.                    |
| `tsconfig.node.json`   | Node-focused TypeScript defaults for scripts and server packages. |
| `tsconfig.react.json`  | React-focused TypeScript defaults for browser packages.           |

## Workspace Shape

The workspace is declared in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml):

- `main/apps/*` for runtime applications.
- `main/server/*` for server-side packages.
- `main/client/*` for browser/client packages.
- `main/shared` for shared contracts and utilities.
- `main/tools` for repository automation.
- `tests` for cross-package integration and E2E tests.

## Common Changes

- Environment variables: edit templates under [`config/env`](./env/README.md), then validate with `pnpm audit:env-examples`.
- TypeScript defaults: edit the narrowest shared config that applies, usually `tsconfig.node.json` or `tsconfig.react.json`.
- Playwright behavior: edit [`playwright.config.ts`](./playwright.config.ts) and run `pnpm test:e2e` for validation.
- Server runtime config: update [`main/server/system/src/config`](../main/server/system/src/config/README.md).

## Guardrails

- Keep generated build output and package-specific config out of this directory.
- Prefer adding config next to the owning app/package unless it is shared by multiple workspace members.
- Run `pnpm audit:template`, `pnpm type-check`, and the relevant tests after changing shared tooling.
