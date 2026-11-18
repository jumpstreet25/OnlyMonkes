jest.mock("expo-application", () => ({ applicationId: "com.onlymonkes.app.next" }));
jest.mock("@xmtp/react-native-sdk", () => ({ encodeText: (t: string) => t, Timestamp: class { ns: bigint; constructor(ns: bigint) { this.ns = ns; } } }));
jest.mock("@/lib/xmtpCredential", () => ({ getXmtpCredential: async () => ({ value: "", expiresAtSeconds: 0n }) }));

import { OmClient, PublicIdentity } from "@/lib/xmtpSdk";

// SDK 8.0.0-rc5 refuses a limit outside 1..1000 and returns 100 rows when none is given.
const capped = <T,>(rows: T[], o: any): T[] => {
  if (o?.limit != null && (o.limit < 1 || o.limit > 1000)) throw new Error("limit must be at least 1 and at most the maximum page size");
  return rows.slice(0, o?.limit ?? 100);
};

describe("rc5 page caps", () => {
  it("lists every DM, not just the first 100", async () => {
    const dms = Array.from({ length: 2300 }, (_, i) => ({ id: `d${i}`, kind: "dm", createdAt: { ns: BigInt(1e6 - i) }, state: async () => ({ isActive: true, consentState: "allowed" }) }));
    const inner = { inboxId: "me", installationId: "inst", conversations: {
      listDms: async (o: any) => {
        const start = o?.beforeId ? dms.findIndex((d) => d.id === o.beforeId) + 1 : 0;
        return capped(dms.slice(start), o);
      },
    } };
    const c = OmClient.register(inner, new PublicIdentity("0xabc", "ETHEREUM"));
    const ids = (await c.conversations.listDms()).map((x) => x.id);
    expect(ids.length).toBe(2300);
    expect(new Set(ids).size).toBe(2300);
    expect((await c.conversations.listDms(undefined, 50)).length).toBe(50);
  });

  it("reads a long history window in pages", async () => {
    const msgs = Array.from({ length: 1800 }, (_, i) => ({ id: `m${i}`, senderInboxId: "x", sentAt: { ns: BigInt(5000 + i) }, content: { kind: "text", value: `t${i}` } }));
    const group = { id: "g", kind: "group", state: async () => ({ common: { isActive: true, consentState: "allowed" }, name: "g", permissions: {} }),
      sync: async () => {},
      messages: async (o: any) => {
        const a = o.sentAfter ? BigInt(o.sentAfter.ns) : -1n, b = o.sentBefore ? BigInt(o.sentBefore.ns) : 1n << 62n;
        let r = msgs.filter((m) => m.sentAt.ns > a && m.sentAt.ns < b);
        if (o.direction === "descending") r = r.slice().reverse();
        return capped(r, o);
      } };
    const inner = { inboxId: "me", installationId: "inst", conversations: { listGroups: async (o: any) => capped([group], o), getConversationById: async () => group } };
    const c = OmClient.register(inner, new PublicIdentity("0xabc", "ETHEREUM"));
    const [g] = await c.conversations.listGroups();
    const all = await g.messages({ afterNs: 4000 });
    expect(all.length).toBe(1800);
    expect((await g.messages({ limit: 0 })).length).toBe(0);
    expect((await g.messages({ limit: 1200 })).length).toBe(1200);
  });
});
