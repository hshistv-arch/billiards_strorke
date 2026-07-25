import { seekTo } from "./extractFrames";
import { captureTemplate, toGrayFrame, trackTemplate, type Template } from "./tracker";
import type { CueBallFrame, Point2D } from "./types";

const WORK_MAX_DIM = 480;
const PATCH_HALF = 9;
const SEARCH_HALF = 18;
const TARGET_FPS = 20;
const MAX_SAMPLES = 240;

interface TrackedPoint {
  template: Template | null;
  pos: { x: number; y: number };
}

function makeTracked(seedNorm: Point2D, w: number, h: number): TrackedPoint {
  return { template: null, pos: { x: seedNorm.x * w, y: seedNorm.y * h } };
}

function stepTracked(point: TrackedPoint, gray: ReturnType<typeof toGrayFrame>): number {
  if (!point.template) {
    point.template = captureTemplate(gray, point.pos.x, point.pos.y, PATCH_HALF);
  }
  if (!point.template) return 0;
  const result = trackTemplate(gray, point.template, point.pos.x, point.pos.y, SEARCH_HALF);
  if (!result) return 0;
  point.pos = { x: result.x, y: result.y };
  return result.confidence;
}

export async function trackCueBall(
  video: HTMLVideoElement,
  trimStart: number,
  trimEnd: number,
  ballSeedNorm: Point2D,
  cueTipSeedNorm: Point2D,
  cueCenterSeedNorm: Point2D,
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

  const ball = makeTracked(ballSeedNorm, w, h);
  const cueTip = makeTracked(cueTipSeedNorm, w, h);
  const cueCenter = makeTracked(cueCenterSeedNorm, w, h);

  const frames: CueBallFrame[] = [];

  for (let i = 0; i <= total; i++) {
    const t = Math.min(trimEnd - 0.001, trimStart + i * step);
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, w, h);
    const gray = toGrayFrame(ctx.getImageData(0, 0, w, h));

    const ballConfidence = stepTracked(ball, gray);
    const cueConfidence = stepTracked(cueTip, gray);
    const cueCenterConfidence = stepTracked(cueCenter, gray);

    frames.push({
      timeMs: t * 1000,
      ball: { x: ball.pos.x / w, y: ball.pos.y / h },
      cueTip: { x: cueTip.pos.x / w, y: cueTip.pos.y / h },
      cueCenter: { x: cueCenter.pos.x / w, y: cueCenter.pos.y / h },
      ballConfidence,
      cueConfidence,
      cueCenterConfidence,
    });

    onProgress((i + 1) / (total + 1));
  }

  return frames;
}
