#!/usr/bin/env bash
# autonomonke-xmtp-evolution.sh — AutonoMonke + XMTP Evolution Engine
# Focused analysis on autonomous trading and messaging subsystems.
# Called by cron (every 8h) or manually.
#
# Output: /tmp/autonomonke-xmtp-report.md

set -uo pipefail

APP_DIR="${HOME}/AndroidStudioProjects/OnlyMonkes"
BOT_DIR="${HOME}/Monke_Eliza/agents/monke-trader"
REPORT="/tmp/autonomonke-xmtp-report.md"
ARCHIVE="/tmp/autonomonke-xmtp-report-$(date +%Y%m%d-%H%M).md"

echo "# AutonoMonke + XMTP Evolution Report" > "$REPORT"
echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT"
echo "" >> "$REPORT"

# ── 1. AutonoMonke Gate Config ────────────────────────────────────────────────
echo "## 1. AutonoMonke Gate Configuration" >> "$REPORT"
if [ -f "$BOT_DIR/src/lib/automonke/engine.ts" ]; then
  echo '```' >> "$REPORT"
  grep -E "^const (MIN_|MAX_|DEFAULT_|DRAWDOWN|STOP_LOSS|TRAILING)" "$BOT_DIR/src/lib/automonke/engine.ts" 2>/dev/null | head -15 >> "$REPORT"
  echo '```' >> "$REPORT"
fi

# ── 2. AutonoMonke Enrollment + Positions ─────────────────────────────────────
echo "" >> "$REPORT"
echo "## 2. AutonoMonke State" >> "$REPORT"

STATE="$BOT_DIR/.automonke_state.json"
POSITIONS="$BOT_DIR/.automonke_positions.json"

python3 -c "
import json, os, time
state_file = '$STATE'
pos_file = '$POSITIONS'

# Enrollment
if os.path.exists(state_file):
    d = json.load(open(state_file))
    users = d.get('users', {})
    active = sum(1 for u in users.values() if u.get('active'))
    total_trades = sum(u.get('totalTrades', 0) for u in users.values())
    print(f'- Enrolled: {len(users)} | Active: {active} | Total trades: {total_trades}')
    for uid, u in users.items():
        status = 'ACTIVE' if u.get('active') else 'PAUSED'
        conf = u.get('minConfidence', '?')
        size = u.get('maxPositionSizePct', '?')
        trades = u.get('totalTrades', 0)
        print(f'  - {uid[:12]}… [{status}] conf={conf} size={size}% trades={trades}')
else:
    print('- State file not found')

# Positions
if os.path.exists(pos_file):
    positions = json.load(open(pos_file))
    open_p = [p for p in positions if not p.get('closedAt')]
    closed_p = [p for p in positions if p.get('closedAt')]
    print(f'- Positions: {len(open_p)} open, {len(closed_p)} closed')
    if closed_p:
        wins = sum(1 for p in closed_p if p.get('pnlPct', 0) > 0)
        total_pnl = sum(p.get('pnlPct', 0) for p in closed_p)
        print(f'- Closed WR: {wins}/{len(closed_p)} ({wins/len(closed_p)*100:.0f}%) | Avg PNL: {total_pnl/len(closed_p):+.2f}%')
else:
    print('- Position file not found (no trades executed yet)')
" >> "$REPORT" 2>&1

# ── 3. Wallet Vault Health ────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 3. Wallet Vault" >> "$REPORT"
VAULT="$BOT_DIR/.automonke_wallets.json"
if [ -f "$VAULT" ]; then
  wallet_count=$(python3 -c "import json; print(len(json.load(open('$VAULT'))))" 2>/dev/null || echo "?")
  vault_size=$(du -h "$VAULT" 2>/dev/null | awk '{print $1}')
  echo "- Wallets: $wallet_count | File size: $vault_size" >> "$REPORT"
  echo "- Encryption: AES-256-GCM (AUTOMONKE_VAULT_SECRET)" >> "$REPORT"
  # Check if vault secret is set
  if [ -n "${AUTOMONKE_VAULT_SECRET:-}" ]; then
    echo "- Vault secret: SET (${#AUTOMONKE_VAULT_SECRET} chars)" >> "$REPORT"
  else
    # Check bot .env
    if grep -q "AUTOMONKE_VAULT_SECRET" "$BOT_DIR/.env" 2>/dev/null; then
      echo "- Vault secret: SET in .env" >> "$REPORT"
    else
      echo "- **WARNING: AUTOMONKE_VAULT_SECRET not found in .env**" >> "$REPORT"
    fi
  fi
