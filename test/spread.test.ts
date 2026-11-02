// The mushaf as it lies open on a big screen on its side: the odd page on the right, the even on the left.
import { describe, expect, it } from "vitest";
import { showsSpread, spreadNeighbours, spreadPages, spreadStart } from "../src/quran/spread.ts";

describe("when the mushaf opens as a spread", () => {
  it("on an iPad or an open foldable held on its side", () => {
    expect(showsSpread(1376, 1032)).toBe(true);
    expect(showsSpread(1133, 744)).toBe(true);
    expect(showsSpread(829, 690)).toBe(true);
    expect(showsSpread(882, 640)).toBe(true);
  });

  it("never upright, never on a phone on its side, never in a narrow window", () => {
    expect(showsSpread(1032, 1376)).toBe(false);
    expect(showsSpread(690, 829)).toBe(false);
    expect(showsSpread(956, 440)).toBe(false);
    expect(showsSpread(874, 402)).toBe(false);
    expect(showsSpread(915, 412)).toBe(false);
    expect(showsSpread(600, 520)).toBe(false);
  });
});

describe("which pages lie open together", () => {
  it("pairs each odd page with the even page after it", () => {
    expect(spreadPages(1)).toEqual([1, 2]);
    expect(spreadPages(2)).toEqual([1, 2]);
    expect(spreadPages(22)).toEqual([21, 22]);
    expect(spreadPages(603)).toEqual([603, 604]);
    expect(spreadPages(604)).toEqual([603, 604]);
    expect(spreadStart(300)).toBe(299);
  });

  it("readies the spreads either side, within the mushaf", () => {
    expect(spreadNeighbours(1)).toEqual([1, 2, 3, 4]);
    expect(spreadNeighbours(22)).toEqual([19, 20, 21, 22, 23, 24]);
    expect(spreadNeighbours(604)).toEqual([601, 602, 603, 604]);
  });
});
