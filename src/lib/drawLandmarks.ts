import { DrawingUtils, PoseLandmarker } from "@mediapipe/tasks-vision";
import { armIndices } from "./landmarkIndices";
import type { Handedness, Point2D } from "./types";

export function drawPose(ctx: CanvasRenderingContext2D, points: Point2D[]) {
  const landmarks = points.map((p) => ({ x: p.x, y: p.y, z: 0, visibility: 1 }));
  const drawingUtils = new DrawingUtils(ctx);
  drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: "#7CFC9A",
    lineWidth: 3,
  });
  drawingUtils.drawLandmarks(landmarks, {
    color: "#FFD54A",
    radius: 3,
  });
}

export function drawArmOnly(
  ctx: CanvasRenderingContext2D,
  points: Point2D[],
  hand: Handedness,
  width: number,
  height: number
) {
  const { shoulder, elbow, wrist } = armIndices(hand);
  const chain = [points[shoulder], points[elbow], points[wrist]];

  ctx.strokeStyle = "#7CFC9A";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  chain.forEach((p, i) => {
    const x = p.x * width;
    const y = p.y * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#FFD54A";
  chain.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function drawCueBall(ctx: CanvasRenderingContext2D, ball: Point2D, cueTip: Point2D, width: number, height: number) {
  const bx = ball.x * width;
  const by = ball.y * height;
  const cx = cueTip.x * width;
  const cy = cueTip.y * height;

  ctx.strokeStyle = "#FF6B6B";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by, Math.max(8, width * 0.015), 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#38BDF8";
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
}

function footOfPerpendicular(p: Point2D, line: [Point2D, Point2D]): Point2D {
  const [a, b] = line;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy || 1e-9;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Green (on the line) -> amber -> red (far from the line), for a ratio in [0, 1].
function deviationColor(ratio: number): string {
  const t = Math.min(1, Math.max(0, ratio));
  const good = [74, 222, 128];
  const bad = [248, 113, 113];
  const r = Math.round(good[0] + (bad[0] - good[0]) * t);
  const g = Math.round(good[1] + (bad[1] - good[1]) * t);
  const b = Math.round(good[2] + (bad[2] - good[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function drawLabelPill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, scale: number) {
  ctx.font = `600 ${Math.round(11 * scale)}px system-ui, sans-serif`;
  const padX = 5 * scale;
  const textWidth = ctx.measureText(text).width;
  const boxW = textWidth + padX * 2;
  const boxH = 16 * scale;
  const boxX = x - boxW / 2;
  const boxY = y - boxH / 2;

  ctx.fillStyle = "rgba(15, 23, 20, 0.85)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 4 * scale);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

// pathColorRgb is an "R, G, B" triplet (no rgba() wrapper) so per-point alpha/size
// can be varied to show progression through time — dim/small near the start of the
// analyzed range, bright/large near the end. `times` (seconds, same length/order as
// `path`) drives a handful of on-path time labels so timing is readable without
// scrubbing. `normalizeBy` is the same scale used to score the straightness metric,
// so the green→red deviation connectors line up with what the score is penalizing.
export function drawTrackOverlay(
  ctx: CanvasRenderingContext2D,
  path: Point2D[],
  times: number[],
  idealLine: [Point2D, Point2D] | null,
  width: number,
  height: number,
  pathColorRgb: string,
  lineColor: string,
  normalizeBy: number
) {
  if (idealLine && path.length >= 1) {
    for (const p of path) {
      const foot = footOfPerpendicular(p, idealLine);
      const d = Math.hypot(p.x - foot.x, p.y - foot.y);
      const ratio = d / normalizeBy / 0.15;
      ctx.strokeStyle = deviationColor(ratio);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x * width, p.y * height);
      ctx.lineTo(foot.x * width, foot.y * height);
      ctx.stroke();
    }
  }

  if (path.length >= 2) {
    ctx.strokeStyle = `rgba(${pathColorRgb}, 0.3)`;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    path.forEach((p, i) => {
      const x = p.x * width;
      const y = p.y * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    path.forEach((p, i) => {
      const t = path.length > 1 ? i / (path.length - 1) : 1;
      ctx.fillStyle = `rgba(${pathColorRgb}, ${0.35 + t * 0.55})`;
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 2.5 + t * 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (times.length === path.length && path.length > 0) {
    const numTicks = Math.min(5, path.length);
    for (let k = 0; k < numTicks; k++) {
      const idx = numTicks === 1 ? 0 : Math.round((k * (path.length - 1)) / (numTicks - 1));
      const p = path[idx];
      const labelX = Math.min(Math.max(p.x * width, 24), width - 24);
      const labelY = Math.min(Math.max(p.y * height - 16, 12), height - 12);
      drawLabelPill(ctx, labelX, labelY, `${times[idx].toFixed(2)}s`, 1);
    }
  }

  if (idealLine) {
    const [a, b] = idealLine;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ext = 0.08;
    const ax = (a.x - dx * ext) * width;
    const ay = (a.y - dy * ext) * height;
    const bx = (b.x + dx * ext) * width;
    const by = (b.y + dy * ext) * height;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function drawLineHandles(
  ctx: CanvasRenderingContext2D,
  line: [Point2D, Point2D],
  width: number,
  height: number,
  color: string
) {
  for (const p of line) {
    const x = p.x * width;
    const y = p.y * height;
    ctx.fillStyle = "#0e2417";
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Highlights where "now" (the current playback time) sits along a drawn trajectory,
// with a small elapsed-time label so a specific point can be tied to a specific moment.
export function drawTimeMarker(
  ctx: CanvasRenderingContext2D,
  point: Point2D,
  label: string,
  width: number,
  height: number,
  color: string
) {
  const x = point.x * width;
  const y = point.y * height;

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.stroke();

  const labelX = Math.min(Math.max(x, 30), width - 30);
  const labelY = Math.min(Math.max(y - 24, 12), height - 12);
  drawLabelPill(ctx, labelX, labelY, label, 1.3);
}

export function drawSeedMarker(ctx: CanvasRenderingContext2D, point: Point2D, color: string, width: number, height: number) {
  const x = point.x * width;
  const y = point.y * height;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const size = Math.max(10, width * 0.02);
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}
