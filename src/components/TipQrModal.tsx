/**
 * TipQrModal
 *
 * Displays a Solana Pay QR code for tipping a user.
 * Uses a free QR API to render the code as an image (no native SVG needed).
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { GlassModal } from '@/components/GlassModal';
import { THEME, FONTS } from '@/lib/constants';
import { createTipUrl, isValidSolanaAddress } from '@/lib/solanaPay';

const PRESET_AMOUNTS = [0.1, 0.5, 1];
const QR_SIZE = 220;

interface TipQrModalProps {
  visible: boolean;
  onClose: () => void;
  recipientWallet: string;
  recipientUsername: string;
  recipientAvatar?: string | null;
}

export function TipQrModal({
  visible,
  onClose,
  recipientWallet,
  recipientUsername,
  recipientAvatar,
}: TipQrModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [qrLoading, setQrLoading] = useState(true);

  const amount = selectedPreset ?? (customAmount ? parseFloat(customAmount) : undefined);
  const validAmount = amount && !isNaN(amount) && amount > 0 ? amount : undefined;

  const solanaPayUrl = useMemo(
    () => createTipUrl(
      recipientWallet,
      validAmount,
      undefined,
      `Tip ${recipientUsername}`,
      `Tip to ${recipientUsername} via OnlyMonkes`,
    ),
    [recipientWallet, validAmount, recipientUsername],
  );

  const qrImageUrl = useMemo(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=${QR_SIZE}x${QR_SIZE}&bgcolor=0A0A0F&color=F8F8FF&data=${encodeURIComponent(solanaPayUrl)}`,
    [solanaPayUrl],
  );

  const handlePreset = (val: number) => {
    setCustomAmount('');
    setSelectedPreset(prev => prev === val ? null : val);
    setQrLoading(true);
  };

  const handleCustomChange = (text: string) => {
    // Allow only numbers and one decimal point
    const cleaned = text.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned;
    setCustomAmount(sanitized);
    setSelectedPreset(null);
    setQrLoading(true);
  };

  const isValid = isValidSolanaAddress(recipientWallet);

  return (
    <GlassModal visible={visible} onClose={onClose} cardStyle={styles.card}>
      {/* Header */}
      <Text style={styles.title}>Tip</Text>

      {/* Recipient info */}
      <View style={styles.recipientRow}>
        {recipientAvatar ? (
          <Image source={{ uri: recipientAvatar }} style={styles.recipientAvatar} />
        ) : (
          <View style={styles.recipientAvatarFallback} />
        )}
        <Text style={styles.recipientName}>{recipientUsername}</Text>
      </View>

      {!isValid ? (
        <Text style={styles.errorText}>Invalid wallet address</Text>
      ) : (
        <>
          {/* Wallet address */}
          <View style={styles.walletPill}>
            <Text style={styles.walletText}>
              {recipientWallet.slice(0, 6)}...{recipientWallet.slice(-4)}
            </Text>
          </View>

          {/* Preset amounts */}
          <View style={styles.presetRow}>
            {PRESET_AMOUNTS.map(val => (
              <Pressable
                key={val}
                style={[
                  styles.presetBtn,
                  selectedPreset === val && styles.presetBtnActive,
                ]}
                onPress={() => handlePreset(val)}
              >
                <Text style={[
                  styles.presetText,
                  selectedPreset === val && styles.presetTextActive,
                ]}>
                  {val} SOL
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Custom amount input */}
          <View style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              placeholder="Custom amount"
              placeholderTextColor={THEME.textFaint}
              value={customAmount}
              onChangeText={handleCustomChange}
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            <Text style={styles.customSuffix}>SOL</Text>
          </View>

          {/* QR Code */}
          <View style={styles.qrContainer}>
            {qrLoading && (
              <ActivityIndicator
                size="large"
                color={THEME.accent}
                style={styles.qrLoader}
              />
            )}
            <Image
              source={{ uri: qrImageUrl }}
              style={[styles.qrImage, qrLoading && { opacity: 0 }]}
              onLoad={() => setQrLoading(false)}
              onError={() => setQrLoading(false)}
            />
          </View>

          {/* Amount display */}
          <Text style={styles.amountLabel}>
            {validAmount ? `${validAmount} SOL` : 'Open amount'}
          </Text>

          {/* Instructions */}
          <Text style={styles.instructions}>
            Scan with any Solana wallet
          </Text>
        </>
      )}

      {/* Close */}
      <Pressable onPress={onClose} style={styles.closeBtn}>
        <Text style={styles.closeBtnText}>Close</Text>
      </Pressable>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: 10,
    paddingBottom: 20,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recipientAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  recipientAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(108, 180, 238, 0.15)',
  },
  recipientName: {
    fontFamily: FONTS.displayMed,
    fontSize: 16,
    color: THEME.text,
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.error,
    textAlign: 'center',
    marginVertical: 12,
  },
  walletPill: {
    backgroundColor: THEME.surface,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  walletText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.textFaint,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  presetBtn: {
    backgroundColor: THEME.surface,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  presetBtnActive: {
    backgroundColor: 'rgba(124,58,237,0.2)',
    borderColor: THEME.accent,
  },
  presetText: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: THEME.textMuted,
  },
  presetTextActive: {
    color: THEME.accent,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: THEME.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 14,
  },
  customInput: {
    flex: 1,
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: THEME.text,
    paddingVertical: 10,
  },
  customSuffix: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.textFaint,
    marginLeft: 8,
  },
  qrContainer: {
    width: QR_SIZE + 20,
    height: QR_SIZE + 20,
    borderRadius: 16,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  qrLoader: {
    position: 'absolute',
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
    borderRadius: 8,
  },
  amountLabel: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: THEME.accent,
  },
  instructions: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
    letterSpacing: 0.5,
  },
  closeBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: THEME.surface,
  },
  closeBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
});
