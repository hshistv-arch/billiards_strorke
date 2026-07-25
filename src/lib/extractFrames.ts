import { getPoseLandmarker, reserveTimestamp } from "./poseLandmarker";
import type { FrameLandmarks } from "./types";

const WORK_MAX_DIM = 640;
const PLAYBACK_RATE = 3;
const FAST_TARGET_FPS = 15;
const FALLBACK_TARGET_FPS = 10;
const FALLBACK_MAX_SAMPLES = 150;

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

function makeWorkCanvas(video: HTMLVideoElement) {
  const scale = Math.min(1, WORK_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("Canvas 2D context is not available");
  return { canvas, ctx, w, h };
}

// Fast path: play the trimmed range at an accelerated rate and sample frames as the
// browser decodes them via requestVideoFrameCallback. This avoids the per-frame seek
// latency that dominates the naive seek-and-detect approach.
function supportsFrameCallback(): boolean {
  return typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;
}

async function extractFramesFast(
  video: HTMLVideoElement,
  trimStart: number,
  trimEnd: number,
  onProgress: (ratio: number) => void
): Promise<FrameLandmarks[]> {
  const landmarker = await getPoseLandmarker();
  const { canvas, ctx, w, h } = makeWorkCanvas(video);
  const minGapMs = 1000 / FAST_TARGET_FPS;
  const span = Math.max(0.001, trimEnd - trimStart);
  const frames: FrameLandmarks[] = [];

  await seekTo(video, trimStart);
  video.playbackRate = PLAYBACK_RATE;
  // Muting avoids autoplay-permission rejections on browsers that block programmatic
  // play() with sound once we're a few microtasks removed from the click that started this.
  const wasMuted = video.muted;
  video.muted = true;

  return new Promise((resolve, reject) => {
    let lastMs = -Infinity;
    let settled = false;

    function finish() {
      if (settled) return;
      settled = true;
      video.pause();
      video.playbackRate = 1;
      video.muted = wasMuted;
      video.removeEventListener("ended", finish);
      onProgress(1);
      resolve(frames);
    }

    function onFrame(_now: number, metadata: VideoFrameCallbackMetadata) {
      if (settled) return;
      const tSec = metadata.mediaTime;
      if (tSec >= trimEnd || video.ended) {
        finish();
        return;
      }
      const tMs = tSec * 1000;
      if (tMs - lastMs >= minGapMs) {
        lastMs = tMs;
        ctx.drawImage(video, 0, 0, w, h);
        const result = landmarker.detectForVideo(canvas, reserveTimestamp(tMs));
        const landmarks = result.landmarks?.[0];
        if (landmarks && landmarks.length > 0) {
          frames.push({ timeMs: tMs, landmarks: landmarks.map((p) => ({ x: p.x, y: p.y })) });
        }
        onProgress(Math.min(1, (tSec - trimStart) / span));
      }
      video.requestVideoFrameCallback(onFrame);
    }

    video.requestVideoFrameCallback(onFrame);
    video.play().catch((e) => {
      video.muted = wasMuted;
      reject(e);
    });

    // Safety net in case 'ended'/mediaTime never reaches trimEnd (e.g. trimEnd ~= duration).
    video.addEventListener("ended", finish, { once: true });
  });
}

// Fallback for browsers without requestVideoFrameCallback: seek within the trimmed
// range only (not the whole video) and downscale, both of which keep it far cheaper
// than the old whole-video seek loop.
async function extractFramesBySeek(
  video: HTMLVideoElement,
  trimStart: number,
  trimEnd: number,
  onProgress: (ratio: number) => void
): Promise<FrameLandmarks[]> {
  const landmarker = await getPoseLandmarker();
  const { canvas, ctx, w, h } = makeWorkCanvas(video);
  const duration = Math.max(0.1, trimEnd - trimStart);
  const total = Math.max(1, Math.min(FALLBACK_MAX_SAMPLES, Math.floor(duration * FALLBACK_TARGET_FPS)));
  const step = duration / total;

  const frames: FrameLandmarks[] = [];
  for (let i = 0; i <= total; i++) {
    const t = Math.min(trimEnd - 0.001, trimStart + i * step);
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, w, h);
    const result = landmarker.detectForVideo(canvas, reserveTimestamp(t * 1000));
    const landmarks = result.landmarks?.[0];
    if (landmarks && landmarks.length > 0) {
      frames.push({ timeMs: t * 1000, landmarks: landmarks.map((p) => ({ x: p.x, y: p.y })) });
    }
    onProgress((i + 1) / (total + 1));
  }
  return frames;
}

export async function extractFrames(
  video: HTMLVideoElement,
  trimStart: number,
  trimEnd: number,
  onProgress: (ratio: number) => void
): Promise<FrameLandmarks[]> {
  if (supportsFrameCallback()) {
    try {
      return await extractFramesFast(video, trimStart, trimEnd, onProgress);
    } catch (e) {
      console.warn("Fast frame extraction failed, falling back to seek-based extraction.", e);
      video.playbackRate = 1;
    }
  }
  return extractFramesBySeek(video, trimStart, trimEnd, onProgress);
}
