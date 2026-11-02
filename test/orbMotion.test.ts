// The speaking orb's motion: springs that carry position and speed, the three bands of a voice, where each driver
// heads in each phase, and the dots of one frame (the user's voice ripples them, the agent's blooms them outward in gold).
import { describe, expect, it } from "vitest";
import { QUIET, SILENT, bandsOf, levelOf, loudness, type VoiceSignal } from "../src/talk/signal.ts";
import {
  HIDDEN, SHOWN, VOICE_SPRING, advance, bandAt, dotsFor, glowOf, mixRgb, rgbOf, settled, spherePoints, springStep,
  targetsFor, type OrbState,
} from "../src/ui/orbMotion.ts";

const FRAME = 1 / 60;
const run = (state: OrbState, phase: Parameters<typeof targetsFor>[0], signal: VoiceSignal, frames: number): OrbState => {
  let now = state;
  for (let i = 0; i < frames; i++) now = advance(now, targetsFor(phase, signal), FRAME);
  return now;
};
const loud = (him: number, agent: number): VoiceSignal => ({ him, agent, himBands: [him, him, him], agentBands: [agent, agent, agent] });
const meanReach = (state: OrbState): number => {
  const dots = dotsFor(spherePoints(200), state, 200);
  return dots.reduce((sum, d) => sum + Math.hypot(d.x - 100, d.y - 100), 0) / dots.length;
};

describe("a spring", () => {
  it("moves towards its target, keeps its speed into the next step, and settles there", () => {
    const first = springStep({ value: 0, velocity: 0 }, 1, FRAME, VOICE_SPRING);
    expect(first.value).toBeGreaterThan(0);
    expect(first.velocity).toBeGreaterThan(0);
    // A new target mid-move starts from where it is and how fast it goes: no jump.
    const turned = springStep(first, 0, FRAME, VOICE_SPRING);
    expect(Math.abs(turned.value - first.value)).toBeLessThan(0.05);
    let s = first;
    for (let i = 0; i < 600; i++) s = springStep(s, 1, FRAME, VOICE_SPRING);
    expect(s.value).toBeCloseTo(1, 3);
  });

  it("takes a target that is not a number as 0, and starts again at rest if knocked off the numbers", () => {
    const s = springStep({ value: 0.5, velocity: 0 }, Number.NaN, FRAME, VOICE_SPRING);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(s.value).toBeLessThan(0.5);
    expect(springStep({ value: Number.NaN, velocity: 0 }, 1, FRAME, VOICE_SPRING)).toEqual({ value: 1, velocity: 0 });
  });

  it("never changes the spring it was given", () => {
    const before = { value: 0.2, velocity: 0.1 };
    springStep(before, 1, FRAME, VOICE_SPRING);
    expect(before).toEqual({ value: 0.2, velocity: 0.1 });
  });
});

describe("what the orb hears", () => {
  it("reads a meter as 0 to 1, and anything broken as silence", () => {
    expect(levelOf(0.4)).toBe(0.4);
    expect(levelOf(2)).toBe(1);
    expect(levelOf(-1)).toBe(0);
    expect(levelOf(Number.NaN)).toBe(0);
    expect(levelOf(undefined)).toBe(0);
  });

  it("splits a voice into its body, its vowels and its edge", () => {
    expect(bandsOf(undefined)).toEqual(SILENT);
    expect(bandsOf(new Uint8Array(0))).toEqual(SILENT);
    const full = bandsOf(new Uint8Array(128).fill(255));
    expect(full.every((b) => b === 1)).toBe(true);
    // A reading of one bin still gives all three.
    expect(bandsOf(new Uint8Array([255]))).toEqual([1, 1, 1]);
  });

  it("covers the library's whole 100 Hz to 8 kHz reading: the body, the vowels and the s sounds", () => {
    // 1024 bins spread evenly over 100 Hz to 8 kHz: about 7.7 Hz a bin.
    const bin = (hz: number): number => Math.round(((hz - 100) / 7900) * 1024);
    const hum = new Uint8Array(1024);
    hum.fill(255, 0, bin(400));
    expect(bandsOf(hum)[0]).toBeGreaterThan(0.7);
    expect(bandsOf(hum)[2]).toBe(0);
    const hiss = new Uint8Array(1024);
    hiss.fill(255, bin(3500), bin(8000));
    const s = bandsOf(hiss);
    expect(s[0]).toBe(0);
    expect(s[2]).toBeGreaterThan(0.5);
  });

  it("gates the room's hum and lifts ordinary speech so it shows", () => {
    expect(loudness(0)).toBe(0);
    expect(loudness(0.015)).toBe(0);
    expect(loudness(0.15)).toBeGreaterThan(0.35);
    expect(loudness(0.15)).toBeLessThan(loudness(0.3));
    expect(loudness(1)).toBe(1);
    expect(loudness(Number.NaN)).toBe(0);
  });
});

