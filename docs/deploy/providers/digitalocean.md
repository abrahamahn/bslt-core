# DigitalOcean Deployment Guide

Step-by-step guide to deploy the starter app on a DigitalOcean Droplet.

> **Two servers.** Production runs the database on its own server
> ([why and how](../README.md#two-servers)). This guide sets up the **app server**. Create a second
> machine on the same private network first and start
> `infra/docker/production/docker-compose.db.yml` on it; the app server needs that machine's
> private address (`POSTGRES_HOST`) and superuser password. Commands below that say
> `docker-compose.db.yml` run on the database server, in the directory holding that file and its
> `.env.database`.

---

## Prerequisites

- DigitalOcean account
- Domain name with DNS access
- SSH key pair (for secure access)
- A second Droplet for the database, in the same VPC (private networking is on by default
  within a region)

---

## 1. Create Droplet

### Via DigitalOcean Console

1. Go to **Create → Droplets**
2. Choose **Ubuntu 24.04 LTS**
3. Select plan:
   - **Basic**: $12/mo (2 GB RAM, 1 vCPU) - minimum for small apps
   - **Regular**: $24/mo (4 GB RAM, 2 vCPUs) - recommended for production
4. Choose datacenter region closest to your users
5. Add your SSH key
6. Set hostname: `your-app-prod`
7. Click **Create Droplet**

### Via doctl CLI

```bash
# Install doctl: https://docs.digitalocean.com/reference/doctl/how-to/install/

# Authenticate
doctl auth init

# Create droplet
doctl compute droplet create your-app-prod \
  --image ubuntu-24-04-x64 \
  --size s-2vcpu-4gb \
  --region nyc1 \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header | head -1) \
  --wait
```

---

## 2. Configure DNS

Point your domain to the Droplet IP:

| Type | Name | Value          | TTL |
| ---- | ---- | -------------- | --- |
| A    | @    | `<droplet-ip>` | 300 |
| A    | www  | `<droplet-ip>` | 300 |

Wait for DNS propagation (usually 5-15 minutes).

```bash
# Verify DNS
dig +short example.com
```

---

## 3. Initial Server Setup

SSH into your droplet:

```bash
ssh root@<droplet-ip>
```

### Create Deploy User

```bash
# Create non-root user
adduser deploy
usermod -aG sudo deploy

# Copy SSH keys to new user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Test login (in new terminal)
# ssh deploy@<droplet-ip>
```

### Configure Firewall

```bash
# Enable UFW firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable

# Verify
ufw status
```

### System Updates

```bash
apt update && apt upgrade -y
apt install -y curl git
```

---

## 4. Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add deploy user to docker group
usermod -aG docker deploy

# Enable Docker to start on boot
systemctl enable docker

# Verify installation
docker --version
docker compose version
```

Log out and back in for group changes to take effect:

```bash
exit
ssh deploy@<droplet-ip>
```

---

## 5. Clone and Configure

```bash
# Clone repository
cd ~
git clone https://github.com/your-org/your-app.git
cd your-app

# Create production environment file
cp config/env/.env.production.example config/env/.env.production
```

### Generate Secrets

```bash
# Generate secure secrets (a line appended here wins over the blank template line)
ENV_FILE=config/env/.env.production
# The database server (set it up first: docs/deploy/README.md#two-servers):
# its private address, and the superuser password from its .env.database.
DB_HOST=10.0.0.5
echo "POSTGRES_HOST=${DB_HOST}" >> "$ENV_FILE"
echo "POSTGRES_PASSWORD=<POSTGRES_PASSWORD from the database server>" >> "$ENV_FILE"
echo "JWT_SECRET=$(openssl rand -base64 32)" >> "$ENV_FILE"
echo "COOKIE_SECRET=$(openssl rand -base64 32)" >> "$ENV_FILE"
echo "OAUTH_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> "$ENV_FILE"

# One password per database role, kept only in that role's URL. Hex, because
# the URLs carry them unencoded (base64 has `/`, `+` and `=`).
DB_NAME=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)
echo "DATABASE_URL=postgresql://bslt_app:$(openssl rand -hex 32)@pgbouncer:5432/${DB_NAME}" >> "$ENV_FILE"
WORKER_PASSWORD=$(openssl rand -hex 32)
echo "WORKER_DATABASE_URL=postgresql://bslt_worker:${WORKER_PASSWORD}@pgbouncer:5432/${DB_NAME}" >> "$ENV_FILE"
# The worker role again, straight at the database server: the pub/sub LISTEN connection.
echo "LISTEN_DATABASE_URL=postgresql://bslt_worker:${WORKER_PASSWORD}@${DB_HOST}:5432/${DB_NAME}" >> "$ENV_FILE"
echo "MIGRATION_DATABASE_URL=postgresql://bslt_owner:$(openssl rand -hex 32)@${DB_HOST}:5432/${DB_NAME}" >> "$ENV_FILE"
```

The API connects as `bslt_app` and `bslt_worker`, never as the `postgres`
superuser. See [Database roles](../env.md#database-roles).

### Edit Environment File

```bash
nano config/env/.env.production
```

Update these values:

```bash
# Required
DOMAIN=yourdomain.com
ACME_EMAIL=admin@yourdomain.com
API_BASE_URL=https://yourdomain.com
APP_URL=https://yourdomain.com
POSTGRES_PASSWORD=<generated>
DATABASE_URL=<generated>
WORKER_DATABASE_URL=<generated>
LISTEN_DATABASE_URL=<generated>
MIGRATION_DATABASE_URL=<generated>
JWT_SECRET=<generated>
COOKIE_SECRET=<generated>
OAUTH_TOKEN_ENCRYPTION_KEY=<generated>
EMAIL_PROVIDER=smtp
EMAIL_FROM_ADDRESS=no-reply@yourdomain.com
SMTP_HOST=smtp.mail.yourdomain.com

# Optional (update as needed)
NODE_ENV=production
```

Secure the file:

```bash
chmod 600 config/env/.env.production
```

---

## 6. Deploy

### Build and Start

```bash
cd ~/your-app

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

# View logs
compose logs -f
```

### Verify Deployment

```bash
# Check services are running
docker compose -f infra/docker/production/docker-compose.prod.yml ps

# Test health endpoint
curl http://localhost:8080/health

# Test HTTPS (after Caddy obtains certificate)
curl https://example.com/health
```

---

## 7. Set Up Systemd (Auto-restart)

Create a systemd service for automatic restarts:

```bash
sudo nano /etc/systemd/system/your-app.service
```

```ini
[Unit]
Description=Starter Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=deploy
WorkingDirectory=/home/deploy/your-app
ExecStart=/usr/bin/docker compose -f infra/docker/production/docker-compose.prod.yml --env-file config/env/.env.production up -d
ExecStop=/usr/bin/docker compose -f infra/docker/production/docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable starter
sudo systemctl start starter

# Check status
sudo systemctl status starter
```

---

## 8. Database Backups

The `pg_dump` and restore commands in this section run on the **database server**
(the ones that stop and start the API run on the app server).

### Automated Daily Backups

Create backup script:

```bash
sudo nano /home/deploy/backup-db.sh
```

```bash
#!/bin/bash
set -e

BACKUP_DIR="/home/deploy/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/your_app_prod_$TIMESTAMP.sql.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

# Dump and compress
docker compose --env-file .env.database -f docker-compose.db.yml \
  exec -T postgres pg_dump -U postgres your_app_prod | gzip > $BACKUP_FILE

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "Backup created: $BACKUP_FILE"
```

```bash
chmod +x /home/deploy/backup-db.sh
```

Add to crontab:

```bash
crontab -e
```

```cron
# Daily backup at 3 AM
0 3 * * * /home/deploy/backup-db.sh >> /home/deploy/backups/backup.log 2>&1
```

### Manual Backup

```bash
# Create backup
docker compose --env-file .env.database -f docker-compose.db.yml \
  exec -T postgres pg_dump -U postgres your_app_prod > backup.sql

# Compress
gzip backup.sql
```

### Restore from Backup

```bash
# App server: stop the API to prevent writes
docker compose -f infra/docker/production/docker-compose.prod.yml stop api

# Database server: restore (as the postgres superuser: the app's own roles cannot restore)
gunzip -c backup.sql.gz | docker compose --env-file .env.database -f docker-compose.db.yml \
  exec -T postgres psql -U postgres your_app_prod

# Database roles, then migrations, then the API: same order as a deploy.
# A backup can predate the role split or the current schema.
compose() {
  docker compose -f infra/docker/production/docker-compose.prod.yml \
    --env-file config/env/.env.production "$@"
}
compose run --rm bootstrap-roles && compose run --rm migrate && compose start api
```

---

## 9. Updates and Maintenance

### Deploy Updates

```bash
cd ~/your-app

# Pull latest code
git pull

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

# View logs for any issues
compose logs -f --tail=100
```

### View Logs

```bash
# All services
docker compose -f infra/docker/production/docker-compose.prod.yml logs -f

# Specific service
docker compose -f infra/docker/production/docker-compose.prod.yml logs -f api
docker compose -f infra/docker/production/docker-compose.prod.yml logs -f caddy
```

### Restart Services

```bash
# Restart all
docker compose -f infra/docker/production/docker-compose.prod.yml restart

# Restart specific service
docker compose -f infra/docker/production/docker-compose.prod.yml restart api
```

---

## 10. Monitoring (Optional)

### DigitalOcean Monitoring

Enable in Droplet settings → **Monitoring** tab. Provides:

- CPU, memory, disk usage
- Bandwidth metrics
- Alerts

### Docker Stats

```bash
# Real-time container stats
docker stats

# Disk usage
docker system df
```

### Log Rotation

Docker handles log rotation automatically with `json-file` driver. To configure limits:

```bash
sudo nano /etc/docker/daemon.json
```

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

```bash
sudo systemctl restart docker
```

---

## Security Checklist

Before going live:

- [ ] Non-root user created (`deploy`)
- [ ] SSH key authentication only (disable password)
- [ ] Firewall enabled (UFW: 22, 80, 443 only)
- [ ] Strong secrets generated (not defaults)
- [ ] Environment file secured (`chmod 600`)
- [ ] Database not exposed externally
- [ ] Automated backups configured
- [ ] HTTPS working (check certificate)
- [ ] DNS propagated correctly

### Disable Password Authentication (Recommended)

```bash
sudo nano /etc/ssh/sshd_config
```

Set:

```
PasswordAuthentication no
PubkeyAuthentication yes
```

```bash
sudo systemctl restart sshd
```

---

## Troubleshooting

### Caddy Certificate Issues

```bash
# Check Caddy logs
docker compose -f infra/docker/production/docker-compose.prod.yml logs caddy

# Common issues:
# - DNS not pointing to server IP
# - Ports 80/443 blocked by firewall
# - Rate limited (use staging CA for testing)
```

### API Won't Start

```bash
# Check API logs
docker compose -f infra/docker/production/docker-compose.prod.yml logs api

# Common issues:
# - Database not ready (check postgres health)
# - Missing environment variables
# - Port conflict
```

### Database Connection Failed

```bash
# On the database server: check postgres is running
docker compose --env-file .env.database -f docker-compose.db.yml ps postgres

# Check postgres logs
docker compose --env-file .env.database -f docker-compose.db.yml logs postgres

# Test connection
docker compose --env-file .env.database -f docker-compose.db.yml exec postgres \
  psql -U postgres -d your_app_prod -c "SELECT 1"
```

### Out of Disk Space

```bash
# Check disk usage
df -h

# Clean Docker resources
docker system prune -a --volumes
```

---

## Cost Summary

| Resource                      | Spec              | Monthly Cost |
| ----------------------------- | ----------------- | ------------ |
| Droplet (Basic)               | 2 GB RAM, 1 vCPU  | $12          |
| Droplet (Regular)             | 4 GB RAM, 2 vCPUs | $24          |
| Managed Database (optional)   | 1 GB RAM          | $15          |
| Spaces (S3 storage, optional) | 250 GB            | $5           |
| **Minimum Total**             |                   | **$12/mo**   |
| **Recommended Total**         |                   | **$24/mo**   |

---

## Related Documentation

- [Deployment README](../README.md) - Overview and quick start
- [Reverse Proxy & Trusted Proxy](../reverse-proxy.md) - Caddy setup, routing, and IP extraction
- [GCP Deployment](./gcp.md) - Alternative cloud option
