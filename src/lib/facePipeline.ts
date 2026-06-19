import type { Point, Rect } from "../types";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const size = clamp(rect.size, 24, Math.min(width, height));
  return {
    x: clamp(rect.x, 0, width - size),
    y: clamp(rect.y, 0, height - size),
    size,
  };
}

export function estimateLandmarks(roi: Rect): Point[] {
  const pts: Point[] = [];
  const cx = roi.x + roi.size / 2;
  const cy = roi.y + roi.size / 2;
  const rx = roi.size * 0.34;
  const ry = roi.size * 0.42;

  for (let i = 0; i < 17; i += 1) {
    const t = Math.PI * (1 + i / 16);
    pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry + roi.size * 0.1 });
  }
  for (let i = 0; i < 5; i += 1) pts.push({ x: roi.x + roi.size * (0.28 + i * 0.045), y: roi.y + roi.size * (0.34 - Math.abs(2 - i) * 0.018) });
  for (let i = 0; i < 5; i += 1) pts.push({ x: roi.x + roi.size * (0.54 + i * 0.045), y: roi.y + roi.size * (0.34 - Math.abs(2 - i) * 0.018) });
  for (let i = 0; i < 9; i += 1) pts.push({ x: cx, y: roi.y + roi.size * (0.38 + i * 0.045) });
  const eye = (baseX: number) => {
    for (let i = 0; i < 6; i += 1) {
      const t = (Math.PI * 2 * i) / 6;
      pts.push({ x: baseX + Math.cos(t) * roi.size * 0.075, y: roi.y + roi.size * 0.45 + Math.sin(t) * roi.size * 0.035 });
    }
  };
  eye(roi.x + roi.size * 0.36);
  eye(roi.x + roi.size * 0.64);
  for (let i = 0; i < 12; i += 1) {
    const t = (Math.PI * 2 * i) / 12;
    pts.push({ x: cx + Math.cos(t) * roi.size * 0.18, y: roi.y + roi.size * 0.72 + Math.sin(t) * roi.size * 0.075 });
  }
  for (let i = 0; i < 8; i += 1) {
    const t = (Math.PI * 2 * i) / 8;
    pts.push({ x: cx + Math.cos(t) * roi.size * 0.1, y: roi.y + roi.size * 0.72 + Math.sin(t) * roi.size * 0.035 });
  }
  return pts.slice(0, 68);
}

export function normalizeLandmarks(points: Point[], roi: Rect): Point[] {
  return points.map((p) => ({
    x: Number(((p.x - roi.x) / roi.size).toFixed(5)),
    y: Number(((p.y - roi.y) / roi.size).toFixed(5)),
  }));
}

export function extractGeometry(points: Point[]) {
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const leftEye = points.slice(36, 42);
  const rightEye = points.slice(42, 48);
  const mouth = points.slice(48, 60);
  const jawLeft = points[0];
  const jawRight = points[16];
  const nose = points[30] ?? points[33];
  return {
    face_width: Number(dist(jawLeft, jawRight).toFixed(5)),
    eye_distance: Number(dist(leftEye[0], rightEye[3]).toFixed(5)),
    left_eye_open: Number(dist(leftEye[1], leftEye[5]).toFixed(5)),
    right_eye_open: Number(dist(rightEye[1], rightEye[5]).toFixed(5)),
    mouth_width: Number(dist(mouth[0], mouth[6]).toFixed(5)),
    mouth_open: Number(dist(mouth[3], mouth[9]).toFixed(5)),
    nose_to_mouth: Number(dist(nose, mouth[3]).toFixed(5)),
  };
}

function brightness(data: Uint8ClampedArray, index: number) {
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

export function trackRoi(
  canvas: HTMLCanvasElement,
  previous: ImageData | null,
  previousRect: Rect | null,
  videoWidth: number,
  videoHeight: number,
): { rect: Rect | null; template: ImageData | null } {
  if (!previous || !previousRect) return { rect: previousRect, template: previous };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { rect: previousRect, template: previous };

  const scale = 0.16;
  const smallW = Math.max(80, Math.round(videoWidth * scale));
  const smallH = Math.max(80, Math.round(videoHeight * scale));
  const offscreen = document.createElement("canvas");
  offscreen.width = smallW;
  offscreen.height = smallH;
  const sctx = offscreen.getContext("2d", { willReadFrequently: true });
  if (!sctx) return { rect: previousRect, template: previous };
  sctx.drawImage(canvas, 0, 0, smallW, smallH);

  const size = Math.max(10, Math.round(previousRect.size * scale));
  const prevX = Math.round(previousRect.x * scale);
  const prevY = Math.round(previousRect.y * scale);
  const radius = Math.max(8, Math.round(size * 0.45));
  const current = sctx.getImageData(0, 0, smallW, smallH);
  const prevSmall = downsampleImage(previous, Math.max(8, size), Math.max(8, size));
  let best = { x: prevX, y: prevY, score: Number.POSITIVE_INFINITY };

  for (let y = Math.max(0, prevY - radius); y <= Math.min(smallH - size, prevY + radius); y += 2) {
    for (let x = Math.max(0, prevX - radius); x <= Math.min(smallW - size, prevX + radius); x += 2) {
      let score = 0;
      for (let py = 0; py < size; py += 3) {
        for (let px = 0; px < size; px += 3) {
          const ci = ((y + py) * smallW + x + px) * 4;
          const pi = (py * size + px) * 4;
          score += Math.abs(brightness(current.data, ci) - brightness(prevSmall.data, pi));
        }
      }
      if (score < best.score) best = { x, y, score };
    }
  }

  const rect = clampRect(
    { x: best.x / scale, y: best.y / scale, size: previousRect.size },
    videoWidth,
    videoHeight,
  );
  return { rect, template: ctx.getImageData(rect.x, rect.y, rect.size, rect.size) };
}

function downsampleImage(image: ImageData, width: number, height: number) {
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  source.getContext("2d")?.putImageData(image, 0, 0);
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  target.getContext("2d")?.drawImage(source, 0, 0, width, height);
  return target.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height);
}
