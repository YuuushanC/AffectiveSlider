import { describe, expect, it } from "vitest";
import { isPartiallyOutOfCrop, minimumFaceSizeForFrame } from "./facePipeline";

describe("face quality thresholds", () => {
  it("tolerates a few small crop-boundary landmark outliers", () => {
    const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    points[0] = { x: 1.05, y: 0.5 };
    expect(isPartiallyOutOfCrop(points)).toBe(false);
    for (let index = 0; index < 10; index += 1) points[index] = { x: 1.1, y: 0.5 };
    expect(isPartiallyOutOfCrop(points)).toBe(true);
  });

  it("uses a resolution-aware face-size floor and ceiling", () => {
    expect(minimumFaceSizeForFrame(640, 480)).toBe(48);
    expect(minimumFaceSizeForFrame(1920, 1080)).toBe(81);
    expect(minimumFaceSizeForFrame(3840, 2160)).toBe(96);
  });
});
