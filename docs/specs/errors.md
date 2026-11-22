# Error Architecture Spec

**Status:** Canonical (`foundation-v1`)  
**Scope:** Shared semantic error contracts (`@bslt/contract`) and server-side HTTP/error presentation (`@bslt/server-system/errors`)

## Purpose

Define a small, durable error architecture for the BSLT platform foundation.

This spec describes the `@bslt/contract` (`main/kernel/contract/src/errors.ts`)
and `@bslt/server-system` (`main/kernel/server/src/errors/*`) split across kernel
and vertical modules (`defineErrors('<module>', ...)`).

The target is to keep error handling:

- semantic rather than framework-specific
- small enough to maintain from the bottom up
- explicit at module boundaries
- stable across server, workers, tests, and clients

## Design Goals

1. Keep the core error model framework-agnostic.
2. Separate error meaning from HTTP transport behavior.
3. Make shared errors contract-first, not implementation-first.
4. Keep unknown failures safe by default.
5. Keep the public API small and boring.

## Non-Goals

- modeling every business/domain error in the shared system layer
- storing framework-specific request/reply logic in shared errors
- encoding provider-specific behavior in the common error taxonomy
- making all errors subclass-based when a typed payload is simpler
- forcing shared code to own server-only stack/capture behavior

## Boundary Rule

The boundary is strict:

- `main/kernel/contract` (`@bslt/contract`) and `main/modules/<id>/contract/errors.ts` own semantic error definitions, codes, and wire-safe shapes
- `main/kernel/server/src/errors` (`@bslt/server-system`) owns runtime normalization, HTTP status mapping, and logging policy

The contract layer must not contain server-specific implementation details.
The server kernel package must not become a catch-all for domain-specific error definitions.

## Contract Responsibilities

### `main/kernel/contract/src/errors.ts` & `main/modules/<id>/contract/errors.ts`

Owns:

- error kinds
- module-prefixed error code catalogs (`defineErrors('<id>', { CODE: status })`)
- wire-safe payload shapes
- field/validation issue contracts
- type guards

Contracts are the portable wire surface.

Rules:

- contract exports must remain JSON-safe and transport-safe
- contract types should be boring and portable
- contracts must not depend on HTTP servers or Node-specific runtime behavior
- contracts must not own runtime error normalization

## Server Kernel Responsibilities

### `main/kernel/server/src/errors`

Owns:

- `AppError` and subclasses
- normalization of thrown values into app errors
- mapping error kinds to HTTP status codes
- converting errors to API responses
- logging policy by severity
- correlation-id attachment at the boundary

Rules:

- server-side errors should be the executable implementation of the shared contract
- server may adapt shared error contracts into runtime behavior
- server should not define feature/domain-specific error taxonomies

## Core Shared Contract

The shared system error model should define a small set of stable primitives.

### Error Kind

```ts
export const ERROR_KINDS = [
  'validation',
  'authentication',
  'authorization',
  'not_found',
  'conflict',
  'rate_limit',
  'external_dependency',
  'timeout',
  'unavailable',
  'internal',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];
```

Guidelines:

- keep kinds coarse and transport-relevant
- do not add kinds for every business concept
- prefer `code` for domain-specific meaning

### Error Code

Error codes should remain stable programmatic identifiers.

Rules:

- `code` is the machine-readable identifier used by clients and logs
- `kind` is the coarse category used for transport and severity
- do not rely on `code` alone for HTTP semantics
- use `kind` for response class, `code` for exact business meaning

This is intentionally different from a design where `code` is the only key.
The current `system.*` codes are acceptable as baseline shared codes, but they
should not block feature modules from using more specific codes later.

### Field Error Contracts

```ts
export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationIssue {
  path: ReadonlyArray<string | number>;
  message: string;
  code: string;
}
```

Rules:

- field errors should remain plain data
- validation adapters may translate native validator shapes into these contracts
- do not bind the shared contract to one validation library

### Wire Format

```ts
export interface ErrorWire {
  code: string;
  kind: ErrorKind;
  message: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}
```

Rules:

