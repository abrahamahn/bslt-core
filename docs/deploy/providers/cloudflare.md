# Cloudflare — CDN & DNS Proxy in Front of `PROCESS_ROLE=web`

In restructure Phase 18 (owner decision D7), the separate static-assets Cloudflare Workers job (`web` in [`.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml)) was retired in favor of the owned `PROCESS_ROLE=web` Node.js container ([`infra/docker/Dockerfile.web`](../../../infra/docker/Dockerfile.web), [`main/apps/web/src/server/serve.ts`](../../../main/apps/web/src/server/serve.ts)) running behind Caddy alongside the API ([provider-neutral guide](../README.md) and [DigitalOcean](./digitalocean.md)).

## Architecture

- **Single origin behind Caddy:** Caddy routes `/api/*`, `/ws`, `/uploads/*`, and `/health*` to `api:8080`, and routes public SSR pages (`/`, `/status`, legal documents, `/support`, `/report`, `/sitemap.xml`, `/robots.txt`), fingerprinted `/assets/*`, and SPA routes to `web:80` (`PROCESS_ROLE=web`).
- **Cloudflare CDN / proxy (optional):** Point your domain's DNS records in Cloudflare (proxied / orange-cloud, SSL/TLS mode **Full (strict)**) at the Caddy host. Fingerprinted `/assets/*` carry `Cache-Control: public, max-age=31536000, immutable`, and public SSR pages emit `Cache-Control` from each `PublicRoute.cacheSeconds` definition.
