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
import { saveGenesisFlag, clearGenesisFlag, saveVerifiedNft, clearVerifiedNft, stampNftCheck } from '@/lib/session';

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
        if (!result.providerError) {
          setVerifiedAt(Date.now());
          // 2026-09-13 fix: this in-memory flag was the ONLY thing this background recheck
          // updated on a confirmed Saga Monke holder — it never persisted that to SecureStore,
          // so ConnectScreen's cold-launch fast path (which trusts the persisted cache, not this
          // in-memory store) kept sending a wallet that became a Monke holder AFTER first being
          // verified Genesis-only straight to Genesis Chat on every relaunch, contradicting the
          // app's own "Saga Monke wins" precedence (VerifyScreen.tsx's fresh-verification path
          // already gets this right — this hook's periodic recheck did not). Mirror what
          // VerifyScreen's goToChat() does on a fresh verification, and also clear the cache on a
          // CONFIRMED loss of ownership (not on a provider error) so the reverse case — someone
          // who sells their Monke — doesn't stay stuck on the Main Chat fast path either.
          if (result.verified) {
            const nft = useAppStore.getState().verifiedNft;
            if (nft) {
              await saveVerifiedNft(nft);
              await stampNftCheck();
            }
          } else {
            await clearVerifiedNft();
          }
        }

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
