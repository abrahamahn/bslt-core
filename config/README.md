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

- `main/apps/*` for runtime applications (`server`, `web`).
- `main/kernel/*` for foundation kernel packages (`schema`, `contract`, `protocols`, `db`, `server`, `storage`, `comms`, `realtime`, `client`, `react`, `ui`, `web`).
- `main/modules/*` for vertical domain modules (`identity`, `orgs`, `entitlements`, `billing`, `flags`, `tasks`, `support`, `status`, `search`, `analytics`, `audit`, `notifications`, `files`, `moderation`, `compliance`, `webhooks`, `admin`, `devtools`).
- `main/tools` and `main/build-config` for repository automation and shared build config.
- `main/testing` and `tests` for the testing kit and cross-package integration and E2E tests.

## Common Changes

- Environment variables: edit templates under [`config/env`](./env/README.md), then validate with `pnpm bslt gate run env-examples`.
- TypeScript defaults: edit the narrowest shared config that applies, usually `tsconfig.node.json` or `tsconfig.react.json`.
- Playwright behavior: edit [`playwright.config.ts`](./playwright.config.ts) and run `pnpm test:e2e` for validation.
- Server runtime config: update [`main/kernel/server/src/config`](../main/kernel/server/src/config/README.md).

## Guardrails

- Keep generated build output and package-specific config out of this directory.
- Prefer adding config next to the owning app/package unless it is shared by multiple workspace members.
- Run `pnpm bslt gate merge`, `pnpm type-check`, and the relevant tests after changing shared tooling.
