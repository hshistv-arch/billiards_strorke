// MediaPipe Pose landmark indices (33-point model)
export const LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

export function armIndices(hand: "right" | "left") {
  return hand === "right"
    ? { shoulder: LANDMARK.RIGHT_SHOULDER, elbow: LANDMARK.RIGHT_ELBOW, wrist: LANDMARK.RIGHT_WRIST }
    : { shoulder: LANDMARK.LEFT_SHOULDER, elbow: LANDMARK.LEFT_ELBOW, wrist: LANDMARK.LEFT_WRIST };
}
