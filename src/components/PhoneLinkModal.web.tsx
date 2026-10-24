/**
 * Web Avatar Room: QR that turns a phone into this computer's mic + camera
 * (src/lib/phoneCompanion.web.ts). The link stays up after the window closes.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { MonkeGlass } from "@/components/MonkeGlass";
import { THEME, FONTS } from "@/lib/constants";

export function PhoneLinkModal({ visible, url, error, connected, onClose, onStop }: {
  visible: boolean;
  url: string | null;
  error: string | null;
  connected: boolean;
  onClose: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    setQr(null);
    if (!url) return;
    let live = true;
    // The link carries a room pass, so it's long: low error correction keeps the QR scannable.
    QRCode.toDataURL(url, { margin: 1, width: 300, errorCorrectionLevel: "L" }).then((d) => { if (live) setQr(d); }).catch(() => {});
    return () => { live = false; };
  }, [url]);

  return (
    <MonkeGlass visible={visible} onClose={onClose} cardStyle={styles.card}>
      <Text style={styles.title}>{t("avatarRoom.phoneTitle")}</Text>
      {connected ? (
        <>
          <Text style={styles.ok}>{t("avatarRoom.phoneConnected")}</Text>
          <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
            <Text style={styles.buttonText}>{t("avatarRoom.phoneDone")}</Text>
          </Pressable>
          <Pressable onPress={onStop} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>{t("avatarRoom.phoneStop")}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.step}>{t("avatarRoom.phoneStep1")}</Text>
          <Text style={styles.step}>{t("avatarRoom.phoneStep2")}</Text>
          <View style={styles.qrBox}>
            {qr ? <Image source={{ uri: qr }} style={styles.qr} accessibilityLabel={t("avatarRoom.phoneTitle")} /> : error ? null : <ActivityIndicator color={THEME.accent} />}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.muted}>{t("avatarRoom.phoneWaiting")}</Text>}
          <Text style={styles.note}>{t("avatarRoom.phoneNote")}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>{t("avatarRoom.phoneClose")}</Text>
          </Pressable>
        </>
      )}
    </MonkeGlass>
  );
}

const styles = StyleSheet.create({
  card: { maxWidth: 420, width: "100%", alignSelf: "center", padding: 22 },
  title: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text, textAlign: "center", marginBottom: 12 },
  step: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, lineHeight: 20, marginBottom: 4 },
  qrBox: { alignSelf: "center", width: 312, height: 312, marginTop: 12, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  qr: { width: 300, height: 300 },
  ok: { fontFamily: FONTS.bodySemi, fontSize: 15, color: THEME.text, textAlign: "center", marginTop: 4, lineHeight: 21 },
  muted: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center", marginTop: 8 },
  error: { fontFamily: FONTS.body, fontSize: 14, color: THEME.error, textAlign: "center", marginTop: 8 },
  note: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textDim, textAlign: "center", marginTop: 14, lineHeight: 17 },
  button: { alignSelf: "center", marginTop: 14, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: THEME.accent },
  buttonText: { fontFamily: FONTS.bodySemi, fontSize: 14, color: "#fff" },
  cancel: { alignSelf: "center", marginTop: 12, padding: 8 },
  cancelText: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted },
});
