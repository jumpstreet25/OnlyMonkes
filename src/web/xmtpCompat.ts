/**
 * Web stand-in for `@xmtp/react-native-sdk` (metro.config.js aliases it on
 * web only — the Android bundle never sees this file).
 *
 * Exposes the subset of the RN SDK v5 API that src/lib/xmtp.ts and the hooks
 * use, backed by `@xmtp/browser-sdk` v8 against OnlyMonkes' self-hosted XMTP
 * backend. The browser SDK runs in a Web Worker that Metro can't bundle, so
 * it is pre-built by scripts/web/build-xmtp.mjs into public/xmtp/ and loaded
 * here as a native ES module.
 *
 * Shapes returned match the RN SDK so callers stay unchanged: `content()` is a
 * string for text, `{ reaction }`, `{ reply }`, `{ remoteAttachment }` for the
 * native codecs; `sentNs` is a number; `messages()` defaults to newest-first.
 */

import { getXmtpCredential } from "./webAuth";

type Sdk = any;

const SDK_URL = "/xmtp/sdk.js";

// Staging deployment on the VPS (Monke_Eliza agents/monke-trader/VPS.md).
// Production moves to Fly.io under its own deployment identifier.
const DEFAULT_BACKEND_URL = "https://157-173-192-39.sslip.io";
const APP_VERSION = "onlymonkes-web/1";

// The old network registered inboxes with nonce 1; v8 defaults to 0. Keeping
// 1 gives every wallet the same inbox ID it has today (bot, admin and
// profile-cache IDs all key on it).
const REGISTRATION_NONCE = 1n;

// How many recent messages a catch-up scans for reactions newer than its window.
const CATCH_UP_REACTION_SCAN = 200;

function backendUrl(): string {
  const override = (globalThis as any).__OM_XMTP_BACKEND_URL;
  return typeof override === "string" && /^https?:\/\//.test(override) ? override : DEFAULT_BACKEND_URL;
}

/**
 * Bearer credential for the backend's [auth]: the holder token from the web
 * sign-in (src/web/webAuth.ts). A test harness may pre-set
 * `__OM_XMTP_TEST_CREDENTIAL` (API key or token) in the page instead.
 */
const credentialSource = {
  async credential() {
    const test = (globalThis as any).__OM_XMTP_TEST_CREDENTIAL;
    if (typeof test === "string" && test.length >= 32) {
      return { value: `Bearer ${test}`, expiresAtSeconds: BigInt(Math.floor(Date.now() / 1000) + 3600) };
    }
    return getXmtpCredential();
  },
};

function backendSource() {
  return { url: backendUrl(), appVersion: APP_VERSION, credentials: credentialSource };
}

let _sdk: Promise<Sdk> | null = null;

function loadSdk(): Promise<Sdk> {
  if (_sdk) return _sdk;
  _sdk = new Promise<Sdk>((resolve, reject) => {
    const g = globalThis as any;
    if (g.__OM_XMTP_SDK) return resolve(g.__OM_XMTP_SDK);
    const s = document.createElement("script");
    s.type = "module";
    s.src = SDK_URL;
    s.onload = () => (g.__OM_XMTP_SDK ? resolve(g.__OM_XMTP_SDK) : reject(new Error("XMTP web SDK failed to initialise")));
    s.onerror = () => reject(new Error("XMTP web SDK failed to load"));
    document.head.appendChild(s);
  }).then(async (sdk) => {
    await sdk.pure.initPureWasm();
    return sdk;
  });
  _sdk.catch(() => { _sdk = null; });
  return _sdk;
}

// The SDK's OPFS database allows one connection, so only one tab may run a
// client. Hold a Web Lock for the life of the page.
let _tabLock: Promise<void> | null = null;
export const XMTP_OTHER_TAB_ERROR = "OnlyMonkes is already open in another tab or window. Close it and reload.";

