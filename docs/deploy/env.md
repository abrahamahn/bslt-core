# Environment Variables

This document explains every environment variable used by the server config. Use `config/env/.env.production.example` as the canonical template and copy it to `config/env/.env.development`, `config/env/.env.test`, or `config/env/.env.production`.

Notes:

- All values are strings in env files.
- Set only the switches you need; unused integrations can stay at their defaults.
- For production, generate strong secrets and keep them out of version control.

---

## Package Manager

Controls tooling behavior for scripts and CI.

- `PACKAGE_MANAGER_PROVIDER` — package manager to use.
- `NPM_AUDIT`, `NPM_LEGACY_PEER_DEPS`, `NPM_REGISTRY`
- `PNPM_STRICT_PEER_DEPS`, `PNPM_FROZEN_LOCKFILE`, `PNPM_REGISTRY`
- `YARN_AUDIT`, `YARN_FROZEN_LOCKFILE`, `YARN_REGISTRY`

---

## Application

Core runtime settings and URLs.

- `NODE_ENV` — environment: development/production/test.
- `APP_NAME` — server-side app display name for docs, email templates, TOTP fallback, and provider branding.
- `APP_PORT` — web app port.
- `API_PORT` — API server port.
- `PROCESS_ROLE` — which runtimes this server process runs (`api | realtime | worker | media-worker | all`; default `all`). `api` serves full HTTP endpoints without background workers or WebSockets; `realtime` runs the WebSocket gateway (draining open sockets with close code `1012` on `SIGTERM`) plus HTTP health/metrics probes; `worker` runs the `default` `QueueServer`, outbox dispatcher, and leader-elected cron plus HTTP probes; `media-worker` runs the `media` `QueueServer` plus HTTP probes; `all` runs every runtime in one process. Any unsupported role stops startup immediately.
- `INSTANCE_ID` — optional instance identifier attached to `bslt_http_request_duration_ms` histograms and `bslt_event_loop_lag_ms` gauges (falls back to `HOSTNAME` or `<hostname>:<pid>`).
- `APP_BASE_URL` — web app base URL.
- `API_BASE_URL` — public server base URL. For the bundled Caddy stack, use the same origin as `APP_URL`; API routes live under `/api/*`.
- `APP_URL` — public app URL (used by billing/email).
- `HOST` — server bind host (e.g., `0.0.0.0`).
- `PORT` — optional single-port override.
- `LOG_LEVEL` — logger level.
- `MAINTENANCE_MODE` — boolean maintenance toggle.

---

## CORS / Proxy

Controls proxy behavior and origin rules.

- `CORS_ORIGIN` — comma-separated list of allowed origins.
- `TRUST_PROXY` — whether to trust `x-forwarded-*` headers.
- `TRUSTED_PROXIES` — comma-separated CIDRs/IPs for trusted proxies.
- `MAX_PROXY_DEPTH` — max forwarded-for depth.

---

## Auth / Security

Authentication, tokens, and policies.

- `JWT_SECRET` — signing secret.
- `JWT_SECRET_PREVIOUS` — previous secret for rotation.
- `JWT_ISSUER`, `JWT_AUDIENCE`
- `ACCESS_TOKEN_EXPIRY` — e.g., `15m`.
- `REFRESH_TOKEN_EXPIRY_DAYS`
- `REFRESH_TOKEN_GRACE_PERIOD` — seconds.
- `COOKIE_SECRET` — cookie signing secret (defaults to JWT secret if blank).
- `OAUTH_TOKEN_ENCRYPTION_KEY` — dedicated AES-256-GCM key for stored OAuth tokens.
- `AUTH_STRATEGIES` — comma-separated list. Starter default is `local`; configure the advanced-auth providers before enabling values such as `magic`, `webauthn`, or OAuth providers.
- `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `PASSWORD_MIN_SCORE`
- `LOCKOUT_MAX_ATTEMPTS`, `LOCKOUT_DURATION_MS`
- `MAGIC_LINK_EXPIRY_MINUTES`, `MAGIC_LINK_MAX_ATTEMPTS`
- `TOTP_ISSUER`, `TOTP_WINDOW`

---

## Rate Limiting

HTTP rate limiting controls.

- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_CLEANUP_INTERVAL_MS`
- `RATE_LIMIT_PROGRESSIVE_DELAY_ENABLED`
- `RATE_LIMIT_BASE_DELAY_MS`
- `RATE_LIMIT_MAX_DELAY_MS`

