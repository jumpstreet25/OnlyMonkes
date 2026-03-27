#!/usr/bin/env bash
# guardian-scan.sh — OnlyMonkes Ecosystem Guardian
# Runs automated health checks on both repos + Android build state.
# Called by cron (every 4h) or manually: ./scripts/guardian-scan.sh
#
# Output: /tmp/guardian-report.md (latest) + /tmp/guardian-report-<date>.md (archive)

set -uo pipefail
# Note: no -e because grep returning 0 matches exits with 1

ONLYMONKES_DIR="${HOME}/AndroidStudioProjects/OnlyMonkes"
MONKE_ELIZA_DIR="${HOME}/Monke_Eliza"
REPORT="/tmp/guardian-report.md"
ARCHIVE="/tmp/guardian-report-$(date +%Y%m%d-%H%M).md"

echo "# OnlyMonkes Ecosystem Guardian Report" > "$REPORT"
echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT"
echo "" >> "$REPORT"

# ── 1. Git Status ─────────────────────────────────────────────────────────────
echo "## Git Status" >> "$REPORT"

for repo in "$ONLYMONKES_DIR" "$MONKE_ELIZA_DIR"; do
  name=$(basename "$repo")
  echo "" >> "$REPORT"
  echo "### $name" >> "$REPORT"
  cd "$repo"
  branch=$(git branch --show-current 2>/dev/null || echo "unknown")
  ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
  behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo "?")
  dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "- Branch: \`$branch\` | Ahead: $ahead | Behind: $behind | Dirty files: $dirty" >> "$REPORT"
  if [ "$dirty" -gt 0 ]; then
    echo '```' >> "$REPORT"
    git status --short 2>/dev/null | head -20 >> "$REPORT"
    echo '```' >> "$REPORT"
  fi
done

# ── 2. TypeScript Check (OnlyMonkes) ─────────────────────────────────────────
echo "" >> "$REPORT"
echo "## TypeScript Check (OnlyMonkes)" >> "$REPORT"
cd "$ONLYMONKES_DIR"
ts_errors=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
echo "- Errors: $ts_errors" >> "$REPORT"
if [ "$ts_errors" -gt 0 ]; then
  echo '```' >> "$REPORT"
  npx tsc --noEmit 2>&1 | grep "error TS" | head -10 >> "$REPORT"
  echo '```' >> "$REPORT"
fi

# ── 3. TypeScript Check (Monke_Eliza) ────────────────────────────────────────
echo "" >> "$REPORT"
echo "## TypeScript Check (Monke_Eliza)" >> "$REPORT"
cd "$MONKE_ELIZA_DIR/agents/monke-trader"
ts_errors_bot=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
echo "- Errors: $ts_errors_bot" >> "$REPORT"
if [ "$ts_errors_bot" -gt 0 ]; then
  echo '```' >> "$REPORT"
  npx tsc --noEmit 2>&1 | grep "error TS" | head -10 >> "$REPORT"
  echo '```' >> "$REPORT"
fi

# ── 4. Security Scan ─────────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## Security Scan" >> "$REPORT"
cd "$ONLYMONKES_DIR"

# Check for hardcoded secrets in staged + modified files
secrets_found=$(git diff --name-only 2>/dev/null | xargs grep -inE '(api_key|apikey|secret|private_key|mnemonic|seed_phrase|bearer|password)\s*[:=]' 2>/dev/null | grep -v node_modules | grep -v '.env' || true)
if [ -n "$secrets_found" ]; then
  echo "- **WARNING: Possible secrets found in modified files**" >> "$REPORT"
  echo '```' >> "$REPORT"
  echo "$secrets_found" | head -10 >> "$REPORT"
  echo '```' >> "$REPORT"
else
  echo "- No secrets detected in modified files" >> "$REPORT"
fi

# Check for dangerous patterns
danger=$(git diff 2>/dev/null | grep -inE '(eval\(|Function\(|dangerouslySet)' || true)
if [ -n "$danger" ]; then
  echo "- **WARNING: Dangerous patterns found**" >> "$REPORT"
  echo '```' >> "$REPORT"
  echo "$danger" | head -5 >> "$REPORT"
  echo '```' >> "$REPORT"
else
  echo "- No dangerous patterns (eval/Function/dangerouslySet)" >> "$REPORT"
fi

# ── 5. Bot Health ─────────────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## Bot Health" >> "$REPORT"

bot_pid=$(launchctl list 2>/dev/null | grep monketrader | awk '{print $1}')
bot_exit=$(launchctl list 2>/dev/null | grep monketrader | awk '{print $2}')
echo "- Monke Trader: PID=$bot_pid Exit=$bot_exit" >> "$REPORT"

tunnel_pid=$(launchctl list 2>/dev/null | grep onlymonkes.tunnel | awk '{print $1}')
echo "- CF Tunnel: PID=$tunnel_pid" >> "$REPORT"

openclaw_pid=$(launchctl list 2>/dev/null | grep openclaw.gateway | awk '{print $1}')
echo "- OpenClaw Gateway: PID=$openclaw_pid" >> "$REPORT"

ollama_pid=$(launchctl list 2>/dev/null | grep ollama | awk '{print $1}')
echo "- Ollama: PID=$ollama_pid" >> "$REPORT"

# Last scanner output
echo "" >> "$REPORT"
echo "### Recent Scanner Activity" >> "$REPORT"
echo '```' >> "$REPORT"
tail -5 /tmp/monke-bot.log 2>/dev/null | grep -E "\[scanner\]|\[nft-sales\]|\[automonke\]" >> "$REPORT" || echo "(no recent scanner logs)" >> "$REPORT"
echo '```' >> "$REPORT"

# ── 6. Signal Log Stats ──────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## Signal Log Stats" >> "$REPORT"
SIGNAL_FILE="$MONKE_ELIZA_DIR/agents/monke-trader/.signal_log.json"
if [ -f "$SIGNAL_FILE" ]; then
  signal_count=$(python3 -c "import json; print(len(json.load(open('$SIGNAL_FILE'))))" 2>/dev/null || echo "?")
  echo "- Total signals: $signal_count" >> "$REPORT"
else
  echo "- Signal log not found" >> "$REPORT"
fi

# ── 7. Disk + System ─────────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## System Health" >> "$REPORT"
free_gb=$(df -h / | tail -1 | awk '{print $4}')
swap_used=$(sysctl vm.swapusage 2>/dev/null | grep -o 'used = [0-9.]*M' | grep -o '[0-9.]*' || echo "?")
echo "- Disk free: $free_gb | Swap used: ${swap_used}MB" >> "$REPORT"
echo "- Load: $(uptime | grep -o 'load averages:.*')" >> "$REPORT"

# ── 8. Hermes Memory Stats ───────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "## Hermes Memory" >> "$REPORT"
hermes_dir="${HOME}/Monke_Eliza/agents/monke-trader/.hermes_memory"
if [ -d "$hermes_dir" ]; then
  user_count=$(ls "$hermes_dir/users/"*.enc 2>/dev/null | wc -l | tr -d ' ')
  learning_size=$(du -h "$hermes_dir/learning.json" 2>/dev/null | awk '{print $1}' || echo "N/A")
  echo "- User memories: $user_count | Learning DB: $learning_size" >> "$REPORT"
else
  echo "- Hermes memory directory not found" >> "$REPORT"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "*Guardian scan complete.*" >> "$REPORT"

cp "$REPORT" "$ARCHIVE"
echo "[guardian] Report saved: $REPORT"
echo "[guardian] Archive: $ARCHIVE"
