// @vitest-environment happy-dom
// The book under a finger: what a swipe, a flick, a tap and a page caught in the air each do, and where the pages end up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurlDriver } from "../src/ui/curlDriver.ts";
import type { TurnScene } from "../src/ui/curlMath.ts";

type Book = typeof import("../src/ui/pageTurn.ts");
let book: Book;
let doc: Document;
let pager: HTMLElement;
let frames: FrameRequestCallback[] = [];
let now = 0;
let scene: TurnScene | null = null;
let draws = 0;
let drawWorks = true;
const landed = vi.fn();
const moving = vi.fn();
const hide = vi.fn();
const prepare = vi.fn();
const WIDTH = 1000;

const driver: CurlDriver = {
  attach: () => undefined,
  begin: () => undefined,
  prepare,
  draw: (_pager, _pages, drawn) => {
    if (!drawWorks) return false;
    scene = drawn;
    draws += 1;
    return true;
  },
  hide,
  forget: () => undefined,
};

/** A pointer event at x, at this moment of the test's clock. */
function fire(type: string, x: number, y = 100, at = now): void {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "timeStamp", { value: at });
  pager.dispatchEvent(event);
}

function frame(): void {
  now += 16;
  const due = frames;
  frames = [];
  due.forEach((f) => f(now));
}

/** Runs the animation frames until the page is at rest. */
function settle(): void {
  for (let i = 0; i < 600 && frames.length > 0; i++) frame();
}

/** The pages lying on top. */
const shown = (): number[] => Array.from(pager.querySelectorAll<HTMLElement>("[data-page]"))
  .filter((p) => p.style.zIndex === "3")
  .map((p) => Number(p.dataset.page)).sort((a, b) => a - b);
const under = (page: number): boolean => pager.querySelector<HTMLElement>(`[data-page="${page}"]`)?.style.zIndex === "0";

function open(pages: number[], at: number, spread = false): void {
  pager.className = `pager book${spread ? " spread" : ""}`;
  Array.from(pager.querySelectorAll("[data-page]")).forEach((p) => p.remove());
  pager.insertAdjacentHTML("beforeend", pages.map((p) => `<div class="page" data-page="${p}"></div>`).join(""));
  book.layOutBook(pager, at);
}

function move(x: number, y = 100): void {
  now += 16;
  fire("pointermove", x, y);
  now -= 16;
  frame();
}

/** A slow drag, far enough to be a turn, frame by frame, then the finger stops and lifts. */
function dragAndHold(from: number, to: number): void {
  fire("pointerdown", from);
  const steps = 20;
  for (let i = 1; i <= steps; i++) move(from + ((to - from) * i) / steps);
  for (let i = 0; i < 12; i++) frame();
  fire("pointerup", to);
}

