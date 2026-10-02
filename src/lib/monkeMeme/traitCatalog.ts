/**
 * traitCatalog — every Saga Monkes trait value (from MonkeLedger /export,
 * 9,999 live assets, 2026-10-01) with a plain-English visual description
 * for the MonkeMeme image prompt. Descriptions were written from the actual
 * pixel art, so "Horns" says "red devil horns", not just "horns".
 *
 * Background (always "Saga") and the 100-asset "Wave" edition trait are
 * left out: neither changes how the monke looks in a cartoon redraw.
 */

export type TraitCategory = "Fur" | "Head" | "Eyes" | "Mouth" | "Clothing";

export const TRAIT_CATEGORIES: TraitCategory[] = ["Fur", "Head", "Eyes", "Mouth", "Clothing"];

/** "None" maps to "" — nothing worn in that slot. Fur has no "None". */
export const TRAIT_CATALOG: Record<TraitCategory, Record<string, string>> = {
  Fur: {
    Mocha: "warm mocha-brown fur",
    Dark: "dark slate-gray fur",
    Mahogany_: "deep mahogany-brown fur",
    "Cherry Blossom": "soft cherry-blossom pink fur",
    AutonoMonke: "silver-gray robotic fur with darker metal panels",
    Zombie: "sickly green-gray zombie fur",
    "Gold Idol": "shiny solid-gold fur like a golden idol",
    Solana: "fur in a Solana gradient from mint green to purple",
  },
  Head: {
    None: "",
    Rufio: "a spiky maroon mohawk tuft",
    "Trainer Cap": "a red and white trainer baseball cap",
    Headphones: "mint-white over-ear headphones",
    SquatchBeats: "chunky black over-ear headphones",
    "Mullet Gang": "a big hot-pink mullet haircut",
    Halo: "a glowing golden halo floating above the head",
    Horns: "red devil horns",
    "Solana Punk": "a spiked punk mohawk in Solana purple, blue and mint",
    Augmint: "silver cybernetic plating on top of the head",
    Crown: "a small gold crown",
    ToxiHawk: "a tall hot-pink mohawk",
  },
  Eyes: {
    Open: "",
    Wayfarers: "black wayfarer sunglasses",
    "Drywall Missiles": "a rainbow gradient visor across the eyes",
    Glare: "narrow squinting glaring eyes",
    SolShades: "purple and teal Solana shutter shades",
    Demon: "glowing red demon eyes",
    "Saylor Lasers": "glowing orange laser eyes",
    Overclocked: "glowing lime-green overclocked eyes",
    Terminal: "a glowing holographic lavender and mint visor",
    "Daemon Trader": "a single solid glowing red visor bar across the eyes",
  },
  Mouth: {
    None: "",
    Beaming: "a huge beaming toothy grin",
    OwO: "a tiny cute pink OwO mouth",
    Doobie: "a rolled doobie hanging from the lip with a curl of smoke",
  },
  Clothing: {
    None: "",
    Hoodiegate: "a bright orange hoodie",
    "Beige Cardigan": "a cozy beige cardigan",
    "Solana Pullover": "a purple pullover with a Solana stripe",
    "Band Hoodie": "a black band hoodie with a yellow print",
    "IP Deal": "a white tee with a small green logo",
    "Denim Jacket": "a blue denim jacket over a white tee",
    "Graphic Tee": "a black graphic tee with a pink print",
    "Bomber Jacket": "an olive green bomber jacket",
    "Event Fleece": "a purple event fleece",
    "Air Monke": "a red sports jersey",
    HazMonke: "a neon green hazmat suit",
    Cypherpunk: "a yellow cypherpunk jacket with teal trim",
    "AI Agent": "a black agent suit with a white shirt",
    "Gold Chain": "a thick gold chain necklace",
  },
};

export type TraitSelection = Partial<Record<TraitCategory, string>>;

/** Pick the trait values the catalog knows from an NFT's raw trait list. */
export function selectionFromTraits(traits: { trait_type: string; value: string }[] | undefined): TraitSelection {
  const sel: TraitSelection = {};
  for (const t of traits ?? []) {
    const cat = t.trait_type as TraitCategory;
    if (TRAIT_CATEGORIES.includes(cat) && t.value in TRAIT_CATALOG[cat]) sel[cat] = t.value;
  }
  return sel;
}

/** "dark slate-gray fur, red devil horns, a thick gold chain necklace" */
export function describeSelection(sel: TraitSelection): string {
  return TRAIT_CATEGORIES
    .map((cat) => {
      const v = sel[cat];
      return v ? TRAIT_CATALOG[cat][v] ?? "" : "";
    })
    .filter(Boolean)
    .join(", ");
}

/** Strip the trailing "_" some on-chain values carry (e.g. "Mahogany_"). */
export function traitLabel(value: string): string {
  return value.replace(/_+$/, "");
}
