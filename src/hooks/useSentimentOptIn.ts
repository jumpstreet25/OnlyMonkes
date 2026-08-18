/**
 * useSentimentOptIn — Data Oracle Phase 1 opt-in/opt-out wiring.
 *
 * Opt in: registers this device (wallet-signed binding via MWA, see deviceRegistration.ts)
 * and schedules the periodic WorkManager upload (SentimentWorkScheduler native module).
 * Opt out: cancels the periodic upload, wipes the local event queue immediately (per the
 * "easy opt-out that immediately stops collection" requirement), and best-effort tells the
 * worker to forget this device.
 */

import { useCallback } from 'react';
import { NativeModules, Platform } from 'react-native';
import { useAppStore } from '@/store/appStore';
import { useMobileWallet } from './useMobileWallet';
import { registerDevice, unregisterDevice } from '@/lib/deviceRegistration';
import { clearAllLocalSignalState } from '@/lib/sentimentSignal';

interface SentimentWorkSchedulerModule {
  schedulePeriodicUpload(): Promise<boolean>;
  cancelPeriodicUpload(): Promise<boolean>;
}

const SentimentWorkScheduler: SentimentWorkSchedulerModule | undefined =
  Platform.OS === 'android'
    ? (NativeModules.SentimentWorkScheduler as SentimentWorkSchedulerModule | undefined)
    : undefined;

export interface SentimentOptInResult {
  ok: boolean;
  error?: string;
}

export function useSentimentOptIn() {
  const wallet = useAppStore((s) => s.wallet);
  const verified = useAppStore((s) => s.verified);
  const setSentimentOracleOptIn = useAppStore((s) => s.setSentimentOracleOptIn);
  const { signMessage } = useMobileWallet();

  const optIn = useCallback(async (): Promise<SentimentOptInResult> => {
    if (Platform.OS !== 'android' || !SentimentWorkScheduler) {
      return { ok: false, error: 'Data Oracle is Android-only' };
    }
    if (!wallet?.address || !verified) {
      return { ok: false, error: 'Connect and verify a SagaMonkes-holding wallet first' };
    }

    const reg = await registerDevice(wallet.address, signMessage);
    if (!reg.ok) return { ok: false, error: reg.error };

    try {
      await SentimentWorkScheduler.schedulePeriodicUpload();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to schedule upload' };
    }

    setSentimentOracleOptIn(true);
    return { ok: true };
  }, [wallet?.address, verified, signMessage, setSentimentOracleOptIn]);

  const optOut = useCallback(async (): Promise<void> => {
    // Local state cleared first and unconditionally — collection must stop immediately
    // regardless of whether the network calls below succeed.
    setSentimentOracleOptIn(false);
    await clearAllLocalSignalState();
    try {
      await SentimentWorkScheduler?.cancelPeriodicUpload();
    } catch {
      /* non-critical */
    }
    await unregisterDevice();
  }, [setSentimentOracleOptIn]);

  return { optIn, optOut };
}
