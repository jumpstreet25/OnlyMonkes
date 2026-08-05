/**
 * walletBridge.ts — JS-injected Wallet Standard provider that bridges in-app
 * dApps loaded via WebViewModal to OnlyMonkes' MWA flow.
 *
 * How it works:
 *   1. `buildWalletBridgeJs(publicKey)` returns a JS string injected via
 *      WebView's `injectedJavaScriptBeforeContentLoaded` prop. The script:
 *      - Defines a Wallet Standard wallet object named "OnlyMonkes Wallet"
 *      - Registers it via `wallet-standard:register-wallet` event +
 *        re-registers on `wallet-standard:app-ready`
 *      - Also exposes window.solflare + window.phantom.solana shims for
 *        older Solana wallet-adapter versions that pre-date the Standard
 *      - Forwards sign requests to RN via `window.ReactNativeWebView.postMessage`
 *
 *   2. WebView's `onMessage` calls `handleBridgeMessage(message, webViewRef)`,
 *      which decodes the request, runs MWA `transact()` (Solflare/Seeker
 *      biometric prompt), and posts the result back via `webViewRef.injectJavaScript`.
 *
 * Security: only inject for hosts in WALLET_BRIDGE_HOSTS allowlist. The bridge
 * lets ANY JS in the loaded page invoke MWA — same trust model as injecting
 * Phantom inside any dApp, but limited to first-party Saga Monkes hosts.
 */

import type { WebView } from "react-native-webview";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { useAppStore } from "@/store/appStore";
import { assertDeviceTrusted } from "@/lib/security";

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://github.com/jumpstreet25/OnlyMonkes",
  icon: "favicon.ico",
};

// 1×1 transparent PNG → keeps the wallet icon valid without bundling assets.
// dApps render this; OK to swap for a branded icon later.
const WALLET_ICON_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

/** Request types sent over the bridge. */
type BridgeRequestType =
  | "signTransaction"
  | "signAndSendTransaction"
  | "signMessage";

interface BridgeMessage {
  type: BridgeRequestType;
  id: number;
  payload: { txB64?: string; msgB64?: string };
}

/**
 * Build the JS string injected into the WebView before the dApp's JS loads.
 *
 * @param publicKey  Base58-encoded Solana address — embedded into the bridge
 *                   so `connect()` resolves without an extra MWA round-trip.
 */
