// OnlyMonkes STAGING helper — runs next to the self-hosted XMTP backend on
// the VPS (docker compose service `staging-helper`). Never production.
//
// 1. Creates the staging Main / Trades / Genesis groups once (it is their
//    super admin) and writes their IDs to /data/app-config.json, which the
//    web build serves as /staging/app-config.json.
// 2. Admits holders: a DM `JOIN_REQUEST:<wallet>|t=<token>` or
//    `GENESIS_JOIN_REQUEST:<wallet>|t=<token>`, where <token> is the access
//    token the actions worker signs after a wallet sign-in + holder check
//    (worker-actions/src/webAuth.ts). The XMTP sender inbox is the one added;
//    the token proves that wallet holds a Monke (tier "monke" → Main + Trades)
//    or a Genesis Token (tier "genesis" → Genesis only), mirroring production.
import { Client, LocalSigningKey } from "@xmtp/node-sdk";
import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = process.env.DATA_DIR || "/data";
const BACKEND = process.env.XMTP_BACKEND_URL || "http://backend:5050";
const API_KEY = process.env.XMTP_HELPER_API_KEY || "";
const ISSUER = "https://onlymonkes-actions.jumpstreet25.workers.dev";
const NAME = "Staging Helper";
const JWT_PUB = createPublicKey(readFileSync(process.env.JWT_PUBLIC_KEY_FILE || "/app/jwt-public.pem"));

const GROUPS = {
  main: "OnlyMonkes Global Chat (staging)",
  trades: "MonkeAlerts Trades (staging)",
  genesis: "MonkeAI Genesis (staging)",
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const short = (s) => (typeof s === "string" ? `${s.slice(0, 6)}…` : "?");

if (API_KEY.length < 32) throw new Error("XMTP_HELPER_API_KEY missing");
mkdirSync(join(DATA, "xmtp"), { recursive: true });

async function signer() {
  const path = join(DATA, "key.hex");
  if (existsSync(path)) return LocalSigningKey.fromHex(readFileSync(path, "utf8").trim());
  const key = await Client.generateKeys();
  writeFileSync(path, await key.toHex(), { mode: 0o600 });
  return key;
}

function options() {
  return {
    backend: {
      url: BACKEND,
      appVersion: "onlymonkes-staging-helper/1",
      credentials: {
        credential: async () => ({ value: `Bearer ${API_KEY}`, expiresAtSeconds: BigInt(Math.floor(Date.now() / 1000) + 3600) }),
      },
    },
    storage: { location: { directory: join(DATA, "xmtp") } },
  };
}

async function openClient() {
  const key = await signer();
  try {
    return await Client.build(await key.identity(), options());
  } catch {
    return Client.create(key, options());
  }
}

async function ensureGroups(client) {
  const path = join(DATA, "groups.json");
  const ids = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  for (const [key, name] of Object.entries(GROUPS)) {
    if (ids[key] && (await client.conversations.getById(ids[key]))) continue;
    const g = await client.conversations.createGroup([], { name, permissions: { kind: "adminOnly" } });
    ids[key] = g.id;
    log(`created ${key} group ${g.id}`);
  }
  writeFileSync(path, JSON.stringify(ids, null, 2));
  writeFileSync(join(DATA, "app-config.json"), JSON.stringify({
    globalGroupId: ids.main,
    // The app only sends join requests when an admin inbox is configured; on
    // staging the helper is both the "bot" and the admin.
    adminInboxId: client.inboxId,
    botInboxId: client.inboxId,
    botChannels: { trades: ids.trades },
    genesisGroupId: ids.genesis,
  }, null, 2));
  return ids;
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Claims of a valid, unexpired worker-signed access token, else null. */
function readToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), JWT_PUB, b64urlDecode(parts[2]));
    if (!ok) return null;
    const header = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
    const c = JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "EdDSA" || c.iss !== ISSUER || c.aud !== "xmtp" || c.exp <= now) return null;
    return c;
  } catch {
    return null;
  }
}

const recent = new Map();
const REQUEST = /^(JOIN_REQUEST|GENESIS_JOIN_REQUEST):([1-9A-HJ-NP-Za-km-z]{32,44})\|t=([\w-]+\.[\w-]+\.[\w-]+)$/;

async function handle(client, ids, message) {
  if (message.senderInboxId === client.inboxId) return;
  const text = message.content?.kind === "text" ? message.content.value : null;
  const m = text ? REQUEST.exec(text.trim()) : null;
  if (!m) return;
  const [, kind, wallet, token] = m;
  const dm = await message.conversation();
  const reply = (t) => dm?.sendText(`MSG:${NAME}:${t}`).catch(() => {});
  const claims = readToken(token);
  if (!claims || claims.sub !== wallet) {
    log(`refused ${kind} from ${short(message.senderInboxId)}: bad or expired token`);
    return reply("Your sign-in expired. Reload the page and sign in again.");
  }
  const targets = kind === "GENESIS_JOIN_REQUEST"
    ? (claims.tier === "genesis" ? ["genesis"] : [])
    : (claims.tier === "monke" ? ["main", "trades"] : []);
  if (!targets.length) {
    log(`refused ${kind} from ${short(message.senderInboxId)}: tier ${claims.tier}`);
    return reply(kind === "GENESIS_JOIN_REQUEST" ? "Genesis Chat needs a Saga or Seeker Genesis Token." : "Main Chat needs a Saga Monke.");
  }
  // The app DMs the bot and the admin inbox — both are this helper here — so
  // each join arrives twice. Admit once; skip the repeat quietly.
  const key = `${message.senderInboxId}:${targets.join("+")}`;
  if (Date.now() - (recent.get(key) ?? 0) < 10 * 60_000) return;
  recent.set(key, Date.now());
  for (const t of targets) {
    try {
      const g = await client.conversations.getById(ids[t]);
      await g?.addMembers([message.senderInboxId]);
    } catch (e) {
      if (!/already|exists/i.test(String(e?.message))) log(`add to ${t} failed: ${e?.message}`);
    }
  }
  log(`admitted ${short(message.senderInboxId)} (${short(wallet)}, ${claims.tier}) → ${targets.join("+")}`);
  return reply(`Welcome to the OnlyMonkes staging chat (${targets.join(" + ")}). This is a test network.`);
}

const client = await openClient();
log(`staging helper inbox ${client.inboxId}`);
const ids = await ensureGroups(client);
log("groups", JSON.stringify(ids));

// An independent reader with a saved position, not the default consumer: the
// default one keeps a database lease, so a quick restart failed with
// "A default message consumer is already active" and crash-looped. First
// start begins from "now"; restarts resume where the last run stopped.
const selection = { conversationKind: "dm", consentStates: ["allowed", "unknown"] };
const cursorPath = join(DATA, "dm-cursor.txt");
const savedCursor = existsSync(cursorPath) ? readFileSync(cursorPath, "utf8").trim() : "";
const from = savedCursor || (await client.conversations.messageHistorySnapshot(1, selection)).cursor;
const seen = new Set();
const stream = client.conversations.streamAllMessages({ ...selection, from });
for await (const message of stream) {
  if (!seen.has(message.id)) {
    seen.add(message.id);
    if (seen.size > 10000) seen.delete(seen.values().next().value);
    await handle(client, ids, message).catch((e) => log("handle error:", e?.message));
  }
  if (message.deliveryCursor) writeFileSync(cursorPath, message.deliveryCursor);
}
