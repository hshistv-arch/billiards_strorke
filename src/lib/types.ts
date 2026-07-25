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

// Both cue points are seeded from the near side of the shaft (close to the
// grip hand), not the tip out by the ball — easier to tap accurately and less
// likely to leave frame or blur during the swing. cueNear is tapped first
// (closest to the hand), cueFar a little further along toward the ball.
export interface CueBallFrame {
  timeMs: number;
  ball: Point2D;
  cueNear: Point2D;
  cueFar: Point2D;
  ballConfidence: number;
  cueNearConfidence: number;
  cueFarConfidence: number;
}

export interface CueBallAnalysisResult {
  metrics: MetricResult[];
  cuePath: Point2D[];
  prePath: Point2D[];
  fittedLine: [Point2D, Point2D] | null;
  ballPosition: Point2D;
  contactIndex: number;
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
  cueBallMetrics?: SavedMetric[];
}
