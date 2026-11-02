// @vitest-environment happy-dom
// The speaking orb's loop: it runs while the Talk sheet is open and anything moves, keeps running through a talk,
// settles and stops once the talk is over, starts from hidden each time the sheet opens, and never moves under
// reduced motion.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUIET, type VoiceSignal } from "../src/talk/signal.ts";
import { talkSheet, type TalkModel } from "../src/ui/talkView.ts";
import { followTalk, orbNow, orbRunning } from "../src/ui/voiceOrb.ts";

const base: TalkModel = { worker: "https://os.example.com", phase: "idle", message: "", caption: "", muted: false,
  logged: "", device: "phone" };
const agentSpeaking: VoiceSignal = { him: 0, agent: 0.9, himBands: [0, 0, 0], agentBands: [0.9, 0.6, 0.3] };

let frames: Array<(time: number) => void> = [];
let clock = 0;
const runFrames = (count: number): void => {
  for (let i = 0; i < count && frames.length > 0; i++) {
    clock += 16;
    frames.shift()?.(clock);
  }
};
const reduce = (on: boolean): void => {
  vi.stubGlobal("matchMedia", () => ({ matches: on }));
};

/** A 2D context that records what is drawn (happy-dom has none), and a laid-out width for the canvas. */
function drawing(canvas: HTMLCanvasElement, width: number): string[] {
  const drawn: string[] = [];
  const ctx = new Proxy({}, {
    get: (_t, name: string) => name === "createRadialGradient" ? () => ({ addColorStop: () => undefined })
      : (..._args: unknown[]) => { drawn.push(name); },
    set: () => true,
  });
  canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
  Object.defineProperty(canvas, "clientWidth", { configurable: true, get: () => width });
  return drawn;
}

const orbCanvas = (): HTMLCanvasElement => document.querySelector("canvas.voice-orb") as HTMLCanvasElement;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  reduce(false);
  document.body.innerHTML = "";
  followTalk("idle", () => QUIET);
});

afterEach(() => {
  document.body.innerHTML = "";
  followTalk("idle", () => QUIET);
  vi.unstubAllGlobals();
});

