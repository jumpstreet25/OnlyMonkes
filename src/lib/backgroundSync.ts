/**
 * backgroundSync.ts
 *
 * Background fetch requires expo prebuild + SDK-matching package versions.
 * Foreground sync (AppState listener + 15 s heartbeat in ChatScreen) covers
 * the same use case without native module requirements.
 *
 * This file is kept as a no-op stub so imports in _layout.tsx remain valid.
 */

export const BG_SYNC_TASK = 'onlymonkes-bg-sync';

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function registerBackgroundSync(): Promise<void> {}
