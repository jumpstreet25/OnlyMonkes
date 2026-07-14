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
    if (!wallet?.address) {
      setError('No wallet connected');
      return { verified: false, providerError: false };
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
