import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTradesStore } from '@/store/tradesStore';

export interface ClosedTrade {
  id: string;
  source: 'manual' | 'autonomonke';
  token: string;
  mint: string;
  entrySolAmount: number;
  exitSolAmount: number;
  pnlSol: number;
  pnlPct: number;
  durationMs: number;
  openedAt: number;
  closedAt: number;
  signature?: string;
  reason?: string;
}

interface OpenMeta {
  mint: string;
  symbol: string;
  firstBuyAt: number;
}

const AK_OPEN_META = 'om_open_position_meta_v1';

let _open = new Map<string, OpenMeta>();
let _loaded = false;

export async function loadOpenPositions(): Promise<void> {
  if (_loaded) return;
  try {
    const raw = await AsyncStorage.getItem(AK_OPEN_META);
    if (raw) {
      const arr = JSON.parse(raw) as OpenMeta[];
      _open = new Map(arr.map(m => [m.mint, m]));
    }
  } catch { /* non-critical */ }
  _loaded = true;
}

function persist(): void {
  const arr = [..._open.values()];
  AsyncStorage.setItem(AK_OPEN_META, JSON.stringify(arr)).catch(() => {});
}

export function onBuy(p: { mint: string; symbol: string; ts: number }): void {
  if (!_open.has(p.mint)) {
    _open.set(p.mint, { mint: p.mint, symbol: p.symbol, firstBuyAt: p.ts });
    persist();
  }
}

export function onSell(p: {
  mint: string;
  symbol: string;
  proportionalCost: number;
  exitSolAmount: number;
  ts: number;
  fullClose: boolean;
  signature?: string;
}): ClosedTrade | null {
  const meta = _open.get(p.mint);
  if (!meta || p.proportionalCost <= 0) return null;

  const pnlSol = p.exitSolAmount - p.proportionalCost;
  const pnlPct = (pnlSol / p.proportionalCost) * 100;
  const durationMs = Math.max(0, p.ts - meta.firstBuyAt);

  const trade: ClosedTrade = {
    id: `${p.mint}-${p.ts}`,
    source: 'manual',
    token: p.symbol,
    mint: p.mint,
    entrySolAmount: p.proportionalCost,
    exitSolAmount: p.exitSolAmount,
    pnlSol,
    pnlPct,
    durationMs,
    openedAt: meta.firstBuyAt,
    closedAt: p.ts,
    signature: p.signature,
    reason: 'manual',
  };

  if (p.fullClose) {
    _open.delete(p.mint);
    persist();
  }

  useTradesStore.getState().addClosedTrade(trade);
  return trade;
}
