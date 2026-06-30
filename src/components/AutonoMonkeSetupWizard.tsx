/**
 * AutonoMonkeSetupWizard — replaces the old single-screen disclaimer + DM
 * back-and-forth enrollment flow. Collects every parameter the bot needs
 * (per-trade SOL, max wallet SOL, min confidence) in a 4-step UI, then fires
 * a single `/autonomonke setup <json>` DM. Bot enrolls atomically.
 *
 * Defense-in-depth: each slider clamps to its own bounds, AND the bot
 * re-clamps on receive (so a malformed payload from a future client can't
 * push out-of-range values).
 */

import React, { useCallback, useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet, ScrollView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { GlassModal } from '@/components/GlassModal';
import { THEME, FONTS } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { router } from 'expo-router';
import { getXmtpClient } from '@/hooks/useXmtp';
import { sendDmMessage } from '@/lib/xmtp';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toast } from 'sonner-native';
import * as Haptics from 'expo-haptics';

const BOT_INBOX_ID = '998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363';
const STORAGE_KEY = 'automonke_enrolled';

type BaseCurrency = 'SOL' | 'USDC' | 'SKR';

const DEFAULTS = {
  baseCurrency: 'SOL' as BaseCurrency,
  perTradeSOL: 0.1,
  maxSOL: 2,
  minConfidence: 55,
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

export default function AutonoMonkeSetupWizard({ visible, onClose }: Props) {
  const username = useAppStore(s => s.username);
  const wallet = useAppStore(s => s.wallet);

  const [step, setStep] = useState<Step>(1);
  const [riskAck, setRiskAck] = useState(false);
  const [responsibilityAck, setResponsibilityAck] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState<BaseCurrency>(DEFAULTS.baseCurrency);
  const [perTradeSOL, setPerTradeSOL] = useState(DEFAULTS.perTradeSOL);
  const [maxSOL, setMaxSOL] = useState(DEFAULTS.maxSOL);
  const [minConfidence, setMinConfidence] = useState(DEFAULTS.minConfidence);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setStep(1);
    setRiskAck(false);
    setResponsibilityAck(false);
    setBaseCurrency(DEFAULTS.baseCurrency);
    setPerTradeSOL(DEFAULTS.perTradeSOL);
    setMaxSOL(DEFAULTS.maxSOL);
    setMinConfidence(DEFAULTS.minConfidence);
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleUseDefaults = useCallback(() => {
    if (!riskAck || !responsibilityAck) return;
    setBaseCurrency(DEFAULTS.baseCurrency);
    setPerTradeSOL(DEFAULTS.perTradeSOL);
    setMaxSOL(DEFAULTS.maxSOL);
    setMinConfidence(DEFAULTS.minConfidence);
    setStep(5);
  }, [riskAck, responsibilityAck]);

  const handleActivate = useCallback(async () => {
    if (!wallet?.address) {
      toast.error('No wallet connected.');
      return;
    }
    setSubmitting(true);
    try {
      const client = getXmtpClient();
      if (!client) throw new Error('Not connected to chat. Restart the app.');
      const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
      if (!dm) throw new Error('Could not open bot DM.');

      const payload = {
        mainWallet: wallet.address,
        maxSOL,
        perTradeSOL,
        minConfidence,
        baseCurrency,
      };
      await sendDmMessage(dm, `/autonomonke setup ${JSON.stringify(payload)}`, username);
      await AsyncStorage.setItem(STORAGE_KEY, '1');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.success('Activating AutonoMonke…');
      handleClose();
      router.push(`/dm/${BOT_INBOX_ID}` as any);
    } catch (err: any) {
      toast.error(err?.message ?? 'Setup failed');
      setSubmitting(false);
    }
  }, [wallet, perTradeSOL, maxSOL, minConfidence, baseCurrency, username, handleClose]);

  return (
    <GlassModal visible={visible} onClose={handleClose} cardStyle={s.container}>
      {/* Progress dots */}
      <View style={s.progress}>
        {[1, 2, 3, 4, 5].map(i => (
          <View
            key={i}
            style={[s.dot, i === step && s.dotActive, i < step && s.dotComplete]}
          />
        ))}
      </View>

      <ScrollView
        style={s.body}
        contentContainerStyle={s.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {step === 1 && <Step1Disclaimer
          riskAck={riskAck} setRiskAck={setRiskAck}
          responsibilityAck={responsibilityAck} setResponsibilityAck={setResponsibilityAck}
        />}
        {step === 2 && <Step2Base value={baseCurrency} onChange={setBaseCurrency} />}
        {step === 3 && <Step3PerTrade value={perTradeSOL} onChange={setPerTradeSOL} baseCurrency={baseCurrency} />}
        {step === 4 && <Step4Risk
          maxSOL={maxSOL} setMaxSOL={setMaxSOL}
          minConfidence={minConfidence} setMinConfidence={setMinConfidence}
          perTradeSOL={perTradeSOL}
          baseCurrency={baseCurrency}
        />}
        {step === 5 && <Step5Review
          baseCurrency={baseCurrency}
          perTradeSOL={perTradeSOL}
          maxSOL={maxSOL}
          minConfidence={minConfidence}
          mainWallet={wallet?.address ?? ''}
          onEdit={(target) => setStep(target)}
        />}
      </ScrollView>

      <View style={s.actionRow}>
        {step === 1 ? (
          <>
            <Pressable
              style={[s.btn, s.btnGhost]}
              onPress={handleClose}
            >
              <Text style={s.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnSecondary, (!riskAck || !responsibilityAck) && s.btnDisabled]}
              onPress={handleUseDefaults}
              disabled={!riskAck || !responsibilityAck}
            >
              <Text style={s.btnSecondaryText}>Use Defaults</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary, (!riskAck || !responsibilityAck) && s.btnDisabled]}
              onPress={() => setStep(2)}
              disabled={!riskAck || !responsibilityAck}
            >
              <Text style={s.btnPrimaryText}>Customize</Text>
            </Pressable>
          </>
        ) : step < 5 ? (
          <>
            <Pressable
              style={[s.btn, s.btnGhost]}
              onPress={() => setStep((step - 1) as Step)}
            >
              <Text style={s.btnGhostText}>Back</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary]}
              onPress={() => setStep((step + 1) as Step)}
            >
              <Text style={s.btnPrimaryText}>Next</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={[s.btn, s.btnGhost]}
              onPress={() => setStep(4)}
              disabled={submitting}
            >
              <Text style={s.btnGhostText}>Back</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary, submitting && s.btnDisabled]}
              onPress={handleActivate}
              disabled={submitting}
            >
              <Text style={s.btnPrimaryText}>
                {submitting ? 'Activating…' : 'Activate'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </GlassModal>
  );
}

