// @vitest-environment happy-dom
// The promise of the modes: a reading in a mode never moves the user's bookmark or the user's log, and it comes back where the user left it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  cachedPage: vi.fn(() => null), loadedFont: vi.fn(() => null), loadPage: vi.fn(async () => ({ offline: true })),
  pageFont: vi.fn(async () => ({ offline: true })), downloadFont: vi.fn(), fontsOnPhone: vi.fn(async () => 0),
}));
const store = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../src/quran/mushafFiles.ts", () => files);
vi.mock("../src/store.ts", () => ({
  KEYS: { quran: "quran", mushaf: "mushaf", friday: "friday", modes: "modes" }, write: store.write, read: vi.fn(), keepAside: vi.fn(),
}));

import { emptyFridayLog, toggleFriday } from "../src/faith/friday.ts";
import { sampleLearn as seedLearn, TRADING_ID } from "./fixtures/learn.ts";
import { emptyModeLog, placeOf, stepCount } from "../src/modes/modes.ts";
import { DUBAI } from "./fixtures/places.ts";
import { addDays, dayTimes } from "../src/prayer/times.ts";
import { emptyQuranLog } from "../src/quran/log.ts";
import { emptyMarks, moveBookmark } from "../src/quran/marks.ts";
import { hooks, state } from "../src/app/state.ts";
import * as modes from "../src/app/modesActions.ts";
import * as mushaf from "../src/app/mushafActions.ts";

const days = Array.from({ length: 11 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 21 }, i), "Dubai"));
const friday = days[2];
const saturday = days[3];
const onFriday = new Date(friday.dhuhr.getTime() - 3_600_000);
const FRIDAY = "2026-10-23";
const LUQMAN = 413;

