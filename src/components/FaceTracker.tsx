/**
 * FaceTracker — Headless component that runs ML Kit Face Detection
 * via react-native-vision-camera-face-detector for stable face tracking.
 *
 * Renders a 1×1px invisible camera. Outputs BlendshapeParams at ~20fps
 * via callback. The camera feed is never shown — it only serves as
 * input for face tracking that drives AnimatedAvatar.
 *
 * ML Kit provides: landmarks, contours, head rotation, eye/smile probability.
 * We estimate blendshapes from these for the avatar animation pipeline.
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {
  useFaceDetector,
  FaceDetectionOptions,
} from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import {
  type BlendshapeParams,
  BLENDSHAPE_IDLE,
} from '@/lib/faceTracking';

// ML Kit detection config: performance mode, all features enabled
const DETECTION_OPTIONS: FaceDetectionOptions = {
  performanceMode: 'fast',
  classificationMode: 'all',    // smile + eyes open probability
  contourMode: 'all',           // lip/eye/brow contours
  landmarkMode: 'all',          // nose, eyes, ears, mouth landmarks
  minFaceSize: 0.15,
};

interface FaceTrackerProps {
  enabled: boolean;
  onBlendshapes: (params: BlendshapeParams) => void;
}

export function FaceTracker({ enabled, onBlendshapes }: FaceTrackerProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const lastFrameRef = useRef(0);
  const [ready, setReady] = useState(false);
  const { detectFaces } = useFaceDetector(DETECTION_OPTIONS);

  // Request permission on mount if needed
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  // Small delay to avoid racing with camera init
  useEffect(() => {
    if (enabled && hasPermission && device) {
      const t = setTimeout(() => setReady(true), 500);
      return () => clearTimeout(t);
    }
    setReady(false);
  }, [enabled, hasPermission, device]);

  const handleFaceResults = useCallback((faces: any[]) => {
    if (!faces || faces.length === 0) return;

    // Throttle to ~20fps
    const now = Date.now();
    if (now - lastFrameRef.current < 50) return;
    lastFrameRef.current = now;

    const face = faces[0];

    // Build blendshape-compatible params from ML Kit data
    const values = { ...BLENDSHAPE_IDLE.values };

    // ── Mouth ────────────────────────────────────────────────────────────
    // Estimate jaw open from lip contours distance
    if (face.contours?.UPPER_LIP_BOTTOM && face.contours?.LOWER_LIP_TOP) {
      const upperLip = face.contours.UPPER_LIP_BOTTOM;
      const lowerLip = face.contours.LOWER_LIP_TOP;
      if (upperLip.length > 0 && lowerLip.length > 0) {
        // Average Y of upper and lower lip midpoints
        const midUpper = upperLip[Math.floor(upperLip.length / 2)];
        const midLower = lowerLip[Math.floor(lowerLip.length / 2)];
        const lipGap = Math.max(0, midLower.y - midUpper.y);
        const faceH = face.bounds?.height ?? 200;
        values.jawOpen = Math.min(1, lipGap / (faceH * 0.08));
      }
    }

    // Smile from ML Kit classification
    const smileProb = face.smilingProbability ?? 0;
    values.mouthSmileLeft = smileProb;
    values.mouthSmileRight = smileProb;

    // Estimate pucker from mouth width shrinking
    if (face.contours?.UPPER_LIP_TOP) {
      const lip = face.contours.UPPER_LIP_TOP;
      if (lip.length >= 2) {
        const mouthWidth = Math.abs(lip[lip.length - 1].x - lip[0].x);
        const faceW = face.bounds?.width ?? 200;
        const normalRatio = 0.35; // normal mouth width / face width
        const currentRatio = mouthWidth / faceW;
        values.mouthPucker = Math.max(0, Math.min(1, (normalRatio - currentRatio) / normalRatio));
      }
    }

    // ── Eyes ──────────────────────────────────────────────────────────────
    const leftEyeOpen = face.leftEyeOpenProbability ?? 1;
    const rightEyeOpen = face.rightEyeOpenProbability ?? 1;
    values.eyeBlinkLeft = 1 - leftEyeOpen;
    values.eyeBlinkRight = 1 - rightEyeOpen;

    // Wide eyes: when probability > 0.95, eyes are wider than normal
    values.eyeWideLeft = leftEyeOpen > 0.95 ? (leftEyeOpen - 0.95) * 20 : 0;
    values.eyeWideRight = rightEyeOpen > 0.95 ? (rightEyeOpen - 0.95) * 20 : 0;

    // Squint: when eyes partially closed but not blinking
    values.eyeSquintLeft = leftEyeOpen < 0.7 && leftEyeOpen > 0.2 ? (0.7 - leftEyeOpen) / 0.5 : 0;
    values.eyeSquintRight = rightEyeOpen < 0.7 && rightEyeOpen > 0.2 ? (0.7 - rightEyeOpen) / 0.5 : 0;

    // ── Brows ────────────────────────────────────────────────────────────
    // Estimate from eye/brow contour Y distance
    if (face.contours?.LEFT_EYEBROW_TOP && face.contours?.LEFT_EYE_TOP) {
      const browY = face.contours.LEFT_EYEBROW_TOP[Math.floor(face.contours.LEFT_EYEBROW_TOP.length / 2)]?.y ?? 0;
      const eyeY = face.contours.LEFT_EYE_TOP[Math.floor(face.contours.LEFT_EYE_TOP.length / 2)]?.y ?? 0;
      const gap = eyeY - browY;
      const faceH = face.bounds?.height ?? 200;
      const normalGapPct = 0.06;
      const currentGapPct = gap / faceH;
      if (currentGapPct > normalGapPct * 1.3) {
        values.browOuterUpLeft = Math.min(1, (currentGapPct - normalGapPct) / normalGapPct);
        values.browInnerUp = values.browOuterUpLeft * 0.7;
      } else if (currentGapPct < normalGapPct * 0.7) {
        values.browDownLeft = Math.min(1, (normalGapPct - currentGapPct) / normalGapPct);
      }
    }
    if (face.contours?.RIGHT_EYEBROW_TOP && face.contours?.RIGHT_EYE_TOP) {
      const browY = face.contours.RIGHT_EYEBROW_TOP[Math.floor(face.contours.RIGHT_EYEBROW_TOP.length / 2)]?.y ?? 0;
      const eyeY = face.contours.RIGHT_EYE_TOP[Math.floor(face.contours.RIGHT_EYE_TOP.length / 2)]?.y ?? 0;
      const gap = eyeY - browY;
      const faceH = face.bounds?.height ?? 200;
      const normalGapPct = 0.06;
      const currentGapPct = gap / faceH;
      if (currentGapPct > normalGapPct * 1.3) {
        values.browOuterUpRight = Math.min(1, (currentGapPct - normalGapPct) / normalGapPct);
      } else if (currentGapPct < normalGapPct * 0.7) {
        values.browDownRight = Math.min(1, (normalGapPct - currentGapPct) / normalGapPct);
      }
    }

    // ── Head rotation ────────────────────────────────────────────────────
    const headRotation = {
      x: face.pitchAngle ?? 0,
      y: face.yawAngle ?? 0,
      z: face.rollAngle ?? 0,
    };

    onBlendshapes({ values, headRotation });
  }, [onBlendshapes]);

  // JS callback bridge from worklet
  const handleFacesJS = Worklets.createRunOnJS(handleFaceResults);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    try {
      const faces = detectFaces(frame);
      if (faces && faces.length > 0) {
        handleFacesJS(faces);
      }
    } catch {
      // Silently ignore frame processor errors
    }
  }, [detectFaces, handleFacesJS]);

  if (!enabled || !hasPermission || !device || !ready) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <Camera
        style={styles.camera}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
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
