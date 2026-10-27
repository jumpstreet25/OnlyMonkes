/**
 * OnlyMonkes' XMTP SDK seam for 3.1 (React Native SDK 8, self-hosted backend).
 *
 * SDK 8 replaced the v5 API outright. The app still talks v5 (xmtp.ts, useXmtp,
 * xmtpIdentity), so this module exposes the subset of the v5 surface those use,
 * backed by SDK 8 — ported from the web app's browser-SDK-8 adapter
 * (web-app branch, src/web/xmtpCompat.ts before 5867d80); RN SDK 8 shares that
 * generated API.
 *
 * Shapes returned match v5 so callers stay unchanged: `content()` is a string
 * for text, `{ reaction }`, `{ reply }`, `{ remoteAttachment }` for the native
 * codecs; `sentNs` is a number; `messages()` defaults to newest-first.
 */

import * as Sdk from "@xmtp/react-native-sdk";
import { getXmtpCredential } from "@/lib/xmtpCredential";

import { XMTP_BACKEND_URL } from "@/lib/xmtpBackend";

export { XMTP_BACKEND_URL };
const APP_VERSION = "onlymonkes-android/3.1";

// The old network registered inboxes with nonce 1; v8 defaults to 0. Keeping
// 1 gives every wallet the same inbox ID it has today (bot, admin and
// profile-cache IDs all key on it).
const REGISTRATION_NONCE = 1n;

// How many recent messages a catch-up scans for reactions newer than its window.
const CATCH_UP_REACTION_SCAN = 200;

