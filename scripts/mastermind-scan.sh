#!/usr/bin/env bash
# mastermind-scan.sh — OnlyMonkes Mastermind: Unified Super-Skill Scanner
# Orchestrates guardian + bot evolution + autonomonke-xmtp into one report.
# Cron: every 4h via com.onlymonkes.mastermind LaunchAgent
#
# Output: /tmp/mastermind-report.md

set -uo pipefail

LOCK_FILE="/tmp/mastermind-scan.lock"
if [ -f "$LOCK_FILE" ] && kill -0 "$(cat "$LOCK_FILE" 2>/dev/null)" 2>/dev/null; then
  echo "[mastermind] Already running as PID $(cat "$LOCK_FILE") — skipping this run."
  exit 0
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

APP_DIR="${HOME}/AndroidStudioProjects/OnlyMonkes"
BOT_DIR="${HOME}/Monke_Eliza/agents/monke-trader"
REPORT="/tmp/mastermind-report.md"
ARCHIVE="/tmp/mastermind-report-$(date +%Y%m%d-%H%M).md"

TS=$(date '+%Y-%m-%d %H:%M:%S')
echo "# OnlyMonkes Mastermind Report" > "$REPORT"
echo "**Generated:** $TS" >> "$REPORT"
echo "" >> "$REPORT"

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION A — ECOSYSTEM HEALTH (from guardian)
# ═══════════════════════════════════════════════════════════════════════════════
echo "## A. Ecosystem Health" >> "$REPORT"

# Git status both repos
for repo_path in "$APP_DIR" "$HOME/Monke_Eliza"; do
  name=$(basename "$repo_path")
  cd "$repo_path" 2>/dev/null || continue
  branch=$(git branch --show-current 2>/dev/null || echo "?")
  dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  last=$(git log -1 --format="%h %s (%cr)" 2>/dev/null || echo "?")
  echo "- **$name** [\`$branch\`]: $dirty dirty | $last" >> "$REPORT"
done

# TypeScript
cd "$APP_DIR"
app_ts=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
cd "$BOT_DIR"
bot_ts=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
echo "- TS errors: App=$app_ts (pre-existing) | Bot=$bot_ts" >> "$REPORT"

# Services
echo "" >> "$REPORT"
echo "### Services" >> "$REPORT"
echo "| Service | PID | Status |" >> "$REPORT"
echo "|---------|-----|--------|" >> "$REPORT"
for svc in monketrader "onlymonkes.tunnel" "openclaw.gateway" "ollama.serve"; do
  row=$(launchctl list 2>/dev/null | grep "$svc" || true)
  if [ -n "$row" ]; then
    pid=$(echo "$row" | awk '{print $1}')
    exit_code=$(echo "$row" | awk '{print $2}')
    label=$(echo "$row" | awk '{print $3}')
    status="Running"
    [ "$pid" = "-" ] && status="Stopped (exit=$exit_code)"
    echo "| $label | $pid | $status |" >> "$REPORT"
  fi
done

# System
free_gb=$(df -h / | tail -1 | awk '{print $4}')
swap_mb=$(sysctl vm.swapusage 2>/dev/null | grep -o 'used = [0-9.]*M' | grep -o '[0-9.]*' || echo "?")
load=$(uptime | grep -o 'load averages:.*' || echo "?")
echo "" >> "$REPORT"
echo "- Disk: $free_gb free | Swap: ${swap_mb}MB | $load" >> "$REPORT"

# Security quick scan
cd "$APP_DIR"
secrets_count=$(git diff --name-only 2>/dev/null | xargs grep -inlE '(api_key|secret|private_key|mnemonic|password)\s*[:=]' 2>/dev/null | grep -v node_modules | grep -v README | grep -v '.env' | wc -l | tr -d ' ' || echo "0")
echo "- Security: $secrets_count files with possible secrets (excluding README/.env)" >> "$REPORT"

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION B — TA & SIGNAL INTELLIGENCE (from bot evolution)
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## B. TA & Signal Intelligence" >> "$REPORT"