// ── Step 1: Disclaimer ──────────────────────────────────────────────────────

function Step1Disclaimer({
  riskAck, setRiskAck, responsibilityAck, setResponsibilityAck,
}: {
  riskAck: boolean; setRiskAck: (v: boolean) => void;
  responsibilityAck: boolean; setResponsibilityAck: (v: boolean) => void;
}) {
  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>AutonoMonke</Text>
      <Text style={s.stepSubtitle}>Autonomous Trading</Text>

      <View style={s.warnBadge}>
        <Text style={s.warnText}>HIGH RISK · YOU CAN LOSE FUNDS</Text>
      </View>

      <Text style={s.bodyText}>
        AutonoMonke creates a separate hot wallet, watches Solana memecoins, and
        opens trades automatically when its TA + AI signals align. Stops and
        profit targets are set on every entry.{"\n\n"}
        Profits above your max wallet balance auto-sweep back to your main
        wallet. <Text style={s.bold}>5% fee on profits</Text>; no fee on losses.{" "}
        <Text style={s.bold}>Fund with SKR for 50% off</Text> (2.5% fee).
      </Text>

      <View style={s.seekerNote}>
        <Text style={s.seekerNoteText}>
          📱 <Text style={s.bold}>Seeker users:</Text> every AutonoMonke trade counts toward your SKR Activity Tracker points.
        </Text>
      </View>

      <CheckboxRow
        checked={riskAck}
        onToggle={() => setRiskAck(!riskAck)}
        label="I understand I may lose any or all funds I deposit into the hot wallet."
      />
      <CheckboxRow
        checked={responsibilityAck}
        onToggle={() => setResponsibilityAck(!responsibilityAck)}
        label="I am solely responsible for funding, configuring, and monitoring this service."
      />
    </View>
  );
}

