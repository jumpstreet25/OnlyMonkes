/**
 * WebViewModal — full-screen in-app browser for MonkeTools and other internal links.
 *
 * Top bar: close (✕), title, refresh, open-in-external-browser fallback.
 * Loading bar appears at the top while the page loads.
 *
 * Note on wallet integration: this is a vanilla WebView. dApps loaded here
 * will see no injected wallet provider — they'll prompt the user to install
 * Phantom/Solflare/etc. inside the WebView and fail to connect. A future
 * iteration will inject a Solana wallet provider that bridges to MWA so
 * dApps like MonkeShop/MonkeSwap can use the user's already-connected wallet.
 */

import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
  Linking,
  StatusBar,
  Platform,
} from "react-native";
import { WebView } from "react-native-webview";
import { THEME, FONTS } from "@/lib/constants";

interface WebViewModalProps {
  visible: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
}

export function WebViewModal({ visible, url, title, onClose }: WebViewModalProps) {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState<string | null>(url);

  // Reset URL when re-opening with a new target
  React.useEffect(() => {
    if (visible && url) setCurrentUrl(url);
  }, [visible, url]);

  if (!url) return null;

  const displayHost = (() => {
    try {
      return new URL(currentUrl ?? url).host;
    } catch {
      return currentUrl ?? url;
    }
  })();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" translucent />
      <View style={styles.root}>
        {/* Top bar */}
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>

          <View style={styles.titleWrap}>
            {title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
            <Text style={styles.host} numberOfLines={1}>{displayHost}</Text>
          </View>

          <Pressable
            onPress={() => webRef.current?.reload()}
            hitSlop={12}
            style={styles.iconBtn}
          >
            <Text style={styles.iconText}>↻</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(currentUrl ?? url).catch(() => {})}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityLabel="Open in browser"
          >
            <Text style={styles.iconText}>↗</Text>
          </Pressable>
        </View>

        {/* Loading bar */}
        {loading && (
          <View style={styles.loadingBar}>
            <ActivityIndicator size="small" color="#FFD54F" />
          </View>
        )}

        <WebView
          ref={webRef}
          source={{ uri: url }}
          style={{ flex: 1, backgroundColor: "#0A0A0F" }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(nav) => setCurrentUrl(nav.url)}
          startInLoadingState
          allowsBackForwardNavigationGestures={Platform.OS === "ios"}
          javaScriptEnabled
          domStorageEnabled
          decelerationRate="normal"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0F" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 52,
    paddingBottom: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(10, 10, 15, 0.96)",
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.08)",
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
  },
  iconText: { fontSize: 16, color: THEME.text },
  closeIcon: { fontSize: 16, color: THEME.text },
  titleWrap: { flex: 1, paddingHorizontal: 8 },
  title: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.text,
  },
  host: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    marginTop: 1,
  },
  loadingBar: {
    height: 3,
    backgroundColor: "rgba(255,213,79,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
});
