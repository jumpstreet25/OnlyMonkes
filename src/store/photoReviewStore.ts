/**
 * photoReviewStore.ts — live delivery of bot-generated (Ollama) photo
 * captions to an open PhotoReviewModal.
 *
 * imageCaption.ts's AsyncStorage cache is fine for the old fire-and-forget
 * pattern (read once, later, when the user taps Share to X) but PhotoReviewModal
 * needs to REACT the moment a caption arrives while the modal is on screen —
 * polling AsyncStorage for that would be wasteful and laggy. useXmtp.ts /
 * useDm.ts write here in addition to the AsyncStorage cache when an
 * IMAGE_CAPTION_RESPONSE: arrives, so the modal can just subscribe.
 */
import { create } from 'zustand';

interface PhotoReviewState {
  /** requestId (the temp key passed to requestImageCaption) -> caption text */
  captions: Record<string, string>;
  setCaption: (requestId: string, caption: string) => void;
  clearCaption: (requestId: string) => void;
}

export const usePhotoReviewStore = create<PhotoReviewState>((set) => ({
  captions: {},
  setCaption: (requestId, caption) =>
    set((s) => ({ captions: { ...s.captions, [requestId]: caption } })),
  clearCaption: (requestId) =>
    set((s) => {
      if (!(requestId in s.captions)) return s;
      const next = { ...s.captions };
      delete next[requestId];
      return { captions: next };
    }),
}));
