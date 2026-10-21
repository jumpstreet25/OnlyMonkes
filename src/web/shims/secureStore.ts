/**
 * Web stand-in for expo-secure-store. Values are AES-256-GCM encrypted in
 * IndexedDB under a non-extractable WebCrypto key that also lives in
 * IndexedDB, so the raw key can't be read out or copied off the disk — but
 * any script running on this origin can still use it to decrypt. That makes
 * the Content-Security-Policy on the deployed site part of this
 * protection. Holds the same things the phone keeps in SecureStore (session,
 * XMTP identity/db keys) — never a Solana wallet key; wallets sign in their
 * own extension.
 */

const DB = "om-secure-store";
const STORE = "kv";
const KEY_ID = "__om_aes_key";

let _db: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  _db.catch(() => { _db = null; });
  return _db;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const r = run(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

let _key: Promise<CryptoKey> | null = null;
function aesKey(): Promise<CryptoKey> {
  if (_key) return _key;
  _key = (async () => {
    const existing = await tx<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID));
    if (existing) return existing;
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await tx("readwrite", (s) => s.put(k, KEY_ID));
    return k;
  })();
  _key.catch(() => { _key = null; });
  return _key;
}

function check(key: string): void {
  if (!key || key === KEY_ID || !/^[\w.-]+$/.test(key)) throw new Error(`Invalid SecureStore key: ${key}`);
}

export async function setItemAsync(key: string, value: string, _opts?: unknown): Promise<void> {
  check(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(value));
  await tx("readwrite", (s) => s.put({ iv, data }, key));
}

export async function getItemAsync(key: string, _opts?: unknown): Promise<string | null> {
  check(key);
  const rec = await tx<{ iv: Uint8Array; data: ArrayBuffer } | undefined>("readonly", (s) => s.get(key));
  if (!rec) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv }, await aesKey(), rec.data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function deleteItemAsync(key: string, _opts?: unknown): Promise<void> {
  check(key);
  await tx("readwrite", (s) => s.delete(key));
}

export function getItem(): string | null { return null; }
export function setItem(): void { throw new Error("SecureStore sync API is not available on web"); }
export async function isAvailableAsync(): Promise<boolean> { return typeof indexedDB !== "undefined"; }
export function canUseBiometricAuthentication(): boolean { return false; }

export const AFTER_FIRST_UNLOCK = 0;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;
export const ALWAYS = 2;
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 3;
export const ALWAYS_THIS_DEVICE_ONLY = 4;
export const WHEN_UNLOCKED = 5;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;
