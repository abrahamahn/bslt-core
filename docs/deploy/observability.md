# Observability

What the starter ships for running in production, and what is opt-in. Pairs with
the [incident runbooks](./runbooks.md).

## Built in

| Concern            | What you get                                                                                                                                  | Where                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Structured logging | JSON lines with correlation/request IDs. Secret-bearing names are censored at any depth, in any case ([below](#log-redaction)).               | `main/kernel/server/src/logger`                           |
| Error model        | `AppError` with kind→HTTP-status mapping and log-level selection.                                                                             | `main/server/system/src/errors`                           |
| Health probes      | `GET /health`, `/health/ready` (DB connected), `/health/live`.                                                                                | `main/apps/server/src/http/system-routes.ts`              |
| Metrics            | Prometheus exposition at `GET /metrics/prometheus` (`bslt_*` counters, `{role,instance}` latency histograms, and Node event-loop lag gauges). | `main/shared/src/modules/system/observability/metrics.ts` |
| Error tracking     | Log events, no vendor SDK: server 5xx and crashes, and masked crash reports from consenting browsers (below).                                 | `main/kernel/server/src/observability`                    |

Error tracking needs no configuration and no third party:

- **Server.** Every 5xx the error handler maps is logged as one
  `Captured server error` event at error level, with its correlation ID, method,
  URL and status. An uncaught exception is logged as one `Uncaught exception`
  fatal event before Node prints it and exits. So is an unhandled promise
  rejection (`origin: "unhandledRejection"`), in every environment: the server
  registers no `unhandledRejection` listener, so Node's default throw mode ends
  the process and the container's `restart: unless-stopped` brings it back.
  Under Sentry, a deployment with a DSN logged such a rejection and kept
  serving; that is no longer so.
- **Browser.** Visitors who granted the `analytics` consent category send their
  crashes to `POST /api/platform/errors`: uncaught errors, unhandled rejections
  and render errors caught by the root error boundary. Emails, credentials,
  tokens and query strings are masked in the browser and again on the server,
  and each accepted request is logged as one `Client error report` event. The
  route is public and bounded: an 8 KiB body, 5 reports per request, 10 requests
  a minute per IP and 300 a minute per process. Visitors without that consent
  send nothing. The route's body is exempt from the global injection
  heuristics (owner decision, see [security](../dev/security.md)), so a report
  whose text looks like SQL (`--` in a chunk name, "select … from" in a
  message) is logged like any other; its query string is still checked and its
  body still sanitized. The browser drops only a batch the server refuses as
  invalid (400) and keeps reporting.

Group them with log queries, for example on `msg` and `err.message`. Stacks from
the browser are minified bundle frames; read them against the release's source
maps.

## Log redaction

The logger censors a field's value as `"[REDACTED]"` when its name is in
`SENSITIVE_KEYS` (`main/shared/src/constants/system/security.ts`, the one list),
at any depth, inside arrays, in bindings and in `err`:

- HTTP credentials: `authorization`, `proxy-authorization`, `cookie`, `cookies`,
  `set-cookie`, `x-api-key`, `x-csrf-token`, `x-sudo-token`, and Node's raw
  header arrays `rawHeaders` and `rawTrailers`, whose values no name can censor.
- Passwords: `password`, `currentPassword`, `newPassword`, `passwordHash`.
- Tokens and one-time codes: `token`, `accessToken`, `refreshToken`, `idToken`,
  `csrfToken`, `cookieToken`, `requestToken`, `sudoToken`, `challengeToken`,
  `verificationToken`, `captchaToken`, `totpCode`, `backupCodes`.
- Hashes of short codes: `tokenHash` and `codeHash`. An email OTP's `tokenHash`
  is the SHA-256 of `email:` and six digits, and an SMS `codeHash` the SHA-256 of
  six digits, so either gives the live code back in a million guesses.
- Secrets and keys: `secret`, `clientSecret`, `totpSecret`, `jwtSecret`,
  `previousSecret`, `sealSecret`, `signingSecret`, `webhookSecret`, `secretKey`,
  `secretAccessKey`, `key`, `apiKey`, `privateKey`, `encryptionKey`,
  `oauthTokenEncryptionKey`, `restApiKey`, `userAuthKey`, `authToken`.
- Payment data: `creditCard`, `cvv`, `cardDetails`.

A name matches exactly, ignoring case, `-` and `_`, so `Authorization`,
`ACCESS_TOKEN`, `access_token` and `X-CSRF-Token` are censored. Names that only
contain one of these words are logged: `tokenVersion` (a revocation counter),
`keyId` and `apiKeyId` (identifiers), `publicKey`, `idempotencyKey`, `cacheKey`,
and the `hasToken` and `hasRefreshToken` flags of the login and refresh debug
lines. A suffix rule would also hide the last five, so the list is the whole
boundary and is not exhaustive: a name that is not on it is logged as it is, and
a new field that holds a secret is added to the list by name. A one-time code in
a field named `code` is logged, because `code` is also the error-code field.

The censoring runs while the line is serialized and never changes the logged
object. When a value's `toJSON` reads one of the value's own listed fields, it
reads `"[REDACTED]"`: the `toJSON` runs on a copy with those fields censored, so
renaming the field or building a string from it does not carry the secret out.
What a `toJSON` returns is censored like any other value. A `toJSON` that cannot
run on that copy (it reads a private `#field`) turns its top-level field into the
unserializable marker. Censoring is by name only; a secret inside a string (a
URL query, a message) is not detected, so do not log one.

## Metrics → alerting

The bundled Prometheus rules and example configs live in
`infra/runtime/prometheus/`:

- `prometheus.example.yml` — scrape `api:8080/metrics/prometheus`, load the rules.
- `alerts.yml` — `TargetDown`, `HighErrorRate`, `HighLatencyP99`, `DatabaseDown`, `DatabaseSlow`, `LoginFailureSpike`. Names/labels match the exposed metrics.
- `alertmanager.example.yml` — generic webhook receiver; swap in Slack/PagerDuty/etc.

Copy each `*.example.yml` to the unsuffixed name, set your targets and receiver,
and point Prometheus at the rules. Alert annotations link back to the runbooks.

### Database health

A periodic probe (`startDbHealthSampler`, every 15s) records DB reachability and
probe latency into the collector:

- `bslt_db_up` (gauge, 1 = reachable) → `DatabaseDown` alert.
- `bslt_db_check_duration_ms` (gauge) → `DatabaseSlow` alert.
- `bslt_db_checks_total{result}` (counter).

The stack uses **postgres.js**, which does not expose `pg.Pool`-style
total/idle/waiting counts. Probe latency is used instead: because postgres.js
queues queries when every connection is busy, the probe slows under pool
saturation as well as an outright outage — so `bslt_db_check_duration_ms` is the
saturation signal, and `bslt_db_up` plus `/health/ready` cover availability.

> Metrics are process-local and reset on restart; alert expressions use `rate()`
> (or gauge thresholds) so this is expected.

### Process roles, histograms, and event-loop lag

Every server process (`PROCESS_ROLE = api | realtime | worker | media-worker | all`) exposes:

- `bslt_http_request_duration_ms_bucket{role,instance,le}`, `_sum`, and `_count` — cumulative HTTP request duration histogram labelled by `PROCESS_ROLE` and `INSTANCE_ID` (falling back to `HOSTNAME` or `<hostname>:<pid>`).
- `bslt_event_loop_lag_ms{role,instance,quantile}`, `bslt_event_loop_lag_max_ms{role,instance}`, and `bslt_event_loop_lag_mean_ms{role,instance}` — sampled directly from Node's native `monitorEventLoopDelay` histogram (`startEventLoopLagSampler`) with zero `setInterval` overhead.

## Backups

In-network encrypted logical backups and PITR WAL archiving live in
[`infra/runtime/backup/`](../../infra/runtime/backup/README.md) (`backup.sh` writes
`bslt_backup_last_success_timestamp_seconds` for the `BackupStale` alert in `alerts.yml`).
Restore drills and manual commands are in [backup-restore.md](./backup-restore.md).

## Opt-in OTLP/HTTP Tracing

- **Distributed tracing (`@bslt/protocols/otlp`).** Wired behind `OTEL_EXPORTER_OTLP_ENDPOINT`
  in `@bslt/server-system/observability` (`startOtlpHttpTelemetry`). Default clones with
  `OTEL_EXPORTER_OTLP_ENDPOINT` unset stay completely inert; setting `OTEL_EXPORTER_OTLP_ENDPOINT`
  (plus optional `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_HEADERS`) exports W3C `traceparent`
  request spans over owned `fetch` with zero third-party SDK dependencies.
- **Hosted log aggregation / dashboards.** Ship the JSON logs to your platform
  (Loki, CloudWatch, Datadog) at the deploy layer; the app emits structured logs
  to stdout by design.