- the wire format must be safe for clients and logs
- `cause` never goes on the wire
- internal-only metadata never goes on the wire
- `details` must contain only public-safe data
- `message` should be derived from `publicMessage` when available

Recommended generic fallback message:

- `"Internal server error"`

This spec intentionally does not define `publicDetails`.
If data is not safe for clients, it must stay in internal metadata, not in
`details`.

## Server Error Model

The server-side implementation should define one base semantic error type:

```ts
export interface AppErrorInit {
  code: string;
  kind: ErrorKind;
  message: string;
  publicMessage?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
  metadata?: Record<string, unknown>;
}
```

### AppError

`AppError` is the base runtime error class used by server code.

Required fields:

- `code: string`
- `kind: ErrorKind`
- `message: string`

Recommended optional fields:

- `publicMessage?: string`
- `details?: Record<string, unknown>`
- `cause?: unknown`
- `retryable?: boolean`
- `retryAfterMs?: number`
- `metadata?: Record<string, unknown>`

Rules:

- `message` is internal and developer-facing by default
- `publicMessage` is the client-safe message when one should be exposed directly
- `details` must be public-safe and safe to serialize
- `metadata` is internal-only
- `retryable` should default to `true` except for validation-style failures

## Standard Runtime Error Classes

The server runtime should expose a small set of standard semantic errors:

- `ValidationError`
- `AuthenticationError`
- `ForbiddenError`
- `NotFoundError`
- `ConflictError`
- `TooManyRequestsError`
- `ExternalDependencyError`
- `TimeoutError`
- `UnavailableError`
- `InternalError`

Rules:

- these should be thin convenience wrappers
- avoid custom behavior in each subclass unless it materially improves reuse
- prefer plain `AppError` for feature-specific error cases
- do not keep alias classes once a canonical name exists

Current server convention:

- `AuthenticationError` for 401
- `ForbiddenError` for 403
- `TooManyRequestsError` for 429
- `UnavailableError` for 503
- `InternalError` for 500

### ValidationError

Validation errors should support both:

- `FieldError[]`
- `Record<string, string[]>`

Rules:

- validation errors should remain easy to construct from form and schema adapters
- validation errors should be non-retryable
- validation errors should expose field-level details in a public-safe shape

## Logging Policy

Logging belongs in `main/kernel/server/src/errors`, not in contracts.

Default policy:

- `validation`, `authentication`, `authorization`, `not_found`, `conflict` -> `info` or `warn`
- `rate_limit` -> `warn`
- `external_dependency`, `timeout`, `unavailable`, `internal` -> `error`

Rules:

- logs may include original `cause`
- client wire payloads must not include original `cause`
- correlation/request identifiers should be attached at the server boundary
- logger signatures should be consistent enough to avoid adapter churn

## HTTP Mapping

`main/kernel/server/src/errors` owns HTTP mapping only.

Default mapping:

- `validation` -> `400`
- `authentication` -> `401`
- `authorization` -> `403`
- `not_found` -> `404`
- `conflict` -> `409`
- `rate_limit` -> `429`
- `external_dependency` -> `502`
- `timeout` -> `504`
- `unavailable` -> `503`
- `internal` -> `500`

Recommended server adapter:

```ts
interface ToHttpErrorOptions {
  correlationId?: string;
  isProduction?: boolean;
}

interface HttpErrorResponse {
  status: number;
  wire: ErrorWire;
  retryAfter?: number;
}
```

Rules:

- `retryAfter` should come from `retryAfterMs` when present
- only rate-limit, timeout, and unavailable-style errors should normally set `retryAfterMs`
- server transport may convert `retryAfterMs` into response metadata and/or headers

## Normalization

The server module should expose one normalization path for thrown values:

- `normalizeUnknownError(error: unknown): AppError`

Rules:

- existing `AppError` instances pass through
- `Error` values normalize into `InternalError` by default unless explicitly adapted
- non-`Error` throwables normalize into `InternalError`
- normalization must never throw

The server boundary should also expose:

- `isAppError(value: unknown): value is AppError`

## Domain Translation Rule

Feature and infra modules should translate local failures into shared semantic
errors before crossing a boundary.

