# Secrets Checklist

Every secret and variable the two workflows read, and what each is for. The same list, shorter, is
the header of [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml); a test fails when
that header omits a name the workflow reads.

Set them under **Settings → Secrets and variables → Actions**. A value that differs between staging
and production belongs to that **environment** (Settings → Environments → `staging` / `production` /
`demo`), not to the repository: the deploy jobs run in the environment and read its values first.

## Environments to create

| Environment  | Used by                                            | Suggested protection |
| ------------ | -------------------------------------------------- | -------------------- |
| `staging`    | the app deploy on a push to `staging`, manual runs | none                 |
| `production` | the app deploy, the Cloudflare web deploy          | required reviewers   |
| `demo`       | the demo host deploy                               | none                 |

Terraform runs in `staging` or `production`, as chosen when it is started.

## App server deploy (`staging`, `production`)

### Variables

```bash
DEPLOY_HOST=203.0.113.10          # The app server's address (INSTANCE_IP is also read)
DOMAIN=yourdomain.com             # Public domain. Default: the server address
DB_HOST=10.0.0.5                  # REQUIRED: the database server's private address, as the app server reaches it
DB_PORT=5432                      # Optional, defaults to 5432
DB_NAME=abe_stack                 # Optional, defaults to abe_stack. The database server's POSTGRES_DB
APP_NAME=bslt                     # Optional, defaults to bslt. Names the deployment directory and compose project
SSH_USERNAME=deploy               # Optional, defaults to root
SSH_PORT=22                       # Optional, defaults to 22
REGISTRY=ghcr.io                  # Optional, defaults to ghcr.io
IMAGE_NAME=your-org/your-app      # Optional, defaults to <owner>/<repo>
SITE_URL=https://yourdomain.com   # Optional: the public origin, for the sitemap
```

