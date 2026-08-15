import { useCallback } from 'react';
import { verifyNFTOwnership } from '@/lib/nftVerification';
import { loadSelectedNftMint } from '@/lib/userProfile';
import { useAppStore } from '@/store/appStore';

export interface VerifyResult {
  verified: boolean;
  providerError: boolean;
}

export function useNFTVerification() {
  const { wallet, setVerified, setAllNfts, setError } = useAppStore();

  const verify = useCallback(async (): Promise<VerifyResult> => {
    if (!wallet?.address) {
      setError('No wallet connected');
      return { verified: false, providerError: true };
    }

    try {
      const result = await verifyNFTOwnership(wallet.address);
      if (result.verified && result.nft) {
        const allNfts = result.allNfts ?? [result.nft];
        setAllNfts(allNfts);

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
      return { verified: false, providerError: true };
    }
  }, [wallet, setVerified, setAllNfts, setError]);

  return { verify };
}
