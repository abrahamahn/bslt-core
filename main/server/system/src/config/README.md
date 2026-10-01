# Server Config Layer

This directory owns server-specific configuration assembly for `@bslt/server`.

It sits between:

- raw environment parsing and shared schemas in `main/shared/src/config`
- runtime composition in `main/apps/server/src/bootstrap`

The rule is simple: shared config defines the validated environment contract; this app config layer turns that contract into the nested server runtime config used by the process.

## Current Layout

```text
main/apps/server/src/config/
  auth/        auth strategy, JWT, and rate-limit config
  infra/       database, cache, queue, storage, package manager, server config
  services/    billing, email, notifications, and search config
  factory.ts   load/init entrypoint for the server app
  index.ts     public exports for app-local consumers
```

Related shared foundation:

```text
main/shared/src/config/
  env.base.ts
  env.validation.ts
  env.auth.ts
  env.database.ts
  env.server.ts
  ...
```

## Ownership

- `main/shared/src/config`
  - environment schemas
  - shared config types such as `AppConfig`
  - validation helpers used across packages
- `main/apps/server/src/config`
  - server-app assembly from validated env into concrete runtime config
  - provider-specific defaults used only by the server runtime
  - app-local `loadConfig()` entrypoint

Do not move server runtime assembly into `main/shared/src/config`, and do not read `process.env` directly in business logic.

## Runtime Flow

```text
config/env/.env.*
  -> main/apps/server/src/config/factory.ts
  -> main/shared/src/config/* schemas + validators
  -> loadConfig()
  -> main/apps/server/src/main.ts
  -> main/apps/server/src/bootstrap/runtime.ts
```

The canonical entrypoint is:

```ts
import { loadConfig } from '@/config';

const config = await loadConfig();
```

From there, bootstrap/runtime code passes the typed config into the server composition layer.

## Working Rules

- Add new environment variable shape in `main/shared/src/config` first.
- Map that validated value into app runtime config here second.
- Expose only stable app-facing helpers from `index.ts`.
- Keep tests next to the config module they validate.

## Validation

Useful local commands:

```bash
pnpm --filter @bslt/server type-check
pnpm --filter @bslt/server test
pnpm --filter @bslt/server lint
```
