import { describe, expect, it } from "vitest";
import { medians, movement, prompts, type Attempt } from "./sliderCalibration";

const stamp = (monotonicMs: number) => ({ monotonicMs, mediaTimeSec: 4.5 });
describe("slider motor calibration", () => {
  it("balances directions on each axis and measures the first signed movement", () => {
    const trials = prompts().map((p, i) => movement(p, stamp(10000*i),
      stamp(10000*i + (p.axis === "valence" ? 350 : 550)), p.direction === "up" ? .51 : .49));
    for (const axis of ["valence","arousal"]) for (const direction of ["up","down"])
      expect(trials.filter(t => t.axis===axis && t.direction===direction)).toHaveLength(3);
    expect(medians(trials)).toEqual({ valence: 350, arousal: 550 });
  });
  it("retains invalid attempts and withholds an unsupported median", () => {
    const p = {axis:"valence",direction:"up"} as const;
    const events: Attempt[] = [movement(p,null,stamp(200),.51), movement(p,stamp(0),stamp(50),.51),
      movement(p,stamp(0),stamp(500),.49), movement(p,stamp(0),stamp(3100),.51)];
    expect(events.map(e=>e.outcome)).toEqual(["early","early","wrong-direction","timeout"]);
    expect(medians(events)).toEqual({valence:null,arousal:null});
  });
});