beforeEach(() => {
  store.write.mockClear();
  state.days = days;
  state.place = DUBAI;
  state.mushaf = moveBookmark(emptyMarks(), LUQMAN);
  state.quran = { ...emptyQuranLog(), position: 3 };
  state.friday = emptyFridayLog();
  state.modes = emptyModeLog();
  state.learn = seedLearn();
  state.screen = "mode:jumuah";
  state.mushafGuest = null;
  state.mushafJumpFrom = null;
  state.mushafReading = false;
  state.mushafPage = 1;
  state.spread = false;
  state.sheet = null;
  state.blocked.clear();
  state.notice = "";
  state.modeRemoveArmed = null;
  state.learnSheetMinutes = null;
  hooks.render = vi.fn();
  hooks.renderOverlay = vi.fn();
  hooks.softRender = vi.fn();
  hooks.closeSheet = vi.fn();
  hooks.go = vi.fn();
  hooks.showReader = vi.fn();
  document.body.innerHTML = `<div id="overlay"><p data-sheet-error hidden></p></div><div id="live"></div>`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Al-Kahf on Jumu'ah", () => {
  it("opens at the surah without moving the bookmark or the log", () => {
    modes.read("kahf", onFriday);
    expect(state.mushafPage).toBe(293);
    expect(state.mushafGuest?.label).toBe("Surah Al-Kahf");
    expect(state.mushafFrom).toBe("mode:jumuah");
    expect(hooks.showReader).toHaveBeenCalled();
    mushaf.turnTo(294);
    mushaf.turnTo(295);
    expect(state.mushaf.lastPage).toBe(LUQMAN);
    expect(state.quran.position).toBe(3);
  });

  it("keeps its own place and comes back to it", () => {
    modes.read("kahf", onFriday);
    mushaf.turnTo(294);
    mushaf.turnTo(295);
    expect(placeOf(state.modes, `18-${FRIDAY}`)).toBe(295);
    expect(store.write).toHaveBeenCalled();
    state.mushafPage = 1;
    modes.read("kahf", onFriday);
    expect(state.mushafPage).toBe(295);
  });

  it("starts afresh next Friday", () => {
    modes.read("kahf", onFriday);
    mushaf.turnTo(294);
    const nextFriday = new Date(days[9].dhuhr.getTime() - 3_600_000);
    modes.read("kahf", nextFriday);
    expect(state.mushafPage).toBe(293);
  });

  it("stays within the surah's pages", () => {
    modes.read("kahf", onFriday);
    expect(mushaf.turnTo(292)).toBe(false);
    expect(state.mushafPage).toBe(293);
    state.mushafPage = 304;
    expect(mushaf.turnTo(305)).toBe(false);
    expect(state.mushafPage).toBe(304);
  });

  it("draws no page past its own, so there is nothing to swipe to", () => {
    modes.read("kahf", onFriday);
    expect(mushaf.readerModel(onFriday).pages.map((p) => p.page)).toEqual([293, 294]);
    state.mushafPage = 304;
    expect(mushaf.readerModel(onFriday).pages.map((p) => p.page)).toEqual([303, 304]);
    state.spread = true;
    state.mushafPage = 293;
    expect(mushaf.readerModel(onFriday).pages.map((p) => p.page)).toEqual([293, 294, 295, 296]);
  });

  it("stays within them with two pages open too, and a spread that touches the surah may open", () => {
    state.spread = true;
    modes.read("kahf", onFriday);
    expect(mushaf.turnTo(291)).toBe(false);
    expect(mushaf.turnTo(295)).toBe(true);
    expect(placeOf(state.modes, `18-${FRIDAY}`)).toBe(296);
    expect(state.mushaf.lastPage).toBe(LUQMAN);
  });

  it("goes back to the usual reader on the next ordinary opening", () => {
    modes.read("kahf", onFriday);
    mushaf.openFrom(LUQMAN, "continue");
    expect(state.mushafGuest).toBeNull();
    mushaf.turnTo(LUQMAN + 1);
    expect(state.mushaf.lastPage).toBe(LUQMAN + 1);
    expect(placeOf(state.modes, `18-${FRIDAY}`)).toBeNull();
  });

  it("says in the reader where the user's own reading stays, and offers the tick on the last page", () => {
    modes.read("kahf", onFriday);
    state.mushafPage = 304;
    const guest = mushaf.readerModel(onFriday).guest;
    expect(guest).toMatchObject({ first: 293, last: 304, bookmark: LUQMAN, tick: { item: "kahf", done: false } });
    state.friday = toggleFriday(state.friday, FRIDAY, "kahf");
    expect(mushaf.readerModel(onFriday).guest?.tick?.done).toBe(true);
  });

  it("can be read outside Jumu'ah, with no tick and no place kept", () => {
    const tuesday = new Date(days[6].dhuhr.getTime());
    modes.read("kahf", tuesday);
    mushaf.turnTo(294);
    expect(state.mushafGuest?.placeKey).toBeNull();
    expect(state.modes.places).toEqual({});
    expect(mushaf.readerModel(tuesday).guest?.tick).toBeNull();
    expect(state.mushaf.lastPage).toBe(LUQMAN);
  });

  it("goes straight to the reading from the prompt on Home, and back to Home", () => {
    state.screen = "home";
    modes.pick("jumuah", onFriday);
    expect(state.mushafGuest?.first).toBe(293);
    expect(state.mushafFrom).toBe("home");
  });

  it("opens the mode's screen from the prompt once Al-Kahf is ticked", () => {
    state.screen = "home";
    state.friday = toggleFriday(state.friday, FRIDAY, "kahf");
    modes.pick("jumuah", onFriday);
    expect(state.mushafGuest).toBeNull();
    expect(hooks.go).toHaveBeenCalledWith("mode:jumuah");
  });
});