---

## Provider Switches

Select which provider is active per subsystem.

- `DATABASE_PROVIDER` — `postgresql` for the starter runtime. Non-Postgres schemas in shared config are extension points and are not production-supported by default.
- `STORAGE_PROVIDER` — `local | s3`
- `QUEUE_PROVIDER` — `local | redis`
- `CACHE_PROVIDER` — `local | redis`
- `SEARCH_PROVIDER` — `sql`
- `EMAIL_PROVIDER` — `console | smtp`
- `BILLING_PROVIDER` — `stripe | paypal`
- `NOTIFICATIONS_PROVIDER` — `onesignal | courier`

---

## Database

Primary datastore configuration.

- `DATABASE_URL` — app-role connection string (`bslt_app`; takes precedence when applicable).
- `WORKER_DATABASE_URL` — worker-role connection string (`bslt_worker`). Required in production.
- `LISTEN_DATABASE_URL` — the worker role again, connected to the database server directly (never through PgBouncer): the one connection the pub/sub adapter holds for `LISTEN`. Required in production; outside production it falls back to `WORKER_DATABASE_URL`.
- `MIGRATION_DATABASE_URL` — owner-role connection string (`bslt_owner`), read only by the migration entry points. Required in production for `migrate`.
- `DATABASE_ADMIN_URL` — superuser connection for the role bootstrap only (default: the `POSTGRES_*` parts).
- `POSTGRES_CONNECTION_STRING`
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` — in production, the separate database server and its superuser ([two servers](./README.md#two-servers)). `POSTGRES_HOST` is required by the production app compose file, which runs no database: PgBouncer and `bootstrap-roles` connect to it.
- `DB_MAX_CONNECTIONS`
- `DB_STATEMENT_TIMEOUT_MS` (default `30000`), `DB_WORKER_STATEMENT_TIMEOUT_MS` (default `120000`), `DB_LOCK_TIMEOUT_MS` (default `10000`), `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` (default `60000`) — the limits Postgres enforces on the API's two pools, in milliseconds; `0` turns one off. See [statement and transaction timeouts](./production-postgres.md#statement-and-transaction-timeouts).
- A transaction that Postgres rolls back for a serialization failure or a deadlock is run again by the client, three attempts in all; there is no env key for it ([transaction retry](./production-postgres.md#transaction-retry)).
- `DB_SSL` — set `true` when the API connects to a managed or external Postgres directly; the production app compose file overrides this to `false` for its private API-to-PgBouncer hop unless you configure PgBouncer client TLS. The same switch covers the listener's direct connection to the database server ([SSL configuration](./production-postgres.md#ssl-configuration)).

The deployment path is PostgreSQL. Treat SQLite, MongoDB, and JSON database config code as fork-owned extension points; do not enable them for production without implementing the runtime adapter, migrations, backup strategy, and operational checks.

### Database roles

Row-Level Security never applies to a superuser or to a table's owner, so the
runtime must connect as neither. The role split:

| Role            | Login | Used by                                                                                                                               | RLS                                                                                      |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bslt_owner`    | yes   | `MIGRATION_DATABASE_URL`: migrations and reset (DDL)                                                                                  | owns every table; never a runtime role; member of `bslt_definer`                         |
| `bslt_app`      | yes   | `DATABASE_URL`: every request with a user, platform admins included, and a module's anonymous reads (`k.db.viewer(null)`, no user id) | NOSUPERUSER, NOBYPASSRLS; each session sets the role `authenticated` for its transaction |
| `bslt_worker`   | yes   | `WORKER_DATABASE_URL`: background and system work without a user session                                                              | NOBYPASSRLS; holds only what `bslt_system` is granted; not a member of `authenticated`   |
| `authenticated` | no    | policy target of every end-user and platform-admin policy                                                                             | per-table grants, set by the migrations                                                  |
| `bslt_system`   | no    | policy target for trusted system work                                                                                                 | per-table grants plus `system_access_policy` on each table it is granted                 |
| `bslt_definer`  | no    | policy target for `SECURITY DEFINER` helper functions                                                                                 | read-only `definer_read_policy` on the tables the helpers read (`memberships`, `users`)  |

