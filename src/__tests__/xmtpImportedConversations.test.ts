jest.mock("@xmtp/react-native-sdk", () => ({ encodeText: (t: string) => t }));
jest.mock("@/lib/xmtpCredential", () => ({ getXmtpCredential: async () => ({ value: "", expiresAtSeconds: 0n }) }));

import { OmClient, PublicIdentity } from "@/lib/xmtpSdk";

const conv = (id: string, kind: "dm" | "group", active: boolean, peer?: string) => ({
  id, kind,
  state: async () => (kind === "group" ? { common: { isActive: active, consentState: "allowed" }, name: id, permissions: {} } : { isActive: active, consentState: "allowed" }),
  peerInboxId: async () => peer,
});

function client(convs: any[], created?: any) {
  const inner = {
    inboxId: "me", installationId: "inst",
    conversations: {
      list: async (o?: any) => convs,
      listDms: async () => convs.filter((c) => c.kind === "dm"),
      listGroups: async () => convs.filter((c) => c.kind === "group"),
      // Like the SDK after an import, the first match may be the read-only copy.
      getDmByInboxId: async (peer: string) => convs.find((c) => c.kind === "dm" && c.peer === peer),
      createDm: jest.fn(async () => created),
    },
  };
  convs.forEach((c) => { c.peer = undefined; });
  return { c: OmClient.register(inner, new PublicIdentity("0xabc", "ETHEREUM")), inner };
}

describe("imported (read-only) conversations", () => {
  it("lists hide them; listImported returns only them", async () => {
    const convs = [conv("g-old", "group", false), conv("g-new", "group", true), conv("d-old", "dm", false, "p"), conv("d-new", "dm", true, "p")];
    const { c } = client(convs);
    expect((await c.conversations.listGroups()).map((x) => x.id)).toEqual(["g-new"]);
    expect((await c.conversations.listDms()).map((x) => x.id)).toEqual(["d-new"]);
    expect((await c.conversations.list()).map((x) => x.id)).toEqual(["g-new", "d-new"]);
    expect((await c.conversations.listImported()).map((x) => x.id).sort()).toEqual(["d-old", "g-old"]);
  });

  it("DM lookup skips the imported copy and finds the active DM with the same peer", async () => {
    const old = { ...conv("d-old", "dm", false, "p") }; const fresh = { ...conv("d-new", "dm", true, "p") };
    const { c, inner } = client([old, fresh]);
    (old as any).peer = "p"; (fresh as any).peer = "p";
    expect((await c.conversations.findDmByInboxId("p"))?.id).toBe("d-new");
    expect((await c.conversations.findOrCreateDm("p")).id).toBe("d-new");
    expect(inner.conversations.createDm).not.toHaveBeenCalled();
  });

  it("only an imported DM → creates a new one; refuses if the SDK hands back the read-only one", async () => {
    const old = conv("d-old", "dm", false, "p");
    const made = conv("d-made", "dm", true, "p");
    const a = client([old], made); (old as any).peer = "p";
    expect((await a.c.conversations.findDmByInboxId("p"))).toBeUndefined();
    expect((await a.c.conversations.findOrCreateDm("p")).id).toBe("d-made");
    const b = client([old], old); (old as any).peer = "p";
    await expect(b.c.conversations.findOrCreateDm("p")).rejects.toThrow(/read-only/);
  });
});
