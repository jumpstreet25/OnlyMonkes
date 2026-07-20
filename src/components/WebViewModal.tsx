/**
 * WebViewModal — full-screen in-app browser for MonkeTools and other internal links.
 *
 * Top bar: close (✕), title, refresh, open-in-external-browser fallback.
 * Loading bar appears at the top while the page loads.
 *
 * For allowlisted hosts (WALLET_BRIDGE_HOSTS), injects a Wallet Standard
 * provider that bridges sign requests to the user's already-connected MWA
 * wallet (Solflare/Seeker biometric). dApps see "OnlyMonkes Wallet" in their
 * wallet adapter list. See src/lib/walletBridge.ts for the bridge protocol.
 */

import React, { useRef, useState, useMemo } from "react";
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
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Inline shape of the WebView's onShouldStartLoadWithRequest argument —
// avoids depending on a non-public subpath import.
interface NavRequest {
  url: string;
  navigationType?: string;
  isTopFrame?: boolean;
}
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { buildWalletBridgeJs, handleBridgeMessage } from "@/lib/walletBridge";

// Hosts that get the Wallet Standard bridge injected. Only first-party Saga
// Monkes properties — strict allowlist so random sites can't trigger MWA.
const WALLET_BRIDGE_HOSTS: ReadonlySet<string> = new Set([
  "shop.sagamonkes.com",
  "swap.sagamonkes.com",
  "explorer.sagamonkes.com",
  "merits.sagamonkes.com",
  "signal.sagamonkes.com",
  "snap.sagamonkes.com",
]);