// ── Step 2: Funding currency picker (v2.38) ─────────────────────────────────
// Three-card picker. SKR card gets a "SAVE 50%" badge that mirrors the bot-
// side feePctForBase('auto', SKR_MINT) discount — SKR-funded positions pay
// 2.5% on profits instead of 5%. Operator-stated community incentive.

function Step2Base({
  value, onChange,
}: { value: BaseCurrency; onChange: (v: BaseCurrency) => void }) {
  const options: Array<{
    sym: BaseCurrency;
    title: string;
    sub: string;
    badge?: string;
  }> = [
    { sym: 'SOL',  title: 'SOL',  sub: "Solana's native token — most liquid base across memecoins." },
    { sym: 'USDC', title: 'USDC', sub: 'Dollar-pegged. Removes SOL price exposure from your trade PnL.' },
    { sym: 'SKR',  title: 'SKR',  sub: 'The Monke community token — pay 50% less in profit fees.', badge: 'SAVE 50%' },
  ];

  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>Funding Currency</Text>
      <Text style={s.stepHint}>
        Pick the token you'll fund AutonoMonke with. Every trade round-trips
        through this currency — fund with USDC, sell back to USDC. Fund with
        SKR, sell back to SKR. Your PnL is denominated in this token.
      </Text>

      {options.map(opt => {
        const selected = value === opt.sym;
        return (
          <Pressable
            key={opt.sym}
            style={[s.baseCard, selected && s.baseCardActive]}
            onPress={() => onChange(opt.sym)}
            hitSlop={4}
          >
            <View style={s.baseCardHeader}>
              <Text style={[s.baseSym, selected && s.baseSymActive]}>{opt.title}</Text>
              {opt.badge && (
                <View style={s.baseBadge}>
                  <Text style={s.baseBadgeText}>{opt.badge}</Text>
                </View>
              )}
              <View style={[s.baseRadio, selected && s.baseRadioActive]}>
                {selected && <View style={s.baseRadioDot} />}
              </View>
            </View>
            <Text style={s.baseDesc}>{opt.sub}</Text>
          </Pressable>
        );
      })}

      <View style={s.helperBox}>
        <Text style={s.helperLabel}>You can change this later</Text>
        <Text style={s.helperText}>
          Switch the funding token any time with{' '}
          <Text style={s.mono}>/autonomonke base SOL|USDC|SKR</Text> in the bot
          DM. Currently-open positions keep their original base until close.
        </Text>
      </View>
    </View>
  );
}

// ── Step 3: Per-trade size ──────────────────────────────────────────────────

function Step3PerTrade({
  value, onChange, baseCurrency,
}: { value: number; onChange: (v: number) => void; baseCurrency: BaseCurrency }) {
  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>Per-Trade Size</Text>
      <Text style={s.stepHint}>
        How much {baseCurrency} the bot spends on every entry. Each trade is
        independent — smaller = more diversification, bigger = bigger swings
        per trade.
      </Text>

      <View style={s.heroBlock}>
        <Text style={s.heroValue}>{value.toFixed(2)}</Text>
        <Text style={s.heroUnit}>{baseCurrency} per trade</Text>
      </View>

      <Slider
        style={s.slider}
        minimumValue={0.05}
        maximumValue={1.0}
        step={0.05}
        value={value}
        onValueChange={(v) => onChange(Math.round(v * 100) / 100)}
        minimumTrackTintColor={THEME.gold}
        maximumTrackTintColor={THEME.border}
        thumbTintColor={THEME.gold}
      />

      <View style={s.sliderRange}>
        <Text style={s.sliderRangeText}>0.05</Text>
        <Text style={s.sliderRangeText}>1.0 {baseCurrency}</Text>
      </View>

      <View style={s.helperBox}>
        <Text style={s.helperLabel}>Recommended</Text>
        <Text style={s.helperText}>
          0.10 {baseCurrency} — enough room to take meaningful gains while
          keeping any single trade well-bounded.
        </Text>
      </View>
    </View>
  );
}

