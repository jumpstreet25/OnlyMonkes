#!/bin/bash
# ── OnlyMonkes Data Migration: Mac → VPS ─────────────────────────
# Run this from your Mac AFTER setup-vps.sh and AFTER stopping the bot
# Usage: ./migrate-data.sh <VPS_IP> [SSH_PORT]
set -euo pipefail

VPS_IP="${1:?Usage: ./migrate-data.sh <VPS_IP> [SSH_PORT]}"
SSH_PORT="${2:-2222}"
VPS_USER="monke"
VPS_DIR="/opt/monke"

BOT_DIR="$HOME/Monke_Eliza/agents/monke-trader"
INFRA_DIR="$HOME/AndroidStudioProjects/OnlyMonkes/infra"
VPS_INFRA="$HOME/AndroidStudioProjects/OnlyMonkes/infra/vps"

echo "═══ OnlyMonkes Data Migration ═══"
echo "Target: $VPS_USER@$VPS_IP:$SSH_PORT"
echo ""

# ── 0. Pre-flight checks ──
echo "[0] Pre-flight checks..."
if pgrep -f "bun.*monke-trader" > /dev/null 2>&1; then
  echo "⚠️  Bot appears to be running! Stop it first:"
  echo "   launchctl unload ~/Library/LaunchAgents/com.onlymonkes.monketrader.plist"
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Verify critical files exist
for f in ".xmtp_bot_key" ".xmtp_bot.db3" ".env" "package.json" "src/index.ts"; do
  if [ ! -f "$BOT_DIR/$f" ]; then
    echo "FATAL: Missing $BOT_DIR/$f"
    exit 1
  fi
done
echo "  All critical files found."

# ── 1. Package bot source (exclude node_modules) ──
echo "[1] Packaging bot source..."
TMPDIR=$(mktemp -d)
tar czf "$TMPDIR/bot-source.tar.gz" \
  -C "$BOT_DIR" \
  --exclude='node_modules' \
  --exclude='.xmtp_monketrader.db3*' \
  --exclude='.xmtp_ta_savvy.db3*' \
  package.json bun.lock src/ tsconfig.json app.json \
  2>/dev/null
echo "  bot-source.tar.gz ($(du -h "$TMPDIR/bot-source.tar.gz" | cut -f1))"

# ── 2. Package bot data (secrets + state) ──
echo "[2] Packaging bot data..."
cd "$BOT_DIR"

# Build file list (only files that exist)
DATA_FILES=()
for f in \
  .xmtp_bot_key \
  .xmtp_bot.db3 .xmtp_bot.db3-shm .xmtp_bot.db3-wal .xmtp_bot.db3.sqlcipher_salt \
  .xmtp_welcomed.json \
  .sports_alerted.json \
  .signal_log.json \
  .holder_snapshots.json \
  .automonke_state.json \
  .automonke_wallets.json; do
  [ -f "$f" ] && DATA_FILES+=("$f")
done

tar czf "$TMPDIR/bot-data.tar.gz" "${DATA_FILES[@]}" 2>/dev/null
echo "  bot-data.tar.gz ($(du -h "$TMPDIR/bot-data.tar.gz" | cut -f1))"

# ── 3. Package .env (separate for clarity) ──
echo "[3] Packaging .env..."
cp "$BOT_DIR/.env" "$TMPDIR/bot.env"

# ── 4. Package ElizaDB + Hermes Memory ──
echo "[4] Packaging databases..."
if [ -d "$BOT_DIR/.eliza" ]; then
  tar czf "$TMPDIR/bot-eliza.tar.gz" -C "$BOT_DIR" .eliza/
  echo "  bot-eliza.tar.gz ($(du -h "$TMPDIR/bot-eliza.tar.gz" | cut -f1))"
fi
if [ -d "$BOT_DIR/.hermes_memory" ] || [ -d "$HOME/.hermes_memory" ]; then
  HERMES_DIR="$BOT_DIR/.hermes_memory"
  [ -d "$HERMES_DIR" ] || HERMES_DIR="$HOME/.hermes_memory"
  tar czf "$TMPDIR/bot-hermes.tar.gz" -C "$(dirname "$HERMES_DIR")" "$(basename "$HERMES_DIR")/"
  echo "  bot-hermes.tar.gz ($(du -h "$TMPDIR/bot-hermes.tar.gz" | cut -f1))"
