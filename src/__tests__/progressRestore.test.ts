jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { mergeStreakData } from '@/lib/streaks';
import { parseProgress } from '@/lib/progressSnapshot';

const T = '2026-11-19', Y = '2026-11-18';
const s = (streak: number, bestStreak: number, lastLoginDate: string, isLegendary = false) => ({ streak, bestStreak, lastLoginDate, isLegendary });

describe('mergeStreakData', () => {
  it('upgrade same day: the old phone run wins over the new phone\'s fresh 1', () => {
    expect(mergeStreakData(s(1, 1, T), s(30, 41, T, true), T, Y)).toEqual(s(30, 41, T, true));
  });
  it('old phone last seen yesterday, new phone opened today: run continues +1', () => {
    expect(mergeStreakData(s(1, 1, T), s(30, 41, Y, true), T, Y)).toEqual(s(31, 41, T, true));
  });
  it('a broken remote run only keeps best streak and legendary', () => {
    expect(mergeStreakData(s(1, 1, T), s(30, 41, '2026-11-10', true), T, Y)).toEqual(s(1, 41, T, true));
  });
  it('never lowers this phone', () => {
    expect(mergeStreakData(s(12, 20, T), s(3, 5, T), T, Y)).toEqual(s(12, 20, T, true));
  });
});

describe('parseProgress', () => {
  it('clamps and validates untrusted input', () => {
    const p = parseProgress({ ls: 30, bs: -4, ld: 'nope', lg: 1, sd: 99, tc: 3.7, te: 1e12, ms: 'x', rg: 5, lw: 2, lc: 1 });
    expect(p).toMatchObject({ ls: 30, bs: 0, ld: '', lg: true, sd: 7, tc: 3, te: 10_000_000, ms: 0, rg: 5, lw: 2, lc: 1 });
  });
  it('null for junk', () => {
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress('pg')).toBeNull();
  });
});
