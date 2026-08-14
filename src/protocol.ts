export const RESEARCH_PROTOCOL = Object.freeze({
  protocolVersion: "continuous-affect-v1",
  samplingHz: 10,
  smoothingWindowSec: 0.5,
  // Replace only after the pilot study, then bump protocolVersion. Never vary by participant/fold.
  annotationDelaySec: 0,
  minimumTimelineCompleteness: 0.99,
  minimumLabelCompleteness: 0.99,
  minimumValidFaceRate: 0.95,
  maximumSourceTimeErrorSec: 0.055,
  minimumWindowValidFaceRate: 0.95,
  maximumWindowConsecutiveMissing: 2,
  targetConstruct: "continuous_affect_trajectory",
});
