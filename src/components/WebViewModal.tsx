/**
 * WebViewModal — full-screen in-app browser for MonkeTools and other internal links.
 *
 * Top bar: close (✕), title, refresh, open-in-external-browser fallback.
 * Loading bar appears at the top while the page loads.
 *
 * For dApps that require wallet sign-in (allowlisted in WALLET_REQUIRED_HOSTS),
 * a banner shows below the top bar: "Sign-in needs Solflare — Open there".
 * Tapping the banner deep-links to Solflare's in-app browser with the same URL,
 * where the user's wallet context is already active.
 *
 * Long-term: a JS-injected Wallet Standard provider could bridge MWA into the
 * WebView so all 6 MonkeTools work fully in-app (see memory:
 * project_webview_wallet_bridge_pending.md).
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

// Hosts that require wallet sign-in to be useful. WebViewModal shows a banner
// nudging the user to open these in Solflare's in-app browser (their tested
// known-good context). Add a host here if a new dApp needs wallet auth.
const WALLET_REQUIRED_HOSTS: ReadonlySet<string> = new Set([
  "shop.sagamonkes.com",
  "swap.sagamonkes.com",
]);

/** Build a Solflare universal-link to open `url` inside Solflare's in-app browser. */
function solflareBrowseUrl(url: string): string {
  const encoded = encodeURIComponent(url);
  const ref = encodeURIComponent("https://onlymonkes.com");
  return `https://solflare.com/ul/v1/browse/${encoded}?ref=${ref}`;
}

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

  const activeUrl = currentUrl ?? url;
  const displayHost = (() => {
    try {
      return new URL(activeUrl).host;
    } catch {
      return activeUrl;
    }
  })();
  const needsWallet = WALLET_REQUIRED_HOSTS.has(displayHost);

  const handleOpenInSolflare = () => {
    Linking.openURL(solflareBrowseUrl(activeUrl)).catch(() => {});
    onClose();
  };

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

        {/* Wallet sign-in banner — only shown for hosts that need wallet auth */}
        {needsWallet && (
          <Pressable style={styles.walletBanner} onPress={handleOpenInSolflare}>
            <Text style={styles.walletBannerIcon}>🔐</Text>
            <View style={styles.walletBannerText}>
              <Text style={styles.walletBannerTitle}>
                Sign-in needs your wallet
              </Text>
              <Text style={styles.walletBannerSub}>
                Tap to open this page in Solflare to connect
              </Text>
            </View>
            <Text style={styles.walletBannerArrow}>↗</Text>
          </Pressable>
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
  walletBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(255,213,79,0.08)",
    borderBottomWidth: 0.75,
    borderBottomColor: "rgba(255,213,79,0.18)",
  },
  walletBannerIcon: { fontSize: 18 },
  walletBannerText: { flex: 1 },
  walletBannerTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: "#FFD54F",
  },
  walletBannerSub: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
    marginTop: 1,
  },
  walletBannerArrow: {
    fontSize: 16,
    color: "#FFD54F",
  },
});
