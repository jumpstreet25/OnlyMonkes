#!/usr/bin/env bash
# monke-bot-evolution.sh — Monke Bot Code Evolution Engine
# Analyzes the Monke_Eliza codebase for quality, performance, and TA accuracy.
# Called by cron (every 6h) or manually: ./scripts/monke-bot-evolution.sh
#
# Output: /tmp/evolution-report.md (latest) + /tmp/evolution-report-<date>.md (archive)

set -uo pipefail

MONKE_ELIZA_DIR="${HOME}/Monke_Eliza"
AGENT_DIR="${MONKE_ELIZA_DIR}/agents/monke-trader"
REPORT="/tmp/evolution-report.md"
ARCHIVE="/tmp/evolution-report-$(date +%Y%m%d-%H%M).md"

echo "# Monke Bot Code Evolution Report" > "$REPORT"
echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT"
echo "" >> "$REPORT"

# ── 1. Git Status ─────────────────────────────────────────────────────────────
echo "## 1. Repository State" >> "$REPORT"
cd "$MONKE_ELIZA_DIR"
branch=$(git branch --show-current 2>/dev/null || echo "unknown")
last_commit=$(git log -1 --format="%h %s (%cr)" 2>/dev/null || echo "unknown")
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "- Branch: \`$branch\` | Dirty: $dirty files" >> "$REPORT"
echo "- Last commit: $last_commit" >> "$REPORT"

# ── 2. TypeScript Health ──────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 2. TypeScript Health" >> "$REPORT"
cd "$AGENT_DIR"
ts_output=$(npx tsc --noEmit 2>&1 || true)
ts_errors=$(echo "$ts_output" | grep -c "error TS" || true)
echo "- Compilation errors: $ts_errors" >> "$REPORT"
if [ "$ts_errors" -gt 0 ]; then
  echo '```' >> "$REPORT"
  echo "$ts_output" | grep "error TS" | head -10 >> "$REPORT"
  echo '```' >> "$REPORT"
fi

# ── 3. Code Complexity Metrics ────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 3. Code Complexity" >> "$REPORT"

key_files=(
  "src/services/xmtpOnlyMonkes.ts"
  "src/lib/ta/signals.ts"
  "src/lib/ta/engine.ts"
  "src/lib/scanner/tokenScanner.ts"
  "src/lib/automonke/engine.ts"
  "src/lib/monitor/positionMonitor.ts"
  "src/lib/risk/riskManager.ts"
  "src/lib/alerts/formatter.ts"
  "src/lib/backtest/backtester.ts"
  "src/lib/hermesMemory.ts"
  "src/providers/botState.ts"
  "src/character.ts"
)

echo "| File | Lines | Functions | TODO/FIXME |" >> "$REPORT"
echo "|------|-------|-----------|------------|" >> "$REPORT"

for f in "${key_files[@]}"; do
  if [ -f "$f" ]; then
    lines=$(wc -l < "$f" | tr -d ' ')
    funcs=$(grep -cE '(export )?(async )?function ' "$f" 2>/dev/null || echo "0")
    todos=$(grep -ciE 'TODO|FIXME|HACK|XXX' "$f" 2>/dev/null || echo "0")
    # Ensure single-line output
    short=$(echo "$f" | sed 's|src/||')
    echo "| \`$short\` | $lines | $funcs | $todos |" >> "$REPORT"
  fi
done

# ── 4. Signal Log Analysis ────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 4. Signal Performance" >> "$REPORT"
SIGNAL_FILE="$AGENT_DIR/.signal_log.json"
if [ -f "$SIGNAL_FILE" ]; then
  true  # signal log exists
else
  echo "- Signal log not found" >> "$REPORT"
fi

# Signal log analysis
python3 -c "
import json, time
from collections import defaultdict
try:
    with open('$SIGNAL_FILE') as f:
        signals = json.load(f)
    total = len(signals)
    now = time.time() * 1000
    ages_h = [(now - s['timestamp']) / 3600000 for s in signals]
    newest = min(ages_h) if ages_h else 0
    oldest = max(ages_h) if ages_h else 0
    scores = [s['score'] for s in signals]
    convictions = defaultdict(int)
    symbols = defaultdict(int)
    for s in signals:
        convictions[s['conviction']] += 1
        symbols[s['symbol']] += 1
    print(f'- Total signals: {total}')
    print(f'- Age range: {newest:.1f}h (newest) to {oldest:.1f}h (oldest)')
    if scores: print(f'- Score range: {min(scores)}-{max(scores)}')
    print(f'- Conviction: {dict(convictions)}')
    top = ', '.join(f'{k}({v})' for k,v in sorted(symbols.items(), key=lambda x: -x[1])[:8])
    print(f'- Top tokens: {top}')
    bad = sum(1 for s in signals if s.get('entryPrice',0) > 0 and s.get('target1',0) > 0 and abs((s['target1'] - s['entryPrice']) / s['entryPrice'] * 100) > 50)
    print(f'- Anomalous targets (>50% from entry): {bad}')
except Exception as e:
    print(f'- Error reading signal log: {e}')
" >> "$REPORT" 2>&1

