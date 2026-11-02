// The muraja'ah plan: the juz the user has memorised, so many a day, the one revised longest ago first, and the pages where
// the user slips most shown before the rest.
import { describe, expect, it } from "vitest";
import { emptyMarks, markMistake } from "../src/quran/marks.ts";
import { checkPlan, juzPages, makePlan, revisionLine, todaysRevision, weakPages } from "../src/quran/murajaah.ts";

const TODAY = "2026-10-24";
const all = Array.from({ length: 30 }, (_, i) => i + 1);

describe("making a plan", () => {
  it("keeps the chosen juz in order, once each, and a juz-a-day choice from the list", () => {
    expect(makePlan([3, 1, 3, 2], 2)).toEqual({ v: 1, perDay: 2, juz: [1, 2, 3] });
    expect(makePlan([], 1)).toBeNull();
    expect(makePlan([0, 31, 2.5], 1)).toBeNull();
    expect(makePlan([1], 4)).toBeNull();
  });

  it("reads a saved plan back, and says when it was damaged", () => {
    expect(checkPlan(JSON.stringify({ v: 1, perDay: 1, juz: [30, 29] }))).toEqual({
      plan: { v: 1, perDay: 1, juz: [29, 30] }, damaged: false });
    expect(checkPlan(null)).toEqual({ plan: null, damaged: false });
    expect(checkPlan("{broken")).toEqual({ plan: null, damaged: true });
    expect(checkPlan(JSON.stringify({ v: 1, perDay: 9, juz: [1] }))).toEqual({ plan: null, damaged: true });
    expect(checkPlan(JSON.stringify({ v: 1, perDay: 1, juz: [] }))).toEqual({ plan: null, damaged: true });
  });
});

describe("today's revision", () => {
  it("starts at the first juz of the plan, as many as the user chose a day", () => {
    const plan = makePlan(all, 2);
    expect(plan && todaysRevision(plan, {}, TODAY)).toMatchObject({ todo: [1, 2], doneToday: [], done: false });
  });

  it("gives the juz revised longest ago, and one never revised before any", () => {
    const plan = makePlan([1, 2, 3, 4], 1);
    const revised = { 1: "2026-10-20", 2: "2026-10-10", 4: "2026-10-23" };
    expect(plan && todaysRevision(plan, revised, TODAY).todo).toEqual([3]);
    expect(plan && todaysRevision(plan, { ...revised, 3: "2026-10-22" }, TODAY).todo).toEqual([2]);
  });

  it("counts what was revised today toward today, and offers the next one after that", () => {
    const plan = makePlan([4, 5, 6], 1);
    const result = plan && todaysRevision(plan, { 5: TODAY, 4: "2026-10-01" }, TODAY);
    expect(result).toMatchObject({ todo: [], doneToday: [5], done: true, next: 6 });
    const two = makePlan([4, 5, 6], 2);
    expect(two && todaysRevision(two, { 5: TODAY, 4: "2026-10-01" }, TODAY)).toMatchObject({ todo: [6], doneToday: [5] });
  });

  it("is done once every juz is revised when the plan holds fewer juz than a day's share", () => {
    const plan = makePlan([1, 2], 3);
    expect(plan && todaysRevision(plan, {}, TODAY)).toMatchObject({ todo: [1, 2], done: false, cycle: 1 });
    expect(plan && todaysRevision(plan, { 1: TODAY, 2: TODAY }, TODAY)).toMatchObject({ todo: [], done: true, next: null });
    expect(plan && revisionLine(plan, { 1: TODAY, 2: TODAY }, TODAY)).toBe("Revision done today");
  });

  it("ignores juz outside the plan", () => {
    const plan = makePlan([29, 30], 1);
    expect(plan && todaysRevision(plan, { 1: TODAY, 29: "2026-10-01" }, TODAY)).toMatchObject({ todo: [30], doneToday: [] });
  });

  it("counts a juz as fresh when it was revised within one turn of the plan", () => {
    const plan = makePlan([1, 2, 3], 1);
    const revised = { 1: TODAY, 2: "2026-10-22", 3: "2026-10-21" };
    expect(plan && todaysRevision(plan, revised, TODAY)).toMatchObject({ fresh: 2, cycle: 3 });
  });

  it("works out tomorrow from today's ticks: what was done today goes to the back", () => {
    const plan = makePlan([1, 2, 3], 1);
    expect(plan && todaysRevision(plan, { 1: TODAY }, "2026-10-25").todo).toEqual([2]);
  });
});

describe("the revision line on Home and the widget", () => {
  it("says what is left today, or that it is done", () => {
    const plan = makePlan([1, 2, 3], 2);
    expect(plan && revisionLine(plan, {}, TODAY)).toBe("Revise Juz 1, 2");
    expect(plan && revisionLine(plan, { 1: TODAY }, TODAY)).toBe("Revise Juz 2");
    expect(plan && revisionLine(plan, { 1: TODAY, 2: TODAY }, TODAY)).toBe("Revision done today");
  });
});

describe("weak pages", () => {
  it("lists the juz's pages with mistakes, most first, and nothing from other juz", () => {
    let marks = emptyMarks();
    marks = markMistake(marks, "18:5:1", TODAY);
    for (let i = 0; i < 3; i += 1) marks = markMistake(marks, "17:105:2", TODAY);
    marks = markMistake(marks, "1:1:1", TODAY);
    expect(weakPages(marks, 15)).toEqual([{ page: 293, mistakes: 3 }, { page: 294, mistakes: 1 }]);
    expect(weakPages(marks, 15, 1)).toEqual([{ page: 293, mistakes: 3 }]);
    expect(weakPages(marks, 12)).toEqual([]);
  });

  it("knows each juz's pages in the 1405 print", () => {
    expect(juzPages(1)).toEqual({ first: 1, last: 21 });
    expect(juzPages(12)).toEqual({ first: 222, last: 241 });
    expect(juzPages(30)).toEqual({ first: 582, last: 604 });
  });
});
