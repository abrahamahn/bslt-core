# @bslt/shared

Runtime-agnostic shared package for contracts, schemas, constants, and pure logic used by server and client packages.

## Canonical Structure

```text
main/shared/src/
├── api/         # API router types and route composition contracts
├── config/      # env schema/types (no runtime env loading)
├── constants/   # primitive constants (no shared imports)
├── contracts/   # contract.*.ts endpoint contracts and interfaces
├── helpers/     # primitive helpers (no shared imports)
├── modules/     # capability mirrors of main/server/*
│   ├── system/
│   ├── core/
│   ├── db/
│   ├── comms/
│   ├── realtime/
│   ├── media/
│   ├── storage/
│   └── workers/
├── schema/      # primitive schema utilities (no shared imports)
└── index.ts     # root barrel (allowed export *)
```

## Mirror Contract

`main/shared/src/modules/*` mirrors `main/server/*` capability roots:

- `modules/system` ↔ `server/system`
- `modules/core` ↔ `server/core`
- `modules/db` ↔ `server/db`
- `modules/comms` ↔ `server/comms`
- `modules/realtime` ↔ `server/realtime`
- `modules/media` ↔ `server/media`
- `modules/workers` ↔ `server/workers`

## Barrel Export Rules

- Every directory under `main/shared/src/**` must have `index.ts`.
- `index.ts` files must export explicit named symbols from one-level siblings only (`./<file>` or `./<folder>`).
- Non-`index.ts` re-exports are not allowed.
- Exception: `main/shared/src/index.ts` may use `export *` as the package root barrel.

## Import Boundary Rules (high-level)

- Primitive roots (`constants`, `helpers`, `schema`) do not import from shared paths.
- Module roots import from primitive roots (with temporary migration exceptions tracked in ESLint rules).
- `contracts` may import from primitive roots + modules.
- `config` is schema/contracts only and stays runtime-agnostic.

## Package Imports

```ts
import { ... } from '@bslt/shared';
import { ... } from '@bslt/shared/constants';
import { ... } from '@bslt/shared/helpers';
import { ... } from '@bslt/shared/schema';
import { ... } from '@bslt/shared/config';
import { ... } from '@bslt/shared/contracts';

import { ... } from '@bslt/shared/system';
import { ... } from '@bslt/shared/core';
import { ... } from '@bslt/shared/db';
import { ... } from '@bslt/shared/comms';
import { ... } from '@bslt/shared/realtime';
import { ... } from '@bslt/shared/media';
```

## Notes

- Keep this package free of Node/Fastify runtime concerns.
- Runtime env loading and process orchestration belong to `main/apps/server/src/config` and app bootstrap layers.