# Thresholds
base_thresh=$(grep "BASE_ALERT_THRESHOLD" "$BOT_DIR/src/lib/ta/signals.ts" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "?")
auto_thresh=$(grep "MIN_COMPOSITE_SCORE" "$BOT_DIR/src/lib/automonke/engine.ts" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "?")
echo "- Thresholds: Alert=$base_thresh | AutonoMonke=$auto_thresh" >> "$REPORT"

# Signal log
SIGNAL_FILE="$BOT_DIR/.signal_log.json"
python3 -c "
import json, time
from collections import defaultdict
try:
    signals = json.load(open('$SIGNAL_FILE'))
    total = len(signals)
    now = time.time() * 1000
    scores = [s['score'] for s in signals]
    conv = defaultdict(int)
    syms = defaultdict(int)
    for s in signals:
        conv[s['conviction']] += 1
        syms[s['symbol']] += 1
    # Last 24h signals
    recent = [s for s in signals if (now - s['timestamp']) < 86400000]
    bad = sum(1 for s in signals if s.get('entryPrice',0) > 0 and s.get('target1',0) > 0 and abs((s['target1'] - s['entryPrice']) / s['entryPrice'] * 100) > 50)
    top5 = ', '.join(f'{k}({v})' for k,v in sorted(syms.items(), key=lambda x: -x[1])[:5])
    print(f'- Signals: {total} total | {len(recent)} last 24h | Scores: {min(scores)}-{max(scores)}')
    print(f'- Conviction: high={conv[\"high\"]} med={conv[\"medium\"]} low={conv[\"low\"]}')
    print(f'- Top: {top5}')
    print(f'- Anomalous targets: {bad} ({bad*100//max(total,1)}%)')
except Exception as e:
    print(f'- Signal log error: {e}')
" >> "$REPORT" 2>&1

# Scanner activity
if [ -f /tmp/monke-bot.log ]; then
  scan_cycles=$(tail -500 /tmp/monke-bot.log | grep -c 'Starting TA scan' || true)
  signal_fires=$(tail -500 /tmp/monke-bot.log | grep -c 'SIGNAL:' || true)
  low_blocked=$(tail -500 /tmp/monke-bot.log | grep -c 'low conviction' || true)
  echo "- Scanner: $scan_cycles cycles, $signal_fires signals, $low_blocked low-conviction blocked (last 500 lines)" >> "$REPORT"
fi

# API health
if [ -f /tmp/monke-bot.log ]; then
  gt429=$(tail -500 /tmp/monke-bot.log | grep -c 'GT.*429' || true)
  dp_ok=$(tail -500 /tmp/monke-bot.log | grep -c 'DexPaprika' || true)
  echo "- APIs: GT 429s=$gt429 | DexPaprika calls=$dp_ok" >> "$REPORT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION C — AUTONOMONKE + TRADING (from autonomonke-xmtp)
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## C. AutonoMonke & Trading" >> "$REPORT"

# State
python3 -c "
import json, os
sf = '$BOT_DIR/.automonke_state.json'
pf = '$BOT_DIR/.automonke_positions.json'
if os.path.exists(sf):
    d = json.load(open(sf))
    users = d if isinstance(d, dict) and 'users' in d else {'users': d if isinstance(d, dict) else {}}
    u = users.get('users', {})
    active = sum(1 for v in u.values() if isinstance(v, dict) and v.get('active')) if isinstance(u, dict) else 0
    print(f'- Enrolled: {len(u) if isinstance(u, dict) else \"?\"} | Active: {active}')
else:
    print('- State: not initialized')
if os.path.exists(pf):
    pos = json.load(open(pf))
    if isinstance(pos, list):
        op = sum(1 for p in pos if not p.get('closedAt'))
        cl = sum(1 for p in pos if p.get('closedAt'))
        print(f'- Positions: {op} open, {cl} closed')
    else:
        print('- Positions: empty')
