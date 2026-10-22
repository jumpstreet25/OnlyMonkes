// Web face tracking for Avatar Rooms: MediaPipe Face Landmarker on the
// browser camera, in place of the phone's ML Kit tracker. MediaPipe outputs
// ARKit-named blendshapes, the same names BlendshapeParams uses, plus a head
// transform matrix for pitch/yaw/roll. Loaded from jsDelivr on first use (a
// pinned version) so the site bundle stays small; the camera feed never
// leaves the browser — only the numbers go out over the room's data channel.
import { useEffect } from 'react';
import { BLENDSHAPE_IDLE, BLENDSHAPE_NAMES, type BlendshapeParams } from '@/lib/faceTracking';

const MP_VERSION = '1.1.0';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const FRAME_MS = 66; // ~15 fps, same budget as the phone tracker

interface FaceTrackerProps {
  enabled: boolean;
  onBlendshapes: (params: BlendshapeParams) => void;
}

let _vision: Promise<any> | null = null;

/** The ES module build, loaded outside Metro (same pattern as the XMTP SDK). */
function loadVision(): Promise<any> {
  if (_vision) return _vision;
  _vision = new Promise((resolve, reject) => {
    const g = globalThis as any;
    if (g.__OM_MEDIAPIPE) return resolve(g.__OM_MEDIAPIPE);
    const done = () => (g.__OM_MEDIAPIPE ? resolve(g.__OM_MEDIAPIPE) : reject(new Error('MediaPipe failed to load')));
    window.addEventListener('om-mediapipe-ready', done, { once: true });
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/vendor/mediapipe-loader.mjs'; // pins MP_VERSION too — keep in step
    s.onerror = () => reject(new Error('MediaPipe failed to load'));
    document.head.appendChild(s);
  });
  _vision.catch(() => { _vision = null; });
  return _vision;
}

const DEG = 180 / Math.PI;

/** Pitch/yaw/roll in degrees from MediaPipe's column-major 4×4 head transform. */
function headRotationOf(m: number[] | Float32Array | undefined): BlendshapeParams['headRotation'] {
  if (!m || m.length < 16) return { x: 0, y: 0, z: 0 };
  const r = (row: number, col: number) => m[col * 4 + row];
  return {
    x: Math.atan2(r(2, 1), r(2, 2)) * DEG,
    y: Math.asin(Math.max(-1, Math.min(1, -r(2, 0)))) * DEG,
    z: Math.atan2(r(1, 0), r(0, 0)) * DEG,
  };
}

export function FaceTracker({ enabled, onBlendshapes }: FaceTrackerProps) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let landmarker: any = null;
    let raf = 0;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;

    (async () => {
      try {
        const vision = await loadVision();
        const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false });
        if (stopped) return;
        video.srcObject = stream;
        await video.play();
        let last = 0;
        const tick = (now: number) => {
          if (stopped) return;
          raf = requestAnimationFrame(tick);
          if (now - last < FRAME_MS || video.readyState < 2) return;
          last = now;
          const res = landmarker.detectForVideo(video, now);
          const cats = res?.faceBlendshapes?.[0]?.categories;
          if (!cats) return;
          const values = { ...BLENDSHAPE_IDLE.values };
          for (const c of cats) {
            if ((BLENDSHAPE_NAMES as readonly string[]).includes(c.categoryName)) {
              values[c.categoryName as keyof typeof values] = Math.max(0, Math.min(1, c.score));
            }
          }
          onBlendshapes({ values, headRotation: headRotationOf(res.facialTransformationMatrixes?.[0]?.data) });
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        // No camera / permission denied / GPU unavailable: the room falls back
        // to audio-energy mouth movement, same as before.
        console.warn('[FaceTracker web]', (e as Error)?.message);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close?.();
    };
  }, [enabled, onBlendshapes]);

  return null;
}

export default FaceTracker;