Provision with `pnpm db:bootstrap:roles` (container: `node dist/src/bootstrap-roles.js`),
then migrate. The bootstrap is idempotent and safe on every deploy: it re-asserts
role attributes, revokes memberships that would let `bslt_app` escape RLS (and
the worker's former membership in `authenticated`), makes `bslt_owner` a member
of `bslt_definer`, removes every default privilege that names a runtime role,
and hands an existing database (and every object a superuser migrator created)
to `bslt_owner`. Each role's password is the password in the URL it logs in
with; only the SCRAM verifier is sent to Postgres. The bootstrap needs a
superuser admin connection. Managed Postgres without a real superuser needs the
roles created by its own admin tooling, including `bslt_definer` and
`GRANT bslt_definer TO bslt_owner`: the kernel baseline refuses to run for a
non-superuser migrator that is not a member and cannot make itself one.

Startup checks: in production the server refuses to start when `DATABASE_URL`
is a superuser, has BYPASSRLS, owns tables, or is a member of `bslt_system`, when
`WORKER_DATABASE_URL` is missing, a superuser, a table owner or not a member of
`bslt_system`, or when both URLs use the same role. Outside production the
legacy single-superuser setup only warns; user sessions still switch to
`authenticated`, so the policies apply inside sessions in every environment.

The pub/sub listener (Postgres `LISTEN`/`NOTIFY`) holds one connection of its
own, `LISTEN_DATABASE_URL`. It logs in as `bslt_worker` and points at Postgres
itself, not at PgBouncer: a `LISTEN` registration belongs to one server
connection, which transaction pooling hands to another client after every
transaction. The pools keep going through PgBouncer. Production config refuses
to start without `LISTEN_DATABASE_URL`, with one that is not a connection URL,
or with one whose user differs from the user of `WORKER_DATABASE_URL`. Outside
production an unset `LISTEN_DATABASE_URL` falls back to `WORKER_DATABASE_URL`
(and that to `DATABASE_URL`). Without a pooler in front of Postgres it is the
same URL as `WORKER_DATABASE_URL`.

Which connection each path uses:

- **User session (`bslt_app` → `authenticated`)** — every protected route after
  the auth guard's `contextualizeRequest` (`request.context.db/repos`), with
  `app.user_id`, `app.role` and the membership-verified `app.org_id`. This
  includes the realtime record API (`POST /api/realtime/write`,
  `/api/realtime/getRecords`). Services wired at boot (`write`, `search`,
  `queueStore`, notifications, email, billing) keep the worker handle even when
  a user request calls them: their authorization is application code, not RLS.
- **Platform admin** — a user session like any other: same pool, same role, its
  own `app.user_id`. What an admin reaches beyond its own rows comes from admin
  policies, which call `sys_current_user_is_platform_admin()`. That function
  reads `users.role` for the session user (not locked, not deactivated, not
  deleted) on every statement, so a demotion takes effect at once. No policy
  reads `app.role`: it is a JWT claim that outlives a demotion until the access
  token expires. A table has admin policies only for the commands an admin
  route needs; an admin flow that works through the system port instead (the
  notification broadcast) first asks the database whether the session is a
  platform admin.
- **Worker (`bslt_worker`)** — everything that runs without a user session:
  register, login, refresh, logout, password reset, email verification and
  email change confirm/revert, magic-link/OTP, TOTP/SMS/passkey sign-in, OAuth
  callbacks; the auth guard itself (JWT liveness, API-key lookup) and the ToS
  gate (the tenant-membership check runs inside the user session, where the
  caller's own membership row is visible); billing provider webhooks; public legal,
  status, support-form and VAPID routes; services wired at boot from the root
  context (notifications, email, billing); the WebSocket session
  verifier and `sync_request` version replay; job queue, cron scheduler, retention and
  data-hygiene sweeps, data-export cleanup; admin user search; LISTEN/NOTIFY
  pub/sub; `db:seed`, `db:bootstrap:admin`, `bslt db backfill-totp`. The worker
  cannot act for a user: a session with a user id on this pool fails closed.
- **System port (`ctx.system.db` / `ctx.system.repos`)** — the worker handles,
  named explicitly inside a protected request. For the few user-session flows
  that must reach beyond the caller's own rows, or write a record that is a
  system fact rather than user data. Each use bypasses the caller's RLS scope on
  purpose, so the list is short and greppable (`ctx.system.`):
  - admin alerts raised by a user's own account event (password change,
    deactivation, deletion request, reactivation), which read every admin and
    write a notification for each;
  - lookups of other users' rows, read-only: the username uniqueness checks
    (username change, onboarding, profile update), the email-change address
    check, and the tenant member list and add-member existence check (users by
    id);
  - the workspace slug uniqueness check on workspace creation (tenants by slug,
    read-only: a session sees only the tenants it belongs to or owns);
  - system records: the email-change token and the admin-issued password-reset
    token (`auth_tokens` is closed to every session), and the security and
    impersonation audit records of an OAuth unlink, impersonation start/end, and
    admin force-logout, hard ban or deletion (`audit_log` is append-only and
    written by the system role only);
  - audit log and activity projection (`@bslt/audit`): the `audit.log` and
    `audit.feed` outbox subscribers write idempotent `audit_log` and
    `audit_activity` rows via `k.db.system`, and `audit.activityRetention`
    purges expired activity rows; a session only reads them;
  - webhook dispatch (`@bslt/webhooks`): the `webhooks.fanout` subscriber reads
    the org's active endpoints and writes idempotent delivery rows via
    `k.db.system`, `webhooks.deliver` updates delivery outcomes, and org/admin
    replays enqueue delivery jobs after authorizing on the caller's session;
  - billing writes of a user's own flow (checkout's customer mapping, cancel,
    resume, plan change, adding, removing and defaulting a payment method):
    `getBillingWriteRepos`, after the provider call, on rows the session has
    read and the code has checked are the caller's (the provider mirrors are
    read-only to a session);
  - notifications: the self-notifications of billing flows and of a sent
    invitation, the test notification (`createInAppNotification`), and the admin
    broadcast, which also reads its recipients' preferences and push
    subscriptions through the port once `sys_current_user_is_platform_admin()`
    has vouched for the caller;
  - the push endpoint uniqueness check (push subscriptions by endpoint, read-only).