function acquireTabLock(): Promise<void> {
  if (_tabLock) return _tabLock;
  const locks = (navigator as any).locks;
  if (!locks?.request) return (_tabLock = Promise.resolve());
  _tabLock = new Promise<void>((resolve, reject) => {
    locks.request("onlymonkes-xmtp", { ifAvailable: true }, (lock: unknown) => {
      if (!lock) {
        reject(new Error(XMTP_OTHER_TAB_ERROR));
        return undefined;
      }
      resolve();
      return new Promise(() => {});
    });
  });
  _tabLock.catch(() => { _tabLock = null; });
  return _tabLock;
}

// ─── Small converters ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) return new Uint8Array();
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array | ArrayBuffer | undefined): string {
  if (!b) return "";
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}

type RnConsent = "allowed" | "unknown" | "denied";

const ALL_CONSENT: RnConsent[] = ["allowed", "unknown", "denied"];

function nsOf(t: any): bigint {
  return t?.ns != null ? BigInt(t.ns) : 0n;
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** Text of a v8 reply body / message body, if it carries text. */
function bodyText(body: any): string | undefined {
  return body && (body.kind === "text" || body.kind === "markdown") ? body.value : undefined;
}

function mapRemoteAttachment(v: any) {
  return {
    url: v?.url ?? "",
    filename: v?.filename,
    scheme: v?.scheme ?? "https://",
    contentDigest: v?.contentDigest ?? "",
    contentLength: v?.contentLength != null ? String(v.contentLength) : undefined,
    secret: bytesToHex(v?.secret),
    salt: bytesToHex(v?.salt),
    nonce: bytesToHex(v?.nonce),
  };
}

function mapReaction(reference: string, r: any) {
  return {
    reaction: {
      reference,
      action: r?.action === "removed" ? "removed" : "added",
      schema: r?.schema === "custom" || r?.schema === "shortcode" ? r.schema : "unicode",
      content: r?.content ?? "",
    },
  };
}

class WebDecodedMessage {
  readonly id: string;
  readonly senderInboxId: string;
  readonly sentNs: number;
  readonly sentAtNs: bigint;
  readonly conversationId: string;
  readonly topic: string;
  readonly fallback: string | undefined;
  readonly contentTypeId: string;
  readonly deliveryStatus: string;
  readonly nativeContent: Record<string, unknown>;
  private readonly _content: unknown;

  constructor(fields: {
    id: string;
    senderInboxId: string;
    sentAtNs: bigint;
    conversationId: string;
    topic?: string;
    fallback?: string;
    contentType?: any;
    deliveryStatus?: string;
    content: unknown;
  }) {
    this.id = fields.id;
    this.senderInboxId = fields.senderInboxId;
    this.sentAtNs = fields.sentAtNs;
    this.sentNs = Number(fields.sentAtNs);
    this.conversationId = fields.conversationId;
    this.topic = fields.topic ?? fields.conversationId;
    this.fallback = fields.fallback ?? undefined;
    const ct = fields.contentType ?? {};
    this.contentTypeId = `${ct.authorityId ?? "xmtp.org"}/${ct.typeId ?? "unknown"}:${ct.versionMajor ?? 1}.${ct.versionMinor ?? 0}`;
    this.deliveryStatus = (fields.deliveryStatus ?? "published").toUpperCase();
    this._content = fields.content;
    this.nativeContent = typeof fields.content === "string" ? { text: fields.content } : (fields.content as Record<string, unknown>) ?? {};
  }

  static fromV8(m: any): WebDecodedMessage {
    const c = m.content ?? {};
    let content: unknown;
    switch (c.kind) {
      case "text":
      case "markdown":
        content = typeof c.value === "string" ? c.value : "";
        break;
      case "reaction":
        content = mapReaction(c.reference ?? "", c.reaction);
        break;
      case "reply": {
        const text = bodyText(c.body);
        content = { reply: { reference: c.referenceId ?? "", content: text != null ? { text } : {} } };
        break;
      }
      case "remoteAttachment":
        content = { remoteAttachment: mapRemoteAttachment(c.value) };
        break;
      case "readReceipt":
        content = { readReceipt: {} };
        break;
      case "groupUpdated":
        content = { groupUpdated: c.value ?? {} };
        break;
      case "deletedMessage":
        content = { deletedMessage: c.value ?? {} };
        break;
      default:
        content = m.fallback ? { text: m.fallback } : null;
    }
    return new WebDecodedMessage({
      id: m.id,
      senderInboxId: m.senderInboxId,
      sentAtNs: nsOf(m.sentAt),
      conversationId: m.conversationId,
      topic: m.topic,
      fallback: m.fallback,
      contentType: m.contentType,
      deliveryStatus: m.deliveryStatus,
      content,
    });
  }

  /** v8 folds reactions into their target; the RN SDK lists them as messages. */
  static reactionsOf(m: any): WebDecodedMessage[] {
    if (!Array.isArray(m.reactions)) return [];
    return m.reactions.map((r: any) => new WebDecodedMessage({
      id: r.id,
      senderInboxId: r.senderInboxId,
      sentAtNs: nsOf(r.sentAt),
      conversationId: m.conversationId,
      topic: m.topic,
      contentType: { authorityId: "xmtp.org", typeId: "reaction", versionMajor: 2, versionMinor: 0 },
      deliveryStatus: r.deliveryStatus,
      content: mapReaction(m.id, r.reaction),
    }));
  }

  content(): unknown {
    return this._content;
  }
}

type RnListOpts = {
  limit?: number;
  beforeNs?: number;
  afterNs?: number;
  direction?: "ASCENDING" | "DESCENDING";
};

type MessageCb = (m: WebDecodedMessage) => void | Promise<void>;

// ─── Live message hub ────────────────────────────────────────────────────────

/**
 * v8 allows one default message reader per database; a second one fails with
 * ConsumerOwned. The app opens several (Main Chat, bot channels, open DMs and
 * the all-DM stream), so each client runs one reader here and fans messages
 * out by conversation. A reader replays retained messages when it opens; the
 * app does its own catch-up through messages({ afterNs }), so anything sent
 * before the hub started is skipped here rather than shown as new.
 */
class MessageHub {
  private readonly byConversation = new Map<string, Set<MessageCb>>();
  private readonly all = new Set<MessageCb>();
  private stream: any = null;
  private startedNs = 0n;
  private readonly seen = new Set<string>();

  constructor(private readonly inner: any) {}

  private starting = false;

  // An independent reader starting at "now", not the default consumer: the
  // default one holds a database lease, so after a page reload it can fail
  // with "A default message consumer is already active" (hit on the staging
  // helper). The app catches up on history itself via messages().
  private ensure(): void {
    if (this.stream || this.starting) return;
    this.starting = true;
    this.startedNs = BigInt(Date.now() - 120_000) * 1_000_000n;
    (async () => {
      const selection = { consentStates: ALL_CONSENT };
      const { cursor } = await this.inner.conversations.messageHistorySnapshot(1, selection);
      this.stream = this.inner.conversations.streamAllMessages({ ...selection, from: cursor });
      this.starting = false;
      await this.stream.onValue((m: any) => this.dispatch(m));
    })().catch((e: unknown) => {
      console.warn("[XMTP web] message stream ended:", (e as Error)?.message);
    }).finally(() => {
      this.starting = false;
      this.stream = null;
      if (this.byConversation.size || this.all.size) setTimeout(() => this.ensure(), 3000);
    });
  }

  private dispatch(m: any): void {
    if (nsOf(m.sentAt) < this.startedNs) return;
    const out = [WebDecodedMessage.fromV8(m), ...WebDecodedMessage.reactionsOf(m)];
    for (const msg of out) {
      if (this.seen.has(msg.id)) continue;
      this.seen.add(msg.id);
      if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value as string);
      for (const cb of this.byConversation.get(msg.conversationId) ?? []) void cb(msg);
      for (const cb of this.all) void cb(msg);
    }
  }

  subscribe(conversationId: string | null, cb: MessageCb): () => void {
    if (conversationId) {
      let set = this.byConversation.get(conversationId);
      if (!set) this.byConversation.set(conversationId, (set = new Set()));
      set.add(cb);
    } else {
      this.all.add(cb);
    }
    this.ensure();
    return () => {
      if (conversationId) this.byConversation.get(conversationId)?.delete(cb);
      else this.all.delete(cb);
    };
  }

  close(): void {
    this.byConversation.clear();
    this.all.clear();
    this.stream?.end?.().catch?.(() => {});
    this.stream = null;
  }
}

