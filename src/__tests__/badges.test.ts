import {
  loadBadgeData,
  resetBadgeState,
  incrementProgress,
  updateStreak,
  recordLeaderboardWin,
  getProgress,
  getEarnedBadges,
  setOnBadgeEarned,
  BADGE_DEFS,
  type BadgeDef,
} from '../lib/badges';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/constants', () => ({
  HELIUS_API_KEY: '',
}));

describe('badges', () => {
  beforeEach(() => {
    resetBadgeState();
  });

  it('defines 12 badge types', () => {
    expect(BADGE_DEFS).toHaveLength(12);
    expect(BADGE_DEFS.map(b => b.id)).toContain('first_message');
    expect(BADGE_DEFS.map(b => b.id)).toContain('streak_7');
    expect(BADGE_DEFS.map(b => b.id)).toContain('top_monke');
  });

  it('starts with zero progress', () => {
    const p = getProgress();
    expect(p.messages_sent).toBe(0);
    expect(p.reactions_given).toBe(0);
    expect(p.login_streak).toBe(0);
    expect(p.best_streak).toBe(0);
    expect(p.leaderboard_wins).toBe(0);
  });

  it('starts with no earned badges', () => {
    expect(getEarnedBadges()).toEqual([]);
  });

  it('earns first_message badge on first message', () => {
    const earned = incrementProgress('messages_sent');
    expect(earned.length).toBe(1);
    expect(earned[0].id).toBe('first_message');
    expect(getEarnedBadges()).toContain('first_message');
  });

  it('does not re-earn first_message on second message', () => {
    incrementProgress('messages_sent'); // earns first_message
    const earned = incrementProgress('messages_sent'); // should not re-earn
    expect(earned.length).toBe(0);
  });

  it('earns messages_100 at 100 messages', () => {
    // Send 99 messages
    for (let i = 0; i < 99; i++) incrementProgress('messages_sent');
    // The 100th message
    const earned = incrementProgress('messages_sent');
    expect(earned.some(b => b.id === 'messages_100')).toBe(true);
  });

  it('earns reactions_50 at 50 reactions', () => {
    for (let i = 0; i < 49; i++) incrementProgress('reactions_given');
    const earned = incrementProgress('reactions_given');
    expect(earned.some(b => b.id === 'reactions_50')).toBe(true);
  });

  it('earns streak_7 when best streak reaches 7', () => {
    const earned = updateStreak(7, 7);
    expect(earned.some(b => b.id === 'streak_7')).toBe(true);
  });

  it('earns streak_30 when best streak reaches 30', () => {
    updateStreak(7, 7); // earn streak_7 first
    const earned = updateStreak(30, 30);
    expect(earned.some(b => b.id === 'streak_30')).toBe(true);
  });

  it('earns top_monke on leaderboard win', () => {
    const earned = recordLeaderboardWin();
    expect(earned.some(b => b.id === 'top_monke')).toBe(true);
  });

  it('calls onBadgeEarned callback', () => {
    const cb = jest.fn();
    setOnBadgeEarned(cb);
    incrementProgress('messages_sent');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 'first_message' }));
    setOnBadgeEarned(null);
  });

  it('increments progress by custom amount', () => {
    incrementProgress('messages_sent', 50);
    expect(getProgress().messages_sent).toBe(50);
  });

  it('tracks multiple badge earnings in one increment', () => {
    // Jump to 100 in one go — should earn first_message AND messages_100
    const earned = incrementProgress('messages_sent', 100);
    expect(earned.length).toBe(2);
    const ids = earned.map(b => b.id);
    expect(ids).toContain('first_message');
    expect(ids).toContain('messages_100');
  });
});
