/**
 * build-saga-monkes-index.ts — One-time (re-runnable) build of a static
 * mint/assetId → {name, image} index for the entire Saga Monkes collection.
 *
 * Why this exists: the app's on-chain NFT-ownership fallback
 * (src/lib/onchainCnftVerify.ts) can prove a wallet holds a compressed NFT
 * with zero dependency on Helius/QuickNode/Alchemy, but has no way to
 * resolve that NFT's image/name — compressed NFT metadata isn't readable
 * from the Merkle tree account directly. Previously, hitting this path with
 * every DAS provider down meant the user got dropped into a manual "upload
 * any photo" picker with no verification it's their real Monke.
 *
 * Since Saga Monkes is a small, fixed collection (confirmed 10,014 assets,
 * single tree, no new mints — see onchainCnftVerify.ts's tree-completeness
 * note), the fix is to pre-build the mint→image mapping ONCE while a DAS
 * provider is healthy, host it as a static file, and cross-reference it
 * against the (indexer-free) on-chain ownership check at verify time. Only
 * a wallet whose Monke was acquired after this index was last refreshed
 * would still need the manual-upload fallback.
 *
 * Run: bun scripts/build-saga-monkes-index.ts
 * Output: config/saga-monkes-index.json — commit this to the repo; the app
 *   reads it from raw.githubusercontent.com (same hosting pattern as
 *   config/app-config.json, see src/lib/remoteConfig.ts).
 *
 * Requires one of HELIUS_API_KEY / QUICKNODE_DAS_URL / ALCHEMY_API_KEY in
 * .env — tries each in turn since this is a bulk read best done against
 * whichever provider currently has quota.
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const SAGA_COLLECTION_MINT = "GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF";
const OUTPUT_PATH = path.join(__dirname, "..", "config", "saga-monkes-index.json");
const PAGE_LIMIT = 1000;
const MAX_PAGES = 20; // 20 * 1000 = 20,000 assets, well above the known 10,014

interface IndexEntry {
  name: string;
  image: string | null;
}

interface DASAssetItem {
  id: string;
  content?: {
    metadata?: { name?: string };
    links?: { image?: string };
    files?: { uri?: string; cdn_uri?: string; mime?: string }[];
  };
}

function resolveProviderUrls(): { label: string; url: string }[] {
  const heliusKey = process.env.HELIUS_API_KEY;
  const quickNodeUrl = process.env.QUICKNODE_DAS_URL;
  const alchemyKey = process.env.ALCHEMY_API_KEY;

  const providers: { label: string; url: string }[] = [];
  if (heliusKey) providers.push({ label: "Helius", url: `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` });
  if (quickNodeUrl) providers.push({ label: "QuickNode", url: quickNodeUrl });
  if (alchemyKey) providers.push({ label: "Alchemy", url: `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}` });

  if (providers.length === 0) {
    throw new Error("No HELIUS_API_KEY, QUICKNODE_DAS_URL, or ALCHEMY_API_KEY found in .env");
  }
  return providers;
}

// Helius/QuickNode both speak the same DAS shape: named object params,
// cursor-based pagination (confirmed working in worker-actions'
// fetchMonkeHolderCount). Alchemy diverges — positional array params,
// page-number pagination, no cursor support (see fetchAssetsViaAlchemy in
// src/lib/nftVerification.ts for the same divergence on getAssetsByOwner;
// do not "fix" this back to a named object, it silently 400s/no-ops).
async function fetchPage(
  label: string,
  url: string,
  pageState: { cursor?: string; pageNum: number },
): Promise<{ items: DASAssetItem[]; hasMore: boolean }> {
  const body = label === "Alchemy"
    ? {
        jsonrpc: "2.0",
        id: "build-index",
        method: "getAssetsByGroup",
        params: ["collection", SAGA_COLLECTION_MINT, pageState.pageNum, PAGE_LIMIT, null, null],
      }
    : {
        jsonrpc: "2.0",
        id: "build-index",
        method: "getAssetsByGroup",
        params: {
          groupKey: "collection",
          groupValue: SAGA_COLLECTION_MINT,
          limit: PAGE_LIMIT,
          ...(pageState.cursor ? { cursor: pageState.cursor } : {}),
        },
      };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DAS HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json() as any;
  if (json?.error) throw new Error(`DAS RPC error: ${JSON.stringify(json.error)}`);

  const items: DASAssetItem[] = json?.result?.items ?? [];
  if (label === "Alchemy") {
    pageState.pageNum++;
    return { items, hasMore: items.length === PAGE_LIMIT };
  }
  const nextCursor = json?.result?.cursor;
  pageState.cursor = nextCursor;
  return { items, hasMore: !!nextCursor && items.length > 0 };
}

async function buildWithProvider(label: string, url: string): Promise<Record<string, IndexEntry>> {
  console.log(`[build-index] Trying ${label} DAS endpoint`);
  const index: Record<string, IndexEntry> = {};
  const pageState = { cursor: undefined as string | undefined, pageNum: 1 };
  let page = 0;

  while (page < MAX_PAGES) {
    const { items, hasMore } = await fetchPage(label, url, pageState);
    for (const item of items) {
      const image =
        item.content?.links?.image ??
        item.content?.files?.find((f) => f.mime?.startsWith("image/"))?.cdn_uri ??
        item.content?.files?.find((f) => f.mime?.startsWith("image/"))?.uri ??
        null;
      index[item.id] = {
        name: item.content?.metadata?.name ?? "Saga Monke",
        image,
      };
    }
    page++;
    console.log(`[build-index] [${label}] page ${page}: +${items.length} assets (total ${Object.keys(index).length})`);
    if (!hasMore) break;
  }
  return index;
}

async function main() {
  const providers = resolveProviderUrls();
  let index: Record<string, IndexEntry> = {};
  let lastErr: unknown;

  for (const { label, url } of providers) {
    try {
      index = await buildWithProvider(label, url);
      const count = Object.keys(index).length;
      if (count < 5000) {
        // Sanity guard — a partial/broken response should not silently
        // overwrite a good index. The collection is known to be ~10,014
        // assets. Treat a too-small result as a failure and try the next
        // provider rather than writing bad output.
        throw new Error(`Only found ${count} assets — expected ~10,014`);
      }
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 0));
      console.log(`[build-index] Wrote ${count} entries to ${OUTPUT_PATH} (via ${label})`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[build-index] ${label} failed: ${err instanceof Error ? err.message : err} — trying next provider`);
    }
  }

  throw lastErr ?? new Error("All providers failed");
}

main().catch((err) => {
  console.error("[build-index] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
