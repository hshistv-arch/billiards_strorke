import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

// The landmarker singleton is reused across every video/re-analysis in the session,
// but its VIDEO running mode requires timestamps to strictly increase for the life of
// the instance. Each new video (or retry) restarts its own clock near 0, so we remap
// every real video timestamp onto a session-wide monotonically increasing counter
// before handing it to detectForVideo — otherwise MediaPipe throws on the 2nd run.
let nextTimestampMs = 0;

export function reserveTimestamp(candidateMs: number): number {
  const ts = Math.max(Math.round(candidateMs), nextTimestampMs);
  nextTimestampMs = ts + 1;
  return ts;
}

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
      );
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    })();
  }
  return landmarkerPromise;
}