describe("a jump in the go-to sheet while reading on", () => {
  it("offers the page the user came from, and takes the bookmark back with the user", () => {
    mushaf.openFrom(LUQMAN, "continue");
    mushaf.openFrom(293, "chosen");
    expect(state.mushaf.lastPage).toBe(293);
    expect(state.mushafJumpFrom).toBe(LUQMAN);
    mushaf.jumpBack();
    expect(state.mushaf.lastPage).toBe(LUQMAN);
    expect(state.mushafPage).toBe(LUQMAN);
    expect(state.mushafJumpFrom).toBeNull();
  });

  it("keeps the first page across a second jump, and forgets it on any other opening", () => {
    mushaf.openFrom(293, "chosen");
    mushaf.openFrom(500, "chosen");
    expect(state.mushafJumpFrom).toBe(LUQMAN);
    mushaf.openFrom(LUQMAN, "continue");
    expect(state.mushafJumpFrom).toBeNull();
  });

  it("offers nothing for a page chosen where the user already is", () => {
    mushaf.openFrom(LUQMAN, "chosen");
    expect(state.mushafJumpFrom).toBeNull();
  });

  it("goes back to where the user reads from, on a device whose bookmark was never set", () => {
    state.mushaf = emptyMarks();
    state.quran = { ...emptyQuranLog(), position: 200 };
    mushaf.openFrom(500, "chosen");
    expect(state.mushafJumpFrom).toBe(201);
  });
});

describe("counting in a mode", () => {
  const inFajr = new Date(saturday.fajr.getTime() + 60_000);

  beforeEach(() => {
    state.screen = "mode:fajr";
  });

  it("counts on the occasion's date, up to the step's count", () => {
    for (let i = 0; i < 12; i += 1) modes.count("ten", inFajr);
    expect(stepCount(state.modes, saturday.date, "fajr", "ten")).toBe(10);
  });

  it("does a step at once with Done, and undoes it with a second", () => {
    modes.toggleDone("ten", inFajr);
    expect(stepCount(state.modes, saturday.date, "fajr", "ten")).toBe(10);
    modes.toggleDone("ten", inFajr);
    expect(stepCount(state.modes, saturday.date, "fajr", "ten")).toBe(0);
  });

  it("opens ayat without a place, and never touches the bookmark", () => {
    modes.readAyat("kursi");
    expect(state.mushafPage).toBe(42);
    expect(state.mushafGuest).toMatchObject({ first: 42, last: 42, placeKey: null, tick: null });
    expect(mushaf.turnTo(43)).toBe(false);
    expect(state.mushaf.lastPage).toBe(LUQMAN);
  });

  it("counts nothing on Jumu'ah's steps when no Friday is open", () => {
    state.screen = "mode:jumuah";
    expect(modes.occasion("jumuah", new Date(days[6].dhuhr.getTime()))).toBeNull();
    expect(modes.occasion("istikhara", new Date(days[6].dhuhr.getTime()))).toBe(days[6].date);
  });

  it("writes nothing over a saved copy it could not read, and says so", () => {
    state.blocked.add("modes");
    modes.count("ten", inFajr);
    expect(state.modes).toEqual(emptyModeLog());
    expect(state.notice).not.toBe("");
    expect(store.write).not.toHaveBeenCalled();
  });

  it("puts a mode off until its next occasion", () => {
    modes.notNow("fajr", inFajr);
    expect(modes.modesModel(inFajr, "Asia/Dubai").waiting.map((w) => w.mode)).not.toContain("fajr");
    expect(modes.modesModel(inFajr, "Asia/Dubai").open.map((w) => w.mode)).toContain("fajr");
  });
});

