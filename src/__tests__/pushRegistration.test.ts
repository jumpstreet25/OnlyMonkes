const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockStore.set(k, v); },
  },
}));
jest.mock('@/lib/constants', () => ({ BOT_INBOX_IDS: ['b'.repeat(64)] }));
const mockSent: string[] = [];
jest.mock('@/lib/xmtp', () => ({ openOrCreateDm: async () => ({ send: async (t: string) => { mockSent.push(t); } }) }));
jest.mock('@/hooks/useXmtp', () => ({ getXmtpClient: () => ({}) }));

import { registerPushTokensWithBot, requestDmPush } from '@/lib/pushRegistration';

const flush = () => new Promise((r) => setTimeout(r, 50));

describe('push tokens go only to the bot', () => {
  beforeEach(() => { mockSent.length = 0; });

  it('registers once per token pair, again when a token changes', async () => {
    await registerPushTokensWithBot('fcm-1', 'ExponentPushToken[a]');
    await registerPushTokensWithBot('fcm-1', 'ExponentPushToken[a]');
    expect(mockSent).toEqual([`PUSH_REGISTER:${JSON.stringify({ pt: 'fcm-1', ept: 'ExponentPushToken[a]' })}`]);
    await registerPushTokensWithBot('fcm-2', 'ExponentPushToken[a]');
    expect(mockSent).toHaveLength(2);
  });

  it('sends nothing without tokens', async () => {
    await registerPushTokensWithBot(null, null);
    expect(mockSent).toHaveLength(0);
  });
});

describe('DM pushes are requested from the bot', () => {
  beforeEach(() => { mockSent.length = 0; });

  it('asks the bot once per peer per 30s, never with message text', async () => {
    const peer = 'c'.repeat(64);
    requestDmPush(peer);
    requestDmPush(peer);
    await flush();
    expect(mockSent).toEqual([`PUSH_DM:${JSON.stringify({ to: peer })}`]);
  });

  it('never for the bot itself', async () => {
    requestDmPush('b'.repeat(64));
    await flush();
    expect(mockSent).toHaveLength(0);
  });
});