else
  echo "- Wallet vault not created yet" >> "$REPORT"
fi

# ── 4. XMTP App-Side Health ──────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 4. XMTP (App-Side)" >> "$REPORT"

xmtp_files=(
  "$APP_DIR/src/lib/xmtp.ts"
  "$APP_DIR/src/hooks/useXmtp.ts"
  "$APP_DIR/src/hooks/useDm.ts"
  "$APP_DIR/src/hooks/useGroupChat.ts"
  "$APP_DIR/src/lib/presence.ts"
  "$APP_DIR/src/lib/messageCache.ts"
  "$APP_DIR/src/lib/notifications.ts"
  "$APP_DIR/src/lib/userProfile.ts"
)

echo "| File | Lines | Functions |" >> "$REPORT"
echo "|------|-------|-----------|" >> "$REPORT"
for f in "${xmtp_files[@]}"; do
  if [ -f "$f" ]; then
    lines=$(wc -l < "$f" | tr -d ' ')
    funcs=$(grep -cE '(export )?(async )?function ' "$f" 2>/dev/null || echo "0")
    short=$(echo "$f" | sed "s|$APP_DIR/||")
    echo "| \`$short\` | $lines | $funcs |" >> "$REPORT"
  fi
done

# Message protocol count
echo "" >> "$REPORT"
echo "### Message Protocols" >> "$REPORT"
if [ -f "$APP_DIR/src/lib/xmtp.ts" ]; then
  protocols=$(grep -oE '[A-Z_]+:' "$APP_DIR/src/lib/xmtp.ts" | sort -u | grep -E '^(MSG|REACT|STICKER|PROFILE|TYPING|VIDEO|LIVE|PIN|UNPIN|THREAD|EDIT|PRESENCE|NFT|TIPLINK|ATTACHMENT)' | tr '\n' ', ' || true)
  echo "- Detected: $protocols" >> "$REPORT"
fi

# ── 5. XMTP Bot-Side Health ──────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 5. XMTP (Bot-Side)" >> "$REPORT"
if [ -f "$BOT_DIR/src/services/xmtpOnlyMonkes.ts" ]; then
  bot_lines=$(wc -l < "$BOT_DIR/src/services/xmtpOnlyMonkes.ts" | tr -d ' ')
  stream_count=$(grep -c 'withReconnect' "$BOT_DIR/src/services/xmtpOnlyMonkes.ts" 2>/dev/null || echo "0")
  dm_commands=$(grep -c "case \"/" "$BOT_DIR/src/services/xmtpOnlyMonkes.ts" 2>/dev/null || echo "0")
  echo "- xmtpOnlyMonkes.ts: $bot_lines lines" >> "$REPORT"
  echo "- Reconnectable streams: $stream_count" >> "$REPORT"
  echo "- DM slash commands: ~$dm_commands" >> "$REPORT"
fi

# Bot XMTP connection status from logs
if [ -f /tmp/monke-bot.log ]; then
  xmtp_reconnects=$(tail -500 /tmp/monke-bot.log | grep -c 'reconnect\|Reconnect\|re-sync' || true)
  xmtp_errors=$(tail -500 /tmp/monke-bot.log | grep -c 'xmtp.*error\|XMTP.*Error' || true)
  push_sends=$(tail -500 /tmp/monke-bot.log | grep -c 'relayPush' || true)
  echo "- Recent: $xmtp_reconnects reconnects, $xmtp_errors XMTP errors, $push_sends push relays (last 500 lines)" >> "$REPORT"
fi

# ── 6. Jupiter Swap Integration ──────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 6. Jupiter Swap Health" >> "$REPORT"

