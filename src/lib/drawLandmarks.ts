import type { Point2D } from "./types";

// pathColorRgb is an "R, G, B" triplet (no rgba() wrapper) so per-point
// alpha/size can be varied to show progression through time — dim/small near
// the start of the analyzed range, bright/large near the end.
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
    ctx.strokeStyle = `rgba(${pathColorRgb}, 0.35)`;
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