export function buildWalletBridgeJs(publicKey: string): string {
  return `
(function() {
  if (window.__OM_WALLET_BRIDGE__) return;
  window.__OM_WALLET_BRIDGE__ = true;

  const PUBLIC_KEY_B58 = ${JSON.stringify(publicKey)};
  const WALLET_NAME = 'OnlyMonkes Wallet';
  const WALLET_ICON = ${JSON.stringify(WALLET_ICON_DATA_URI)};

  const _pending = new Map();
  let _reqId = 0;

  function _send(type, payload) {
    return new Promise(function(resolve, reject) {
      const id = ++_reqId;
      _pending.set(id, { resolve: resolve, reject: reject });
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, id: id, payload: payload }));
      } catch (e) {
        _pending.delete(id);
        reject(e);
      }
    });
  }

  // RN posts responses as window 'message' events with payload prefixed
  // 'om-bridge:'. Listen on document AND window for cross-platform safety.
  function _onMessage(ev) {
    var raw = ev && ev.data;
    if (typeof raw !== 'string' || raw.indexOf('om-bridge:') !== 0) return;
    try {
      var data = JSON.parse(raw.substring('om-bridge:'.length));
      var p = _pending.get(data.id);
      if (!p) return;
      _pending.delete(data.id);
      if (data.ok) p.resolve(data.value);
      else p.reject(new Error(data.error || 'Bridge error'));
    } catch (e) {}
  }
  window.addEventListener('message', _onMessage);
  document.addEventListener('message', _onMessage);

  // ─── Base58 decode (avoid bundling bs58 inside injected JS) ───────────────
  function b58decode(str) {
    var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    var MAP = {};
    for (var i = 0; i < ALPHABET.length; i++) MAP[ALPHABET[i]] = i;
    var bytes = [0];
    for (var j = 0; j < str.length; j++) {
      var v = MAP[str[j]];
      if (v === undefined) throw new Error('Bad base58');
      for (var k = 0; k < bytes.length; k++) bytes[k] *= 58;
      bytes[0] += v;
      var carry = 0;
      for (var k2 = 0; k2 < bytes.length; k2++) {
        bytes[k2] += carry;
        carry = bytes[k2] >> 8;
        bytes[k2] &= 0xff;
      }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (var l = 0; str[l] === '1' && l < str.length - 1; l++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  // ─── Base64 helpers (Uint8Array <-> base64 string) ────────────────────────
  function bytesToB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var s = atob(b64);
    var arr = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
    return arr;
  }

  var PUBLIC_KEY_BYTES = b58decode(PUBLIC_KEY_B58);

  // ─── Wallet Standard account ──────────────────────────────────────────────
  var account = {
    address: PUBLIC_KEY_B58,
    publicKey: PUBLIC_KEY_BYTES,
    chains: ['solana:mainnet', 'solana:devnet'],
    features: [
      'solana:signTransaction',
      'solana:signAndSendTransaction',
      'solana:signMessage',
    ],
    label: undefined,
    icon: undefined,
  };

  // ─── Wallet Standard wallet object ────────────────────────────────────────
  var wallet = {
    version: '1.0.0',
    name: WALLET_NAME,
    icon: WALLET_ICON,
    chains: ['solana:mainnet', 'solana:devnet'],
    accounts: [account],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: function() { return Promise.resolve({ accounts: [account] }); },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: function() { return Promise.resolve(); },
      },
      'standard:events': {
        version: '1.0.0',
        on: function() { return function() {}; },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: function() {
          var inputs = Array.prototype.slice.call(arguments);
          return Promise.all(inputs.map(function(input) {
            return _send('signTransaction', { txB64: bytesToB64(input.transaction) })
              .then(function(signedB64) {
                return { signedTransaction: b64ToBytes(signedB64) };
              });
          }));
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        chains: ['solana:mainnet', 'solana:devnet'],
        signAndSendTransaction: function() {
          var inputs = Array.prototype.slice.call(arguments);
          return Promise.all(inputs.map(function(input) {
            return _send('signAndSendTransaction', { txB64: bytesToB64(input.transaction) })
              .then(function(sigB64) {
                return { signature: b64ToBytes(sigB64) };
              });
          }));
        },
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: function() {
          var inputs = Array.prototype.slice.call(arguments);
          return Promise.all(inputs.map(function(input) {
            return _send('signMessage', { msgB64: bytesToB64(input.message) })
              .then(function(sigB64) {
                return { signedMessage: input.message, signature: b64ToBytes(sigB64) };
              });
          }));
        },
      },
    },
  };

  // ─── Wallet Standard registration ─────────────────────────────────────────
  try {
    window.addEventListener('wallet-standard:app-ready', function(ev) {
      try { ev.detail.register(wallet); } catch (e) {}
    });
  } catch (e) {}

  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
      detail: function(api) { return api.register(wallet); },
    }));
  } catch (e) {}

  // ─── Phantom/Solflare-style window provider shim (older adapters) ────────
  function makeShim(name) {
    return {
      isPhantom: name === 'phantom',
      isSolflare: name === 'solflare',
      isOnlyMonkes: true,
      publicKey: {
        toBase58: function() { return PUBLIC_KEY_B58; },
        toBytes: function() { return PUBLIC_KEY_BYTES; },
        toString: function() { return PUBLIC_KEY_B58; },
      },
      connect: function() {
        return Promise.resolve({
          publicKey: {
            toBase58: function() { return PUBLIC_KEY_B58; },
            toBytes: function() { return PUBLIC_KEY_BYTES; },
            toString: function() { return PUBLIC_KEY_B58; },
          },
        });
      },
      disconnect: function() { return Promise.resolve(); },
      signTransaction: function(tx) {
        var bytes = tx && tx.serialize
          ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
          : tx;
        return _send('signTransaction', { txB64: bytesToB64(bytes) }).then(function(b64) {
          if (tx && tx.constructor && typeof tx.constructor.from === 'function') {
            try { return tx.constructor.from(b64ToBytes(b64)); } catch (e) {}
          }
          return { signedBytes: b64ToBytes(b64) };
        });
      },
      signAllTransactions: function(txs) {
        return Promise.all(txs.map(function(t) { return makeShim(name).signTransaction(t); }));
      },
      signMessage: function(msg) {
        return _send('signMessage', { msgB64: bytesToB64(msg) }).then(function(sigB64) {
          return { signature: b64ToBytes(sigB64) };
        });
      },
      signAndSendTransaction: function(tx) {
        var bytes = tx && tx.serialize
          ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
          : tx;
        return _send('signAndSendTransaction', { txB64: bytesToB64(bytes) }).then(function(sigB64) {
          return { signature: PUBLIC_KEY_B58 in {} ? sigB64 : sigB64 };
        });
      },
      on: function() { return; },
      off: function() { return; },
      removeListener: function() { return; },
    };
  }

  try {
    window.solflare = makeShim('solflare');
  } catch (e) {}
  try {
    window.phantom = window.phantom || {};
    window.phantom.solana = makeShim('phantom');
  } catch (e) {}

  // Signal to dApps that may poll for window.solana
  try {
    Object.defineProperty(window, 'solana', {
      value: makeShim('solana'),
      writable: false,
      configurable: true,
    });
  } catch (e) {}
})();
true;
`;
}

// ─── RN-side message router ───────────────────────────────────────────────────

interface WebViewLike {
  injectJavaScript: (js: string) => void;
}

