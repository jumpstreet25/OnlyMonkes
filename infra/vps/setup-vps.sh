#!/bin/bash
# ── OnlyMonkes VPS Setup Script ──────────────────────────────────
# Run as root on a fresh Ubuntu 24.04 Hetzner CX32
# Usage: ssh root@<VPS_IP> 'bash -s' < setup-vps.sh
set -euo pipefail

USERNAME="monke"
SSH_PORT=2222

echo "═══ OnlyMonkes VPS Setup ═══"

# ── 1. Create non-root user ──
echo "[1/8] Creating user '$USERNAME'..."
if ! id "$USERNAME" &>/dev/null; then
  adduser --disabled-password --gecos "" "$USERNAME"
  usermod -aG sudo "$USERNAME"
  # Copy SSH keys from root
  mkdir -p /home/$USERNAME/.ssh
  cp /root/.ssh/authorized_keys /home/$USERNAME/.ssh/
  chown -R $USERNAME:$USERNAME /home/$USERNAME/.ssh
  chmod 700 /home/$USERNAME/.ssh
  chmod 600 /home/$USERNAME/.ssh/authorized_keys
  # Passwordless sudo
  echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME
fi

# ── 2. SSH hardening ──
echo "[2/8] Hardening SSH..."
sed -i "s/^#\?Port .*/Port $SSH_PORT/" /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication .*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl restart sshd

# ── 3. Firewall ──
echo "[3/8] Configuring firewall..."
apt-get update -qq
apt-get install -y -qq ufw fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow $SSH_PORT/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP (ACME)"
ufw allow 443/tcp comment "HTTPS"
echo "y" | ufw enable

# ── 4. Fail2ban ──
echo "[4/8] Configuring fail2ban..."
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled = true
port = 2222
maxretry = 5
bantime = 3600
findtime = 600
JAIL
systemctl enable fail2ban
systemctl restart fail2ban

# ── 5. Auto security updates ──
echo "[5/8] Enabling automatic security updates..."
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# ── 6. Install Docker ──
echo "[6/8] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker $USERNAME
fi

# ── 7. Create project directory ──
echo "[7/8] Creating project structure..."
mkdir -p /opt/monke/data/bot
mkdir -p /opt/monke/data/lightrag
mkdir -p /opt/monke/bot
mkdir -p /opt/monke/grafana/provisioning/datasources
mkdir -p /opt/monke/grafana/provisioning/dashboards
chown -R $USERNAME:$USERNAME /opt/monke

# ── 8. Swap file (2GB safety net) ──
echo "[8/8] Creating 2GB swap..."
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Reduce swappiness — only use under pressure
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

echo ""
echo "═══ VPS Setup Complete ═══"
echo ""
echo "Next steps:"
echo "  1. SSH in as: ssh -p $SSH_PORT $USERNAME@<VPS_IP>"
echo "  2. Copy infra files to /opt/monke/"
echo "  3. Run migrate-data.sh from your Mac"
echo "  4. Configure .env and .env.lightrag"
echo "  5. docker compose up -d"
echo ""
echo "IMPORTANT: You are now locked out of root SSH."
echo "Use: ssh -p $SSH_PORT $USERNAME@<VPS_IP>"
