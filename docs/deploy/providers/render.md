# Render Blueprint Deployment Guide

Deploy BSLT (`bslt-api`, `bslt-web`, and managed PostgreSQL 17) on [Render](https://render.com) with a single Blueprint (`infra/deploy/render/render.yaml`).

## 1. Connect the Blueprint

1. Push your personalized BSLT repository to GitHub or GitLab.
2. In Render Dashboard, open **Blueprints → New Blueprint Instance** and select `infra/deploy/render/render.yaml`.
3. Fill in the prompted `sync: false` secrets:
   - `APP_URL` — your public web origin (e.g. `https://app.example.com`)
   - `OAUTH_TOKEN_ENCRYPTION_KEY` — 64-character hex secret (`openssl rand -hex 32`)
   - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS`
   - `API_UPSTREAM_URL` — the internal or HTTPS URL of your `bslt-api` service

## 2. Production RLS Roles

The Blueprint wires `bslt-postgres` directly so your first deploy boots immediately. For full least-privilege Row-Level Security role separation (`bslt_owner`, `bslt_app`, `bslt_worker`), run `pnpm db:bootstrap:roles` once against your Render PostgreSQL external URL and point `DATABASE_URL` (`bslt_app`) and `WORKER_DATABASE_URL` (`bslt_worker`) at those roles (see [Production Postgres](../production-postgres.md)).

## 3. Migrations & Health Checks

- `bslt-api` automatically executes `node node_modules/@bslt/db/dist/migrate/entry.js` via `preDeployCommand` on every deploy and reports readiness on `/health`.
- `bslt-web` runs `infra/docker/Dockerfile.web` (`PROCESS_ROLE=web`) with statically prerendered public pages (`/`, `/docs`, `/blog`, `/waitlist`, `/openapi.json`) and health checks on `/health`.
