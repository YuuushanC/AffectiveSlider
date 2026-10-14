import { describe, expect, it } from "vitest";
import { advanceTrackingRoi, faceSearchPlan, isPlausibleTrack, trackedRoiForTime } from "./tracking";
import type { AnnotationSample, Rect } from "../types";

const sample = (sampleIndex: number, roi: Rect | null, valid = true): AnnotationSample => ({
  sampleIndex,
  targetTime: 2 + sampleIndex / 10,
  sourceFrameIndex: null,
  sourceTimestamp: 2 + sampleIndex / 10,
  valenceRaw: null,
  arousalRaw: null,
  faceDetected: valid,
  identityMatch: valid,
  roiOverlap: valid ? 0.5 : null,
  detectionConfidence: null,
  trackingConfidence: null,
  qualityFlags: [],
  interpolated: false,
  exclusionReason: null,
  roi,
  landmarks: [],
  normalizedLandmarks: [],
  headPose: { pitch: null, yaw: null, roll: null },
  geometry: {},
  blendshapes: {},
});

describe("dynamic face tracking", () => {
  it("selects the ROI nearest to the current canonical 10 Hz sample", () => {
    const samples = new Map([
      [0, sample(0, { x: 10, y: 20, size: 100 })],
      [1, sample(1, { x: 30, y: 20, size: 100 })],
      [2, sample(2, { x: 50, y: 20, size: 100 })],
    ]);
    expect(trackedRoiForTime(samples, 2.11, 2, 10)?.x).toBe(30);
    expect(trackedRoiForTime(samples, 2.19, 2, 10)?.x).toBe(50);
  });

  it("does not draw a stale box when the current sample has no valid face", () => {
    const samples = new Map([
      [0, sample(0, { x: 10, y: 20, size: 100 })],
      [1, sample(1, null, false)],
    ]);
    expect(trackedRoiForTime(samples, 2.1, 2, 10)).toBeNull();
  });

  it("accepts continuous movement and rejects an implausible identity jump", () => {
    const previous = { x: 100, y: 100, size: 120 };
    expect(isPlausibleTrack(previous, { x: 155, y: 105, size: 110 })).toBe(true);
    expect(isPlausibleTrack(previous, { x: 500, y: 100, size: 110 })).toBe(false);
  });

  it("advances and smooths the next search window", () => {
    const next = advanceTrackingRoi(
      { x: 100, y: 100, size: 100 },
      { x: 140, y: 120, size: 120 },
      640,
      480,
    );
    expect(next.x).toBeGreaterThan(100);
    expect(next.x).toBeLessThan(140);
    expect(next.y).toBeGreaterThan(100);
    expect(next.size).toBeGreaterThan(100);
    expect(next.size).toBeLessThan(120);
  });

  it("escalates from tracked crop to full-frame reacquisition", () => {
    expect(faceSearchPlan(0).mode).toBe("tracked");
    expect(faceSearchPlan(1).mode).toBe("expanded");
    expect(faceSearchPlan(2).mode).toBe("wide");
    expect(faceSearchPlan(3)).toMatchObject({ mode: "full_frame", fullFrame: true });
    expect(faceSearchPlan(20).mode).toBe("full_frame");
  });

  it("uses a controlled wider identity tolerance only during reacquisition", () => {
    const previous = { x: 100, y: 100, size: 100 };
    const moved = { x: 240, y: 100, size: 100 };
    expect(isPlausibleTrack(previous, moved)).toBe(false);
    expect(isPlausibleTrack(previous, moved, faceSearchPlan(2).maximumNormalizedDistance)).toBe(true);
  });
});
