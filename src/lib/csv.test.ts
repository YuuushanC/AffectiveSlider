import { describe, expect, it } from "vitest";
import { buildCsv, buildQaReport, createTimeline, smoothLabels } from "./csv";
import { LANDMARK_COUNT } from "./facePipeline";
import type { AnnotationSample, SessionMetadata } from "../types";

const complete = (sample: AnnotationSample): AnnotationSample => ({
  ...sample,
  valenceRaw: sample.sampleIndex / 10,
  arousalRaw: -sample.sampleIndex / 10,
  faceDetected: true,
  qualityFlags: [],
  landmarks: Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: i, y: i + 1, z: i + 2 })),
  normalizedLandmarks: Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: i / 10, y: i / 20, z: 0 })),
});

describe("canonical 10 Hz dataset", () => {
  it("creates a deterministic inclusive timeline", () => {
    const first = [...createTimeline(2.25, 3.25).values()];
    const second = [...createTimeline(2.25, 3.25).values()];
    expect(first).toEqual(second);
    expect(first).toHaveLength(11);
    expect(first.map((s) => s.sampleIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(first.at(-1)?.targetTime).toBe(3.25);
  });

  it("preserves every row and reports missing labels/faces", () => {
    const samples = [...createTimeline(0, 0.2).values()];
    const qa = buildQaReport(samples, 3);
    expect(qa.passed).toBe(false);
    expect(qa.missingLabelSamples).toEqual([0, 1, 2]);
    expect(qa.missingFaceSamples).toEqual([0, 1, 2]);
  });

  it("passes complete data and rejects duplicate keys", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    expect(buildQaReport(samples, 10).passed).toBe(true);
    expect(buildQaReport([...samples, samples[0]], 10).rejectionReasons).toContain("存在重複 sample_index");
  });

  it("applies a fixed response-delay shift without altering raw labels", () => {
    const samples = [...createTimeline(0, 0.4).values()].map((s, i) => ({ ...s, valenceRaw: i, arousalRaw: i }));
    const shifted = smoothLabels(samples, 1, 2);
    expect(shifted[0].valenceSmoothed).toBe(2);
    expect(samples[0].valenceRaw).toBe(0);
  });

  it("exports one CSV row per canonical sample", () => {
    const samples = [...createTimeline(0, 0.2).values()].map(complete);
    const metadata = {
      participantId: "001", sessionId: "001-01", stimulusId: "s1", trialId: "t1",
      anonymousVideoId: "v1", biologicalSex: "F", stimulusEmotion: "happy", stimulusOrder: 1,
      experimentalCondition: "test", videoOriginalName: "private.mp4", videoDurationSec: 0.2,
      clipStartSec: 0, clipEndSec: 0.2, sourceFps: null, samplingHz: 10, annotationDelaySec: 0,
      smoothingWindowSec: 0.5, annotatedAt: "2026-01-01T00:00:00Z", toolVersion: "test",
      landmarkModelVersion: "test", schemaVersion: "2", processingVersion: "test",
    } satisfies SessionMetadata;
    expect(buildCsv(samples, metadata).split("\n")).toHaveLength(4);
  });
});