Examples:

- auth/provider failures -> `AuthenticationError` or `ExternalDependencyError`
- repository missing row -> `NotFoundError`
- duplicate resource -> `ConflictError`
- invalid request body/params -> `ValidationError`

Rules:

- translate close to the failing dependency
- do not let the server error mapper become a giant registry of module-specific string matching
- local adapters may define their own `toAppError()` helpers

## Package Boundaries

### Allowed in `shared/system/errors`

- plain TypeScript types
- plain contracts
- wire payload definitions

### Not Allowed in `@bslt/contract`

- HTTP server request/reply types
- logging implementation details
- framework hooks
- Node-only stack capture behavior
- runtime error normalization

### Allowed in `server/system/errors`

- HTTP status mapping
- response shaping
- logging policy
- server-only metadata attachment
- runtime error subclasses

### Not Allowed in `server/system/errors`

- business/domain-specific error registries
- feature-specific string matching as a long-term pattern
- transport ownership beyond shaping server responses

## Implementation Notes

The current implementation already points in the right direction:

- shared defines the semantic taxonomy and wire contract
- server handles runtime presentation and logging
- `kind` drives status and severity
- `code` stays available for client and feature-level semantics

The following concerns were raised during review and should be treated as
deliberate design items, not accidental omissions:

1. Shared should stay contract-only.
2. Logger signatures should be normalized.
3. Validation error construction should stay concise.
4. Feature modules should not encode transport behavior directly.

## Future Refinements

These are reasonable kernel-level extensions, but they should be introduced only
if there is a clear need.

### 1. i18n Readiness

If the product needs multi-language error display, consider adding:

- `i18nKey?: string`
- `i18nArgs?: Record<string, unknown>`

Rule:

- do not localize in the core error class unless localization is truly global
- keep the server wire contract compatible with translation-on-client or translation-on-server strategies

### 2. Error Instance ID

If support/debug workflows need per-instance lookup, consider adding:

- `errorId?: string`

Rule:

- `correlationId` identifies the request
- `errorId` would identify the specific error instance
- only add this if it materially improves operational workflows

### 3. Cause Serialization

If logs need richer nested cause chains, consider a server-only helper that
serializes `cause` safely for log sinks.

Rule:

- do not leak serialized causes into the client wire payload

### 4. Validation Adapters

Validation boundaries parse inputs with the owned `@bslt/schema` library (`Schema<T>` / Standard Schema v1) and adapt validation issues near the boundary.

Rule:

- keep the shared contract stable
- adapt validator-native errors into `FieldError[]` or `ValidationIssue[]`

## File Layout

### `main/kernel/contract/src` & `main/modules/<id>/contract`

- `main/kernel/contract/src/errors.ts` (`defineErrors`, `lookupErrorCode`)
- `main/modules/<id>/contract/errors.ts` (domain error codes)

### `main/kernel/server/src/errors`

- `errors.ts`
- `types.ts`
- `index.ts`

## Migration Rules

1. Keep the shared semantic model small and stable.
2. Keep server-side HTTP mapping as a thin adapter.
3. Migrate feature modules to throw semantic shared errors directly.
4. Add compatibility exports only where migration pressure justifies them.
5. Remove legacy aliases and adapter code after call sites are simplified.

## Examples

### Invalid Request Body

```ts
throw new ValidationError('Body validation failed', {
  email: ['Email is required'],
});
```

### Missing Tenant

```ts
throw new AppError({
  code: 'tenant.not_found',
  kind: 'not_found',
  message: 'Tenant row missing in repository',
  publicMessage: 'Tenant not found',
});
```

### Billing Provider Timeout

```ts
throw new ExternalDependencyError('Stripe customer lookup timed out', 'billing.provider_timeout', {
  provider: 'stripe',
});
```

## Acceptance Criteria

The error architecture is considered complete when:

- shared errors are semantic and HTTP-free
- server/system errors are transport adapters only
- unknown thrown values normalize safely
- the shared public error surface is small and deliberate
- feature modules no longer depend on transport-specific error behavior
- new modules can follow the pattern without adding custom framework glue
