# DigitalOcean Auto-Deploy (Push to Deploy)

This project includes one deploy workflow, [`.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml),
that deploys to DigitalOcean Droplets over SSH.

What you get:

- `main` push -> CI builds and pushes the images -> the Deploy workflow deploys production once CI passed.
- `staging` push -> the Deploy workflow runs the merge gate, builds the images and deploys staging.
- A manual run deploys an environment, rolls it back to a given commit, or runs Terraform.

The layout is [two servers](../README.md#two-servers): a Droplet for the database and a Droplet for
the app, in the same VPC.

## 1) One-time setup of the two Droplets

On each fresh Ubuntu 24.04 Droplet, run the bootstrap script from this repo:

```bash
# inside repository on your local machine
scp infra/cloud/digitalocean/bootstrap-once.sh root@<droplet_ip>:/root/bootstrap-once.sh
ssh root@<droplet_ip> 'chmod +x /root/bootstrap-once.sh && /root/bootstrap-once.sh --app-name your-app --deploy-user deploy'
```

After this, the server has Docker, UFW, fail2ban, unattended upgrades, and a deploy user.

Then, **on the database Droplet**, start Postgres (the app Droplet's private address is the only
client it admits):

```bash
scp infra/docker/production/docker-compose.db.yml deploy@<db_droplet_ip>:~/
ssh deploy@<db_droplet_ip>
( umask 077 && cat > .env.database << EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
POSTGRES_DB=abe_stack
DB_LISTEN_ADDRESS=<db droplet private ip>
APP_SERVER_CIDR=<app droplet private ip>/32
EOF
)
docker compose --env-file .env.database -f docker-compose.db.yml up -d
```

Allow port 5432 from the app Droplet's private address in the database Droplet's firewall, and
nothing else.

## 2) GitHub environments, secrets and variables

Create the environments `production` and `staging` (and `demo` if you use the demo host). The full
list of names is the [secrets checklist](../secrets-checklist.md); the ones a DigitalOcean app
deploy needs:

Secrets:

- `SSH_PRIVATE_KEY` (private key the deploy uses to SSH into the app Droplet)
- `ACME_EMAIL`
- `DB_PASSWORD` or `POSTGRES_PASSWORD` (the database Droplet's superuser password, from its `.env.database`; used by the role bootstrap and PgBouncer, never by the API)
- `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `DB_WORKER_PASSWORD` (one independent, URL-safe password per database role; generate each with `openssl rand -hex 32`)
- `JWT_SECRET`
- `COOKIE_SECRET`
- `OAUTH_TOKEN_ENCRYPTION_KEY`
- `EMAIL_FROM_ADDRESS` (optional; defaults to `no-reply@<domain>`)
- `SMTP_HOST` (optional; defaults to `smtp.mail.<domain>`)
- `REGISTRY_USERNAME`, `REGISTRY_PASSWORD` (optional; default: the workflow's own token on ghcr.io)
- `DIGITALOCEAN_TOKEN`, `SSH_PUBLIC_KEY` (only for the manual Terraform run)

Variables:

- `DEPLOY_HOST` (the app Droplet's address; `INSTANCE_IP` is also read)
- `DOMAIN`
- `DB_HOST` (**required**: the database Droplet's private address)
- `DB_PORT`, `DB_NAME` (optional; default `5432` and `abe_stack`)
- `SSH_USERNAME`, `SSH_PORT` (optional)
- `REGISTRY` (default `ghcr.io`), `IMAGE_NAME` (e.g. `your-org/your-app`)
- Optional DO sizing values for Terraform (`DO_REGION`, `DO_INSTANCE_SIZE`, etc.)

## 3) Create infrastructure (one-time)

Option A: create the two Droplets by hand (or with `doctl`), point DNS at the app Droplet, and set
`DEPLOY_HOST`, `DOMAIN` and `DB_HOST`.

Option B: Terraform. `infra/cloud` is reference code for the app server and is not applied from this
repository: the Deploy workflow's `terraform` input runs `plan` as is, and refuses `apply` until
your fork declares a remote, locked state backend (`infra/cloud/main.tf` lists the options). Run
Actions -> "Deploy" -> Run workflow with `terraform` = `plan` or `apply`, `provider` =
`digitalocean` and the environment. It does not create the database Droplet.

## 4) Deploy application

- Automatic production deploy:
  - Push to `main`
  - The `CI` workflow passes and its `images` job publishes the images
  - The `Deploy` workflow is started by `workflow_run` and deploys them by digest
  - On the app server it asks the database server for its version, runs `bootstrap-roles` (database roles), then `migrate`, then `docker compose up -d`; a failure of any step stops the deploy before the running API is replaced

- Automatic staging deploy:
  - Push to `staging`

- Rollback: Actions -> "Deploy" -> Run workflow with `rollback_sha` = the full SHA of the last good commit.

## 5) Verify

- GitHub Actions:
  - `CI` succeeds
  - `Deploy` succeeds
- On the app server:

```bash
ssh <user>@<droplet_ip>
docker ps
curl -I https://<domain>/health
```

## Notes

- A deploy never restarts the database Droplet's Postgres, and never takes the app stack down first.
- Keep SSH access restricted (set `ssh_allowed_cidrs` in Terraform for production).
