import { useCallback } from 'react';
import { verifyNFTOwnership } from '@/lib/nftVerification';
import { loadSelectedNftMint } from '@/lib/userProfile';
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
        const allNfts = result.allNfts ?? [result.nft];
        setAllNfts(allNfts);

        // Restore previously chosen NFT if available
        const savedMint = await loadSelectedNftMint();
        const chosen = savedMint
          ? (allNfts.find((n) => n.mint === savedMint) ?? allNfts[0])
          : allNfts[0];

        setVerified(true, chosen);
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
