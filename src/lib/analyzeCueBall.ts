import { clamp, dist, fitLineThrough, lineLength, mean, perpendicularDistances, scoreLabel } from "./mathUtils";
import type { CueBallAnalysisResult, CueBallFrame, MetricResult, Point2D } from "./types";

// Exported so the UI can rescore the cue metrics against a manually-edited
// ideal line, reusing the exact same formula as the automatic fit.
export function scoreCueMetrics(prePath: Point2D[], line: [Point2D, Point2D], ballPosition: Point2D): MetricResult[] {
  const pathLength = lineLength(line);

  const rmsPerp = Math.sqrt(mean(perpendicularDistances(prePath, line).map((d) => d * d)));
  const straightnessRatio = rmsPerp / pathLength;
  const straightnessScore = clamp(100 - straightnessRatio * 500, 0, 100);

  const offsetDist = perpendicularDistances([ballPosition], line)[0];
  const offsetRatio = offsetDist / pathLength;
  const offsetScore = clamp(100 - offsetRatio * 400, 0, 100);

  return [
    {
      key: "cue-straightness",
      label: "キュー軌道の直線性（実測）",
      score: Math.round(straightnessScore),
      isGood: straightnessScore >= 70,
      advice: `[${scoreLabel(straightnessScore)}] ${
        straightnessScore >= 70
          ? "キューがまっすぐ出ています。"
          : "キューの軌道が曲がっています。グリップを緩め、肘を支点にまっすぐ引き通すことを意識しましょう。"
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
}

export function analyzeCueBall(frames: CueBallFrame[]): CueBallAnalysisResult | null {
  if (frames.length < 5) return null;

  let contactIndex = 0;
  let minDist = Infinity;
  frames.forEach((f, i) => {
    const d = dist(f.cueFar, f.ball);
    if (d < minDist) {
      minDist = d;
      contactIndex = i;
    }
  });

  const cuePathAll = frames.map((f) => f.cueFar);
  const cuePathPre = frames.slice(0, contactIndex + 1).map((f) => f.cueFar);
  const prePath = cuePathPre.length >= 4 ? cuePathPre : cuePathAll;

  const fittedLine = fitLineThrough(prePath);
  const ballAtContact = frames[contactIndex].ball;
  const metrics = scoreCueMetrics(prePath, fittedLine, ballAtContact);

  return {
    metrics,
    cuePath: cuePathAll,
    prePath,
    fittedLine,
    ballPosition: ballAtContact,
    contactIndex,
  };
}