function shouldInjectBridge(url: string | null): boolean {
  if (!url) return false;
  try {
    return WALLET_BRIDGE_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

// Local error boundary — catches any render error inside the WebView modal
// so it doesn't bubble up to the ChatScreen-level boundary and crash chat.
class WebViewErrorBoundary extends React.Component<
  { onClose: () => void; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) console.warn("[WebViewModal] caught:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <View style={[styles.root, { justifyContent: "center", alignItems: "center", padding: 24 }]}>
          <Text style={{ fontFamily: FONTS.display, fontSize: 18, color: THEME.text, marginBottom: 8 }}>
            Couldn't open this page
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center", marginBottom: 24 }}>
            {this.state.error.message ?? "Unexpected error"}
          </Text>
          <Pressable
            onPress={this.props.onClose}
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 0.75,
              borderColor: "rgba(255,255,255,0.1)",
            }}
          >
            <Text style={{ fontFamily: FONTS.bodyMed, color: THEME.text, fontSize: 14 }}>Close</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
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
  const walletAddress = useAppStore((s) => s.wallet?.address);

  // Reset URL when re-opening with a new target
  React.useEffect(() => {
    if (visible && url) setCurrentUrl(url);
  }, [visible, url]);

  // Build the bridge JS once per (target host, wallet) pair. The host is
  // checked at injection time — bridge is only active on allowlisted Saga
  // Monkes hosts. Wrapped in try/catch: any failure here falls back to plain
  // WebView rather than crashing the parent (ChatScreen).
  const injectedBridgeJs = useMemo(() => {
    try {
      if (!url || !walletAddress) return undefined;
      if (!shouldInjectBridge(url)) return undefined;
      return buildWalletBridgeJs(walletAddress);
    } catch (err) {
      if (__DEV__) console.warn("[WebViewModal] bridge init failed:", err);
      return undefined;
    }
  }, [url, walletAddress]);

  const handleMessage = React.useCallback(
    (event: WebViewMessageEvent) => {
      try {
        handleBridgeMessage(event.nativeEvent.data, webRef).catch((err) => {
          if (__DEV__) console.warn("[WebViewModal] bridge msg failed:", err);
        });
      } catch (err) {
        if (__DEV__) console.warn("[WebViewModal] onMessage threw:", err);
      }
    },
    [],
  );

  // ── Navigation allowlist guard ────────────────────────────────────────────
  // When the WebView opened with the bridge active (URL on the allowlist), we
  // refuse to navigate to any non-allowlisted host for the rest of the session.
  // Closes a real-but-narrow attack vector: if a Saga Monkes property is ever
  // compromised and tries to redirect to attacker.com, the malicious page never
  // loads in our WebView — so it can't construct a tx and call our injected
  // signAndSendTransaction.
  const [blockedHost, setBlockedHost] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const onShouldStartLoadWithRequest = React.useCallback(
    (req: NavRequest): boolean => {
      // Only enforce when bridge is active. Plain WebViews (no MWA exposure)
      // are free to navigate anywhere — same trust level as a regular browser.
      if (!injectedBridgeJs) return true;
      let parsed: URL;
      try {
        parsed = new URL(req.url);
      } catch {
        // about:blank, data:, blob:, javascript:, etc. — allow (no http host
        // to evaluate; these can't reach attacker.com on their own).
        return true;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return true;
      }
      if (WALLET_BRIDGE_HOSTS.has(parsed.host)) {
        return true;
      }
      // Block + surface to user.
      if (__DEV__) console.warn("[WebViewModal] blocked off-allowlist nav:", parsed.host);
      setBlockedHost(parsed.host);
      setBlockedUrl(req.url);
      return false;
    },
    [injectedBridgeJs],
  );

  const dismissBlocked = React.useCallback(() => {
    setBlockedHost(null);
    setBlockedUrl(null);
  }, []);

  const openBlockedExternally = React.useCallback(() => {
    if (blockedUrl) Linking.openURL(blockedUrl).catch(() => {});
    dismissBlocked();
  }, [blockedUrl, dismissBlocked]);

  if (!url) return null;

  const displayHost = (() => {
    try {
      return new URL(currentUrl ?? url).host;
    } catch {
      return currentUrl ?? url;
    }
  })();
  const bridgeActive = !!injectedBridgeJs;
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" translucent />
      <WebViewErrorBoundary onClose={onClose}>
      <View style={styles.root}>
        {/* Top bar */}
        <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>

          <View style={styles.titleWrap}>
            {title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
            <View style={styles.hostRow}>
              <Text style={styles.host} numberOfLines={1}>{displayHost}</Text>
              {bridgeActive && (
                <View style={styles.bridgePill}>
                  <Text style={styles.bridgePillText}>WALLET</Text>
                </View>
              )}
            </View>
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

        {/* Off-allowlist navigation warning — appears only when the bridge
            blocked an attempted navigation to a non-Saga-Monkes host. */}
        {blockedHost && (
          <View style={styles.blockedBar}>
            <Text style={styles.blockedIcon}>⚠</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.blockedTitle}>
                Blocked navigation to {blockedHost}
              </Text>
              <Text style={styles.blockedSub}>
                The wallet bridge only allows Saga Monkes properties.
              </Text>
            </View>
            <Pressable onPress={openBlockedExternally} hitSlop={10} style={styles.blockedBtn}>
              <Text style={styles.blockedBtnText}>Open externally</Text>
            </Pressable>
            <Pressable onPress={dismissBlocked} hitSlop={10} style={styles.blockedBtn}>
              <Text style={styles.blockedBtnText}>Dismiss</Text>
            </Pressable>
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
          // Hard-fail on off-allowlist navigation when bridge is active.
          // Defence-in-depth against a hijacked Saga Monkes property trying to
          // redirect to attacker.com to steal an MWA sign.
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          // Wallet bridge: only injected for allowlisted Saga Monkes hosts.
          // `injectedJavaScript` runs after the document loads — works on both
          // iOS and Android. Bridge re-checks if it's already installed via
          // the window.__OM_WALLET_BRIDGE__ guard, so re-runs are no-ops.
          injectedJavaScript={injectedBridgeJs}
          onMessage={injectedBridgeJs ? handleMessage : undefined}
        />
      </View>
      </WebViewErrorBoundary>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0F" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
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
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 1,
  },
  bridgePill: {
    backgroundColor: "rgba(20,241,149,0.10)",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 0.75,
    borderColor: "rgba(20,241,149,0.30)",
  },
  bridgePillText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: "#14F195",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  blockedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderBottomWidth: 0.75,
    borderBottomColor: "rgba(239,68,68,0.30)",
  },
  blockedIcon: { fontSize: 16, color: "#EF4444" },
  blockedTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 12,
    color: "#EF4444",
  },
  blockedSub: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: THEME.textMuted,
    marginTop: 1,
  },
  blockedBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.10)",
  },
  blockedBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.text,
    letterSpacing: 0.3,
  },
});
