import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { HeadPose, Point, Rect } from "../types";
import { isPlausibleTrack } from "./tracking";

export const LANDMARK_COUNT = 478;
export const LANDMARK_MODEL_VERSION = "mediapipe-face-landmarker-float16-v1";
export const BLENDSHAPE_NAMES = [
  "_neutral", "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft",
  "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft",
  "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft",
  "jawOpen", "jawRight", "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight",
  "mouthPucker", "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft",
  "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight",
] as const;

export async function createFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks("/mediapipe");
  const options = {
    baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
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
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const size = clamp(rect.size, 24, Math.min(width, height));
  return { x: clamp(rect.x, 0, width - size), y: clamp(rect.y, 0, height - size), size };
}

export interface FaceObservation {
  detected: boolean;
  identityMatch: boolean;
  roiOverlap: number | null;
  landmarks: Point[];
  normalizedLandmarks: Point[];
  roi: Rect | null;
  headPose: HeadPose;
  geometry: Record<string, number>;
  blendshapes: Record<string, number>;
  qualityFlags: string[];
}

export function detectFace(
  detector: FaceLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
  expectedRoi: Rect,
): FaceObservation {
  // Follow the previously detected participant face. The first frame is seeded by
  // the manually selected ROI, preventing a face inside the stimulus from taking over.
  const crop = expandedRect(expectedRoi, video.videoWidth, video.videoHeight, 0.75);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, Math.round(crop.size));
  cropCanvas.height = Math.max(1, Math.round(crop.size));
  const context = cropCanvas.getContext("2d");
  if (!context) return emptyObservation("crop_context_unavailable");
  context.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, cropCanvas.width, cropCanvas.height);

  const result = detector.detectForVideo(cropCanvas, timestampMs);
  const face = result.faceLandmarks[0];
  if (!face || face.length < LANDMARK_COUNT) return emptyObservation("face_not_detected");

  const landmarks = face.slice(0, LANDMARK_COUNT).map((point) => ({
    x: round(crop.x + point.x * crop.size),
    y: round(crop.y + point.y * crop.size),
    z: round(point.z * crop.size),
  }));
  const normalizedLandmarks = normalizeLandmarks(landmarks);
  const detectedRoi = boundsFor(landmarks, video.videoWidth, video.videoHeight);
  const roiOverlap = intersectionOverUnion(expectedRoi, detectedRoi);
  const identityMatch = isPlausibleTrack(expectedRoi, detectedRoi);
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  const headPose = matrix ? poseFromMatrix(Array.from(matrix)) : { pitch: null, yaw: null, roll: null };
  const blendshapes = Object.fromEntries(
    (result.faceBlendshapes?.[0]?.categories ?? []).map((category) => [category.categoryName, round(category.score)]),
  );
  const qualityFlags: string[] = [];
  if (!identityMatch) qualityFlags.push("identity_roi_mismatch");
  if (face.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) qualityFlags.push("partially_out_of_crop");
  if (detectedRoi.size < 80) qualityFlags.push("face_too_small");
  if (!allFinite(landmarks) || !allFinite(normalizedLandmarks)) qualityFlags.push("non_finite_landmarks");

  return {
    detected: true,
    identityMatch,
    roiOverlap: round(roiOverlap),
    landmarks,
    normalizedLandmarks,
    roi: detectedRoi,
    headPose,
    geometry: extractGeometry(normalizedLandmarks),
    blendshapes,
    qualityFlags,
  };
}

function emptyObservation(reason: string): FaceObservation {
  return {
    detected: false,
    identityMatch: false,
    roiOverlap: null,
    landmarks: [],
    normalizedLandmarks: [],
    roi: null,
    headPose: { pitch: null, yaw: null, roll: null },
    geometry: {},
    blendshapes: {},
    qualityFlags: [reason],
  };
}

function expandedRect(rect: Rect, width: number, height: number, padding: number): Rect {
  const requestedSize = rect.size * (1 + padding * 2);
  return clampRect({ x: rect.x - rect.size * padding, y: rect.y - rect.size * padding, size: requestedSize }, width, height);
}

function boundsFor(points: Point[], width: number, height: number): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const size = Math.max(maxX - minX, maxY - minY) * 1.18;
  return clampRect({ x: (minX + maxX - size) / 2, y: (minY + maxY - size) / 2, size }, width, height);
}

export function normalizeLandmarks(points: Point[]): Point[] {
  const left = points[33];
  const right = points[263];
  if (!left || !right) return [];
  const centerX = (left.x + right.x) / 2;
  const centerY = (left.y + right.y) / 2;
  const deltaX = right.x - left.x;
  const deltaY = right.y - left.y;
  const scale = Math.hypot(deltaX, deltaY) || 1;
  const angle = Math.atan2(deltaY, deltaX);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return points.map((point) => {
    const x = point.x - centerX;
    const y = point.y - centerY;
    return {
      x: round((x * cos - y * sin) / scale),
      y: round((x * sin + y * cos) / scale),
      z: round((point.z ?? 0) / scale),
    };
  });
}

export function extractGeometry(points: Point[]) {
  if (points.length < LANDMARK_COUNT) return {};
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  return {
    face_width: round(distance(234, 454)),
    eye_distance: round(distance(33, 263)),
    left_eye_open: round((distance(159, 145) + distance(158, 153)) / 2),
    right_eye_open: round((distance(386, 374) + distance(385, 380)) / 2),
    mouth_width: round(distance(61, 291)),
    mouth_open: round(distance(13, 14)),
    nose_to_mouth: round(distance(1, 13)),
  };
}

function poseFromMatrix(matrix: number[]): HeadPose {
  if (matrix.length < 16) return { pitch: null, yaw: null, roll: null };
  const degrees = (value: number) => round((value * 180) / Math.PI);
  return {
    pitch: degrees(Math.atan2(matrix[9], matrix[10])),
    yaw: degrees(Math.asin(clamp(-matrix[8], -1, 1))),
    roll: degrees(Math.atan2(matrix[4], matrix[0])),
  };
}

function intersectionOverUnion(a: Rect, b: Rect) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.size, b.x + b.size);
  const bottom = Math.min(a.y + a.size, b.y + b.size);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / (a.size * a.size + b.size * b.size - intersection || 1);
}

function allFinite(points: Point[]) {
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z ?? 0));
}

function round(value: number) {
  return Number(value.toFixed(6));
}
