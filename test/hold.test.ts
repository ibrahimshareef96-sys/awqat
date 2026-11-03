// @vitest-environment happy-dom
// Holding a word in the mushaf picks its ayah: it lights as it is held and opens when the finger lifts. A tap is left
// to show or hide the bars. A swipe, a second finger, sliding away or lifting sooner is never a hold, and the click a
// hold leaves behind never reaches the app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Hold = typeof import("../src/app/hold.ts");
let hold: Hold;
let doc: Document;
let pager: HTMLElement;
let word: HTMLElement;
let sameAyah: HTMLElement;
let otherAyah: HTMLElement;
let margin: HTMLElement;
let retry: HTMLElement;
let ready = true;
let picks = true;
const held = vi.fn();
const clicked = vi.fn();

const pointer = (target: Element, type: string, init: PointerEventInit = {}): PointerEvent => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, button: 0,
    clientX: 100, clientY: 100, ...init });
  target.dispatchEvent(event);
  return event;
};
const click = (target: Element, detail = 1): MouseEvent => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, detail });
  target.dispatchEvent(event);
  return event;
};
const contextMenu = (target: Element): MouseEvent => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const lit = (): string[] => Array.from(doc.querySelectorAll<HTMLElement>(".held")).map((w) => w.dataset.word ?? "");

const button = (key: string): HTMLElement => {
  const el = doc.createElement("button");
  el.className = "w";
  el.dataset.word = key;
  return el;
};

