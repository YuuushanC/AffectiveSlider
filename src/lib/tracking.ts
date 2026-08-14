import type { AnnotationSample, Rect } from "../types";

export function trackedRoiForTime(
  samples: Map<number, AnnotationSample>,
  mediaTime: number,
  clipStart: number,
  samplingHz: number,
): Rect | null {
  if (!samples.size || !Number.isFinite(mediaTime) || samplingHz <= 0) return null;
  const lastIndex = Math.max(...samples.keys());
  const sampleIndex = Math.min(lastIndex, Math.max(0, Math.round((mediaTime - clipStart) * samplingHz)));
  const sample = samples.get(sampleIndex);
  if (!sample?.faceDetected || !sample.identityMatch || !sample.roi) return null;
  return sample.roi;
}

export function isPlausibleTrack(expected: Rect, detected: Rect) {
  const expectedCenterX = expected.x + expected.size / 2;
  const expectedCenterY = expected.y + expected.size / 2;
  const detectedCenterX = detected.x + detected.size / 2;
  const detectedCenterY = detected.y + detected.size / 2;
  const normalizedDistance = Math.hypot(
    detectedCenterX - expectedCenterX,
    detectedCenterY - expectedCenterY,
  ) / Math.max(expected.size, detected.size, 1);
  const sizeRatio = detected.size / Math.max(expected.size, 1);
  return normalizedDistance <= 0.85 && sizeRatio >= 0.25 && sizeRatio <= 2.5;
}

export function advanceTrackingRoi(previous: Rect, detected: Rect, width: number, height: number): Rect {
  const detectedWeight = 0.78;
  const previousWeight = 1 - detectedWeight;
  const size = Math.min(
    Math.max(previous.size * previousWeight + detected.size * detectedWeight, 24),
    Math.min(width, height),
  );
  const x = previous.x * previousWeight + detected.x * detectedWeight;
  const y = previous.y * previousWeight + detected.y * detectedWeight;
  return {
    x: Math.min(Math.max(x, 0), width - size),
    y: Math.min(Math.max(y, 0), height - size),
    size,
  };
}
