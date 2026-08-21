/**
 * useEntitlementSync — re-runs SagaMonkes NFT-ownership verification periodically
 * (app-foreground, TTL'd) instead of only once at login.
 *
 * Required for Data Oracle Phase 1: "only wallets holding a SagaMonkes cNFT can have their
 * device's data count toward the oracle" needs entitlement to be live derived state, not a
 * stored permanent grant from whenever the user first verified — someone who sells/transfers
 * their Monke should stop being entitled without needing to reconnect their wallet.
 *
 * Reuses the existing verifyNFTOwnership() chain unchanged via useNFTVerification() — this
 * hook only adds the "when to re-check" scheduling on top, same AppState-foreground pattern
 * already used by backgroundSync.ts.
 */

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAppStore } from '@/store/appStore';
import { useNFTVerification } from './useNFTVerification';
import { verifyGenesisTokenOwnership } from '@/lib/genesisTokenVerification';
import { saveGenesisFlag, clearGenesisFlag } from '@/lib/session';

const RECHECK_TTL_MS = 6 * 3600 * 1000; // 6h

export function useEntitlementSync(): void {
  const walletAddress = useAppStore((s) => s.wallet?.address);
  const setVerifiedAt = useAppStore((s) => s.setVerifiedAt);
  const { verify } = useNFTVerification();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!walletAddress) return;

    async function maybeRecheck() {
      if (!walletAddress || inFlight.current) return;
      const { verifiedAt } = useAppStore.getState();
      const stale = !verifiedAt || Date.now() - verifiedAt > RECHECK_TTL_MS;
      if (!stale) return;

      inFlight.current = true;
      try {
        const result = await verify();
        // Only stamp a fresh check on a real answer — a providerError means every DAS
        // provider failed, so nothing was actually re-confirmed and the stale timestamp
        // should keep prompting a retry on the next foreground return.
        if (!result.providerError) setVerifiedAt(Date.now());

        const genesis = await verifyGenesisTokenOwnership(walletAddress);
        if (genesis.verified && genesis.kind) {
          useAppStore.getState().setIsGenesisHolder(true, genesis.kind);
          await saveGenesisFlag(genesis.kind, walletAddress);
        } else {
          useAppStore.getState().setIsGenesisHolder(false, null);
          await clearGenesisFlag();
        }
      } finally {
        inFlight.current = false;
      }
    }

    void maybeRecheck();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void maybeRecheck();
    });
    return () => sub.remove();
  }, [walletAddress, verify, setVerifiedAt]);
}
