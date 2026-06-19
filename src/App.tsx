import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  Download,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  SquareDashedMousePointer,
  Upload,
} from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Slider } from "./components/ui/slider";
import { buildCsv, downloadCsv } from "./lib/csv";
import { clampRect, estimateLandmarks, extractGeometry, normalizeLandmarks, trackRoi } from "./lib/facePipeline";
import type { AnnotationSample, Mode, Rect, Step } from "./types";

const FPS = 10;
const round2 = (value: number) => Number(value.toFixed(2));
const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<number | null>(null);
  const templateRef = useRef<ImageData | null>(null);
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

  const canExport = valenceDone && arousalDone && samples.size > 0;
  const progress = duration ? ((currentTime - clipStart) / Math.max(0.1, clipEnd - clipStart)) * 100 : 0;
  const sortedSamples = useMemo(() => [...samples.values()].sort((a, b) => a.timestamp - b.timestamp), [samples]);

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
        video.pause();
        setIsPlaying(false);
        video.currentTime = clipEnd;
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [clipEnd]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || step !== "annotate" || !mode || !roi) return;
    const interval = window.setInterval(() => {
      if (video.paused || video.currentTime < clipStart || video.currentTime > clipEnd) return;
      captureSample(video.currentTime);
    }, 1000 / FPS);
    return () => window.clearInterval(interval);
  }, [step, mode, roi, clipStart, clipEnd, valence, arousal]);

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
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

    if (step === "annotate" && !video.paused && roi) {
      const tracked = trackRoi(canvas, templateRef.current, roi, canvas.width, canvas.height);
      if (tracked.rect) setRoi(tracked.rect);
      templateRef.current = tracked.template;
    }

    if (roi) drawRoi(ctx, roi);
  };

  const drawTrimMask = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const startX = duration ? (clipStart / duration) * width : 0;
    const endX = duration ? (clipEnd / duration) * width : width;
    ctx.fillStyle = "rgba(4, 12, 20, 0.52)";
    ctx.fillRect(0, 0, startX, height);
    ctx.fillRect(endX, 0, width - endX, height);
  };

  const drawRoi = (ctx: CanvasRenderingContext2D, rect: Rect) => {
    ctx.save();
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = Math.max(3, rect.size * 0.01);
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(rect.x, rect.y, rect.size, rect.size);
    const points = estimateLandmarks(rect);
    ctx.setLineDash([]);
    ctx.fillStyle = "#f97316";
    points.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(2, rect.size * 0.008), 0, Math.PI * 2);
      ctx.fill();
    });
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
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (ctx && canvas) templateRef.current = ctx.getImageData(roi.x, roi.y, roi.size, roi.size);
    setDragStart(null);
  };

  const captureSample = (timestamp: number) => {
    const activeRoi = roi;
    if (!activeRoi || !mode) return;
    const frameIndex = Math.round((timestamp - clipStart) * FPS);
    const landmarks = estimateLandmarks(activeRoi);
    const normalizedLandmarks = normalizeLandmarks(landmarks, activeRoi);
    const geometry = extractGeometry(normalizedLandmarks);
    setSamples((prev) => {
      const next = new Map(prev);
      const current = next.get(frameIndex);
      next.set(frameIndex, {
        timestamp: round2(timestamp),
        frameIndex,
        valence: mode === "valence" ? round2(valence) : current?.valence ?? null,
        arousal: mode === "arousal" ? round2(arousal) : current?.arousal ?? null,
        roi: activeRoi,
        landmarks,
        normalizedLandmarks,
        geometry,
      });
      return next;
    });
  };

  const playClip = () => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (video.currentTime < clipStart || video.currentTime >= clipEnd) video.currentTime = clipStart;
    video.play();
    setIsPlaying(true);
  };

  const pause = () => {
    videoRef.current?.pause();
    setIsPlaying(false);
  };

  const selectMode = (nextMode: "valence" | "arousal") => {
    pause();
    setMode(nextMode);
    const video = videoRef.current;
    if (video) video.currentTime = clipStart;
  };

  const finishMode = () => {
    if (mode === "valence") setValenceDone(true);
    if (mode === "arousal") setArousalDone(true);
    pause();
    setMode(null);
  };

  const exportCsv = () => {
    const csv = buildCsv(sortedSamples, videoFile?.name ?? "video.mp4", clipStart, clipEnd);
    downloadCsv(csv, `${videoFile?.name?.replace(/\.mp4$/i, "") ?? "affective-slider"}_lstm_features.csv`);
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
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-normal">Affective Slider 微表情標註工具</h1>
            </div>
          </div>
          <Badge className="hidden border-emerald-200 bg-emerald-50 text-emerald-800 sm:inline-flex">
            {step === "clip" ? "影片剪輯" : step === "roi" ? "臉部 ROI" : "動態標註"}
          </Badge>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="grid gap-4">
          <div
            className="video-shell"
            onPointerDown={startRoi}
            onPointerMove={moveRoi}
            onPointerUp={endRoi}
            onPointerCancel={endRoi}
          >
            {!videoUrl ? (
              <label className="upload-drop">
                <Upload size={38} />
                <span className="text-lg font-semibold">上傳 MP4 影片</span>
                <span className="text-sm text-muted-foreground">支援滑鼠與 iPad 手指操作</span>
                <input className="sr-only" type="file" accept="video/mp4" onChange={onUpload} />
              </label>
            ) : null}
            {videoUrl ? (
              <video ref={videoRef} src={videoUrl} onLoadedMetadata={onLoadedMetadata} playsInline muted className="hidden" />
            ) : null}
            <canvas ref={canvasRef} className={videoUrl ? "video-canvas" : "hidden"} />
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        </div>

        <aside className="grid content-start gap-4">
          {step === "clip" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Scissors size={18} /> 第一步：影片剪輯
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Slider label={`起始點 ${formatTime(clipStart)}`} min={0} max={duration || 1} step={0.01} value={clipStart} onChange={(e) => setStart(Number(e.target.value))} disabled={!videoUrl} />
                <Slider label={`結束點 ${formatTime(clipEnd)}`} min={0} max={duration || 1} step={0.01} value={clipEnd} onChange={(e) => setEnd(Number(e.target.value))} disabled={!videoUrl} />
                <Button disabled={!videoUrl || clipEnd <= clipStart} onClick={() => setStep("roi")}>
                  <SquareDashedMousePointer size={18} /> 前往臉部位置標註
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {step === "roi" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SquareDashedMousePointer size={18} /> 第二步：臉部位置標註
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-muted-foreground">在影片畫面上滑動框選臉部，框選範圍會固定為正方形。同一支影片只需框選一次。</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setStep("clip")}>
                    <ArrowLeft size={18} /> 修改剪輯
                  </Button>
                  <Button disabled={!roi || roi.size < 24} onClick={() => setStep("annotate")}>
                    <Check size={18} /> 開始標註
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {step === "annotate" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity size={18} /> 第三步：Affective Slider
                </CardTitle>
            </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={mode === "valence" ? "default" : "outline"} onClick={() => selectMode("valence")}>
                    標註愉悅度
                  </Button>
                  <Button variant={mode === "arousal" ? "default" : "outline"} onClick={() => selectMode("arousal")}>
                    標註喚醒度
                  </Button>
                </div>
                <Slider label={`愉悅度 Valence：${valence.toFixed(2)}`} min={-1} max={1} step={0.01} value={valence} disabled={mode !== "valence"} onChange={(e) => setValence(round2(Number(e.target.value)))} />
                <Slider label={`喚醒度 Arousal：${arousal.toFixed(2)}`} min={-1} max={1} step={0.01} value={arousal} disabled={mode !== "arousal"} onChange={(e) => setArousal(round2(Number(e.target.value)))} />
                <div className="grid grid-cols-3 gap-2">
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
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Status label="愉悅度" done={valenceDone} />
                  <Status label="喚醒度" done={arousalDone} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => { pause(); setStep("clip"); }}>
                    <ArrowLeft size={18} /> 修改剪輯
                  </Button>
                  <Button onClick={exportCsv} disabled={!canExport}>
                    <Download size={18} /> 匯出 CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

        </aside>
      </section>
    </main>
  );
}

function Status({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "bg-muted/35"}`}>
      <span>{label}</span>
      <span>{done ? "已完成" : "未完成"}</span>
    </div>
  );
}
