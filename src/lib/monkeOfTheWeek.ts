/**
 * monkeOfTheWeek.ts — Weekly recognition system.
 *
 * Hermes auto-picks the top performer based on:
 *  - CloutScore (weighted heaviest)
 *  - Trade accuracy this week
 *  - Chat activity
 *  - Banana streak consistency
 *
 * Featured at top of Community popup with special frame.
 * Bot announces in main chat every Monday.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getTopProfiles, type CloutProfile } from "@/lib/monkeClout";

const AK_MOTW = "monke_of_the_week_v1";

export interface MonkeOfTheWeek {
  inboxId: string;
  username: string;
  nftImage?: string | null;
  cloutScore: number;
  weekStart: string;          // ISO date "YYYY-MM-DD" (Monday)
  streak: number;
  reason: string;             // Why they were picked
}

function getMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

/** Load current Monke of the Week. */
export async function loadMotw(): Promise<MonkeOfTheWeek | null> {
  try {
    const raw = await AsyncStorage.getItem(AK_MOTW);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/** Save Monke of the Week. */
async function saveMotw(motw: MonkeOfTheWeek): Promise<void> {
  await AsyncStorage.setItem(AK_MOTW, JSON.stringify(motw));
}

/**
 * Pick this week's Monke. Returns the winner + whether it's a new pick.
 * Call on Monday or on app open — only picks once per week.
 */
export async function pickMonkeOfTheWeek(): Promise<{
  motw: MonkeOfTheWeek;
  isNew: boolean;
}> {
  const currentWeek = getMondayISO();
  const existing = await loadMotw();

  // Already picked this week
  if (existing && existing.weekStart === currentWeek) {
    return { motw: existing, isNew: false };
  }

  // Pick new winner — top CloutScore
  const top = await getTopProfiles(1);
  if (top.length === 0) {
    // No profiles yet — create placeholder
    const placeholder: MonkeOfTheWeek = {
      inboxId: "", username: "No one yet",
      cloutScore: 0, weekStart: currentWeek, streak: 0,
      reason: "Be the first to earn CloutScore!",
    };
    await saveMotw(placeholder);
    return { motw: placeholder, isNew: true };
  }

  const winner = top[0];
  const reason = buildReason(winner);

  const motw: MonkeOfTheWeek = {
    inboxId: winner.inboxId,
    username: winner.username,
    cloutScore: winner.cloutScore,
    weekStart: currentWeek,
    streak: winner.streakDays,
    reason,
  };

  await saveMotw(motw);
  return { motw, isNew: true };
}

function buildReason(p: CloutProfile): string {
  const reasons: string[] = [];
  if (p.tradeAccuracyPct >= 70) reasons.push(`${p.tradeAccuracyPct}% trade accuracy`);
  if (p.streakDays >= 5) reasons.push(`${p.streakDays}-day streak`);
  if (p.messagesThisWeek >= 50) reasons.push("active in chat");
  if (p.bananaBalance >= 200) reasons.push("banana hoarder");
  if (reasons.length === 0) reasons.push("top CloutScore");
  return reasons.join(" · ");
}

/**
 * Format the bot announcement message for main chat.
 */
export function formatMotwAnnouncement(motw: MonkeOfTheWeek): string {
  return [
    "🏆 **MONKE OF THE WEEK** 🏆",
    "",
    `Congratulations @${motw.username}!`,
    "",
    `Clout Score: ${motw.cloutScore}`,
    `Reason: ${motw.reason}`,
    "",
    "Think you can take the crown? Keep logging in, trading smart, and stacking bananas! 🐒🍌",
  ].join("\n");
}
