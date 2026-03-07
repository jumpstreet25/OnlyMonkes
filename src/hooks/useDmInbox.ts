import { useState, useEffect, useCallback } from 'react';
import { getXmtpClient } from '@/hooks/useXmtp';
import { listDmThreads, type DmThread } from '@/lib/xmtp';

export function useDmInbox() {
  const [threads, setThreads]     = useState<DmThread[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    const client = getXmtpClient();
    if (!client) {
      // Retry until client is ready
      setTimeout(() => load(isRefresh), 600);
      return;
    }
    if (isRefresh) setRefreshing(true);
    try {
      const t = await listDmThreads(client);
      setThreads(t);
    } catch (e) {
      console.warn('[useDmInbox] load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { threads, loading, refreshing, refresh: () => load(true) };
}
