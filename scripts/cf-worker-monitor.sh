#!/usr/bin/env bash
# cf-worker-monitor.sh — Ping Cloudflare worker every 15 minutes.
# Fires an FCM push to dev's DM if it's down.
# Run via cron or LaunchAgent.

set -uo pipefail

WORKER_URL="https://onlymonkes-actions.jumpstreet25.workers.dev"
BOT_DIR="${HOME}/Monke_Eliza/agents/monke-trader"
LOG="/tmp/cf-worker-monitor.log"

# Load bot .env for FCM key
if [ -f "${BOT_DIR}/.env" ]; then
  export $(grep -E "^(FCM_SERVER_KEY|DEV_INBOX_ID)" "${BOT_DIR}/.env" | xargs)
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pinging worker..." >> "$LOG"

# Ping with 10s timeout
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${WORKER_URL}" 2>/dev/null)

if [ "$HTTP_CODE" = "000" ] || [ "$HTTP_CODE" = "" ]; then
  STATUS="TIMEOUT"
elif [ "$HTTP_CODE" -ge 500 ]; then
  STATUS="DOWN (HTTP ${HTTP_CODE})"
elif [ "$HTTP_CODE" -ge 400 ] && [ "$HTTP_CODE" != "404" ]; then
  STATUS="ERROR (HTTP ${HTTP_CODE})"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Worker OK (HTTP ${HTTP_CODE})" >> "$LOG"
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ Worker ${STATUS}" >> "$LOG"

# Send alert via bot's XMTP DM (using bun to call the bot's DM function)
cd "${BOT_DIR}" || exit 1
bun -e "
const { sendDmAlert } = require('./src/lib/alerts/workerMonitor.js');
sendDmAlert('⚠️ Cloudflare Worker Alert\\n\\nStatus: ${STATUS}\\nURL: ${WORKER_URL}\\nTime: $(date)\\n\\nCheck: wrangler tail onlymonkes-actions').catch(console.error);
" 2>> "$LOG" || true

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Alert sent to dev DM" >> "$LOG"
