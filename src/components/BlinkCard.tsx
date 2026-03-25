/**
 * BlinkCard — renders an interactive Solana Action card in chat.
 *
 * Detects Action URLs, fetches metadata via GET, displays an interactive
 * card with icon + title + buttons. On tap, POSTs to get a transaction,
 * then signs via MWA.
 *
 * No react-native-svg dependency — pure View-based UI.
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import {
  VersionedTransaction,
  TransactionMessage,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  transact,
  type Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { THEME, FONTS, HELIUS_RPC_URL } from "@/lib/constants";

const connection = new Connection(HELIUS_RPC_URL, "confirmed");
import { useAppStore } from "@/store/appStore";
import {
  fetchActionMetadata,
  executeAction,
  resolveActionHref,
  type ActionMetadata,
  type ActionLink,
} from "@/lib/blinkActions";

const OM_BLUE = "#0096C7";
const OM_BLUE_DIM = "rgba(0, 150, 199, 0.12)";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.app",
  icon: "favicon.ico",
};

type BlinkState = "loading" | "ready" | "signing" | "confirmed" | "failed";

interface BlinkCardProps {
  actionUrl: string;
}

export function BlinkCard({ actionUrl }: BlinkCardProps) {
  const [state, setState] = useState<BlinkState>("loading");
  const [metadata, setMetadata] = useState<ActionMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // Fetch action metadata on mount
  useEffect(() => {
    let mounted = true;
    fetchActionMetadata(actionUrl).then((data) => {
      if (!mounted) return;
      if (data) {
        setMetadata(data);
        setState("ready");
      } else {
        setState("failed");
        setError("Could not load action");
      }
    });
    return () => { mounted = false; };
  }, [actionUrl]);

  const handleAction = useCallback(
    async (link: ActionLink) => {
      const wallet = useAppStore.getState().wallet;
      if (!wallet) {
        Alert.alert("Wallet Required", "Connect your wallet first.");
        return;
      }

      // Check for unfilled required parameters
      if (link.parameters?.some((p) => p.required && !paramValues[p.name])) {
        Alert.alert("Missing Input", "Fill in all required fields.");
        return;
      }

      setState("signing");
      setError(null);

      try {
        // Resolve parametric href
        const href = resolveActionHref(link.href, actionUrl, paramValues);

        // POST to get the transaction
        const response = await executeAction(href, wallet.address);

        // Deserialize
        const txBytes = Uint8Array.from(
          atob(response.transaction)
            .split("")
            .map((c) => c.charCodeAt(0)),
        );
        const tx = VersionedTransaction.deserialize(txBytes);

        // Validate fee payer matches user wallet
        const feePayer = tx.message.staticAccountKeys[0];
        if (feePayer && feePayer.toBase58() !== wallet.address) {
          throw new Error("Transaction fee payer does not match your wallet");
        }

        // Fetch fresh blockhash — the worker-built tx may have a stale one
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        // Decompile, replace blockhash, recompile
        const lookupTableAccounts = await Promise.all(
          tx.message.addressTableLookups.map(async (lookup) => {
            const res = await connection.getAddressLookupTable(lookup.accountKey);
            return res.value;
          }),
        );
        const validLuts = lookupTableAccounts.filter(
          (a): a is NonNullable<typeof a> => a !== null,
        );
        const decompiled = TransactionMessage.decompile(tx.message, {
          addressLookupTableAccounts: validLuts,
        });
        decompiled.recentBlockhash = blockhash;
        const freshMessage = decompiled.compileToV0Message(validLuts);
        const freshTx = new VersionedTransaction(freshMessage);

        // Sign via MWA — pass VersionedTransaction object (not serialized bytes)
        const minContextSlot = await connection.getSlot();
        const sig = await transact(async (mobileWallet: Web3MobileWallet) => {
          const cachedToken = useAppStore.getState().mwaAuthToken;
          let authResult;
          if (cachedToken && typeof cachedToken === "string") {
            try {
              authResult = await mobileWallet.authorize({
                cluster: "mainnet-beta",
                identity: APP_IDENTITY,
                auth_token: cachedToken,
              } as Parameters<typeof mobileWallet.authorize>[0]);
            } catch {
              authResult = await mobileWallet.authorize({
                cluster: "mainnet-beta",
                identity: APP_IDENTITY,
              });
            }
          } else {
            authResult = await mobileWallet.authorize({
              cluster: "mainnet-beta",
              identity: APP_IDENTITY,
            });
          }
          if (authResult.auth_token) {
            useAppStore.getState().setMwaAuthToken(authResult.auth_token);
          }

          const result = await mobileWallet.signAndSendTransactions({
            transactions: [freshTx as any],
            minContextSlot,
          });
          return result[0];
        });

        const sigStr =
          typeof sig === "string"
            ? sig
            : Buffer.from(sig).toString("base64");

        setTxSig(sigStr);
        setState("confirmed");
      } catch (err) {
        setError((err as Error).message);
        setState("failed");
      }
    },
    [actionUrl, paramValues],
  );

  // ── Loading state ──────────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={OM_BLUE} />
      </View>
    );
  }

  if (!metadata || !metadata.title) return null;

  const actions = metadata.links?.actions ?? [];
  const isCompleted = metadata.type === "completed" || state === "confirmed";

  return (
    <View style={styles.card}>
      {/* Icon */}
      {metadata.icon && (
        <ExpoImage
          source={{ uri: metadata.icon }}
          style={styles.icon}
          contentFit="cover"
          transition={200}
        />
      )}

      <View style={styles.body}>
        {/* Title */}
        <Text style={styles.title} numberOfLines={2}>
          {metadata.title}
        </Text>

        {/* Description */}
        {metadata.description && (
          <Text style={styles.description} numberOfLines={3}>
            {metadata.description}
          </Text>
        )}

        {/* Parameter inputs (for parametric actions) */}
        {state === "ready" &&
          actions.length > 0 &&
          actions[0].parameters?.map((param) => (
            <TextInput
              key={param.name}
              style={styles.paramInput}
              placeholder={param.label ?? param.name}
              placeholderTextColor={THEME.textFaint}
              keyboardType={param.type === "number" ? "numeric" : "default"}
              value={paramValues[param.name] ?? ""}
              onChangeText={(text) =>
                setParamValues((prev) => ({ ...prev, [param.name]: text }))
              }
            />
          ))}

        {/* Action buttons */}
        {state === "ready" && !metadata.disabled && (
          <View style={styles.buttonRow}>
            {actions.length > 0 ? (
              actions.slice(0, 3).map((link, i) => (
                <Pressable
                  key={i}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={() => handleAction(link)}
                >
                  <Text style={styles.actionBtnText}>{link.label}</Text>
                </Pressable>
              ))
            ) : (
              <Pressable
                style={styles.actionBtn}
                onPress={() =>
                  handleAction({
                    label: metadata.label,
                    href: actionUrl,
                  })
                }
              >
                <Text style={styles.actionBtnText}>{metadata.label}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Signing spinner */}
        {state === "signing" && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={OM_BLUE} />
            <Text style={styles.statusText}>Signing transaction…</Text>
          </View>
        )}

        {/* Confirmed */}
        {isCompleted && (
          <View style={styles.statusRow}>
            <Text style={styles.confirmedText}>
              {"\u2713"} Transaction sent
            </Text>
          </View>
        )}

        {/* Error */}
        {state === "failed" && error && (
          <View style={styles.statusRow}>
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
            <Pressable
              style={styles.retryBtn}
              onPress={() => setState("ready")}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Blink badge */}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>ACTION</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: THEME.surfaceHigh,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: THEME.border,
    maxWidth: 280,
  },
  icon: {
    width: "100%",
    height: 140,
  },
  body: {
    padding: 10,
    gap: 6,
  },
  title: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.text,
  },
  description: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    lineHeight: 16,
  },
  paramInput: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.text,
    backgroundColor: THEME.surface,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    minWidth: 70,
    backgroundColor: OM_BLUE,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
    color: "#fff",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  statusText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
  },
  confirmedText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
    color: "#10B981",
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: "#EF4444",
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: OM_BLUE_DIM,
  },
  retryBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 11,
    color: OM_BLUE,
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: OM_BLUE,
    letterSpacing: 1,
  },
});
