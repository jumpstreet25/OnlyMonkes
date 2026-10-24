import { monkeNumberFromImage } from "../lib/monkeMeme/monkeNumbers";
import { stageMembers } from "../lib/roomStage";

describe("monkeNumberFromImage", () => {
  it("reads the number from a profile image URL", () => {
    expect(monkeNumberFromImage("https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE/1760.png")).toBe(1760);
    expect(monkeNumberFromImage("https://arweave.net/2x92sGwXGIDCumAN1vawXd6CitHeqyjuZ1fUWOVmfsY/9048.png?ext=png")).toBe(9048);
    expect(monkeNumberFromImage("https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE/8987.gif")).toBe(8987);
    // wrapped in an image CDN proxy
    expect(monkeNumberFromImage("https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE/1760.png")).toBe(1760);
    expect(monkeNumberFromImage("https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE/1760.pngx")).toBeNull();
  });
  it("rejects the wrong folder, other collections, burned numbers and nothing", () => {
    expect(monkeNumberFromImage("https://arweave.net/2x92sGwXGIDCumAN1vawXd6CitHeqyjuZ1fUWOVmfsY/1760.png")).toBeNull();
    expect(monkeNumberFromImage("https://arweave.net/someOtherCollection/12.png")).toBeNull();
    expect(monkeNumberFromImage("https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE/411.png")).toBeNull();
    expect(monkeNumberFromImage(null)).toBeNull();
  });
});

describe("stageMembers", () => {
  const base = { isLocal: false, audioEnergy: 0.4, mouthTrait: "None" as any, faceParams: null };
  it("sends face numbers only for unmuted members", () => {
    const face = { values: { jawOpen: 0.5 } as any, headRotation: { x: 1, y: 2, z: 3 } };
    const out = stageMembers(
      [
        { ...base, identity: "a", name: "Ann", isSpeaking: true, isMuted: false, blendshapes: face },
        { ...base, identity: "b", name: "Bob", isSpeaking: true, isMuted: true, blendshapes: face },
      ],
      (id) => (id === "a" ? 1760 : null),
    );
    expect(out[0]).toMatchObject({ id: "a", n: 1760, name: "Ann", muted: false, speaking: true, energy: 0.4, face });
    expect(out[1]).toMatchObject({ id: "b", n: null, muted: true, speaking: false, energy: 0 });
    expect(out[1].face).toBeUndefined();
  });
});
