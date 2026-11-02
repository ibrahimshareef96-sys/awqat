// The Quran tracker: pages read through a full reading, revision by juz, and study sessions.
import { describe, expect, it } from "vitest";
import { JUZ_START_PAGE, PAGES, PAGE_START, SURA_NAMES } from "../src/quran/data.ts";
import {
  checkQuranLog, deleteEntry, emptyQuranLog, finishDate, juzOfPage, lastRevised, logRead, logRevision, logStudy,
  pageLabel, pagesOn, readingStreak, setDailyGoal, setPosition,
} from "../src/quran/log.ts";

describe("the daily goal and when the reading ends", () => {
  const TODAY = "2026-10-28";

  it("keeps a goal from 0 to 604 pages, and reads it back", () => {
    const log = setDailyGoal(emptyQuranLog(), 4);
    expect(log.dailyGoal).toBe(4);
    expect(setDailyGoal(log, -1)).toBe(log);
    expect(setDailyGoal(log, 2.5)).toBe(log);
    expect(setDailyGoal(log, 605)).toBe(log);
    expect(checkQuranLog(JSON.stringify(log)).log.dailyGoal).toBe(4);
    expect(checkQuranLog(JSON.stringify({ ...log, dailyGoal: 9999 })).log.dailyGoal).toBe(0);
    expect(checkQuranLog(JSON.stringify({ v: 1, position: 0, completed: 0, entries: [] })).log.dailyGoal).toBe(0);
  });

  it("ends the reading at the goal, counting today until its goal is met", () => {
    const start = setDailyGoal(setPosition(emptyQuranLog(), 596), 4);
    expect(finishDate(start, TODAY)).toEqual({ date: "2026-10-29", basis: "goal" });
    const metToday = logRead(start, TODAY, 600);
    expect(finishDate(metToday, TODAY)).toEqual({ date: "2026-10-29", basis: "goal" });
  });

  it("never moves the date back and forth as today's pages are read", () => {
    const start = setDailyGoal(setPosition(emptyQuranLog(), 593), 4);
    const dates = [593, 594, 595, 596, 597].map((page) => finishDate(page === 593 ? start : logRead(start, TODAY, page), TODAY)?.date);
    expect(new Set(dates).size).toBe(1);
  });

  it("uses the last two weeks' pace with no goal, and says nothing with neither", () => {
    expect(finishDate(setPosition(emptyQuranLog(), 100), TODAY)).toBeNull();
    const paced = logRead(setPosition(emptyQuranLog(), 576), "2026-10-27", 590);
    // 14 pages in two weeks is one a day: 14 pages left from page 590.
    expect(finishDate(paced, TODAY)).toEqual({ date: "2026-11-10", basis: "pace" });
  });
});

describe("the page map", () => {
  it("has 604 pages, 30 juz and 114 surahs", () => {
    expect(PAGES).toBe(604);
    expect(PAGE_START).toHaveLength(604);
    expect(JUZ_START_PAGE).toHaveLength(30);
    expect(SURA_NAMES).toHaveLength(114);
  });

  it("names a page by its surah and juz", () => {
    expect(pageLabel(1)).toBe("Al-Faatiha · juz 1");
    expect(pageLabel(22)).toBe("Al-Baqara · juz 2");
    expect(pageLabel(604)).toBe("Al-Ikhlaas · juz 30");
    expect(juzOfPage(581)).toBe(29);
    expect(juzOfPage(582)).toBe(30);
  });
});

describe("reading", () => {
  it("moves your place forward and counts the pages", () => {
    const log = logRead(logRead(emptyQuranLog(), "2026-10-23", 10), "2026-10-23", 16);
    expect(log.position).toBe(16);
    expect(pagesOn(log, "2026-10-23")).toBe(16);
    expect(log.entries.map((e) => (e.kind === "read" ? [e.fromPage, e.toPage] : null))).toEqual([[1, 10], [11, 16]]);
  });

  it("completes a full reading at page 604 and starts again", () => {
    const near = { ...emptyQuranLog(), position: 600 };
    const done = logRead(near, "2026-10-23", 604);
    expect(done.position).toBe(0);
    expect(done.completed).toBe(1);
    expect(pagesOn(done, "2026-10-23")).toBe(4);
  });

  it("ignores a page behind your place or outside the mushaf", () => {
    const log = { ...emptyQuranLog(), position: 50 };
    expect(logRead(log, "2026-10-23", 40)).toBe(log);
    expect(logRead(log, "2026-10-23", 605)).toBe(log);
    expect(logRead(log, "2026-10-23", 50.5)).toBe(log);
  });

  it("counts the days in a row with reading, ending today or yesterday", () => {
    let log = emptyQuranLog();
    for (const [d, p] of [["2026-10-20", 5], ["2026-10-21", 9], ["2026-10-22", 12]] as const) log = logRead(log, d, p);
    expect(readingStreak(log, "2026-10-22")).toBe(3);
    expect(readingStreak(log, "2026-10-23")).toBe(3);
    expect(readingStreak(log, "2026-10-25")).toBe(0);
  });
});

