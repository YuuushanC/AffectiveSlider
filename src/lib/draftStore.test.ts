import { describe, expect, it } from "vitest";
import { normalizeDraft, type SessionDraft } from "./draftStore";
import { LABEL_SCALE_VERSION, PROCESSING_VERSION } from "../version";

const currentDraft = (): SessionDraft => ({
  draftVersion: 3,
  processingVersion: PROCESSING_VERSION,
  labelScaleVersion: LABEL_SCALE_VERSION,
  savedAt: "2026-01-01T00:00:00Z",
  videoFingerprint: "1:2:video/mp4",
  videoDurationSec: 10,
  clipStart: 1,
  clipEnd: 9,
  step: "annotate",
  roi: { x: 1, y: 2, size: 100 },
  samples: [{
    sampleIndex: 0,
    targetTime: 1,
    sourceFrameIndex: null,
    sourceTimestamp: 1,
    valenceRaw: 0,
    arousalRaw: 0,
    faceDetected: true,
    identityMatch: true,
    roiOverlap: 1,
    detectionConfidence: null,
    trackingConfidence: null,
    qualityFlags: [],
    interpolated: false,
    exclusionReason: null,
    roi: { x: 1, y: 2, size: 100 },
    landmarks: [],
    normalizedLandmarks: [],
    headPose: { pitch: null, yaw: null, roll: null },
    geometry: {},
    blendshapes: {},
  }],
  mode: "valence",
  valence: 0.5,
  arousal: 0.5,
  valenceDone: true,
  arousalDone: false,
  currentTime: 5,
  labelTrajectories: { valence: [{ mediaTime: 1, value: 0 }], arousal: [] },
  auditEvents: [],
  form: {
    gender: "F",
    participantId: "001",
    sequenceNumber: "01",
    sessionId: "001-01",
    stimulusId: "s1",
    trialId: "01",
    stimulusEmotion: "happy",
    experimentalCondition: "test",
  },
});

describe("draft processing version", () => {
  it("keeps a current draft unchanged", () => {
    const draft = currentDraft();
    expect(normalizeDraft(draft)).toBe(draft);
  });

  it("preserves setup but clears incompatible extracted features", () => {
    const draft = { ...currentDraft(), processingVersion: "old-processing" };
    const migrated = normalizeDraft(draft);
    expect(migrated.step).toBe("roi");
    expect(migrated.roi).toEqual(draft.roi);
    expect(migrated.form).toEqual(draft.form);
    expect(migrated.samples).toEqual([]);
    expect(migrated.valenceDone).toBe(false);
    expect(migrated.auditEvents.at(-1)?.detail).toBe("draft_processing_version_changed_reextract_required");
  });

  it("converts a current-processing legacy draft from -1..1 to 0..1", () => {
    const current = currentDraft();
    const legacy = {
      ...current,
      draftVersion: 2 as const,
      labelScaleVersion: undefined,
      valence: -1,
      arousal: 1,
      samples: [{ ...current.samples[0], valenceRaw: -0.5, arousalRaw: 0 }],
      labelTrajectories: { valence: [{ mediaTime: 1, value: -1 }], arousal: [{ mediaTime: 1, value: 1 }] },
    };
    const migrated = normalizeDraft(legacy);
    expect(migrated.draftVersion).toBe(3);
    expect(migrated.labelScaleVersion).toBe(LABEL_SCALE_VERSION);
    expect(migrated.valence).toBe(0);
    expect(migrated.arousal).toBe(1);
    expect(migrated.samples[0].valenceRaw).toBe(0.25);
    expect(migrated.samples[0].arousalRaw).toBe(0.5);
    expect(migrated.labelTrajectories.valence[0].value).toBe(0);
  });
});