// ─── Conversations ───────────────────────────────────────────────────────────

class WebConversation {
  private _state: { name?: string; imageUrl?: string; description?: string } = {};

  constructor(private readonly sdk: Sdk, readonly inner: any, private readonly hub: MessageHub) {}

  /** Groups read name/image through state(); cache it so `.name` stays sync. */
  static async wrap(sdk: Sdk, inner: any, hub: MessageHub): Promise<WebConversation> {
    const c = new WebConversation(sdk, inner, hub);
    if (inner.kind === "group") await c.refreshState();
    return c;
  }

  private async refreshState(): Promise<void> {
    try {
      const s = await this.inner.state();
      this._state = { name: s.name || undefined, imageUrl: s.imageUrl || undefined, description: s.description || undefined };
    } catch { /* keep the last values */ }
  }

  get id(): string { return this.inner.id; }
  get topic(): string { return this.inner.topic ?? this.inner.id; }
  get name(): string | undefined { return this._state.name; }
  get imageUrl(): string | undefined { return this._state.imageUrl; }
  get description(): string | undefined { return this._state.description; }
  get createdAt(): number | undefined { return this.inner.createdAt?.date?.getTime?.(); }
  get version(): string { return this.inner.kind === "dm" ? "DM" : "GROUP"; }

  async sync(): Promise<void> {
    await this.inner.sync();
    if (this.inner.kind === "group") await this.refreshState();
  }

