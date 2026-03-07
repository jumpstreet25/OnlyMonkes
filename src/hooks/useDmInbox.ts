import { useState, useEffect, useCallback, useRef } from 'react';
import { getXmtpClient } from '@/hooks/useXmtp';
import { listDmThreads, type DmThread } from '@/lib/xmtp';

export function useDmInbox() {
  const [threads, setThreads]       = useState<DmThread[]>([]);
  const [loading, setLoading]       = useState(true);
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
    if (isRefresh) setRefreshing(true);
    try {
      const t = await listDmThreads(client);
      if (mountedRef.current) setThreads(t);
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
