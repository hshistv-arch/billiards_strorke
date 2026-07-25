import { getPoseLandmarker } from "./poseLandmarker";
import type { FrameLandmarks } from "./types";

export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

export async function extractFrames(
  video: HTMLVideoElement,
  onProgress: (ratio: number) => void
): Promise<FrameLandmarks[]> {
  const landmarker = await getPoseLandmarker();
  const duration = video.duration;
  const targetFps = 15;
  const maxSamples = 450;
  const total = Math.max(1, Math.min(maxSamples, Math.floor(duration * targetFps)));
  const step = duration / total;

  const frames: FrameLandmarks[] = [];
  for (let i = 0; i <= total; i++) {
    const t = Math.min(duration - 0.001, i * step);
    await seekTo(video, t);
    const result = landmarker.detectForVideo(video, Math.round(t * 1000));
    const landmarks = result.landmarks?.[0];
    if (landmarks && landmarks.length > 0) {
      frames.push({
        timeMs: t * 1000,
        landmarks: landmarks.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    onProgress((i + 1) / (total + 1));
  }
  return frames;
}
