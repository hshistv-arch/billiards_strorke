import { useEffect, useRef } from "react";
import { footOfPerpendicular } from "../lib/mathUtils";
import type { Point2D } from "../lib/types";

interface DeviationPlotProps {
  points: Point2D[];
  line: [Point2D, Point2D] | null;
  normalizeBy: number;
}

// Green (on the line) -> red (far from the line), for a ratio in [0, 1].
function deviationColor(ratio: number): string {
  const t = Math.min(1, Math.max(0, ratio));
  const good = [74, 222, 128];
  const bad = [248, 113, 113];
  const r = Math.round(good[0] + (bad[0] - good[0]) * t);
  const g = Math.round(good[1] + (bad[1] - good[1]) * t);
  const b = Math.round(good[2] + (bad[2] - good[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// Like PathPlot, but makes the gap between each traced point and the ideal
// line explicit via a color-coded connector, so exactly where and how much
// the cue tip strayed from the line is visible at a glance.
export function DeviationPlot({ points, line, normalizeBy }: DeviationPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width;
    const pad = size * 0.12;

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1e-4);
    const spanY = Math.max(maxY - minY, 1e-4);
    const span = Math.max(spanX, spanY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const toCanvas = (p: Point2D) => ({
      x: pad + ((p.x - cx + span / 2) / span) * (size - pad * 2),
      y: pad + ((p.y - cy + span / 2) / span) * (size - pad * 2),
    });

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#0e2417";
    ctx.fillRect(0, 0, size, size);

    if (line) {
      for (const p of points) {
        const foot = footOfPerpendicular(p, line);
        const d = Math.hypot(p.x - foot.x, p.y - foot.y);
        const ratio = d / normalizeBy / 0.15;
        const a = toCanvas(p);
        const b = toCanvas(foot);
        ctx.strokeStyle = deviationColor(ratio);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      const a = toCanvas(line[0]);
      const b = toCanvas(line[1]);
      ctx.strokeStyle = "#F472B6";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    points.forEach((p) => {
      const c = toCanvas(p);
      ctx.fillStyle = "#38BDF8";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points, line, normalizeBy]);

  return <canvas ref={canvasRef} width={220} height={220} className="path-plot" />;
}
