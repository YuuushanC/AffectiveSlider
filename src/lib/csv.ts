import type { AnnotationSample } from "../types";

const value = (input: number | string | null | undefined) => {
  if (input === null || input === undefined) return "";
  return typeof input === "number" ? input.toFixed(5).replace(/\.?0+$/, "") : `"${String(input).replace(/"/g, '""')}"`;
};

export function buildCsv(samples: AnnotationSample[], videoName: string, clipStart: number, clipEnd: number) {
  const landmarkHeaders = Array.from({ length: 68 }, (_, i) => [`lm${i + 1}_x`, `lm${i + 1}_y`]).flat();
  const normalizedHeaders = Array.from({ length: 68 }, (_, i) => [`nlm${i + 1}_x`, `nlm${i + 1}_y`]).flat();
  const geometryHeaders = [
    "face_width",
    "eye_distance",
    "left_eye_open",
    "right_eye_open",
    "mouth_width",
    "mouth_open",
    "nose_to_mouth",
  ];
  const headers = [
    "video_name",
    "clip_start_sec",
    "clip_end_sec",
    "frame_index",
    "timestamp_sec",
    "sequence_time_sec",
    "valence",
    "arousal",
    "roi_x",
    "roi_y",
    "roi_size",
    ...landmarkHeaders,
    ...normalizedHeaders,
    ...geometryHeaders,
  ];

  const rows = samples
    .filter((sample) => sample.valence !== null && sample.arousal !== null && sample.roi)
    .map((sample) => {
      const landmarks = sample.landmarks.flatMap((p) => [p.x, p.y]);
      const normalized = sample.normalizedLandmarks.flatMap((p) => [p.x, p.y]);
      const geometry = geometryHeaders.map((key) => sample.geometry[key]);
      return [
        videoName,
        clipStart,
        clipEnd,
        sample.frameIndex,
        sample.timestamp,
        sample.timestamp - clipStart,
        sample.valence,
        sample.arousal,
        sample.roi?.x,
        sample.roi?.y,
        sample.roi?.size,
        ...landmarks,
        ...normalized,
        ...geometry,
      ]
        .map(value)
        .join(",");
    });
  return [headers.join(","), ...rows].join("\n");
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