  async messages(opts: RnListOpts = {}): Promise<WebDecodedMessage[]> {
    const { Timestamp } = this.sdk;
    const asc = opts.direction === "ASCENDING";
    const o: Record<string, unknown> = { direction: asc ? "ascending" : "descending", sortBy: "sentAt" };
    if (opts.limit != null) o.limit = Math.max(0, Math.floor(opts.limit));
    const after = opts.afterNs != null ? BigInt(Math.floor(opts.afterNs)) : undefined;
    const before = opts.beforeNs != null ? BigInt(Math.floor(opts.beforeNs)) : undefined;
    if (after != null) o.sentAfter = new Timestamp(after);
    if (before != null) o.sentBefore = new Timestamp(before);
    const raw: any[] = await this.inner.messages(o);

    // v8 keeps reactions only inside their target message (they can't be
    // queried on their own). A catch-up window ("since X") would miss new
    // reactions on older messages, so also scan the latest messages for
    // reactions newer than X.
    const out = new Map<string, WebDecodedMessage>();
    for (const m of raw) {
      const msg = WebDecodedMessage.fromV8(m);
      out.set(msg.id, msg);
      for (const r of WebDecodedMessage.reactionsOf(m)) out.set(r.id, r);
    }
    if (after != null) {
      try {
        const recent: any[] = await this.inner.messages({ direction: "descending", sortBy: "sentAt", limit: CATCH_UP_REACTION_SCAN });
        for (const m of recent) {
          for (const r of WebDecodedMessage.reactionsOf(m)) if (!out.has(r.id)) out.set(r.id, r);
        }
      } catch { /* the live hub still delivers reactions */ }
    }
    const list = [...out.values()].filter((m) =>
      (after == null || m.sentAtNs > after) && (before == null || m.sentAtNs < before));
    list.sort((x, y) => {
      const d = x.sentAtNs - y.sentAtNs;
      return (d < 0n ? -1 : d > 0n ? 1 : 0) * (asc ? 1 : -1);
    });
    return list;
  }