beforeEach(async () => {
  vi.resetModules();
  landed.mockReset();
  moving.mockReset();
  hide.mockReset();
  prepare.mockReset();
  frames = [];
  now = 1000;
  scene = null;
  draws = 0;
  drawWorks = true;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  book = await import("../src/ui/pageTurn.ts");
  doc = document.implementation.createHTMLDocument("reader");
  pager = doc.createElement("div");
  pager.dataset.pager = "";
  Object.defineProperty(pager, "clientWidth", { value: WIDTH });
  pager.setPointerCapture = vi.fn();
  doc.body.append(pager);
  book.listenForBook({ landed, moving }, doc, driver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a swipe", () => {
  it("past halfway turns on, a finger moving right", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("past halfway turns back, a finger moving left", () => {
    open([1, 2, 3], 2);
    dragAndHold(900, 200);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("short of halfway and slow falls back, and no page is turned", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 300);
    settle();
    expect(landed).not.toHaveBeenCalled();
    expect(shown()).toEqual([2]);
    expect(hide).toHaveBeenCalled();
    expect(moving).toHaveBeenLastCalledWith(false);
  });

  it("with two pages open turns a whole spread", () => {
    open([1, 2, 3, 4, 5, 6], 3, true);
    dragAndHold(100, 800);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("draws the leaf and puts the page under it, the page's own place taken by the next", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(300);
    expect(scene?.front).toBe(2);
    expect(scene?.under).toEqual([3]);
    expect(shown()).toEqual([3]);
    expect(under(2)).toBe(true);
  });

  it("never draws until a frame comes, however many touches arrive before it", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    const before = draws;
    fire("pointermove", 210);
    fire("pointermove", 220);
    fire("pointermove", 230);
    expect(draws).toBe(before);
    frame();
    expect(draws).toBe(before + 1);
  });

  it("closes on the finger within a few frames, and does not draw again once it has", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(600);
    for (let i = 0; i < 8; i++) frame();
    expect(scene?.progress).toBeCloseTo(0.4, 1);
    for (let i = 0; i < 80; i++) frame();
    const still = draws;
    frame();
    frame();
    expect(draws).toBe(still);
  });
});

describe("a flick", () => {
  it("lands the page from a short way, with the speed it left the finger", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(120);
    move(170);
    move(240);
    fire("pointerup", 240);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("back cancels a turn most of the way over", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    for (let x = 150; x <= 800; x += 50) move(x);
    for (let i = 0; i < 12; i++) frame();
    for (let x = 700; x >= 300; x -= 100) move(x);
    fire("pointerup", 300);
    settle();
    expect(landed).not.toHaveBeenCalled();
  });
});

describe("the start of a swipe", () => {
  it("does nothing inside the slop, so a hold on a word is left alone", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    now += 16;
    fire("pointermove", 108);
    frame();
    expect(pager.classList.contains("turning")).toBe(false);
    expect(moving).not.toHaveBeenCalled();
    expect(draws).toBe(0);
  });

  it("starts the page from where it lies, with no jump the size of the slop", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(140);
    expect(pager.classList.contains("turning")).toBe(true);
    expect(scene?.progress).toBe(0);
    move(150);
    expect(scene?.progress).toBeGreaterThan(0);
  });

  it("leaves an upright drag alone", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100, 100);
    now += 16;
    fire("pointermove", 115, 300);
    frame();
    expect(pager.classList.contains("turning")).toBe(false);
  });
});

