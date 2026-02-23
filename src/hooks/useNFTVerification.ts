import { useCallback } from 'react';
import { verifyNFTOwnership } from '@/lib/nftVerification';
import { useAppStore } from '@/store/appStore';

export function useNFTVerification() {
  const { wallet, setVerified, setAllNfts, setError } = useAppStore();

  const verify = useCallback(async (): Promise<boolean> => {
    if (!wallet?.address) {
      setError('No wallet connected');
      return false;
    }

    try {
      const result = await verifyNFTOwnership(wallet.address);
      if (result.verified && result.nft) {
        setVerified(true, result.nft);
        setAllNfts(result.allNfts ?? [result.nft]);
        return true;
      } else {
        setError(result.error ?? 'NFT verification failed');
        setVerified(false, null);
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification error';
      setError(message);
      return false;
    }
  }, [wallet, setVerified, setAllNfts, setError]);

  return { verify };
}