  async send(content: unknown): Promise<string> {
    if (typeof content === "string") return this.inner.sendText(content);
    const c = (content ?? {}) as Record<string, any>;
    if (typeof c.text === "string") return this.inner.sendText(c.text);
    if (c.reaction) {
      const r = c.reaction;
      return this.inner.sendReaction(r.reference, r.referenceInboxId || undefined, {
        content: r.content,
        action: r.action === "removed" ? "removed" : "added",
        schema: r.schema === "custom" || r.schema === "shortcode" ? r.schema : "unicode",
      });
    }
    if (c.reply) {
      const inner = c.reply.content;
      const text = typeof inner === "string" ? inner : typeof inner?.text === "string" ? inner.text : "";
      return this.inner.sendReply(c.reply.reference, undefined, this.sdk.pure.encodeText(text));
    }
    if (c.remoteAttachment) {
      const a = c.remoteAttachment;
      return this.inner.sendRemoteAttachment({
        url: a.url,
        filename: a.filename,
        scheme: a.scheme ?? "https://",
        contentDigest: a.contentDigest ?? "",
        contentLength: a.contentLength != null ? Number(a.contentLength) : undefined,
        secret: hexToBytes(a.secret ?? ""),
        salt: hexToBytes(a.salt ?? ""),
        nonce: hexToBytes(a.nonce ?? ""),
      });
    }
    throw new Error("xmtpCompat: unsupported content shape");
  }

  async streamMessages(cb: MessageCb): Promise<() => void> {
    return this.hub.subscribe(this.id, cb);
  }

  async members(): Promise<{ inboxId: string; identities: { identifier: string; kind: string }[]; permissionLevel: string; consentState: RnConsent }[]> {
    const ms: any[] = await this.inner.members();
    return ms.map((m) => ({
      inboxId: m.inboxId,
      identities: (m.identities ?? []).map((i: any) => ({ identifier: i.identifier, kind: String(i.kind).toUpperCase() })),
      permissionLevel: m.permissionLevel === "superAdmin" ? "super_admin" : m.permissionLevel,
      consentState: m.consentState,
    }));
  }

  async memberInboxIds(): Promise<string[]> {
    return (await this.inner.members()).map((m: any) => m.inboxId);
  }

  async peerInboxId(): Promise<string> {
    const id = await this.inner.peerInboxId();
    if (!id) throw new Error("xmtpCompat: DM peer unknown");
    return id;
  }

  async addMembers(ids: string[]): Promise<void> { await this.inner.addMembers(ids); }
  async removeMembers(ids: string[]): Promise<void> { await this.inner.removeMembers(ids); }
  async isAdmin(id: string): Promise<boolean> { return this.inner.isAdmin(id); }
  async isSuperAdmin(id: string): Promise<boolean> { return this.inner.isSuperAdmin(id); }
  async isActive(): Promise<boolean> { return (await this.commonState()).isActive; }
  async consentState(): Promise<RnConsent> { return (await this.commonState()).consentState; }
  async updateConsent(state: RnConsent): Promise<void> { await this.inner.updateConsentState(state); }

  private async commonState(): Promise<{ isActive: boolean; consentState: RnConsent }> {
    const s = await this.inner.state();
    return s.common ?? s;
  }

  async lastMessage(): Promise<WebDecodedMessage | undefined> {
    const m = await this.inner.lastMessage();
    return m ? WebDecodedMessage.fromV8(m) : undefined;
  }
}

class WebConversations {
  constructor(private readonly sdk: Sdk, private readonly inner: any, private readonly hub: MessageHub) {}

  private wrap = (c: any) => (c ? WebConversation.wrap(this.sdk, c, this.hub) : Promise.resolve(undefined));

  async sync(): Promise<void> { await this.inner.sync(); }

  async syncAllConversations(states?: RnConsent[]): Promise<number> {
    await this.inner.syncAll(Array.isArray(states) && states.length ? states : undefined);
    return 0;
  }

  async findGroup(id: string): Promise<WebConversation | undefined> {
    const c = await this.inner.getById(id);
    return c?.kind === "group" ? this.wrap(c) : undefined;
  }

  async findConversation(id: string): Promise<WebConversation | undefined> {
    return this.wrap(await this.inner.getById(id));
  }

  async findDmByInboxId(inboxId: string): Promise<WebConversation | undefined> {
    return this.wrap(await this.inner.getDmByInboxId(inboxId));
  }

  async findOrCreateDm(peerInboxId: string): Promise<WebConversation> {
    const existing = await this.inner.getDmByInboxId(peerInboxId);
    return (await this.wrap(existing ?? (await this.inner.createDm(peerInboxId))))!;
  }

