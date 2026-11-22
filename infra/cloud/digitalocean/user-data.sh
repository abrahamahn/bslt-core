#!/bin/bash
# Cloud-init script for starter app DigitalOcean deployment
# Bootstraps the host with Docker, UFW, and security tooling.
# The application stack is deployed via Docker Compose by CI/CD.
# Caddy, Node.js, and the app run entirely inside Docker containers —
# do NOT install them on the host.

set -euo pipefail

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------
apt-get update
apt-get upgrade -y
apt-get install -y \
    curl \
    wget \
    git \
    unzip \
    htop \
    jq \
    ufw \
    fail2ban \
    unattended-upgrades

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# ---------------------------------------------------------------------------
# Application user
# ---------------------------------------------------------------------------
useradd -m -s /bin/bash deploy
mkdir -p /home/deploy/${app_name}
chown -R deploy:deploy /home/deploy/${app_name}
# Allow deploy user to manage containers without sudo
usermod -aG docker deploy
if [ -f /root/.ssh/authorized_keys ]; then
    install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
    install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
fi

# ---------------------------------------------------------------------------
# Firewall (UFW)
# Caddy (in Docker) owns 80/443 — the app port is internal only.
# ---------------------------------------------------------------------------
ufw --force enable
ufw allow ssh
ufw allow 80
ufw allow 443

# ---------------------------------------------------------------------------
# Security: automatic security updates + fail2ban
# ---------------------------------------------------------------------------
dpkg-reconfigure --frontend=noninteractive unattended-upgrades

# ---------------------------------------------------------------------------
# Log rotation
# ---------------------------------------------------------------------------
cat > /etc/logrotate.d/${app_name} << EOF
/home/deploy/${app_name}/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 644 deploy deploy
}
EOF

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
apt-get autoremove -y
apt-get clean

echo "Starter host bootstrap complete. Deploy the application stack with Docker Compose."
