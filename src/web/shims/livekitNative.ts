// Web stand-in for @livekit/react-native: livekit-client runs natively in the
// browser, so there are no globals to register or audio session to manage.
export function registerGlobals(): void {}
export const AudioSession = {
  startAudioSession: async () => {},
  stopAudioSession: async () => {},
  configureAudio: async () => {},
  setAppleAudioConfiguration: async () => {},
};
export function useIOSAudioManagement(): void {}
