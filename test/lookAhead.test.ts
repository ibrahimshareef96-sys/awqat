// The Weekly Review's look ahead: the next seven days in a few lines, and only for what the user has set up.
import { describe, expect, it } from "vitest";
import { emptyAgenda, withRead } from "../src/agenda/agenda.ts";
import type { Occurrence } from "../src/agenda/occurrence.ts";
import { emptyBody } from "../src/body/body.ts";
import { setPlan } from "../src/body/training.ts";
import { makePlan } from "../src/quran/murajaah.ts";
import { lookAhead, type AheadInput } from "../src/review/ahead.ts";

const TZ = "Asia/Dubai";
/** Tuesday 3 November 2026, 10:00 in Dubai. */
const TODAY = "2026-11-03";
const at = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h - 4, m);
const NOW = at(3, 10);
const meeting = (title: string, start: number, end: number, allDay = false): Occurrence =>
  ({ start, end, allDay, title, location: "" });

function input(patch: Partial<AheadInput> = {}): AheadInput {
  return { today: TODAY, tz: TZ, now: NOW, calendars: 0, agenda: emptyAgenda(TODAY), murajaah: null, body: emptyBody(),
    due: null, ...patch };
}

describe("the look ahead", () => {
  it("has only Friday for someone who has set nothing up", () => {
    expect(lookAhead(input())).toEqual(["Friday 6 November: Jumu'ah, and Surah Al-Kahf"]);
  });

  it("says when Friday is today", () => {
    expect(lookAhead(input({ today: "2026-11-06", now: at(6, 8) }))).toEqual(["Friday is today: Jumu'ah, and Surah Al-Kahf"]);
  });

  it("counts meetings still to come on each day, today first, and leaves out all-day events and days past the week", () => {
    const agenda = withRead(emptyAgenda(), "c1", { events: [
      meeting("Done already", at(3, 8), at(3, 9)),
      meeting("Later today", at(3, 15), at(3, 16)),
      meeting("Thursday one", at(5, 9), at(5, 10)),
      meeting("Thursday two", at(5, 11), at(5, 12)),
      meeting("Holiday", at(4, 0), at(5, 0), true),
      meeting("Next Tuesday", at(10, 9), at(10, 10)),
    ], truncated: false }, TODAY, TZ, NOW);
    const lines = lookAhead(input({ calendars: 1, agenda }));
    expect(lines[0]).toBe("Meetings: Today 1, Thu 2");
  });

  it("says so when the calendars have nothing, or have not been read yet", () => {
    const read = withRead(emptyAgenda(), "c1", { events: [], truncated: false }, TODAY, TZ, NOW);
    expect(lookAhead(input({ calendars: 1, agenda: read }))[0]).toBe("Meetings: none on your calendars");
    expect(lookAhead(input({ calendars: 1 }))[0]).toBe("Meetings: your calendars have not been read yet");
    // A first read that failed is not an empty week.
    const failed = withRead(emptyAgenda(), "c1", { problem: "offline" }, TODAY, TZ, NOW);
    expect(lookAhead(input({ calendars: 1, agenda: failed }))[0]).toBe("Meetings: your calendars have not been read yet");
  });

  it("gives the revision plan when there is one", () => {
    const murajaah = makePlan([1, 2, 3, 4, 5], 2);
    expect(lookAhead(input({ murajaah }))).toContain("Quran revision: 2 juz a day, your 5 juz round every 3 days");
    expect(lookAhead(input({ murajaah: makePlan([30], 1) }))).toContain("Quran revision: 1 juz a day, your 1 juz round every day");
  });

  it("gives the training planned on the days ahead, from today, and the weekly target", () => {
    const body = { ...setPlan(emptyBody(), { 1: "Push", 3: "Pull", 5: "Legs" }), weeklyTarget: 3 };
    // Weekdays as Date numbers them (0 is Sunday): from Tuesday, Wednesday's pull comes first and Monday's push last.
    expect(lookAhead(input({ body }))).toContain("Training: Wed Pull, Fri Legs, Mon Push; 3 days a week");
    expect(lookAhead(input({ body: { ...emptyBody(), weeklyTarget: 2 } }))).toContain("Training: 2 days a week");
  });

  it("lists work due in the next seven days, soonest first, when the Work feed was read", () => {
    const due = [
      { text: "Later", date: "2026-11-09", time: "", late: false },
      { text: "Too far", date: "2026-11-10", time: "", late: false },
      { text: "Overdue", date: "2026-11-01", time: "", late: true },
      { text: "No date", date: "", time: "", late: false },
      { text: "Send the draft", date: "2026-11-04", time: "14:00", late: false },
      { text: "Morning one", date: "2026-11-04", time: "09:00", late: false },
    ];
    expect(lookAhead(input({ due }))).toContain("Work due: Wed Morning one; Wed Send the draft; Mon Later");
    const many = Array.from({ length: 5 }, (_, i) => ({ text: `Item ${i}`, date: "2026-11-05", time: "", late: false }));
    expect(lookAhead(input({ due: many }))).toContain("Work due: Thu Item 0; Thu Item 1; Thu Item 2; and 2 more");
    expect(lookAhead(input({ due: [] }))).toContain("Work: nothing due in the next 7 days");
    expect(lookAhead(input({ due: null })).some((l) => l.startsWith("Work"))).toBe(false);
  });

  it("puts the lines in one order: meetings, Friday, revision, training, work", () => {
    const lines = lookAhead(input({ calendars: 1, murajaah: makePlan([1], 1), body: { ...emptyBody(), weeklyTarget: 1 }, due: [] }));
    expect(lines.map((l) => l.split(/[: ]/)[0])).toEqual(["Meetings", "Friday", "Quran", "Training", "Work"]);
  });
});