- **Owner (`bslt_owner`)** — `db:migrate`, `db:reset` (dev only), the image's
  migrate entry (`node node_modules/@bslt/db/dist/migrate/entry.js`).

#### Classifying a table

Every table in `public` has exactly one row-level security class, recorded as
`COMMENT ON TABLE <table> IS 'rls:<class>'` (set by the baseline of its owner):

| Class         | A user session may                                                        | Examples                                         |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| `owner_user`  | the listed commands on rows whose owner column is itself                  | `notifications`, `tasks`, `subscriptions` (read) |
| `owner_org`   | the listed commands on rows of a tenant it belongs to (the row's tenant)  | `usage_snapshots`, `webhooks`                    |
| `public_read` | read every row; only platform admins write                                | `plans`, `legal_documents`, `flags`              |
| `append_only` | insert and read rows about itself; nobody updates or deletes on a session | `audit_events`, `consent_records`, `events`      |
| `system`      | nothing; platform admins only where an admin route needs it               | `sys_jobs`, `billing_events`, `auth_tokens`      |
| `custom`      | what the migration's hand-written policies allow                          | `users`, `memberships`, `files`, `activities`    |
| `internal`    | nothing, and no runtime role is granted anything (`sys_migrations` only)  | `sys_migrations`                                 |

A new table has no runtime grants: there are no default privileges for any
runtime role. The file that creates it must classify it with
`SELECT sys_apply_rls('<table>', '<class>', '<owner column>', <user commands>, <admin commands>, <system commands>)`
(defined in the kernel baseline, `main/server/db/sql/0001_sys.sql`), which
drops every earlier policy on the table, enables and
forces RLS, grants exactly the listed commands (user and admin commands to
`authenticated`, system commands to `bslt_system`), creates one policy per
command (`rls_user_<cmd>`, `rls_admin_<cmd>`, admin ones through
`sys_current_user_is_platform_admin()`) and, when system commands are listed,
the `system_access_policy`, and writes the class comment. For `custom` the
migration then writes the user policies itself. A list that is left out is the
list of the class (`SELECT sys_apply_rls('<table>', 'owner_user', '<owner column>')`
gives users all four commands and the system role none; `system` gives the
system role all four); an explicit list, empty included, replaces it. To choose
the lists:

- user commands: what the user-session flows run on the table, no more;
- admin commands: only what an admin HTTP route needs on other users' rows;
- system commands: what sessionless code needs (public routes, provider
  webhooks, jobs, cron, retention) and what flows write through the system
  port; when in doubt include the command, since a missing system grant is an
  outage the denial tests do not catch;
- a record that is a system fact (audit, activity, delivery, notification)
  gets no user INSERT: the application writes it through the system port;
- a column the owner must never re-point (a tenant or owner column of a row
  that stays updatable) needs a column-level UPDATE grant after the call.

A table whose rows carry an audience rating opts into the backstop after the
class: `SELECT sys_apply_audience('<table>', '<smallint column>', '<owner column>')`
adds one restrictive policy, for every role: a row is visible to its owner, and
to anyone else only when it is rated and the rating is at most the session's
`app.max_audience` (`sys_max_audience()`, 0 when unset). An unrated row is
invisible to everyone but its owner. What a number means is the fork's
business.

Policies call `sys_current_user_id()`, `sys_current_user_is_org_member()` and
`orgs_current_user_role()`, never `current_setting(...)` and never
`app.role` or the org the request names (`sys_current_org_id()`). Without a class neither the app role
nor the worker can reach the table, and `pnpm bslt db catalog` refuses to write
the catalog. `pnpm db:audit` reads the committed catalog (the `db-audit` gate of
the merge lane; with `--db` also the connected database) and fails for a table
that is unclassified, not forced, or not equal to the template of its class; so
do the generated `tests/integration/database/generated/rls.real-db.test.ts`, per
table, and `tests/integration/api/rls-structure.real-db.test.ts`, which also
checks that no runtime role holds a privilege its class and policies do not
allow. An `owner_user` or `owner_org` table also needs a `describeOwnerIsolation`
case ([The database catalog](../dev/workflow.md#the-database-catalog)).

Operational notes:

- Secrets: the superuser password and the three role passwords are four
  independent secrets, none derived from another. The running API container
  receives only `DATABASE_URL`, `WORKER_DATABASE_URL` and `LISTEN_DATABASE_URL`
  (the worker's credentials again, at the database server). Of the application
  jobs, only `bootstrap-roles` gets the superuser credentials (`POSTGRES_*` or
  `DATABASE_ADMIN_URL`); the `pgbouncer` container on the app server also holds
  `POSTGRES_PASSWORD` (it looks role passwords up as the superuser), and so
  does the database server's own env file. `MIGRATION_DATABASE_URL` goes only
  to `bootstrap-roles` and `migrate`.
- Role passwords are written into their URLs as they are: generate each with
  `openssl rand -hex 32`, which needs no encoding, or percent-encode. The
  bootstrap applies the passwords from the URLs on every run, so changing one
  URL and redeploying rotates that role.
- The two database jobs are one-shot services of the production app Compose
  file (profile `ops`, so a plain `up` never starts them). They run on the app
  server and connect to the database server directly, not through PgBouncer.
  Run them on every deploy,
  stopping at the first failure so the API is not started after a failed job:
  `docker compose ... run --rm bootstrap-roles && docker compose ... run --rm migrate && docker compose ... up -d`.
  The deploy workflow and the demo deploy scripts do the same; see
  [migrations.md](./migrations.md#production).
- Backups: `pg_dump` needs the superuser or a `BYPASSRLS` role and must keep
  privileges in the dump; see
  [backup-restore.md](./backup-restore.md#which-role-takes-the-backup).
- Deploy order is `bootstrap-roles`, then `migrate`, then start the API.
  `migrate` refuses to run in production without `MIGRATION_DATABASE_URL`.
- The API opens two pools (app and worker) plus one LISTEN connection, and
  `DB_MAX_CONNECTIONS` applies to each pool.
- Every table but `sys_migrations` is under `FORCE ROW LEVEL SECURITY`, so it
  binds even its owner. A data migration that must touch their rows has to switch
  FORCE off and on again inside its own transaction. Running as `bslt_owner`,
  it otherwise sees no rows at all (or, where a `definer_read_policy` exists,
  can read but not write).
- Partitions of `analytics_events` have no grants and no policies of their own. Read and
  write through `analytics_events`, whose policies apply. `analytics_ensure_events_partition()`
  creates new partitions the same way.

---

## Cache / Redis

In-memory cache or Redis.

- `CACHE_PROVIDER` — `local | redis` (preferred switch)
- `CACHE_USE_REDIS`
- `CACHE_TTL_MS`
- `CACHE_MAX_SIZE`
- `REDIS_HOST`, `REDIS_PORT`

---

## Queue

Background job processing.

- `QUEUE_PROVIDER`
- `QUEUE_POLL_INTERVAL_MS`
- `QUEUE_CONCURRENCY`
- `QUEUE_MAX_ATTEMPTS`
- `QUEUE_BACKOFF_BASE_MS`
- `QUEUE_MAX_BACKOFF_MS`

---

## Storage

File storage configuration.

- `STORAGE_ROOT_PATH` — local path for uploads. Repo-relative paths such as `main/apps/server/uploads` are resolved from the repository root in development.
- `STORAGE_PUBLIC_BASE_URL` — public URL or absolute path for local-storage files. If omitted, local storage uses `<PUBLIC_API_URL-or-API_BASE_URL>/uploads`. It must route to this API's `/uploads/*`: local file URLs are HMAC-SHA-256 signed with an expiry (default 3600 s, like S3 presigned GETs; max 7 days) and `/uploads/*` refuses unsigned, tampered or expired requests with 403. A proxy or CDN that serves the upload directory directly would bypass that check.

Local URL signing needs no extra variable: the key is derived (HKDF) from the validated `COOKIE_SECRET` (or `JWT_SECRET` when that is blank), and boot fails if it is shorter than 32 characters. Rotating that secret invalidates outstanding file links, which expire within the hour anyway.

S3:

- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_ENDPOINT` — optional for AWS; for DigitalOcean Spaces use `https://<region>.digitaloceanspaces.com`.
- `S3_FORCE_PATH_STYLE` — use `true` for MinIO/path-style services; use `false` for AWS S3 and DigitalOcean Spaces.
- `S3_PRESIGN_EXPIRES_IN_SECONDS` — signed GET URL lifetime for private objects.

---

## Email

Email providers and SMTP. Two modes are supported:

- `console` (development) — prints email payloads to logs.
- `smtp` (staging/production) — sends real email through an SMTP server.

### Provider selection

- `EMAIL_PROVIDER` — `console | smtp`.
- `EMAIL_API_KEY` — reserved for future API-based email provider adapters. The current runtime supports `console` and `smtp`.
- `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS`
- `EMAIL_REPLY_TO`

### SMTP variables (required when `EMAIL_PROVIDER=smtp`)

- `SMTP_HOST`
- `SMTP_PORT` — typically `587` (STARTTLS) or `465` (implicit TLS).
- `SMTP_SECURE` — `true` for implicit TLS (port 465); otherwise `false`.
- `SMTP_USER` — optional when the relay allows unauthenticated senders.
- `SMTP_PASS` — required when `SMTP_USER` is set.
- `SMTP_CONNECTION_TIMEOUT`, `SMTP_SOCKET_TIMEOUT` — optional.

### Example

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mailer@yourdomain.com
SMTP_PASS=app-password
SMTP_CONNECTION_TIMEOUT=10000
SMTP_SOCKET_TIMEOUT=10000
```

### Startup verification

On boot, the email client runs a non-blocking SMTP reachability check (`verifyOnBoot`) and logs success or a warning. Server boot continues even if the check fails.

### Operational notes

- Use `console` locally unless you specifically need delivery tests.
- In production, startup validation rejects `EMAIL_PROVIDER=console`, placeholder SMTP hosts such as `smtp.example.com`, and `EMAIL_FROM_ADDRESS` values on `example.com`.
- Use app passwords or provider-scoped credentials — never personal account passwords.
- Rotate SMTP credentials and restart the service after rotation.

---

## OAuth Providers

OAuth credentials and callback URLs.

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`
- `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_CALLBACK_URL`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALLBACK_URL`, `MICROSOFT_TENANT_ID`
- `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_PRIVATE_KEY_BASE64`, `APPLE_CALLBACK_URL`

---

## Notifications

Notification provider configuration. In-app notifications are implemented. Web Push (VAPID) is the built-in browser push path; OneSignal and Courier config shapes are available. Other push services (e.g. FCM) require writing a new adapter against the `PushNotificationProvider` interface.

- `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `ONESIGNAL_USER_AUTH_KEY`, `ONESIGNAL_ENABLE_LOGGING`
- `COURIER_API_KEY`, `COURIER_API_URL`, `COURIER_ENABLE_LOGGING`

---

## Billing

Subscription and payment providers.

- `VITE_STRIPE_PUBLISHABLE_KEY` — publishable Stripe key exposed to the Vite client when billing UI is enabled
- `BILLING_CURRENCY`
- `BILLING_PORTAL_RETURN_URL`
- `BILLING_CHECKOUT_SUCCESS_URL`
- `BILLING_CHECKOUT_CANCEL_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BRAND_NAME`
- `PLAN_FREE_ID`, `PLAN_PRO_ID`, `PLAN_ENTERPRISE_ID`

---

## Search

Search provider config.

- `SQL_SEARCH_DEFAULT_PAGE_SIZE`
- `SQL_SEARCH_MAX_PAGE_SIZE`
- `SQL_SEARCH_MAX_QUERY_DEPTH`
- `SQL_SEARCH_MAX_CONDITIONS`
- `SQL_SEARCH_LOGGING`
- `SQL_SEARCH_TIMEOUT_MS`

---

## Frontend (Vite)

Client-side build/runtime config.

- `VITE_API_URL` — optional absolute browser API URL. Leave unset for the bundled single-domain Caddy deployment so the browser uses relative `/api` URLs.
- `VITE_APP_NAME` — browser-side app display name. Keep it aligned with `APP_NAME`.
- `VITE_STRIPE_PUBLISHABLE_KEY` — publishable Stripe key exposed to the Vite client when billing UI is enabled.

The production Compose file maps `VITE_STRIPE_PUBLISHABLE_KEY` to the Docker-only build arg
`PUBLIC_STRIPE_ID`. Set the `VITE_*` name in env files; use `PUBLIC_STRIPE_ID` only when invoking
`Dockerfile.web` directly. Optional UI and module surfaces resolve at runtime via
`GET /api/platform/context` (`@bslt/flags` and `AUTH_STRATEGIES`).
