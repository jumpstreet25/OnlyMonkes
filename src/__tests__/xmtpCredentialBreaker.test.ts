jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ captureError: jest.fn() }));

import { isUserAnswerFailure, nextBlock } from '@/lib/xmtpCredential';

describe('xmtp credential breaker', () => {
  it('a wallet "no" waits for Retry', () => {
    for (const m of ['Local association cancelled by user', 'User declined', "Your wallet app is on …ntE7, but you're signed in with …yZ1J.", 'Connect your wallet first']) {
      expect(isUserAnswerFailure(m)).toBe(true);
      expect(nextBlock(null, 'W', m, 0).until).toBe(Number.POSITIVE_INFINITY);
    }
  });
  it('network errors back off 15 s → 5 min', () => {
    let b = nextBlock(null, 'W', 'Network request failed', 0);
    expect(b.until).toBe(15_000);
    for (let i = 0; i < 8; i++) b = nextBlock(b, 'W', 'Holder check failed (503)', 0);
    expect(b.until).toBe(300_000);
  });
  it('a different wallet starts fresh', () => {
    const b = nextBlock(nextBlock(null, 'A', 'Holder check failed (503)', 0), 'B', 'Holder check failed (503)', 0);
    expect(b.failures).toBe(1);
  });
});
