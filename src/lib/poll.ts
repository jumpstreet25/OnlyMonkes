/**
 * poll.ts — client helpers for the community poll pop-up flow.
 *
 * Mirrors bananaBet.ts's shape. Voting reuses the bot's `/vote <pollId>
 * <optionId>` DM path — a tap here just sends the equivalent command
 * automatically. No banana balance involved (preference vote, not a wager),
 * and votes are one-shot/locked bot-side (see communityPoll.ts castVote) —
 * this client doesn't attempt to re-send after a successful vote.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface PollOption {
  id: string;
  label: string;
}

export interface PollOpenData {
  id: string;
  question: string;
  options: PollOption[];
  resolvesAt: number;
}

export interface PollResultOption extends PollOption {
  votes: number;
}

export interface PollResultData {
  pollId: string;
  question: string;
  winningOption: PollResultOption;
  tally: PollResultOption[];
}

export function parsePollOpen(content: string): PollOpenData | null {
  if (!content.startsWith("POLL_OPEN:")) return null;
  try {
    const data = JSON.parse(content.slice("POLL_OPEN:".length));
    if (!data.id || !data.question || !Array.isArray(data.options) || !data.resolvesAt) return null;
    return data as PollOpenData;
  } catch {
    return null;
  }
}

export function parsePollResult(content: string): PollResultData | null {
  if (!content.startsWith("POLL_RESULT:")) return null;
  try {
    const data = JSON.parse(content.slice("POLL_RESULT:".length));
    if (!data.pollId || !data.question || !data.winningOption || !Array.isArray(data.tally)) return null;
    return data as PollResultData;
  } catch {
    return null;
  }
}

export async function castVote(pollId: string, optionId: string): Promise<void> {
  const { getXmtpClient } = await import("@/hooks/useXmtp");
  const { openOrCreateDm } = await import("@/lib/xmtp");
  const { BOT_INBOX_IDS } = await import("@/lib/constants");
  const client = getXmtpClient();
  if (!client) throw new Error("Not connected");
  const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
  await dm.send(`/vote ${pollId} ${optionId}`);
  await recordMyVote(pollId, optionId);
}

// ─── My-vote tracking — same reasoning as bananaBet.ts's my-bet tracking:
// the group POLL_RESULT: broadcast is aggregate/anonymous, so "did I vote,
// and for what" has to be derived client-side from a local record. ────────
const MY_VOTES_KEY = "poll_my_votes_v1";
const MAX_MY_VOTES = 50;
let _myVotesCache: Record<string, string> | null = null;

async function loadMyVotes(): Promise<Record<string, string>> {
  if (_myVotesCache) return _myVotesCache;
  try {
    const raw = await AsyncStorage.getItem(MY_VOTES_KEY);
    _myVotesCache = raw ? JSON.parse(raw) : {};
  } catch {
    _myVotesCache = {};
  }
  return _myVotesCache!;
}

async function recordMyVote(pollId: string, optionId: string): Promise<void> {
  const votes = await loadMyVotes();
  votes[pollId] = optionId;
  const entries = Object.entries(votes);
  const trimmed = entries.length > MAX_MY_VOTES ? Object.fromEntries(entries.slice(-MAX_MY_VOTES)) : votes;
  _myVotesCache = trimmed;
  try {
    await AsyncStorage.setItem(MY_VOTES_KEY, JSON.stringify(trimmed));
  } catch { /* non-critical */ }
}

/** Returns this device's own vote (optionId) on pollId, if any — null if never voted. */
export async function getMyVote(pollId: string): Promise<string | null> {
  const votes = await loadMyVotes();
  return votes[pollId] ?? null;
}

// ─── Seen-poll tracking — pop-up shows once per poll, ever — same pattern
// as bananaBet.ts's markBetSeenIfFirstTime (guards against XMTP stream-
// reconnect replaying a recent POLL_OPEN:/POLL_RESULT:). ──────────────────
const SEEN_KEY = "poll_seen_ids_v1";
const MAX_SEEN = 100;
let _seenCache: Set<string> | null = null;

async function loadSeen(): Promise<Set<string>> {
  if (_seenCache) return _seenCache;
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    _seenCache = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    _seenCache = new Set();
  }
  return _seenCache;
}

async function saveSeen(seen: Set<string>): Promise<void> {
  try {
    const trimmed = Array.from(seen).slice(-MAX_SEEN);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch { /* non-critical */ }
}

/** Returns true and marks the id as seen if this is the FIRST time — false if already seen. Use a distinct key per open/result event (e.g. `${pollId}-open` / `${pollId}-result`) so both can fire independently. */
export async function markPollSeenIfFirstTime(key: string): Promise<boolean> {
  const seen = await loadSeen();
  if (seen.has(key)) return false;
  seen.add(key);
  await saveSeen(seen);
  return true;
}
