# Fly.io Deployment Guide

Deploy BSLT (`PROCESS_ROLE=all` API + worker and `PROCESS_ROLE=web` SSR/SPA frontend) to [Fly.io](https://fly.io) in under 5 minutes using the ready-made templates in `infra/deploy/fly/`.

## Prerequisites

- [Fly CLI (`flyctl`)](https://fly.io/docs/flyctl/install/) authenticated (`fly auth login`).
- A PostgreSQL 17 database (Fly Managed Postgres or external PostgreSQL 17 with RLS roles bootstrapped via `pnpm db:bootstrap:roles`; see [Production Postgres](../production-postgres.md)).

## 1. Launch and Configure the API Service

```bash
fly launch --config infra/deploy/fly/fly.toml --no-deploy

fly secrets set --config infra/deploy/fly/fly.toml \
  APP_URL="https://app.example.com" \
  DATABASE_URL="postgresql://bslt_app:<pass>@<host>:5432/bslt" \
  MIGRATION_DATABASE_URL="postgresql://bslt_owner:<pass>@<host>:5432/bslt" \
  WORKER_DATABASE_URL="postgresql://bslt_worker:<pass>@<host>:5432/bslt" \
  LISTEN_DATABASE_URL="postgresql://bslt_worker:<pass>@<host>:5432/bslt" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  COOKIE_SECRET="$(openssl rand -hex 32)" \
  OAUTH_TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  EMAIL_PROVIDER="smtp" \
  SMTP_HOST="smtp.example.com" \
  SMTP_PORT="587" \
  SMTP_USER="apikey" \
  SMTP_PASSWORD="<smtp-password>" \
  EMAIL_FROM_ADDRESS="noreply@example.com"
```

Deploy the API — Fly automatically runs `release_command` (`node node_modules/@bslt/db/dist/migrate/entry.js`) before cutting traffic over:

```bash
fly deploy --config infra/deploy/fly/fly.toml
```

## 2. Launch and Deploy the Web SSR/SPA Service

```bash
fly launch --config infra/deploy/fly/fly.web.toml --no-deploy

fly deploy --config infra/deploy/fly/fly.web.toml \
  --build-arg SITE_URL="https://app.example.com" \
  --build-arg VITE_API_URL="https://bslt-api.fly.dev" \
  --build-arg VITE_APP_NAME="Your App"
```

## 3. Verify Health & Optional Modules

- API health: `curl -fsS https://bslt-api.fly.dev/health`
- Web SSR: `curl -fsS https://bslt-web.fly.dev/health`
- Optional features: configure `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (`@bslt/ai`), `WAITLIST_ENABLED=true` (`@bslt/growth`), `STRIPE_SECRET_KEY` (`@bslt/billing`), or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (`@bslt/identity`) as Fly secrets. See [Environment Reference](../env.md).
