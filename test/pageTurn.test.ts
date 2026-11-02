// The book's physics: a landing that keeps the swipe's speed, and a spring that starts from it.
import { describe, expect, it } from "vitest";
import { atRest, bookAllowed, landedPage, landingOf, resisted, springStep, type Motion } from "../src/ui/pageTurn.ts";

describe("the landing", () => {
  it("goes by how far it got when the finger has stopped", () => {
    expect(landingOf(0.6, 0, true, true)).toBe(1);
    expect(landingOf(0.4, 0, true, true)).toBe(0);
    expect(landingOf(-0.6, 0, true, true)).toBe(-1);
  });

  it("lets a flick land it from anywhere", () => {
    expect(landingOf(0.1, 3, true, true)).toBe(1);
    expect(landingOf(-0.1, -3, true, true)).toBe(-1);
  });

  it("lets a flick back cancel a turn most of the way over", () => {
    expect(landingOf(0.8, -3, true, true)).toBe(0);
  });

  it("never lands where there is no page", () => {
    expect(landingOf(0.9, 3, false, true)).toBe(0);
    expect(landingOf(-0.9, -3, true, false)).toBe(0);
  });

  it("opens the right page", () => {
    expect(landedPage(413, 1, false)).toBe(414);
    expect(landedPage(413, -1, true)).toBe(411);
    expect(landedPage(604, 1, false)).toBe(604);
  });
});

describe("the spring", () => {
  const run = (from: Motion, target: number): { end: Motion; steps: number; peak: number } => {
    let m = from;
    let steps = 0;
    let peak = from.pos;
    while (!atRest(m, target) && steps < 2000) {
      m = springStep(m, target, 1 / 120);
      peak = Math.max(peak, m.pos);
      steps += 1;
    }
    return { end: m, steps, peak };
  };

  it("arrives, in well under a second", () => {
    const { end, steps } = run({ pos: 0.2, velocity: 0 }, 1);
    expect(end.pos).toBeCloseTo(1, 2);
    expect(steps).toBeLessThan(110);
  });

  it("starts with the finger's speed", () => {
    expect(springStep({ pos: 0.2, velocity: 4 }, 1, 1 / 120).pos).toBeGreaterThan(springStep({ pos: 0.2, velocity: 0 }, 1, 1 / 120).pos);
  });

  it("carries a page going the wrong way round through a reversal, with no jump", () => {
    const first = springStep({ pos: 0.5, velocity: 3 }, 0, 1 / 120);
    expect(Math.abs(first.pos - 0.5)).toBeLessThan(0.05);
    expect(run({ pos: 0.5, velocity: 3 }, 0).end.pos).toBeCloseTo(0, 2);
  });

  it("never passes the end of the turn", () => {
    expect(run({ pos: 0.9, velocity: 8 }, 1).peak).toBeLessThanOrEqual(1);
  });
});

describe("nowhere to go", () => {
  it("gives only a little", () => {
    expect(resisted(0.8, false, true)).toBe(0.05);
    expect(resisted(-0.8, true, false)).toBe(-0.05);
    expect(resisted(0.8, true, false)).toBe(0.8);
  });
});

describe("the setting", () => {
  it("is off when not wanted", () => {
    expect(bookAllowed(false, () => true)).toBe(false);
  });

  it("is on when wanted and the leaf can be drawn", () => {
    expect(bookAllowed(true, () => true)).toBe(true);
  });

  it("keeps the sliding pages where the leaf cannot be drawn", () => {
    expect(bookAllowed(true, () => false)).toBe(false);
  });
});
