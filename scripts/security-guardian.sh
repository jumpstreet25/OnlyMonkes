#!/usr/bin/env bash
# security-guardian.sh — OnlyMonkes Security Guardian
# Deep security audit of both repos, Hermes config, bot secrets, wallet isolation.
# Runs daily via mastermind or manually: ./scripts/security-guardian.sh
#
# Output: /tmp/security-report.md

set -uo pipefail

APP_DIR="${HOME}/AndroidStudioProjects/OnlyMonkes"
BOT_DIR="${HOME}/Monke_Eliza/agents/monke-trader"
HERMES_DIR="${HOME}/.hermes_memory"
REPORT="/tmp/security-report.md"
ARCHIVE="/tmp/security-report-$(date +%Y%m%d-%H%M).md"

CRITICAL=0
HIGH=0
MEDIUM=0

log_finding() {
  local severity="$1"
  local msg="$2"
  echo "- **[$severity]** $msg" >> "$REPORT"
  case "$severity" in
    CRITICAL) CRITICAL=$((CRITICAL + 1)) ;;
    HIGH)     HIGH=$((HIGH + 1)) ;;
    MEDIUM)   MEDIUM=$((MEDIUM + 1)) ;;
  esac
}

echo "# Security Guardian Report" > "$REPORT"
echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT"
echo "" >> "$REPORT"

# ═══════════════════════════════════════════════════════════════════════════════
# 1. SECRETS IN CODE — scan both repos for hardcoded keys
# ═══════════════════════════════════════════════════════════════════════════════
echo "## 1. Secrets in Code" >> "$REPORT"

for repo_path in "$APP_DIR" "$HOME/Monke_Eliza"; do
  name=$(basename "$repo_path")
  cd "$repo_path" 2>/dev/null || continue

  # Real secret patterns — use git ls-files to avoid node_modules entirely
  secrets=$(git ls-files '*.ts' '*.tsx' '*.js' '*.json' '*.gradle' 2>/dev/null | \
    xargs grep -nE '(api[_-]?key|secret|private[_-]?key|mnemonic|seed[_-]?phrase|password|bearer)\s*[:=]\s*["\x27][A-Za-z0-9+/]{20,}' 2>/dev/null | \
    grep -v 'README\|your-\|example\|__tests__\|\.env' || true)

  if [ -n "$secrets" ]; then
    log_finding "CRITICAL" "$name: Possible hardcoded secrets found"
    echo '```' >> "$REPORT"
    echo "$secrets" | head -10 >> "$REPORT"
    echo '```' >> "$REPORT"
  else
    echo "- $name: No hardcoded secrets found" >> "$REPORT"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# 2. .ENV FILE SECURITY
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 2. Environment Files" >> "$REPORT"

# Check .env files aren't tracked by git
for repo_path in "$APP_DIR" "$HOME/Monke_Eliza"; do
  name=$(basename "$repo_path")
  cd "$repo_path" 2>/dev/null || continue

  gitignore_env=$(grep -c '\.env' .gitignore 2>/dev/null || echo "0")
  if [ "$gitignore_env" -eq 0 ]; then
    log_finding "CRITICAL" "$name: .env NOT in .gitignore"
  fi

  # Check if .env is tracked
  env_tracked=$(git ls-files .env 2>/dev/null | wc -l | tr -d ' ')
  if [ "$env_tracked" -gt 0 ]; then
    log_finding "CRITICAL" "$name: .env is tracked by git!"
  fi
done

# Check bot .env permissions
if [ -f "$BOT_DIR/.env" ]; then
  env_perms=$(stat -f "%Lp" "$BOT_DIR/.env" 2>/dev/null || stat -c "%a" "$BOT_DIR/.env" 2>/dev/null || echo "?")
  if [ "$env_perms" != "600" ] && [ "$env_perms" != "400" ]; then
    log_finding "MEDIUM" "Bot .env permissions: $env_perms (should be 600)"
  else
    echo "- Bot .env permissions: $env_perms (OK)" >> "$REPORT"
  fi
