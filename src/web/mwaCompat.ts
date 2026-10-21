/**
 * Web stand-in for `@solana-mobile/mobile-wallet-adapter-protocol-web3js`
 * (metro.config.js aliases it on web only). Same `transact(cb)` shape and the
 * same return formats as the web3js MWA wrapper — base64 account addresses,
 * signed message payloads (message + signature), base58 send signatures,
 * web3js transaction objects back from signTransactions — backed by the
 * Wallet Standard wallet the user picked (see src/web/walletStandard.ts).
 */

import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { SOLANA_RPC_URL } from "@/lib/constants";
import {
  connectWallet,
  getSelectedWallet,
  signAndSendTransactionBytes,
  signMessageMwaFormat,
  signTransactionBytes,
} from "./walletStandard";

type AnyTx = Transaction | VersionedTransaction;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function serialize(tx: AnyTx): Uint8Array {
  return tx instanceof VersionedTransaction
    ? tx.serialize()
    : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}

function deserializeLike(original: AnyTx, bytes: Uint8Array): AnyTx {
  return original instanceof VersionedTransaction ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
}

/** MWA passes addresses as base64 public keys; Wallet Standard uses base58. */
function pickAccount(wallet: Wallet, accounts: readonly WalletAccount[], mwaAddress?: string): WalletAccount {
  const list = accounts.length ? accounts : wallet.accounts;
  if (!list.length) throw new Error(`${wallet.name} has no account connected.`);
  if (!mwaAddress) return list[0];
  let base58 = mwaAddress;
  try { base58 = bs58.encode(fromBase64(mwaAddress)); } catch { /* already base58 */ }
  return list.find((a) => a.address === base58 || a.address === mwaAddress) ?? list[0];
}

let _connection: Connection | null = null;
function connection(): Connection {
  if (!_connection) _connection = new Connection(SOLANA_RPC_URL, "confirmed");
  return _connection;
}

export type Web3MobileWallet = ReturnType<typeof makeSession>;

function makeSession(wallet: Wallet) {
  let accounts: readonly WalletAccount[] = wallet.accounts;

  const authResult = () => ({
    auth_token: `wallet-standard:${wallet.name}`,
    accounts: accounts.map((a) => ({
      address: toBase64(new Uint8Array(a.publicKey)),
      label: a.label ?? wallet.name,
      chains: a.chains,
      features: a.features,
    })),
    wallet_uri_base: undefined as string | undefined,
  });

  return {
    async authorize(params?: { auth_token?: string }) {
      accounts = await connectWallet(wallet, !!params?.auth_token);
      return authResult();
    },
    async reauthorize(_params?: { auth_token?: string }) {
      accounts = await connectWallet(wallet, true);
      return authResult();
    },
    async deauthorize(_params?: unknown) {
      await (wallet.features as any)["standard:disconnect"]?.disconnect?.();
    },
    async getCapabilities() {
      const f = wallet.features as Record<string, unknown>;
      return {
        supports_clone_authorization: false,
        supports_sign_and_send_transactions: !!f["solana:signAndSendTransaction"],
        max_transactions_per_request: 10,
        max_messages_per_request: 10,
        supported_transaction_versions: ["legacy", 0],
        features: Object.keys(f),
      };
    },
    async signMessages({ addresses, payloads }: { addresses: string[]; payloads: Uint8Array[] }): Promise<Uint8Array[]> {
      const out: Uint8Array[] = [];
      for (let i = 0; i < payloads.length; i++) {
        const account = pickAccount(wallet, accounts, addresses[i] ?? addresses[0]);
        out.push(await signMessageMwaFormat(wallet, account, payloads[i]));
      }
      return out;
    },
    async signTransactions<T extends AnyTx>({ transactions }: { transactions: T[] }): Promise<T[]> {
      const account = pickAccount(wallet, accounts);
      const out: T[] = [];
      for (const tx of transactions) {
        const signed = await signTransactionBytes(wallet, account, serialize(tx));
        out.push(deserializeLike(tx, signed) as T);
      }
      return out;
    },
    async signAndSendTransactions({
      transactions,
      minContextSlot,
      commitment,
      skipPreflight,
      maxRetries,
    }: {
      transactions: AnyTx[];
      minContextSlot?: number;
      commitment?: string;
      skipPreflight?: boolean;
      maxRetries?: number;
    }): Promise<string[]> {
      const account = pickAccount(wallet, accounts);
      const sigs: string[] = [];
      for (const tx of transactions) {
        const bytes = serialize(tx);
        const sent = await signAndSendTransactionBytes(wallet, account, bytes, { minContextSlot, commitment, skipPreflight, maxRetries });
        if (sent) {
          sigs.push(bs58.encode(sent));
          continue;
        }
        const signed = await signTransactionBytes(wallet, account, bytes);
        sigs.push(await connection().sendRawTransaction(signed, { skipPreflight, maxRetries, minContextSlot }));
      }
      return sigs;
    },
  };
}

export async function transact<T>(callback: (wallet: Web3MobileWallet) => Promise<T>, _config?: unknown): Promise<T> {
  const wallet = await getSelectedWallet();
  return callback(makeSession(wallet));
}

export async function startRemoteScenario(): Promise<never> {
  throw new Error("Remote MWA sessions are not supported on web");
}
