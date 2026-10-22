// Loads MediaPipe Tasks Vision (pinned) for the web Avatar Room face tracker
// (src/components/FaceTracker.web.tsx) outside the Metro bundle.
import * as vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";
globalThis.__OM_MEDIAPIPE = vision;
dispatchEvent(new Event("om-mediapipe-ready"));
