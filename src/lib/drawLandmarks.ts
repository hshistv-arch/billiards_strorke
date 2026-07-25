import { DrawingUtils, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Point2D } from "./types";

export function drawPose(ctx: CanvasRenderingContext2D, points: Point2D[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
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
