# Reverse Proxy & Trusted-Proxy Configuration

Caddy-based reverse proxy for TLS termination and request routing, plus the trusted-proxy / `X-Forwarded-*` configuration that goes with it. This single doc covers both: a misconfigured proxy is a security hole even with a working TLS setup.

---

## Architecture

```
                        Internet
                           |
                           v
            +-----------------------------+
            |          Caddy              |
            |    (TLS Termination)        |
            |     Ports: 80, 443          |
            +-----------------------------+
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
   /health*             /ws              /api/*            /*
        |                  |                  |             |
        v                  v                  v             v
   +---------+        +---------+        +---------+   +---------+
   |   API   |        |   API   |        |   API   |   |   Web   |
   |  :8080  |        |  :8080  |        |  :8080  |   |   :80   |
   | (health)|        |(websocket)|      |(routes) |   | (nginx) |
   +---------+        +---------+        +---------+   +---------+
        |
        v
   +---------+
   |Postgres |
   |  :5432  |
   +---------+
```

All services (postgres, api, web) live on an internal Docker network. Only Caddy is exposed to the internet.

---

## Quick Start

### 1. Set environment variables

```bash
cp config/env/.env.production.example config/env/.env.production
nano config/env/.env.production
```

Required for TLS:

```bash
DOMAIN=yourdomain.com
ACME_EMAIL=admin@yourdomain.com
# The separate database server (docs/deploy/README.md#two-servers): its
# private address and its superuser password.
POSTGRES_HOST=10.0.0.5
POSTGRES_PASSWORD=your_strong_password
JWT_SECRET=$(openssl rand -base64 32)
COOKIE_SECRET=$(openssl rand -base64 32)
OAUTH_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

Required for the database (the API never connects as the `postgres` superuser;
see [Database roles](./env.md#database-roles)):

```bash
# One password per database role, kept only in that role's URL. Hex, because
# the URLs carry them unencoded (base64 has `/`, `+` and `=`).
ENV_FILE=config/env/.env.production
DB_NAME=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)
DB_HOST=$(grep -E '^POSTGRES_HOST=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)
echo "DATABASE_URL=postgresql://bslt_app:$(openssl rand -hex 32)@pgbouncer:5432/${DB_NAME}" >> "$ENV_FILE"
WORKER_PASSWORD=$(openssl rand -hex 32)
echo "WORKER_DATABASE_URL=postgresql://bslt_worker:${WORKER_PASSWORD}@pgbouncer:5432/${DB_NAME}" >> "$ENV_FILE"
# The worker role again, straight at the database server: the pub/sub LISTEN connection.
echo "LISTEN_DATABASE_URL=postgresql://bslt_worker:${WORKER_PASSWORD}@${DB_HOST}:5432/${DB_NAME}" >> "$ENV_FILE"
echo "MIGRATION_DATABASE_URL=postgresql://bslt_owner:$(openssl rand -hex 32)@${DB_HOST}:5432/${DB_NAME}" >> "$ENV_FILE"
```

### 2. Start the stack

```bash
compose() {
  docker compose -f infra/docker/production/docker-compose.prod.yml \
    --env-file config/env/.env.production "$@"
}

# The same steps, in this order, on every deploy. `&&` is the point: the API
# must not start if a database step failed.
compose --profile ops build &&        # api, web and the two one-shot database jobs
  compose run --rm bootstrap-roles && # superuser: create or repair bslt_owner, bslt_app, bslt_worker
  compose run --rm migrate &&         # bslt_owner: apply pending migrations
  compose up -d                       # the API starts only after both succeeded
```

### 3. Verify

```bash
docker compose -f infra/docker/production/docker-compose.prod.yml ps
docker compose -f infra/docker/production/docker-compose.prod.yml logs caddy
curl https://your-domain.com/health
```

---

## Port Reference

| Port | Protocol | Service  | Purpose                       |
| ---- | -------- | -------- | ----------------------------- |
| 80   | TCP      | Caddy    | HTTP (redirects to HTTPS)     |
| 443  | TCP      | Caddy    | HTTPS                         |
| 443  | UDP      | Caddy    | HTTP/3 (QUIC)                 |
| 8080 | Internal | API      | Backend API server            |
| 80   | Internal | Web      | Frontend (nginx static files) |
| 5432 | Internal | Postgres | Database                      |

**Production security:** only ports 80, 443, and 443/udp are exposed publicly.

---

## Route Configuration

| Path         | Destination | Description                            |
| ------------ | ----------- | -------------------------------------- |
| `/health*`   | api:8080    | Health check endpoints                 |
| `/ws`        | api:8080    | WebSocket connections (with upgrade)   |
| `/api/*`     | api:8080    | All API routes                         |
| `/uploads/*` | api:8080    | Static file uploads (if local storage) |
| `/*`         | web:80      | Frontend static files                  |

---

## WebSocket Configuration

WebSocket connections at `/ws` are handled with explicit upgrade headers:

```caddyfile
@websocket {
    path /ws
    header Connection *Upgrade*
    header Upgrade websocket
}
handle @websocket {
    reverse_proxy api:8080 {
        header_up Connection {http.request.header.Connection}
        header_up Upgrade {http.request.header.Upgrade}
        header_up Sec-WebSocket-Key {http.request.header.Sec-WebSocket-Key}
        header_up Sec-WebSocket-Version {http.request.header.Sec-WebSocket-Version}
        header_up Sec-WebSocket-Extensions {http.request.header.Sec-WebSocket-Extensions}
        header_up Sec-WebSocket-Protocol {http.request.header.Sec-WebSocket-Protocol}

        transport http {
            read_timeout 0
            write_timeout 0
        }
    }
}
```

`read_timeout 0` / `write_timeout 0` keep sockets open indefinitely.

Test:

```bash
npm install -g wscat
wscat -c wss://your-domain.com/ws
```

---

## Health Check Endpoints

| Endpoint        | Response | Description                                 |
| --------------- | -------- | ------------------------------------------- |
| `/health`       | 200 OK   | Basic health (service is alive)             |
| `/health/ready` | 200 OK   | Readiness (DB connected, ready for traffic) |
| `/health/live`  | 200 OK   | Liveness probe                              |

```bash
curl https://your-domain.com/health
# {"status":"ok"}

curl https://your-domain.com/health/ready
# {"status":"ok","checks":{"database":"ok"}}
```

---

## Security Headers

Caddy adds these automatically:

| Header                    | Value                                        |
| ------------------------- | -------------------------------------------- |
| Strict-Transport-Security | max-age=31536000; includeSubDomains; preload |
| X-Frame-Options           | SAMEORIGIN                                   |
| X-Content-Type-Options    | nosniff                                      |
| X-XSS-Protection          | 1; mode=block                                |
| Referrer-Policy           | strict-origin-when-cross-origin              |

Verify: `curl -I https://your-domain.com`.

---

## Compression

The API server encodes its own text and JSON responses of 1 KiB or more with br or gzip, as the
client's `Accept-Encoding` allows (`main/apps/server/src/middleware/compression.ts`). Caddy passes an
encoded response through untouched; its `encode gzip zstd` compresses what the API leaves identity
and the static web assets.

```bash
curl -H "Accept-Encoding: gzip" https://your-domain.com -o /dev/null -w '%{size_download}\n'
curl https://your-domain.com                              -o /dev/null -w '%{size_download}\n'
```

---

## TLS Certificate Management

Caddy handles certificates automatically via Let's Encrypt:

1. **Provisioning** — certificates obtained when Caddy starts.
2. **Renewal** — automatic before expiration.
3. **Configuration** — set `DOMAIN` and `ACME_EMAIL`; nothing else.

Certificates live in the `caddy_data` volume.

### Staging mode (avoid rate limits while testing)

Uncomment the staging ACME CA in `infra/runtime/caddy/Caddyfile`:

```caddyfile
{
    acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}
```

---

## Development Mode (no TLS)

```bash
docker run -p 80:80 \
  -v $(pwd)/infra/runtime/caddy/Caddyfile.dev:/etc/caddy/Caddyfile \
  --network host \
  caddy:2-alpine
```

Or directly:

```bash
caddy run --config infra/runtime/caddy/Caddyfile.dev
```

---

## Trusted Proxy Configuration (security-critical)

When the app runs behind a proxy, the connection comes from the proxy — not the client. To recover the real client IP, the app reads `X-Forwarded-For` and similar headers.

**The risk:** an attacker can send forged `X-Forwarded-*` headers directly to the app. Without proper configuration this bypasses rate limiting, IP blocking, geo-restrictions, and audit-log integrity.

**The fix:** only trust proxy headers from known, trusted proxy IPs.

### Environment variables

| Variable          | Default                    | Description                                    |
| ----------------- | -------------------------- | ---------------------------------------------- |
| `TRUST_PROXY`     | `false`                    | Enable proxy header trust                      |
| `TRUSTED_PROXIES` | `172.16.0.0/12,10.0.0.0/8` | Comma-separated list of trusted IPs/CIDRs      |
| `MAX_PROXY_DEPTH` | `1`                        | Max hops to trust in the X-Forwarded-For chain |

```bash
# Development (no proxy)
TRUST_PROXY=false

# Production behind a proxy
TRUST_PROXY=true
```

`TRUSTED_PROXIES` accepts IPs and CIDR ranges, mixed IPv4/IPv6:

```bash
TRUSTED_PROXIES=10.0.0.0/8,192.168.1.100,2001:db8::/32
```

`MAX_PROXY_DEPTH` should be set to the **minimum** that works for your topology. Higher values increase attack surface. With `X-Forwarded-For: client, proxy1, proxy2`:

- `MAX_PROXY_DEPTH=1` — trust only the last proxy (so you'd see `proxy1`'s IP).
- `MAX_PROXY_DEPTH=2` — trust the last two (you'd see the client IP).

### Common configurations

**Docker Compose (default).** Trusts Docker's bridge ranges:

```bash
TRUST_PROXY=true
TRUSTED_PROXIES=172.16.0.0/12,10.0.0.0/8
MAX_PROXY_DEPTH=1
```

**Caddy on the same host:**

```bash
TRUST_PROXY=true
TRUSTED_PROXIES=127.0.0.1,::1
MAX_PROXY_DEPTH=1
```

**AWS ALB.** Trust your VPC CIDR:

```bash
TRUST_PROXY=true
TRUSTED_PROXIES=10.0.0.0/8  # adjust to your VPC
MAX_PROXY_DEPTH=1   # use 2 if there's also an internal proxy
```

**AWS CloudFront.** Use the published IP list (https://ip-ranges.amazonaws.com/ip-ranges.json, filter `CLOUDFRONT`):

```bash
TRUSTED_PROXIES=13.32.0.0/15,13.35.0.0/16,...
MAX_PROXY_DEPTH=2
```

**Cloudflare.** Use the published IP list at https://www.cloudflare.com/ips/. Recommended: use Cloudflare's `CF-Connecting-IP` header instead of parsing `X-Forwarded-For`:

```bash
TRUSTED_PROXIES=173.245.48.0/20,103.21.244.0/22,...
MAX_PROXY_DEPTH=1
REAL_IP_HEADER=CF-Connecting-IP
```

**Google Cloud Load Balancer:**

```bash
TRUST_PROXY=true
TRUSTED_PROXIES=35.191.0.0/16,130.211.0.0/22
MAX_PROXY_DEPTH=1
```

**DigitalOcean Load Balancer:**

```bash
TRUST_PROXY=true
TRUSTED_PROXIES=10.132.0.0/16
MAX_PROXY_DEPTH=1
```

### Custom real-IP headers

| Proxy      | Header             |
| ---------- | ------------------ |
| Cloudflare | `CF-Connecting-IP` |
| Fastly     | `Fastly-Client-IP` |
| Akamai     | `True-Client-IP`   |

Set `REAL_IP_HEADER=<header-name>` if your proxy uses one of these.

### Verification

```bash
# Inspect logged IP
curl https://your-domain.com/api/auth/me -v
docker compose -f infra/docker/production/docker-compose.prod.yml logs api | grep "ip"

# Forged headers should be ignored (you should see the proxy IP, not 1.2.3.4)
curl -H "X-Forwarded-For: 1.2.3.4" https://your-domain.com/api/auth/me
```

Enable `DEBUG=true` to log the full IP resolution chain (raw header → trust check → resolved IP).

### Pre-production checklist

- [ ] `TRUST_PROXY=true` only if you're actually behind a proxy.
- [ ] `TRUSTED_PROXIES` lists **only your actual proxy IPs/ranges** — never `0.0.0.0/0`.
- [ ] `MAX_PROXY_DEPTH` set to the minimum required.
- [ ] Forged `X-Forwarded-For` headers tested and ignored.
- [ ] Logs show correct client IPs.
- [ ] Rate limiting verified from multiple IPs.

### Common mistakes

- **Trusting everyone:** `TRUSTED_PROXIES=0.0.0.0/0` — defeats the purpose.
- **Forgetting IPv6:** add `::1,2001:db8::/32` if applicable.
- **Wrong depth:** `Client → CDN → LB → App` requires `MAX_PROXY_DEPTH=2`.
- **Stale CDN ranges:** automate refreshes (`curl https://www.cloudflare.com/ips-v4 > /tmp/cf-ips.txt`).

---

## CDN Integration

When putting a CDN in front of Caddy:

### Cloudflare

1. SSL mode → "Full (strict)" in the Cloudflare dashboard.
2. Add Cloudflare IP ranges to `TRUSTED_PROXIES` (see above).
3. Use `CF-Connecting-IP` for the real client IP.

### AWS CloudFront

1. Origin protocol policy → "HTTPS Only".
2. Add CloudFront IP ranges to `TRUSTED_PROXIES`.

---

## Troubleshooting

### Certificate not obtained

1. DNS points to your server.
2. Ports 80 and 443 are open in the firewall.
3. Check logs: `docker compose -f infra/docker/production/docker-compose.prod.yml logs caddy`.

### WebSocket connection failed

1. Verify `/ws` route configuration.
2. Test upgrade headers:

```bash
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://your-domain.com/ws
```

### API returns wrong client IP

See [Trusted Proxy Configuration](#trusted-proxy-configuration-security-critical) above.

### 502 Bad Gateway

```bash
docker compose -f infra/docker/production/docker-compose.prod.yml ps
docker compose -f infra/docker/production/docker-compose.prod.yml logs api
docker compose -f infra/docker/production/docker-compose.prod.yml exec caddy \
  wget -qO- http://api:8080/health
```

---

## File Reference

```
infra/
├── runtime/
│   └── caddy/
│       ├── Caddyfile       # Production (automatic TLS)
│       └── Caddyfile.dev   # Development (HTTP only)
└── docker/
    └── production/
        └── docker-compose.prod.yml
```

---

## Related

- [Deployment README](./README.md)
- [Environment variables](./env.md)
