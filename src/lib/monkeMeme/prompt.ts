/**
 * prompt — turns a monke's traits + the user's short scene into the
 * FLUX.2 klein prompt, and screens the scene before anything leaves the
 * phone. The model has no safety filter of its own, so this list is the
 * only gate between a public text box and a Saga Monkes-branded image.
 */
import { describeSelection, type TraitSelection } from "./traitCatalog";

export const SCENE_MAX_CHARS = 140;
export const CAPTION_MAX_CHARS = 60;

/** Our house style. Kept in words as well as the reference image so the
 *  look holds even when the style reference can't be attached. Deliberately
 *  colour-neutral ("glossy lips", not "pink lips"): forcing pink lips and a
 *  peach face painted over monkes like the #8982 cyborg's metal face plate. */
export const MONKEMEME_STYLE =
  "hand-drawn cartoon in a bold sticker style: very thick black outlines, flat cel shading with one soft highlight, " +
  "oversized rounded head, droopy half-closed eyelids, huge glossy lips in a smug grin, spiral-shaped ear";

export interface PromptInput {
  traits: TraitSelection;
  scene: string;
  /** True when a style reference image is attached as image 2. */
  hasStyleRef: boolean;
  /** Hand-written look of a 1/1 (Wave 2). Takes precedence over traits. */
  description?: string | null;
}

export function buildMemePrompt({ traits, scene, hasStyleRef, description }: PromptInput): string {
  const sceneLine = scene.trim() ? ` Scene: ${scene.trim()}.` : "";
  const tail = `${sceneLine} No text, letters or words anywhere in the image.`;
  // 1/1s: never paired with the style reference (the model copies the plain
  // ref monke instead of image 1), so the style rides in words only.
  if (description) {
    return `Redraw the pixel-art character in image 1 as a ${MONKEMEME_STYLE}. Keep its exact colors from image 1. It is ${description}.${tail}`;
  }
  const look = describeSelection(traits);
  const intro = hasStyleRef
    ? `Redraw the pixel-art monkey from image 1 as a cartoon character in the exact art style of image 2 (${MONKEMEME_STYLE}).`
    : `Redraw the pixel-art monkey from image 1 as a ${MONKEMEME_STYLE}.`;
  const lookLine = look
    ? ` Keep its colors from image 1. Its look, even where image 1 differs: ${look}.`
    : " Keep the monkey's exact look from image 1: its colors, theme, outfit and accessories.";
  return `${intro}${lookLine}${tail}`;
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