function backendSource() {
  return { url: XMTP_BACKEND_URL, appVersion: APP_VERSION, credentials: { credential: getXmtpCredential } };
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

// ─── v5 content types the app imports ────────────────────────────────────────

export type ReactionContent = {
  reference: string;
  action: "added" | "removed";
  schema: "unicode" | "shortcode" | "custom";
  content: string;
  referenceInboxId?: string;
};
export type ReplyContent = { reference: string; content: any; contentType?: string };
export type RemoteAttachmentContent = {
  url: string;
  filename?: string;
  scheme: string;
  contentDigest: string;
  contentLength?: string;
  secret: string;
  salt: string;
  nonce: string;
};

// ─── Messages ────────────────────────────────────────────────────────────────

/** Text of a v8 reply body / message body, if it carries text. */
function bodyText(body: any): string | undefined {
  return body && (body.kind === "text" || body.kind === "markdown") ? body.value : undefined;
}

function mapRemoteAttachment(v: any): RemoteAttachmentContent {
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

function mapReaction(reference: string, r: any): { reaction: ReactionContent } {
  return {
    reaction: {
      reference,
      action: r?.action === "removed" ? "removed" : "added",
      schema: r?.schema === "custom" || r?.schema === "shortcode" ? r.schema : "unicode",
      content: r?.content ?? "",
    },
  };
}

export class DecodedMessage {
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

  static fromV8(m: any): DecodedMessage {
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
    return new DecodedMessage({
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

  /** v8 folds reactions into their target; v5 listed them as messages. */
  static reactionsOf(m: any): DecodedMessage[] {
    if (!Array.isArray(m.reactions)) return [];
    return m.reactions.map((r: any) => new DecodedMessage({
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

  content(): any {
    return this._content;
  }
}

type RnListOpts = {
  limit?: number;
  beforeNs?: number;
  afterNs?: number;
  direction?: "ASCENDING" | "DESCENDING";
};

type MessageCb = (m: DecodedMessage) => void | Promise<void>;

// ─── Live message hub ────────────────────────────────────────────────────────

/**
 * v8 allows one default message reader per database; a second one fails with
 * ConsumerOwned. The app opens several (Main Chat, bot channels, open DMs and
 * the all-DM stream), so each client runs one reader here and fans messages
 * out by conversation. The app does its own catch-up through
 * messages({ afterNs }), so the reader starts at "now".
 */
class MessageHub {
  private readonly byConversation = new Map<string, Set<MessageCb>>();
  private readonly all = new Set<MessageCb>();
  private stream: any = null;
  private startedNs = 0n;
  private readonly seen = new Set<string>();
  private starting = false;
  private closed = false;

  constructor(private readonly inner: any) {}

  private ensure(): void {
    if (this.stream || this.starting || this.closed) return;
    this.starting = true;
    this.startedNs = BigInt(Date.now() - 120_000) * 1_000_000n;
    (async () => {
      const selection = { consentStates: ALL_CONSENT };
      const { cursor } = await this.inner.conversations.messageHistorySnapshot(1, selection);
      this.stream = this.inner.conversations.streamAllMessages({ ...selection, from: cursor });
      this.starting = false;
      await this.stream.onValue((m: any) => this.dispatch(m));
    })().catch((e: unknown) => {
      if (__DEV__) console.warn("[XMTP] message stream ended:", (e as Error)?.message);
    }).finally(() => {
      this.starting = false;
      this.stream = null;
      if (!this.closed && (this.byConversation.size || this.all.size)) setTimeout(() => this.ensure(), 3000);
    });
  }

  private dispatch(m: any): void {
    if (nsOf(m.sentAt) < this.startedNs) return;
    const out = [DecodedMessage.fromV8(m), ...DecodedMessage.reactionsOf(m)];
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
    this.closed = true;
    this.byConversation.clear();
    this.all.clear();
    this.stream?.end?.().catch?.(() => {});
    this.stream = null;
  }
}

// ─── Conversations ───────────────────────────────────────────────────────────

export class Conversation {
  private _state: { name?: string; imageUrl?: string; description?: string } = {};

  constructor(readonly inner: any, private readonly hub: MessageHub) {}

  /** Groups read name/image through state(); cache it so `.name` stays sync. */
  static async wrap(inner: any, hub: MessageHub): Promise<Conversation> {
    const c = new Conversation(inner, hub);
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

  async messages(opts: RnListOpts = {}): Promise<DecodedMessage[]> {
    const asc = opts.direction === "ASCENDING";
    const o: Record<string, unknown> = { direction: asc ? "ascending" : "descending", sortBy: "sentAt" };
    if (opts.limit != null) o.limit = Math.max(0, Math.floor(opts.limit));
    const after = opts.afterNs != null ? BigInt(Math.floor(opts.afterNs)) : undefined;
    const before = opts.beforeNs != null ? BigInt(Math.floor(opts.beforeNs)) : undefined;
    if (after != null) o.sentAfter = new (Sdk.Timestamp as any)(after);
    if (before != null) o.sentBefore = new (Sdk.Timestamp as any)(before);
    const raw: any[] = await this.inner.messages(o);

    // v8 keeps reactions only inside their target message. A catch-up window
    // ("since X") would miss new reactions on older messages, so also scan the
    // latest messages for reactions newer than X.
    const out = new Map<string, DecodedMessage>();
    for (const m of raw) {
      const msg = DecodedMessage.fromV8(m);
      out.set(msg.id, msg);
      for (const r of DecodedMessage.reactionsOf(m)) out.set(r.id, r);
    }
    if (after != null) {
      try {
        const recent: any[] = await this.inner.messages({ direction: "descending", sortBy: "sentAt", limit: CATCH_UP_REACTION_SCAN });
        for (const m of recent) {
          for (const r of DecodedMessage.reactionsOf(m)) if (!out.has(r.id)) out.set(r.id, r);
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
      return this.inner.sendReply(c.reply.reference, undefined, Sdk.encodeText(text));
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
    throw new Error("xmtpSdk: unsupported content shape");
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
    if (!id) throw new Error("xmtpSdk: DM peer unknown");
    return id;
  }

  async addMembers(ids: string[]): Promise<void> { await this.inner.addMembers(ids); }
  async removeMembers(ids: string[]): Promise<void> { await this.inner.removeMembers(ids); }
  async isAdmin(id: string): Promise<boolean> { return this.inner.isAdmin(id); }
  async isSuperAdmin(id: string): Promise<boolean> { return this.inner.isSuperAdmin(id); }
  async isActive(): Promise<boolean> { return (await this.commonState()).isActive; }
  async consentState(): Promise<RnConsent> { return (await this.commonState()).consentState; }
  async updateConsent(state: RnConsent): Promise<void> { await this.inner.updateConsentState(state); }

  /** Push override for this conversation ("default" follows the client's NotificationConfig). */
  async setNotifications(value: "enabled" | "disabled" | "default"): Promise<void> {
    await this.inner.setNotifications(value);
  }

  get isGroup(): boolean { return this.inner.kind === "group"; }

  private async commonState(): Promise<{ isActive: boolean; consentState: RnConsent }> {
    const s = await this.inner.state();
    return s.common ?? s;
  }

  async lastMessage(): Promise<DecodedMessage | undefined> {
    const m = await this.inner.lastMessage();
    return m ? DecodedMessage.fromV8(m) : undefined;
  }
}

/** v5 exported Group/Dm classes; here both are the one wrapper. */
export { Conversation as Group, Conversation as Dm };

class Conversations {
  constructor(private readonly inner: any, private readonly hub: MessageHub) {}

  private wrap = (c: any) => (c ? Conversation.wrap(c, this.hub) : Promise.resolve(undefined));

  async sync(): Promise<void> { await this.inner.sync(); }

  async syncAllConversations(states?: RnConsent[]): Promise<number> {
    await this.inner.syncAll(Array.isArray(states) && states.length ? states : undefined);
    return 0;
  }

  async findGroup(id: string): Promise<Conversation | undefined> {
    const c = await this.inner.getById(id);
    return c?.kind === "group" ? this.wrap(c) : undefined;
  }

  async findConversation(id: string): Promise<Conversation | undefined> {
    return this.wrap(await this.inner.getById(id));
  }

  async findDmByInboxId(inboxId: string): Promise<Conversation | undefined> {
    return this.wrap(await this.inner.getDmByInboxId(inboxId));
  }

  async findOrCreateDm(peerInboxId: string): Promise<Conversation> {
    const existing = await this.inner.getDmByInboxId(peerInboxId);
    return (await this.wrap(existing ?? (await this.inner.createDm(peerInboxId))))!;
  }

  async newGroup(inboxIds: string[], opts?: { permissionLevel?: "all_members" | "admin_only"; name?: string; imageUrl?: string; description?: string }): Promise<Conversation> {
    const g = await this.inner.createGroup(inboxIds, {
      permissions: opts?.permissionLevel === "admin_only" ? { kind: "adminOnly" } : opts?.permissionLevel === "all_members" ? { kind: "allMembers" } : undefined,
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

  async listGroups(_opts?: unknown, limit?: number, states?: RnConsent[]): Promise<Conversation[]> {
    const gs: any[] = await this.inner.listGroups(this.listOpts(limit, states));
    return Promise.all(gs.map((g) => this.wrap(g) as Promise<Conversation>));
  }

  async listDms(_opts?: unknown, limit?: number, states?: RnConsent[]): Promise<Conversation[]> {
    const ds: any[] = await this.inner.listDms(this.listOpts(limit, states));
    return Promise.all(ds.map((d) => this.wrap(d) as Promise<Conversation>));
  }

  async list(): Promise<Conversation[]> {
    const cs: any[] = await this.inner.list();
    return Promise.all(cs.map((c) => this.wrap(c) as Promise<Conversation>));
  }

  /** v5 signature: (callback, type?, consentStates?). No unsubscribe in the v5 API. */
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

/** v5 signer: signMessage(text) resolves `{ signature: 0x<hex> }`. */
export type Signer = {
  getIdentifier: () => Promise<PublicIdentity>;
  getChainId?: () => number | undefined;
  getBlockNumber?: () => number | undefined;
  signerType?: () => "EOA" | "SCW";
  signMessage: (message: string) => Promise<{ signature: string }>;
};

function toV8Signer(signer: Signer) {
  return {
    identity: async () => ({ identifier: (await signer.getIdentifier()).identifier.toLowerCase(), kind: "ethereum" as const }),
    kind: async () => ({ kind: "eoa" as const }),
    sign: async (request: { text: string }) => ({
      kind: "ecdsa" as const,
      value: hexToBytes((await signer.signMessage(request.text)).signature),
    }),
  };
}

/** v5 call sites pass `{ env, dbEncryptionKey, codecs }`; only the key carries over. */
type V5ClientOpts = { dbEncryptionKey?: Uint8Array; [k: string]: unknown };

function clientOptions(opts?: V5ClientOpts) {
  return {
    backend: backendSource(),
    // A fresh database: SDK 8 rejects v5 databases, and the app's v5 files stay untouched.
    storage: { location: "default" as const, encryptionKey: opts?.dbEncryptionKey },
    registration: { nonce: REGISTRATION_NONCE },
  };
}

const _clients = new Map<string, OmClient>();
let _current: OmClient | null = null;

/** The client this JS runtime already has open (one database owner per process — push and
 *  background handlers reuse it instead of opening the database a second time). */
export function currentClient(): OmClient | null {
  return _current;
}

class ClientStatics {
  static async create(signer: Signer, opts?: V5ClientOpts): Promise<OmClient> {
    const identity = await signer.getIdentifier();
    const inner = await Sdk.Client.create(toV8Signer(signer) as any, clientOptions(opts) as any);
    return OmClient.register(inner, identity);
  }

  static async build(identity: PublicIdentity, opts?: V5ClientOpts, inboxId?: string): Promise<OmClient> {
    const inner = await Sdk.Client.build(
      { identifier: identity.identifier.toLowerCase(), kind: "ethereum" } as any,
      clientOptions(opts) as any,
      inboxId || undefined,
    );
    return OmClient.register(inner, identity);
  }

  static async dropClient(installationId: string): Promise<void> {
    const c = _clients.get(installationId);
    _clients.delete(installationId);
    if (_current === c) _current = null;
    await c?.close();
  }

  /** Inbox ID registered for an identity on this backend, or undefined. */
  static async getInboxIdForIdentifier(identity: PublicIdentity): Promise<string | undefined> {
    const id = { identifier: identity.identifier.toLowerCase(), kind: "ethereum" as const };
    const reachable: Map<string, boolean> = await (Sdk.Client as any).canMessage([id], backendSource());
    const registered = [...reachable.values()].some(Boolean);
    return registered ? (Sdk.Client as any).inboxIdFor(id, backendSource()) : undefined;
  }
}

export class OmClient {
  readonly conversations: Conversations;
  private readonly hub: MessageHub;

  private constructor(private readonly inner: any, readonly publicIdentity: PublicIdentity) {
    this.hub = new MessageHub(inner);
    this.conversations = new Conversations(inner.conversations, this.hub);
  }

  static register(inner: any, identity: PublicIdentity): OmClient {
    const c = new OmClient(inner, new PublicIdentity(identity.identifier, identity.kind ?? "ETHEREUM"));
    _clients.set(c.installationId, c);
    _current = c;
    return c;
  }

  get inboxId(): string { return this.inner.inboxId; }
  get installationId(): string { return this.inner.installationId; }

  /** Adds `signer`'s identity to this inbox (v5 addAccount). */
  async addAccount(signer: Signer, allowReassign = false): Promise<void> {
    await this.inner.unsafeAddAccount(toV8Signer(signer), allowReassign);
  }

  /**
   * Registers this installation's FCM token with the backend's [push.fcm] channel. The backend
   * then sends data-only hints ({ topic, sequence_id }) — no content; the app syncs and decrypts.
   * Call again whenever the token changes.
   */
  async enableNotifications(fcmToken: string, consentStates: RnConsent[] = ["allowed", "unknown"]): Promise<{ kind: string; error?: string }> {
    return this.inner.enableNotifications({ channel: { kind: "fcm", token: fcmToken }, consentStates, includeWelcomes: true });
  }

  notificationState(): { kind: string; error?: string } {
    return this.inner.notificationState();
  }

  /** Bounded sync of welcomes + subscribed conversations (the push-hint handler's fetch step). */
  async catchUpToLive(timeoutMs: number): Promise<{ messages: bigint; conversations: bigint; failed: bigint; completed: boolean }> {
    return this.inner.catchUpToLive(BigInt(timeoutMs));
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

  async revokeInstallations(signer: Signer, installationIds: string[]): Promise<void> {
    await this.inner.revokeInstallations(toV8Signer(signer), installationIds);
  }

  async close(): Promise<void> {
    this.hub.close();
    await this.inner.end?.();
  }
}

/** v5 used `Client` both for the statics and the instance type. */
export const Client = ClientStatics;
export type Client = OmClient;

// v5 codec classes were registration tokens; SDK 8 has these content types built in.
export class ReactionCodec {}
export class ReactionV2Codec {}
export class ReplyCodec {}
export class RemoteAttachmentCodec {}
