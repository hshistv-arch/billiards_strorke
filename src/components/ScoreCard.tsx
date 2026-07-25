import type { MetricResult } from "../lib/types";

function barColor(score: number): string {
  if (score >= 85) return "#4ADE80";
  if (score >= 70) return "#A3E635";
  if (score >= 50) return "#FBBF24";
  return "#F87171";
}

export function ScoreCard({ metric }: { metric: MetricResult }) {
  return (
    <div className="score-card">
      <div className="score-card-header">
        <span className="score-card-label">{metric.label}</span>
        <span className="score-card-value">{metric.score}</span>
      </div>
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{ width: `${metric.score}%`, backgroundColor: barColor(metric.score) }}
        />
      </div>
      <p className="score-card-advice">{metric.advice}</p>
    </div>
  );
}