// ── Step 4: Risk profile ────────────────────────────────────────────────────

function Step4Risk({
  maxSOL, setMaxSOL, minConfidence, setMinConfidence, perTradeSOL, baseCurrency,
}: {
  maxSOL: number; setMaxSOL: (v: number) => void;
  minConfidence: number; setMinConfidence: (v: number) => void;
  perTradeSOL: number;
  baseCurrency: BaseCurrency;
}) {
  const exceedsCap = perTradeSOL > maxSOL;

  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>Risk Profile</Text>
      <Text style={s.stepHint}>
        Two settings — how much SOL the hot wallet holds, and how picky the bot
        is about which trades to take.
      </Text>

      {/* Max wallet */}
      <View style={s.field}>
        <Text style={s.fieldLabel}>Max hot wallet balance</Text>
        <Text style={s.fieldValue}>{maxSOL.toFixed(1)} {baseCurrency}</Text>
        <Slider
          style={s.slider}
          minimumValue={0.5}
          maximumValue={10}
          step={0.5}
          value={maxSOL}
          onValueChange={(v) => setMaxSOL(Math.round(v * 2) / 2)}
          minimumTrackTintColor={THEME.gold}
          maximumTrackTintColor={THEME.border}
          thumbTintColor={THEME.gold}
        />
        <View style={s.sliderRange}>
          <Text style={s.sliderRangeText}>0.5</Text>
          <Text style={s.sliderRangeText}>10 {baseCurrency}</Text>
        </View>
        <Text style={s.fieldHelp}>
          Profits above this auto-sweep to your main wallet. The hot wallet
          stays small.
        </Text>
        {exceedsCap && (
          <Text style={s.fieldError}>
            Per-trade ({perTradeSOL.toFixed(2)}) exceeds max ({maxSOL.toFixed(1)}).
            Bump max or go back and lower per-trade.
          </Text>
        )}
      </View>

      {/* Min confidence */}
      <View style={s.field}>
        <Text style={s.fieldLabel}>Min AI confidence</Text>
        <Text style={s.fieldValue}>{minConfidence}%</Text>
        <Slider
          style={s.slider}
          minimumValue={50}
          maximumValue={90}
          step={1}
          value={minConfidence}
          onValueChange={(v) => setMinConfidence(Math.round(v))}
          minimumTrackTintColor={THEME.gold}
          maximumTrackTintColor={THEME.border}
          thumbTintColor={THEME.gold}
        />
        <View style={s.sliderRange}>
          <Text style={s.sliderRangeText}>50 (loose)</Text>
          <Text style={s.sliderRangeText}>90 (strict)</Text>
        </View>
        <Text style={s.fieldHelp}>
          {minConfidence <= 55 && '55 = balanced. More trades, more variance.'}
          {minConfidence > 55 && minConfidence <= 70 && 'Conservative. Fewer trades, higher conviction.'}
          {minConfidence > 70 && 'Strict. Only the strongest signals fire — may go days without trading.'}
        </Text>
      </View>
    </View>
  );
}

// ── Step 5: Review ──────────────────────────────────────────────────────────

