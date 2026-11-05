import { generateKeyPairSync, sign, webcrypto } from "crypto";

jest.mock("../src/index", () => ({ fetchOwnedMonke: jest.fn() }));
jest.mock("../src/genesisVerify", () => ({ verifyGenesisTokenOwnership: jest.fn() }));

import {
  buildDevicesMessage, cleanDeviceLabel, deviceVerdict, handleDeviceIntegrityDevices, type DeviceIntegrityVerdict,
} from "../src/deviceIntegrity";
import { devicesMessage } from "@/lib/myDevices";

if (!globalThis.crypto?.subtle) (globalThis as any).crypto = webcrypto;

const WALLET = "7tLrUKmkcBRVmwXtiRo8cTj6Mw2TGhFxyeNmKaU9mqZx";
const DAY = 24 * 3600 * 1000;

function kv() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v); },
    delete: async (k: string) => { m.delete(k); },
  };
}

function phone() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return {
    pub: spki.toString("base64"),
    hash: require("crypto").createHash("sha256").update(spki).digest("hex") as string,
    sign: (msg: string) => sign("sha256", Buffer.from(msg), { key: privateKey, dsaEncoding: "der" }).toString("base64"),
  };
}

function verdict(hash: string, issuedAt: number, over: Partial<DeviceIntegrityVerdict> = {}): DeviceIntegrityVerdict {
  return { securityLevel: "tee", hardwareVerified: true, raspClean: true, holderTier: "sagaMonke", deviceHash: hash, issuedAt, expiresAt: issuedAt + 7 * DAY, ...over };
}

async function call(env: any, p: ReturnType<typeof phone>, action: string, target = "-") {
  const nonce = Math.random().toString(16).slice(2);
  env.DEVICE_INTEGRITY.m.set(`nonce:${nonce}`, "1");
  const body = { action, walletAddress: WALLET, devicePubKeyBase64: p.pub, nonce, deviceSigBase64: p.sign(buildDevicesMessage(action, WALLET, target, nonce)), target };
  const res = await handleDeviceIntegrityDevices(new Request("https://x/api/device-integrity/devices", { method: "POST", body: JSON.stringify(body) }), env);
  return { status: res.status, data: (await res.json()) as any };
}

describe("Your devices: one account per wallet, up to 5 phones", () => {
  const now = Date.now();
  let env: any;
  let saga: ReturnType<typeof phone>;
  let seeker: ReturnType<typeof phone>;

  beforeEach(() => {
    env = { DEVICE_INTEGRITY: kv(), SENTIMENT_ORACLE: kv() };
    saga = phone();
    seeker = phone();
    env.DEVICE_INTEGRITY.m.set(`devices:${WALLET}`, JSON.stringify([
      verdict(saga.hash, now - 2 * DAY, { label: "Saga" }),
      verdict(seeker.hash, now - DAY, { label: "Seeker" }),
    ]));
    env.DEVICE_INTEGRITY.m.set(`bind:${saga.hash}`, WALLET);
    env.SENTIMENT_ORACLE.m.set(`device:${saga.hash}`, JSON.stringify({ walletAddress: WALLET }));
  });

  it("keeps both phones verified (the second no longer pushes the first off)", async () => {
    expect(await deviceVerdict(env, WALLET, saga.hash)).not.toBeNull();
    expect(await deviceVerdict(env, WALLET, seeker.hash)).not.toBeNull();
    expect(await deviceVerdict(env, WALLET, phone().hash)).toBeNull();
  });

  it("still honours a verdict saved before the per-wallet list existed", async () => {
    env.DEVICE_INTEGRITY.m.delete(`devices:${WALLET}`);
    env.DEVICE_INTEGRITY.m.set(`wallet:${WALLET}`, JSON.stringify(verdict(saga.hash, now)));
    expect(await deviceVerdict(env, WALLET, saga.hash)).not.toBeNull();
  });

  it("drops expired phones", async () => {
    env.DEVICE_INTEGRITY.m.set(`devices:${WALLET}`, JSON.stringify([verdict(saga.hash, now - 8 * DAY)]));
    expect(await deviceVerdict(env, WALLET, saga.hash)).toBeNull();
  });

  it("lists the wallet's phones for a verified phone, newest first", async () => {
    const r = await call(env, saga, "list");
    expect(r.status).toBe(200);
    expect(r.data.max).toBe(5);
    expect(r.data.devices.map((d: any) => [d.label, d.isThisDevice])).toEqual([["Seeker", false], ["Saga", true]]);
    expect(JSON.stringify(r.data)).not.toContain(saga.hash);
  });

  it("refuses a phone that isn't verified on the wallet", async () => {
    expect((await call(env, phone(), "list")).status).toBe(403);
  });

  it("refuses a bad signature and a reused nonce", async () => {
    const nonce = "abc";
    env.DEVICE_INTEGRITY.m.set(`nonce:${nonce}`, "1");
    const body = { action: "list", walletAddress: WALLET, devicePubKeyBase64: saga.pub, nonce, deviceSigBase64: seeker.sign(buildDevicesMessage("list", WALLET, "-", nonce)) };
    const req = () => new Request("https://x", { method: "POST", body: JSON.stringify(body) });
    expect((await handleDeviceIntegrityDevices(req(), env)).status).toBe(401);
    expect((await handleDeviceIntegrityDevices(req(), env)).status).toBe(401);
  });

  it("removes another phone: its verdict, binding and sentiment registration go", async () => {
    const r = await call(env, seeker, "remove", saga.hash.slice(0, 16));
    expect(r.status).toBe(200);
    expect(r.data.devices.map((d: any) => d.label)).toEqual(["Seeker"]);
    expect(await deviceVerdict(env, WALLET, saga.hash)).toBeNull();
    expect(env.DEVICE_INTEGRITY.m.has(`bind:${saga.hash}`)).toBe(false);
    expect(env.SENTIMENT_ORACLE.m.has(`device:${saga.hash}`)).toBe(false);
    expect(JSON.parse(env.DEVICE_INTEGRITY.m.get(`wallet:${WALLET}`)).deviceHash).toBe(seeker.hash);
  });

  it("removing the last phone clears the wallet", async () => {
    env.DEVICE_INTEGRITY.m.set(`devices:${WALLET}`, JSON.stringify([verdict(saga.hash, now)]));
    const r = await call(env, saga, "remove", saga.hash.slice(0, 16));
    expect(r.data.devices).toEqual([]);
    expect(env.DEVICE_INTEGRITY.m.has(`wallet:${WALLET}`)).toBe(false);
  });

  it("app and worker sign the same message", () => {
    expect(devicesMessage("remove", WALLET, "0123456789abcdef", "n1")).toBe(buildDevicesMessage("remove", WALLET, "0123456789abcdef", "n1"));
  });

  it("keeps device labels plain", () => {
    expect(cleanDeviceLabel("Seeker")).toBe("Seeker");
    expect(cleanDeviceLabel("<script>alert(1)</script>")).toBe("scriptalert(1)script");
    expect(cleanDeviceLabel("x".repeat(80))).toHaveLength(40);
    expect(cleanDeviceLabel(5)).toBeUndefined();
  });
});
