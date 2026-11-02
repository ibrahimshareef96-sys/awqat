// The mushaf's bookmark (where the user stopped reading) and the user's reading log: logging never leaves the bookmark behind the
// page after the user's place, and reading ahead in the mushaf is never pulled back by logging fewer pages.
import { describe, expect, it } from "vitest";
import { bookmarkAfterLog, bookmarkPage, pageAfter } from "../src/quran/bookmark.ts";
import { deleteEntry, emptyQuranLog, logRead, setPosition } from "../src/quran/log.ts";
import { emptyMarks } from "../src/quran/marks.ts";

const DAY = "2026-10-28";

describe("the page after a place in the log", () => {
  it("is page 1 before the user starts, and never past the last page", () => {
    expect([pageAfter(0), pageAfter(3), pageAfter(603), pageAfter(604), pageAfter(-2)]).toEqual([1, 4, 604, 604, 1]);
  });
});

describe("where the mushaf opens to read on", () => {
  it("is the bookmark once it has been set", () => {
    const marks = { ...emptyMarks(), lastPage: 411, lastPageAt: Date.UTC(2026, 9, 28, 18) };
    expect(bookmarkPage(marks, setPosition(emptyQuranLog(), 3))).toBe(411);
  });

  it("is the page after the user's logged place before then (0.12 kept a last page that revision links moved)", () => {
    const upgraded = { ...emptyMarks(), lastPage: 82, lastPageAt: 0 };
    expect(bookmarkPage(upgraded, setPosition(emptyQuranLog(), 300))).toBe(301);
    expect(bookmarkPage(emptyMarks(), emptyQuranLog())).toBe(1);
  });
});

describe("the bookmark after a change to the log", () => {
  it("is kept when the user read on in the mushaf past what the user logs (+2 from page 3, bookmark on Luqman)", () => {
    const before = setPosition(emptyQuranLog(), 3);
    expect(bookmarkAfterLog(411, before, logRead(before, DAY, 5), "read")).toBeNull();
  });

  it("moves on to the page after the user's place when the user logs past it", () => {
    const before = setPosition(emptyQuranLog(), 3);
    expect(bookmarkAfterLog(4, before, logRead(before, DAY, 12), "read")).toBe(13);
    // Read to the page open in the mushaf: the next page is where the user goes on.
    expect(bookmarkAfterLog(411, setPosition(emptyQuranLog(), 400), logRead(setPosition(emptyQuranLog(), 400), DAY, 411),
      "read")).toBe(412);
  });

  it("goes back to page 1 when a full reading is completed", () => {
    const before = setPosition(emptyQuranLog(), 600);
    const after = logRead(before, DAY, 604);
    expect(after.completed).toBe(1);
    expect(bookmarkAfterLog(604, before, after, "read")).toBe(1);
  });

  it("follows the user's place when the user sets it, either way", () => {
    const before = setPosition(emptyQuranLog(), 3);
    expect(bookmarkAfterLog(4, before, setPosition(before, 410), "place")).toBe(411);
    expect(bookmarkAfterLog(500, setPosition(emptyQuranLog(), 499), setPosition(emptyQuranLog(), 100), "place")).toBe(101);
    expect(bookmarkAfterLog(1, emptyQuranLog(), setPosition(emptyQuranLog(), 0), "place")).toBeNull();
  });

  it("goes back with an undone reading only when it was following the user's place", () => {
    const start = setPosition(emptyQuranLog(), 410);
    const read = logRead(start, DAY, 420);
    const undone = deleteEntry(read, read.entries[read.entries.length - 1].id);
    expect(undone.position).toBe(410);
    expect(bookmarkAfterLog(421, read, undone, "undo")).toBe(411);
    // The user had read on in the mushaf past it: that stays.
    expect(bookmarkAfterLog(450, read, undone, "undo")).toBeNull();
  });
});
