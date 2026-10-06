jest.mock('../lib/constants', () => ({ SOLANA_RPC_URL: 'https://rpc.test' }));

const mockFetch = jest.fn();
jest.mock('../lib/fetchWithTimeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
}));

import { fetchTransferHook, hookExitSeverity } from '../lib/transferHook';

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function rpcReply(value: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { value } }) });
}

function mintAccount(owner: string, hookProgramId?: string | null) {
  const extensions = hookProgramId === undefined
    ? []
    : [{ extension: 'transferHook', state: { authority: null, programId: hookProgramId } }];
  return { owner, data: { parsed: { info: { extensions } } } };
}

describe('fetchTransferHook', () => {
  beforeEach(() => mockFetch.mockReset());

  it('names a Hooked rule from its hook program', async () => {
    rpcReply(mintAccount(TOKEN_2022, 'EZet2oSoussVujse5U8W4T2NZsTuJ1rZBqQ8J188iJKk'));
    const info = await fetchTransferHook('MintHours1111111111111111111111111111111111');
    expect(info).toEqual(expect.objectContaining({ rule: 'Market hours', exit: 'blocked', hooked: true }));
    expect(hookExitSeverity(info!.exit)).toBe('danger');
  });

  it('returns null once a graduated token has its hook removed', async () => {
    rpcReply(mintAccount(TOKEN_2022, null));
    expect(await fetchTransferHook('MintGrad11111111111111111111111111111111111')).toBeNull();
  });

  it('flags an unrecognised hook program as unknown', async () => {
    rpcReply(mintAccount(TOKEN_2022, 'SomeOtherHookProgram11111111111111111111111'));
    const info = await fetchTransferHook('MintOther1111111111111111111111111111111111');
    expect(info).toEqual(expect.objectContaining({ exit: 'unknown', hooked: false }));
  });

  it('ignores plain SPL tokens', async () => {
    rpcReply(mintAccount('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
    expect(await fetchTransferHook('MintSpl111111111111111111111111111111111111')).toBeNull();
  });

  it('caches per mint', async () => {
    rpcReply(mintAccount(TOKEN_2022, '4GsxAQV9NeDh4J9HX4dWRfNFacxiqHKRf6RxGJoLuK8n'));
    await fetchTransferHook('MintMax11111111111111111111111111111111111');
    const again = await fetchTransferHook('MintMax11111111111111111111111111111111111');
    expect(again?.rule).toBe('Max per wallet');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
