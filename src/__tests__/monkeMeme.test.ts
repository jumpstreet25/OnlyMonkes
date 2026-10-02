import {
  TRAIT_CATALOG,
  TRAIT_CATEGORIES,
  describeSelection,
  selectionFromTraits,
  traitLabel,
} from "../lib/monkeMeme/traitCatalog";
import { buildMemePrompt, checkCaption, checkScene, SCENE_MAX_CHARS } from "../lib/monkeMeme/prompt";
import { parseSseResult, SpaceError } from "../lib/monkeMeme/spaceClient";
import { DEFAULT_MONKEMEME_CONFIG, monkeMemeVisible, parseMonkeMemeConfig } from "../lib/monkeMeme/config";

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

describe("monkeMemeVisible (dark launch)", () => {
  it("is admin-only by default, so a failed config fetch stays hidden", () => {
    expect(DEFAULT_MONKEMEME_CONFIG.testersOnly).toBe(true);
    expect(monkeMemeVisible(DEFAULT_MONKEMEME_CONFIG, false)).toBe(false);
    expect(monkeMemeVisible(DEFAULT_MONKEMEME_CONFIG, true)).toBe(true);
    expect(monkeMemeVisible(null, true)).toBe(false);
  });
  it("opens to everyone once testersOnly is false, and the kill switch beats both", () => {
    expect(monkeMemeVisible(parseMonkeMemeConfig({ testersOnly: false }), false)).toBe(true);
    expect(monkeMemeVisible(parseMonkeMemeConfig({ enabled: false, testersOnly: false }), true)).toBe(false);
  });
});

describe("monkeNumbers", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { monkeImageForNumber, isWave2, parseMonkeNumber } = require("../lib/monkeMeme/monkeNumbers");
  it("resolves both arweave folders, the animated Wave 2 GIFs and rejects burned numbers", () => {
    expect(monkeImageForNumber(1760)).toBe("https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE/1760.png");
    expect(monkeImageForNumber(9048)).toBe("https://arweave.net/2x92sGwXGIDCumAN1vawXd6CitHeqyjuZ1fUWOVmfsY/9048.png");
    expect(monkeImageForNumber(8987)).toBe("https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE/8987.gif");
    expect(monkeImageForNumber(411)).toBeNull();
    expect(monkeImageForNumber(0)).toBeNull();
    expect(monkeImageForNumber(10015)).toBeNull();
  });
  it("flags Wave 2 and parses names", () => {
    expect(isWave2(8930)).toBe(true);
    expect(isWave2(8888)).toBe(false);
    expect(parseMonkeNumber("MONKE #8930")).toBe(8930);
    expect(parseMonkeNumber("8930")).toBe(8930);
    expect(parseMonkeNumber("MONKE #411")).toBeNull();
    expect(parseMonkeNumber("not a monke")).toBeNull();
  });
});

describe("prompt for 1/1s", () => {
  it("falls back to the art when there are no catalog traits", () => {
    const p = buildMemePrompt({ traits: {}, scene: "stoned on a beach", hasStyleRef: true });
    expect(p).toContain("Keep the monkey's exact look from image 1");
    expect(p).not.toContain("Its look, even where");
  });
});

describe("trait table + Wave 2 descriptions", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { traitsForNumber, wave2Description } = require("../lib/monkeMeme/monkeNumbers");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WAVE2_DESCRIPTIONS } = require("../lib/monkeMeme/wave2Descriptions");

  it("decodes a standard monke's traits from the packed table", () => {
    expect(traitsForNumber(1760)).toEqual({ Fur: "Dark", Head: "Horns", Eyes: "Open", Mouth: "None", Clothing: "Gold Chain" });
    expect(traitsForNumber(1308)).toEqual({ Fur: "Cherry Blossom", Head: "Trainer Cap", Eyes: "Glare", Mouth: "None", Clothing: "Band Hoodie" });
  });

  it("has no traits for Wave 2 and burned numbers", () => {
    expect(traitsForNumber(8930)).toEqual({});
    expect(traitsForNumber(411)).toEqual({});
  });

  it("describes every Wave 2 1/1", () => {
    for (let n = 8889; n <= 8988; n++) expect(WAVE2_DESCRIPTIONS[n]?.length).toBeGreaterThan(10);
    expect(wave2Description(8982)).toContain("cyborg");
    expect(wave2Description(1760)).toBeNull();
  });

  it("puts the description in the prompt and keeps the house style colour-neutral", () => {
    const p = buildMemePrompt({ traits: {}, scene: "at 3am", hasStyleRef: false, description: wave2Description(8982) });
    expect(p).toContain("It is a cyborg monkey");
    expect(p).toContain("Keep its exact colors from image 1");
    expect(p).not.toContain("pink lips");
  });
});
