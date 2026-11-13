import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { medians, movement, prompts, type Attempt, type SliderCalibration as RecordData, type Stamp } from "../lib/sliderCalibration";

type Props = {
  participantId: string;
  setParticipantId: (id: string) => void;
  previous?: RecordData;
  mediaTime: () => number;
  onComplete: (record: RecordData) => void;
};
const names = { valence: "愉悅度", arousal: "喚醒度" };
const feedback = { valid: "已記錄", early: "移動太早", "wrong-direction": "移動方向與提示相反",
  timeout: "未在時間內移動", interrupted: "提示時離開視窗" };

export function SliderCalibration({ participantId, setParticipantId, previous, mediaTime, onComplete }: Props) {
  const [plan, setPlan] = useState(prompts);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [phase, setPhase] = useState<"ready" | "wait" | "cue" | "feedback">("ready");
  const cue = useRef<Stamp | null>(null);
  const open = useRef(false);
  const start = useRef(0);
  const index = attempts.length;
  const prompt = plan[index];
  const stamp = (): Stamp => ({ monotonicMs: performance.now(), mediaTimeSec: mediaTime() });
  const finish = (attempt: Attempt) => {
    if (!open.current) return;
    open.current = false;
    setAttempts(old => [...old, attempt]);
    setPhase("feedback");
  };
  const begin = () => {
    if (!index) start.current = performance.now();
    cue.current = null;
    open.current = true;
    setPhase("wait");
  };
  useEffect(() => {
    if (phase !== "wait") return;
    const timer = window.setTimeout(() => { if (open.current) setPhase("cue"); }, 900 + Math.random() * 1200);
    return () => window.clearTimeout(timer);
  }, [phase]);
  // Stamp the commit that displays the direction, not the scheduled timer.
  useLayoutEffect(() => {
    if (phase === "cue") cue.current = stamp();
  }, [phase]);
  useEffect(() => {
    if (phase !== "wait" && phase !== "cue") return;
    const stop = (outcome: "timeout" | "interrupted") =>
      finish({ ...prompt, cue: cue.current, firstMovement: null, firstValue: null, outcome });
    const onHidden = () => { if (document.hidden) stop("interrupted"); };
    document.addEventListener("visibilitychange", onHidden);
    const timer = phase === "cue" ? window.setTimeout(() => stop("timeout"), 3000) : undefined;
    return () => { document.removeEventListener("visibilitychange", onHidden); window.clearTimeout(timer); };
  }, [phase, index]);
  const reset = () => { setPlan(prompts()); setAttempts([]); setPhase("ready"); };
  const medianMs = medians(attempts);
  const done = index === plan.length;
  return <section className="slider-calibration" aria-label="滑桿反應校準">
    <h3>滑桿反應校準</h3>
    {phase === "ready" && <label>參與者編號
      <input value={participantId} inputMode="numeric" placeholder="001"
        onChange={e => setParticipantId(e.target.value.replace(/\D/g, ""))} />
    </label>}
    <p>{done ? "兩軸校準結果" : "每軸各 6 次。等箭頭出現後，從中點朝指定方向移動滑桿，每次移動一次即可。"}</p>
    {done ? <>
      {(["valence","arousal"] as const).map(axis => <p key={axis}>{names[axis]}　{medianMs[axis] === null
        ? "有效次數不足" : Math.round(medianMs[axis]!) + " 毫秒"}</p>)}
      {(medianMs.valence === null || medianMs.arousal === null) &&
        <p>每軸向左、向右各需至少兩次有效反應。可重新校準，或保存此次紀錄。</p>}
      <Button onClick={() => onComplete({ version:"motor-slider-v1", participantId, startedMs:start.current,
        timeOriginEpochMs:performance.timeOrigin, attempts, medianMs })}>保存並開始標註</Button>
      <Button variant="outline" onClick={reset}>重新校準</Button>
    </> : <>
      <p>{names[prompt.axis]} · 第 {index % 6 + 1}／6 次</p>
      <strong className="calibration-cue" role="status">{phase === "cue" ? (prompt.direction === "up" ? "向右調高 →" : "← 向左調低")
        : phase === "wait" ? "等候提示" : phase === "feedback" ? feedback[attempts[index-1].outcome] : "準備開始"}</strong>
      <Slider aria-label={names[prompt.axis] + "校準滑桿"} min={0} max={1} step={.01} value={.5}
        disabled={phase !== "wait" && phase !== "cue"} onChange={e => {
          const value = Number(e.target.value);
          if (value !== .5) finish(movement(prompt, cue.current, stamp(), value));
        }}/>
      {(phase === "ready" || phase === "feedback") && <Button disabled={!participantId} onClick={begin}>
        {phase === "ready" ? "開始校準" : "準備下一次"}</Button>}
      {phase === "ready" && previous && previous.participantId === participantId &&
        <Button variant="outline" onClick={() => onComplete(previous)}>沿用此受試者本次校準</Button>}
    </>}
  </section>;
}