else:
    print('- Positions: no file (0 trades)')
" >> "$REPORT" 2>&1

# Wallet vault
if [ -f "$BOT_DIR/.automonke_wallets.json" ]; then
  wc=$(python3 -c "import json; print(len(json.load(open('$BOT_DIR/.automonke_wallets.json'))))" 2>/dev/null || echo "?")
  echo "- Wallets: $wc encrypted (AES-256-GCM)" >> "$REPORT"
fi

# Fees
app_fee=$(grep -oE 'TOKEN_TRADE_FEE_PCT\s*=\s*[0-9.]+' "$APP_DIR/src/lib/constants.ts" 2>/dev/null | grep -oE '[0-9.]+$' || echo "?")
bot_fee=$(grep -oE 'AUTO_TRADE_FEE_PCT\s*=\s*[0-9.]+' "$BOT_DIR/src/lib/automonke/engine.ts" 2>/dev/null | grep -oE '[0-9.]+$' || echo "?")
echo "- Fees: App swap=${app_fee} (3%) | AutonoMonke=${bot_fee} (5%)" >> "$REPORT"

# Hermes learning
LEARN="${HOME}/.hermes_memory/learning.json"
if [ -f "$LEARN" ]; then
  python3 -c "
import json
d = json.load(open('$LEARN'))
i = d.get('insights', {})
print(f'- Hermes: {i.get(\"totalAlerts\",0)} alerts tracked | WR={i.get(\"winRate\",0):.0f}% | Avg PNL={i.get(\"avgPnlPct\",0):+.1f}%')
print(f'- Best range: {i.get(\"bestConfluenceRange\",\"N/A\")} | Best: {i.get(\"bestTokens\",[])} | Worst: {i.get(\"worstTokens\",[])}')
" >> "$REPORT" 2>&1
else
  echo "- Hermes: learning not yet bootstrapped (needs first position close)" >> "$REPORT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION D — XMTP & MESSAGING
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## D. XMTP & Messaging" >> "$REPORT"

# App-side sizes
xmtp_lines=$(wc -l < "$APP_DIR/src/lib/xmtp.ts" 2>/dev/null | tr -d ' ' || echo "?")
hook_lines=$(wc -l < "$APP_DIR/src/hooks/useXmtp.ts" 2>/dev/null | tr -d ' ' || echo "?")
bot_xmtp=$(wc -l < "$BOT_DIR/src/services/xmtpOnlyMonkes.ts" 2>/dev/null | tr -d ' ' || echo "?")
echo "- App: xmtp.ts=$xmtp_lines | useXmtp.ts=$hook_lines" >> "$REPORT"
echo "- Bot: xmtpOnlyMonkes.ts=$bot_xmtp" >> "$REPORT"

# Bot XMTP health from logs
if [ -f /tmp/monke-bot.log ]; then
  reconnects=$(tail -500 /tmp/monke-bot.log | grep -c 'reconnect\|Reconnect' || true)
  xmtp_err=$(tail -500 /tmp/monke-bot.log | grep -c 'xmtp.*error\|XMTP.*Error' || true)
  push_ok=$(tail -500 /tmp/monke-bot.log | grep -c 'relayPush' || true)
  echo "- Bot streams: $reconnects reconnects, $xmtp_err errors, $push_ok push relays (last 500 lines)" >> "$REPORT"
fi

# Pyth
if [ -f /tmp/monke-bot.log ]; then
  pyth_dc=$(tail -200 /tmp/monke-bot.log | grep -c 'SSE disconnect' || true)
  echo "- Pyth SSE: $pyth_dc disconnects (last 200 lines)" >> "$REPORT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION E — PRIORITY ACTIONS
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## E. Priority Actions" >> "$REPORT"
echo "" >> "$REPORT"