fi

# ── 5. Package LightRAG data ──
echo "[5] Packaging LightRAG data..."
if [ -d "$INFRA_DIR/data/lightrag" ]; then
  tar czf "$TMPDIR/lightrag-data.tar.gz" -C "$INFRA_DIR/data" lightrag/
  echo "  lightrag-data.tar.gz ($(du -h "$TMPDIR/lightrag-data.tar.gz" | cut -f1))"
fi

# ── 6. Package Grafana provisioning ──
echo "[6] Packaging Grafana config..."
tar czf "$TMPDIR/grafana-provisioning.tar.gz" -C "$INFRA_DIR" grafana/provisioning/

# ── 7. Copy VPS config files ──
echo "[7] Packaging VPS config files..."
cp "$VPS_INFRA/docker-compose.yml" "$TMPDIR/"
cp "$VPS_INFRA/Dockerfile.bot" "$TMPDIR/"
cp "$VPS_INFRA/Caddyfile" "$TMPDIR/"
cp "$VPS_INFRA/prometheus.yml" "$TMPDIR/"
cp "$VPS_INFRA/.env.lightrag" "$TMPDIR/"

# ── 8. Transfer everything ──
echo ""
echo "[8] Transferring to VPS..."
SCP="scp -P $SSH_PORT"
SSH="ssh -p $SSH_PORT $VPS_USER@$VPS_IP"

# Transfer all archives
$SCP "$TMPDIR"/* "$VPS_USER@$VPS_IP:/tmp/monke-migrate/"

# ── 9. Extract on VPS ──
echo "[9] Extracting on VPS..."
$SSH << 'REMOTE'
set -euo pipefail
cd /opt/monke

# Config files
cp /tmp/monke-migrate/docker-compose.yml .
cp /tmp/monke-migrate/Caddyfile .
cp /tmp/monke-migrate/prometheus.yml .
cp /tmp/monke-migrate/.env.lightrag .

# Dockerfile into bot build context
mkdir -p bot
cp /tmp/monke-migrate/Dockerfile.bot bot/Dockerfile

# Bot source
tar xzf /tmp/monke-migrate/bot-source.tar.gz -C bot/

# Bot data
tar xzf /tmp/monke-migrate/bot-data.tar.gz -C data/bot/

# Bot .env
cp /tmp/monke-migrate/bot.env .env
chmod 600 .env

# Databases
[ -f /tmp/monke-migrate/bot-eliza.tar.gz ] && tar xzf /tmp/monke-migrate/bot-eliza.tar.gz -C data/bot/
[ -f /tmp/monke-migrate/bot-hermes.tar.gz ] && tar xzf /tmp/monke-migrate/bot-hermes.tar.gz -C data/bot/

# LightRAG data
[ -f /tmp/monke-migrate/lightrag-data.tar.gz ] && tar xzf /tmp/monke-migrate/lightrag-data.tar.gz -C data/

# Grafana provisioning
tar xzf /tmp/monke-migrate/grafana-provisioning.tar.gz -C .

# Secure sensitive files
chmod 600 data/bot/.xmtp_bot_key data/bot/.automonke_wallets.json 2>/dev/null || true

# Cleanup
rm -rf /tmp/monke-migrate

echo ""
echo "Files extracted to /opt/monke:"
find . -maxdepth 3 -not -path './bot/node_modules/*' -not -path './bot/src/*' | head -40
REMOTE

# ── 10. Cleanup local temp ──
rm -rf "$TMPDIR"

echo ""
echo "═══ Migration Complete ═══"
echo ""
echo "Next steps on VPS (ssh -p $SSH_PORT $VPS_USER@$VPS_IP):"
echo ""
echo "  1. Register DuckDNS subdomain at https://www.duckdns.org"
echo "  2. Edit .env — set DUCKDNS_SUBDOMAIN and DUCKDNS_TOKEN"
echo "  3. Edit .env.lightrag — set your Groq + Jina API keys"
echo "  4. Generate metrics password:"
echo "     docker run caddy caddy hash-password --plaintext 'yourpassword'"
echo "  5. Update DuckDNS IP:"
echo "     curl 'https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip='"
echo "  6. Launch:"
echo "     cd /opt/monke && docker compose up -d"
echo "  7. Check logs:"
echo "     docker compose logs -f bot"
echo ""
