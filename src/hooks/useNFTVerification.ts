import { useCallback } from 'react';
import { verifyNFTOwnership } from '@/lib/nftVerification';
import { loadSelectedNftMint } from '@/lib/userProfile';
import { useAppStore } from '@/store/appStore';

export interface VerifyResult {
  verified: boolean;
  /**
   * True when `verified: false` is because every provider errored/timed
   * out (Helius maxed, Shyft can't see this collection, on-chain check
   * inconclusive) — NOT because ownership was actually checked and came
   * back negative. Callers must not treat this the same as a confirmed
   * non-holder: a real holder who hit this during signup would otherwise
   * get silently dropped into guest/marketplace-only mode with no
   * indication anything went wrong, and no obvious way back to retry.
   */
  providerError: boolean;
}

export function useNFTVerification() {
  const { wallet, setVerified, setAllNfts, setError } = useAppStore();

  const verify = useCallback(async (): Promise<VerifyResult> => {
    // TEMP DIAGNOSTIC (2026-07-23): confirming whether the wallet connection
    // is actually dropping between login and a later retry. Remove once
    // root-caused.
    console.log(`[NFTVerify][DIAG] wallet at verify() call: ${wallet?.address ? wallet.address.slice(0, 8) + '…' : 'MISSING'}`);
    if (!wallet?.address) {
      setError('No wallet connected');
      // 2026-07-23: was providerError: false, which VerifyScreen's caller
      // treats identically to a confirmed non-holder — routes straight to
      // the "not a holder" screen with buy links, exactly the misleading
      // outcome the providerError flag exists to prevent (see its doc
      // above). A dropped wallet connection is not evidence of non-
      // ownership; treat it the same as any other ambiguous provider
      // failure so the user gets the retryable error state instead.
      return { verified: false, providerError: true };
    }

    try {
      const result = await verifyNFTOwnership(wallet.address);
      if (result.verified && result.nft) {
        const allNfts = result.allNfts ?? [result.nft];
        setAllNfts(allNfts);

        // Restore previously chosen NFT if available
        const savedMint = await loadSelectedNftMint();
        const chosen = savedMint
          ? (allNfts.find((n) => n.mint === savedMint) ?? allNfts[0])
          : allNfts[0];

        setVerified(true, chosen);
        return { verified: true, providerError: false };
      } else {
        setError(result.error ?? 'NFT verification failed');
        setVerified(false, null);
        return { verified: false, providerError: !!result.providerError };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification error';
      setError(message);
      // A thrown exception means verifyNFTOwnership() itself blew up rather
      // than resolving with a clean verified/not-verified answer — treat
      // that as ambiguous too, same as an explicit providerError.
      return { verified: false, providerError: true };
    }
  }, [wallet, setVerified, setAllNfts, setError]);

  return { verify };
}