# App-side
if [ -f "$APP_DIR/src/lib/jupiterSwap.ts" ]; then
  app_jup_lines=$(wc -l < "$APP_DIR/src/lib/jupiterSwap.ts" | tr -d ' ')
  echo "- App jupiterSwap.ts: $app_jup_lines lines" >> "$REPORT"
  jup_api=$(grep -o 'api.jup.ag/[^"]*' "$APP_DIR/src/lib/jupiterSwap.ts" | head -1 || echo "?")
  echo "- Jupiter endpoint: $jup_api" >> "$REPORT"
fi

# Bot-side (AutonoMonke swap)
if [ -f "$BOT_DIR/src/lib/automonke/jupiterSwap.ts" ]; then
  bot_jup_lines=$(wc -l < "$BOT_DIR/src/lib/automonke/jupiterSwap.ts" | tr -d ' ')
  echo "- Bot jupiterSwap.ts: $bot_jup_lines lines" >> "$REPORT"
fi

# Worker
if [ -f "$APP_DIR/worker-actions/src/index.ts" ]; then
  worker_lines=$(wc -l < "$APP_DIR/worker-actions/src/index.ts" | tr -d ' ')
  echo "- Worker (Blinks): $worker_lines lines" >> "$REPORT"
fi

# ── 7. Risk + Fee Logic ──────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 7. Risk & Fee Configuration" >> "$REPORT"

if [ -f "$BOT_DIR/src/lib/risk/riskManager.ts" ]; then
  echo "### Bot Risk Defaults" >> "$REPORT"
  echo '```' >> "$REPORT"
  grep -E 'default|DEFAULT|conviction|stop|drawdown|max|size' "$BOT_DIR/src/lib/risk/riskManager.ts" 2>/dev/null | grep -E '[:=]' | head -10 >> "$REPORT"
  echo '```' >> "$REPORT"
fi

if [ -f "$APP_DIR/src/lib/costBasis.ts" ]; then
  app_fee=$(grep -oE 'TOKEN_TRADE_FEE_PCT.*=.*[0-9.]+' "$APP_DIR/src/lib/constants.ts" 2>/dev/null || echo "not found")
  echo "- App trade fee: $app_fee" >> "$REPORT"
fi

if [ -f "$BOT_DIR/src/lib/automonke/engine.ts" ]; then
  bot_fee=$(grep -oE 'AUTO_TRADE_FEE_PCT.*=.*[0-9.]+' "$BOT_DIR/src/lib/automonke/engine.ts" 2>/dev/null || echo "not found")
  echo "- Bot AutonoMonke fee: $bot_fee" >> "$REPORT"
fi

# ── 8. Pyth Hermes Price Feed ────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 8. Pyth Hermes Status" >> "$REPORT"
if [ -f /tmp/monke-bot.log ]; then
  pyth_disconnects=$(tail -200 /tmp/monke-bot.log | grep -c 'pyth.*disconnect\|SSE disconnect' || true)
  pyth_enriched=$(tail -200 /tmp/monke-bot.log | grep -oE 'Pyth.*enriched [0-9]+' | tail -1 || echo "none")
  echo "- Recent disconnects (last 200 lines): $pyth_disconnects" >> "$REPORT"
  echo "- Last enrichment: $pyth_enriched" >> "$REPORT"
fi

# ── 9. Cross-Skill Synergy Notes ─────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 9. Cross-Skill Synergy" >> "$REPORT"
echo "- Guardian report: /tmp/guardian-report.md" >> "$REPORT"
echo "- Evolution report: /tmp/evolution-report.md" >> "$REPORT"
echo "- This report: /tmp/autonomonke-xmtp-report.md" >> "$REPORT"
guardian_age="N/A"
if [ -f /tmp/guardian-report.md ]; then
  guardian_ts=$(head -2 /tmp/guardian-report.md | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}' || echo "?")
  echo "- Guardian last run: $guardian_ts" >> "$REPORT"
fi
evo_age="N/A"
if [ -f /tmp/evolution-report.md ]; then
  evo_ts=$(head -2 /tmp/evolution-report.md | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}' || echo "?")
  echo "- Evolution last run: $evo_ts" >> "$REPORT"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "*AutonoMonke + XMTP evolution scan complete.*" >> "$REPORT"

cp "$REPORT" "$ARCHIVE"
echo "[autonomonke-xmtp] Report: $REPORT"
echo "[autonomonke-xmtp] Archive: $ARCHIVE"
