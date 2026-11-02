// The microphone's sound for the speech model: resampling and cutting at pauses, with made-up signals.
import { describe, expect, it } from "vitest";
import { FIND_CUT, FRAME, MEMORISE_CUT, flush, hearFrame, level, resample, startListening, type Cut, type Listening } from "../src/recite/audio.ts";

const tone = (amplitude: number, n = FRAME): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / 16000));
const hum = (): Float32Array => tone(0.002);
const voice = (): Float32Array => tone(0.2);

/** Feeds frames, returning the stretches cut and the final state. */
function run(frames: Float32Array[], cut: Cut): { stretches: Float32Array[]; state: Listening } {
  let state = startListening();
  const stretches: Float32Array[] = [];
  for (const f of frames) {
    const out = hearFrame(state, f, cut);
    state = out.state;
    if (out.stretch) stretches.push(out.stretch);
  }
  return { stretches, state };
}

describe("resample", () => {
  it("brings 48 kHz down to 16 kHz, a third as many samples", () => {
    const out = resample(new Float32Array(4800).fill(0.5), 48000);
    expect(out.length).toBe(1600);
    expect(out[10]).toBeCloseTo(0.5);
  });

  it("handles 44.1 kHz, an uneven ratio", () => {
    expect(resample(new Float32Array(44100), 44100).length).toBe(16000);
  });

  it("averages, so a fast flicker above what 16 kHz can hold is smoothed out", () => {
    const flicker = Float32Array.from({ length: 4800 }, (_, i) => (i % 2 ? 1 : -1));
    expect(Math.max(...resample(flicker, 48000).map(Math.abs))).toBeLessThan(0.5);
  });

  it("copies when the rate is already right, and gives nothing for nonsense", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(Array.from(resample(input, 16000))).toEqual([expect.closeTo(0.1), expect.closeTo(0.2)]);
    expect(resample(input, 0).length).toBe(0);
    expect(resample(new Float32Array(0), 48000).length).toBe(0);
  });
});

describe("level", () => {
  it("is near 0 for hum and higher for a voice", () => {
    expect(level(hum())).toBeLessThan(0.005);
    expect(level(voice())).toBeGreaterThan(0.1);
    expect(level(new Float32Array(0))).toBe(0);
  });
});

describe("cutting speech at pauses", () => {
  it("sends nothing while the room is quiet", () => {
    const { stretches, state } = run(Array.from({ length: 30 }, hum), MEMORISE_CUT);
    expect(stretches).toEqual([]);
    expect(state.heardAny).toBe(false);
  });

  it("cuts a stretch after a pause, leaving most of the pause out", () => {
    const frames = [hum(), hum(), ...Array.from({ length: 10 }, voice), ...Array.from({ length: 6 }, hum)];
    const { stretches } = run(frames, MEMORISE_CUT);
    expect(stretches.length).toBe(1);
    expect(stretches[0].length).toBe(FRAME * 12);
  });

  it("cuts a long run of speech even without a pause, so words keep filling in", () => {
    const { stretches } = run(Array.from({ length: 125 }, voice), MEMORISE_CUT);
    expect(stretches.length).toBe(2);
    expect(stretches[0].length).toBe(FRAME * MEMORISE_CUT.longest);
  });

  it("drops a click or a cough too short to be words", () => {
    const frames = [hum(), voice(), voice(), ...Array.from({ length: 8 }, hum)];
    expect(run(frames, MEMORISE_CUT).stretches).toEqual([]);
  });

  it("waits for a longer pause when finding an ayah", () => {
    const frames = [hum(), ...Array.from({ length: 10 }, voice), ...Array.from({ length: 8 }, hum)];
    expect(run(frames, FIND_CUT).stretches).toEqual([]);
    expect(run([...frames, ...Array.from({ length: 4 }, hum)], FIND_CUT).stretches.length).toBe(1);
  });

  it("learns a noisy room's hum, so the fan is not taken for speech once a few seconds have passed", () => {
    const fan = (): Float32Array => tone(0.02);
    const { state } = run(Array.from({ length: 40 }, fan), MEMORISE_CUT);
    const after = run([...Array.from({ length: 40 }, fan), ...Array.from({ length: 20 }, fan)], MEMORISE_CUT);
    expect(after.state.spoken).toBe(0);
    expect(state.total).toBe(40);
  });

  it("still hears a voice in that room", () => {
    const fan = (): Float32Array => tone(0.02);
    const frames = [...Array.from({ length: 40 }, fan), ...Array.from({ length: 10 }, voice), ...Array.from({ length: 6 }, fan)];
    expect(run(frames, MEMORISE_CUT).stretches.length).toBeGreaterThanOrEqual(1);
  });

  it("hands over what is still being heard when the reciter stops", () => {
    const { state } = run([hum(), ...Array.from({ length: 8 }, voice)], MEMORISE_CUT);
    expect(flush(state, MEMORISE_CUT)?.length).toBe(FRAME * 8);
    expect(flush(startListening(), MEMORISE_CUT)).toBeNull();
  });
});