describe("where the orb heads", () => {
  it("lets the voices through only while a talk is on", () => {
    expect(targetsFor("listening", loud(0.8, 0.2)).him).toBe(0.8);
    expect(targetsFor("speaking", loud(0.1, 0.9)).agent).toBe(0.9);
    expect(targetsFor("connecting", loud(1, 1)).him).toBe(0);
    expect(targetsFor("idle", loud(1, 1)).agent).toBe(0);
  });

  it("dims while connecting or ending, spins fastest while working, and rests when no talk is on", () => {
    expect(targetsFor("connecting", QUIET).dim).toBeLessThan(1);
    expect(targetsFor("ending", QUIET).dim).toBeLessThan(1);
    expect(targetsFor("listening", QUIET).dim).toBe(1);
    expect(targetsFor("working", QUIET).spin).toBeGreaterThan(targetsFor("speaking", QUIET).spin);
    expect(targetsFor("idle", QUIET)).toMatchObject({ spin: 0, life: 0 });
    expect(targetsFor("connecting", QUIET).life).toBe(1);
  });
});

describe("the orb over time", () => {
  it("appears when the sheet opens, from hidden to full, then settles still when no talk is on", () => {
    const opened = run(HIDDEN, "idle", QUIET, 30);
    expect(opened.appear.value).toBeGreaterThan(0.2);
    const rested = run(opened, "idle", QUIET, 600);
    expect(settled(rested, targetsFor("idle", QUIET))).toBe(true);
  });

  it("never settles while a voice is still moving it", () => {
    const talking = run(SHOWN, "speaking", loud(0, 0.9), 10);
    expect(settled(talking, targetsFor("speaking", loud(0, 0.9)))).toBe(false);
  });

  it("returns a new state each frame and keeps the old one as it was", () => {
    const before = SHOWN;
    const after = advance(before, targetsFor("speaking", loud(0, 1)), FRAME);
    expect(after).not.toBe(before);
    expect(before.agent.value).toBe(0);
  });

  it("follows the band a dot sits in: the body at the equator, the edge at the poles", () => {
    const bands = [{ value: 1, velocity: 0 }, { value: 0.5, velocity: 0 }, { value: 0, velocity: 0 }] as const;
    expect(bandAt(0, bands)).toBe(1);
    expect(bandAt(Math.PI / 4, bands)).toBeCloseTo(0.5, 5);
    expect(bandAt(-Math.PI / 2, bands)).toBe(0);
  });
});

describe("one frame of dots", () => {
  const points = spherePoints(240);

  it("spreads the dots over the whole sphere", () => {
    expect(points).toHaveLength(240);
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(0.99);
    expect(Math.min(...points.map((p) => p.y))).toBeLessThan(-0.99);
    for (const p of points) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 6);
  });

  it("keeps every dot on the canvas and draws the far ones first", () => {
    const loudest = run(SHOWN, "speaking", loud(1, 1), 40);
    const dots = dotsFor(points, loudest, 200);
    for (const d of dots) {
      expect(d.x - d.r).toBeGreaterThanOrEqual(0);
      expect(d.x + d.r).toBeLessThanOrEqual(200);
      expect(d.y - d.r).toBeGreaterThanOrEqual(0);
      expect(d.y + d.r).toBeLessThanOrEqual(200);
      expect(d.alpha).toBeGreaterThanOrEqual(0);
      expect(d.alpha).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < dots.length; i++) expect(dots[i]!.depth).toBeGreaterThanOrEqual(dots[i - 1]!.depth);
  });

  it("blooms outward and turns gold when the assistant speaks", () => {
    const still = meanReach(SHOWN);
    const speaking = run(SHOWN, "speaking", loud(0, 1), 40);
    expect(meanReach(speaking)).toBeGreaterThan(still * 1.05);
    const warm = dotsFor(points, speaking, 200).reduce((sum, d) => sum + d.warm, 0) / points.length;
    expect(warm).toBeGreaterThan(0.5);
    expect(glowOf(speaking).agent).toBeGreaterThan(glowOf(speaking).him);
  });

  it("ripples in the user's own colour when the user speaks, with no gold", () => {
    const listening = run(SHOWN, "listening", loud(1, 0), 40);
    const dots = dotsFor(points, listening, 200);
    expect(dots.every((d) => d.warm === 0)).toBe(true);
    const restDots = dotsFor(points, { ...listening, him: { value: 0, velocity: 0 } }, 200);
    const moved = dots.filter((d, i) => Math.abs(d.x - restDots[i]!.x) + Math.abs(d.y - restDots[i]!.y) > 0.5).length;
    expect(moved).toBeGreaterThan(points.length / 4);
  });

  it("is invisible before it appears", () => {
    expect(dotsFor(points, HIDDEN, 200).every((d) => d.alpha === 0)).toBe(true);
  });
});

describe("colours", () => {
  it("reads the page's colours and mixes the user's towards the assistant's", () => {
    expect(rgbOf("#e2cc9a", [0, 0, 0])).toEqual([226, 204, 154]);
    expect(rgbOf(" #fff ", [0, 0, 0])).toEqual([255, 255, 255]);
    expect(rgbOf("rgb(245, 241, 232)", [0, 0, 0])).toEqual([245, 241, 232]);
    expect(rgbOf("not a colour", [1, 2, 3])).toEqual([1, 2, 3]);
    expect(mixRgb([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
    expect(mixRgb([0, 0, 0], [200, 100, 50], 2)).toEqual([200, 100, 50]);
  });
});
