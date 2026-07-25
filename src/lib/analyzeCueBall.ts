import { clamp, dist, fitLineThrough, mean, principalAxis, scoreLabel } from "./mathUtils";
import type { CueBallAnalysisResult, CueBallFrame, MetricResult } from "./types";

export function analyzeCueBall(frames: CueBallFrame[]): CueBallAnalysisResult | null {
  if (frames.length < 5) return null;

  let contactIndex = 0;
  let minDist = Infinity;
  frames.forEach((f, i) => {
    const d = dist(f.cueTip, f.ball);
    if (d < minDist) {
      minDist = d;
      contactIndex = i;
    }
  });

  const cuePathAll = frames.map((f) => f.cueTip);
  const cuePathPre = frames.slice(0, contactIndex + 1).map((f) => f.cueTip);
  const usablePath = cuePathPre.length >= 4 ? cuePathPre : cuePathAll;

  const { centroid, direction } = principalAxis(usablePath);
  const normal = { x: -direction.y, y: direction.x };
  const projected = usablePath.map((p) => (p.x - centroid.x) * direction.x + (p.y - centroid.y) * direction.y);
  const pathLength = Math.max(...projected) - Math.min(...projected) || 1e-4;

  // 1. Cue tip path straightness, measured directly rather than inferred from the wrist joint.
  const perpDists = usablePath.map((p) => Math.abs((p.x - centroid.x) * normal.x + (p.y - centroid.y) * normal.y));
  const rmsPerp = Math.sqrt(mean(perpDists.map((d) => d * d)));
  const straightnessRatio = rmsPerp / pathLength;
  const straightnessScore = clamp(100 - straightnessRatio * 500, 0, 100);

  // 2. Center-hit accuracy: how far the ball sits from the cue's shot line at the moment of contact.
  const ballAtContact = frames[contactIndex].ball;
  const offsetDist = Math.abs((ballAtContact.x - centroid.x) * normal.x + (ballAtContact.y - centroid.y) * normal.y);
  const offsetRatio = offsetDist / pathLength;
  const offsetScore = clamp(100 - offsetRatio * 400, 0, 100);

  const metrics: MetricResult[] = [
    {
      key: "cue-straightness",
      label: "キュー軌道の直線性（実測）",
      score: Math.round(straightnessScore),
      isGood: straightnessScore >= 70,
      advice: `[${scoreLabel(straightnessScore)}] ${
        straightnessScore >= 70
          ? "キュー先端がまっすぐ出ています。"
          : "キュー先端の軌道が曲がっています。グリップを緩め、肘を支点にまっすぐ引き通すことを意識しましょう。"
      }`,
    },
    {
      key: "center-hit",
      label: "芯を捉えているか",
      score: Math.round(offsetScore),
      isGood: offsetScore >= 70,
      advice: `[${scoreLabel(offsetScore)}] ${
        offsetScore >= 70
          ? "ショットライン上でボールの芯付近を捉えられています。"
          : "ショットラインがボールの中心からずれています。構えの際にキューの延長線とボール中心が一致しているか確認しましょう。"
      }`,
    },
  ];

  return {
    metrics,
    cuePath: cuePathAll,
    fittedLine: fitLineThrough(usablePath),
    ballPosition: ballAtContact,
    contactIndex,
  };
}