describe("revision and study", () => {
  it("remembers the last day each juz was revised", () => {
    const log = logRevision(logRevision(emptyQuranLog(), "2026-10-20", 30), "2026-10-23", 30);
    expect(lastRevised(log)[30]).toBe("2026-10-23");
    expect(lastRevised(log)[29]).toBeUndefined();
    expect(logRevision(log, "2026-10-23", 31)).toBe(log);
  });

  it("keeps a study session with what was studied and for how long", () => {
    const log = logStudy(emptyQuranLog(), "2026-10-23", "  Tafsir of Ayat al-Kursi  ", 25);
    expect(log.entries[0]).toMatchObject({ kind: "study", text: "Tafsir of Ayat al-Kursi", minutes: 25 });
    expect(logStudy(log, "2026-10-23", "   ", 10)).toBe(log);
    expect(logStudy(emptyQuranLog(), "2026-10-23", "x".repeat(300), 5000).entries[0]).toMatchObject({ minutes: 600 });
  });

  it("deletes an entry and puts your place back when it was the last reading", () => {
    const log = logRead(logRead(emptyQuranLog(), "2026-10-23", 10), "2026-10-23", 20);
    const last = log.entries[1].id;
    const undone = deleteEntry(log, last);
    expect(undone.position).toBe(10);
    expect(undone.entries).toHaveLength(1);
  });
});

describe("setting your place", () => {
  it("moves your place without counting any pages read", () => {
    const log = setPosition(emptyQuranLog(), 312);
    expect(log.position).toBe(312);
    expect(log.entries).toEqual([]);
    expect(pagesOn(logRead(log, "2026-10-23", 315), "2026-10-23")).toBe(3);
    expect(setPosition(log, 0).position).toBe(0);
  });

  it("refuses page 604 (that is a finished reading) and anything outside the mushaf", () => {
    const log = emptyQuranLog();
    expect(setPosition(log, 604)).toBe(log);
    expect(setPosition(log, -1)).toBe(log);
    expect(setPosition(log, 10.5)).toBe(log);
  });

  it("leaves a place you set alone when an older reading is undone", () => {
    const read = logRead(emptyQuranLog(), "2026-10-23", 20);
    const moved = setPosition(read, 300);
    const undone = deleteEntry(moved, read.entries[0].id);
    expect(undone.entries).toEqual([]);
    expect(undone.position).toBe(300);
  });

  it("puts a finished reading back on undo", () => {
    const done = logRead({ ...emptyQuranLog(), position: 600 }, "2026-10-23", 604);
    const undone = deleteEntry(done, done.entries[0].id);
    expect(undone.position).toBe(600);
    expect(undone.completed).toBe(0);
  });
});

describe("reading a saved Quran log", () => {
  it("starts empty from nothing and flags damage", () => {
    expect(checkQuranLog(null)).toEqual({ log: emptyQuranLog(), damaged: false });
    expect(checkQuranLog("{bad").damaged).toBe(true);
  });

  it("keeps valid entries only", () => {
    const saved = JSON.stringify({ v: 1, position: 20, completed: 1, entries: [
      { id: "a", date: "2026-10-23", kind: "read", fromPage: 11, toPage: 20 },
      { id: "b", date: "nope", kind: "read", fromPage: 1, toPage: 2 },
      { id: "c", date: "2026-10-23", kind: "revise", juz: 99 },
      { id: "d", date: "2026-10-23", kind: "study", text: "Tafsir", minutes: 20 },
    ] });
    const { log } = checkQuranLog(saved);
    expect(log.entries.map((e) => e.id)).toEqual(["a", "d"]);
    expect(log.position).toBe(20);
  });
});
