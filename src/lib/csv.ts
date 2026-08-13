import { LANDMARK_COUNT } from "./facePipeline";
import type { AnnotationSample, AuditEvent, QaReport, SessionMetadata } from "../types";

const GEOMETRY_HEADERS = [
  "face_width", "eye_distance", "left_eye_open", "right_eye_open",
  "mouth_width", "mouth_open", "nose_to_mouth",
];

const value = (input: number | string | boolean | null | undefined) => {
  if (input === null || input === undefined) return "";
  if (typeof input === "number") return Number.isFinite(input) ? input.toFixed(6).replace(/\.?0+$/, "") : "";
  if (typeof input === "boolean") return input ? "1" : "0";
  return `"${String(input).replace(/"/g, '""')}"`;
};

export function createTimeline(clipStart: number, clipEnd: number, samplingHz = 10): Map<number, AnnotationSample> {
  const count = Math.floor((clipEnd - clipStart) * samplingHz) + 1;
  return new Map(Array.from({ length: Math.max(0, count) }, (_, sampleIndex) => {
    const targetTime = Number((clipStart + sampleIndex / samplingHz).toFixed(6));
    return [sampleIndex, {
      sampleIndex,
      targetTime,
      sourceFrameIndex: null,
      sourceTimestamp: null,
      valenceRaw: null,
      arousalRaw: null,
      faceDetected: false,
      detectionConfidence: null,
      trackingConfidence: null,
      qualityFlags: ["not_processed"],
      interpolated: false,
      exclusionReason: null,
      roi: null,
      landmarks: [],
      normalizedLandmarks: [],
      headPose: { pitch: null, yaw: null, roll: null },
      geometry: {},
    }];
  }));
}

export function smoothLabels(samples: AnnotationSample[], windowSamples = 5, delaySamples = 0) {
  const radius = Math.floor(windowSamples / 2);
  const meanAt = (key: "valenceRaw" | "arousalRaw", index: number) => {
    const values = samples.slice(Math.max(0, index - radius), index + radius + 1)
      .map((sample) => sample[key]).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  return samples.map((sample, index) => ({
    // A response recorded later is shifted backward to the stimulus time it describes.
    valenceSmoothed: meanAt("valenceRaw", index + delaySamples),
    arousalSmoothed: meanAt("arousalRaw", index + delaySamples),
  }));
}

export function buildQaReport(samples: AnnotationSample[], expectedCount: number): QaReport {
  const seen = new Set<number>();
  const duplicates: number[] = [];
  const irregular: number[] = [];
  const missingFace: number[] = [];
  const missingLabel: number[] = [];
  const validTimelineIndices = new Set<number>();
  let validLabels = 0;
  let validFaces = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (seen.has(sample.sampleIndex)) duplicates.push(sample.sampleIndex);
    seen.add(sample.sampleIndex);
    if (sample.sampleIndex >= 0 && sample.sampleIndex < expectedCount && Number.isFinite(sample.targetTime)) validTimelineIndices.add(sample.sampleIndex);
    if (index > 0 && Math.abs(sample.targetTime - samples[index - 1].targetTime - 0.1) > 0.001) irregular.push(sample.sampleIndex);
    if (sample.valenceRaw === null || sample.arousalRaw === null) missingLabel.push(sample.sampleIndex);
    else validLabels += 1;
    if (!sample.faceDetected || sample.landmarks.length !== LANDMARK_COUNT) missingFace.push(sample.sampleIndex);
    else validFaces += 1;
  }
  const denominator = Math.max(1, expectedCount);
  const timelineCompleteness = validTimelineIndices.size / denominator;
  const labelCompleteness = validLabels / denominator;
  const validFaceRate = validFaces / denominator;
  const rejectionReasons: string[] = [];
  if (timelineCompleteness < 0.99) rejectionReasons.push("時間軸完整率低於 99%");
  if (labelCompleteness < 0.99) rejectionReasons.push("V/A 標註完整率低於 99%");
  if (validFaceRate < 0.95) rejectionReasons.push("有效臉部特徵率低於 95%");
  if (duplicates.length) rejectionReasons.push("存在重複 sample_index");
  if (irregular.length) rejectionReasons.push("時間步長不是固定 0.1 秒");
  return {
    passed: rejectionReasons.length === 0,
    sampleCount: samples.length,
    expectedSampleCount: expectedCount,
    timelineCompleteness,
    labelCompleteness,
    validFaceRate,
    duplicateSampleIndices: duplicates,
    irregularTimeSteps: irregular,
    missingFaceSamples: missingFace,
    missingLabelSamples: missingLabel,
    constantValenceRuns: countConstantRuns(samples.map((s) => s.valenceRaw)),
    constantArousalRuns: countConstantRuns(samples.map((s) => s.arousalRaw)),
    valenceJumps: countJumps(samples.map((s) => s.valenceRaw)),
    arousalJumps: countJumps(samples.map((s) => s.arousalRaw)),
    rejectionReasons,
  };
}

