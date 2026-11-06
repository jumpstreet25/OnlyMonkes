/**
 * prompt — turns a monke's traits + the user's short scene into the
 * FLUX.2 klein prompt, and screens the scene before anything leaves the
 * phone. The model has no safety filter of its own, so this list is the
 * only gate between a public text box and a Saga Monkes-branded image.
 */
import { describeSelection, type TraitSelection } from "./traitCatalog";

export const SCENE_MAX_CHARS = 140;
export const CAPTION_MAX_CHARS = 60;

/** House style: the holder's own Monke3D figure (public/viewer/snap.html
 *  renders it as image 1), kept as a 3D toy. Colour-neutral on purpose —
 *  the colours come from image 1, never from words (a green scene used to
 *  turn the fur green). */
export const MONKEMEME_STYLE =
  "a glossy 3D voxel toy figure, rendered like a still from a 3D animated film with soft lighting and depth";

export interface PromptInput {
  traits: TraitSelection;
  scene: string;
  /** Hand-written look of a 1/1 (Wave 2). Takes precedence over traits. */
  description?: string | null;
}

export function buildMemePrompt({ traits, scene, description }: PromptInput): string {
  const sceneLine = scene.trim() ? ` Scene: ${scene.trim()}.` : "";
  const look = description ? ` It is ${description}.` : describeSelection(traits) ? ` Its look: ${describeSelection(traits)}.` : "";
  return (
    "Image 1 shows a 3D monkey figure built from cubes, like a voxel toy. Keep this exact character from image 1 as the main subject: " +
    "the same blocky cube-built head and body, the same eyes, face mask shape and ears, its outfit and accessories, " +
    `and exactly the same colors as image 1, whatever the lighting.${look} It stays ${MONKEMEME_STYLE}, and it can move and act in the scene.` +
    `${sceneLine} No text, letters or words anywhere in the image.`
  );
}

// Whole-word matches only, so "assistant" or "Scunthorpe"-style words pass.
const BLOCKED = [
  // sexual / nudity
  "porn", "porno", "nude", "nudes", "naked", "nsfw", "sex", "sexy", "sexual", "hentai", "boobs", "tits", "penis",
  "vagina", "dick", "cock", "pussy", "fetish", "onlyfans", "erotic", "xxx",
  // minors
  "child", "children", "kid", "kids", "minor", "minors", "loli", "underage", "teen", "teens",
  // gore / violence / self-harm
  // ("kill", "shooting", "bomb" left out on purpose: "killing it", "shooting
  // star" and "the bomb" are everyday crypto slang.)
  "gore", "blood", "bloody", "behead", "beheading", "decapitate", "suicide", "selfharm", "murder", "shooter",
  "massacre", "terrorist", "terrorism", "isis",
  // hate
  "nazi", "nazis", "hitler", "swastika", "kkk", "slur", "nigger", "nigga", "faggot", "retard", "tranny",
  // scams / impersonation bait
  "airdrop", "giveaway", "seed", "seedphrase", "privatekey", "drainer",
];
const BLOCKED_RE = new RegExp(`\\b(${BLOCKED.join("|")})\\b`, "i");

export type SceneCheck = { ok: true; scene: string } | { ok: false; reason: "empty" | "too_long" | "blocked" };

/** Trims, removes links/@handles, enforces the length cap and the blocklist. */
export function checkScene(raw: string): SceneCheck {
  const scene = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@\w+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!scene) return { ok: false, reason: "empty" };
  if (scene.length > SCENE_MAX_CHARS) return { ok: false, reason: "too_long" };
  const squashed = scene.toLowerCase().replace(/[^a-z\s]/g, "");
  if (BLOCKED_RE.test(scene) || BLOCKED_RE.test(squashed)) return { ok: false, reason: "blocked" };
  return { ok: true, scene };
}

/** Same blocklist for the optional caption overlay; empty is fine here. */
export function checkCaption(raw: string): SceneCheck {
  const caption = raw.replace(/\s+/g, " ").trim().slice(0, CAPTION_MAX_CHARS);
  if (!caption) return { ok: true, scene: "" };
  return BLOCKED_RE.test(caption) ? { ok: false, reason: "blocked" } : { ok: true, scene: caption };
}

export const SCENE_PRESETS = [
  "staring at a green candle at 3am",
  "buying the dip with shaking hands",
  "getting rugged, coffee spilling everywhere",
  "watching the chart go parabolic, sunglasses on",
  "sitting in a burning room saying this is fine",
  "holding a Solana Saga phone like a trophy",
];
