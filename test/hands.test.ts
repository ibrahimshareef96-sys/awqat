// @vitest-environment happy-dom
// Swipes in the mushaf: a page turn happens once the pages are at rest and the finger is up, never under a finger,
// and a lost touchend or scrollend can never leave the app thinking a hand is still busy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ui/reader.ts", () => ({ settledPage: vi.fn(() => 294) }));

type Hands = typeof import("../src/app/hands.ts");
let hands: Hands;
let doc: Document;
let pager: HTMLElement;
const settled = vi.fn();
const free = vi.fn();

const touch = (type: string, fingers: number): void => {
  pager.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { touches: { length: fingers } }));
};
const scroll = (): void => { pager.dispatchEvent(new Event("scroll")); };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  settled.mockReset();
  free.mockReset();
  hands = await import("../src/app/hands.ts");
  doc = document.implementation.createHTMLDocument("reader");
  pager = doc.createElement("div");
  pager.dataset.pager = "";
  doc.body.append(pager);
  hands.listenForHands({ settled, free }, doc);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a swipe", () => {
  it("settles once the pages have been still for a moment", () => {
    scroll();
    expect(hands.handsMoving()).toBe(true);
    vi.advanceTimersByTime(hands.SETTLE_MS - 10);
    scroll();
    vi.advanceTimersByTime(hands.SETTLE_MS - 10);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(settled).toHaveBeenCalledWith(294);
    expect(hands.handsMoving()).toBe(false);
  });

  it("settles at once on scrollend", () => {
    scroll();
    pager.dispatchEvent(new Event("scrollend"));
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("waits while the finger holds the pages still, and settles after it lifts", () => {
    touch("touchstart", 1);
    scroll();
    vi.advanceTimersByTime(hands.SETTLE_MS * 5);
    expect(settled).not.toHaveBeenCalled();
    expect(hands.handsMoving()).toBe(true);
    touch("touchend", 0);
    vi.advanceTimersByTime(hands.SETTLE_MS);
    expect(settled).toHaveBeenCalledWith(294);
  });

  it("reports nothing to turn to when its pager was drawn anew", () => {
    scroll();
    pager.remove();
    vi.advanceTimersByTime(hands.SETTLE_MS);
    expect(settled).toHaveBeenCalledWith(null);
  });

  it("is forgotten when the pager is replaced or the app is left", () => {
    scroll();
    hands.pagerReplaced();
    expect(hands.handsMoving()).toBe(false);
    vi.advanceTimersByTime(hands.SETTLE_MS * 2);
    expect(settled).not.toHaveBeenCalled();
    touch("touchstart", 1);
    hands.resetHands();
    expect(hands.handsMoving()).toBe(false);
  });

  it("ignores scrolling that is not the pager's", () => {
    const list = doc.createElement("div");
    doc.body.append(list);
    list.dispatchEvent(new Event("scroll"));
    expect(hands.handsMoving()).toBe(false);
  });
});

describe("a finger", () => {
  it("frees the hands when it lifts, not when the browser takes the touch over for scrolling", () => {
    touch("touchstart", 1);
    pager.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    pager.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    vi.advanceTimersByTime(1);
    expect(free).not.toHaveBeenCalled();
    touch("touchend", 0);
    // Not inside touchend: the tap's click comes after it, and a redraw first would move what it lands on.
    expect(free).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(free).toHaveBeenCalledTimes(1);
  });

  it("does not free the hands on lifting while the pages still glide", () => {
    touch("touchstart", 1);
    scroll();
    touch("touchend", 0);
    vi.advanceTimersByTime(1);
    expect(free).not.toHaveBeenCalled();
    vi.advanceTimersByTime(hands.SETTLE_MS);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("whose touchend was lost counts as lifted after a while", () => {
    touch("touchstart", 1);
    expect(hands.handsMoving()).toBe(true);
    expect(hands.handsMoving(Date.now() + hands.TOUCH_STALE_MS)).toBe(false);
  });

  it("frees the hands after a tap, once the tap's click has run", () => {
    pager.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(hands.handsMoving()).toBe(true);
    pager.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(free).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(free).toHaveBeenCalledTimes(1);
  });
});