describe("the speaking orb", () => {
  it("appears when the sheet opens, then stops by itself once it has settled", () => {
    document.body.innerHTML = talkSheet(base);
    followTalk("idle", () => QUIET);
    expect(orbRunning()).toBe(true);
    runFrames(10);
    expect(orbNow().appear.value).toBeGreaterThan(0);
    runFrames(2000);
    expect(frames).toHaveLength(0);
    expect(orbNow().appear.value).toBeCloseTo(1, 2);
  });

  it("keeps running through a talk, follows the assistant's voice, and settles after it ends", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "speaking" });
    followTalk("speaking", () => agentSpeaking);
    runFrames(2000);
    expect(orbRunning()).toBe(true);
    expect(orbNow().agent.value).toBeCloseTo(0.9, 2);
    followTalk("idle", () => QUIET);
    runFrames(3000);
    expect(frames).toHaveLength(0);
    expect(orbNow().agent.value).toBeCloseTo(0, 2);
  });

  it("asks for one frame at a time however often it is told about the talk", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "listening" });
    followTalk("listening", () => QUIET);
    followTalk("listening", () => QUIET);
    followTalk("speaking", () => agentSpeaking);
    expect(frames).toHaveLength(1);
  });

  it("stops with the sheet, and opens from hidden next time", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "speaking" });
    followTalk("speaking", () => agentSpeaking);
    runFrames(60);
    document.body.innerHTML = "";
    runFrames(5);
    expect(frames).toHaveLength(0);
    expect(orbNow().appear.value).toBe(0);
  });

  it("opens from hidden again even when it had settled before the sheet closed", () => {
    document.body.innerHTML = talkSheet(base);
    followTalk("idle", () => QUIET);
    runFrames(2000);
    expect(orbNow().appear.value).toBeCloseTo(1, 2);
    followTalk("idle", () => QUIET);
    document.body.innerHTML = "";
    document.body.innerHTML = talkSheet(base);
    followTalk("idle", () => QUIET);
    expect(orbNow().appear.value).toBe(0);
  });

  it("draws at the screen's pixel ratio (at most twice), and never sizes a canvas that is not laid out", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "speaking" });
    const canvas = orbCanvas();
    const drawn = drawing(canvas, 0);
    vi.stubGlobal("devicePixelRatio", 3);
    followTalk("speaking", () => agentSpeaking);
    runFrames(5);
    expect(canvas.width).toBe(200);
    expect(drawn).toHaveLength(0);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, get: () => 180 });
    runFrames(2);
    expect(canvas.width).toBe(360);
    expect(canvas.height).toBe(360);
    expect(drawn).toContain("arc");
    runFrames(5);
    expect(canvas.width).toBe(360);
  });

  it("paints a 120 Hz screen at about 60 frames a second while the springs step every frame", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "speaking" });
    const drawn = drawing(orbCanvas(), 200);
    followTalk("speaking", () => agentSpeaking);
    for (let i = 0; i < 60 && frames.length > 0; i++) {
      clock += 8;
      frames.shift()?.(clock);
    }
    const paints = drawn.filter((name) => name === "clearRect").length;
    expect(paints).toBeGreaterThan(25);
    expect(paints).toBeLessThan(40);
  });

  it("reads what it hears only while a talk is on", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "connecting" });
    const signal = vi.fn(() => agentSpeaking);
    followTalk("connecting", signal);
    runFrames(20);
    expect(signal).not.toHaveBeenCalled();
    followTalk("speaking", signal);
    runFrames(3);
    expect(signal).toHaveBeenCalled();
  });

  it("keeps going after a frame that failed, reports it once, and gives up after a few in a row", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    document.body.innerHTML = talkSheet({ ...base, phase: "speaking" });
    const canvas = orbCanvas();
    drawing(canvas, 200);
    let failing = 1;
    const working = canvas.getContext;
    canvas.getContext = ((...args: Parameters<HTMLCanvasElement["getContext"]>) => {
      if (failing > 0) {
        failing -= 1;
        throw new Error("lost the context");
      }
      return working.apply(canvas, args);
    }) as HTMLCanvasElement["getContext"];
    followTalk("speaking", () => agentSpeaking);
    expect(() => runFrames(1)).not.toThrow();
    expect(orbRunning()).toBe(true);
    runFrames(3);
    expect(orbRunning()).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    // A context lost for good: a few tries, then the orb waits for the talk to change.
    failing = Number.POSITIVE_INFINITY;
    runFrames(20);
    expect(orbRunning()).toBe(false);
    expect(report).toHaveBeenCalledTimes(2);
    failing = 0;
    followTalk("listening", () => agentSpeaking);
    expect(orbRunning()).toBe(true);
  });

  it("never throws into the talk under reduced motion", () => {
    vi.stubGlobal("reportError", vi.fn());
    document.body.innerHTML = talkSheet({ ...base, phase: "listening" });
    const canvas = orbCanvas();
    drawing(canvas, 200);
    canvas.getContext = (() => {
      throw new Error("no context");
    }) as unknown as HTMLCanvasElement["getContext"];
    reduce(true);
    expect(() => followTalk("listening", () => QUIET)).not.toThrow();
    expect(() => dispatchEvent(new Event("resize"))).not.toThrow();
  });

  it("always paints the frame it settles on, even between paints on a fast screen", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "speaking" });
    const drawn = drawing(orbCanvas(), 200);
    followTalk("speaking", () => agentSpeaking);
    for (let i = 0; i < 40 && frames.length > 0; i++) {
      clock += 8;
      frames.shift()?.(clock);
    }
    followTalk("idle", () => QUIET);
    let lastClear = -1;
    for (let i = 0; i < 4000 && frames.length > 0; i++) {
      clock += 8;
      const before = drawn.length;
      frames.shift()?.(clock);
      if (drawn.length > before) lastClear = i;
      if (frames.length === 0) expect(lastClear).toBe(i);
    }
    expect(frames).toHaveLength(0);
  });

  it("paints nothing for a resize after the sheet closed", () => {
    document.body.innerHTML = talkSheet(base);
    const drawn = drawing(orbCanvas(), 200);
    reduce(true);
    followTalk("idle", () => QUIET);
    const before = drawn.length;
    document.body.innerHTML = "";
    dispatchEvent(new Event("resize"));
    expect(drawn).toHaveLength(before);
  });

  it("draws one still frame under reduced motion, and redraws a still orb when the screen changes size", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "listening" });
    const drawn = drawing(orbCanvas(), 200);
    reduce(true);
    followTalk("listening", () => agentSpeaking);
    expect(frames).toHaveLength(0);
    expect(drawn).toContain("arc");
    const before = drawn.length;
    dispatchEvent(new Event("resize"));
    expect(drawn.length).toBeGreaterThan(before);
    expect(frames).toHaveLength(0);
  });

  it("never moves under reduced motion, and stops still if the user asks for it mid-talk", () => {
    document.body.innerHTML = talkSheet({ ...base, phase: "connecting" });
    reduce(true);
    followTalk("connecting", () => QUIET);
    expect(frames).toHaveLength(0);
    expect(orbNow().appear.value).toBe(1);
    expect(orbNow().dim.value).toBeLessThan(1);
    reduce(false);
    followTalk("speaking", () => agentSpeaking);
    runFrames(5);
    reduce(true);
    runFrames(5);
    expect(frames).toHaveLength(0);
    expect(orbNow().agent.value).toBe(0);
  });
});
