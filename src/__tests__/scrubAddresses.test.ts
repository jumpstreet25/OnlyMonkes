import { scrubAddresses } from '@/lib/scrubAddresses';

const WALLET = '25AHqZAtU2iZo8RXG3KAzrWTPpK319vcABCDEFGHijk';

describe('scrubAddresses', () => {
  it('removes wallets from URLs and messages', () => {
    expect(scrubAddresses(`https://monkeledger.jumpstreet25.workers.dev/wallet/${WALLET}`)).toBe(
      'https://monkeledger.jumpstreet25.workers.dev/wallet/<addr>',
    );
    expect(scrubAddresses({ url: `x/${WALLET}?a=1`, n: 3, list: [WALLET] })).toEqual({ url: 'x/<addr>?a=1', n: 3, list: ['<addr>'] });
  });
  it('leaves normal text, short ids and 64-char hex alone', () => {
    const hex = 'a'.repeat(32) + '0'.repeat(32);
    expect(scrubAddresses(`Main Chat slow start: 315s ${hex}`)).toBe(`Main Chat slow start: 315s ${hex}`);
    expect(scrubAddresses(undefined)).toBeUndefined();
  });
});
