import { describe, expect, it } from "vitest";
import { buildCsv, buildFeatureQaReport, buildQaReport, createTimeline, reconstructCausalLabels, smoothLabels } from "./csv";
import { LANDMARK_COUNT } from "./facePipeline";
import { buildExportBundle } from "./exportBundle";
import { strFromU8, unzipSync } from "fflate";
import type { AnnotationSample, SessionMetadata } from "../types";

const complete = (sample: AnnotationSample): AnnotationSample => ({
  ...sample,
  valenceRaw: sample.sampleIndex / 10,
  arousalRaw: -sample.sampleIndex / 10,
  faceDetected: true,
  identityMatch: true,
  roiOverlap: 0.8,
  sourceTimestamp: sample.targetTime,
  qualityFlags: [],
  landmarks: Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: i + sample.sampleIndex * i * 0.0001, y: i + 1, z: i + 2 })),
  normalizedLandmarks: Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: i / 10 + sample.sampleIndex * i * 0.00001, y: i / 20, z: 0 })),
  blendshapes: { jawOpen: sample.sampleIndex / 10 },
});

const metadata = {
  participantId: "001", sessionId: "001-01", stimulusId: "s1", trialId: "t1",
  anonymousVideoId: "v1", biologicalSex: "F", stimulusEmotion: "happy", stimulusOrder: 1,
  experimentalCondition: "test", sourceVideoSizeBytes: 1234, videoDurationSec: 0.9,
  clipStartSec: 0, clipEndSec: 0.9, sourceFps: null, samplingHz: 10, annotationDelaySec: 0,
  smoothingWindowSec: 0.5, annotatedAt: "2026-01-01T00:00:00Z", toolVersion: "test",
  landmarkModelVersion: "test", schemaVersion: "2.1", processingVersion: "test",
  protocolVersion: "test", targetConstruct: "continuous_affect_trajectory",
  browserFamily: "Chrome", browserMajorVersion: "140", operatingSystem: "iPadOS",
  viewportWidth: 1024, viewportHeight: 768, devicePixelRatio: 2, touchPoints: 5,
} satisfies SessionMetadata;

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
    const qa = buildQaReport(samples, { ...metadata, clipEndSec: 0.2, videoDurationSec: 0.2 });
    expect(qa.passed).toBe(false);
    expect(qa.missingLabelSamples).toEqual([0, 1, 2]);
    expect(qa.missingFaceSamples).toEqual([0, 1, 2]);
    expect(qa.invalidReasonCounts).toMatchObject({ face_not_detected: 3, invalid_source_timestamp: 3 });
    expect(qa.invalidReasonCounts.identity_roi_mismatch).toBeUndefined();
  });

  it("passes complete data and rejects duplicate keys", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    expect(buildQaReport(samples, metadata).passed).toBe(true);
    expect(buildQaReport([...samples, samples[0]], metadata).rejectionReasons).toContain("存在重複 sample_index");
  });

  it("rejects samples outside the canonical timeline even if all expected rows exist", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    const extra = complete({ ...samples.at(-1)!, sampleIndex: 10, targetTime: 1 });
    const qa = buildQaReport([...samples, extra], metadata);
    expect(qa.unexpectedSampleIndices).toEqual([10]);
    expect(qa.rejectionReasons).toContain("樣本數量或 sample_index 超出 canonical 時間軸");
  });

  it("rejects a detected face that does not match the selected participant ROI", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    samples[0] = { ...samples[0], identityMatch: false, qualityFlags: ["identity_roi_mismatch"] };
    expect(buildQaReport(samples, metadata).invalidIdentitySamples).toEqual([0]);
  });

  it("reports feature QA before annotation with reason counts and time segments", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    for (const index of [2, 3]) samples[index] = { ...samples[index], qualityFlags: ["partially_out_of_crop"] };
    const qa = buildFeatureQaReport(samples);
    expect(qa.passed).toBe(false);
    expect(qa.validFaceRate).toBe(0.8);
    expect(qa.invalidReasonCounts.partially_out_of_crop).toBe(2);
    expect(qa.invalidFaceSegments).toEqual([{
      startSampleIndex: 2,
      endSampleIndex: 3,
      startTimeSec: 0.2,
      endTimeSec: 0.3,
      sampleCount: 2,
      reasons: ["partially_out_of_crop"],
    }]);
  });

  it("rejects non-finite or temporally misaligned features", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    samples[0] = { ...samples[0], sourceTimestamp: 0.2 };
    samples[1].normalizedLandmarks[0].x = Number.NaN;
    const qa = buildQaReport(samples, metadata);
    expect(qa.invalidSourceTimeSamples).toContain(0);
    expect(qa.nonFiniteFeatureSamples).toContain(1);
  });

  it("rejects source timestamps that are only inferred from currentTime", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    samples[0] = { ...samples[0], qualityFlags: ["source_timestamp_current_time_fallback"] };
    expect(buildQaReport(samples, metadata).invalidSourceTimeSamples).toContain(0);
  });

  it("rejects static normalized landmarks that cannot encode expression change", () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    const fixed = samples[0].normalizedLandmarks.map((point) => ({ ...point }));
    for (const sample of samples) sample.normalizedLandmarks = fixed.map((point) => ({ ...point }));
    const qa = buildQaReport(samples, metadata);
    expect(qa.rejectionReasons).toContain("正規化臉部特徵缺乏時間變異");
  });

  it("reconstructs labels causally without copying future slider values backward", () => {
    const samples = [...createTimeline(0, 0.4).values()];
    const labels = reconstructCausalLabels(samples, [
      { mediaTime: 0, value: -0.5 },
      { mediaTime: 0.21, value: 0.75 },
    ]);
    expect(labels).toEqual([-0.5, -0.5, -0.5, 0.75, 0.75]);
  });

  it("applies a fixed response-delay shift without altering raw labels", () => {
    const samples = [...createTimeline(0, 0.4).values()].map((s, i) => ({ ...s, valenceRaw: i, arousalRaw: i }));
    const shifted = smoothLabels(samples, 1, 2);
    expect(shifted[0].valenceSmoothed).toBe(2);
    expect(samples[0].valenceRaw).toBe(0);
  });

  it("exports one CSV row per canonical sample", () => {
    const samples = [...createTimeline(0, 0.2).values()].map(complete);
    expect(buildCsv(samples, { ...metadata, clipEndSec: 0.2, videoDurationSec: 0.2 }).split("\n")).toHaveLength(4);
  });

  it("packages one ZIP with dataset, QA metadata and checksums", async () => {
    const samples = [...createTimeline(0, 0.9).values()].map(complete);
    const qa = buildQaReport(samples, metadata);
    const bundle = await buildExportBundle(samples, metadata, [], qa);
    const files = unzipSync(new Uint8Array(await bundle.blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["dataset.csv", "manifest.json", "metadata_qa.json"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files.every((file: { sha256: string }) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  });

  it("excludes training CSV when QA fails", async () => {
    const samples = [...createTimeline(0, 0.9).values()];
    const qa = buildQaReport(samples, metadata);
    const bundle = await buildExportBundle(samples, metadata, [], qa);
    const files = unzipSync(new Uint8Array(await bundle.blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["manifest.json", "metadata_qa.json"]);
    const metadataQa = JSON.parse(strFromU8(files["metadata_qa.json"]));
    expect(metadataQa.qa.invalidReasonCounts.face_not_detected).toBe(10);
    expect(metadataQa.qa.invalidFaceSegments[0]).toMatchObject({
      startSampleIndex: 0,
      endSampleIndex: 9,
      sampleCount: 10,
    });
    expect(bundle.filename).toContain("qa-failed");
  });
});
