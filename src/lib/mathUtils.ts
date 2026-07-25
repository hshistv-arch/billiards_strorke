import type { Point2D } from "./types";

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function scoreLabel(score: number): string {
  if (score >= 85) return "良好";
  if (score >= 70) return "ほぼ良好";
  if (score >= 50) return "要改善";
  return "要修正";
}

// PCA on 2D points: returns unit direction of largest-variance axis and centroid.
export function principalAxis(points: Point2D[]): { centroid: Point2D; direction: Point2D } {
  const cx = mean(points.map((p) => p.x));
  const cy = mean(points.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= points.length;
  sxy /= points.length;
  syy /= points.length;

  // Eigenvector of the largest eigenvalue for a 2x2 symmetric matrix.
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const lambda = trace / 2 + Math.sqrt(Math.max(0, (trace / 2) ** 2 - det));
  let dx = lambda - syy;
  let dy = sxy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    dx = 1;
    dy = 0;
  }
  const len = Math.hypot(dx, dy) || 1;
  return { centroid: { x: cx, y: cy }, direction: { x: dx / len, y: dy / len } };
}

export function perpendicularDistances(points: Point2D[], line: [Point2D, Point2D]): number[] {
  const [a, b] = line;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / len;
  const ny = dx / len;
  return points.map((p) => Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny));
}

export function lineLength(line: [Point2D, Point2D]): number {
  return Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y) || 1e-6;
}

export function fitLineThrough(points: Point2D[]): [Point2D, Point2D] {
  const { centroid, direction } = principalAxis(points);
  const projected = points.map((p) => (p.x - centroid.x) * direction.x + (p.y - centroid.y) * direction.y);
  const minProj = Math.min(...projected);
  const maxProj = Math.max(...projected);
  return [
    { x: centroid.x + direction.x * minProj, y: centroid.y + direction.y * minProj },
    { x: centroid.x + direction.x * maxProj, y: centroid.y + direction.y * maxProj },
  ];
}
