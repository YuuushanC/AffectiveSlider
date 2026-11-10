export type Axis = "valence" | "arousal";
export type Direction = "up" | "down";
export type Prompt = { axis: Axis; direction: Direction };
export type Stamp = { monotonicMs: number; mediaTimeSec: number };
export type Attempt = Prompt & {
  cue: Stamp | null;
  firstMovement: Stamp | null;
  firstValue: number | null;
  outcome: "valid" | "early" | "wrong-direction" | "timeout" | "interrupted";
};
export type SliderCalibration = {
  version: "motor-slider-v1";
  participantId: string;
  timeOriginEpochMs: number;
  startedMs: number;
  attempts: Attempt[];
  medianMs: Record<Axis, number | null>;
};

export function prompts(random = Math.random): Prompt[] {
  return (["valence", "arousal"] as const).flatMap(axis => {
    const directions: Direction[] = ["up", "down", "up", "down", "up", "down"];
    for (let i = directions.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [directions[i], directions[j]] = [directions[j], directions[i]];
    }
    return directions.map(direction => ({ axis, direction }));
  });
}

export function movement(prompt: Prompt, cue: Stamp | null, firstMovement: Stamp, value: number): Attempt {
  const delay = cue ? firstMovement.monotonicMs - cue.monotonicMs : -1;
  const correct = prompt.direction === "up" ? value > 0.5 : value < 0.5;
  const outcome = delay < 100 ? "early" : delay > 3000 ? "timeout" : correct ? "valid" : "wrong-direction";
  return { ...prompt, cue, firstMovement, firstValue: value, outcome };
}

export function medians(attempts: Attempt[]): SliderCalibration["medianMs"] {
  const result: SliderCalibration["medianMs"] = { valence: null, arousal: null };
  for (const axis of ["valence", "arousal"] as const) {
    const valid = attempts.filter(a => a.axis === axis && a.outcome === "valid" && a.cue && a.firstMovement);
    if (["up", "down"].some(d => valid.filter(a => a.direction === d).length < 2)) continue;
    const delays = valid.map(a => a.firstMovement!.monotonicMs - a.cue!.monotonicMs).sort((a, b) => a - b);
    result[axis] = (delays[Math.floor((delays.length - 1) / 2)] + delays[Math.floor(delays.length / 2)]) / 2;
  }
  return result;
}
