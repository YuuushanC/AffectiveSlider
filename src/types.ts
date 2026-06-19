export type Step = "clip" | "roi" | "annotate";
export type Mode = "valence" | "arousal" | null;

export interface Rect {
  x: number;
  y: number;
  size: number;
}

export interface AnnotationSample {
  timestamp: number;
  frameIndex: number;
  valence: number | null;
  arousal: number | null;
  roi: Rect | null;
  landmarks: Point[];
  normalizedLandmarks: Point[];
  geometry: Record<string, number>;
}

export interface Point {
  x: number;
  y: number;
}
