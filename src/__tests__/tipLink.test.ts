// Mock heavy Solana dependencies that Jest can't handle
jest.mock('@solana/web3.js', () => ({}));
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({}));
jest.mock('bs58', () => ({ encode: jest.fn() }));
jest.mock('../lib/constants', () => ({ HELIUS_RPC_URL: 'https://example.com' }));
jest.mock('../store/appStore', () => ({
  useAppStore: { getState: () => ({ wallet: null, mwaAuthToken: null }) },
}));

import { parseTipLinkMessage } from '../lib/tipLink';

describe('tipLink', () => {
  describe('parseTipLinkMessage', () => {
    it('parses a valid TIPLINK message', () => {
      const result = parseTipLinkMessage(
        'TIPLINK:https://example.com/claim?key=abc123|0.5|MonkeDave'
      );
      expect(result).toEqual({
        url: 'https://example.com/claim?key=abc123',
        amount: 0.5,
        sender: 'MonkeDave',
      });
    });

    it('returns null for non-TIPLINK messages', () => {
      expect(parseTipLinkMessage('Hello world')).toBeNull();
      expect(parseTipLinkMessage('MSG:user:hello')).toBeNull();
      expect(parseTipLinkMessage('IMAGE:data:image/png;...')).toBeNull();
    });

    it('returns null for malformed TIPLINK messages', () => {
      expect(parseTipLinkMessage('TIPLINK:')).toBeNull();
      expect(parseTipLinkMessage('TIPLINK:url|amount')).toBeNull();
    });

    it('handles fractional SOL amounts', () => {
      const result = parseTipLinkMessage('TIPLINK:https://x.com|0.001|Sender');
      expect(result?.amount).toBe(0.001);
    });

    it('handles integer SOL amounts', () => {
      const result = parseTipLinkMessage('TIPLINK:https://x.com|5|Sender');
      expect(result?.amount).toBe(5);
    });
  });
});
