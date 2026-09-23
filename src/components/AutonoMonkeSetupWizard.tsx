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
import { isInactiveMlsError, markBotDmBroken, postBotCommand, applyBotCommandResult } from '@/lib/botCommand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toast } from 'sonner-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

const BOT_INBOX_ID = '998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363';
const STORAGE_KEY = 'automonke_enrolled';

type BaseCurrency = 'SOL' | 'SKR';

const DEFAULTS = {
  baseCurrency: 'SKR' as BaseCurrency,
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
  const { t } = useTranslation();
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
      const payload = {
        mainWallet: wallet.address,
        maxSOL,
        perTradeSOL,
        minConfidence,
        baseCurrency,
      };
      const command = `/autonomonke setup ${JSON.stringify(payload)}`;
      const client = getXmtpClient();
      let sentViaHttp = false;
      try {
        if (!client) throw new Error('Not connected to chat');
        const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
        if (!dm) throw new Error('Could not open bot DM.');
        const sentAt = Date.now();
        await sendDmMessage(dm, command, username);
        // 2026-09-13: dm.send() into an MLS-inactive 1:1 resolves normally
        // (no throw), so the catch block below can silently miss a genuine
        // failure here — enrollment would never actually reach the bot
        // while the UI shows "Activating…" as if it had. Background
        // correction: if no bot activity follows within the window, retry
        // via HTTP so enrollment still lands even though the optimistic
        // UI has already moved on.
        setTimeout(() => {
          void (async () => {
            const { getLastBotActivityTs } = await import('@/lib/botCommand');
            if (getLastBotActivityTs() >= sentAt) return;
            try {
              await markBotDmBroken();
              applyBotCommandResult(await postBotCommand(command));
            } catch (httpErr) {
              if (__DEV__) console.warn('[AutonoMonke] setup reply-timeout fallback failed:', (httpErr as Error).message);
            }
          })();
        }, 40_000);
      } catch (dmErr) {
        await markBotDmBroken();
        if (__DEV__ && !isInactiveMlsError(dmErr)) {
          console.warn('[AutonoMonke] setup DM failed, trying HTTP:', (dmErr as Error).message);
        }
        const result = await postBotCommand(command);
        applyBotCommandResult(result);
        sentViaHttp = true;
      }
      await AsyncStorage.setItem(STORAGE_KEY, '1');
      // Optimistic — bot AUTOMONKE_STATUS will confirm; keep pill in sync now.
      useAppStore.getState().setAutomonkeStatus({
        enrolled: true,
        active: true,
        limitOrdersEnabled: useAppStore.getState().automonkeStatus?.limitOrdersEnabled ?? false,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // 2026-07-20: closing the Modal in the same tick as the toast mounting
      // (plus a navigation on top here) races the Android Dialog window
      // teardown — grey-screen freeze, same bug class as
      // BananaBetPopup.handlePlaceBet / UsernameModal.handleSave. Close
      // first, let the Modal's own dismissal clear, then toast + navigate.
      handleClose();
      setTimeout(() => {
        toast.success(sentViaHttp ? 'AutonoMonke activated (network fallback).' : 'Activating AutonoMonke…');
        if (!sentViaHttp) router.push(`/dm/${BOT_INBOX_ID}` as any);
      }, 350);
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
              <Text style={s.btnGhostText}>{t('autonoWizard.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnSecondary, (!riskAck || !responsibilityAck) && s.btnDisabled]}
              onPress={handleUseDefaults}
              disabled={!riskAck || !responsibilityAck}
            >
              <Text style={s.btnSecondaryText}>{t('autonoWizard.useDefaults')}</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary, (!riskAck || !responsibilityAck) && s.btnDisabled]}
              onPress={() => setStep(2)}
              disabled={!riskAck || !responsibilityAck}
            >
              <Text style={s.btnPrimaryText}>{t('autonoWizard.customize')}</Text>
            </Pressable>
          </>
        ) : step < 5 ? (
          <>
            <Pressable
              style={[s.btn, s.btnGhost]}
              onPress={() => setStep((step - 1) as Step)}
            >
              <Text style={s.btnGhostText}>{t('autonoWizard.back')}</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary]}
              onPress={() => setStep((step + 1) as Step)}
            >
              <Text style={s.btnPrimaryText}>{t('autonoWizard.next')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={[s.btn, s.btnGhost]}
              onPress={() => setStep(4)}
              disabled={submitting}
            >
              <Text style={s.btnGhostText}>{t('autonoWizard.back')}</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary, submitting && s.btnDisabled]}
              onPress={handleActivate}
              disabled={submitting}
            >
              <Text style={s.btnPrimaryText}>
                {submitting ? t('autonoWizard.activating') : t('autonoWizard.activate')}
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
  const { t } = useTranslation();
  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>AutonoMonke</Text>
      <Text style={s.stepSubtitle}>{t('autonoWizard.step1.subtitle')}</Text>

      <View style={s.warnBadge}>
        <Text style={s.warnText}>{t('autonoWizard.step1.riskBadge')}</Text>
      </View>

      <Text style={s.bodyText}>
        {t('autonoWizard.step1.bodyPart1')}{"\n\n"}
        {t('autonoWizard.step1.bodyPart2')}<Text style={s.bold}>{t('autonoWizard.step1.feeProfitBold')}</Text>{t('autonoWizard.step1.bodyPart3')}
        <Text style={s.bold}>{t('autonoWizard.step1.feeSkrBold')}</Text>{t('autonoWizard.step1.bodyPart4')}
      </Text>

      <View style={s.seekerNote}>
        <Text style={s.seekerNoteText}>
          📱 <Text style={s.bold}>{t('autonoWizard.step1.seekerLabel')}</Text>{t('autonoWizard.step1.seekerText')}
        </Text>
      </View>

      <CheckboxRow
        checked={riskAck}
        onToggle={() => setRiskAck(!riskAck)}
        label={t('autonoWizard.step1.ack1')}
      />
      <CheckboxRow
        checked={responsibilityAck}
        onToggle={() => setResponsibilityAck(!responsibilityAck)}
        label={t('autonoWizard.step1.ack2')}
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
  const { t } = useTranslation();
  const options: Array<{
    sym: BaseCurrency;
    title: string;
    sub: string;
    badge?: string;
  }> = [
    { sym: 'SKR', title: t('autonoWizard.step2.skrTitle'), sub: t('autonoWizard.step2.skrSub'), badge: t('autonoWizard.step2.skrBadge') },
    { sym: 'SOL', title: t('autonoWizard.step2.solTitle'), sub: t('autonoWizard.step2.solSub') },
  ];

  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>{t('autonoWizard.step2.title')}</Text>
      <Text style={s.stepHint}>
        {t('autonoWizard.step2.hint')}
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
        <Text style={s.helperLabel}>{t('autonoWizard.step2.helperLabel')}</Text>
        <Text style={s.helperText}>
          {t('autonoWizard.step2.helperTextPart1')}
          <Text style={s.mono}>/autonomonke base SOL|SKR</Text>{t('autonoWizard.step2.helperTextPart2')}
        </Text>
      </View>
    </View>
  );
}

