// The muraja'ah card and its plan sheet as drawn: an invitation before there is a plan, today's juz with the weak
// pages first, and a sheet whose hidden choices still have names a screen reader can read.
import { describe, expect, it } from "vitest";
import { emptyQuranLog, logRevision } from "../src/quran/log.ts";
import { emptyMarks, markMistake } from "../src/quran/marks.ts";
import { makePlan } from "../src/quran/murajaah.ts";
import { murajaahCard, murajaahSheet } from "../src/ui/murajaahView.ts";

const TODAY = "2026-10-24";

describe("the muraja'ah card", () => {
  it("invites setting up a plan when there is none", () => {
    const html = murajaahCard({ plan: null, quran: emptyQuranLog(), marks: emptyMarks(), date: TODAY });
    expect(html).toContain(`data-action="murajaah-setup"`);
    expect(html).toContain("Set up your plan");
  });

  it("shows today's juz with its pages, weak pages first, and opens at the weakest", () => {
    let marks = emptyMarks();
    for (let i = 0; i < 3; i += 1) marks = markMistake(marks, "17:105:2", TODAY);
    const html = murajaahCard({ plan: makePlan([15, 16], 1), quran: emptyQuranLog(), marks, date: TODAY });
    expect(html).toContain("Juz 15");
    expect(html).toContain("p. 282 to 301");
    expect(html).toContain(`aria-label="Page 293, 3 mistakes"`);
    expect(html).toMatch(/class="ghost-link" data-go="mushaf:293">Open/);
    expect(html).toContain("1 juz a day · 2 juz · Change");
    expect(html).not.toContain("Juz 16");
  });

  it("says today is done, and offers the next juz to keep going", () => {
    const quran = logRevision(emptyQuranLog(), TODAY, 15);
    const html = murajaahCard({ plan: makePlan([15, 16], 1), quran, marks: emptyMarks(), date: TODAY });
    expect(html).toContain(`aria-pressed="true"`);
    expect(html).toContain("Today's revision is done.");
    expect(html).toContain(`data-go="mushaf:302">Juz 16</button>`);
    expect(html).toContain("1 of 2 juz in the last 2 days");
  });
});

describe("the plan sheet", () => {
  it("ticks every juz for a first plan, and the chosen ones after", () => {
    expect(murajaahSheet(null).match(/name="juz" value="\d+" aria-label="Juz \d+" checked/g)).toHaveLength(30);
    const html = murajaahSheet(makePlan([29, 30], 2));
    expect(html.match(/ checked/g)).toHaveLength(3);
    expect(html).toContain(`value="2" aria-label="2 juz a day" checked`);
  });

  it("starts focus at the top, on All, not down at Save", () => {
    const html = murajaahSheet(null);
    expect(html).toMatch(/aria-label="All, choose all 30 juz" data-autofocus>All/);
    expect(html).not.toMatch(/type="submit"[^>]*data-autofocus/);
  });
});
