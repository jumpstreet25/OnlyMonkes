import {
  TRAIT_CATALOG,
  TRAIT_CATEGORIES,
  describeSelection,
  selectionFromTraits,
  traitLabel,
} from "../lib/monkeMeme/traitCatalog";
import { buildMemePrompt, checkCaption, checkScene, SCENE_MAX_CHARS } from "../lib/monkeMeme/prompt";
import { parseSseResult, SpaceError } from "../lib/monkeMeme/spaceClient";
import { DEFAULT_MONKEMEME_CONFIG, parseMonkeMemeConfig } from "../lib/monkeMeme/config";

// MONKE #1760 straight from MonkeLedger /metadata.
const M1760 = [
  { value: "Saga", trait_type: "Background" },
  { value: "Dark", trait_type: "Fur" },
  { value: "Gold Chain", trait_type: "Clothing" },
  { value: "None", trait_type: "Mouth" },
  { value: "Horns", trait_type: "Head" },
  { value: "Open", trait_type: "Eyes" },
];

describe("traitCatalog", () => {
  it("maps on-chain traits and skips empty slots in the description", () => {
    const sel = selectionFromTraits(M1760);
    expect(sel).toEqual({ Fur: "Dark", Clothing: "Gold Chain", Mouth: "None", Head: "Horns", Eyes: "Open" });
    expect(describeSelection(sel)).toBe("dark slate-gray fur, red devil horns, a thick gold chain necklace");
  });

  it("ignores unknown trait types and values", () => {
    expect(selectionFromTraits([{ trait_type: "Wave", value: "02" }, { trait_type: "Fur", value: "Plaid" }])).toEqual({});
  });

  it("covers every category and gives every non-empty value a description", () => {
    expect(TRAIT_CATEGORIES).toHaveLength(5);
    for (const cat of TRAIT_CATEGORIES) {
      for (const [value, desc] of Object.entries(TRAIT_CATALOG[cat])) {
        if (value === "None" || value === "Open") expect(desc).toBe("");
        else expect(desc.length).toBeGreaterThan(5);
      }
    }
  });

  it("strips trailing underscores from labels", () => {
    expect(traitLabel("Mahogany_")).toBe("Mahogany");
  });
});

describe("prompt", () => {
  it("references the style image only when one is attached", () => {
    const traits = selectionFromTraits(M1760);
    const withRef = buildMemePrompt({ traits, scene: "buying the dip", hasStyleRef: true });
    expect(withRef).toContain("art style of image 2");
    expect(withRef).toContain("red devil horns");
    expect(withRef).toContain("Scene: buying the dip.");
    expect(buildMemePrompt({ traits, scene: "x", hasStyleRef: false })).not.toContain("image 2");
  });

  it("accepts normal scenes and crypto slang", () => {
    expect(checkScene("  staring at a green candle at 3am ")).toEqual({ ok: true, scene: "staring at a green candle at 3am" });
    expect(checkScene("killing it on the chart").ok).toBe(true);
  });

  it("rejects empty, over-long and blocked scenes", () => {
    expect(checkScene("   ")).toEqual({ ok: false, reason: "empty" });
    expect(checkScene("a".repeat(SCENE_MAX_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
    expect(checkScene("monke posing naked")).toEqual({ ok: false, reason: "blocked" });
    expect(checkScene("free AIRDROP for holders")).toEqual({ ok: false, reason: "blocked" });
    expect(checkScene("n.a.k.e.d monke")).toEqual({ ok: false, reason: "blocked" }); // dotted evasion
  });

  it("strips links and handles before checking", () => {
    expect(checkScene("visit https://evil.example @someone")).toEqual({ ok: true, scene: "visit" });
  });

  it("allows an empty caption but blocks bad ones", () => {
    expect(checkCaption("")).toEqual({ ok: true, scene: "" });
    expect(checkCaption("WAGMI")).toEqual({ ok: true, scene: "WAGMI" });
    expect(checkCaption("nsfw").ok).toBe(false);
  });
});

describe("parseSseResult", () => {
  it("returns the image url from a complete event", () => {
    const body = 'event: complete\ndata: [{"path": "/tmp/x.webp", "url": "https://space.hf.space/gradio_api/file=/tmp/x.webp"}, 123]\n\n';
    expect(parseSseResult(body)).toEqual({ url: "https://space.hf.space/gradio_api/file=/tmp/x.webp" });
  });

  it("maps a quota error and a null error", () => {
    expect(() => parseSseResult('event: error\ndata: "You have exceeded your ZeroGPU quota"\n')).toThrow(SpaceError);
    try {
      parseSseResult('event: error\ndata: "You have exceeded your ZeroGPU quota"\n');
    } catch (e) {
      expect((e as SpaceError).kind).toBe("quota");
    }
    try {
      parseSseResult("event: error\ndata: null\n");
    } catch (e) {
      expect((e as SpaceError).kind).toBe("failed");
    }
  });

  it("treats a stream with no terminal event as busy", () => {
    try {
      parseSseResult("event: heartbeat\ndata: null\n");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SpaceError).kind).toBe("busy");
    }
  });
});

describe("parseMonkeMemeConfig", () => {
  it("falls back to defaults on garbage", () => {
    expect(parseMonkeMemeConfig(null)).toEqual(DEFAULT_MONKEMEME_CONFIG);
    expect(parseMonkeMemeConfig({ spaceUrl: "http://insecure", dailyLimit: -1 })).toEqual(DEFAULT_MONKEMEME_CONFIG);
  });

  it("honours the kill switch, a new Space and an empty fallback", () => {
    const cfg = parseMonkeMemeConfig({ enabled: false, spaceUrl: "https://me-monkememe.hf.space/", fallbackUrl: "", dailyLimit: 3 });
    expect(cfg.enabled).toBe(false);
    expect(cfg.spaceUrl).toBe("https://me-monkememe.hf.space");
    expect(cfg.fallbackUrl).toBe("");
    expect(cfg.dailyLimit).toBe(3);
  });
});
