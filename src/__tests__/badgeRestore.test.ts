jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { getEarnedBadges, resetBadgeState, restoreEarnedBadges, setOnBadgeEarned } from '@/lib/badges';

describe('restoreEarnedBadges', () => {
  beforeEach(() => resetBadgeState());

  it('adds known badges once and never fires the earn callback', () => {
    const earned = jest.fn();
    setOnBadgeEarned(earned);
    expect(restoreEarnedBadges(['first_message', 'streak_7', 'streak_30', 'messages_100'])).toBe(4);
    expect(restoreEarnedBadges(['first_message'])).toBe(0);
    expect(getEarnedBadges().sort()).toEqual(['first_message', 'messages_100', 'streak_30', 'streak_7']);
    expect(earned).not.toHaveBeenCalled();
    setOnBadgeEarned(null);
  });

  it('ignores unknown ids', () => {
    expect(restoreEarnedBadges(['not_a_badge', 'top_monke'])).toBe(1);
    expect(getEarnedBadges()).toEqual(['top_monke']);
  });
});