# ── 5. AutonoMonke State ─────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 5. AutonoMonke State" >> "$REPORT"
STATE_FILE="$AGENT_DIR/.automonke_state.json"
POS_FILE="$AGENT_DIR/.automonke_positions.json"
if [ -f "$STATE_FILE" ]; then
  enrolled=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(len(d.get('users',{})))" 2>/dev/null || echo "?")
  active=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(sum(1 for u in d.get('users',{}).values() if u.get('active')))" 2>/dev/null || echo "?")
  echo "- Enrolled: $enrolled | Active: $active" >> "$REPORT"
else
  echo "- State file not found" >> "$REPORT"
fi
if [ -f "$POS_FILE" ]; then
  open_pos=$(python3 -c "import json; d=json.load(open('$POS_FILE')); print(sum(1 for p in d if not p.get('closedAt')))" 2>/dev/null || echo "?")
  closed_pos=$(python3 -c "import json; d=json.load(open('$POS_FILE')); print(sum(1 for p in d if p.get('closedAt')))" 2>/dev/null || echo "?")
  echo "- Positions: $open_pos open, $closed_pos closed" >> "$REPORT"
else
  echo "- Position file not found" >> "$REPORT"
fi

# ── 6. Hermes Learning State ─────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 6. Hermes Learning" >> "$REPORT"
LEARNING_FILE="${HOME}/.hermes_memory/learning.json"
if [ -f "$LEARNING_FILE" ]; then
  python3 -c "
import json
d = json.load(open('$LEARNING_FILE'))
insights = d.get('insights', {})
print(f\"- Total alerts tracked: {insights.get('totalAlerts', 0)}\")
print(f\"- Win rate: {insights.get('winRate', 0):.1f}%\")
print(f\"- Avg PNL: {insights.get('avgPnlPct', 0):+.2f}%\")
print(f\"- Best confluence range: {insights.get('bestConfluenceRange', 'N/A')}\")
print(f\"- Best tokens: {', '.join(insights.get('bestTokens', []))}\")
print(f\"- Worst tokens: {', '.join(insights.get('worstTokens', []))}\")
print(f\"- Bet win rate: {insights.get('betWinRate', 0):.1f}%\")
" >> "$REPORT" 2>/dev/null || echo "- Error reading learning file" >> "$REPORT"
else
  echo "- Learning file not yet created (needs first recordAlertOutcome call)" >> "$REPORT"
fi

# ── 7. Bot Runtime Health ─────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 7. Bot Runtime" >> "$REPORT"
bot_pid=$(launchctl list 2>/dev/null | grep monketrader | awk '{print $1}')
bot_exit=$(launchctl list 2>/dev/null | grep monketrader | awk '{print $2}')
echo "- PID: $bot_pid | Exit code: $bot_exit" >> "$REPORT"

# Count errors in last 100 lines of bot log
if [ -f /tmp/monke-bot.log ]; then
  recent_errors=$(tail -200 /tmp/monke-bot.log | grep -ciE 'error|ERR|failed|crash' || true)
  recent_signals=$(tail -200 /tmp/monke-bot.log | grep -c '\[scanner\].*SIGNAL' || true)
  recent_scans=$(tail -200 /tmp/monke-bot.log | grep -c '\[scanner\] Starting TA scan' || true)
  echo "- Recent log: $recent_errors errors, $recent_signals signals, $recent_scans scan cycles (last 200 lines)" >> "$REPORT"
else
  echo "- Bot log not found" >> "$REPORT"
fi

# ── 8. API Health ─────────────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 8. API Rate Limit Status" >> "$REPORT"
if [ -f /tmp/monke-bot.log ]; then
  gt_429=$(tail -500 /tmp/monke-bot.log | grep -c 'GT.*429' || true)
  birdeye_err=$(tail -500 /tmp/monke-bot.log | grep -c 'Birdeye.*error\|Birdeye.*quota' || true)
  dexpaprika_err=$(tail -500 /tmp/monke-bot.log | grep -c 'DexPaprika.*error' || true)
  echo "- GeckoTerminal 429s (last 500 lines): $gt_429" >> "$REPORT"
  echo "- Birdeye errors: $birdeye_err" >> "$REPORT"
  echo "- DexPaprika errors: $dexpaprika_err" >> "$REPORT"
fi

# ── 9. Threshold Config Snapshot ──────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## 9. Current Thresholds" >> "$REPORT"
if [ -f "$AGENT_DIR/src/lib/ta/signals.ts" ]; then
  base_thresh=$(grep "BASE_ALERT_THRESHOLD" "$AGENT_DIR/src/lib/ta/signals.ts" | grep -oE '[0-9]+' | head -1 || echo "?")
  echo "- Base alert threshold: $base_thresh" >> "$REPORT"
fi
if [ -f "$AGENT_DIR/src/lib/automonke/engine.ts" ]; then
  auto_thresh=$(grep "MIN_COMPOSITE_SCORE" "$AGENT_DIR/src/lib/automonke/engine.ts" | grep -oE '[0-9]+' | head -1 || echo "?")
  auto_conf=$(grep "DEFAULT_MIN_CONFIDENCE" "$AGENT_DIR/src/lib/automonke/engine.ts" | grep -oE '[0-9]+' | head -1 || echo "?")
  echo "- AutonoMonke min composite: $auto_thresh" >> "$REPORT"
  echo "- AutonoMonke min OC confidence: $auto_conf" >> "$REPORT"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "*Evolution scan complete.*" >> "$REPORT"

cp "$REPORT" "$ARCHIVE"
echo "[evolution] Report saved: $REPORT"
echo "[evolution] Archive: $ARCHIVE"
