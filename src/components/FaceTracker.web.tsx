// Web: no ML Kit camera tracking. Avatar Rooms fall back to audio-energy mouth
// movement; MediaPipe Face Landmarker tracking is the planned web replacement.
import type { BlendshapeParams } from '@/lib/faceTracking';

interface FaceTrackerProps {
  enabled: boolean;
  onBlendshapes: (params: BlendshapeParams) => void;
}

export function FaceTracker(_props: FaceTrackerProps) {
  return null;
}
