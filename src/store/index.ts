/**
 * Store barrel — re-exports everything for convenient imports.
 *
 * Existing code:  import { useAppStore } from '@/store/appStore'  (still works)
 * New code:       import { useUserAuthStore } from '@/store'       (narrower subscription)
 */

// Combined store (backward compat)
export { useAppStore, loadMwaAuthToken, loadPersistedPrefs } from './appStore';
export type { LiveRoomState, CalendarEvent, JoinRequest } from './appStore';

// Focused slice hooks (new code)
export { useUserAuthStore } from './userAuthStore';
export { useUserProfileStore } from './userProfileStore';
export { useAppSettingsStore } from './appSettingsStore';
export { useLiveFeaturesStore } from './liveFeaturesStore';

// Slice types (for typing selectors)
export type { UserAuthState, UserAuthActions } from './userAuthStore';
export type { UserProfileState, UserProfileActions } from './userProfileStore';
export type { AppSettingsState, AppSettingsActions } from './appSettingsStore';
export type { LiveFeaturesState, LiveFeaturesActions } from './liveFeaturesStore';
