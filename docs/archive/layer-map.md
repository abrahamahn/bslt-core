# Layer Map

This map defines canonical ownership boundaries between shared contracts/helpers and server implementations.

The intent is clarity, not 1:1 folder symmetry.

## Rule

- `main/shared/src/*`: contracts, schemas, and environment-agnostic helpers.
- `main/server/*`: Node/server runtime implementations and integrations.
- A folder without a pair is valid when its responsibility is inherently one-sided.

## Current Mapping

| Shared Layer                              | Server Layer                       | Pairing Status    | Notes                                                                                       |
| ----------------------------------------- | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `shared/src/modules/system/http`          | `server/system/src/http`           | paired            | Shared HTTP contracts/helpers + server HTTP orchestration/route registration.               |
| `shared/src/modules/system/cache`         | `server/system/src/cache`          | paired            | Shared cache contracts/helpers + server cache providers/factory.                            |
| `shared/src/modules/system/security`      | `server/system/src/security`       | paired            | Shared security primitives + server security middleware/adapters.                           |
| `shared/src/modules/system/observability` | `server/system/src/observability`  | partial pair      | Shared runtime-agnostic observability types/metrics + server provider integrations/tracing. |
| `shared/src/modules/core/*`               | `server/core/*`                    | paired            | Business-domain schemas/contracts and server core logic align by capability.                |
| `shared/src/modules/db/*`                 | `server/db/*`                      | paired            | Shared DB contracts/primitives + concrete repositories/providers.                           |
| `shared/src/modules/comms/*`              | `server/comms/*`                   | paired            | Shared comms contracts/schemas + comms runtime adapters.                                    |
| `shared/src/modules/realtime/*`           | `server/realtime/*`                | paired            | Shared realtime contracts + realtime runtime handlers/adapters.                             |
| `shared/src/modules/media/*`              | `server/media/*`                   | paired            | Shared media contracts + media processing/runtime integrations.                             |
| `shared/src/modules/storage/*`            | `server/storage/*`                 | paired            | Shared storage/file contracts + storage runtime integrations.                               |
| `shared/src/contracts/contract.native.ts` | `server/system/*` and app runtimes | N/A (intentional) | Native bridge contract is shared; implementations are runtime-specific.                     |
| `shared/src/contracts/contract.ports.ts`  | `server/*` packages                | N/A (intentional) | Port contracts are shared interfaces with distributed implementations.                      |

## Canonical Imports

- Use `@bslt/shared/contracts` for native and ports contracts.
- Use `@bslt/server-system/runtime` for system runtime helpers.
- Use `@bslt/server-system/observability` for observability adapters.
- Use `@bslt/storage` for storage adapters.

## Deprecated Imports

- `@bslt/server-system/system`
- `@bslt/server-system/storage`
- `@bslt/server-system/adapters/observability`
- `@bslt/server-system/adapters/storage`
- `@bslt/shared/system/native`
- `@bslt/shared/system/ports`

ESLint enforces these deprecated import paths as restricted.
