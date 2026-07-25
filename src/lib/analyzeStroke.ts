import { armIndices, LANDMARK } from "./landmarkIndices";
import { clamp, dist, mean, perpendicularDistances, principalAxis, scoreLabel } from "./mathUtils";
import type { FrameLandmarks, Handedness, MetricResult, Point2D, StrokeAnalysisResult, ViewAngle } from "./types";

function spatialStd(points: Point2D[]): number {
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  const varX = mean(points.map((p) => (p.x - mx) ** 2));
  const varY = mean(points.map((p) => (p.y - my) ** 2));
  return Math.sqrt(varX + varY);
}

const COPY = {
  side: {
    elbow: {
      label: "肘の安定性",
      good: "肘が支点として安定しており、良いピボットができています。",
      bad: "ストローク中に肘の位置が動いています。肘を固定し、前腕だけを振り子のように動かす意識を持ちましょう。",
    },
    wrist: {
      label: "手首軌道の直線性",
      good: "手首（キュー）の軌道がまっすぐ出ています。",
      bad: "手首の軌道が直線からずれています。グリップの力みを抜き、キューを真っ直ぐ引いて真っ直ぐ出すことを意識しましょう。",
    },
    head: {
      label: "頭・上体の安定性",
      good: "頭・上体がしっかり静止できています。",
      bad: "打球時に頭や上体が動いています。狙いを定めたら最後まで頭を動かさず、目線を残す意識を持ちましょう。",
    },
  },
  front: {
    elbow: {
      label: "肘の横ブレ（脇の締まり）",
      good: "肘が体の近くで安定しており、脇が締まっています。",
      bad: "ストローク中に肘が外側へ開いています。脇を締め、肘を体の近くに保ったまま振りましょう。",
    },
    wrist: {
      label: "手首の左右ブレ（キューの直進性）",
      good: "手首が左右にブレず、キューがまっすぐ出ています。",
      bad: "手首が左右にブレています。ストローク中にキューが体の正面から逸れていないか、鏡や動画で確認しましょう。",
    },
    head: {
      label: "頭・上体の安定性",
      good: "頭・上体が左右にブレず安定しています。",
      bad: "打球時に頭や上体が左右に動いています。狙いを定めたら最後まで頭を動かさず、目線を残す意識を持ちましょう。",
    },
  },
} as const;

// Exported so the UI can rescore the wrist-straightness card against a
// manually-edited ideal line, reusing the exact same formula/copy as the
// automatic fit.
export function scoreWristStraightness(
  wristPath: Point2D[],
  line: [Point2D, Point2D],
  scale: number,
  viewAngle: ViewAngle
): MetricResult {
  const copy = COPY[viewAngle].wrist;
  const rmsPerp = Math.sqrt(mean(perpendicularDistances(wristPath, line).map((d) => d * d)));
  const ratio = rmsPerp / scale;
  const score = clamp(100 - ratio * 300, 0, 100);
  return {
    key: "straightness",
    label: copy.label,
    score: Math.round(score),
    isGood: score >= 70,
    advice: `[${scoreLabel(score)}] ${score >= 70 ? copy.good : copy.bad}`,
  };
}

export function analyzeStroke(frames: FrameLandmarks[], hand: Handedness, viewAngle: ViewAngle): StrokeAnalysisResult | null {
  if (frames.length < 5) return null;

  const copy = COPY[viewAngle];
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
    label: copy.elbow.label,
    score: Math.round(elbowScore),
    isGood: elbowScore >= 70,
    advice: elbowScore >= 70 ? copy.elbow.good : copy.elbow.bad,
  });

  // 2. Wrist path straightness — the cueing hand should travel in a straight line.
  const { centroid, direction } = principalAxis(wristPoints);
  const projected = wristPoints.map((p) => (p.x - centroid.x) * direction.x + (p.y - centroid.y) * direction.y);
  const minProj = Math.min(...projected);
  const maxProj = Math.max(...projected);
  const fittedLine: [Point2D, Point2D] = [
    { x: centroid.x + direction.x * minProj, y: centroid.y + direction.y * minProj },
    { x: centroid.x + direction.x * maxProj, y: centroid.y + direction.y * maxProj },
  ];
  const straightnessMetric = scoreWristStraightness(wristPoints, fittedLine, scale, viewAngle);
  metrics.push(straightnessMetric);

  // 3. Head / stance stability.
  const headRatio = spatialStd(nosePoints) / scale;
  const headScore = clamp(100 - headRatio * 250, 0, 100);
  metrics.push({
    key: "head",
    label: copy.head.label,
    score: Math.round(headScore),
    isGood: headScore >= 70,
    advice: headScore >= 70 ? copy.head.good : copy.head.bad,
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

  const namedMetrics = metrics.map((m) =>
    m.key === "straightness" ? m : { ...m, advice: `[${scoreLabel(m.score)}] ${m.advice}` }
  );
  const overallScore = Math.round(mean(namedMetrics.map((m) => m.score)));

  return {
    overallScore,
    metrics: namedMetrics,
    wristPath: wristPoints,
    fittedLine,
    scale,
  };
}