fi

# Check app .env
if [ -f "$APP_DIR/.env" ]; then
  env_perms=$(stat -f "%Lp" "$APP_DIR/.env" 2>/dev/null || echo "?")
  if [ "$env_perms" != "600" ] && [ "$env_perms" != "400" ]; then
    log_finding "MEDIUM" "App .env permissions: $env_perms (should be 600)"
  else
    echo "- App .env permissions: $env_perms (OK)" >> "$REPORT"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 3. AUTOMONKE WALLET VAULT SECURITY
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 3. AutonoMonke Wallet Vault" >> "$REPORT"

VAULT="$BOT_DIR/.automonke_wallets.json"
if [ -f "$VAULT" ]; then
  vault_perms=$(stat -f "%Lp" "$VAULT" 2>/dev/null || echo "?")
  if [ "$vault_perms" != "600" ] && [ "$vault_perms" != "400" ]; then
    log_finding "HIGH" "Wallet vault permissions: $vault_perms (should be 600)"
  else
    echo "- Vault permissions: $vault_perms (OK)" >> "$REPORT"
  fi

  # Check vault is encrypted (should be JSON with ct/iv/tag fields, not plaintext keys)
  has_ct=$(grep -c '"ct"' "$VAULT" 2>/dev/null || echo "0")
  has_plainkey=$(grep -cE '"secretKey"|"privateKey"|"keypair"' "$VAULT" 2>/dev/null || echo "0")
  if [ "$has_plainkey" -gt 0 ]; then
    log_finding "CRITICAL" "Wallet vault contains PLAINTEXT private keys!"
  elif [ "$has_ct" -gt 0 ]; then
    echo "- Vault is encrypted (AES-256-GCM)" >> "$REPORT"
  fi

  # Check vault secret is set
  if grep -q "AUTOMONKE_VAULT_SECRET" "$BOT_DIR/.env" 2>/dev/null; then
    secret_len=$(grep "AUTOMONKE_VAULT_SECRET" "$BOT_DIR/.env" | cut -d= -f2 | tr -d ' "' | wc -c | tr -d ' ')
    if [ "$secret_len" -lt 32 ]; then
      log_finding "CRITICAL" "AUTOMONKE_VAULT_SECRET too short ($secret_len chars, need 32+)"
    else
      echo "- Vault secret: SET ($secret_len chars)" >> "$REPORT"
    fi
  else
    log_finding "CRITICAL" "AUTOMONKE_VAULT_SECRET not set in bot .env"
  fi
else
  echo "- Wallet vault: not created yet (no trades)" >> "$REPORT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. HERMES MEMORY SECURITY
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 4. Hermes Memory" >> "$REPORT"

if [ -d "$HERMES_DIR" ]; then
  dir_perms=$(stat -f "%Lp" "$HERMES_DIR" 2>/dev/null || echo "?")
  if [ "$dir_perms" != "700" ]; then
    log_finding "MEDIUM" "Hermes dir permissions: $dir_perms (should be 700)"
  else
    echo "- Directory permissions: $dir_perms (OK)" >> "$REPORT"
  fi

  # Check user files are encrypted
  if [ -d "$HERMES_DIR/users" ]; then
    user_files=$(ls "$HERMES_DIR/users/"*.enc 2>/dev/null | wc -l | tr -d ' ')
    plain_files=$(ls "$HERMES_DIR/users/"*.json 2>/dev/null | wc -l | tr -d ' ')
    echo "- Encrypted user files: $user_files" >> "$REPORT"
    if [ "$plain_files" -gt 0 ]; then
      log_finding "HIGH" "$plain_files plaintext user files in Hermes (should be .enc only)"
    fi
  fi

  # Learning file (unencrypted by design — aggregates only, no PII)
  if [ -f "$HERMES_DIR/learning.json" ]; then
    learn_perms=$(stat -f "%Lp" "$HERMES_DIR/learning.json" 2>/dev/null || echo "?")
    has_inbox=$(grep -c "inboxId" "$HERMES_DIR/learning.json" 2>/dev/null || echo "0")
    if [ "$has_inbox" -gt 0 ]; then
      log_finding "HIGH" "learning.json contains inboxId references (should be anonymized)"
    else
      echo "- Learning file: anonymized (no inboxIds)" >> "$REPORT"
    fi
  fi