  async newGroup(inboxIds: string[], opts?: { name?: string; imageUrl?: string; description?: string }): Promise<WebConversation> {
    const g = await this.inner.createGroup(inboxIds, {
      name: opts?.name,
      imageUrl: opts?.imageUrl,
      description: opts?.description,
    });
    return (await this.wrap(g))!;
  }

  private listOpts(limit?: number, states?: RnConsent[]) {
    const o: Record<string, unknown> = {};
    if (Array.isArray(states) && states.length) o.consentStates = states;
    if (limit != null) o.limit = limit;
    return o;
  }

  async listGroups(_opts?: unknown, limit?: number, states?: RnConsent[]): Promise<WebConversation[]> {
    const gs: any[] = await this.inner.listGroups(this.listOpts(limit, states));
    return Promise.all(gs.map((g) => this.wrap(g) as Promise<WebConversation>));
  }

  async listDms(_opts?: unknown, limit?: number, states?: RnConsent[]): Promise<WebConversation[]> {
    const ds: any[] = await this.inner.listDms(this.listOpts(limit, states));
    return Promise.all(ds.map((d) => this.wrap(d) as Promise<WebConversation>));
  }

  async list(): Promise<WebConversation[]> {
    const cs: any[] = await this.inner.list();
    return Promise.all(cs.map((c) => this.wrap(c) as Promise<WebConversation>));
  }

  /** RN signature: (callback, type?, consentStates?). No unsubscribe in the RN API. */
  async streamAllMessages(cb: MessageCb, _type?: unknown, _states?: RnConsent[]): Promise<void> {
    this.hub.subscribe(null, cb);
  }

