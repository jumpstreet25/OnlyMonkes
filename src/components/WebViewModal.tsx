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
  // Monkes hosts.
  const injectedBridgeJs = useMemo(() => {
    if (!url || !walletAddress) return undefined;
    if (!shouldInjectBridge(url)) return undefined;
    return buildWalletBridgeJs(walletAddress);
  }, [url, walletAddress]);

  const handleMessage = React.useCallback(
    (event: WebViewMessageEvent) => {
      handleBridgeMessage(event.nativeEvent.data, webRef).catch(() => {});
    },
    [],
  );

  if (!url) return null;

  const displayHost = (() => {
    try {
      return new URL(currentUrl ?? url).host;
    } catch {
      return currentUrl ?? url;
    }
  })();
  const bridgeActive = !!injectedBridgeJs;

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
          // Wallet bridge: only injected for allowlisted Saga Monkes hosts.
          injectedJavaScriptBeforeContentLoaded={injectedBridgeJs}
          onMessage={injectedBridgeJs ? handleMessage : undefined}
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
});
