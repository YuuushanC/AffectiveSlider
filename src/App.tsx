import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { buildCsv, buildMetadata, buildQaReport, createTimeline, downloadText } from "./lib/csv";
import { clampRect, createFaceLandmarker, detectFace, LANDMARK_MODEL_VERSION } from "./lib/facePipeline";
import type { AnnotationSample, AuditEvent, Mode, Rect, SessionMetadata, Step } from "./types";

const FPS = 10;
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
  const lastSampleRef = useRef<Record<"valence" | "arousal", number>>({ valence: -1, arousal: -1 });
  const modeRef = useRef<Mode>(null);
  const valenceRef = useRef(0);
  const arousalRef = useRef(0);
  const eventsRef = useRef<AuditEvent[]>([]);
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
  const [sessionId, setSessionId] = useState("");
  const [stimulusId, setStimulusId] = useState("");
  const [trialId, setTrialId] = useState("01");
  const [stimulusEmotion, setStimulusEmotion] = useState("");
  const [experimentalCondition, setExperimentalCondition] = useState("personalized_reels");
  const [annotationDelaySec, setAnnotationDelaySec] = useState(0);

  const canExport = valenceDone && arousalDone && samples.size > 0;
  const progress = duration ? ((currentTime - clipStart) / Math.max(0.1, clipEnd - clipStart)) * 100 : 0;
  const sortedSamples = useMemo(() => [...samples.values()].sort((a, b) => a.sampleIndex - b.sampleIndex), [samples]);
  const stepIndex = step === "clip" ? 0 : step === "roi" ? 1 : 2;
  const activeLabel = mode === "valence" ? "Valence Recording" : mode === "arousal" ? "Arousal Recording" : step === "annotate" ? "Ready to Record" : step === "roi" ? "Face ROI" : "Video Trim";

  useEffect(() => {
    createFaceLandmarker()
      .then((detector) => { landmarkerRef.current = detector; setModelStatus("ready"); })
      .catch((error) => { console.error(error); setModelStatus("error"); });
  }, []);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { valenceRef.current = valence; }, [valence]);
  useEffect(() => { arousalRef.current = arousal; }, [arousal]);

  useEffect(() => {
    return () => {
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
        captureObservation(video);
        video.pause();
        setIsPlaying(false);
        video.currentTime = clipEnd;
        if (mode === "valence") setValenceDone(true);
        if (mode === "arousal") setArousalDone(true);
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
    lastSampleRef.current = { valence: -1, arousal: -1 };
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
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

    if (step === "annotate" && !video.paused) captureObservation(video);

    if (roi) drawRoi(ctx, roi);
  };

  const drawTrimMask = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const startX = duration ? (clipStart / duration) * width : 0;
    const endX = duration ? (clipEnd / duration) * width : width;
    ctx.fillStyle = "rgba(4, 12, 20, 0.56)";
    ctx.fillRect(0, 0, startX, height);
    ctx.fillRect(endX, 0, width - endX, height);
  };

  const drawRoi = (ctx: CanvasRenderingContext2D, rect: Rect) => {
    ctx.save();
    ctx.strokeStyle = "#0f9f87";
    ctx.lineWidth = Math.max(3, rect.size * 0.01);
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(rect.x, rect.y, rect.size, rect.size);
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

  const beginAnnotation = () => {
    setSamples(createTimeline(clipStart, clipEnd, FPS));
    lastSampleRef.current = { valence: -1, arousal: -1 };
    setValenceDone(false);
    setArousalDone(false);
    setStep("annotate");
  };

  const captureObservation = (video: HTMLVideoElement) => {
    const activeMode = modeRef.current;
    if (!activeMode || !landmarkerRef.current || video.currentTime < clipStart || video.currentTime > clipEnd) return;
    const sampleIndex = Math.max(0, Math.min(samples.size - 1, Math.round((video.currentTime - clipStart) * FPS)));
    if (sampleIndex <= lastSampleRef.current[activeMode]) return;
    let observation;
    try {
      observation = detectFace(landmarkerRef.current, video, performance.now());
    } catch (error) {
      console.error(error);
      return;
    }
    const from = lastSampleRef.current[activeMode] + 1;
    if (sampleIndex > from) logEvent("dropped_sample", video.currentTime, `補記 ${from}-${sampleIndex - 1}`);
    setSamples((prev) => {
      const next = new Map(prev);
      for (let index = from; index <= sampleIndex; index += 1) {
        const current = next.get(index);
        if (!current) continue;
        const useObservation = index === sampleIndex;
        next.set(index, {
          ...current,
          valenceRaw: activeMode === "valence" ? round2(valenceRef.current) : current.valenceRaw,
          arousalRaw: activeMode === "arousal" ? round2(arousalRef.current) : current.arousalRaw,
          // Keep null unless the container's true frame index is available; a playback counter is not a source-frame index.
          sourceFrameIndex: current.sourceFrameIndex,
          sourceTimestamp: useObservation ? Number(video.currentTime.toFixed(6)) : current.sourceTimestamp,
          faceDetected: useObservation ? observation.detected : current.faceDetected,
          qualityFlags: useObservation
            ? [...observation.qualityFlags, "model_confidence_not_exposed"]
            : Array.from(new Set([...current.qualityFlags.filter((flag) => flag !== "not_processed"), "dropped_source_frame"])),
          roi: useObservation ? observation.roi : current.roi,
          landmarks: useObservation ? observation.landmarks : current.landmarks,
          normalizedLandmarks: useObservation ? observation.normalizedLandmarks : current.normalizedLandmarks,
          headPose: useObservation ? observation.headPose : current.headPose,
          geometry: useObservation ? observation.geometry : current.geometry,
          exclusionReason: useObservation && !observation.detected ? "face_not_detected" : current.exclusionReason,
        });
      }
      return next;
    });
    lastSampleRef.current[activeMode] = sampleIndex;
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
    setMode(nextMode);
    modeRef.current = nextMode;
    lastSampleRef.current[nextMode] = -1;
    const video = videoRef.current;
    if (video) { video.currentTime = clipStart; logEvent("seek", clipStart, `開始 ${nextMode}`); }
  };

  const finishMode = () => {
    if (mode === "valence") setValenceDone(true);
    if (mode === "arousal") setArousalDone(true);
    pause();
    setMode(null);
    modeRef.current = null;
  };

  const logEvent = (event: AuditEvent["event"], mediaTime: number, detail?: string) => {
    eventsRef.current.push({ event, mediaTime: Number(mediaTime.toFixed(6)), recordedAt: new Date().toISOString(), mode: modeRef.current, detail });
  };

  const exportCsv = () => {
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
    const metadata: SessionMetadata = {
      participantId, sessionId: resolvedSessionId, stimulusId, trialId, anonymousVideoId,
      biologicalSex: gender, stimulusEmotion, stimulusOrder: Number(sequenceNumber), experimentalCondition,
      videoOriginalName: videoFile?.name ?? "video.mp4", videoDurationSec: duration,
      clipStartSec: clipStart, clipEndSec: clipEnd, sourceFps: null, samplingHz: FPS,
      annotationDelaySec, smoothingWindowSec: 0.5, annotatedAt: new Date().toISOString(),
      toolVersion: "0.2.0", landmarkModelVersion: LANDMARK_MODEL_VERSION,
      schemaVersion: "2.0.0", processingVersion: "deterministic-10hz-v1",
    };
    const expectedSampleCount = Math.floor((clipEnd - clipStart) * FPS) + 1;
    const qa = buildQaReport(sortedSamples, expectedSampleCount);
    downloadText(buildMetadata(metadata, eventsRef.current, qa), `${anonymousVideoId}_metadata_qa.json`, "application/json");
    if (!qa.passed) {
      setExportError(`QA 未通過，已下載報告：${qa.rejectionReasons.join("；")}`);
      return;
    }
    downloadText(buildCsv(sortedSamples, metadata), `${anonymousVideoId}_landmarks.csv`, "text/csv;charset=utf-8");
    setIsExportOpen(false);
    setExportError("");
  };

  const resetSession = () => {
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
  };

  const setStart = (value: number) => {
    const next = Math.min(value, clipEnd - 0.2);
    setClipStart(round2(next));
    if (videoRef.current) videoRef.current.currentTime = next;
  };

  const setEnd = (value: number) => {
    const next = Math.max(value, clipStart + 0.2);
    setClipEnd(round2(next));
    if (videoRef.current) videoRef.current.currentTime = next;
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
            <Button variant="ghost" size="sm" onClick={resetSession} className="reset-upload">
              <RotateCcw size={14} /> 重新上傳影片
            </Button>
          ) : null}
        </div>
      </header>

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
              <label className="studio-upload">
                <input className="sr-only" type="file" accept="video/mp4" onChange={onUpload} />
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
                {step === "clip" ? "先設定影片起訖點，畫面遮罩會標示捨棄片段。" : step === "roi" ? "在影片畫面滑動框選正方形臉部 ROI，後續會依此追蹤。" : "分兩階段錄製愉悅度與喚醒度，完成後匯出 LSTM CSV。"}
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
                      <strong>{roi && roi.size >= 24 ? "ROI 已選取" : "等待框選臉部"}</strong>
                      <span>{roi ? `${Math.round(roi.size)} x ${Math.round(roi.size)} px` : "請在左側影片上拖曳出正方形範圍"}</span>
                    </div>
                  </div>
                  <div className="two-actions">
                    <Button variant="outline" onClick={() => setStep("clip")}>
                      <ArrowLeft size={18} /> 修改剪輯
                    </Button>
                    <Button disabled={!roi || roi.size < 24 || modelStatus !== "ready"} onClick={beginAnnotation}>
                      <Check size={18} /> 開始標註
                    </Button>
                  </div>
                  <p className={modelStatus === "error" ? "dialog-error" : "panel-description"}>
                    {modelStatus === "ready" ? "真實臉部特徵模型已就緒" : modelStatus === "error" ? "臉部特徵模型載入失敗，無法開始正式標註" : "正在載入臉部特徵模型…"}
                  </p>
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

                  <AffectiveControl label="愉悅度 Valence" low="UNPLEASANT" high="PLEASANT" value={valence} disabled={mode !== "valence"} onChange={(next) => { setValence(next); logEvent("label_change", videoRef.current?.currentTime ?? 0, `valence=${next}`); }} />
                  <AffectiveControl label="喚醒度 Arousal" low="CALM" high="EXCITED" value={arousal} disabled={mode !== "arousal"} onChange={(next) => { setArousal(next); logEvent("label_change", videoRef.current?.currentTime ?? 0, `arousal=${next}`); }} />

                  <div className="three-actions">
                    <Button variant="secondary" onClick={isPlaying ? pause : playClip} disabled={!mode}>
                      {isPlaying ? <Pause size={18} /> : <Play size={18} />} {isPlaying ? "暫停" : "播放"}
                    </Button>
                    <Button variant="outline" onClick={finishMode} disabled={!mode}>
                      <Check size={18} /> 完成
                    </Button>
                    <Button variant="outline" onClick={() => { pause(); setStep("roi"); setRoi(null); }}>
                      <RotateCcw size={18} /> 重標
                    </Button>
                  </div>

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
        <span>LSTM CSV EXPORT</span>
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
                  <span>固定延遲校正（秒）</span>
                  <input type="number" min="0" max="10" step="0.1" value={annotationDelaySec} onChange={(e) => setAnnotationDelaySec(Number(e.target.value))} />
                </label>
              </div>
              {exportError ? <p className="dialog-error">{exportError}</p> : null}
              <Button onClick={exportCsv} className="primary-action">
                <Download size={18} /> 執行 QA 並下載
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