describe("the user's own du'as", () => {
  const form = (name: string, text: string) => {
    const data = new FormData();
    data.set("name", name);
    data.set("text", text);
    return data;
  };

  it("are saved first and shown second", async () => {
    state.screen = "mode:fajr";
    modes.openDuaSheet("fajr");
    expect(state.sheet).toBe("mode-dua");
    await modes.submitDua(form("Example du'a", "the user's words"), 5);
    expect(Object.values(state.modes.duas)).toMatchObject([{ mode: "fajr", name: "Example du'a", text: "the user's words" }]);
    expect(hooks.closeSheet).toHaveBeenCalledWith(true);
  });

  it("stay in the sheet when empty or not saved", async () => {
    modes.openDuaSheet("fajr");
    await modes.submitDua(form("x", "  "), 5);
    expect(hooks.closeSheet).not.toHaveBeenCalled();
    store.write.mockResolvedValueOnce(false);
    await modes.submitDua(form("x", "words"), 5);
    expect(hooks.closeSheet).not.toHaveBeenCalled();
    expect(state.modes.duas).toEqual({});
  });

  it("show at once, and a double tap on Save adds one", async () => {
    modes.openDuaSheet("fajr");
    const first = modes.submitDua(form("x", "words"), 5);
    const second = modes.submitDua(form("x", "words"), 6);
    await Promise.all([first, second]);
    expect(Object.keys(state.modes.duas)).toHaveLength(1);
    expect(hooks.render).toHaveBeenCalled();
    expect(hooks.closeSheet).toHaveBeenCalledTimes(1);
  });

  it("say so when the list is full, not that nothing was written", async () => {
    modes.openDuaSheet("fajr");
    for (let i = 0; i < 100; i += 1) await modes.submitDua(form("x", "words"), i);
    expect(Object.keys(state.modes.duas)).toHaveLength(100);
    await modes.submitDua(form("x", "words"), 200);
    expect(document.querySelector("[data-sheet-error]")?.textContent).toContain("as many");
  });

  it("take two taps to remove, a moment apart, so a double tap does not remove", async () => {
    modes.openDuaSheet("fajr");
    await modes.submitDua(form("x", "words"), 5);
    const [id] = Object.keys(state.modes.duas);
    modes.removeDuaTap(id, 10_000);
    expect(state.modes.duas[id]).toBeDefined();
    modes.removeDuaTap(id, 10_100);
    expect(state.modes.duas[id]).toBeDefined();
    modes.removeDuaTap(id, 10_600);
    expect(state.modes.duas).toEqual({});
  });
});

describe("timing a study", () => {
  const MIN = 60_000;

  it("runs from Start, and Stop asks to log the minutes before it ends", () => {
    modes.startStudy(TRADING_ID, 1000);
    expect(state.modes.timer).toEqual({ trackId: TRADING_ID, startedAt: 1000 });
    modes.stopStudy(TRADING_ID, 1000 + 40 * MIN);
    expect(state.sheet).toBe("learn-session");
    expect(state.learnSheetMinutes).toBe(40);
    expect(state.modes.timer).not.toBeNull();
  });

  it("ends once the sheet has saved, and not if it is still open", () => {
    modes.startStudy(TRADING_ID, 1000);
    modes.stopStudy(TRADING_ID, 1000 + 40 * MIN);
    modes.studyLogged();
    expect(state.modes.timer).not.toBeNull();
    state.sheet = null;
    modes.studyLogged();
    expect(state.modes.timer).toBeNull();
    expect(state.learnSheetMinutes).toBeNull();
  });

  it("leaves a timer alone when a log came from elsewhere", () => {
    modes.startStudy(TRADING_ID, 1000);
    state.sheet = null;
    modes.studyLogged();
    expect(state.modes.timer).not.toBeNull();
  });

  it("can be let go with two taps, logging nothing", () => {
    modes.startStudy(TRADING_ID, 1000);
    modes.dropStudy(20_000);
    expect(state.modes.timer).not.toBeNull();
    modes.dropStudy(20_600);
    expect(state.modes.timer).toBeNull();
    expect(state.learn.sessions).toEqual([]);
  });

  it("ignores a track that is not there, and a choice that is not one", () => {
    modes.startStudy("nope", 1000);
    expect(state.modes.timer).toBeNull();
    modes.setAfter(TRADING_ID, "noon", 1);
    expect(state.modes.study).toEqual({});
    modes.setAfter(TRADING_ID, "asr", 1);
    expect(state.modes.study[TRADING_ID].after).toBe("asr");
  });
});
