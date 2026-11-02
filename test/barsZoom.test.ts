// While the mushaf's bars are up, each page's lines are drawn between them: as large as the room allows, moved as
// little as it takes, and left alone when the bars cover none of them.
import { describe, expect, it } from "vitest";
import { barsZoom } from "../src/ui/barsZoom.ts";

const close = (value: number, expected: number): void => expect(value).toBeCloseTo(expected, 6);

describe("the zoom for the bars", () => {
  it("shrinks a page that fills the screen to the room between the bars, centred in it", () => {
    // An open foldable: lines from 40 to 690, the bars leaving 90 to 600.
    const { scale, shift } = barsZoom({ top: 40, bottom: 690 }, { top: 90, bottom: 600 });
    close(scale, 510 / 650);
    // Drawn 510 high, centred on the room's middle (345), from the lines' middle (365).
    close(shift, 345 - 365);
  });

  it("leaves lines the bars do not touch exactly where they are", () => {
    expect(barsZoom({ top: 200, bottom: 500 }, { top: 90, bottom: 600 })).toEqual({ scale: 1, shift: 0 });
  });

  it("moves lines that fit but sit under a bar only as far as it takes to clear it", () => {
    const { scale, shift } = barsZoom({ top: 60, bottom: 360 }, { top: 90, bottom: 600 });
    expect(scale).toBe(1);
    close(shift, 30);
    const up = barsZoom({ top: 400, bottom: 640 }, { top: 90, bottom: 600 });
    close(up.shift, -40);
  });

  it("never draws the page smaller than half, centred on the room even if a bar then covers a little", () => {
    const { scale, shift } = barsZoom({ top: 0, bottom: 800 }, { top: 300, bottom: 500 });
    expect(scale).toBe(0.5);
    close(shift, 400 - 400);
  });

  it("does nothing for a page with no height, or no room at all", () => {
    expect(barsZoom({ top: 10, bottom: 10 }, { top: 90, bottom: 600 })).toEqual({ scale: 1, shift: 0 });
    expect(barsZoom({ top: 0, bottom: 600 }, { top: 300, bottom: 280 })).toEqual({ scale: 1, shift: 0 });
    expect(barsZoom({ top: Number.NaN, bottom: 600 }, { top: 90, bottom: 600 })).toEqual({ scale: 1, shift: 0 });
  });
});
