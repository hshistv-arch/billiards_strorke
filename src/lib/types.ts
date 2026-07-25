export interface Point2D {
  x: number;
  y: number;
}

export interface FrameLandmarks {
  timeMs: number;
  landmarks: Point2D[];
}

export type Handedness = "right" | "left";

export interface MetricResult {
  key: string;
  label: string;
  score: number;
  advice: string;
  isGood: boolean;
}

export interface StrokeAnalysisResult {
  overallScore: number;
  metrics: MetricResult[];
  wristPath: Point2D[];
  fittedLine: [Point2D, Point2D] | null;
}

export interface CueBallFrame {
  timeMs: number;
  ball: Point2D;
  cueTip: Point2D;
  ballConfidence: number;
  cueConfidence: number;
}

export interface CueBallAnalysisResult {
  metrics: MetricResult[];
  cuePath: Point2D[];
  fittedLine: [Point2D, Point2D] | null;
  ballPosition: Point2D;
  contactIndex: number;
}
