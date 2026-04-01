/**
 * FaceTracker — Headless component that runs MediaPipe Face Landmarker
 * on a hidden camera for 52-blendshape face tracking.
 *
 * Renders a 1×1px invisible camera. Outputs BlendshapeParams at ~20fps
 * via callback. The camera feed is never shown — it only serves as
 * input for face tracking that drives AnimatedAvatar.
 *
 * Mount inside AvatarRoomScreen for the local user only.
 */

import React, { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  MediapipeCamera,
  useFaceLandmarkDetection,
  type FaceLandmarkDetectionResultBundle,
  RunningMode,
  Delegate,
} from 'react-native-mediapipe';
import { useCameraPermission } from 'react-native-vision-camera';
import {
  mediapipeToBlendshapes,
  type BlendshapeParams,
} from '@/lib/faceTracking';

// MediaPipe face landmark model (bundled with react-native-mediapipe)
const FACE_LANDMARKER_MODEL = 'face_landmarker.task';

interface FaceTrackerProps {
  enabled: boolean;
  onBlendshapes: (params: BlendshapeParams) => void;
}

export function FaceTracker({ enabled, onBlendshapes }: FaceTrackerProps) {
  const { hasPermission } = useCameraPermission();
  const lastFrameRef = useRef(0);
  const errorCountRef = useRef(0);
  const disabledRef = useRef(false);

  const handleResults = useCallback(
    (result: FaceLandmarkDetectionResultBundle, _viewSize: any, _mirrored: boolean) => {
      if (disabledRef.current) return;

      // Throttle to ~20fps (50ms between frames)
      const now = Date.now();
      if (now - lastFrameRef.current < 50) return;
      lastFrameRef.current = now;

      try {
        if (!result.results || result.results.length === 0) return;
        const face = result.results[0];
        if (!face?.faceBlendshapes) return;

        // Extract blendshapes
        const blendshapes = mediapipeToBlendshapes(
          face.faceBlendshapes,
          face.facialTransformationMatrixes?.[0] as unknown as number[][],
        );
        onBlendshapes(blendshapes);
        errorCountRef.current = 0; // reset on success
      } catch (e) {
        errorCountRef.current++;
        if (errorCountRef.current > 10) {
          console.warn('[FaceTracker] Too many errors, disabling');
          disabledRef.current = true;
        }
      }
    },
    [onBlendshapes],
  );

  const handleError = useCallback((error: any) => {
    console.warn('[FaceTracker] MediaPipe error:', error);
  }, []);

  const solution = useFaceLandmarkDetection(
    handleResults,
    handleError,
    RunningMode.LIVE_STREAM,
    FACE_LANDMARKER_MODEL,
    {
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      delegate: Delegate.GPU,
    },
  );

  if (!enabled || !hasPermission) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <MediapipeCamera
        style={styles.camera}
        solution={solution}
        activeCamera="front"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
    top: -1,
    left: -1,
    overflow: 'hidden',
  },
  camera: {
    width: 1,
    height: 1,
  },
});