function Step5Review({
  baseCurrency, perTradeSOL, maxSOL, minConfidence, mainWallet, onEdit,
}: {
  baseCurrency: BaseCurrency;
  perTradeSOL: number;
  maxSOL: number;
  minConfidence: number;
  mainWallet: string;
  onEdit: (target: Step) => void;
}) {
  const isSkr = baseCurrency === 'SKR';
  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>Review & Activate</Text>
      <Text style={s.stepHint}>
        After activation, the bot DMs you a hot wallet address. Fund it with{' '}
        {baseCurrency} — the bot starts trading once balance crosses the
        per-trade threshold.
      </Text>

      <ReviewRow
        label="Funding currency"
        value={isSkr ? `${baseCurrency} 🍌 (50% off fees)` : baseCurrency}
        onEdit={() => onEdit(2)}
      />
      <ReviewRow label="Per-trade size" value={`${perTradeSOL.toFixed(2)} ${baseCurrency}`} onEdit={() => onEdit(3)} />
      <ReviewRow label="Max wallet" value={`${maxSOL.toFixed(1)} ${baseCurrency}`} onEdit={() => onEdit(4)} />
      <ReviewRow label="Min confidence" value={`${minConfidence}%`} onEdit={() => onEdit(4)} />
      <ReviewRow
        label="Main wallet"
        value={mainWallet ? `${mainWallet.slice(0, 6)}…${mainWallet.slice(-4)}` : '—'}
      />

      <View style={s.notice}>
        <Text style={s.noticeText}>
          You can change all of these later via DM commands or by re-running
          this wizard. Pause / withdraw / close-all are always one DM away.
        </Text>
      </View>
    </View>
  );
}

// ── Tiny components ─────────────────────────────────────────────────────────

function CheckboxRow({ checked, onToggle, label }: {
  checked: boolean; onToggle: () => void; label: string;
}) {
  return (
    <Pressable style={s.checkRow} onPress={onToggle}>
      <View style={[s.checkBox, checked && s.checkBoxChecked]}>
        {checked && <Text style={s.checkMark}>✓</Text>}
      </View>
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  );
}

