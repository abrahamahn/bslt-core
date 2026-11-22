# Security

## Password Hashing

BSLT uses **Argon2id** (OWASP recommended) for password hashing. Hashes are computed with
`node:crypto` `argon2` (Node 24.7 or later; the server image fails its build without it) and stored
as PHC strings, `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>`, the format the argon2
npm package wrote before Phase 12, so every existing hash still verifies. Only Argon2 version 19
(0x13) is accepted.

### Configuration

Default parameters match OWASP guidelines (`main/server/core/src/auth/utils/password.ts`):

| Parameter   | Value               | Purpose                                                                |
| ----------- | ------------------- | ---------------------------------------------------------------------- |
| Algorithm   | Argon2id (type 2)   | Hybrid of Argon2i + Argon2d, resistant to side-channel and GPU attacks |
| Memory cost | 19,456 KiB (19 MiB) | Increases GPU attack cost                                              |
| Time cost   | 2 iterations        | Balances security vs. login latency                                    |
| Parallelism | 1                   | Single-threaded hash computation                                       |

### Password Flow

1. **Registration**: Password is validated for strength (entropy-based scoring, min score 3/4), then hashed with Argon2id
2. **Login**: Password is verified against stored hash using constant-time comparison
3. **Rehashing**: On login, if Argon2 parameters have changed, the hash is transparently upgraded
4. **Timing safety**: A pool of pre-computed dummy hashes prevents timing attacks when user does not exist (`verifyPasswordSafe`)

### Password Strength

Passwords are validated using the shared auth password utilities (`main/server/core/src/auth/utils/password.ts`):

- Minimum length: 8 characters
- Maximum length: 64 characters
- Minimum score: 3 (Strong) on a 0-4 scale
- Penalizes user-specific words (email, name)
- Returns crack time estimates and improvement suggestions

## JWT Access Tokens

Short-lived access tokens carry user identity and role.

| Property       | Value                                              |
| -------------- | -------------------------------------------------- |
| Algorithm      | HS256 (HMAC-SHA256)                                |
| Default expiry | 15 minutes                                         |
| Payload        | `userId`, `email`, `role`, optional `tokenVersion` |
| Secret minimum | 32 characters                                      |

Tokens are created via `createAccessToken()` and verified via `verifyToken()` in `main/server/core/src/auth/utils/jwt.ts`.

### Secret Rotation Guidelines

For all production secret classes (JWT, API keys, OAuth client secrets), rotate using a dual-window strategy:

1. Add the new secret while keeping the previous secret available for verification.
2. Start signing new tokens/keys with the new secret immediately.
3. Keep the old secret only for verification during a bounded grace window.
4. Remove the old secret after access/refresh token max lifetime + rollback buffer.

Required operational rules:

- Never rotate multiple secret classes in the same deploy.
- Always rotate with an auditable change record (date, owner, reason, rollback plan).
- Verify `/health` and auth flows after each rotation.
- Prefer environment-driven secret injection; never hardcode secrets in source or committed files.

BSLT-specific references:

- JWT dual-secret verification: `main/server/system/src/security/jwt.rotation.ts`
- Auth token config wiring: `main/apps/server/src/config/`
- Webhook and provider secrets: `main/apps/server/src/config/services/`

## Refresh Token Families

Refresh tokens use **family-based rotation** with reuse detection (`main/server/core/src/auth/utils/refresh-token.ts`).

### How It Works

1. **Login** creates a new token family with a cryptographically random refresh token (64 bytes / 512 bits)
2. **Refresh** rotates the token: old token is deleted, new token is created in the same family
3. **Reuse detection**: If a rotated-out token is used again outside the grace period (30s), the entire family is revoked
4. **Session binding**: User-Agent is checked on refresh; a mismatch revokes the family (session hijacking defense)

### Token Reuse Attack Response

When reuse is detected:

