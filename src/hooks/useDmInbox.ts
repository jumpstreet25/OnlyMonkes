import { useState, useEffect, useCallback, useRef } from 'react';
import { getXmtpClient } from '@/hooks/useXmtp';
import { listDmThreads, type DmThread } from '@/lib/xmtp';
import { useAppStore } from '@/store/appStore';

// The last list, per inbox: reopening DMs shows it at once and refreshes in the background.
let _cache: { inboxId: string; threads: DmThread[]; at: number } | null = null;
// Bouncing between DMs and Main Chat shouldn't queue another full reload behind
// Main Chat's own XMTP work: a list this fresh is reused as is.
const FRESH_MS = 30_000;
const cachedFor = (inboxId: string | null | undefined) =>
  inboxId && _cache?.inboxId === inboxId ? _cache.threads : null;

export function useDmInbox() {
  const initial = cachedFor(getXmtpClient()?.inboxId);
  const [threads, setThreads]       = useState<DmThread[]>(initial ?? []);
  const [loading, setLoading]       = useState(initial === null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async (isRefresh = false, attempt = 0) => {
    if (!mountedRef.current) return;
    const client = getXmtpClient();
    if (!client) {
      if (attempt < 10) {
        setTimeout(() => load(isRefresh, attempt + 1), 600);
      } else {
        setLoading(false); // give up after ~6 seconds
      }
      return;
    }
    if (!isRefresh && _cache?.inboxId === client.inboxId && Date.now() - _cache.at < FRESH_MS) {
      // Show it: the screen may have opened before the client was ready, with nothing cached in state.
      setThreads(_cache.threads);
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    try {
      const t = await listDmThreads(client);
      _cache = { inboxId: client.inboxId, threads: t, at: Date.now() };
      if (mountedRef.current) {
        setThreads(t);
        // Seed per-DM unread counts from thread data
        const counts: Record<string, number> = {};
        for (const thread of t) {
          if (thread.unreadCount > 0) counts[thread.peerInboxId] = thread.unreadCount;
        }
        useAppStore.getState().setDmUnreadCounts(counts);
      }
    } catch (e) {
      console.warn('[useDmInbox] load error:', e);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  return { threads, loading, refreshing, refresh: () => load(true) };
}