function ReviewRow({ label, value, onEdit }: {
  label: string; value: string; onEdit?: () => void;
}) {
  return (
    <View style={s.reviewRow}>
      <Text style={s.reviewLabel}>{label}</Text>
      <View style={s.reviewRight}>
        <Text style={s.reviewValue}>{value}</Text>
        {onEdit && (
          <Pressable onPress={onEdit} hitSlop={10}>
            <Text style={s.reviewEdit}>Edit</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { paddingTop: 18, paddingBottom: 14, gap: 12 },

  progress: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: THEME.border,
  },
  dotActive: { backgroundColor: THEME.gold, width: 24 },
  dotComplete: { backgroundColor: THEME.gold + '88' },

  body: { maxHeight: 460 },
  bodyContent: { paddingHorizontal: 22, paddingVertical: 12, gap: 12 },

  step: { gap: 12 },
  stepTitle: {
    fontFamily: FONTS.display, fontSize: 22, color: THEME.text,
    letterSpacing: 0.4,
  },
  stepSubtitle: {
    fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.gold,
    letterSpacing: 1.2, textTransform: 'uppercase', marginTop: -8,
  },
  stepHint: {
    fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted,
    lineHeight: 19,
  },

  warnBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 4, paddingHorizontal: 10,
    backgroundColor: THEME.error + '22',
    borderWidth: 1, borderColor: THEME.error + '66',
    borderRadius: 999,
  },
  warnText: {
    fontFamily: FONTS.display, fontSize: 10, color: THEME.error,
    letterSpacing: 1.4,
  },

  bodyText: {
    fontFamily: FONTS.body, fontSize: 13, color: THEME.text,
    lineHeight: 20,
  },
  bold: { fontFamily: FONTS.bodyMed },
  seekerNote: {
    marginTop: 12,
    paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: '#1a2a1a',
    borderWidth: 1, borderColor: '#2d5a2d',
    borderRadius: 10,
  },
  seekerNoteText: {
    fontFamily: FONTS.body, fontSize: 12, color: '#7ecf7e', lineHeight: 18,
  },

  checkRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 8,
  },
  checkBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: THEME.border,
    backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  checkBoxChecked: {
    backgroundColor: THEME.gold,
    borderColor: THEME.gold,
  },
  checkMark: {
    fontFamily: FONTS.display, fontSize: 14, color: THEME.bg,
    lineHeight: 20,
  },
  checkLabel: {
    flex: 1,
    fontFamily: FONTS.body, fontSize: 13, color: THEME.text,
    lineHeight: 19,
  },

  heroBlock: {
    alignItems: 'center', paddingVertical: 8,
  },
  heroValue: {
    fontFamily: FONTS.display, fontSize: 48, color: THEME.gold,
    letterSpacing: -1, lineHeight: 52,
  },
  heroUnit: {
    fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted,
    letterSpacing: 1.4, marginTop: 4,
  },
  slider: { width: '100%', height: 40 },
  sliderRange: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 4, marginTop: -4,
  },
  sliderRangeText: {
    fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted,
  },

  helperBox: {
    backgroundColor: THEME.surface, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12, gap: 4,
    borderWidth: 1, borderColor: THEME.border,
  },
  helperLabel: {
    fontFamily: FONTS.mono, fontSize: 9, color: THEME.gold,
    letterSpacing: 1.2,
  },
  helperText: {
    fontFamily: FONTS.body, fontSize: 12, color: THEME.text, lineHeight: 17,
  },
  mono: { fontFamily: FONTS.mono, fontSize: 11 },

  // Base-currency picker (v2.38)
  baseCard: {
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1.5, borderColor: THEME.border,
    paddingVertical: 12, paddingHorizontal: 14,
    gap: 6,
  },
  baseCardActive: {
    borderColor: THEME.gold,
    backgroundColor: THEME.gold + '0F',
  },
  baseCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  baseSym: {
    fontFamily: FONTS.display, fontSize: 18, color: THEME.text,
    letterSpacing: 0.4, flex: 1,
  },
  baseSymActive: { color: THEME.gold },
  baseBadge: {
    paddingVertical: 3, paddingHorizontal: 8,
    backgroundColor: THEME.gold,
    borderRadius: 999,
  },
  baseBadgeText: {
    fontFamily: FONTS.display, fontSize: 9, color: THEME.bg,
    letterSpacing: 1.2,
  },
  baseRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: THEME.border,
    alignItems: 'center', justifyContent: 'center',
  },
  baseRadioActive: { borderColor: THEME.gold },
  baseRadioDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: THEME.gold,
  },
  baseDesc: {
    fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted,
    lineHeight: 17,
  },

  field: { gap: 4 },
  fieldLabel: {
    fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.text,
  },
  fieldValue: {
    fontFamily: FONTS.display, fontSize: 26, color: THEME.gold,
    letterSpacing: -0.4,
  },
  fieldHelp: {
    fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted,
    lineHeight: 16,
  },
  fieldError: {
    fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.error,
    marginTop: 4,
  },

  reviewRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: THEME.border,
  },
  reviewLabel: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted },
  reviewRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reviewValue: {
    fontFamily: FONTS.display, fontSize: 14, color: THEME.text,
  },
  reviewEdit: {
    fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.gold,
  },

  notice: {
    backgroundColor: THEME.surface, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: THEME.border,
    marginTop: 8,
  },
  noticeText: {
    fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted,
    lineHeight: 17,
  },

  actionRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 22, paddingTop: 4,
  },
  btn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: THEME.border },
  btnGhostText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted },
  btnSecondary: { backgroundColor: THEME.surfaceHigh, borderWidth: 1, borderColor: THEME.border },
  btnSecondaryText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.text },
  btnPrimary: { backgroundColor: THEME.gold },
  btnPrimaryText: { fontFamily: FONTS.display, fontSize: 13, color: THEME.bg },
  btnDisabled: { opacity: 0.4 },
});
