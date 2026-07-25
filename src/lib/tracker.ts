// Lightweight fixed-template block-matching tracker (no external CV dependency).
// A small grayscale patch captured at the seed frame is re-located each frame by
// searching a window around the previous frame's match (predictive search),
// which keeps the search cheap while avoiding template drift.

export interface GrayFrame {
  data: Float32Array;
  width: number;
  height: number;
}

export function toGrayFrame(imageData: ImageData): GrayFrame {
  const { data, width, height } = imageData;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { data: out, width, height };
}

function patchAt(frame: GrayFrame, cx: number, cy: number, half: number): Float32Array | null {
  const size = half * 2 + 1;
  const out = new Float32Array(size * size);
  const x0 = Math.round(cx) - half;
  const y0 = Math.round(cy) - half;
  if (x0 < 0 || y0 < 0 || x0 + size > frame.width || y0 + size > frame.height) return null;
  let p = 0;
  for (let y = 0; y < size; y++) {
    const rowOffset = (y0 + y) * frame.width + x0;
    for (let x = 0; x < size; x++) {
      out[p++] = frame.data[rowOffset + x];
    }
  }
  return out;
}

function ssd(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

export interface Template {
  patch: Float32Array;
  half: number;
}

export function captureTemplate(frame: GrayFrame, cx: number, cy: number, half: number): Template | null {
  const patch = patchAt(frame, cx, cy, half);
  if (!patch) return null;
  return { patch, half };
}

export interface TrackResult {
  x: number;
  y: number;
  confidence: number;
}

export function trackTemplate(
  frame: GrayFrame,
  template: Template,
  predictedCx: number,
  predictedCy: number,
  searchHalf: number
): TrackResult | null {
  let bestScore = Infinity;
  let bestX = predictedCx;
  let bestY = predictedCy;
  let found = false;

  for (let dy = -searchHalf; dy <= searchHalf; dy++) {
    for (let dx = -searchHalf; dx <= searchHalf; dx++) {
      const cx = predictedCx + dx;
      const cy = predictedCy + dy;
      const candidate = patchAt(frame, cx, cy, template.half);
      if (!candidate) continue;
      const score = ssd(template.patch, candidate);
      if (score < bestScore) {
        bestScore = score;
        bestX = cx;
        bestY = cy;
        found = true;
      }
    }
  }

  if (!found) return null;
  // Normalize SSD by patch size and pixel range (0-255) to get a rough 0..1 confidence.
  const patchSize = (template.half * 2 + 1) ** 2;
  const maxPossible = patchSize * 255 * 255;
  const confidence = 1 - Math.min(1, bestScore / (maxPossible * 0.05));
  return { x: bestX, y: bestY, confidence };
}
