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

// pathColorRgb is an "R, G, B" triplet (no rgba() wrapper) so per-point alpha/size
// can be varied to show progression through time — dim/small near the start of the
// analyzed range, bright/large near the end.
export function drawTrackOverlay(
  ctx: CanvasRenderingContext2D,
  path: Point2D[],
  idealLine: [Point2D, Point2D] | null,
  width: number,
  height: number,
  pathColorRgb: string,
  lineColor: string
) {
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
      ctx.fillStyle = `rgba(${pathColorRgb}, ${0.3 + t * 0.6})`;
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 2 + t * 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
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

  ctx.font = "600 12px system-ui, sans-serif";
  const padX = 6;
  const textWidth = ctx.measureText(label).width;
  const boxW = textWidth + padX * 2;
  const boxH = 18;
  const boxX = Math.min(Math.max(x - boxW / 2, 2), width - boxW - 2);
  const boxY = y - 11 - boxH - 4;

  ctx.fillStyle = "rgba(15, 23, 20, 0.85)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 5);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2 + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
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
