import { useAppStore } from '../store/appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it('initializes with default state', () => {
    const state = useAppStore.getState();
    expect(state.wallet).toBeNull();
    expect(state.verified).toBe(false);
    expect(state.isGroupMember).toBe(false);
    expect(state.communityBadges).toEqual({ dms: 0, events: 0, links: 0 });
    expect(state.botChannelCounts).toEqual({ trades: 0 });
  });

  it('sets and resets username', () => {
    useAppStore.getState().setUsername('monke123');
    expect(useAppStore.getState().username).toBe('monke123');
    useAppStore.getState().reset();
    expect(useAppStore.getState().username).toBeNull();
  });

  it('increments and clears community badges', () => {
    const { incrementCommunityBadge, clearCommunityBadge } = useAppStore.getState();

    incrementCommunityBadge('dms');
    incrementCommunityBadge('dms');
    incrementCommunityBadge('events');
    expect(useAppStore.getState().communityBadges).toEqual({ dms: 2, events: 1, links: 0 });

    clearCommunityBadge('dms');
    expect(useAppStore.getState().communityBadges.dms).toBe(0);
    expect(useAppStore.getState().communityBadges.events).toBe(1);
  });

  it('increments and clears bot channel counts', () => {
    const { incrementBotChannelCount, clearBotChannelCount } = useAppStore.getState();

    incrementBotChannelCount('trades');
    incrementBotChannelCount('trades');
    expect(useAppStore.getState().botChannelCounts).toEqual({ trades: 2 });

    clearBotChannelCount('trades');
    expect(useAppStore.getState().botChannelCounts.trades).toBe(0);
  });

  it('manages join requests without duplicates', () => {
    const req = { inboxId: 'abc123', username: 'tester', requestedAt: new Date() };
    useAppStore.getState().addJoinRequest(req);
    useAppStore.getState().addJoinRequest(req); // duplicate
    expect(useAppStore.getState().joinRequests).toHaveLength(1);

    useAppStore.getState().removeJoinRequest('abc123');
    expect(useAppStore.getState().joinRequests).toHaveLength(0);
  });

  it('toggles notification preferences', () => {
    useAppStore.getState().setNotificationsEnabled(false);
    expect(useAppStore.getState().notificationsEnabled).toBe(false);

    useAppStore.getState().setMentionsOnly(true);
    expect(useAppStore.getState().mentionsOnly).toBe(true);
  });

  it('sets verified with NFT', () => {
    const nft = { mint: 'abc', name: 'Saga Monke #1', symbol: 'SM', image: 'data:image/jpeg;base64,...', collectionMint: 'xyz' };
    useAppStore.getState().setVerified(true, nft);
    expect(useAppStore.getState().verified).toBe(true);
    expect(useAppStore.getState().verifiedNft?.mint).toBe('abc');
  });
});