# Auto-generate priorities based on scan data
priorities=0

if [ -f /tmp/monke-bot.log ]; then
  pyth_dc=$(tail -200 /tmp/monke-bot.log | grep -c 'SSE disconnect' || true)
  if [ "$pyth_dc" -gt 50 ]; then
    priorities=$((priorities + 1))
    echo "$priorities. **Pyth SSE reconnect storm** ($pyth_dc disconnects/200 lines) — increase backoff or add health ping" >> "$REPORT"
  fi
fi

if [ "$bot_ts" -gt 0 ] 2>/dev/null; then
  priorities=$((priorities + 1))
  echo "$priorities. **Bot TS errors: $bot_ts** — fix before next deploy" >> "$REPORT"
fi

bad_targets=$(python3 -c "
import json
signals = json.load(open('$SIGNAL_FILE'))
bad = sum(1 for s in signals if s.get('entryPrice',0) > 0 and s.get('target1',0) > 0 and abs((s['target1'] - s['entryPrice']) / s['entryPrice'] * 100) > 50)
print(bad)
" 2>/dev/null || echo "0")
if [ "$bad_targets" -gt 5 ]; then
  priorities=$((priorities + 1))
  echo "$priorities. **$bad_targets anomalous Fib targets** in signal log — validation fix deployed, monitor for new occurrences" >> "$REPORT"
fi

free_num=$(df / | tail -1 | awk '{print $4}')
if [ "$free_num" -lt 15000000 ]; then
  priorities=$((priorities + 1))
  echo "$priorities. **Low disk: $free_gb** — clean caches or move data to MyPassport" >> "$REPORT"
fi

if [ "$priorities" -eq 0 ]; then
  echo "No critical issues detected. Ecosystem healthy." >> "$REPORT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════════════════════
# SECTION F — SECURITY (from security-guardian, runs inline daily)
# ═══════════════════════════════════════════════════════════════════════════════
SECURITY_REPORT="/tmp/security-report.md"
SECURITY_AGE=999
if [ -f "$SECURITY_REPORT" ]; then
  # BSD `stat -f %m` is macOS. GNU `stat -f` means --file-system and prints
  # `File: "path"`, which `set -u` then treats as unbound `$File` (VPS failure
  # since 2026-08-16). Prefer GNU -c %Y, fall back to BSD -f %m.
  _mtime=$(stat -c %Y "$SECURITY_REPORT" 2>/dev/null || stat -f %m "$SECURITY_REPORT" 2>/dev/null || echo 0)
  SECURITY_AGE=$(( ($(date +%s) - _mtime) / 3600 ))
fi

# Run security scan if report is older than 24h or doesn't exist
if [ "$SECURITY_AGE" -gt 24 ]; then
  GUARDIAN_SCRIPT="$APP_DIR/scripts/security-guardian.sh"
  if [ -x "$GUARDIAN_SCRIPT" ]; then
    echo "" >> "$REPORT"
    echo "## F. Security Audit (refreshed)" >> "$REPORT"
    bash "$GUARDIAN_SCRIPT" 2>/dev/null
    # Extract summary from security report
    grep -A2 "^## Summary" "$SECURITY_REPORT" 2>/dev/null >> "$REPORT" || echo "- Security scan ran but no summary" >> "$REPORT"
  fi
else
  echo "" >> "$REPORT"
  echo "## F. Security (cached — ${SECURITY_AGE}h old)" >> "$REPORT"
  grep -A2 "^## Summary" "$SECURITY_REPORT" 2>/dev/null >> "$REPORT" || echo "- No recent security report" >> "$REPORT"
fi

echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "*Mastermind scan complete. Next run in 4 hours.*" >> "$REPORT"

cp "$REPORT" "$ARCHIVE"
echo "[mastermind] Report: $REPORT"
echo "[mastermind] Archive: $ARCHIVE"