1. Security event is logged to the audit trail
2. Entire token family is revoked (all tokens in the family)
3. User session is invalidated
4. `TokenReuseError` is thrown

### Max Concurrent Sessions

Configurable per deployment (default: 10). When the limit is reached, the oldest session family is evicted on new login.

## Cookie Security

Refresh tokens are stored in HTTP-only cookies (`main/server/core/src/auth/utils/cookies.ts`).

| Setting    | Development | Production |
| ---------- | ----------- | ---------- |
| `httpOnly` | true        | true       |
| `secure`   | false       | true       |
| `sameSite` | lax         | strict     |
| `path`     | /           | /          |
| `signed`   | true        | true       |

Cookie secret is injected via environment configuration and used for both signing and CSRF token encryption.

## Rate Limiting

### Global Rate Limiter

Applied to all requests in the server HTTP composition layer (`main/apps/server/src/bootstrap/app.ts`). Returns standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`).

### Auth Endpoint Presets

Stricter per-endpoint limits defined in `main/server/core/src/auth/security/rateLimitPresets.ts`:

| Endpoint            | Max Requests | Window   |
| ------------------- | ------------ | -------- |
| Login               | 5            | 1 minute |
| Register            | 3            | 1 hour   |
| Forgot password     | 3            | 1 hour   |
| Reset password      | 5            | 1 hour   |
| Verify email        | 5            | 1 hour   |
| Resend verification | 3            | 1 hour   |
| Token refresh       | 30           | 1 minute |
| OAuth initiate      | 10           | 1 minute |
| OAuth callback      | 20           | 1 minute |
| OAuth link/unlink   | 5            | 1 hour   |

All auth rate limiters use progressive delay with exponential backoff (1s base, 30s max, 2x factor).

## CSRF Protection

Uses the double-submit cookie pattern with signed tokens (`main/apps/server/src/middleware/csrf.ts`):

- **Development**: HMAC-signed tokens in signed cookies (`sameSite: lax`)
- **Production**: AES-256-GCM encrypted tokens in signed cookies (`sameSite: strict`)
- Safe methods (GET, HEAD, OPTIONS) are exempt
- Select endpoints with one-time token protection are also exempt

## CORS

Explicit CORS handling replaces `@fastify/cors` (`main/apps/server/src/middleware/security.ts`):

- Origin validated against configured allow list (supports comma-separated origins)
- Credentials require exact origin match (no wildcard)
- Preflight responses cached for 24 hours
- Default allowed methods: GET, POST, PUT, DELETE, OPTIONS, PATCH

## Security Headers

Explicit headers replace `@fastify/helmet`:

| Header                      | Value                                    | Purpose                           |
| --------------------------- | ---------------------------------------- | --------------------------------- |
| `X-Frame-Options`           | DENY                                     | Prevent clickjacking              |
| `X-Content-Type-Options`    | nosniff                                  | Prevent MIME sniffing             |
| `X-XSS-Protection`          | 1; mode=block                            | XSS protection for older browsers |
| `Strict-Transport-Security` | max-age=31536000                         | Enforce HTTPS (1 year)            |
| `Referrer-Policy`           | strict-origin-when-cross-origin          | Control referrer leakage          |
| `Permissions-Policy`        | geolocation=(), microphone=(), camera=() | Restrict browser APIs             |
| `Content-Security-Policy`   | (production only)                        | Restrict resource loading         |

Production enables CSP with `getProductionSecurityDefaults()`. API routes also get `Cache-Control: no-store` to prevent back-button data leaks after logout.

### Content-Security-Policy: scripts live in files, never inline

The policy is defined once, as data, in `main/shared/src/modules/system/security/csp.ts`. Two layers send it: the Caddy edge proxy (`EDGE_CSP` — this is the CSP the browser applies to the SPA) and the API (`API_CSP`, via `getProductionSecurityDefaults()`).

**`script-src` is `'self'`. There is no `'unsafe-inline'`, and none may be added.**

An inline `<script>` in `main/apps/web/index.html` is blocked **in production only**. Dev serves no CSP header, so it works perfectly on your machine, survives review, and then silently does nothing for every real user. A pre-paint theme resolver is the classic case — it is exactly the kind of script people reach for, and exactly the kind whose failure is hard to spot.

Put the script in a file under `main/apps/web/public/` and load it with `<script src="/theme-init.js">`. Do **not** "fix" a blocked script by adding `'unsafe-inline'`: that directive is the whole reason the header is worth sending, and turning it on re-opens every injected-script XSS the policy exists to stop.

An inline `<style>` is fine — `style-src` deliberately carries `'unsafe-inline'` for the critical anti-flash CSS in `index.html`. Styles cannot execute; scripts can.

Three guards keep this from decaying into folklore, all of them in `pnpm bslt gate merge`:

| Guard                                                             | Fails when                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `main/apps/web/src/index-html.test.ts`                            | an inline `<script>` reaches `index.html`               |
| `pnpm bslt gate run csp` (`main/tools/scripts/audit/csp-sync.ts`) | the Caddyfile's CSP is not byte-identical to `EDGE_CSP` |
| `main/shared/.../security/csp.test.ts`                            | `script-src` gains `'unsafe-inline'` or `'unsafe-eval'` |

A Caddyfile is not TypeScript and cannot import the constant, so its copy of the header is _checked_ rather than trusted. To change the policy: edit `EDGE_CSP_DIRECTIVES` in `csp.ts`, then paste the serialized `EDGE_CSP` into `infra/runtime/caddy/Caddyfile`. `pnpm bslt gate run csp` prints both strings on a mismatch.

## Account Lockout

Progressive lockout with exponential backoff (`main/server/core/src/auth/security/lockout.ts`):

1. Failed attempts are tracked per email within a configurable window
2. After exceeding `maxAttempts`, the account is locked for `lockoutDurationMs`
3. Progressive delay applies exponential backoff: `baseDelay * 2^(attempts - 1)`, capped at max delay
4. Admin unlock is supported with full audit trail logging
5. Lockout status includes remaining time and attempt count

## Prototype Pollution Protection

All incoming JSON request bodies are sanitized by `registerPrototypePollutionProtection()` which strips `__proto__`, `constructor`, and `prototype` keys recursively.

## Input Validation & Sanitization

The validation middleware (`main/apps/server/src/middleware/validation.ts`) provides:

- XSS prevention: strips `<script>` blocks, event handlers, `javascript:` schemes
- SQL injection detection (pattern-based, context-aware)
- NoSQL injection detection (MongoDB operator detection)
- Max depth/array length/string length enforcement
- Prototype pollution key filtering

The injection heuristics refuse a request with 400 `VALIDATION_ERROR`. One route's body is exempt
from them, by its own route option and never by URL match: `POST /api/platform/errors` (owner
decision, 2026-11-16). Minified stack traces and error messages contain `--` (Rollup chunk names),
`/*`, `select ... from` and `$operator` tokens, so the filter refused ordinary crash reports. The
route keeps its strict batch schema, its 8 KiB body limit and its rate limits, its body is still
sanitized and its query string still checked, and the reports only ever reach the log.

The exemption is `withRouteOptions(route, { skipBodyInjectionFilter: true })` on a route map entry
(`main/kernel/server/src/http/routing.ts`). `registerRouteMap` hands it to Fastify as route
`config`, and `validation.ts` skips only the body's injection check where it is set. Give it to
another route only by owner decision, for a body that is free text checked by a strict schema and
never used in a query.

## New Login Alerts

On each successful login, the system:

1. Generates a device fingerprint from IP + User-Agent
2. Checks if the device is known (via `trusted_devices` table)
3. Records device access (upsert)
4. Sends a "Was this you?" email alert (fire-and-forget)
