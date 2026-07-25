import { DrawingUtils, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Point2D } from "./types";

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
