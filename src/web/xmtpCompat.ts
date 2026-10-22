/**
 * Web stand-in for `@xmtp/react-native-sdk` (metro.config.js aliases it on
 * web only — the Android bundle never sees this file).
 *
 * Exposes the subset of the RN SDK v5 API that src/lib/xmtp.ts and the hooks
 * use, backed by `@xmtp/browser-sdk` 7.1 on XMTP's shared production network —
 * the same network, groups and wallet-bound inbox as the phone app, so Main
 * Chat, Genesis and DMs follow a holder between phone and browser. (The
 * self-hosted backend in Monke_Eliza VPS.md is for the SDK 8 move, which phones
 * and web make together.) The browser SDK runs in a Web Worker that Metro
 * can't bundle, so it is pre-built by scripts/web/build-xmtp.mjs into
 * public/xmtp/ and loaded here as a native ES module.
 *
 * Shapes returned match the RN SDK so callers stay unchanged: `content()` is a
 * string for text, `{ reaction }`, `{ reply }`, `{ remoteAttachment }` for the
 * native codecs; `sentNs` is a number; `messages()` defaults to newest-first.
 */

type Sdk = any;

const SDK_URL = "/xmtp/sdk.js";
// A local test page may switch to XMTP's dev network; the live site can't.
function xmtpEnv(): string {
  const override = (globalThis as any).__OM_XMTP_ENV;
  const local = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  return local && override === "dev" ? "dev" : "production";
}
const APP_VERSION = "onlymonkes-web/2";

// How many recent messages a catch-up scans for reactions newer than its window.
const CATCH_UP_REACTION_SCAN = 200;

// wasm-bindings enums (numeric in 7.x).
const CONSENT_TO_SDK: Record<RnConsent, number> = { unknown: 0, allowed: 1, denied: 2 };
const CONSENT_FROM_SDK: RnConsent[] = ["unknown", "allowed", "denied"];
const IDENTIFIER_ETHEREUM = 0;
const REACTION_ADDED = 1;
const REACTION_REMOVED = 2;
const SCHEMA = { unicode: 1, shortcode: 2, custom: 3 } as const;
const SORT_ASC = 0;
const SORT_DESC = 1;
const SORT_BY_SENT = 0;
const DELIVERY = ["unpublished", "published", "failed"];
const PERMISSION = ["member", "admin", "super_admin"];

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

const ALL_CONSENT = [1, 0, 2];

function nsOf(m: any): bigint {
  return m?.sentAtNs != null ? BigInt(m.sentAtNs) : 0n;
}

