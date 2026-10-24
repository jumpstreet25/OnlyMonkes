/**
 * Web Main Chat history. A browser joins the MLS group as a new installation
 * and can't decrypt anything sent before it was added, so Main Chat opened
 * empty. The bot (a member) serves the newest content messages through the
 * actions worker (/api/chat/history, Saga Monke holders only); they go through
 * the same decoder as live messages and merge into the store by ID.
 */
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
import { decodeMessage } from "@/lib/xmtp";
import { cacheProfile } from "@/lib/userProfile";
import { getXmtpCredential } from "./webAuth";
import type { ChatMessage } from "@/types";

const WORKER = "https://onlymonkes.app";
const HEX64 = /^[0-9a-f]{64}$/;
const ARWEAVE_IMAGE = /^https:\/\/([a-z0-9-]+\.)*arweave\.net\//;

type HistoryItem = { id: string; senderInboxId: string; sentNs: string; content: string };

let _loaded = false;
let _loading: Promise<void> | null = null;

export function loadWebHistory(): Promise<void> {
  if (_loaded) return Promise.resolve();
  if (_loading) return _loading;
  _loading = (async () => {
    const myInboxId = useAppStore.getState().myInboxId;
    if (!myInboxId) return;
    const { value } = await getXmtpCredential();
    const res = await fetch(`${WORKER}/api/chat/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: value },
      body: "{}",
    });
    if (!res.ok) return;
    const body = (await res.json()) as { messages?: unknown; profiles?: unknown };
    const profiles = (body.profiles && typeof body.profiles === "object" ? body.profiles : {}) as Record<string, { u?: unknown; ni?: unknown }>;
    for (const [id, p] of Object.entries(profiles)) {
      if (!HEX64.test(id) || !p || typeof p !== "object") continue;
      cacheProfile(id, {
        username: typeof p.u === "string" && p.u ? p.u.slice(0, 20) : undefined,
        nftImage: typeof p.ni === "string" && ARWEAVE_IMAGE.test(p.ni) ? p.ni : undefined,
      });
    }
    const items = (Array.isArray(body.messages) ? body.messages : []).filter((m): m is HistoryItem =>
      !!m && typeof m === "object" &&
      typeof (m as HistoryItem).id === "string" && (m as HistoryItem).id.length <= 128 &&
      typeof (m as HistoryItem).senderInboxId === "string" && HEX64.test((m as HistoryItem).senderInboxId) &&
      typeof (m as HistoryItem).sentNs === "string" && /^\d{1,20}$/.test((m as HistoryItem).sentNs) &&
      typeof (m as HistoryItem).content === "string");
    const decoded: ChatMessage[] = [];
    for (const m of items) {
      const d = decodeMessage(
        { id: m.id, senderInboxId: m.senderInboxId, sentNs: Number(m.sentNs), content: () => m.content },
        myInboxId,
      );
      if (d) decoded.push(d);
    }
    // One sorted write. mergeMessage puts every new message at the front (it
    // assumes live, newest), which showed the oldest history as the latest
    // message and re-rendered the list once per message.
    const { messages, _msgIdSet, setMessages } = useChatStore.getState();
    const fresh = decoded.filter((d) => !_msgIdSet.has(d.id));
    if (fresh.length) {
      const merged = [...messages, ...fresh].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()).slice(0, 300);
      setMessages(merged);
    }
    _loaded = true;
  })()
    .catch(() => { /* try again on the next chat mount */ })
    .finally(() => { _loading = null; });
  return _loading;
}