  cancelStreamAllMessages(): void {
    this.hub.close();
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class PublicIdentity {
  constructor(readonly identifier: string, readonly kind: "ETHEREUM" | "PASSKEY") {}
}

/** RN signer: signMessage(text) resolves `{ signature: 0x<hex> }`. */
type RnSigner = {
  getIdentifier: () => Promise<PublicIdentity>;
  signMessage: (message: string) => Promise<{ signature: string }>;
};

function toWebSigner(signer: RnSigner) {
  return {
    identity: async () => ({ identifier: (await signer.getIdentifier()).identifier.toLowerCase(), kind: "ethereum" as const }),
    kind: async () => ({ kind: "eoa" as const }),
    sign: async (request: { text: string }) => ({
      kind: "ecdsa" as const,
      value: hexToBytes((await signer.signMessage(request.text)).signature),
    }),
  };
}

function clientOptions() {
  return {
    backend: backendSource(),
    // Explicitly the SDK's own browser default. Its "default" picks
    // `${process.cwd()}/xmtp` whenever a `process` global exists — and the app
    // installs a process shim (global.ts) for Solana libs, which broke OPFS
    // ("storage location cannot access OPFS").
    storage: { location: { directory: "xmtp-sdk" } },
    registration: { nonce: REGISTRATION_NONCE },
  };
}

const _clients = new Map<string, WebClient>();

// The browser database allows one connection, but the app can ask for the
// same client twice at once (login-screen prefetch + chat screen) — the second
// then fails with "cannot access OPFS". One client per identity, shared.
const _byIdentity = new Map<string, Promise<WebClient>>();

/**
 * The SDK's storage worker can still hold the database for a moment after a
 * reload or a closed client; opening then fails with "cannot access OPFS".
 * Retry briefly instead of showing "Connection Failed".
 */
let _opSeq = 0;
function trace(msg: string): void {
  console.warn(`[XMTP web] ${msg}`);
}

async function withStorageRetry<T>(open: () => Promise<T>, label = "open"): Promise<T> {
  const op = ++_opSeq;
  for (let attempt = 0; ; attempt++) {
    try {
      return await open();
    } catch (e) {
      trace(`#${op} ${label} failed: ${String((e as Error)?.message).slice(0, 160)}`);
      if (attempt >= 5 || !/OPFS|access handle|NoModificationAllowed/i.test(String((e as Error)?.message))) throw e;
      await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
    }
  }
}

function onePerIdentity(identifier: string, open: () => Promise<WebClient>): Promise<WebClient> {
  const key = identifier.toLowerCase();
  const existing = _byIdentity.get(key);
  if (existing) return existing;
  const p = withStorageRetry(open, `create ${key.slice(0, 8)}`);
  _byIdentity.set(key, p);
  p.catch(() => { if (_byIdentity.get(key) === p) _byIdentity.delete(key); });
  return p;
}

export class Client {
  static async create(signer: RnSigner, _opts?: unknown): Promise<WebClient> {
    const identity = await signer.getIdentifier();
    return onePerIdentity(identity.identifier, async () => {
      await acquireTabLock();
      const sdk = await loadSdk();
      const inner = await sdk.Client.create(toWebSigner(signer), clientOptions());
      return WebClient.register(sdk, inner, identity);
    });
  }

  static async build(identity: PublicIdentity, _opts?: unknown, inboxId?: string): Promise<WebClient> {
    const existing = _byIdentity.get(identity.identifier.toLowerCase());
    if (existing) return existing;
    await acquireTabLock();
    const sdk = await loadSdk();
    const inner = await withStorageRetry(() => sdk.Client.build(
      { identifier: identity.identifier.toLowerCase(), kind: "ethereum" },
      clientOptions(),
      inboxId || undefined,
    ));
    const client = WebClient.register(sdk, inner, identity);
    _byIdentity.set(identity.identifier.toLowerCase(), Promise.resolve(client));
    return client;
  }

  static async dropClient(installationId: string): Promise<void> {
    const c = _clients.get(installationId);
    _clients.delete(installationId);
    if (c) _byIdentity.delete(c.publicIdentity.identifier.toLowerCase());
    await c?.close();
  }

  /** Inbox ID registered for an identity on this backend, or undefined. */
  static async getInboxIdForIdentifier(identity: PublicIdentity): Promise<string | undefined> {
    const sdk = await loadSdk();
    const id = { identifier: identity.identifier.toLowerCase(), kind: "ethereum" as const };
    const reachable: Map<string, boolean> = await sdk.Client.canMessage([id], backendSource());
    const registered = [...reachable.values()].some(Boolean);
    return registered ? sdk.Client.inboxIdFor(id, backendSource()) : undefined;
  }
}

export class WebClient {
  readonly conversations: WebConversations;
  private readonly hub: MessageHub;

  private constructor(private readonly sdk: Sdk, private readonly inner: any, readonly publicIdentity: PublicIdentity) {
    this.hub = new MessageHub(inner);
    this.conversations = new WebConversations(sdk, inner.conversations, this.hub);
  }

  static register(sdk: Sdk, inner: any, identity: PublicIdentity): WebClient {
    const c = new WebClient(sdk, inner, new PublicIdentity(identity.identifier, identity.kind ?? "ETHEREUM"));
    _clients.set(c.installationId, c);
    return c;
  }

  get inboxId(): string { return this.inner.inboxId; }
  get installationId(): string { return this.inner.installationId; }

  /** Browser installs never carry a legacy random inbox, so this always defers to Client.create. */
  async addAccount(_signer: unknown, _allowReassign?: boolean): Promise<void> {
    throw new Error("xmtpCompat: addAccount is not used on web");
  }

  /** v8 has no history-sync request; device sync runs on its own. */
  async sendSyncRequest(): Promise<void> {}

  async inboxState(refresh = false): Promise<{ inboxId: string; installations: { id: string; createdAt?: number }[] }> {
    const s = await this.inner.inboxState(refresh);
    return {
      inboxId: s.inboxId,
      installations: (s.installations ?? []).map((i: any) => ({
        id: i.id,
        createdAt: i.createdAt?.date?.getTime?.(),
      })),
    };
  }

  async revokeInstallations(signer: RnSigner, installationIds: string[]): Promise<void> {
    await this.inner.revokeInstallations(toWebSigner(signer), installationIds);
  }

  async close(): Promise<void> {
    this.hub.close();
    await this.inner.end?.();
  }
}

// The RN codec classes are registration tokens; the browser SDK has these
// content types built in.
export class ReactionCodec {}
export class ReactionV2Codec {}
export class ReplyCodec {}
export class RemoteAttachmentCodec {}
export class Group {}
export class Dm {}
export class Conversation {}