`DB_HOST` names the separate database server ([two servers](./README.md#two-servers)). Set that
server up first, with `POSTGRES_DB` equal to `DB_NAME` and the app server's private address as its
`APP_SERVER_CIDR`. The deploy stops before touching the app server when `DB_HOST` is missing, and
before changing anything when the database server does not answer or runs another Postgres major
than `infra/versions.env` pins.

### Secrets

```bash
SSH_PRIVATE_KEY=-----BEGIN OPENSSH PRIVATE KEY-----...
SSH_HOST_FINGERPRINT=SHA256:...             # The app server's host key. See "SSH host keys" below
ACME_EMAIL=admin@yourdomain.com
DB_PASSWORD=strong-random-value             # The database server's superuser. Or use POSTGRES_PASSWORD
DB_OWNER_PASSWORD=url-safe-random-value     # bslt_owner: migrations
DB_APP_PASSWORD=url-safe-random-value       # bslt_app: the API's user sessions
DB_WORKER_PASSWORD=url-safe-random-value    # bslt_worker: the API's background work and its LISTEN connection
JWT_SECRET=strong-random-value
COOKIE_SECRET=strong-random-value
OAUTH_TOKEN_ENCRYPTION_KEY=strong-random-value
EMAIL_FROM_ADDRESS=no-reply@yourdomain.com  # Optional, default no-reply@<domain>
SMTP_HOST=smtp.mail.yourdomain.com          # Optional, default smtp.mail.<domain>
SMTP_USER=...                               # Optional
SMTP_PASS=...                               # Optional
REGISTRY_USERNAME=your-registry-username    # Optional: default is the workflow's own identity on ghcr.io
REGISTRY_PASSWORD=your-registry-password    # Optional: default is the workflow's own token
```

`DB_PASSWORD` is the superuser password the database server was started with (`POSTGRES_PASSWORD`
in its `.env.database`).

The four database secrets are independent: none is derived from another, and
the deploy stops before touching the server if one is missing. The API runs as
`bslt_app` and `bslt_worker` and never receives `DB_PASSWORD` or
`DB_OWNER_PASSWORD`; those go only to the one-shot `bootstrap-roles` and
`migrate` jobs (and `DB_PASSWORD` to PgBouncer, which looks role passwords up
with it). See [Database roles](./env.md#database-roles).

The three role passwords are written into connection URLs as they are, so they
may contain only letters, digits and `. _ ~ -`. The deploy refuses anything
else. Generate each with `openssl rand -hex 32`. To rotate one, change that
secret and redeploy: the role bootstrap applies it.

Every other secret and setting may hold any character, `$` included: the deploy writes them into
the server's `.env` in single quotes, which Compose reads literally. It refuses a value that would
not arrive as configured: one with a single quote, a line break or a backslash as its last character
(they end the quoting), and one with white space at either end or white space followed by `#` (the
API's configuration loader trims a value and reads ` #` as the start of a comment).

`SMTP_USER` and `SMTP_PASS` are passed to the API by name, and it authenticates to the mail server
only when both are set. The workflow has no setting for `SMTP_PORT` or `SMTP_SECURE`: a deployed API
uses its defaults (port 587, upgraded with STARTTLS).

### Fallbacks the workflow also reads

```bash
# Secrets, when the variable of the same purpose is not set
SERVER_HOST=your-server-ip-or-domain   # DEPLOY_HOST
SERVER_USER=deploy                     # SSH_USERNAME
SERVER_PORT=22                         # SSH_PORT
DOMAIN=yourdomain.com                  # DOMAIN
DB_HOST=10.0.0.5                       # DB_HOST
REGISTRY=ghcr.io                       # REGISTRY
POSTGRES_PASSWORD=strong-random-value  # DB_PASSWORD
```

## Demo host (`demo`)

```bash
# Secrets
DROPLET_HOST=203.0.113.20
DROPLET_SSH_KEY=-----BEGIN OPENSSH PRIVATE KEY-----...
DROPLET_KNOWN_HOSTS=[203.0.113.20]:2222 ssh-ed25519 AAAA...   # The demo host's key. See "SSH host keys" below

# Variables
DROPLET_SSH_PORT=2222             # Optional, defaults to 2222
DEMO_PUBLIC_HOST=demo.example.com # Optional, defaults to app.bslt.dev
```

The demo keeps its own disposable database in `infra/docker/demo/docker-compose.demo.yml`; it needs
none of the database secrets above (its env file is generated on the host).

## SSH host keys

The first thing a deploy sends over SSH is every secret of its environment. Unless the server's host
key is pinned, whatever answers at the server's address receives them. Both values below are
optional so that an existing setup keeps deploying, and each deploy prints a warning until its value
is set. Read them on the server itself (its console, or a connection you already trust), not over
the network path the deploy uses.

**App server** (`SSH_HOST_FINGERPRINT`, per environment): the SHA256 fingerprint of the host key.

```bash
ssh-keygen -l -f /etc/ssh/ssh_host_ecdsa_key.pub | cut -d ' ' -f 2     # SHA256:...
```

Of the keys a server offers, the SSH client of the deploy action asks for the ECDSA key first, then
RSA, then Ed25519 (other than OpenSSH, which prefers Ed25519). On a server without an ECDSA key, use
`ssh_host_rsa_key.pub`, and `ssh_host_ed25519_key.pub` only when that is its one key. A mismatch stops
the deploy at the connection, before anything is sent.

**Demo host** (`DROPLET_KNOWN_HOSTS`): a `known_hosts` line for the host and its SSH port, one line
per key type. With it set, the deploy no longer runs `ssh-keyscan` and refuses any other key.

```bash
# On the demo host. Use the address in DROPLET_HOST and the port in DROPLET_SSH_PORT.
echo "[203.0.113.20]:2222 $(cut -d ' ' -f 1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
```

After a server is rebuilt its host keys change: update the value, or the deploy is refused.

## Cloudflare web deploy (`production`)

```bash
# Secrets
CLOUDFLARE_API_TOKEN=...          # Workers Scripts: Edit
CLOUDFLARE_ACCOUNT_ID=...

# Variables
VITE_API_URL=https://api.yourdomain.com  # The API's public URL, without the /api suffix
```

Optional as a whole: without the two secrets the job is skipped with a notice. See the
[Cloudflare guide](./providers/cloudflare.md).

## Terraform (manual runs only)

```bash
# Secrets
DIGITALOCEAN_TOKEN=dop_v1_xxx
SSH_PUBLIC_KEY=ssh-ed25519 AAAA...
GCP_SA_KEY=...                    # gcp only
GCP_DB_USERNAME=...               # gcp only, optional
GCP_DB_PASSWORD=...               # gcp only
AWS_ACCESS_KEY_ID=...             # An S3-compatible state backend (DigitalOcean Spaces, AWS S3)
AWS_SECRET_ACCESS_KEY=...

# Variables (all optional)
DO_REGION=nyc1
DO_INSTANCE_SIZE=s-1vcpu-1gb
DO_ENABLE_MANAGED_DB=false
DO_DATABASE_SIZE=db-s-1vcpu-1gb
GCP_PROJECT_ID=...
GCP_REGION=us-central1
GCP_ZONE=us-central1-a
GCP_INSTANCE_SIZE=e2-small
GCP_ENABLE_MANAGED_DB=false
GCP_DATABASE_SIZE=db-f1-micro
```

`infra/cloud` is reference code. This repository ships no state backend, and the workflow refuses
`terraform apply` until the provider directory declares a remote one; `plan` runs without it. After
an apply, set `DEPLOY_HOST` and `DOMAIN` on the environment from the outputs the run prints.

## CI (`ci.yml`)

CI needs no secret to pass. It reads `REGISTRY`, `IMAGE_NAME`, `SITE_URL`, `REGISTRY_USERNAME` and
`REGISTRY_PASSWORD` (the `images` job, with the same defaults as above) and, in the nightly lane,
`LHCI_GITHUB_APP_TOKEN` (optional, for Lighthouse status checks).

## In-Network Encrypted Backups & PITR (`infra/runtime/backup`)

Configured on the database host in `/etc/bslt-backup.env` (mode `0600`), never in GitHub Actions:
`BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` (`openssl rand -hex 32`), `BACKUP_S3_BUCKET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `BACKUP_S3_*` variables: see
[backup-restore.md](./backup-restore.md#which-role-takes-the-backup) and
[infra/runtime/backup/README.md](../../infra/runtime/backup/README.md).

## Pre-Deployment Checklist

- [ ] The environments `staging`, `production` and `demo` exist, with the protection you want.
- [ ] The database server is up, and `DB_HOST` is its private address.
- [ ] All required secrets are set.
- [ ] `SSH_PRIVATE_KEY` matches a public key in the app server user's `authorized_keys`.
- [ ] DNS `A`/`AAAA` records point to the app server.
- [ ] The app server's firewall allows `22`, `80`, `443`; the database server's allows `5432` from the app server only.
- [ ] `DB_PASSWORD` (or `POSTGRES_PASSWORD`) is the database server's superuser password, random and strong.
- [ ] `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` and `DB_WORKER_PASSWORD` are set, URL-safe, and all different from each other and from `DB_PASSWORD`.
- [ ] `JWT_SECRET`, `COOKIE_SECRET`, and `OAUTH_TOKEN_ENCRYPTION_KEY` are unique per environment.
- [ ] `EMAIL_FROM_ADDRESS` uses your product domain, and `SMTP_HOST` points to a real production relay.

## Notes

- The deploy workflow writes the remote `.env` file automatically on each deploy, readable by the deploy user only (mode `600`), with every value resolved.
- On every deploy the workflow asks the database server for its version, then runs, in this order: `bootstrap-roles`, `migrate`, `docker compose up -d`. If any of them fails the deploy stops and the running API is not replaced.
- A rollback (`rollback_sha`) needs the registry credentials and the SSH key only; it reads none of the database secrets.
- A target that is not configured (no `DEPLOY_HOST`, no `DROPLET_HOST`, no Cloudflare token) is skipped with a warning on an automatic run and fails a manual one.

## Secret Generation

```bash
# Database secrets (URL-safe; required for the three role passwords)
openssl rand -hex 32

# Everything else
openssl rand -base64 32
```

## Troubleshooting

### SSH connection failed

- Verify `SSH_PRIVATE_KEY` and target host/user values.
- Test manually: `ssh -i ~/.ssh/id_ed25519 user@host`.
- Confirm the same public key is present in `~/.ssh/authorized_keys` on the server.

### Registry push failed

- Verify `REGISTRY_USERNAME` and `REGISTRY_PASSWORD`.
- Confirm package publish permissions for your repository.

### "could not ask the database server ... for its version"

- From the app server: `nc -vz <DB_HOST> <DB_PORT>`.
- On the database server: the app server's address must be inside `APP_SERVER_CIDR`, and
  `DB_NAME` must be its `POSTGRES_DB`.
- `DB_PASSWORD` must be the superuser password the database server was started with.

### "No app server is configured"

- Set the variable `DEPLOY_HOST` (or `INSTANCE_IP`) and the secret `SSH_PRIVATE_KEY` on the
  environment.
