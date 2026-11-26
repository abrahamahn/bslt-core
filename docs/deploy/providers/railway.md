# Railway Deployment Guide

Deploy BSLT to [Railway](https://railway.com) with two Docker services (`bslt-api` and `bslt-web`) plus a managed PostgreSQL 17 database using `infra/deploy/railway/`.

## 1. Provision PostgreSQL 17

1. Create a new Railway project and add a **PostgreSQL** service (select PostgreSQL 17).
2. Bootstrap the production RLS roles (`bslt_owner`, `bslt_app`, `bslt_worker`) once against the database using `pnpm db:bootstrap:roles` (see [Production Postgres](../production-postgres.md)).

## 2. Create the API Service (`infra/deploy/railway/railway.json`)

1. Add a service from your GitHub repository and set **Config File Path** to `infra/deploy/railway/railway.json`.
2. Railway builds `infra/docker/Dockerfile`, runs `node node_modules/@bslt/db/dist/migrate/entry.js` as its `preDeployCommand`, and probes `/health`.
3. Add the required environment variables (see [Environment Reference](../env.md)):
   - `NODE_ENV=production`, `PROCESS_ROLE=all`, `TRUST_PROXY=true`, `PORT=8080`
   - `APP_URL=https://<your-web-domain>`
   - `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `LISTEN_DATABASE_URL`
   - `JWT_SECRET`, `COOKIE_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY` (64-hex CSPRNG values)
   - `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS`

## 3. Create the Web SSR/SPA Service (`infra/deploy/railway/railway.web.json`)

1. Add a second service from the same repository and set **Config File Path** to `infra/deploy/railway/railway.web.json`.
2. Set build-time & runtime variables:
   - `NODE_ENV=production`, `PROCESS_ROLE=web`, `PORT=8080`
   - `SITE_URL=https://<your-web-domain>`
   - `VITE_API_URL=https://<your-api-domain>`
   - `VITE_APP_NAME=<Your App>`

## 4. Verify

- `curl -fsS https://<your-api-domain>/health`
- `curl -fsS https://<your-web-domain>/health`
- `curl -fsS https://<your-web-domain>/openapi.json | head -c 200`
