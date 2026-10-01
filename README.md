# BSLT source distribution

A React and Fastify application with PostgreSQL, authentication, and account management.
The edition name, release version, and source file hashes are recorded in `edition.json`.

| Edition | Included features                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Core    | Authentication, account settings, API keys, consent, notifications, and security auditing                                              |
| Pro     | Core plus dashboard, administration, billing, organizations, tasks, files, analytics, support, telemetry, media, realtime, and workers |

The public Core source is available at [abrahamahn/bslt-core](https://github.com/abrahamahn/bslt-core).
Pro is distributed privately. Optional provider credentials and flags are configured through the
environment examples.

## Run locally

Use Node.js 22 or 24, pnpm 10.26.2, and PostgreSQL 16 or newer.

1. Run `pnpm install --frozen-lockfile`.
2. Copy `config/env/.env.local.example` to `config/env/.env.local`.
3. Set `JWT_SECRET`, `COOKIE_SECRET`, and `OAUTH_TOKEN_ENCRYPTION_KEY` to separate random values
   of at least 32 characters, and set your `POSTGRES_*` connection settings.
   Generate each secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
4. Run `pnpm db:migrate` against your development database.
5. Run `pnpm dev`. The web app uses port 5173 and the API uses port 8080 by default.

The console email provider prints development verification links. Configure SMTP before deploying.
Production settings are documented in `config/env/.env.production.example`.

## Validate

```sh
pnpm type-check
pnpm build
pnpm test
```

Set `EDITION_TEST_DATABASE_URL` to a **dedicated test PostgreSQL database** to also exercise migrations,
registration, email verification, login, and account access. That test creates test accounts.

## Continuous integration

The public Core repository includes its own **Core CI** workflow. Pushes and pull requests run
installation, type checking, builds, and account-flow tests against an isolated PostgreSQL database.
Core CI needs no credentials for the private development repository.

## Editions and updates

Core contains account authentication, account settings, security auditing, and supporting infrastructure.
Pro also contains the product features and optional service packages. Pro runtime flags and provider
credentials are configured through the environment examples; possessing the source does not configure
Stripe, SMTP, or a telemetry service for you.

Core omits the paid browser/server implementations. Both editions retain the common database migrations,
repository interfaces, and shared contracts so the schema remains compatible during an edition upgrade.
Back up your database before upgrading. Merge upstream source updates with your own changes and apply
pending migrations; replacing an edited checkout will overwrite your customizations.

Paid access is managed by the distributor. This application runs on your infrastructure and does not
require a licensing API to start. The source inventory is an integrity check, not a license signature.

## Contributions

Core is distributed under the [MIT license](https://github.com/abrahamahn/bslt-core/blob/main/LICENSE)
included in the public Core repository. Paid access and any commercial terms for Pro are handled
separately by the distributor.

Core users can report issues and propose changes in the public Core repository. Releases are generated
from the maintained source repository. Maintainers bring accepted fixes back into that source before
publishing another release so contributions survive future updates.
