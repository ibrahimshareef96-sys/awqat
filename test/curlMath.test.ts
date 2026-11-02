// The shape of the turning page: flat at both ends, paper that never stretches, and a fold that moves one way only.
import { describe, expect, it } from "vitest";
import { curlAt, foldPoint, sceneAt, topPages } from "../src/ui/curlMath.ts";

const WIDTH = 600;
const every = (): boolean => true;

describe("the fold", () => {
  it("is nothing at rest: the whole page lies flat, where it was", () => {
    const shape = curlAt(0, WIDTH);
    expect(shape.radius).toBe(0);
    expect(shape.axis).toBe(WIDTH);
    expect(foldPoint(WIDTH, shape)).toEqual({ along: WIDTH, height: 0, phase: 0 });
    expect(foldPoint(0, shape).along).toBe(0);
  });

  it("at the end has laid the whole page flat on the other side of the spine", () => {
    const shape = curlAt(1, WIDTH);
    expect(shape.radius).toBe(0);
    expect(shape.axis).toBe(0);
    expect(foldPoint(WIDTH, shape).along).toBeCloseTo(-WIDTH);
    expect(foldPoint(WIDTH, shape).height).toBe(0);
    expect(foldPoint(WIDTH / 2, shape).along).toBeCloseTo(-WIDTH / 2);
  });

  it("moves towards the spine all the way, and never past it", () => {
    let axis = Infinity;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const shape = curlAt(p, WIDTH);
      expect(shape.axis).toBeLessThanOrEqual(axis + 1e-9);
      expect(shape.axis).toBeGreaterThanOrEqual(0);
      axis = shape.axis;
    }
  });

  it("carries the free edge steadily across, with no step anywhere in the turn", () => {
    let last = foldPoint(WIDTH, curlAt(0, WIDTH)).along;
    for (let p = 0.005; p <= 1.0001; p += 0.005) {
      const edge = foldPoint(WIDTH, curlAt(p, WIDTH)).along;
      expect(edge).toBeLessThan(last + 1e-6);
      expect(last - edge).toBeLessThan(WIDTH * 0.03);
      last = edge;
    }
  });

  it("with two pages open keeps the free edge under the finger through the middle of the turn", () => {
    for (const p of [0.3, 0.5, 0.7]) {
      const edge = foldPoint(WIDTH, curlAt(p, WIDTH)).along;
      expect(edge).toBeCloseTo(WIDTH - 2 * WIDTH * p, 0);
    }
  });

  it("never stretches the paper: what it covers round the fold is as long as what went into it", () => {
    const shape = curlAt(0.5, WIDTH);
    const steps = 2000;
    let length = 0;
    let previous = foldPoint(shape.axis, shape);
    for (let i = 1; i <= steps; i++) {
      const next = foldPoint(shape.axis + ((WIDTH - shape.axis) * i) / steps, shape);
      length += Math.hypot(next.along - previous.along, next.height - previous.height);
      previous = next;
    }
    expect(length).toBeCloseTo(WIDTH - shape.axis, 0);
  });

  it("leans with where it is held, and lands square", () => {
    expect(curlAt(0.5, WIDTH, 1).theta).toBeGreaterThan(0);
    expect(curlAt(0.5, WIDTH, -1).theta).toBeLessThan(0);
    expect(curlAt(0.5, WIDTH, 0).theta).toBe(0);
    expect(curlAt(0, WIDTH, 1).theta).toBeCloseTo(0);
    expect(curlAt(1, WIDTH, 1).theta).toBeCloseTo(0);
    expect(curlAt(0.5, WIDTH, 9).theta).toBe(curlAt(0.5, WIDTH, 1).theta);
  });

  it("stays in range whatever it is given", () => {
    expect(curlAt(-1, WIDTH).axis).toBe(WIDTH);
    expect(curlAt(2, WIDTH).axis).toBe(0);
  });
});

describe("one page open", () => {
  it("turning on lifts the open page off the next", () => {
    expect(sceneAt(0.4, 413, false, every)).toEqual({ progress: 0.4, front: 413, back: null, under: [414] });
  });

  it("turning back brings the page before over the open one, and is the same turn from its far end", () => {
    expect(sceneAt(-0.4, 413, false, every)).toEqual({ progress: 0.6, front: 412, back: null, under: [413] });
    expect(sceneAt(0.6, 412, false, every)).toEqual(sceneAt(-0.4, 413, false, every));
  });

  it("has no leaf before page 1", () => {
    expect(sceneAt(-0.4, 1, false, (p) => p >= 1)).toBeNull();
  });

  it("still lifts the last page a little, with nothing under it", () => {
    expect(sceneAt(0.04, 604, false, (p) => p <= 604)?.under).toEqual([]);
  });
});

describe("what lies on top", () => {
  it("is what is under the leaf", () => {
    expect(topPages({ progress: 0.4, front: 413, back: null, under: [414] }, false)).toEqual([414]);
    expect(topPages({ progress: 0.25, front: 414, back: 415, under: [413, 416] }, true)).toEqual([413, 416]);
  });

  it("with nothing under the leaf is the leaf's own page, so no other page shows past its edge", () => {
    expect(topPages({ progress: 0.04, front: 604, back: null, under: [] }, false)).toEqual([604]);
    expect(topPages({ progress: 0.04, front: 604, back: null, under: [603] }, true)).toEqual([603, 604]);
  });
});

describe("two pages open", () => {
  it("the leaf has this spread's left page on its face and the next spread's right page on its back", () => {
    expect(sceneAt(0.25, 413, true, every)).toEqual({ progress: 0.25, front: 414, back: 415, under: [413, 416] });
  });

  it("turning back is the same leaf from its far end", () => {
    expect(sceneAt(-0.75, 415, true, every)).toEqual(sceneAt(0.25, 413, true, every));
  });

  it("at the last spread has no back to the leaf", () => {
    const scene = sceneAt(0.04, 603, true, (p) => p <= 604);
    expect(scene?.back).toBeNull();
    expect(scene?.under).toEqual([603]);
  });

  it("has no leaf before the first spread", () => {
    expect(sceneAt(-0.4, 1, true, (p) => p >= 1)).toBeNull();
  });
});