/** Down on a word, held past the hold, then lifted: the ayah opens. */
const holdAndLift = (target: Element, ms = hold.HOLD_MS): void => {
  pointer(target, "pointerdown");
  vi.advanceTimersByTime(ms);
  pointer(target, "pointerup");
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  held.mockReset();
  clicked.mockReset();
  ready = true;
  picks = true;
  hold = await import("../src/app/hold.ts");
  doc = document.implementation.createHTMLDocument("reader");
  pager = doc.createElement("div");
  pager.dataset.pager = "";
  word = button("31:20:3");
  sameAyah = button("31:20:4");
  otherAyah = button("31:21:1");
  margin = doc.createElement("div");
  retry = doc.createElement("button");
  retry.dataset.action = "mushaf-retry";
  // Two pages drawn: the ayah runs on to the second.
  const right = doc.createElement("section");
  const left = doc.createElement("section");
  right.append(word, margin);
  left.append(sameAyah, otherAyah, retry);
  pager.append(right, left);
  doc.body.append(pager);
  hold.listenForHold({ hold: held, ready: () => ready, picks: () => picks }, doc);
  doc.addEventListener("click", clicked);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("holding a word", () => {
  it("lights the ayah as it is held, and opens it only when the finger lifts", () => {
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HINT_MS);
    expect(lit()).toEqual(["31:20:3", "31:20:4"]);
    vi.advanceTimersByTime(hold.HOLD_MS * 4);
    expect(held).not.toHaveBeenCalled();
    pointer(word, "pointerup");
    expect(held).toHaveBeenCalledWith(word);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it("keeps the ayah lit while its sheet is up, again after a redraw, and lets it go when it closes", () => {
    holdAndLift(word);
    expect(lit()).toEqual(["31:20:3", "31:20:4"]);
    // The pages drawn anew: the words are new elements, with no light of their own.
    const fresh = button("31:20:3");
    word.replaceWith(fresh);
    hold.relight(doc);
    expect(lit()).toEqual(["31:20:3", "31:20:4"]);
    hold.release(doc);
    expect(lit()).toEqual([]);
    hold.relight(doc);
    expect(lit()).toEqual([]);
  });

  it("still holds when the finger trembles less than the slop", () => {
    pointer(word, "pointerdown");
    pointer(word, "pointermove", { clientX: 100 + hold.SLOP_PX - 2, clientY: 103 });
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointerup");
    expect(held).toHaveBeenCalledTimes(1);
  });

  it("swallows the click the hold leaves behind, however long it was held, once, wherever it lands", () => {
    holdAndLift(word, 2000);
    click(doc.body);
    expect(clicked).not.toHaveBeenCalled();
    click(margin);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("lets a click through once the hold's own click can no longer come", () => {
    holdAndLift(word);
    vi.advanceTimersByTime(hold.CLICK_AFTER_HOLD_MS);
    click(margin);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("forgets a hold's click when the next press starts (Chrome may send none after a long press)", () => {
    holdAndLift(word);
    pointer(margin, "pointerdown");
    pointer(margin, "pointerup");
    click(margin);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("never swallows a click from the keyboard or a screen reader", () => {
    holdAndLift(word);
    click(otherAyah, 0);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("lets the ayah go when the finger slides away before lifting", () => {
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointermove", { clientX: 100 + hold.SLOP_PX + 1 });
    expect(lit()).toEqual([]);
    pointer(word, "pointerup");
    expect(held).not.toHaveBeenCalled();
  });

  it("opens when the system takes a finger held still after its own long press", () => {
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS);
    contextMenu(word);
    pointer(word, "pointercancel");
    expect(held).toHaveBeenCalledWith(word);
  });

  it("lets the ayah go when a system gesture or a swipe takes the held touch (no long press of its own)", () => {
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointercancel");
    expect(held).not.toHaveBeenCalled();
    expect(lit()).toEqual([]);
  });

  it("shows a shade stronger once the hold has taken, and keeps it while the sheet is up", () => {
    const armed = (): string[] => Array.from(doc.querySelectorAll<HTMLElement>(".held.armed")).map((w) => w.dataset.word ?? "");
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HINT_MS);
    expect(armed()).toEqual([]);
    vi.advanceTimersByTime(hold.HOLD_MS - hold.HINT_MS);
    expect(armed()).toEqual(["31:20:3", "31:20:4"]);
    pointer(word, "pointerup");
    word.replaceWith(button("31:20:3"));
    hold.relight(doc);
    expect(armed()).toEqual(["31:20:3", "31:20:4"]);
  });

  it("opens nothing when the word was drawn away before the finger lifted", () => {
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS);
    word.remove();
    pointer(pager, "pointerup");
    expect(held).not.toHaveBeenCalled();
    expect(lit()).toEqual([]);
  });
});

describe("no hold", () => {
  it("for a tap: lifted sooner, its click goes on to show or hide the bars", () => {
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HINT_MS + 50);
    pointer(word, "pointerup");
    click(word);
    vi.advanceTimersByTime(hold.HOLD_MS);
    expect(held).not.toHaveBeenCalled();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(lit()).toEqual([]);
  });

  it("for a swipe: the finger moved past the slop, before the ayah lit", () => {
    pointer(word, "pointerdown");
    pointer(word, "pointermove", { clientX: 100 + hold.SLOP_PX + 1 });
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointerup");
    expect(held).not.toHaveBeenCalled();
    expect(lit()).toEqual([]);
  });

  it("when the browser takes the finger for a swipe before the hold, or the pages move", () => {
    pointer(word, "pointerdown");
    pointer(word, "pointercancel");
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS);
    pager.dispatchEvent(new Event("scroll"));
    pointer(word, "pointerup");
    expect(held).not.toHaveBeenCalled();
  });

  it("when a second finger comes down", () => {
    pointer(word, "pointerdown");
    pointer(sameAyah, "pointerdown", { isPrimary: false, pointerId: 2 });
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointerup");
    expect(held).not.toHaveBeenCalled();
  });

  it("while a sheet is up, or off the mushaf", () => {
    ready = false;
    holdAndLift(word);
    expect(held).not.toHaveBeenCalled();
    expect(lit()).toEqual([]);
  });

  it("over a page being memorised: nothing lights over its hidden words, and the long press's click is swallowed", () => {
    picks = false;
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS * 4);
    expect(lit()).toEqual([]);
    pointer(word, "pointerup");
    expect(held).not.toHaveBeenCalled();
    expect(lit()).toEqual([]);
    click(word);
    expect(clicked).not.toHaveBeenCalled();
    // A right click with a mouse picks nothing either, and still opens no menu.
    expect(contextMenu(word).defaultPrevented).toBe(true);
    expect(held).not.toHaveBeenCalled();
    expect(lit()).toEqual([]);
  });

  it("picks again once the page is no longer memorised", () => {
    picks = false;
    holdAndLift(word);
    picks = true;
    vi.advanceTimersByTime(hold.CLICK_AFTER_HOLD_MS);
    holdAndLift(word);
    expect(held).toHaveBeenCalledWith(word);
    expect(lit()).toEqual(["31:20:3", "31:20:4"]);
  });

  it("for a right mouse button pressed (its context menu is the hold instead)", () => {
    pointer(word, "pointerdown", { button: 2 });
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointerup", { button: 2 });
    expect(held).not.toHaveBeenCalled();
  });

  it("after the app was left: the press is dropped", () => {
    pointer(word, "pointerdown");
    hold.resetHold(doc);
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointerup");
    expect(held).not.toHaveBeenCalled();
  });

  it("away from the words: a long press there picks nothing, and its click does not toggle the bars", () => {
    pointer(margin, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(margin, "pointerup");
    click(margin);
    expect(held).not.toHaveBeenCalled();
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe("the system's long press and the right click", () => {
  it("arm the hold when the system's comes first (the phone's own delay); the ayah opens on lifting, once", () => {
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(300);
    expect(contextMenu(word).defaultPrevented).toBe(true);
    expect(held).not.toHaveBeenCalled();
    vi.advanceTimersByTime(hold.HOLD_MS);
    pointer(word, "pointerup");
    expect(held).toHaveBeenCalledTimes(1);
  });

  it("show no menu and open nothing early while a hold is armed, anywhere", () => {
    const sheetText = doc.createElement("p");
    doc.body.append(sheetText);
    pointer(word, "pointerdown");
    vi.advanceTimersByTime(hold.HOLD_MS);
    expect(contextMenu(word).defaultPrevented).toBe(true);
    expect(contextMenu(sheetText).defaultPrevented).toBe(true);
    const select = new Event("selectstart", { bubbles: true, cancelable: true });
    sheetText.dispatchEvent(select);
    expect(select.defaultPrevented).toBe(true);
    expect(held).not.toHaveBeenCalled();
    pointer(word, "pointerup");
    expect(held).toHaveBeenCalledTimes(1);
    expect(contextMenu(sheetText).defaultPrevented).toBe(false);
  });

  it("opens the ayah at once for a right click with a mouse", () => {
    contextMenu(otherAyah);
    expect(held).toHaveBeenCalledWith(otherAyah);
  });

  it("shows no menu on the page away from the words, and leaves the rest of the app alone", () => {
    expect(contextMenu(margin).defaultPrevented).toBe(true);
    expect(held).not.toHaveBeenCalled();
    const outside = doc.createElement("textarea");
    doc.body.append(outside);
    expect(contextMenu(outside).defaultPrevented).toBe(false);
  });
});

describe("a click on the mushaf's page", () => {
  it("shows or hides the bars for a tap on a word or between the words", () => {
    expect(hold.tapOnPage(word, 1, true)).toBe("bars");
    expect(hold.tapOnPage(margin, 1, true)).toBe("bars");
  });

  it("opens the ayah as a button does for a word reached by keyboard or a screen reader", () => {
    expect(hold.tapOnPage(word, 0, true)).toBe("default");
  });

  it("leaves the page's own buttons, the rest of the app and a covered reader to the app", () => {
    expect(hold.tapOnPage(retry, 1, true)).toBe("default");
    const outside = doc.createElement("button");
    doc.body.append(outside);
    expect(hold.tapOnPage(outside, 1, true)).toBe("default");
    expect(hold.tapOnPage(word, 1, false)).toBe("default");
  });
});
