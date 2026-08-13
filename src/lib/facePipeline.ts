import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { HeadPose, Point, Rect } from "../types";

export const LANDMARK_COUNT = 478;
export const LANDMARK_MODEL_VERSION = "mediapipe-face-landmarker-float16-v1";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function createFaceLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks("/mediapipe").then(async (vision) => {
      const options = {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFacialTransformationMatrixes: true,
      } as const;
      try {
        return await FaceLandmarker.createFromOptions(vision, options);
      } catch {
        return FaceLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "CPU" },
        });
      }
    });
  }
  return landmarkerPromise;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const size = clamp(rect.size, 24, Math.min(width, height));
  return { x: clamp(rect.x, 0, width - size), y: clamp(rect.y, 0, height - size), size };
}

export interface FaceObservation {
  detected: boolean;
  landmarks: Point[];
  normalizedLandmarks: Point[];
  roi: Rect | null;
  headPose: HeadPose;
  geometry: Record<string, number>;
  qualityFlags: string[];
}

export function detectFace(
  detector: FaceLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): FaceObservation {
  const result = detector.detectForVideo(video, timestampMs);
  const face = result.faceLandmarks[0];
  if (!face || face.length < LANDMARK_COUNT) return emptyObservation("face_not_detected");

  const landmarks = face.slice(0, LANDMARK_COUNT).map((p) => ({
    x: Number((p.x * video.videoWidth).toFixed(5)),
    y: Number((p.y * video.videoHeight).toFixed(5)),
    z: Number((p.z * video.videoWidth).toFixed(5)),
  }));
  const normalizedLandmarks = normalizeLandmarks(landmarks);
  const roi = boundsFor(landmarks, video.videoWidth, video.videoHeight);
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  const headPose = matrix ? poseFromMatrix(Array.from(matrix)) : { pitch: null, yaw: null, roll: null };
  const qualityFlags: string[] = [];
  if (face.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) qualityFlags.push("partially_out_of_frame");
  if (roi.size < 80) qualityFlags.push("face_too_small");

  return {
    detected: true,
    landmarks,
    normalizedLandmarks,
    roi,
    headPose,
    geometry: extractGeometry(normalizedLandmarks),
    qualityFlags,
  };
}

function emptyObservation(reason: string): FaceObservation {
  return {
    detected: false,
    landmarks: [],
    normalizedLandmarks: [],
    roi: null,
    headPose: { pitch: null, yaw: null, roll: null },
    geometry: {},
    qualityFlags: [reason],
  };
}

function boundsFor(points: Point[], width: number, height: number): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const size = Math.max(maxX - minX, maxY - minY) * 1.18;
  return clampRect({ x: (minX + maxX - size) / 2, y: (minY + maxY - size) / 2, size }, width, height);
}

export function normalizeLandmarks(points: Point[]): Point[] {
  // MediaPipe eye-corner indices. Normalize translation, in-plane rotation and scale.
  const left = points[33];
  const right = points[263];
  if (!left || !right) return [];
  const cx = (left.x + right.x) / 2;
  const cy = (left.y + right.y) / 2;
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const scale = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return points.map((p) => {
    const x = p.x - cx;
    const y = p.y - cy;
    return {
      x: Number(((x * cos - y * sin) / scale).toFixed(6)),
      y: Number(((x * sin + y * cos) / scale).toFixed(6)),
      z: Number(((p.z ?? 0) / scale).toFixed(6)),
    };
  });
}

export function extractGeometry(points: Point[]) {
  if (points.length < LANDMARK_COUNT) return {};
  const dist = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  return {
    face_width: round(dist(234, 454)),
    eye_distance: round(dist(33, 263)),
    left_eye_open: round((dist(159, 145) + dist(158, 153)) / 2),
    right_eye_open: round((dist(386, 374) + dist(385, 380)) / 2),
    mouth_width: round(dist(61, 291)),
    mouth_open: round(dist(13, 14)),
    nose_to_mouth: round(dist(1, 13)),
  };
}

function poseFromMatrix(m: number[]): HeadPose {
  if (m.length < 16) return { pitch: null, yaw: null, roll: null };
  const pitch = Math.atan2(m[9], m[10]);
  const yaw = Math.asin(clamp(-m[8], -1, 1));
  const roll = Math.atan2(m[4], m[0]);
  const degrees = (v: number) => round((v * 180) / Math.PI);
  return { pitch: degrees(pitch), yaw: degrees(yaw), roll: degrees(roll) };
}

function round(value: number) {
  return Number(value.toFixed(6));
}
