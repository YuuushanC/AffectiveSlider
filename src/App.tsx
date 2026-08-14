import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  Check,
  Download,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  SquareDashedMousePointer,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Slider } from "./components/ui/slider";
import { buildQaReport, createTimeline, reconstructCausalLabels } from "./lib/csv";
import { readClientEnvironment, readCompatibilityIssues } from "./lib/clientEnvironment";
import { clearDraft, fingerprintVideo, loadDraft, saveDraft, type SessionDraft } from "./lib/draftStore";
import { buildExportBundle, downloadBlob } from "./lib/exportBundle";
import { clampRect, createFaceLandmarker, detectFace, LANDMARK_MODEL_VERSION } from "./lib/facePipeline";
import { advanceTrackingRoi, trackedRoiForTime } from "./lib/tracking";
import { RESEARCH_PROTOCOL } from "./protocol";
import type { AnnotationSample, AuditEvent, Mode, Rect, SessionMetadata, Step } from "./types";

const FPS = RESEARCH_PROTOCOL.samplingHz;
const round2 = (value: number) => Number(value.toFixed(2));
const formatTime = (value: number) => {
  if (!Number.isFinite(value)) return "00:00.0";
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  const ms = Math.floor((value % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${ms}`;
};

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<number | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const modeRef = useRef<Mode>(null);
  const valenceRef = useRef(0);
  const arousalRef = useRef(0);
  const eventsRef = useRef<AuditEvent[]>([]);
  const labelTrajectoryRef = useRef<Record<"valence" | "arousal", Array<{ mediaTime: number; value: number }>>>({ valence: [], arousal: [] });
  const extractionCancelledRef = useRef(false);
  const restoreCandidateRef = useRef<SessionDraft | null>(null);
  const extractionTrackedRoiRef = useRef<Rect | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [step, setStep] = useState<Step>("clip");
  const [roi, setRoi] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [valence, setValence] = useState(0);
  const [arousal, setArousal] = useState(0);
  const [valenceDone, setValenceDone] = useState(false);
  const [arousalDone, setArousalDone] = useState(false);
  const [samples, setSamples] = useState<Map<number, AnnotationSample>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [gender, setGender] = useState("M");
  const [participantId, setParticipantId] = useState("");
  const [sequenceNumber, setSequenceNumber] = useState("");
  const [exportError, setExportError] = useState("");
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [extractionError, setExtractionError] = useState("");
  const [annotationError, setAnnotationError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [stimulusId, setStimulusId] = useState("");
  const [trialId, setTrialId] = useState("01");
  const [stimulusEmotion, setStimulusEmotion] = useState("");
  const [experimentalCondition, setExperimentalCondition] = useState("personalized_reels");
  const [recoverableDraft, setRecoverableDraft] = useState<SessionDraft | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState("");
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    coarse: window.matchMedia("(pointer: coarse)").matches,
  }));

  const canExport = valenceDone && arousalDone && samples.size > 0;
  const progress = duration ? ((currentTime - clipStart) / Math.max(0.1, clipEnd - clipStart)) * 100 : 0;
  const sortedSamples = useMemo(() => [...samples.values()].sort((a, b) => a.sampleIndex - b.sampleIndex), [samples]);
  const compatibilityIssues = useMemo(() => readCompatibilityIssues(), []);
  const browserIncompatible = compatibilityIssues.length > 0;
  const stepIndex = step === "clip" ? 0 : step === "roi" ? 1 : 2;
  const activeLabel = mode === "valence" ? "Valence Recording" : mode === "arousal" ? "Arousal Recording" : step === "annotate" ? "Ready to Record" : step === "roi" ? "Face ROI" : "Video Trim";
  const tabletPortrait = viewport.height > viewport.width && viewport.width <= 1200;

  useEffect(() => {
    if (browserIncompatible) {
      setModelStatus("error");
      return;
    }
    let cancelled = false;
    createFaceLandmarker()
      .then((detector) => {
        if (cancelled) detector.close();
        else { landmarkerRef.current = detector; setModelStatus("ready"); }
      })
      .catch((error) => {
        if (!cancelled) { console.error(error); setModelStatus("error"); }
      });
    return () => { cancelled = true; };
  }, [browserIncompatible]);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { valenceRef.current = valence; }, [valence]);
  useEffect(() => { arousalRef.current = arousal; }, [arousal]);

  useEffect(() => {
    loadDraft()
      .then((draft) => setRecoverableDraft(draft))
      .catch(() => setDraftStatus("無法讀取本機暫存；請勿重新整理或關閉此頁。"));
  }, []);

  useEffect(() => {
    const updateViewport = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
      coarse: window.matchMedia("(pointer: coarse)").matches,
    });
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (!videoFile || duration <= 0 || exportSuccess) return;
    const timeout = window.setTimeout(() => {
      const draft: SessionDraft = {
        draftVersion: 1,
        savedAt: new Date().toISOString(),
        videoFingerprint: fingerprintVideo(videoFile),
        videoDurationSec: duration,
        clipStart,
        clipEnd,
        step,
        roi,
        samples: sortedSamples,
        mode,
        valence,
        arousal,
        valenceDone,
        arousalDone,
        currentTime: videoRef.current?.currentTime ?? currentTime,
        labelTrajectories: labelTrajectoryRef.current,
        auditEvents: eventsRef.current,
        form: { gender, participantId, sequenceNumber, sessionId, stimulusId, trialId, stimulusEmotion, experimentalCondition },
      };
      saveDraft(draft)
        .then(() => setDraftStatus(`已於 ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} 自動暫存（不含原始影片）`))
        .catch(() => setDraftStatus("本機暫存失敗；請確認瀏覽器仍有足夠儲存空間。"));
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [
    videoFile, duration, clipStart, clipEnd, step, roi, samples, mode, valence, arousal,
    valenceDone, arousalDone, gender, participantId, sequenceNumber, sessionId, stimulusId,
    trialId, stimulusEmotion, experimentalCondition, draftRevision, exportSuccess,
  ]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!videoFile || exportSuccess) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [videoFile, exportSuccess]);

  useEffect(() => {
    return () => {
      extractionCancelledRef.current = true;
      landmarkerRef.current?.close();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (drawRef.current) cancelAnimationFrame(drawRef.current);
    };
  }, [videoUrl]);

  useEffect(() => {
    const tick = () => {
      drawFrame();
      drawRef.current = requestAnimationFrame(tick);
    };
    drawRef.current = requestAnimationFrame(tick);
    return () => {
      if (drawRef.current) cancelAnimationFrame(drawRef.current);
    };
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (video.currentTime >= clipEnd && clipEnd > 0) {
        video.pause();
        setIsPlaying(false);
        video.currentTime = clipEnd;
        if (mode) finalizeLabels(mode);
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [clipEnd, mode]);

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    loadVideo(file);
  };

  const loadVideo = (file: File) => {
    void navigator.storage?.persist?.().catch(() => false);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setDuration(0);
    setClipStart(0);
    setClipEnd(0);
    setStep("clip");
    setRoi(null);
    setSamples(new Map());
    setValenceDone(false);
    setArousalDone(false);
    setMode(null);
    setCurrentTime(0);
    eventsRef.current = [];
    labelTrajectoryRef.current = { valence: [], arousal: [] };
    extractionCancelledRef.current = true;
    restoreCandidateRef.current = recoverableDraft?.videoFingerprint === fingerprintVideo(file) ? recoverableDraft : null;
    setExportSuccess("");
    if (recoverableDraft && !restoreCandidateRef.current) {
      setDraftStatus("選取的影片與未完成暫存不符，已開始新的 session；原暫存尚未刪除。");
    }
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    const draft = restoreCandidateRef.current;
    if (draft && Math.abs(draft.videoDurationSec - video.duration) <= 0.1) {
      setClipStart(draft.clipStart);
      setClipEnd(draft.clipEnd);
      setStep(draft.step);
      setRoi(draft.roi);
      setSamples(new Map(draft.samples.map((sample) => [sample.sampleIndex, sample])));
      setMode(draft.mode);
      modeRef.current = draft.mode;
      setValence(draft.valence);
      setArousal(draft.arousal);
      setValenceDone(draft.valenceDone);
      setArousalDone(draft.arousalDone);
      labelTrajectoryRef.current = draft.labelTrajectories;
      eventsRef.current = draft.auditEvents;
      setGender(draft.form.gender);
      setParticipantId(draft.form.participantId);
      setSequenceNumber(draft.form.sequenceNumber);
      setSessionId(draft.form.sessionId);
      setStimulusId(draft.form.stimulusId);
      setTrialId(draft.form.trialId);
      setStimulusEmotion(draft.form.stimulusEmotion);
      setExperimentalCondition(draft.form.experimentalCondition);
      const restoredTime = Math.min(Math.max(draft.currentTime, draft.clipStart), draft.clipEnd);
      video.currentTime = restoredTime;
      setCurrentTime(restoredTime);
      setDraftStatus(`已恢復 ${new Date(draft.savedAt).toLocaleString("zh-TW")} 的本機暫存`);
      setRecoverableDraft(null);
      restoreCandidateRef.current = null;
      return;
    }
    restoreCandidateRef.current = null;
    setClipEnd(video.duration);
    video.currentTime = 0;
  };

  const drawFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (step === "clip" && duration > 0) {
      drawTrimMask(ctx, canvas.width, canvas.height);
    }

    if (isExtracting) {
      if (extractionTrackedRoiRef.current) drawRoi(ctx, extractionTrackedRoiRef.current, true);
    } else if (step === "roi" && roi) {
      drawRoi(ctx, roi, false);
    } else if (step === "annotate") {
      const trackedRoi = trackedRoiForTime(samples, video.currentTime, clipStart, FPS);
      if (trackedRoi) drawRoi(ctx, trackedRoi, true);
    }
  };

  const drawTrimMask = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const startX = duration ? (clipStart / duration) * width : 0;
    const endX = duration ? (clipEnd / duration) * width : width;
    ctx.fillStyle = "rgba(4, 12, 20, 0.56)";
    ctx.fillRect(0, 0, startX, height);
    ctx.fillRect(endX, 0, width - endX, height);
  };

  const drawRoi = (ctx: CanvasRenderingContext2D, rect: Rect, tracked: boolean) => {
    ctx.save();
    ctx.strokeStyle = "#0f9f87";
    ctx.lineWidth = Math.max(3, rect.size * 0.01);
    ctx.setLineDash(tracked ? [] : [12, 8]);
    ctx.strokeRect(rect.x, rect.y, rect.size, rect.size);
    if (tracked) {
      const fontSize = Math.max(14, Math.min(24, rect.size * 0.075));
      const label = "TRACKED FACE";
      ctx.font = `700 ${fontSize}px sans-serif`;
      const labelWidth = ctx.measureText(label).width + 16;
      const labelY = Math.max(fontSize + 6, rect.y - 8);
      ctx.fillStyle = "#0f9f87";
      ctx.fillRect(rect.x, labelY - fontSize - 6, labelWidth, fontSize + 8);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, rect.x + 8, labelY - 4);
    }
    ctx.restore();
  };

  const pointerToVideo = (event: PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  const startRoi = (event: PointerEvent<HTMLDivElement>) => {
    if (step !== "roi") return;
    const point = pointerToVideo(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setRoi({ x: point.x, y: point.y, size: 1 });
  };

  const moveRoi = (event: PointerEvent<HTMLDivElement>) => {
    if (step !== "roi" || !dragStart) return;
    const point = pointerToVideo(event);
    const canvas = canvasRef.current;
    if (!point || !canvas) return;
    const size = Math.max(Math.abs(point.x - dragStart.x), Math.abs(point.y - dragStart.y));
    const x = point.x < dragStart.x ? dragStart.x - size : dragStart.x;
    const y = point.y < dragStart.y ? dragStart.y - size : dragStart.y;
    setRoi(clampRect({ x, y, size }, canvas.width, canvas.height));
  };

  const endRoi = () => {
    if (step !== "roi" || !roi || roi.size < 24) return;
    setDragStart(null);
  };

  const beginAnnotation = async () => {
    const video = videoRef.current;
    const selectedRoi = roi;
    if (!video || !selectedRoi || isExtracting) return;
    extractionCancelledRef.current = false;
    setIsExtracting(true);
    setExtractionProgress(0);
    setExtractionError("");
    extractionTrackedRoiRef.current = null;
    setValenceDone(false);
    setArousalDone(false);
    labelTrajectoryRef.current = { valence: [], arousal: [] };
    try {
      // A new detector guarantees that VIDEO tracking state never crosses videos or seeks.
      landmarkerRef.current?.close();
      const detector = await createFaceLandmarker();
      landmarkerRef.current = detector;
      const timeline = createTimeline(clipStart, clipEnd, FPS);
      let trackingRoi = selectedRoi;
      for (const [sampleIndex, sample] of timeline) {
        if (extractionCancelledRef.current) return;
        const decodedFrame = await seekToDecodedFrame(video, sample.targetTime);
        const observation = detectFace(detector, video, sampleIndex * (1000 / FPS), trackingRoi);
        if (observation.detected && observation.identityMatch && observation.roi) {
          extractionTrackedRoiRef.current = observation.roi;
          trackingRoi = advanceTrackingRoi(trackingRoi, observation.roi, video.videoWidth, video.videoHeight);
        } else {
          // A missing frame remains visibly and analytically missing; never draw a stale face box.
          extractionTrackedRoiRef.current = null;
        }
        timeline.set(sampleIndex, {
          ...sample,
          sourceTimestamp: decodedFrame.mediaTime,
          faceDetected: observation.detected,
          identityMatch: observation.identityMatch,
          roiOverlap: observation.roiOverlap,
          qualityFlags: [...observation.qualityFlags, "model_confidence_not_exposed", decodedFrame.timestampSource],
          exclusionReason: !observation.detected
            ? "face_not_detected"
            : !observation.identityMatch ? "identity_roi_mismatch" : null,
          roi: observation.roi,
          landmarks: observation.landmarks,
          normalizedLandmarks: observation.normalizedLandmarks,
          headPose: observation.headPose,
          geometry: observation.geometry,
          blendshapes: observation.blendshapes,
        });
        const droppedReasons = [
          decodedFrame.timestampSource === "source_timestamp_current_time_fallback" ? "unmeasured_source_timestamp" : null,
          !observation.detected ? "face_not_detected" : null,
          observation.detected && !observation.identityMatch ? "identity_roi_mismatch" : null,
        ].filter((reason): reason is string => reason !== null);
        if (droppedReasons.length) {
          eventsRef.current.push({
            event: "dropped_sample",
            mediaTime: sample.targetTime,
            recordedAt: new Date().toISOString(),
            mode: null,
            detail: `sample_index=${sampleIndex};${droppedReasons.join("|")}`,
          });
        }
        if (sampleIndex % 5 === 0 || sampleIndex === timeline.size - 1) {
          setExtractionProgress((sampleIndex + 1) / timeline.size);
          await yieldToBrowser();
        }
      }
      if (extractionCancelledRef.current) return;
      setSamples(timeline);
      video.currentTime = clipStart;
      setCurrentTime(clipStart);
      setStep("annotate");
    } catch (error) {
      console.error(error);
      setExtractionError(error instanceof Error ? error.message : "特徵提取失敗");
    } finally {
      extractionTrackedRoiRef.current = null;
      setIsExtracting(false);
    }
  };

  const playClip = () => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (video.currentTime < clipStart || video.currentTime >= clipEnd) video.currentTime = clipStart;
    logEvent("play", video.currentTime);
    video.play();
    setIsPlaying(true);
  };

  const pause = () => {
    if (videoRef.current && !videoRef.current.paused) logEvent("pause", videoRef.current.currentTime);
    videoRef.current?.pause();
    setIsPlaying(false);
  };

  const selectMode = (nextMode: "valence" | "arousal") => {
    pause();
    setAnnotationError("");
    setMode(nextMode);
    modeRef.current = nextMode;
    labelTrajectoryRef.current[nextMode] = [{
      mediaTime: clipStart,
      value: nextMode === "valence" ? valenceRef.current : arousalRef.current,
    }];
    setSamples((previous) => new Map([...previous].map(([index, sample]) => [index, {
      ...sample,
      valenceRaw: nextMode === "valence" ? null : sample.valenceRaw,
      arousalRaw: nextMode === "arousal" ? null : sample.arousalRaw,
    }])));
    if (nextMode === "valence") setValenceDone(false);
    else setArousalDone(false);
    const video = videoRef.current;
    if (video) { video.currentTime = clipStart; logEvent("seek", clipStart, `開始 ${nextMode}`); }
  };

  const finishMode = () => {
    const video = videoRef.current;
    if (!mode || !video) return;
    if (video.currentTime < clipEnd - 0.05) {
      setAnnotationError("必須完整播放至片段結尾，才能完成這個維度的標註。");
      return;
    }
    pause();
    finalizeLabels(mode);
  };

  const recordLabel = (dimension: "valence" | "arousal", value: number) => {
    const mediaTime = videoRef.current?.currentTime ?? clipStart;
    const trajectory = labelTrajectoryRef.current[dimension];
    const point = { mediaTime: Number(mediaTime.toFixed(6)), value };
    const last = trajectory.at(-1);
    if (last && Math.abs(last.mediaTime - point.mediaTime) < 1e-6) trajectory[trajectory.length - 1] = point;
    else trajectory.push(point);
    logEvent("label_change", mediaTime, `${dimension}=${value}`);
    setDraftRevision((revision) => revision + 1);
  };

  const finalizeLabels = (dimension: "valence" | "arousal") => {
    const trajectory = labelTrajectoryRef.current[dimension];
    if (!trajectory.length) return;
    setSamples((previous) => {
      const next = new Map(previous);
      const values = reconstructCausalLabels([...next.values()], trajectory);
      let index = 0;
      for (const [sampleIndex, sample] of next) {
        const value = values[index];
        next.set(sampleIndex, {
          ...sample,
          valenceRaw: dimension === "valence" ? value : sample.valenceRaw,
          arousalRaw: dimension === "arousal" ? value : sample.arousalRaw,
        });
        index += 1;
      }
      return next;
    });
    if (dimension === "valence") setValenceDone(true);
    else setArousalDone(true);
    setMode(null);
    modeRef.current = null;
    setAnnotationError("");
  };

  const logEvent = (event: AuditEvent["event"], mediaTime: number, detail?: string) => {
    eventsRef.current.push({ event, mediaTime: Number(mediaTime.toFixed(6)), recordedAt: new Date().toISOString(), mode: modeRef.current, detail });
  };

  const exportDataset = async () => {
    if (!participantId || !/^\d+$/.test(participantId)) {
      setExportError("請輸入正確的參與者編號");
      return;
    }
    if (!sequenceNumber || !/^\d{1,2}$/.test(sequenceNumber) || !stimulusId || !trialId) {
      setExportError("請輸入 1-2 位數流水號");
      return;
    }
    const resolvedSessionId = sessionId || `${participantId}-${sequenceNumber}`;
    const anonymousVideoId = `${resolvedSessionId}-${stimulusId}-${trialId}`;
    const client = readClientEnvironment();
    const metadata: SessionMetadata = {
      participantId, sessionId: resolvedSessionId, stimulusId, trialId, anonymousVideoId,
      biologicalSex: gender, stimulusEmotion, stimulusOrder: Number(sequenceNumber), experimentalCondition,
      sourceVideoSizeBytes: videoFile?.size ?? 0, videoDurationSec: duration,
      clipStartSec: clipStart, clipEndSec: clipEnd, sourceFps: null, samplingHz: RESEARCH_PROTOCOL.samplingHz,
      annotationDelaySec: RESEARCH_PROTOCOL.annotationDelaySec,
      smoothingWindowSec: RESEARCH_PROTOCOL.smoothingWindowSec,
      annotatedAt: new Date().toISOString(),
      toolVersion: "0.4.2", landmarkModelVersion: LANDMARK_MODEL_VERSION,
      schemaVersion: "2.2.0", processingVersion: "roi-dynamic-track-10hz-v3",
      protocolVersion: RESEARCH_PROTOCOL.protocolVersion,
      targetConstruct: RESEARCH_PROTOCOL.targetConstruct,
      ...client,
    };
    const qa = buildQaReport(sortedSamples, metadata);
    setIsExporting(true);
    try {
      const bundle = await buildExportBundle(sortedSamples, metadata, eventsRef.current, qa);
      downloadBlob(bundle.blob, bundle.filename);
      if (!qa.passed) {
        setExportError(`QA 未通過；已下載僅含報告的 ZIP：${qa.rejectionReasons.join("；")}`);
        return;
      }
      setIsExportOpen(false);
      setExportError("");
      setExportSuccess(bundle.filename);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "ZIP 建立失敗，請勿結束 session 並聯絡研究人員。" );
    } finally {
      setIsExporting(false);
    }
  };

  const resetSession = (clearStored = false) => {
    pause();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl("");
    setDuration(0);
    setClipStart(0);
    setClipEnd(0);
    setStep("clip");
    setRoi(null);
    setSamples(new Map());
    setValenceDone(false);
    setArousalDone(false);
    setMode(null);
    setValence(0);
    setArousal(0);
    setParticipantId("");
    setSequenceNumber("");
    setGender("M");
    setSessionId("");
    setStimulusId("");
    setTrialId("01");
    setStimulusEmotion("");
    eventsRef.current = [];
    labelTrajectoryRef.current = { valence: [], arousal: [] };
    extractionCancelledRef.current = true;
    setExtractionProgress(0);
    setExtractionError("");
    setAnnotationError("");
    setExportSuccess("");
    setDraftStatus("");
    restoreCandidateRef.current = null;
    if (clearStored) {
      void clearDraft();
      setRecoverableDraft(null);
    }
  };

  const discardAndReset = () => {
    if (videoFile && !window.confirm("確定放棄目前 session？本機暫存也會一併刪除。")) return;
    resetSession(true);
  };

  const confirmExportAndFinish = async () => {
    await clearDraft();
    resetSession(false);
    setRecoverableDraft(null);
  };

  const setStart = (value: number) => {
    const next = Math.min(value, clipEnd - 0.2);
    setClipStart(round2(next));
    setSamples(new Map());
    setValenceDone(false);
    setArousalDone(false);
    if (videoRef.current) videoRef.current.currentTime = next;
    logEvent("seek", next, "clip_start_change");
  };

  const setEnd = (value: number) => {
    const next = Math.max(value, clipStart + 0.2);
    setClipEnd(round2(next));
    setSamples(new Map());
    setValenceDone(false);
    setArousalDone(false);
    if (videoRef.current) videoRef.current.currentTime = next;
    logEvent("seek", next, "clip_end_change");
  };

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="studio-header-inner">
          <div className="brand-lockup">
            <div className="brand-mark">
              <BrainCircuit size={26} />
            </div>
            <div>
              <h1>AFFECTIVE <span>SLIDER</span></h1>
              <p>Emotion Annotation Studio</p>
            </div>
          </div>
          {videoFile ? (
            <Button variant="ghost" size="sm" onClick={discardAndReset} className="reset-upload">
              <RotateCcw size={14} /> 重新上傳影片
            </Button>
          ) : null}
        </div>
      </header>

      <div className="notice-stack" aria-live="polite">
        {browserIncompatible ? (
          <div className="studio-notice is-error" role="alert">
            <AlertTriangle size={20} />
            <div>
              <strong>這個瀏覽器無法執行正式資料蒐集</strong>
              <span>{compatibilityIssues.join("；")}</span>
            </div>
          </div>
        ) : null}
        {tabletPortrait && videoFile ? (
          <div className="studio-notice is-warning" role="alert">
            <AlertTriangle size={20} />
            <div><strong>請將平板旋轉為橫向</strong><span>ROI 與 V/A 正式標註只允許橫向操作，確保影片與滑桿能同時看見。</span></div>
          </div>
        ) : null}
        {!videoFile && recoverableDraft ? (
          <div className="studio-notice">
            <Check size={20} />
            <div><strong>找到未完成的本機暫存</strong><span>請重新選取同一支影片；工具會依檔案大小與修改時間恢復，不會保存原始影片。</span></div>
          </div>
        ) : null}
        {draftStatus && videoFile ? <div className="draft-status">{draftStatus}</div> : null}
      </div>

      <section className="studio-grid">
        <div className="workspace-column">
          <div
            className={`video-stage ${step === "roi" ? "is-selecting-roi" : ""}`}
            onPointerDown={startRoi}
            onPointerMove={moveRoi}
            onPointerUp={endRoi}
            onPointerCancel={endRoi}
          >
            {!videoUrl ? (
              <label className={`studio-upload ${browserIncompatible ? "is-disabled" : ""}`}>
                <input className="sr-only" type="file" accept="video/mp4,.mp4" disabled={browserIncompatible} onChange={onUpload} />
                <div className="upload-orb">
                  <Upload size={36} />
                </div>
                <strong>Upload Video</strong>
                <span>選擇 .MP4 影片開始剪輯、ROI 與 Affective Slider 標註</span>
              </label>
            ) : null}
            {videoUrl ? (
              <video ref={videoRef} src={videoUrl} onLoadedMetadata={onLoadedMetadata} playsInline muted className="hidden" />
            ) : null}
            <canvas ref={canvasRef} className={videoUrl ? "video-canvas" : "hidden"} />
            {videoUrl ? (
              <div className="video-hud">
                <Badge className="studio-badge">{activeLabel}</Badge>
                <span>{formatTime(currentTime)} / {formatTime(clipEnd)}</span>
              </div>
            ) : null}
          </div>

          <div className="progress-track">
            <div style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        </div>

        <aside className="control-column">
          <Card className="control-panel">
            <CardHeader className="control-header">
              <div className="panel-kicker-row">
                <Badge className="studio-badge">{step === "clip" ? "Trim Stage" : step === "roi" ? "ROI Stage" : "Annotation Stage"}</Badge>
                <div className="step-dots" aria-label="annotation progress">
                  {[0, 1, 2].map((dot) => <span key={dot} className={dot <= stepIndex ? "active" : ""} />)}
                </div>
              </div>
              <CardTitle className="panel-title">
                {step === "clip" ? "影片剪輯" : step === "roi" ? "臉部位置標註" : mode === "arousal" ? "喚醒度標註" : "愉悅度標註"}
              </CardTitle>
              <p className="panel-description">
                {step === "clip" ? "先設定影片起訖點，畫面遮罩會標示捨棄片段。" : step === "roi" ? "框選第一幀臉部作為身份錨點；提取後實線框會逐幀跟隨臉部。" : "分兩階段錄製愉悅度與喚醒度；綠色實線框顯示每個 10 Hz 樣本的實際偵測位置。"}
              </p>
            </CardHeader>
            <CardContent className="control-content">
              {step === "clip" ? (
                <div className="control-stack">
                  <Slider label={`起始點 ${formatTime(clipStart)}`} min={0} max={duration || 1} step={0.01} value={clipStart} onChange={(e) => setStart(Number(e.target.value))} disabled={!videoUrl} />
                  <Slider label={`結束點 ${formatTime(clipEnd)}`} min={0} max={duration || 1} step={0.01} value={clipEnd} onChange={(e) => setEnd(Number(e.target.value))} disabled={!videoUrl} />
                  <Button disabled={!videoUrl || clipEnd <= clipStart} onClick={() => setStep("roi")} className="primary-action">
                    <SquareDashedMousePointer size={18} /> 前往臉部位置標註
                  </Button>
                </div>
              ) : null}

              {step === "roi" ? (
                <div className="control-stack">
                  <div className="roi-card">
                    <SquareDashedMousePointer size={22} />
                    <div>
                      <strong>{roi && roi.size >= 24 ? "身份錨點已選取" : "等待框選臉部"}</strong>
                      <span>{roi ? `${Math.round(roi.size)} x ${Math.round(roi.size)} px；虛線只標示起始位置` : "請在左側影片上拖曳出正方形範圍"}</span>
                    </div>
                  </div>
                  <div className="two-actions">
                    <Button variant="outline" onClick={() => setStep("clip")}>
                      <ArrowLeft size={18} /> 修改剪輯
                    </Button>
                    <Button disabled={!roi || roi.size < 24 || modelStatus !== "ready" || isExtracting || tabletPortrait || browserIncompatible} onClick={beginAnnotation}>
                      <Check size={18} /> {isExtracting ? `正在提取 ${Math.round(extractionProgress * 100)}%` : "提取特徵並開始標註"}
                    </Button>
                  </div>
                  <p className={modelStatus === "error" ? "dialog-error" : "panel-description"}>
                    {browserIncompatible ? "瀏覽器相容性檢查未通過，無法開始正式標註" : isExtracting ? "正在以移動追蹤視窗依固定 10 Hz 時間點預先提取；完成後特徵將鎖定。" : modelStatus === "ready" ? "真實臉部特徵模型已就緒" : modelStatus === "error" ? "臉部特徵模型載入失敗，無法開始正式標註" : "正在載入臉部特徵模型…"}
                  </p>
                  {extractionError ? <p className="dialog-error">{extractionError}</p> : null}
                </div>
              ) : null}

              {step === "annotate" ? (
                <div className="control-stack">
                  <div className="mode-tabs">
                    <Button variant={mode === "valence" ? "default" : "outline"} onClick={() => selectMode("valence")}>
                      標註愉悅度
                    </Button>
                    <Button variant={mode === "arousal" ? "default" : "outline"} onClick={() => selectMode("arousal")}>
                      標註喚醒度
                    </Button>
                  </div>

                  <AffectiveControl label="愉悅度 Valence" low="UNPLEASANT" high="PLEASANT" value={valence} disabled={mode !== "valence"} onChange={(next) => { valenceRef.current = next; setValence(next); recordLabel("valence", next); }} />
                  <AffectiveControl label="喚醒度 Arousal" low="CALM" high="EXCITED" value={arousal} disabled={mode !== "arousal"} onChange={(next) => { arousalRef.current = next; setArousal(next); recordLabel("arousal", next); }} />

                  <div className="three-actions">
                    <Button variant="secondary" onClick={isPlaying ? pause : playClip} disabled={!mode || tabletPortrait}>
                      {isPlaying ? <Pause size={18} /> : <Play size={18} />} {isPlaying ? "暫停" : "播放"}
                    </Button>
                    <Button variant="outline" onClick={finishMode} disabled={!mode}>
                      <Check size={18} /> 完成
                    </Button>
                    <Button variant="outline" onClick={() => { pause(); setStep("roi"); setRoi(null); }}>
                      <RotateCcw size={18} /> 重標
                    </Button>
                  </div>
                  {annotationError ? <p className="dialog-error">{annotationError}</p> : null}

                  <div className="completion-grid">
                    <Status label="愉悅度" done={valenceDone} />
                    <Status label="喚醒度" done={arousalDone} />
                  </div>

                  <div className="two-actions">
                    <Button variant="outline" onClick={() => { pause(); setStep("clip"); }}>
                      <Scissors size={18} /> 修改剪輯
                    </Button>
                    <Button onClick={() => setIsExportOpen(true)} disabled={!canExport}>
                      <Download size={18} /> 下載數據集
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </section>

      <footer className="studio-footer">
        <span>2026 AF-STUDIO</span>
        <span>RESEARCH ZIP EXPORT</span>
      </footer>

      {isExportOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <button className="dialog-close" onClick={() => setIsExportOpen(false)} aria-label="Close export dialog">
              <X size={18} />
            </button>
            <div className="dialog-header">
              <h2 id="export-title">下載數據集</h2>
              <p>請填寫匿名化的 session 與刺激條件；QA 通過後才會匯出訓練 CSV。</p>
            </div>
            <div className="dialog-body">
              <label>
                <span>性別 Gender</span>
                <div className="segmented-control">
                  <button className={gender === "M" ? "active" : ""} onClick={() => setGender("M")}>M</button>
                  <button className={gender === "F" ? "active" : ""} onClick={() => setGender("F")}>F</button>
                </div>
              </label>
              <div className="dialog-fields">
                <label>
                  <span>參與者編號 ID</span>
                  <input value={participantId} placeholder="001" inputMode="numeric" onChange={(e) => setParticipantId(e.target.value.replace(/\D/g, ""))} />
                </label>
                <label>
                  <span>流水號 Seq</span>
                  <input value={sequenceNumber} placeholder="01" maxLength={2} inputMode="numeric" onChange={(e) => setSequenceNumber(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                </label>
                <label>
                  <span>Session ID（選填）</span>
                  <input value={sessionId} placeholder="自動：001-01" onChange={(e) => setSessionId(e.target.value)} />
                </label>
                <label>
                  <span>刺激 ID Stimulus</span>
                  <input value={stimulusId} placeholder="reel-001" onChange={(e) => setStimulusId(e.target.value)} />
                </label>
                <label>
                  <span>Trial ID</span>
                  <input value={trialId} placeholder="01" onChange={(e) => setTrialId(e.target.value)} />
                </label>
                <label>
                  <span>刺激情緒（非 ground truth）</span>
                  <input value={stimulusEmotion} placeholder="happy / anger…" onChange={(e) => setStimulusEmotion(e.target.value)} />
                </label>
                <label>
                  <span>實驗條件</span>
                  <input value={experimentalCondition} onChange={(e) => setExperimentalCondition(e.target.value)} />
                </label>
                <label>
                  <span>研究 Protocol（唯讀）</span>
                  <input readOnly value={`${RESEARCH_PROTOCOL.protocolVersion}｜延遲 ${RESEARCH_PROTOCOL.annotationDelaySec.toFixed(1)} 秒`} />
                </label>
              </div>
              {exportError ? <p className="dialog-error">{exportError}</p> : null}
              <Button onClick={exportDataset} disabled={isExporting} className="primary-action">
                <Download size={18} /> {isExporting ? "正在建立 ZIP…" : "執行 QA 並下載 ZIP"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {exportSuccess ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="export-dialog export-success" role="dialog" aria-modal="true" aria-labelledby="export-success-title">
            <div className="dialog-header">
              <h2 id="export-success-title">ZIP 已建立</h2>
              <p>請先在平板的「下載項目／檔案」確認下列檔案存在，再結束 session。</p>
            </div>
            <div className="dialog-body">
              <code>{exportSuccess}</code>
              <p className="privacy-note">ZIP 內含 dataset.csv、metadata_qa.json 與 SHA-256 manifest；不包含原始影片檔名。</p>
              <Button onClick={confirmExportAndFinish} className="primary-action">
                <Check size={18} /> 我已確認檔案存在，結束 session
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function AffectiveControl({ label, low, high, value, disabled, onChange }: { label: string; low: string; high: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <div className={`affective-control ${disabled ? "is-disabled" : ""}`}>
      <div className="affective-head">
        <strong>{label}</strong>
        <span>{value.toFixed(2)}</span>
      </div>
      <Slider label="" min={-1} max={1} step={0.01} value={value} disabled={disabled} onChange={(e) => onChange(round2(Number(e.target.value)))} />
      <div className="affective-ends">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function Status({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={`status-pill ${done ? "is-done" : ""}`}>
      <span>{label}</span>
      <strong>{done ? "已完成" : "未完成"}</strong>
    </div>
  );
}

async function seekToDecodedFrame(video: HTMLVideoElement, targetTime: number) {
  const videoFrames = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: (_now: number, metadata: { mediaTime: number }) => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };
  const needsSeek = Math.abs(video.currentTime - targetTime) > 1e-4 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA;
  if (!needsSeek) {
    return { mediaTime: Number(video.currentTime.toFixed(6)), timestampSource: "source_timestamp_current_frame" };
  }
  let frameHandle: number | null = null;
  const frameMetadata = videoFrames.requestVideoFrameCallback
    ? new Promise<number | null>((resolve) => {
        let settled = false;
        let timeout = 0;
        const finish = (mediaTime: number | null) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(mediaTime);
        };
        frameHandle = videoFrames.requestVideoFrameCallback!((_now, metadata) => finish(metadata.mediaTime));
        timeout = window.setTimeout(() => {
          if (frameHandle !== null) videoFrames.cancelVideoFrameCallback?.(frameHandle);
          finish(null);
        }, 500);
      })
    : Promise.resolve(null);
  await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`影片在 ${targetTime.toFixed(3)} 秒 seek 逾時`));
      }, 8000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      const onSeeked = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("影片解碼失敗")); };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = targetTime;
  });
  const decodedMediaTime = await frameMetadata;
  return decodedMediaTime === null
    ? { mediaTime: Number(video.currentTime.toFixed(6)), timestampSource: "source_timestamp_current_time_fallback" }
    : { mediaTime: Number(decodedMediaTime.toFixed(6)), timestampSource: "source_timestamp_video_frame_callback" };
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}