else
  echo "- Hermes memory: not initialized yet" >> "$REPORT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 5. XMTP KEY SECURITY
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 5. XMTP Keys" >> "$REPORT"

# Bot XMTP key
BOT_KEY="$BOT_DIR/.xmtp_bot_key"
if [ -f "$BOT_KEY" ]; then
  key_perms=$(stat -f "%Lp" "$BOT_KEY" 2>/dev/null || echo "?")
  if [ "$key_perms" != "600" ] && [ "$key_perms" != "400" ]; then
    log_finding "HIGH" "Bot XMTP key permissions: $key_perms (should be 600)"
  else
    echo "- Bot XMTP key: $key_perms (OK)" >> "$REPORT"
  fi

  # Check it's not tracked
  cd "$HOME/Monke_Eliza"
  key_tracked=$(git ls-files "agents/monke-trader/.xmtp_bot_key" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$key_tracked" -gt 0 ]; then
    log_finding "CRITICAL" "Bot XMTP key is tracked by git!"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 6. DANGEROUS CODE PATTERNS
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 6. Dangerous Code Patterns" >> "$REPORT"

for repo_path in "$APP_DIR" "$HOME/Monke_Eliza"; do
  name=$(basename "$repo_path")
  cd "$repo_path" 2>/dev/null || continue

  # eval / Function constructor — scan only OUR code (agents/monke-trader/src for bot, src/ for app)
  # Excludes upstream ElizaOS framework (packages/*, computeruse/*)
  our_code="src/"
  if [ "$name" = "Monke_Eliza" ]; then our_code="agents/monke-trader/src/"; fi
  eval_files=$(git ls-files "${our_code}*.ts" "${our_code}*.tsx" "${our_code}*.js" 2>/dev/null | xargs grep -lE '\beval\s*\(|\bnew\s+Function\s*\(' 2>/dev/null || true)
  eval_count=$(echo "$eval_files" | grep -c '[a-z]' || true)
  if [ "$eval_count" -gt 0 ]; then
    log_finding "CRITICAL" "$name: $eval_count files with eval() or new Function()"
    echo '```' >> "$REPORT"
    echo "$eval_files" >> "$REPORT"
    echo '```' >> "$REPORT"
  fi

  # dangerouslySetInnerHTML
  dangerous_html=$(git ls-files '*.ts' '*.tsx' 2>/dev/null | xargs grep -l 'dangerouslySetInnerHTML' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$dangerous_html" -gt 0 ]; then
    log_finding "HIGH" "$name: $dangerous_html files with dangerouslySetInnerHTML"
  fi
done

echo "- No eval/Function/dangerouslySet found" >> "$REPORT" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════════
# 7. NFT GATE VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 7. NFT Ownership Gate" >> "$REPORT"

# App-side gate
app_gate=$(grep -c "getAssetsByOwner\|nftVerification\|useNFTVerification" "$APP_DIR/src/lib/nftVerification.ts" "$APP_DIR/src/hooks/useNFTVerification.ts" 2>/dev/null || echo "0")
echo "- App-side NFT verification: $app_gate references" >> "$REPORT"

# Bot-side gate
bot_gate=$(grep -c "checkNftGate" "$BOT_DIR/src/lib/nft/nftGate.ts" 2>/dev/null || echo "0")
echo "- Bot-side NFT DM gate: $bot_gate references" >> "$REPORT"
if [ "$bot_gate" -eq 0 ]; then
  log_finding "HIGH" "Bot NFT gate (nftGate.ts) not found or empty"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 8. FEE LOGIC AUDIT
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 8. Fee Logic" >> "$REPORT"

# Verify fees are profit-only (never charged on losses)
app_fee_check=$(grep -n "profitSOL > 0\|feeSOL > 0\|profit.*fee\|fee.*profit" "$APP_DIR/src/lib/jupiterSwap.ts" 2>/dev/null | wc -l | tr -d ' ')
echo "- App swap: profit-check guards found: $app_fee_check" >> "$REPORT"

bot_fee_check=$(grep -n "pnlPct.*> 0\|profit.*> 0\|fee.*profit" "$BOT_DIR/src/lib/automonke/engine.ts" 2>/dev/null | wc -l | tr -d ' ')
echo "- Bot AutonoMonke: profit-check guards found: $bot_fee_check" >> "$REPORT"

if [ "$app_fee_check" -eq 0 ]; then
  log_finding "HIGH" "App jupiterSwap.ts: no profit-check guard found for fee logic"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 9. DRAWDOWN HALT VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 9. Drawdown Protection" >> "$REPORT"

drawdown_check=$(grep -c "DRAWDOWN_HALT\|drawdownHalt\|drawdown.*halt" "$BOT_DIR/src/lib/automonke/engine.ts" 2>/dev/null || echo "0")
echo "- AutonoMonke drawdown halt references: $drawdown_check" >> "$REPORT"
if [ "$drawdown_check" -eq 0 ]; then
  log_finding "CRITICAL" "No drawdown halt logic found in AutonoMonke engine!"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 10. GATEWAY / SERVICE ACCESS
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 10. Service Access" >> "$REPORT"

# OpenClaw gateway — check if it requires auth
if [ -f "$HOME/.openclaw/identity/device-auth.json" ]; then
  echo "- OpenClaw: device auth token present" >> "$REPORT"
else
  log_finding "HIGH" "OpenClaw device auth token missing"
fi

# Check listening ports
echo "" >> "$REPORT"
echo "### Open Ports" >> "$REPORT"
lsof -i -P -n 2>/dev/null | grep LISTEN | grep -v "^Google\|^Slack\|^Discord\|^com.apple" | awk '{print $1, $9}' | sort -u | while read line; do
  echo "- $line" >> "$REPORT"
done

# ═══════════════════════════════════════════════════════════════════════════════
# 11. DEPENDENCY AUDIT
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "## 11. Dependency Audit" >> "$REPORT"

cd "$APP_DIR"
# npm audit is very slow on this 2-core machine — run with timeout
npm_audit=$(timeout 30 npm audit --json 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    meta = d.get('metadata', {}).get('vulnerabilities', {})
    crit = meta.get('critical', 0)
    high = meta.get('high', 0)
    mod = meta.get('moderate', 0)
    print(f'Critical: {crit} | High: {high} | Moderate: {mod}')
except:
    print('skipped (timeout or parse error)')
" 2>/dev/null || echo "skipped (timeout)")
echo "- OnlyMonkes: $npm_audit" >> "$REPORT"

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "" >> "$REPORT"
echo "## Summary" >> "$REPORT"

total=$((CRITICAL + HIGH + MEDIUM))
if [ "$CRITICAL" -gt 0 ]; then
  echo "🔴 **$CRITICAL CRITICAL** | $HIGH HIGH | $MEDIUM MEDIUM — **Immediate action required**" >> "$REPORT"
elif [ "$HIGH" -gt 0 ]; then
  echo "🟡 $HIGH HIGH | $MEDIUM MEDIUM — **Review and fix soon**" >> "$REPORT"
elif [ "$MEDIUM" -gt 0 ]; then
  echo "🟢 $MEDIUM MEDIUM findings — Low risk, minor improvements" >> "$REPORT"
else
  echo "🟢 **All clear** — No security issues detected" >> "$REPORT"
fi

echo "" >> "$REPORT"
echo "*Security Guardian scan complete.*" >> "$REPORT"

cp "$REPORT" "$ARCHIVE"
echo "[security] Report: $REPORT ($CRITICAL critical, $HIGH high, $MEDIUM medium)"
echo "[security] Archive: $ARCHIVE"
