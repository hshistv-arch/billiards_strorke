import { useEffect, useRef } from "react";
import type { Point2D } from "../lib/types";

interface PathPlotProps {
  points: Point2D[];
  line: [Point2D, Point2D] | null;
}

export function PathPlot({ points, line }: PathPlotProps) {
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
      const a = toCanvas(line[0]);
      const b = toCanvas(line[1]);
      ctx.strokeStyle = "#FFD54A";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    points.forEach((p, i) => {
      const c = toCanvas(p);
      const t = i / Math.max(1, points.length - 1);
      ctx.fillStyle = `rgba(124, 252, 154, ${0.35 + t * 0.65})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points, line]);

  return <canvas ref={canvasRef} width={220} height={220} className="path-plot" />;
}
