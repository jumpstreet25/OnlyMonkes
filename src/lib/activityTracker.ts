import AsyncStorage from '@react-native-async-storage/async-storage';

const AK_WEEKLY_ACTIVITY = 'weekly_activity_v1';

interface WeekStats {
  sent: number;
  given: number;   // reactions given
  received: number; // reactions received
}

interface WeeklyData {
  weekStart: string; // 'YYYY-MM-DD' (Monday)
  stats: Record<string, WeekStats>;
}

let _data: WeeklyData = { weekStart: '', stats: {} };
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function getMondayISO(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

export async function loadWeeklyActivity(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_WEEKLY_ACTIVITY);
    if (raw) {
      const parsed: WeeklyData = JSON.parse(raw);
      const currentWeek = getMondayISO();
      if (parsed.weekStart === currentWeek) {
        _data = parsed;
        return;
      }
      // New week — reset
    }
  } catch { /* ignore */ }
  _data = { weekStart: getMondayISO(), stats: {} };
}

function _scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      await AsyncStorage.setItem(AK_WEEKLY_ACTIVITY, JSON.stringify(_data));
    } catch { /* ignore */ }
  }, 800);
}

export function trackActivity(inboxId: string, type: 'sent' | 'given' | 'received'): void {
  if (!inboxId) return;
  if (!_data.stats[inboxId]) {
    _data.stats[inboxId] = { sent: 0, given: 0, received: 0 };
  }
  _data.stats[inboxId][type]++;
  _scheduleSave();
}

export interface LeaderboardEntry {
  inboxId: string;
  sent: number;
  given: number;
  received: number;
  score: number;
}

export function getLeaderboard(limit = 10): LeaderboardEntry[] {
  return Object.entries(_data.stats)
    .map(([inboxId, s]) => ({
      inboxId,
      sent: s.sent,
      given: s.given,
      received: s.received,
      score: s.sent * 3 + s.received * 2 + s.given,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getWeekLabel(): string {
  const d = new Date(_data.weekStart + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
