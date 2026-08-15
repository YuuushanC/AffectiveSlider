export type Step = "clip" | "roi" | "annotate";
export type Mode = "valence" | "arousal" | null;

export interface Rect {
  x: number;
  y: number;
  size: number;
}

export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface HeadPose {
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
}

export interface AnnotationSample {
  sampleIndex: number;
  targetTime: number;
  sourceFrameIndex: number | null;
  sourceTimestamp: number | null;
  valenceRaw: number | null;
  arousalRaw: number | null;
  faceDetected: boolean;
  identityMatch: boolean;
  roiOverlap: number | null;
  detectionConfidence: number | null;
  trackingConfidence: number | null;
  qualityFlags: string[];
  interpolated: boolean;
  exclusionReason: string | null;
  roi: Rect | null;
  landmarks: Point[];
  normalizedLandmarks: Point[];
  headPose: HeadPose;
  geometry: Record<string, number>;
  blendshapes: Record<string, number>;
}

export interface AuditEvent {
  event: "pause" | "play" | "seek" | "label_change" | "dropped_sample" | "track_reacquired";
  mediaTime: number;
  recordedAt: string;
  mode: Mode;
  detail?: string;
}

export interface InvalidFaceSegment {
  startSampleIndex: number;
  endSampleIndex: number;
  startTimeSec: number;
  endTimeSec: number;
  sampleCount: number;
  reasons: string[];
}

export interface FeatureQaReport {
  passed: boolean;
  sampleCount: number;
  validFaceCount: number;
  invalidFaceCount: number;
  validFaceRate: number;
  featureVariation: number;
  invalidReasonCounts: Record<string, number>;
  invalidFaceSegments: InvalidFaceSegment[];
  rejectionReasons: string[];
}

export interface SessionMetadata {
  participantId: string;
  sessionId: string;
  stimulusId: string;
  trialId: string;
  anonymousVideoId: string;
  biologicalSex: string;
  stimulusEmotion: string;
  stimulusOrder: number;
  experimentalCondition: string;
  sourceVideoSizeBytes: number;
  videoDurationSec: number;
  clipStartSec: number;
  clipEndSec: number;
  sourceFps: number | null;
  samplingHz: number;
  annotationDelaySec: number;
  smoothingWindowSec: number;
  annotatedAt: string;
  toolVersion: string;
  landmarkModelVersion: string;
  schemaVersion: string;
  processingVersion: string;
  protocolVersion: string;
  targetConstruct: string;
  browserFamily: string;
  browserMajorVersion: string | null;
  operatingSystem: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  touchPoints: number;
}

export interface QaReport {
  passed: boolean;
  sampleCount: number;
  expectedSampleCount: number;
  timelineCompleteness: number;
  labelCompleteness: number;
  validFaceRate: number;
  processedLabelCompleteness: number;
  featureVariation: number;
  duplicateSampleIndices: number[];
  unexpectedSampleIndices: number[];
  irregularTimeSteps: number[];
  missingFaceSamples: number[];
  missingLabelSamples: number[];
  invalidIdentitySamples: number[];
  invalidSourceTimeSamples: number[];
  nonFiniteFeatureSamples: number[];
  invalidReasonCounts: Record<string, number>;
  invalidFaceSegments: InvalidFaceSegment[];
  warnings: string[];
  constantValenceRuns: number;
  constantArousalRuns: number;
  valenceJumps: number;
  arousalJumps: number;
  rejectionReasons: string[];
}
