import { armIndices, LANDMARK } from "./landmarkIndices";
import type { FrameLandmarks, Handedness, MetricResult, Point2D, StrokeAnalysisResult } from "./types";

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function spatialStd(points: Point2D[]): number {
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  const varX = mean(points.map((p) => (p.x - mx) ** 2));
  const varY = mean(points.map((p) => (p.y - my) ** 2));
  return Math.sqrt(varX + varY);
}

// PCA on 2D points: returns unit direction of largest-variance axis and centroid.
function principalAxis(points: Point2D[]): { centroid: Point2D; direction: Point2D } {
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function scoreLabel(score: number): string {
  if (score >= 85) return "良好";
  if (score >= 70) return "ほぼ良好";
  if (score >= 50) return "要改善";
  return "要修正";
}

export function analyzeStroke(frames: FrameLandmarks[], hand: Handedness): StrokeAnalysisResult | null {
  if (frames.length < 5) return null;

  const { elbow, wrist } = armIndices(hand);

  const shoulderWidths = frames.map((f) =>
    dist(f.landmarks[LANDMARK.LEFT_SHOULDER], f.landmarks[LANDMARK.RIGHT_SHOULDER])
  );
  const scale = mean(shoulderWidths) || 0.2;

  const elbowPoints = frames.map((f) => f.landmarks[elbow]);
  const wristPoints = frames.map((f) => f.landmarks[wrist]);
  const nosePoints = frames.map((f) => f.landmarks[LANDMARK.NOSE]);

  const metrics: MetricResult[] = [];

  // 1. Elbow stability — the elbow should act as a fixed pivot.
  const elbowRatio = spatialStd(elbowPoints) / scale;
  const elbowScore = clamp(100 - elbowRatio * 150, 0, 100);
  metrics.push({
    key: "elbow",
    label: "肘の安定性",
    score: Math.round(elbowScore),
    isGood: elbowScore >= 70,
    advice:
      elbowScore >= 70
        ? "肘が支点として安定しており、良いピボットができています。"
        : "ストローク中に肘の位置が動いています。肘を固定し、前腕だけを振り子のように動かす意識を持ちましょう。",
  });

  // 2. Wrist path straightness — the cueing hand should travel in a straight line.
  const { centroid, direction } = principalAxis(wristPoints);
  const normal = { x: -direction.y, y: direction.x };
  const perpDists = wristPoints.map((p) => Math.abs((p.x - centroid.x) * normal.x + (p.y - centroid.y) * normal.y));
  const rmsPerp = Math.sqrt(mean(perpDists.map((d) => d * d)));
  const straightnessRatio = rmsPerp / scale;
  const straightnessScore = clamp(100 - straightnessRatio * 300, 0, 100);
  metrics.push({
    key: "straightness",
    label: "手首軌道の直線性",
    score: Math.round(straightnessScore),
    isGood: straightnessScore >= 70,
    advice:
      straightnessScore >= 70
        ? "手首（キュー）の軌道がまっすぐ出ています。"
        : "手首の軌道が直線からずれています。グリップの力みを抜き、キューを真っ直ぐ引いて真っ直ぐ出すことを意識しましょう。",
  });

  const projected = wristPoints.map((p) => (p.x - centroid.x) * direction.x + (p.y - centroid.y) * direction.y);
  const minProj = Math.min(...projected);
  const maxProj = Math.max(...projected);
  const fittedLine: [Point2D, Point2D] = [
    { x: centroid.x + direction.x * minProj, y: centroid.y + direction.y * minProj },
    { x: centroid.x + direction.x * maxProj, y: centroid.y + direction.y * maxProj },
  ];

  // 3. Head / stance stability.
  const headRatio = spatialStd(nosePoints) / scale;
  const headScore = clamp(100 - headRatio * 250, 0, 100);
  metrics.push({
    key: "head",
    label: "頭・上体の安定性",
    score: Math.round(headScore),
    isGood: headScore >= 70,
    advice:
      headScore >= 70
        ? "頭・上体がしっかり静止できています。"
        : "打球時に頭や上体が動いています。狙いを定めたら最後まで頭を動かさず、目線を残す意識を持ちましょう。",
  });

  // 4. Tempo smoothness — count direction reversals along the swing axis.
  const velocities: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const dt = (frames[i].timeMs - frames[i - 1].timeMs) / 1000;
    if (dt <= 0) continue;
    velocities.push((projected[i] - projected[i - 1]) / dt);
  }
  const maxAbsV = Math.max(...velocities.map((v) => Math.abs(v)), 1e-6);
  const threshold = maxAbsV * 0.15;
  let signChanges = 0;
  let lastSign = 0;
  for (const v of velocities) {
    if (Math.abs(v) < threshold) continue;
    const sign = v > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) signChanges++;
    lastSign = sign;
  }
  const tempoScore = clamp(100 - Math.max(0, signChanges - 1) * 25, 0, 100);
  metrics.push({
    key: "tempo",
    label: "テンポの滑らかさ",
    score: Math.round(tempoScore),
    isGood: tempoScore >= 70,
    advice:
      tempoScore >= 70
        ? "バックスイングからの加速がなめらかです。"
        : "スイングの途中で速度の乱れ（迷い・ブレ）が見られます。バックスイングで軽く一時停止し、そこから一定になめらかに加速する意識を持ちましょう。",
  });

  const overallScore = Math.round(mean(metrics.map((m) => m.score)));

  return {
    overallScore,
    metrics: metrics.map((m) => ({ ...m, advice: `[${scoreLabel(m.score)}] ${m.advice}` })),
    wristPath: wristPoints,
    fittedLine,
  };
}
