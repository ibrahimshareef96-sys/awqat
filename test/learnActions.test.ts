// @vitest-environment happy-dom
// Learn's actions: every change goes through setLearn and is saved under Learn's key; a sheet says inside itself why
// it stays open, closes only once its change is saved, and adds nothing twice; Remove and Delete ask twice; a double
// tap does one thing; review moves a lesson once; the week turns at midnight in the user's zone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ write: vi.fn(async () => true), open: vi.fn(async () => undefined), native: false }));
vi.mock("../src/store.ts", () => ({ KEYS: { learn: "learn" }, write: mocks.write, read: vi.fn(), keepAside: vi.fn() }));
vi.mock("../src/device.ts", () => ({ isNative: () => mocks.native }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.open } }));

import { emptyLearn, weekMinutes, type Learn } from "../src/learn/learn.ts";
import { TRADING_ID, sampleLearn as seedLearn } from "./fixtures/learn.ts";
import { MESSAGES, hooks, state } from "../src/app/state.ts";
import { DUBAI } from "./fixtures/places.ts";
import {
  LEARN_MESSAGES, cycleStatus, lessonTyped, logStudy, openItem, openItemSheet, openLessonSheet, openLogSheet,
  removeItemTap, removeLessonTap, removeSessionTap, reviewLesson, setLearn, setTarget, submitItem, submitLesson,
  submitTrack, toggleArchive,
} from "../src/app/learnActions.ts";

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const sheetError = (): string | null | undefined => document.querySelector("[data-sheet-error]")?.textContent;
const saved = (): Learn => (mocks.write.mock.calls.at(-1) as unknown as [string, Learn])[1];
const live = (): string | null | undefined => document.getElementById("live")?.textContent;
/** Moves the clock on, past the pause between taps that move things. */
const later = (ms = 600): void => { vi.setSystemTime(new Date(Date.now() + ms)); };

