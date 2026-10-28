import { loadLivekit } from '../web/shims/livekitClient';

/** Web: downloads livekit-client (kept out of the entry bundle) before a room connects. */
export function preloadLivekit(): Promise<unknown> | null {
  return loadLivekit();
}