/**
 * Decode a postMessage from the bridge, run MWA, post the response back.
 *
 * @param raw          The raw event.nativeEvent.data string from WebView onMessage
 * @param webViewRef   Ref to the WebView so we can inject the response JS
 */
export async function handleBridgeMessage(
  raw: string,
  webViewRef: React.RefObject<WebViewLike | null>,
): Promise<void> {
  let parsed: BridgeMessage | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed.id !== "number" || !parsed.type) return;

  const { type, id, payload } = parsed;
  let response: { ok: boolean; value?: string; error?: string };

  try {
    switch (type) {
      case "signTransaction": {
        if (!payload?.txB64) throw new Error("missing tx");
        const signed = await mwaSignTransaction(payload.txB64);
        response = { ok: true, value: signed };
        break;
      }
      case "signAndSendTransaction": {
        if (!payload?.txB64) throw new Error("missing tx");
        const sig = await mwaSignAndSend(payload.txB64);
        response = { ok: true, value: sig };
        break;
      }
      case "signMessage": {
        if (!payload?.msgB64) throw new Error("missing msg");
        const sig = await mwaSignMessage(payload.msgB64);
        response = { ok: true, value: sig };
        break;
      }
      default:
        response = { ok: false, error: `Unknown bridge type: ${type}` };
    }
  } catch (err: any) {
    response = { ok: false, error: err?.message ?? "Bridge call failed" };
  }

  const reply = JSON.stringify({ id, ...response });
  // We post 'om-bridge:<json>' so our injected listener can identify it
  // without colliding with other postMessage traffic.
  const js = `
    (function() {
      var msg = ${JSON.stringify("om-bridge:" + reply)};
      try { window.dispatchEvent(new MessageEvent('message', { data: msg })); } catch (e) {}
      try { document.dispatchEvent(new MessageEvent('message', { data: msg })); } catch (e) {}
    })();
    true;
  `;
  webViewRef.current?.injectJavaScript(js);
}

// ─── MWA wrappers ─────────────────────────────────────────────────────────────

async function mwaAuthorize(mobileWallet: Web3MobileWallet) {
  const cached = useAppStore.getState().mwaAuthToken;
  let result;
  if (cached) {
    try {
      result = await mobileWallet.authorize({
        cluster: "mainnet-beta",
        identity: APP_IDENTITY,
        auth_token: cached,
      } as Parameters<typeof mobileWallet.authorize>[0]);
    } catch {
      result = await mobileWallet.authorize({ cluster: "mainnet-beta", identity: APP_IDENTITY });
    }
  } else {
    result = await mobileWallet.authorize({ cluster: "mainnet-beta", identity: APP_IDENTITY });
  }
  useAppStore.getState().setMwaAuthToken(result.auth_token);
  return result;
}

function decodeTxBytes(txB64: string): Transaction | VersionedTransaction {
  const bytes = Uint8Array.from(Buffer.from(txB64, "base64"));
  // Try VersionedTransaction first (covers both versioned + legacy in v0+ clients);
  // fall back to legacy Transaction.
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

async function mwaSignTransaction(txB64: string): Promise<string> {
  assertDeviceTrusted("dApp transaction sign");
  const tx = decodeTxBytes(txB64);
  return await transact(async (mobileWallet) => {
    await mwaAuthorize(mobileWallet);
    const [signedTx] = await mobileWallet.signTransactions({
      transactions: [tx as Transaction | VersionedTransaction],
    });
    // The web3js adapter returns deserialized Transaction|VersionedTransaction.
    // Re-serialize to bytes (skip signature verification — the wallet just signed).
    const serialized = (signedTx as Transaction | VersionedTransaction).serialize(
      // VersionedTransaction.serialize takes no opts; Transaction.serialize accepts opts.
      // Cast to any to satisfy both overloads.
      { requireAllSignatures: false, verifySignatures: false } as any,
    );
    return Buffer.from(serialized).toString("base64");
  });
}

async function mwaSignAndSend(txB64: string): Promise<string> {
  assertDeviceTrusted("dApp transaction");
  const tx = decodeTxBytes(txB64);
  const sig = await transact(async (mobileWallet) => {
    await mwaAuthorize(mobileWallet);
    const [signature] = await mobileWallet.signAndSendTransactions({
      transactions: [tx as Transaction | VersionedTransaction],
    });
    return signature;
  });
  // signature is Uint8Array per the web3js adapter contract.
  return Buffer.from(sig).toString("base64");
}

async function mwaSignMessage(msgB64: string): Promise<string> {
  assertDeviceTrusted("dApp message sign");
  const msgBytes = Uint8Array.from(Buffer.from(msgB64, "base64"));
  return await transact(async (mobileWallet) => {
    const auth = await mwaAuthorize(mobileWallet);
    const result = await mobileWallet.signMessages({
      addresses: [auth.accounts[0].address],
      payloads: [msgBytes],
    });
    // Returns Uint8Array[] of signature bytes
    return Buffer.from(result[0]).toString("base64");
  });
}