// ─── Messages ────────────────────────────────────────────────────────────────

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
      action: r?.action === REACTION_REMOVED ? "removed" : "added",
      schema: r?.schema === SCHEMA.custom ? "custom" : r?.schema === SCHEMA.shortcode ? "shortcode" : "unicode",
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

  static fromSdk(m: any): WebDecodedMessage {
    const c = m.content;
    let content: unknown;
    switch (m.contentType?.typeId) {
      case "text":
      case "markdown":
        content = typeof c === "string" ? c : "";
        break;
      case "reaction":
        content = mapReaction(c?.reference ?? "", c);
        break;
      case "reply": {
        const text = typeof c?.content === "string" ? c.content : undefined;
        content = { reply: { reference: c?.referenceId ?? c?.reference ?? "", content: text != null ? { text } : {} } };
        break;
      }
      case "remoteStaticAttachment":
        content = { remoteAttachment: mapRemoteAttachment(c) };
        break;
      case "readReceipt":
        content = { readReceipt: {} };
        break;
      case "group_updated":
        content = { groupUpdated: c ?? {} };
        break;
      default:
        content = m.fallback ? { text: m.fallback } : null;
    }
    return new WebDecodedMessage({
      id: m.id,
      senderInboxId: m.senderInboxId,
      sentAtNs: nsOf(m),
      conversationId: m.conversationId,
      fallback: m.fallback,
      contentType: m.contentType,
      deliveryStatus: DELIVERY[m.deliveryStatus] ?? "published",
      content,
    });
  }

  /** The SDK folds reactions into their target; the RN SDK lists them as messages. */
  static reactionsOf(m: any): WebDecodedMessage[] {
    if (!Array.isArray(m.reactions)) return [];
    return m.reactions.map((r: any) => new WebDecodedMessage({
      id: r.id,
      senderInboxId: r.senderInboxId,
      sentAtNs: nsOf(r),
      conversationId: m.conversationId,
      contentType: { authorityId: "xmtp.org", typeId: "reaction", versionMajor: 2, versionMinor: 0 },
      deliveryStatus: DELIVERY[r.deliveryStatus] ?? "published",
      content: mapReaction(m.id, r.content),
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
 * One all-messages stream per client, fanned out by conversation (the app
 * opens several: Main Chat, bot channels, open DMs and the all-DM stream).
 * The app does its own catch-up through messages({ afterNs }), so anything
 * sent before the hub started is skipped here rather than shown as new.
 */
class MessageHub {
  private readonly byConversation = new Map<string, Set<MessageCb>>();
  private readonly all = new Set<MessageCb>();
  private stream: any = null;
  private startedNs = 0n;
  private readonly seen = new Set<string>();

  constructor(private readonly inner: any) {}

  private starting = false;

  private ensure(): void {
    if (this.stream || this.starting) return;
    this.starting = true;
    this.startedNs = BigInt(Date.now() - 120_000) * 1_000_000n;
    const restart = () => {
      this.stream = null;
      if (this.byConversation.size || this.all.size) setTimeout(() => this.ensure(), 3000);
    };
    this.inner.conversations.streamAllMessages({
      consentStates: ALL_CONSENT,
      onValue: (m: any) => this.dispatch(m),
      onError: (e: Error) => console.warn("[XMTP web] message stream error:", e?.message),
      // The SDK retries on its own; onFail means it gave up.
      onFail: restart,
    }).then((stream: any) => {
      this.stream = stream;
    }).catch((e: unknown) => {
      console.warn("[XMTP web] message stream failed to start:", (e as Error)?.message);
      restart();
    }).finally(() => {
      this.starting = false;
    });
  }

  private dispatch(m: any): void {
    if (nsOf(m) < this.startedNs) return;
    const out = [WebDecodedMessage.fromSdk(m), ...WebDecodedMessage.reactionsOf(m)];
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
    this.stream?.end?.()?.catch?.(() => {});
    this.stream = null;
  }
}

// ─── Conversations ───────────────────────────────────────────────────────────

class WebConversation {
  constructor(private readonly sdk: Sdk, readonly inner: any, private readonly hub: MessageHub) {}

  static async wrap(sdk: Sdk, inner: any, hub: MessageHub): Promise<WebConversation> {
    return new WebConversation(sdk, inner, hub);
  }

  private get isDm(): boolean { return typeof this.inner.peerInboxId === "function"; }

  get id(): string { return this.inner.id; }
  get topic(): string { return this.inner.topic ?? this.inner.id; }
  get name(): string | undefined { return this.isDm ? undefined : this.inner.name || undefined; }
  get imageUrl(): string | undefined { return this.isDm ? undefined : this.inner.imageUrl || undefined; }
  get description(): string | undefined { return this.isDm ? undefined : this.inner.description || undefined; }
  get createdAt(): number | undefined { return this.inner.createdAt?.getTime?.(); }
  get version(): string { return this.isDm ? "DM" : "GROUP"; }

  async sync(): Promise<void> {
    await this.inner.sync();
  }

  async messages(opts: RnListOpts = {}): Promise<WebDecodedMessage[]> {
    const asc = opts.direction === "ASCENDING";
    const o: Record<string, unknown> = { direction: asc ? SORT_ASC : SORT_DESC, sortBy: SORT_BY_SENT };
    if (opts.limit != null) o.limit = BigInt(Math.max(0, Math.floor(opts.limit)));
    const after = opts.afterNs != null ? BigInt(Math.floor(opts.afterNs)) : undefined;
    const before = opts.beforeNs != null ? BigInt(Math.floor(opts.beforeNs)) : undefined;
    if (after != null) o.sentAfterNs = after;
    if (before != null) o.sentBeforeNs = before;
    const raw: any[] = await this.inner.messages(o);

    // Reactions come folded into their target message. A catch-up window
    // ("since X") would miss new reactions on older messages, so also scan
    // the latest messages for reactions newer than X.
    const out = new Map<string, WebDecodedMessage>();
    for (const m of raw) {
      const msg = WebDecodedMessage.fromSdk(m);
      out.set(msg.id, msg);
      for (const r of WebDecodedMessage.reactionsOf(m)) out.set(r.id, r);
    }
    if (after != null) {
      try {
        const recent: any[] = await this.inner.messages({ direction: SORT_DESC, sortBy: SORT_BY_SENT, limit: BigInt(CATCH_UP_REACTION_SCAN) });
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
      return this.inner.sendReaction({
        reference: r.reference,
        referenceInboxId: r.referenceInboxId ?? "",
        content: r.content,
        action: r.action === "removed" ? REACTION_REMOVED : REACTION_ADDED,
        schema: r.schema === "custom" ? SCHEMA.custom : r.schema === "shortcode" ? SCHEMA.shortcode : SCHEMA.unicode,
      });
    }
    if (c.reply) {
      const inner = c.reply.content;
      const text = typeof inner === "string" ? inner : typeof inner?.text === "string" ? inner.text : "";
      return this.inner.sendReply({ reference: c.reply.reference, content: await this.sdk.encodeText(text) });
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
      identities: (m.accountIdentifiers ?? []).map((i: any) => ({ identifier: i.identifier, kind: i.identifierKind === IDENTIFIER_ETHEREUM ? "ETHEREUM" : "PASSKEY" })),
      permissionLevel: PERMISSION[m.permissionLevel] ?? "member",
      consentState: CONSENT_FROM_SDK[m.consentState] ?? "unknown",
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
  async isActive(): Promise<boolean> { return this.inner.isActive(); }
  async consentState(): Promise<RnConsent> { return CONSENT_FROM_SDK[await this.inner.consentState()] ?? "unknown"; }
  async updateConsent(state: RnConsent): Promise<void> { await this.inner.updateConsentState(CONSENT_TO_SDK[state] ?? 0); }

  async lastMessage(): Promise<WebDecodedMessage | undefined> {
    const m = await this.inner.lastMessage();
    return m ? WebDecodedMessage.fromSdk(m) : undefined;
  }
}

class WebConversations {
  constructor(private readonly sdk: Sdk, private readonly inner: any, private readonly hub: MessageHub) {}

  private wrap = (c: any) => (c ? WebConversation.wrap(this.sdk, c, this.hub) : Promise.resolve(undefined));

  async sync(): Promise<void> { await this.inner.sync(); }

  async syncAllConversations(states?: RnConsent[]): Promise<number> {
    await this.inner.syncAll(Array.isArray(states) && states.length ? states.map((x) => CONSENT_TO_SDK[x] ?? 0) : undefined);
    return 0;
  }

  async findGroup(id: string): Promise<WebConversation | undefined> {
    const c = await this.inner.getConversationById(id);
    return c && typeof c.peerInboxId !== "function" ? this.wrap(c) : undefined;
  }

  async findConversation(id: string): Promise<WebConversation | undefined> {
    return this.wrap(await this.inner.getConversationById(id));
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
      groupName: opts?.name,
      groupImageUrlSquare: opts?.imageUrl,
      groupDescription: opts?.description,
    });
    return (await this.wrap(g))!;
  }

  private listOpts(limit?: number, states?: RnConsent[]) {
    const o: Record<string, unknown> = {};
    if (Array.isArray(states) && states.length) o.consentStates = states.map((x) => CONSENT_TO_SDK[x] ?? 0);
    if (limit != null) o.limit = BigInt(limit);
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

function sdkIdentifier(identifier: string) {
  return { identifier: identifier.toLowerCase(), identifierKind: IDENTIFIER_ETHEREUM };
}

function toWebSigner(signer: RnSigner) {
  return {
    type: "EOA" as const,
    getIdentifier: async () => sdkIdentifier((await signer.getIdentifier()).identifier),
    signMessage: async (text: string) => hexToBytes((await signer.signMessage(text)).signature),
  };
}

function clientOptions() {
  return { env: xmtpEnv(), appVersion: APP_VERSION };
}

let _backend: Promise<unknown> | null = null;
function backend(sdk: Sdk): Promise<unknown> {
  if (!_backend) {
    _backend = sdk.createBackend({ env: xmtpEnv(), appVersion: APP_VERSION });
    _backend!.catch(() => { _backend = null; });
  }
  return _backend!;
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
    void inboxId;
    const inner = await withStorageRetry(() => sdk.Client.build(sdkIdentifier(identity.identifier), clientOptions()));
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

  /** Inbox ID registered for an identity on the network, or undefined. */
  static async getInboxIdForIdentifier(identity: PublicIdentity): Promise<string | undefined> {
    const sdk = await loadSdk();
    return sdk.getInboxIdForIdentifier(await backend(sdk), sdkIdentifier(identity.identifier));
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

  /** Ask the inbox's other devices (the phone) to share message history. */
  async sendSyncRequest(): Promise<void> {
    await this.inner.sendSyncRequest();
  }

  async inboxState(refresh = false): Promise<{ inboxId: string; installations: { id: string; createdAt?: number }[] }> {
    const s = await this.inner.preferences.inboxState(refresh);
    return {
      inboxId: s.inboxId,
      installations: (s.installations ?? []).map((i: any) => ({
        id: i.id,
        createdAt: i.clientTimestampNs != null ? Number(BigInt(i.clientTimestampNs) / 1_000_000n) : undefined,
      })),
    };
  }

  async revokeInstallations(_signer: RnSigner, installationIds: string[]): Promise<void> {
    await this.inner.revokeInstallations(installationIds.map(hexToBytes));
  }

  async close(): Promise<void> {
    this.hub.close();
    this.inner.close?.();
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
