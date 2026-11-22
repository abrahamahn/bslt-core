# Staging Environment Setup

Staging mirrors production using a separate **Terraform workspace**. Each
workspace has its own isolated state file — staging and production never share
state, so a plan in one environment never touches resources in the other.

## Prerequisites

- Terraform >= 1.0
- DigitalOcean API token (or GCP credentials)
- SSH key pair for server access
- Domain name for staging (e.g., `staging.yourdomain.com`)

---

## 1. Create workspaces (first time only)

```bash
cd infra/cloud

terraform workspace new staging
terraform workspace new production

# Confirm
terraform workspace list
#   default
# * staging
#   production
```

> Never deploy from the `default` workspace. It exists only as Terraform's
> built-in fallback and has no corresponding environment.

---

## 2. Configure variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and fill in your credentials. For staging, use
smaller instance sizes and disable managed DB to keep costs low:

```hcl
domain              = "staging.yourdomain.com"
ssh_public_key      = "ssh-ed25519 AAAA... your-key"
digitalocean_token  = "dop_v1_..."

instance_size           = "s-1vcpu-1gb"
enable_managed_database = false
database_node_count     = 1

# Restrict SSH to your IP in staging too
ssh_allowed_cidrs = ["your.ip.address/32"]
```

---

## 3. Deploy staging

```bash
terraform workspace select staging
terraform init       # only needed once per workspace
terraform plan
terraform apply
```

---

## 4. Deploy production

```bash
terraform workspace select production
terraform plan
terraform apply
```

Production should use larger resources — override in `terraform.tfvars` or
pass `-var` flags:

```bash
terraform apply \
  -var="instance_size=s-2vcpu-4gb" \
  -var="enable_managed_database=true" \
  -var="database_node_count=2"
```

---

## 5. Application deployment

After infrastructure is provisioned, deploy the application stack:

```bash
# The database runs on its own server: set that one up first
# (docs/deploy/README.md#two-servers). This is the app server.
# SSH in (IP from terraform output)
ssh deploy@$(terraform output -raw instance_public_ip)

# On the server — pull the compose stack and run it
git clone <repo-url> /home/deploy/abe
cd /home/deploy/abe

# RESOURCE_PREFIX is not optional if production has EVER run on this host.
#
# Docker treats `container_name:` and a volume's `name:` as absolute — the
# compose project name does not prefix them. Without a distinct prefix, staging
# shares production's container names and its uploads, Redis and Caddy volumes.
# (The database is no longer among them: it runs on its own server. Give the
# staging database its own server too, or its own RESOURCE_PREFIX and
# POSTGRES_PORT on a shared one.) HTTP_PORT/HTTPS_PORT keep the two Caddys off
# each other's :80/:443.
#
# On a host dedicated to staging you can omit all three, and it behaves as before.
# Exported, not prefixed to one command: every compose command below must see them.
export RESOURCE_PREFIX=abe-staging HTTP_PORT=8080 HTTPS_PORT=8443

compose() {
  docker compose -f infra/docker/production/docker-compose.prod.yml \
    --env-file config/env/.env.staging "$@"
}

# The same steps, in this order, on every deploy. `&&` is the point: the API
# must not start if a database step failed.
compose --profile ops build &&        # api, web and the two one-shot database jobs
  compose run --rm bootstrap-roles && # superuser: create or repair bslt_owner, bslt_app, bslt_worker
  compose run --rm migrate &&         # bslt_owner: apply pending migrations
  compose up -d                       # the API starts only after both succeeded
```

`config/env/.env.staging` needs the database server's address
(`POSTGRES_HOST`), the four database role URLs and the secrets: see
"Production (Docker)" in
[docs/deploy/README.md](../../docs/deploy/README.md) for the commands that
generate them, and use different passwords from production.

---

## 6. CI/CD integration

The app is deployed by `.github/workflows/deploy.yml`: a push to `staging` deploys the `staging`
environment, a push to `main` (once CI passed) deploys `production`.

Terraform is not part of a deploy. The same workflow has a manual `terraform` input (`plan` or
`apply`, per environment and provider). It selects the workspace named after the environment, and it
refuses `apply` until the provider directory declares a remote, locked state backend, because state
on a runner's disk is lost when the job ends. This repository ships none and applies nothing; add
the backend in your fork, or run Terraform from a workstation as above.

---

## 7. Resource comparison

| Resource   | Staging       | Production                 |
| ---------- | ------------- | -------------------------- |
| Compute    | s-1vcpu-1gb   | s-2vcpu-4gb+               |
| Managed DB | Disabled      | Optional (2+ nodes for HA) |
| Backups    | Disabled      | Enabled                    |
| TLS        | Let's Encrypt | Let's Encrypt              |
| Monitoring | Enabled       | Enabled                    |

---

## 8. Teardown

```bash
terraform workspace select staging
terraform destroy
```