// Every test starts at its own moment of 28 Oct in Dubai, so one test's last tap never counts as another's double tap.
let clock = Date.UTC(2026, 9, 28, 6);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock += 10 * 60_000;
  vi.setSystemTime(new Date(clock));
  vi.clearAllMocks();
  mocks.write.mockResolvedValue(true);
  mocks.native = false;
  state.place = DUBAI;
  state.learn = seedLearn();
  state.screen = "learn";
  state.sheet = null;
  state.learnSheetTrack = null;
  state.learnRemoveArmed = null;
  state.notice = "";
  state.blocked.clear();
  hooks.render = vi.fn();
  hooks.softRender = vi.fn();
  hooks.renderOverlay = vi.fn();
  hooks.closeSheet = vi.fn((): void => { state.sheet = null; });
  document.body.innerHTML = `<div id="overlay"><textarea></textarea><p data-sheet-error hidden></p></div><div id="live"></div>`;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("setLearn", () => {
  it("shows the change, says it, and saves it under Learn's key", async () => {
    const next = { ...emptyLearn() };
    expect(await setLearn(next, { said: "Done." })).toBe(true);
    expect(state.learn).toBe(next);
    expect(hooks.render).toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith("learn", next);
    expect(live()).toBe("Done.");
  });

  it("redraws again when the save failed, so the notice shows", async () => {
    mocks.write.mockResolvedValueOnce(false);
    expect(await setLearn(emptyLearn())).toBe(false);
    expect(state.notice).toBe(MESSAGES.unsaved);
    expect(hooks.softRender).toHaveBeenCalled();
  });

  it("never writes over a Learn that could not be read", async () => {
    state.blocked.add("learn");
    expect(await setLearn(emptyLearn())).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("the sheets", () => {
  it("opens a sheet only for a track that is there", () => {
    openLogSheet("missing");
    expect(state.sheet).toBeNull();
    openLogSheet(TRADING_ID);
    expect(state.sheet).toBe("learn-session");
    expect(state.learnSheetTrack).toBe(TRADING_ID);
  });

  it("logs study time, starts the item, and closes the sheet once it is saved", async () => {
    openLogSheet(TRADING_ID);
    await logStudy(form({ minutes: "45", item: "trading-shiller-02", note: "first half" }));
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(hooks.closeSheet).mock.invocationCallOrder[0]);
    expect(hooks.closeSheet).toHaveBeenCalledWith(true);
    const learn = saved();
    expect(learn.sessions[0]).toMatchObject({ trackId: TRADING_ID, itemId: "trading-shiller-02", minutes: 45,
      date: "2026-10-28", note: "first half" });
    expect(learn.items.find((i) => i.id === "trading-shiller-02")?.status).toBe("doing");
    expect(live()).toBe("45 min of Trading logged.");
  });

  it("keeps the sheet and what was typed when the save fails, and takes the change back", async () => {
    const before = state.learn;
    mocks.write.mockResolvedValueOnce(false);
    openLessonSheet(TRADING_ID);
    await submitLesson(form({ text: "Words worth keeping", source: "", item: "" }));
    expect(hooks.closeSheet).not.toHaveBeenCalled();
    expect(state.learn).toBe(before);
    expect(sheetError()).toBe(MESSAGES.unsaved);
    await submitLesson(form({ text: "Words worth keeping", source: "", item: "" }));
    expect(saved().lessons).toHaveLength(1);
    expect(hooks.closeSheet).toHaveBeenCalledTimes(1);
  });

  it("adds a sheet's change once, however often its button is tapped while saving", async () => {
    openLogSheet(TRADING_ID);
    const first = logStudy(form({ minutes: "30", item: "" }));
    await logStudy(form({ minutes: "30", item: "" }));
    await first;
    expect(state.learn.sessions).toHaveLength(1);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet open, saying why, for minutes that are not 1 to 600", async () => {
    openLogSheet(TRADING_ID);
    for (const minutes of ["0", "601", "2.5", ""]) {
      await logStudy(form({ minutes, item: "" }));
      expect(sheetError()).toBe(LEARN_MESSAGES.minutes);
    }
    expect(mocks.write).not.toHaveBeenCalled();
    expect(hooks.closeSheet).not.toHaveBeenCalled();
  });

  it("adds an item, giving a bare address its https://, and refuses any other kind of link", async () => {
    openItemSheet(TRADING_ID);
    for (const url of ["http://example.com", "javascript:alert(1)", "https:example.com", "ftp://example.com/x"]) {
      await submitItem(form({ title: "Notes", kind: "article", url }));
      expect(sheetError()).toBe(LEARN_MESSAGES.url);
    }
    expect(mocks.write).not.toHaveBeenCalled();
    await submitItem(form({ title: "Notes", kind: "article", url: "example.com:8080/notes" }));
    expect(saved().items.at(-1)).toMatchObject({ title: "Notes", kind: "article", url: "https://example.com:8080/notes",
      trackId: TRADING_ID });
  });

  it("asks for a title, and takes an unknown kind as other", async () => {
    openItemSheet(TRADING_ID);
    await submitItem(form({ title: " ", kind: "book", url: "" }));
    expect(sheetError()).toBe(LEARN_MESSAGES.noTitle);
    await submitItem(form({ title: "Talk", kind: "podcast", url: "" }));
    expect(saved().items.at(-1)).toMatchObject({ kind: "other", url: null });
  });

  it("saves a lesson due tomorrow, and asks for words first", async () => {
    openLessonSheet("track-hadith");
    await submitLesson(form({ text: "  ", source: "Muslim 1", item: "" }));
    expect(sheetError()).toBe(LEARN_MESSAGES.noText);
    await submitLesson(form({ text: "In my own words", source: "Sahih Muslim 2699", item: "" }));
    expect(saved().lessons[0]).toMatchObject({ trackId: "track-hadith", text: "In my own words",
      source: "Sahih Muslim 2699", due: "2026-10-29", step: 0 });
    expect(live()).toBe("Lesson saved. It comes back for review tomorrow.");
  });

  it("does not promise a review for a lesson on an archived track", async () => {
    state.learn = { ...state.learn, tracks: state.learn.tracks.map((t) => (t.id === "track-fiqh" ? { ...t, archived: true } : t)) };
    openLessonSheet("track-fiqh");
    await submitLesson(form({ text: "A ruling, in my words", source: "", item: "" }));
    expect(live()).toBe("Lesson saved. It comes back for review once the track is back.");
  });

  it("adds a track, and refuses one already there or a target past 3000", async () => {
    await submitTrack(form({ name: "Aqeedah", kind: "islamic", minutes: "3001" }));
    expect(sheetError()).toBe(LEARN_MESSAGES.weekly);
    await submitTrack(form({ name: "tafsir", kind: "islamic", minutes: "" }));
    expect(sheetError()).toBe('You have a track called "Tafsir" already.');
    expect(mocks.write).not.toHaveBeenCalled();
    await submitTrack(form({ name: "Aqeedah", kind: "islamic", minutes: "90" }));
    expect(saved().tracks.at(-1)).toMatchObject({ name: "Aqeedah", kind: "islamic", weeklyMinutes: 90, archived: false });
  });

  it("points to an archived track of the same name, and names the track limit when full", async () => {
    state.learn = { ...state.learn, tracks: state.learn.tracks.map((t) => (t.id === "track-fiqh" ? { ...t, archived: true } : t)) };
    await submitTrack(form({ name: "Fiqh", kind: "islamic", minutes: "" }));
    expect(sheetError()).toContain("archived");
    const many = Array.from({ length: 46 }, (_, i) => ({ ...state.learn.tracks[0], id: `t-${i}`, name: `Track ${i}` }));
    state.learn = { ...state.learn, tracks: [...state.learn.tracks, ...many] };
    await submitTrack(form({ name: "One more", kind: "worldly", minutes: "" }));
    expect(sheetError()).toBe(LEARN_MESSAGES.tracksFull);
  });

  it("asks before a half-written lesson is closed, and not for other sheets", () => {
    const area = document.querySelector("textarea")!;
    area.value = "Half a thought";
    state.sheet = "learn-lesson";
    expect(lessonTyped()).toBe(true);
    area.value = "  ";
    expect(lessonTyped()).toBe(false);
    area.value = "Half a thought";
    state.sheet = "learn-item";
    expect(lessonTyped()).toBe(false);
  });
});

describe("on the screens", () => {
  it("cycles an item's status and says it", async () => {
    await cycleStatus("trading-carver");
    expect(saved().items.find((i) => i.id === "trading-carver")?.status).toBe("doing");
    expect(live()).toBe("Yusuf Example, Sample Trading: doing.");
  });

  it("removes an item only on a second tap, and not on a double tap", async () => {
    await removeItemTap("trading-housel");
    expect(state.learnRemoveArmed).toBe("trading-housel");
    await removeItemTap("trading-housel");
    expect(mocks.write).not.toHaveBeenCalled();
    later();
    await removeItemTap("trading-housel");
    expect(state.learnRemoveArmed).toBeNull();
    expect(saved().items.some((i) => i.id === "trading-housel")).toBe(false);
  });

  it("deletes study time and a lesson only on a second tap", async () => {
    openLogSheet(TRADING_ID);
    await logStudy(form({ minutes: "20", item: "" }));
    openLessonSheet(TRADING_ID);
    await submitLesson(form({ text: "Kept unless asked twice", source: "", item: "" }));
    const sessionId = state.learn.sessions[0].id;
    const lessonId = state.learn.lessons[0].id;
    mocks.write.mockClear();
    await removeLessonTap(lessonId);
    expect(mocks.write).not.toHaveBeenCalled();
    later();
    await removeSessionTap(sessionId);
    expect(state.learnRemoveArmed).toBe(sessionId);
    expect(mocks.write).not.toHaveBeenCalled();
    later();
    await removeSessionTap(sessionId);
    expect(saved().sessions).toEqual([]);
    later();
    await removeLessonTap(lessonId);
    later();
    await removeLessonTap(lessonId);
    expect(saved().lessons).toEqual([]);
  });

  it("archives a track and brings it back, one change per double tap", async () => {
    await toggleArchive("track-fiqh");
    await toggleArchive("track-hadith");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(saved().tracks.find((t) => t.id === "track-fiqh")?.archived).toBe(true);
    later();
    await toggleArchive("track-fiqh");
    expect(saved().tracks.find((t) => t.id === "track-fiqh")?.archived).toBe(false);
  });

  it("sets the open track's weekly target, empty clearing it, and refuses one that is not 0 to 3000", async () => {
    state.screen = `learn:${TRADING_ID}`;
    await setTarget("abc");
    expect(state.notice).toBe(LEARN_MESSAGES.weekly);
    expect(mocks.write).not.toHaveBeenCalled();
    await setTarget("300");
    expect(saved().tracks[0].weeklyMinutes).toBe(300);
    await setTarget("");
    expect(saved().tracks[0].weeklyMinutes).toBe(0);
  });

  it("moves a reviewed lesson once, however often it is tapped", async () => {
    const start = Date.now();
    vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
    openLessonSheet(TRADING_ID);
    await submitLesson(form({ text: "A rule", source: "", item: "" }));
    const id = state.learn.lessons[0].id;
    vi.setSystemTime(new Date(start));
    mocks.write.mockClear();
    await reviewLesson(id, true);
    later();
    await reviewLesson(id, true);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(state.learn.lessons[0]).toMatchObject({ step: 1, due: "2026-10-31" });
    expect(live()).toBe("Next review in 3 days.");
  });

  it("lets a tap straight after a review go, so a double tap does not mark the next lesson unseen", async () => {
    const start = Date.now();
    vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
    openLessonSheet(TRADING_ID);
    await submitLesson(form({ text: "First", source: "", item: "" }));
    openLessonSheet(TRADING_ID);
    await submitLesson(form({ text: "Second", source: "", item: "" }));
    const [first, second] = state.learn.lessons.map((l) => l.id);
    vi.setSystemTime(new Date(start));
    await reviewLesson(first, true);
    later(300);
    await reviewLesson(second, false);
    expect(state.learn.lessons[1]).toMatchObject({ step: 0, due: "2026-10-21" });
    later();
    await reviewLesson(second, false);
    expect(state.learn.lessons[1]).toMatchObject({ step: 0, due: "2026-10-29" });
  });

  it("dates study by the user's zone: half past midnight on Monday in Dubai starts a new week", async () => {
    vi.setSystemTime(new Date("2026-11-01T19:30:00Z"));
    openLogSheet(TRADING_ID);
    await logStudy(form({ minutes: "40", item: "" }));
    vi.setSystemTime(new Date("2026-11-01T20:30:00Z"));
    openLogSheet(TRADING_ID);
    await logStudy(form({ minutes: "25", item: "" }));
    expect(state.learn.sessions.map((s) => s.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(weekMinutes(state.learn, "2026-11-02", TRADING_ID)).toBe(25);
    expect(weekMinutes(state.learn, "2026-11-01", TRADING_ID)).toBe(40);
  });

  it("opens only an item's https link, in the system browser on the device", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openItem("trading-housel");
    expect(open).not.toHaveBeenCalled();
    await openItem("trading-carver");
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/example\.com\/sample-trading/), "_blank", "noopener");
    mocks.native = true;
    await openItem("trading-chan");
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/^https:\/\/example\.com\/sample-quantitative-trading/) }));
    mocks.open.mockRejectedValueOnce(new Error("no browser"));
    await openItem("trading-chan");
    expect(state.notice).toBe(LEARN_MESSAGES.openFailed);
  });
});
