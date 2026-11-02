// @vitest-environment happy-dom
// The reader's pages and its revision marks: a page says plainly why it is not drawn yet, and a mark or note that
// could not be saved never looks saved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  cachedPage: vi.fn(),
  loadedFont: vi.fn(),
  loadPage: vi.fn(),
  pageFont: vi.fn(),
  downloadFont: vi.fn(),
  fontsOnPhone: vi.fn(async () => 0),
}));
const store = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../src/quran/mushafFiles.ts", () => files);
vi.mock("../src/store.ts", () => ({
  KEYS: { quran: "quran", mushaf: "mushaf", friday: "friday" }, write: store.write, read: vi.fn(), keepAside: vi.fn(),
}));

import { emptyQuranLog, lastRevised } from "../src/quran/log.ts";
import { emptyMarks } from "../src/quran/marks.ts";
import type { MushafPage } from "../src/quran/mushafPage.ts";
import { MESSAGES, hooks, state, today } from "../src/app/state.ts";
import * as mushaf from "../src/app/mushafActions.ts";

const glyph = String.fromCodePoint(0xfb51);
const page = (p: number, keys: string[]): MushafPage => ({ p, lines: [{ n: 1, kind: "words",
  words: keys.map((key) => ({ key, glyph, text: key })) }] });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  Object.values(files).forEach((f) => f.mockReset());
  files.fontsOnPhone.mockResolvedValue(0);
  files.loadPage.mockResolvedValue({ offline: true });
  files.pageFont.mockResolvedValue({ offline: true });
  store.write.mockReset();
  store.write.mockResolvedValue(true);
  state.mushaf = emptyMarks();
  state.mushafPage = 300;
  state.mushafReading = false;
  state.mushafTurned = false;
  state.mushafBarsHidden = false;
  state.blocked.clear();
  state.notice = "";
  state.sheet = null;
  state.word = null;
  state.spread = false;
  state.notePage = null;
  hooks.render = vi.fn();
  hooks.renderOverlay = vi.fn();
  hooks.softRender = vi.fn();
  hooks.closeSheet = vi.fn();
  document.body.innerHTML = `<div id="overlay"><p data-sheet-error hidden></p></div><div id="live"></div>`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a page in the reader", () => {
  it("is ready only with both its words and its font", () => {
    files.cachedPage.mockImplementation((p: number) => page(p, [`18:${p}:1`]));
    files.loadedFont.mockImplementation((p: number) => `qpc-p${p}`);
    const model = mushaf.readerModel();
    expect(model.pages.map((p) => p.status)).toEqual(["ready", "ready", "ready"]);
    expect(files.loadPage).not.toHaveBeenCalled();
  });

  it("shows Opening while it loads, then why it could not open", async () => {
    files.cachedPage.mockReturnValue(null);
    files.loadedFont.mockReturnValue("qpc-p301");
    files.pageFont.mockResolvedValue({ family: "qpc-p301" });
    state.mushafPage = 301;
    expect(mushaf.readerModel().pages.map((p) => p.status)).toEqual(["loading", "loading", "loading"]);
    await flush();
    expect(mushaf.readerModel().pages.map((p) => p.status)).toEqual(["offline", "offline", "offline"]);
    expect(hooks.softRender).toHaveBeenCalled();
  });

  it("that failed is tried again on Try again", async () => {
    state.mushafPage = 400;
    files.cachedPage.mockReturnValue(null);
    files.loadPage.mockResolvedValue({ failed: true });
    files.pageFont.mockResolvedValue({ family: "qpc-p400" });
    mushaf.readerModel();
    await flush();
    expect(mushaf.readerModel().pages[1].status).toBe("failed");
    const calls = files.loadPage.mock.calls.length;
    mushaf.retry();
    expect(files.loadPage.mock.calls.length).toBeGreaterThan(calls);
  });

  it("is not saved as your place again when you are already on it", () => {
    state.mushaf = { ...emptyMarks(), lastPage: 300, lastPageAt: Date.UTC(2026, 9, 1) };
    state.mushafReading = true;
    mushaf.open(300, true);
    expect(store.write).not.toHaveBeenCalled();
    mushaf.open(301, true);
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(state.mushaf.lastPage).toBe(301);
    expect(state.mushaf.lastPageAt).toBeGreaterThan(Date.UTC(2026, 9, 1));
  });
});

