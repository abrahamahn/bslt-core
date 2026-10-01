# @bslt/server-system

Reusable server-side infrastructure and runtime adapters for BSLT.

This package owns cross-cutting server concerns that sit between app composition and lower-level packages such as `@bslt/db` and `@bslt/shared`.

## Install

```bash
pnpm add @bslt/server-system
```

## Preferred Usage

Prefer stable subpath imports:

```ts
import { registerRouteMap } from '@bslt/server-system/http';
import { createLogger } from '@bslt/server-system/logger';
import { RateLimiter } from '@bslt/server-system/security';
import { getDetailedHealth } from '@bslt/server-system/runtime';
```

Root imports still exist for in-repo compatibility, but subpaths are the intended public surface.

## Exported Subpaths

- `@bslt/server-system/http`
  - route maps
  - Fastify route registration
  - route registry helpers
  - API versioning helpers
  - correlation-id hook
  - multipart parser hook
  - prototype-pollution-safe JSON parser hook
  - request-info hook
- `@bslt/server-system/routing`
  - compatibility alias for `@bslt/server-system/http`
- `@bslt/server-system/security`
  - JWT helpers
  - JWT rotation helpers
  - rate limiting
  - token utilities
  - upload/file-system security helpers
- `@bslt/server-system/cache`
  - in-memory and Redis-backed cache adapters
  - cache factories and config helpers
- `@bslt/server-system/logger`
  - structured logger creation
  - request/job logging helpers
  - development log formatting
  - Fastify request-logger plugin
- `@bslt/server-system/observability`
  - error tracking adapters
  - tracing helpers
  - metrics collector access
- `@bslt/server-system/runtime`
  - health aggregation helpers
  - startup summary helpers
  - port utilities
- `@bslt/server-system/errors`
  - canonical error-to-HTTP mapping helpers

## Scope Notes

- Database clients, repositories, schema validation, and queue stores live in `@bslt/db`.
- Business logic lives in `@bslt/core`.
- Shared contracts and common types live in `@bslt/shared`.
- `main/apps/server` remains the runtime composition root for Fastify plugins, middleware registration, and deployment-specific wiring.
