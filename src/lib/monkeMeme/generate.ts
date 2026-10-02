/**
 * generate — MonkeMeme provider chain.
 *   1. Hugging Face ZeroGPU Space, called from this phone (user's own free
 *      runs; anonymous callers get only a few a day).
 *   2. Workers AI via our Worker (shared free daily allocation, hard-capped).
 * Any Space failure falls through — its /call API hides the error text, so
 * "quota exceeded" and a cold-start hiccup look the same from here.
 */
import { generateOnSpace, generateOnWorker, SpaceError, type SpaceImage } from "./spaceClient";
import type { MonkeMemeConfig } from "./config";

export type MemeProvider = "space" | "worker";

export async function generateMeme(
  cfg: MonkeMemeConfig,
  args: { prompt: string; images: SpaceImage[]; wallet: string | null },
): Promise<{ uri: string; provider: MemeProvider }> {
  let spaceErr: unknown = null;
  try {
    return { uri: await generateOnSpace({ spaceUrl: cfg.spaceUrl, prompt: args.prompt, images: args.images }), provider: "space" };
  } catch (e) {
    spaceErr = e;
  }
  if (!cfg.fallbackUrl || !args.wallet) throw spaceErr;
  try {
    return { uri: await generateOnWorker({ fallbackUrl: cfg.fallbackUrl, prompt: args.prompt, images: args.images, wallet: args.wallet }), provider: "worker" };
  } catch (e) {
    // Report the more useful of the two errors: a quota hit beats a generic failure.
    if (e instanceof SpaceError && e.kind === "quota") throw e;
    throw spaceErr instanceof SpaceError ? spaceErr : e;
  }
}
