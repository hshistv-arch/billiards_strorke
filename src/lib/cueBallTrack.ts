import { seekTo } from "./extractFrames";
import { captureTemplate, toGrayFrame, trackTemplate, type Template } from "./tracker";
import type { CueBallFrame, Point2D } from "./types";

const WORK_MAX_DIM = 480;
const PATCH_HALF = 9;
const SEARCH_HALF = 18;
const TARGET_FPS = 20;
const MAX_SAMPLES = 240;

export async function trackCueBall(
  video: HTMLVideoElement,
  trimStart: number,
  trimEnd: number,
  ballSeedNorm: Point2D,
  cueSeedNorm: Point2D,
  onProgress: (ratio: number) => void
): Promise<CueBallFrame[]> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, WORK_MAX_DIM / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context is not available");

  const duration = Math.max(0.1, trimEnd - trimStart);
  const total = Math.max(1, Math.min(MAX_SAMPLES, Math.floor(duration * TARGET_FPS)));
  const step = duration / total;

  let ballTemplate: Template | null = null;
  let cueTemplate: Template | null = null;
  let ballPos = { x: ballSeedNorm.x * w, y: ballSeedNorm.y * h };
  let cuePos = { x: cueSeedNorm.x * w, y: cueSeedNorm.y * h };

  const frames: CueBallFrame[] = [];

  for (let i = 0; i <= total; i++) {
    const t = Math.min(trimEnd - 0.001, trimStart + i * step);
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const gray = toGrayFrame(imageData);

    if (!ballTemplate) ballTemplate = captureTemplate(gray, ballPos.x, ballPos.y, PATCH_HALF);
    if (!cueTemplate) cueTemplate = captureTemplate(gray, cuePos.x, cuePos.y, PATCH_HALF);

    let ballConfidence = 0;
    let cueConfidence = 0;

    if (ballTemplate) {
      const result = trackTemplate(gray, ballTemplate, ballPos.x, ballPos.y, SEARCH_HALF);
      if (result) {
        ballPos = { x: result.x, y: result.y };
        ballConfidence = result.confidence;
      }
    }
    if (cueTemplate) {
      const result = trackTemplate(gray, cueTemplate, cuePos.x, cuePos.y, SEARCH_HALF);
      if (result) {
        cuePos = { x: result.x, y: result.y };
        cueConfidence = result.confidence;
      }
    }

    frames.push({
      timeMs: t * 1000,
      ball: { x: ballPos.x / w, y: ballPos.y / h },
      cueTip: { x: cuePos.x / w, y: cuePos.y / h },
      ballConfidence,
      cueConfidence,
    });

    onProgress((i + 1) / (total + 1));
  }

  return frames;
}