// ── Step 3: Per-trade size ──────────────────────────────────────────────────

function Step3PerTrade({
  value, onChange, baseCurrency,
}: { value: number; onChange: (v: number) => void; baseCurrency: BaseCurrency }) {
  const { t } = useTranslation();
  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>{t('autonoWizard.step3.title')}</Text>
      <Text style={s.stepHint}>
        {t('autonoWizard.step3.hint', { baseCurrency })}
      </Text>

      <View style={s.heroBlock}>
        <Text style={s.heroValue}>{value.toFixed(2)}</Text>
        <Text style={s.heroUnit}>{t('autonoWizard.step3.heroUnit', { baseCurrency })}</Text>
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
        <Text style={s.sliderRangeText}>{t('autonoWizard.step3.sliderMax', { baseCurrency })}</Text>
      </View>

      <View style={s.helperBox}>
        <Text style={s.helperLabel}>{t('autonoWizard.step3.helperLabel')}</Text>
        <Text style={s.helperText}>
          {t('autonoWizard.step3.helperText', { baseCurrency })}
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
  const { t } = useTranslation();

  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>{t('autonoWizard.step4.title')}</Text>
      <Text style={s.stepHint}>
        {t('autonoWizard.step4.hint')}
      </Text>

      {/* Max wallet */}
      <View style={s.field}>
        <Text style={s.fieldLabel}>{t('autonoWizard.step4.maxWalletLabel')}</Text>
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
          {t('autonoWizard.step4.maxWalletHelp')}
        </Text>
        {exceedsCap && (
          <Text style={s.fieldError}>
            {t('autonoWizard.step4.exceedsCap', { perTrade: perTradeSOL.toFixed(2), max: maxSOL.toFixed(1) })}
          </Text>
        )}
      </View>

      {/* Min confidence */}
      <View style={s.field}>
        <Text style={s.fieldLabel}>{t('autonoWizard.step4.minConfidenceLabel')}</Text>
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
          <Text style={s.sliderRangeText}>{t('autonoWizard.step4.sliderLoose')}</Text>
          <Text style={s.sliderRangeText}>{t('autonoWizard.step4.sliderStrict')}</Text>
        </View>
        <Text style={s.fieldHelp}>
          {minConfidence <= 55 && t('autonoWizard.step4.confBalanced')}
          {minConfidence > 55 && minConfidence <= 70 && t('autonoWizard.step4.confConservative')}
          {minConfidence > 70 && t('autonoWizard.step4.confStrict')}
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
  const { t } = useTranslation();
  return (
    <View style={s.step}>
      <Text style={s.stepTitle}>{t('autonoWizard.step5.title')}</Text>
      <Text style={s.stepHint}>
        {t('autonoWizard.step5.hint', { baseCurrency })}
      </Text>

      <ReviewRow
        label={t('autonoWizard.step5.fundingCurrency')}
        value={isSkr ? `${baseCurrency}${t('autonoWizard.step5.skrDiscount')}` : baseCurrency}
        onEdit={() => onEdit(2)}
      />
      <ReviewRow label={t('autonoWizard.step5.perTradeSize')} value={`${perTradeSOL.toFixed(2)} ${baseCurrency}`} onEdit={() => onEdit(3)} />
      <ReviewRow label={t('autonoWizard.step5.maxWallet')} value={`${maxSOL.toFixed(1)} ${baseCurrency}`} onEdit={() => onEdit(4)} />
      <ReviewRow label={t('autonoWizard.step5.minConfidence')} value={`${minConfidence}%`} onEdit={() => onEdit(4)} />
      <ReviewRow
        label={t('autonoWizard.step5.mainWallet')}
        value={mainWallet ? `${mainWallet.slice(0, 6)}…${mainWallet.slice(-4)}` : '—'}
      />

      <View style={s.notice}>
        <Text style={s.noticeText}>
          {t('autonoWizard.step5.notice')}
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
  const { t } = useTranslation();
  return (
    <View style={s.reviewRow}>
      <Text style={s.reviewLabel}>{label}</Text>
      <View style={s.reviewRight}>
        <Text style={s.reviewValue}>{value}</Text>
        {onEdit && (
          <Pressable onPress={onEdit} hitSlop={10}>
            <Text style={s.reviewEdit}>{t('autonoWizard.edit')}</Text>
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