describe("a tap", () => {
  it("turns nothing and keeps its click", () => {
    open([1, 2, 3], 2);
    const click = vi.fn();
    doc.addEventListener("click", click);
    fire("pointerdown", 100);
    fire("pointerup", 100);
    pager.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(landed).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it("the click a swipe ends in is swallowed", () => {
    open([1, 2, 3], 2);
    const click = vi.fn();
    doc.addEventListener("click", click);
    dragAndHold(100, 300);
    pager.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(click).not.toHaveBeenCalled();
  });
});

describe("a page caught in the air", () => {
  it("stops under the finger and can be sent back", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    frame();
    frame();
    expect(frames.length).toBe(1);
    const at = scene?.progress ?? 0;
    expect(at).toBeLessThan(0.88);
    fire("pointerdown", 800);
    frame();
    expect(scene?.progress).toBeCloseTo(at, 2);
    move(500);
    for (let x = 400; x >= 100; x -= 100) move(x);
    for (let i = 0; i < 12; i++) frame();
    fire("pointerup", 100);
    settle();
    expect(landed).not.toHaveBeenCalledWith(3);
  });

  it("a tap on it does not count as a tap on the page", () => {
    open([1, 2, 3], 2);
    const click = vi.fn();
    doc.addEventListener("click", click);
    dragAndHold(100, 800);
    frame();
    fire("pointerdown", 500);
    fire("pointerup", 500);
    pager.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(click).not.toHaveBeenCalled();
  });
});

describe("quick swipes through the pages", () => {
  /** Runs the page until it is all but down, without letting it land. */
  function nearlyDown(): void {
    for (let i = 0; i < 600 && (scene?.progress ?? 0) < 0.9; i++) frame();
  }
  const redraws = (page: number): void => { open([page - 1, page, page + 1], page); };

  it("each turn a page: a touch on a page all but down lands it, and starts the next", () => {
    landed.mockImplementation(redraws);
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    nearlyDown();
    expect(landed).not.toHaveBeenCalled();
    dragAndHold(100, 800);
    settle();
    expect(landed.mock.calls).toEqual([[3], [4]]);
  });

  it("a touch on a page still well in the air does not land it", () => {
    landed.mockImplementation(redraws);
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    frame();
    fire("pointerdown", 500);
    expect(landed).not.toHaveBeenCalled();
    expect(pager.classList.contains("turning")).toBe(true);
  });

  it("the second swipe's finger is held on the page drawn anew", () => {
    const drawnAnew = doc.createElement("div");
    drawnAnew.dataset.pager = "";
    Object.defineProperty(drawnAnew, "clientWidth", { value: WIDTH });
    drawnAnew.setPointerCapture = vi.fn();
    landed.mockImplementation((page: number) => {
      drawnAnew.className = "pager book";
      drawnAnew.insertAdjacentHTML("beforeend", [page - 1, page, page + 1].map((p) => `<div class="page" data-page="${p}"></div>`).join(""));
      pager.replaceWith(drawnAnew);
      book.layOutBook(drawnAnew, page);
    });
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    nearlyDown();
    fire("pointerdown", 100);
    expect(landed).toHaveBeenCalledOnce();
    expect(drawnAnew.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("a tap on a page all but down lands it and nothing more", () => {
    landed.mockImplementation(redraws);
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    nearlyDown();
    fire("pointerdown", 500);
    fire("pointerup", 500);
    settle();
    expect(landed.mock.calls).toEqual([[3]]);
  });
});

describe("where a turn cannot go", () => {
  it("the last page gives a little and stays", () => {
    open([603, 604], 604);
    dragAndHold(100, 900);
    settle();
    expect(landed).not.toHaveBeenCalled();
    expect(shown()).toEqual([604]);
    expect(scene?.progress).toBeLessThan(0.06);
  });

  it("a turn the reader refuses goes back to the page still open", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    settle();
    expect(landed).toHaveBeenCalledOnce();
    expect(shown()).toEqual([2]);
    expect(pager.dataset.open).toBe("2");
  });

  it("a turn the reader takes comes up on the next page before the leaf goes, and stays there", () => {
    const order: string[] = [];
    hide.mockImplementation(() => order.push(`hide with ${shown().join()}`));
    landed.mockImplementation((page: number) => {
      order.push("landed");
      book.layOutBook(pager, page);
    });
    open([1, 2, 3], 2);
    order.length = 0;
    dragAndHold(100, 800);
    settle();
    expect(order).toEqual(["hide with 3", "landed"]);
    expect(shown()).toEqual([3]);
    expect(pager.dataset.open).toBe("3");
  });

  it("waits a frame or two before the redraw a landing brings", () => {
    open([1, 2, 3], 2);
    hide.mockClear();
    dragAndHold(100, 800);
    for (let i = 0; i < 600 && hide.mock.calls.length === 0; i++) frame();
    expect(shown()).toEqual([3]);
    expect(landed).not.toHaveBeenCalled();
    frame();
    frame();
    expect(landed).toHaveBeenCalledOnce();
  });

  it("an older redraw while that waits does not put the old page back", () => {
    open([1, 2, 3], 2);
    hide.mockClear();
    dragAndHold(100, 800);
    for (let i = 0; i < 600 && hide.mock.calls.length === 0; i++) frame();
    book.layOutBook(pager, 2);
    expect(shown()).toEqual([3]);
    expect(pager.dataset.open).toBe("3");
  });

  it("the last page keeps its place while it gives, so no other page shows past its edge", () => {
    open([602, 603, 604], 604);
    fire("pointerdown", 100);
    move(300);
    move(500);
    expect(shown()).toEqual([604]);
  });

  it("a page drawn anew before a landing has told the reader still takes its place in the stack", () => {
    open([1, 2, 3], 2);
    hide.mockClear();
    dragAndHold(100, 800);
    for (let i = 0; i < 600 && hide.mock.calls.length === 0; i++) frame();
    const fresh = doc.createElement("div");
    fresh.dataset.page = "3";
    pager.querySelector('[data-page="3"]')?.replaceWith(fresh);
    book.layOutBook(pager, 2);
    expect(fresh.style.zIndex).toBe("3");
  });

  it("a touch the system took falls back", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(500);
    move(800);
    fire("pointercancel", 800);
    settle();
    expect(landed).not.toHaveBeenCalled();
    expect(shown()).toEqual([2]);
  });

  it("if the leaf cannot be drawn the pages stay as they lie, and a landing still lands", () => {
    drawWorks = false;
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    expect(shown()).toEqual([2]);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(3);
  });
});

describe("the last spread", () => {
  it("has nowhere to turn to, and no spring runs for nothing", () => {
    open([601, 602, 603, 604], 603, true);
    book.turnBook(1);
    expect(frames.length).toBe(0);
    expect(moving).not.toHaveBeenCalled();
  });
});

describe("the app left mid-swipe", () => {
  it("sends the page back and frees the arrows", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(500);
    move(800);
    book.resetBook();
    settle();
    expect(landed).not.toHaveBeenCalled();
    expect(shown()).toEqual([2]);
    book.turnBook(1);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("does nothing with no finger down", () => {
    open([1, 2, 3], 2);
    book.resetBook();
    expect(frames.length).toBe(0);
  });

  it("says a page still in flight is moving, after the app's return said nothing was", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    moving.mockClear();
    book.resetBook();
    expect(moving).toHaveBeenCalledWith(true);
  });
});

describe("the click after a turn", () => {
  it("a touch the system took sends no click, so the next tap counts", () => {
    open([1, 2, 3], 2);
    const click = vi.fn();
    doc.addEventListener("click", click);
    fire("pointerdown", 100);
    move(500);
    fire("pointercancel", 500);
    pager.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("a click from the keyboard or a screen reader is never swallowed", () => {
    open([1, 2, 3], 2);
    const click = vi.fn();
    doc.addEventListener("click", click);
    dragAndHold(100, 300);
    pager.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(click).toHaveBeenCalledOnce();
  });
});

describe("a redraw", () => {
  it("under a moving page on another page puts it at rest on the page given", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    book.layOutBook(pager, 3);
    expect(frames.length).toBe(0);
    expect(pager.classList.contains("turning")).toBe(false);
    expect(shown()).toEqual([3]);
  });

  it("under a page in flight on the same open page lets it fly on", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    book.layOutBook(pager, 2);
    expect(frames.length).toBe(1);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("under a page in flight draws it again on the next frame, since sizing the canvas clears it", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(500);
    move(800);
    for (let i = 0; i < 80; i++) frame();
    const still = draws;
    book.layOutBook(pager, 2);
    frame();
    expect(draws).toBe(still + 1);
  });

  it("with a finger holding the page leaves it in its hand", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(500);
    book.layOutBook(pager, 2);
    move(900);
    for (let i = 0; i < 8; i++) frame();
    expect(pager.classList.contains("turning")).toBe(true);
    expect(scene?.progress).toBeGreaterThan(0.3);
  });
});

describe("the arrow keys", () => {
  it("turn on and back by themselves", () => {
    open([1, 2, 3], 2);
    book.turnBook(1);
    settle();
    expect(landed).toHaveBeenLastCalledWith(3);
    open([1, 2, 3], 2);
    book.turnBook(-1);
    settle();
    expect(landed).toHaveBeenLastCalledWith(1);
  });

  it("do nothing at the end of the mushaf, or with no reader", () => {
    open([603, 604], 604);
    book.turnBook(1);
    expect(frames.length).toBe(0);
    pager.remove();
    book.turnBook(-1);
    expect(frames.length).toBe(0);
  });
});

describe("with the bars up", () => {
  let reader: HTMLElement;
  const at = (page: number): string => pager.querySelector<HTMLElement>(`[data-page="${page}"]`)?.style.transform ?? "";
  const px = (page: number): number => Number(/translate3d\((-?[\d.]+)px/.exec(at(page))?.[1]);

  beforeEach(() => {
    reader = doc.createElement("div");
    reader.className = "reader";
    doc.body.append(reader);
    reader.append(pager);
  });

  it("the pages slide side by side under the finger, and no leaf is drawn", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(400);
    for (let i = 0; i < 12; i++) frame();
    expect(draws).toBe(0);
    // Counted from where the swipe began to move (200): 200 of the page's 1000, to the right. The open page goes with
    // the finger, the next comes in from the left.
    expect(px(2)).toBeCloseTo(200, 0);
    expect(px(3)).toBeCloseTo(-800, 0);
    expect(px(1)).toBeCloseTo(1200, 0);
  });

  it("turning back, the page before comes in from the right", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 900);
    move(800);
    move(600);
    for (let i = 0; i < 12; i++) frame();
    expect(px(2)).toBeCloseTo(-200, 0);
    expect(px(1)).toBeCloseTo(800, 0);
  });

  it("a landing opens the next page, and every page goes back to its own place", () => {
    open([1, 2, 3], 2);
    landed.mockImplementation((page: number) => book.layOutBook(pager, page));
    dragAndHold(100, 800);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(3);
    expect(draws).toBe(0);
    expect(shown()).toEqual([3]);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("a page let go short of halfway slides back", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 300);
    settle();
    expect(landed).not.toHaveBeenCalled();
    expect(shown()).toEqual([2]);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("two pages open move as one", () => {
    open([1, 2, 3, 4, 5, 6], 3, true);
    fire("pointerdown", 100);
    move(200);
    move(400);
    for (let i = 0; i < 12; i++) frame();
    expect(px(3)).toBeCloseTo(200, 0);
    expect(px(4)).toBeCloseTo(200, 0);
    expect(px(5)).toBeCloseTo(-800, 0);
    expect(px(6)).toBeCloseTo(-800, 0);
    expect(px(2)).toBeCloseTo(1200, 0);
  });

  it("at the end of the mushaf the page only gives a little", () => {
    open([603, 604], 604);
    fire("pointerdown", 100);
    move(200);
    move(900);
    for (let i = 0; i < 12; i++) frame();
    expect(px(604)).toBeLessThanOrEqual(50);
    expect(px(604)).toBeGreaterThan(0);
  });

  it("a page in the air can be caught and reversed", () => {
    open([1, 2, 3], 2);
    book.turnBook(1);
    for (let i = 0; i < 6; i++) frame();
    const caughtAt = px(2);
    expect(caughtAt).toBeGreaterThan(0);
    fire("pointerdown", 500);
    frame();
    expect(px(2)).toBeCloseTo(caughtAt, 0);
    // Reversed under the finger, from exactly where it was caught.
    move(300);
    move(100);
    for (let i = 0; i < 12; i++) frame();
    expect(px(2)).toBeCloseTo(caughtAt - 400, 0);
    fire("pointerup", 100);
    settle();
    expect(landed).not.toHaveBeenCalled();
    expect(draws).toBe(0);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("the bars going in the middle of a turn change nothing until it lands", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(400);
    const before = px(2);
    reader.classList.add("bars-hidden");
    move(500);
    expect(px(2)).toBeGreaterThan(before);
    expect(draws).toBe(0);
    fire("pointerup", 500);
    settle();
    expect(draws).toBe(0);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("the bars coming in the middle of a curl change nothing until it lands", () => {
    reader.classList.add("bars-hidden");
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(400);
    const drawn = draws;
    expect(drawn).toBeGreaterThan(0);
    reader.classList.remove("bars-hidden");
    move(500);
    expect(draws).toBeGreaterThan(drawn);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
    fire("pointerup", 500);
    settle();
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("a redraw on another page leaves nothing moved", () => {
    open([1, 2, 3, 4], 2);
    fire("pointerdown", 100);
    move(200);
    move(400);
    fire("pointerup", 400);
    expect(px(2)).toBeGreaterThan(0);
    book.layOutBook(pager, 3);
    [1, 2, 3, 4].forEach((p) => expect(at(p)).toBe(""));
    expect(shown()).toEqual([3]);
  });

  it("a redraw on the same page goes on sliding, a page drawn anew taking its place in the row", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(400);
    for (let i = 0; i < 12; i++) frame();
    pager.insertAdjacentHTML("beforeend", `<div class="page" data-page="4"></div>`);
    book.layOutBook(pager, 2);
    frame();
    expect(px(2)).toBeCloseTo(200, 0);
    expect(px(4)).toBeCloseTo(-1800, 0);
  });

  it("the pager replaced in the middle of a slide stops the turn", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(400);
    expect(px(2)).toBeGreaterThan(0);
    pager.remove();
    frame();
    expect(frames.length).toBe(0);
    expect(moving).toHaveBeenLastCalledWith(false);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("a landing the reader refuses goes back to the page still open", () => {
    open([1, 2, 3], 2);
    dragAndHold(100, 800);
    settle();
    expect(landed).toHaveBeenCalledExactlyOnceWith(3);
    expect(shown()).toEqual([2]);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("a touch the system takes, or the app being left, slides the page back", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(700);
    fire("pointercancel", 700);
    settle();
    expect(landed).not.toHaveBeenCalled();
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
    fire("pointerdown", 100);
    move(200);
    move(700);
    book.resetBook();
    settle();
    expect(landed).not.toHaveBeenCalled();
    expect(moving).toHaveBeenLastCalledWith(false);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("the arrow keys and a screen reader's buttons slide too", () => {
    open([1, 2, 3], 2);
    landed.mockImplementation((page: number) => book.layOutBook(pager, page));
    book.turnBook(1);
    frame();
    frame();
    expect(px(2)).toBeGreaterThan(0);
    settle();
    expect(landed).toHaveBeenLastCalledWith(3);
    book.turnBook(-1);
    frame();
    frame();
    expect(px(3)).toBeLessThan(0);
    settle();
    expect(landed).toHaveBeenLastCalledWith(2);
    expect(draws).toBe(0);
  });

  it("a bar reached by keyboard counts as up, as it shows", () => {
    reader.classList.add("bars-hidden");
    open([1, 2, 3], 2);
    vi.spyOn(reader, "querySelector").mockReturnValue(doc.createElement("button"));
    book.turnBook(1);
    frame();
    frame();
    expect(px(2)).toBeGreaterThan(0);
    expect(draws).toBe(0);
  });

  it("leaves the curl's numbers in Settings as they were", () => {
    reader.classList.add("bars-hidden");
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(300);
    fire("pointerup", 300);
    settle();
    const curl = book.lastTurn();
    expect(curl.frames).toBeGreaterThan(0);
    reader.classList.remove("bars-hidden");
    fire("pointerdown", 100);
    move(200);
    move(300);
    fire("pointerup", 300);
    settle();
    expect(book.lastTurn()).toEqual(curl);
  });

  it("a curl that falls back starts the pictures again", () => {
    reader.classList.add("bars-hidden");
    vi.useFakeTimers();
    try {
      open([1, 2, 3], 2);
      dragAndHold(100, 300);
      settle();
      expect(landed).not.toHaveBeenCalled();
      prepare.mockClear();
      vi.advanceTimersByTime(1000);
      expect(prepare).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes no pictures, as nothing will curl until the bars are hidden", () => {
    vi.useFakeTimers();
    try {
      open([1, 2, 3], 2);
      vi.advanceTimersByTime(1000);
      expect(prepare).not.toHaveBeenCalled();
      reader.classList.add("bars-hidden");
      book.barsMoved();
      vi.advanceTimersByTime(1000);
      expect(prepare).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("with the bars hidden the same swipe curls, and no page moves", () => {
    reader.classList.add("bars-hidden");
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(200);
    move(400);
    expect(draws).toBeGreaterThan(0);
    [1, 2, 3].forEach((p) => expect(at(p)).toBe(""));
  });

  it("a tap between turns picks which way the next one goes", () => {
    open([1, 2, 3, 4], 2);
    dragAndHold(100, 800);
    settle();
    expect(draws).toBe(0);
    reader.classList.add("bars-hidden");
    book.layOutBook(pager, 3);
    dragAndHold(100, 800);
    settle();
    expect(draws).toBeGreaterThan(0);
  });
});

describe("the stats", () => {
  it("count the frames of the last turn and the late ones", () => {
    open([1, 2, 3], 2);
    fire("pointerdown", 100);
    move(300);
    move(400);
    now += 60;
    frame();
    fire("pointerup", 400);
    settle();
    const stats = book.lastTurn();
    expect(stats.frames).toBeGreaterThan(3);
    expect(stats.slow).toBe(1);
    expect(stats.longestMs).toBeGreaterThanOrEqual(70);
  });
});
