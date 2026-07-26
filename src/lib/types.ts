export interface Point2D {
  x: number;
  y: number;
}

export interface FrameLandmarks {
  timeMs: number;
  landmarks: Point2D[];
}

export type Handedness = "right" | "left";
export type ViewAngle = "side" | "front";

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
  scale: number;
}

export interface SavedMetric {
  label: string;
  score: number;
}

export interface SavedResult {
  id: string;
  savedAt: number;
  hand: Handedness;
  viewAngle: ViewAngle;
  overallScore: number;
  metrics: SavedMetric[];
  note?: string;
}