export function buildCsv(samples: AnnotationSample[], metadata: SessionMetadata) {
  const rawHeaders = Array.from({ length: LANDMARK_COUNT }, (_, i) => [`lm${i}_x`, `lm${i}_y`, `lm${i}_z`]).flat();
  const normalizedHeaders = Array.from({ length: LANDMARK_COUNT }, (_, i) => [`nlm${i}_x`, `nlm${i}_y`, `nlm${i}_z`]).flat();
  const headers = [
    "participant_id", "session_id", "stimulus_id", "trial_id", "anonymous_video_id",
    "sample_index", "target_time_sec", "source_frame_index", "source_timestamp_sec",
    "valence_raw", "arousal_raw", "valence_smoothed", "arousal_smoothed", "label_valid",
    "face_detected", "detection_confidence", "tracking_confidence", "quality_flags",
    "interpolated", "exclusion_reason", "roi_x", "roi_y", "roi_size",
    "head_pitch_deg", "head_yaw_deg", "head_roll_deg",
    ...rawHeaders, ...normalizedHeaders, ...GEOMETRY_HEADERS,
    "tool_version", "landmark_model_version", "schema_version", "processing_version",
  ];
  const smoothed = smoothLabels(
    samples,
    Math.max(1, Math.round(metadata.smoothingWindowSec * metadata.samplingHz)),
    Math.max(0, Math.round(metadata.annotationDelaySec * metadata.samplingHz)),
  );
  const rows = samples.map((sample, index) => {
    const raw = flattenPoints(sample.landmarks);
    const normalized = flattenPoints(sample.normalizedLandmarks);
    return [
      metadata.participantId, metadata.sessionId, metadata.stimulusId, metadata.trialId, metadata.anonymousVideoId,
      sample.sampleIndex, sample.targetTime, sample.sourceFrameIndex, sample.sourceTimestamp,
      sample.valenceRaw, sample.arousalRaw, smoothed[index].valenceSmoothed, smoothed[index].arousalSmoothed,
      sample.valenceRaw !== null && sample.arousalRaw !== null,
      sample.faceDetected, sample.detectionConfidence, sample.trackingConfidence, sample.qualityFlags.join("|"),
      sample.interpolated, sample.exclusionReason, sample.roi?.x, sample.roi?.y, sample.roi?.size,
      sample.headPose.pitch, sample.headPose.yaw, sample.headPose.roll,
      ...pad(raw, LANDMARK_COUNT * 3), ...pad(normalized, LANDMARK_COUNT * 3),
      ...GEOMETRY_HEADERS.map((key) => sample.geometry[key]),
      metadata.toolVersion, metadata.landmarkModelVersion, metadata.schemaVersion, metadata.processingVersion,
    ].map(value).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

export function buildMetadata(metadata: SessionMetadata, events: AuditEvent[], qa: QaReport) {
  return JSON.stringify({ metadata, auditEvents: events, qa }, null, 2);
}

export function downloadText(content: string, filename: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const flattenPoints = (points: AnnotationSample["landmarks"]) => points.flatMap((p) => [p.x, p.y, p.z ?? 0]);
const pad = (values: number[], size: number) => [...values, ...Array(Math.max(0, size - values.length)).fill(null)].slice(0, size);

function countJumps(values: Array<number | null>) {
  let count = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== null && values[i - 1] !== null && Math.abs(values[i]! - values[i - 1]!) > 0.5) count += 1;
  }
  return count;
}

function countConstantRuns(values: Array<number | null>, minimum = 50) {
  let count = 0;
  let run = 1;
  for (let i = 1; i <= values.length; i += 1) {
    if (i < values.length && values[i] !== null && values[i] === values[i - 1]) run += 1;
    else {
      if (run >= minimum) count += 1;
      run = 1;
    }
  }
  return count;
}