describe("the bookmark (where the user stopped reading)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T18:00:00Z"));
    state.screen = "mushaf";
    state.mushaf = { ...emptyMarks(), lastPage: 411, lastPageAt: Date.UTC(2026, 9, 28, 12) };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves with the pages when the mushaf was opened to read on", () => {
    mushaf.openFrom(411, "continue");
    expect(store.write).not.toHaveBeenCalled();
    expect(mushaf.turnTo(412)).toBe(true);
    expect(state.mushaf).toMatchObject({ lastPage: 412, lastPageAt: Date.UTC(2026, 9, 28, 18) });
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  it("is never moved by opening alone, so a device that has not synced yet cannot put the others' back", () => {
    // 0.12's marks: a last page and no time (the bookmark was never set).
    state.mushaf = { ...emptyMarks(), lastPage: 3, lastPageAt: 0 };
    mushaf.openFrom(4, "continue");
    expect(state.mushaf).toMatchObject({ lastPage: 3, lastPageAt: 0 });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("moves to a page chosen in the go-to sheet while reading on", () => {
    mushaf.openFrom(411, "chosen");
    expect(state.mushaf.lastPage).toBe(411);
    mushaf.openFrom(500, "chosen");
    expect(state.mushaf).toMatchObject({ lastPage: 500, lastPageAt: Date.UTC(2026, 9, 28, 18) });
  });

  it("stays where the user stopped when a page was opened to revise (muraja'ah, Al-Kahf, adhkar)", () => {
    mushaf.openFrom(22, "revise");
    expect(state.mushafPage).toBe(22);
    mushaf.turnTo(23);
    expect(state.mushaf.lastPage).toBe(411);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("is stamped later than its last move even when this clock went back", () => {
    state.mushaf = { ...state.mushaf, lastPageAt: Date.UTC(2026, 9, 28, 19) };
    mushaf.openFrom(411, "continue");
    mushaf.turnTo(412);
    expect(state.mushaf.lastPageAt).toBe(Date.UTC(2026, 9, 28, 19) + 1);
  });

  it("opens with the bars shown, a page turn leaves them as they are, a tap toggles them, and a notice holds them up", () => {
    state.mushafBarsHidden = true;
    mushaf.openFrom(411, "continue");
    expect(mushaf.barsHidden()).toBe(false);
    mushaf.turnTo(412);
    expect(mushaf.barsHidden()).toBe(false);
    mushaf.toggleBars();
    expect(mushaf.barsHidden()).toBe(true);
    mushaf.turnTo(413);
    expect(mushaf.barsHidden()).toBe(true);
    state.notice = "Not saved.";
    expect(mushaf.barsHidden()).toBe(false);
    mushaf.toggleBars();
    state.notice = "";
    expect(mushaf.barsHidden()).toBe(true);
  });

  it("lets a page turn clear a notice that only informs, and keeps one saying a change was not saved", () => {
    mushaf.openFrom(411, "continue");
    state.notice = "The whole mushaf is ready offline.";
    mushaf.turnTo(412);
    expect(state.notice).toBe("");
    // Bars the user had hidden stayed up only for the notice, and go with it.
    mushaf.toggleBars();
    state.notice = "The whole mushaf is ready offline.";
    expect(mushaf.barsHidden()).toBe(false);
    mushaf.turnTo(411);
    expect(state.notice).toBe("");
    expect(mushaf.barsHidden()).toBe(true);
    state.notice = MESSAGES.unsaved;
    mushaf.turnTo(413);
    expect(state.notice).toBe(MESSAGES.unsaved);
    expect(mushaf.barsHidden()).toBe(false);
  });

  it("opens as reading on, a page chosen while reading, or revision", () => {
    expect(mushaf.openModeFor("mushaf", null, false)).toBe("continue");
    expect(mushaf.openModeFor("mushaf:411", "goto", true)).toBe("chosen");
    // The go-to sheet inside a revision (Al-Kahf, then Juz 30) stays revision.
    expect(mushaf.openModeFor("mushaf:582", "goto", false)).toBe("revise");
    expect(mushaf.openModeFor("mushaf:293", null, true)).toBe("revise");
  });

  it("takes the reader to a bookmark from another device while it waits on the page it opened on", () => {
    mushaf.openFrom(3, "continue");
    state.mushaf = { ...state.mushaf, lastPage: 411 };
    mushaf.bookmarkArrived();
    expect(state.mushafPage).toBe(411);
  });

  it("leaves the reader where it is once a page has turned, or when it was opened to revise", () => {
    mushaf.openFrom(3, "continue");
    mushaf.turnTo(4);
    state.mushaf = { ...state.mushaf, lastPage: 411 };
    mushaf.bookmarkArrived();
    expect(state.mushafPage).toBe(4);
    mushaf.openFrom(22, "revise");
    mushaf.bookmarkArrived();
    expect(state.mushafPage).toBe(22);
  });
});

describe("two pages open (a big screen on its side)", () => {
  beforeEach(() => {
    state.spread = true;
    state.mushafPage = 299;
    state.quran = emptyQuranLog();
  });

  it("draws the open spread and a spread either side", () => {
    const model = mushaf.readerModel();
    expect(model.spread).toEqual([299, 300]);
    expect(model.pages.map((p) => p.page)).toEqual([297, 298, 299, 300, 301, 302]);
  });

  it("turns a spread at a time, rests on the right-hand page, and says when a rest was no turn", () => {
    expect(mushaf.turnTo(300)).toBe(false);
    expect(state.mushafPage).toBe(299);
    expect(hooks.render).not.toHaveBeenCalled();
    expect(mushaf.turnTo(302)).toBe(true);
    expect(state.mushafPage).toBe(301);
    expect(document.getElementById("live")?.textContent).toBe("Pages 301 and 302");
  });

  it("keeps a note on either page in view, and only those", async () => {
    mushaf.openPageNote("300");
    expect(state.notePage).toBe(300);
    mushaf.savePageNote("Weak at the end");
    await flush();
    expect(state.mushaf.pageNotes["300"]?.text).toBe("Weak at the end");
    mushaf.openPageNote("305");
    expect(state.notePage).toBe(299);
    state.spread = false;
    mushaf.openPageNote("300");
    expect(state.notePage).toBe(299);
  });

  it("opened at an even page, keeps that page open and takes a rest on its own spread as no turn", () => {
    state.mushafPage = 22;
    const model = mushaf.readerModel();
    expect(model.spread).toEqual([21, 22]);
    expect(mushaf.turnTo(21)).toBe(false);
    expect(state.mushafPage).toBe(22);
  });

  it("ticks the juz the plan opened (it begins on the left-hand page), from either page of the spread", async () => {
    state.mushafPage = 21;
    mushaf.reviseJuz();
    await flush();
    expect(lastRevised(state.quran)[2]).toBe(today());
    expect(lastRevised(state.quran)[1]).toBeUndefined();
    expect(mushaf.readerModel().revisedToday).toBe(true);
  });

  it("reads to the left-hand page", async () => {
    mushaf.readHere();
    await flush();
    expect(state.quran.position).toBe(300);
  });

  it("goes back to one page when the screen turns upright", () => {
    mushaf.setSpread(false);
    expect(mushaf.readerModel().spread).toBeNull();
    expect(mushaf.readerModel().pages.map((p) => p.page)).toEqual([298, 299, 300]);
  });
});

describe("a revision mark", () => {
  it("shows only once it is saved, then the sheet closes", async () => {
    state.word = "18:10:2";
    mushaf.markWord();
    await flush();
    expect(state.mushaf.mistakes["18:10:2"]?.count).toBe(1);
    expect(hooks.closeSheet).toHaveBeenCalledWith(true);
  });

  it("that could not be saved is not shown, and the open sheet says so", async () => {
    store.write.mockResolvedValue(false);
    state.word = "18:10:2";
    mushaf.saveAyahNote("Mutashabih with 2:25");
    await flush();
    expect(state.mushaf.notes).toEqual({});
    expect(hooks.closeSheet).not.toHaveBeenCalled();
    const error = document.querySelector<HTMLElement>("[data-sheet-error]");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toMatch(/could not be saved/);
  });

  it("is never written over saved data the app could not read", async () => {
    state.blocked.add("mushaf");
    state.word = "18:10:2";
    mushaf.markWord();
    await flush();
    expect(store.write).not.toHaveBeenCalled();
    expect(state.mushaf.mistakes).toEqual({});
  });

  it("made while a note is half typed leaves the sheet open, with the note and an up-to-date count", async () => {
    state.sheet = "word";
    state.word = "18:10:2";
    document.querySelector("#overlay")?.insertAdjacentHTML("afterbegin",
      `<button data-action="mushaf-mistake">Mark a mistake</button><textarea></textarea>`);
    const area = document.querySelector("textarea") as HTMLTextAreaElement;
    area.value = "Slipped into 18:9";
    mushaf.markWord();
    await flush();
    expect(state.mushaf.mistakes["18:10:2"]?.count).toBe(1);
    expect(hooks.closeSheet).not.toHaveBeenCalled();
    expect(area.value).toBe("Slipped into 18:9");
    expect(document.querySelector('[data-action="mushaf-mistake"]')?.textContent).toBe("Mark a mistake (1)");
    expect(document.querySelector("[data-sheet-error]")?.textContent).toMatch(/note is not saved yet/);
  });

  it("that saves takes down an earlier 'could not be saved'", async () => {
    store.write.mockResolvedValueOnce(false);
    state.word = "18:10:2";
    mushaf.markWord();
    await flush();
    expect(state.notice).toMatch(/could not be saved/);
    mushaf.markWord();
    await flush();
    expect(state.notice).toBe("");
  });

  it("keeps a page turn that happened while it was saving", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    store.write.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    state.word = "18:10:2";
    mushaf.markWord();
    state.mushaf = { ...state.mushaf, lastPage: 302 };
    finish(true);
    await flush();
    expect(state.mushaf.lastPage).toBe(302);
    expect(state.mushaf.mistakes["18:10:2"]?.count).toBe(1);
    expect(store.write).toHaveBeenCalledTimes(2);
  });
});

describe("the tapped word's ayah", () => {
  it("is gathered from both pages when it runs on to the next", () => {
    // 18:16 starts on page 295 (Tanzil page map) and, here, runs on to page 296.
    files.cachedPage.mockImplementation((p: number) => p === 295 ? page(295, ["18:15:9", "18:16:1", "18:16:2"])
      : p === 296 ? page(296, ["18:16:3", "18:17:1"]) : null);
    expect(mushaf.ayahWords("18:16:2").map((w) => w.key)).toEqual(["18:16:1", "18:16:2", "18:16:3"]);
  });
});
