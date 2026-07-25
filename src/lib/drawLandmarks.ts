import type { Point2D } from "./types";

export function drawCueBall(
  ctx: CanvasRenderingContext2D,
  ball: Point2D,
  cueNear: Point2D,
  cueFar: Point2D,
  width: number,
  height: number
) {
  const bx = ball.x * width;
  const by = ball.y * height;
  const nx = cueNear.x * width;
  const ny = cueNear.y * height;
  const fx = cueFar.x * width;
  const fy = cueFar.y * height;

  ctx.strokeStyle = "#FF6B6B";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by, Math.max(8, width * 0.015), 0, Math.PI * 2);
  ctx.stroke();

  // Both seed points sit on the near side of the shaft, so the drawn cue
  // segment is extended forward, past cueFar, to read as "the cue" pointing
  // toward the ball rather than a short tick mark near the hand.
  const dx = fx - nx;
  const dy = fy - ny;
  const forwardExt = 2.5;
  const ex = fx + dx * forwardExt;
  const ey = fy + dy * forwardExt;
  ctx.strokeStyle = "#38BDF8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  ctx.fillStyle = "#38BDF8";
  ctx.beginPath();
  ctx.arc(fx, fy, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
}

// A simple, uncluttered overlay: a thin line tracing the path (no per-point
// markers) plus the ideal line. No on-video text.
export function drawTrackOverlay(
  ctx: CanvasRenderingContext2D,
  path: Point2D[],
  idealLine: [Point2D, Point2D] | null,
  width: number,
  height: number,
  pathColor: string,
  lineColor: string
) {
  if (path.length >= 2) {
    ctx.strokeStyle = pathColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    path.forEach((p, i) => {
      const x = p.x * width;
      const y = p.y * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
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
