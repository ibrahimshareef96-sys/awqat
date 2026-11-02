// Revision marks in the mushaf: mistakes on words, notes on ayahs and pages, and where reading stopped.
import { describe, expect, it } from "vitest";
import {
  NOTE_MAX, checkMarks, clearMistakes, emptyMarks, isAyahKey, isWordKey, markMistake, mistakesOnPage, notesList,
  moveBookmark, setAyahNote, setLastPage, setPageNote, setTheme,
} from "../src/quran/marks.ts";

const TODAY = "2026-10-23";

describe("keys", () => {
  it("accepts real word and ayah keys only", () => {
    expect(isWordKey("18:10:3")).toBe(true);
    expect(isWordKey("115:1:1")).toBe(false);
    expect(isWordKey("18:111:1")).toBe(false);
    expect(isWordKey("18:10")).toBe(false);
    expect(isAyahKey("18:110")).toBe(true);
    expect(isAyahKey("18:0")).toBe(false);
    expect(isAyahKey("__proto__")).toBe(false);
  });
});

describe("mistakes", () => {
  it("counts mistakes on a word, with the last day, and clears them", () => {
    let marks = markMistake(emptyMarks(), "18:10:3", TODAY);
    marks = markMistake(marks, "18:10:3", "2026-10-24");
    expect(marks.mistakes["18:10:3"]).toEqual({ count: 2, last: "2026-10-24" });
    expect(markMistake(marks, "bad", TODAY)).toBe(marks);
    marks = clearMistakes(marks, "18:10:3");
    expect(marks.mistakes["18:10:3"]).toBeUndefined();
  });

  it("totals the mistakes on a page from its word keys", () => {
    let marks = markMistake(emptyMarks(), "18:10:3", TODAY);
    marks = markMistake(markMistake(marks, "18:11:1", TODAY), "18:11:1", TODAY);
    expect(mistakesOnPage(marks, ["18:10:3", "18:11:1", "18:11:2"])).toBe(3);
  });
});

describe("notes", () => {
  it("keeps a note on an ayah and on a page, trimmed and capped, and removes an empty one", () => {
    let marks = setAyahNote(emptyMarks(), "18:10", "  Mutashabih with 18:16  ", TODAY);
    expect(marks.notes["18:10"]).toEqual({ text: "Mutashabih with 18:16", updated: TODAY });
    marks = setPageNote(marks, 293, "x".repeat(5000), TODAY);
    expect(marks.pageNotes["293"].text).toHaveLength(NOTE_MAX);
    marks = setAyahNote(marks, "18:10", "   ", TODAY);
    expect(marks.notes["18:10"]).toBeUndefined();
    expect(setPageNote(marks, 605, "x", TODAY)).toBe(marks);
  });

  it("lists every note and mistake, page by page", () => {
    let marks = setAyahNote(emptyMarks(), "18:10", "Ayah note", TODAY);
    marks = setPageNote(marks, 1, "Page note", TODAY);
    marks = markMistake(marks, "2:255:4", TODAY);
    const list = notesList(marks);
    expect(list.map((n) => [n.page, n.kind])).toEqual([[1, "page"], [42, "mistake"], [294, "ayah"]]);
  });
});

describe("the reader's place and look", () => {
  it("remembers where the user stopped reading, with when, and the page colour", () => {
    const at = Date.UTC(2026, 9, 28, 18, 0);
    expect(setLastPage(emptyMarks(), 293, at)).toMatchObject({ lastPage: 293, lastPageAt: at });
    expect(setLastPage(emptyMarks(), 0, at).lastPage).toBe(1);
    expect(setTheme(emptyMarks(), "night").theme).toBe("night");
  });

  it("leaves the bookmark as it is for a time out of range (before 2026, or a day ahead)", () => {
    const marks = emptyMarks();
    expect(setLastPage(marks, 293, Date.UTC(2020, 0, 1))).toBe(marks);
    expect(setLastPage(marks, 293, Date.now() + 2 * 86_400_000)).toBe(marks);
    expect(setLastPage(marks, 293, Number.NaN)).toBe(marks);
  });

  it("reads a bookmark time back only when it is valid", () => {
    const at = Date.UTC(2026, 9, 28, 18, 0);
    expect(checkMarks(JSON.stringify({ ...emptyMarks(), lastPage: 411, lastPageAt: at })).marks)
      .toMatchObject({ lastPage: 411, lastPageAt: at });
    expect(checkMarks(JSON.stringify({ ...emptyMarks(), lastPage: 411, lastPageAt: "soon" })).marks.lastPageAt).toBe(0);
    // Marks saved by 0.12 have no time: the bookmark was never set.
    const { lastPageAt: _gone, ...old } = { ...emptyMarks(), lastPage: 3 };
    expect(checkMarks(JSON.stringify(old)).marks).toMatchObject({ lastPage: 3, lastPageAt: 0 });
    // A time saved here stays even if this clock has since been set back by more than a day.
    const later = Date.now() + 5 * 86_400_000;
    expect(checkMarks(JSON.stringify({ ...emptyMarks(), lastPage: 411, lastPageAt: later })).marks.lastPageAt).toBe(later);
  });

  it("moves the bookmark always later than its last move", () => {
    const at = Date.UTC(2026, 9, 28, 18);
    const marks = { ...emptyMarks(), lastPage: 411, lastPageAt: at };
    expect(moveBookmark(marks, 412, at - 60_000)).toMatchObject({ lastPage: 412, lastPageAt: at + 1 });
    expect(moveBookmark(marks, 412, at + 5)).toMatchObject({ lastPage: 412, lastPageAt: at + 5 });
    // A last move stamped by a clock five days fast, since corrected: the bookmark still moves, stamped now.
    const fast = { ...marks, lastPageAt: at + 5 * 86_400_000 };
    expect(moveBookmark(fast, 413, at)).toMatchObject({ lastPage: 413, lastPageAt: at });
  });
});

describe("reading saved marks back", () => {
  it("keeps only valid entries", () => {
    const marks = setAyahNote(markMistake(emptyMarks(), "18:10:3", TODAY), "18:10", "Note", TODAY);
    expect(checkMarks(JSON.stringify(marks))).toEqual({ marks, damaged: false });
    const odd = { v: 1, mistakes: { "18:10:3": { count: 2, last: TODAY }, nope: { count: 1 }, "1:1:1": { count: -4 } },
      notes: { "18:10": { text: "ok", updated: TODAY }, "__proto__": { text: "x" } }, pageNotes: { 9999: { text: "x" } },
      lastPage: 700, theme: "neon" };
    const back = checkMarks(JSON.stringify(odd)).marks;
    expect(Object.keys(back.mistakes)).toEqual(["18:10:3"]);
    expect(Object.keys(back.notes)).toEqual(["18:10"]);
    expect(back.pageNotes).toEqual({});
    expect(back.lastPage).toBe(1);
    expect(back.theme).toBe("paper");
    expect(checkMarks("nope").damaged).toBe(true);
  });
});
