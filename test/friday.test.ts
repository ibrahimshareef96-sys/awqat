// Friday: the window from Maghrib on Thursday to Maghrib on Friday, the checklist, and its reminders.
import { describe, expect, it } from "vitest";
import { DUBAI } from "./fixtures/places.ts";
import { addDays, dayTimes, type DayTimes } from "../src/prayer/times.ts";
import {
  checkFridayLog, emptyFridayLog, fridayWindow, isFriday, planFriday, toggleFriday, FRIDAY_ITEMS,
} from "../src/faith/friday.ts";
import { isReminderId, planAll, planReminders } from "../src/reminders/plan.ts";
import { pageOfAyah, surahPages } from "../src/quran/pages.ts";

const TZ = "Asia/Dubai";
/** Wednesday 21 Oct 2026 to Saturday 31 Oct, Dubai method. */
const days: DayTimes[] = Array.from({ length: 11 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 21 }, i), "Dubai"));
const at = (iso: string) => new Date(iso);
const thursday = days[1];
const friday = days[2];

describe("which day is Friday", () => {
  it("knows Friday from the date", () => {
    expect(isFriday("2026-10-23")).toBe(true);
    expect(isFriday("2026-10-22")).toBe(false);
    expect(isFriday("not a date")).toBe(false);
  });
});

describe("the Friday window", () => {
  it("opens at Maghrib on Thursday and closes at Maghrib on Friday", () => {
    expect(fridayWindow(days, new Date(thursday.maghrib.getTime() - 60_000))).toBeNull();
    const evening = fridayWindow(days, new Date(thursday.maghrib.getTime() + 60_000));
    expect(evening).toMatchObject({ friday: "2026-10-23" });
    expect(evening?.start).toEqual(thursday.maghrib);
    expect(evening?.end).toEqual(friday.maghrib);
    expect(fridayWindow(days, at("2026-10-23T06:00:00Z"))?.friday).toBe("2026-10-23");
    expect(fridayWindow(days, new Date(friday.maghrib.getTime() + 60_000))).toBeNull();
  });

  it("finds no window when Thursday is not among the days", () => {
    expect(fridayWindow(days.slice(2), at("2026-10-23T06:00:00Z"))).toBeNull();
  });
});

describe("the Friday checklist", () => {
  it("ticks and unticks an item for that Friday only", () => {
    let log = toggleFriday(emptyFridayLog(), "2026-10-23", "kahf");
    expect(log.days["2026-10-23"]).toEqual({ kahf: true });
    log = toggleFriday(log, "2026-10-23", "dua");
    log = toggleFriday(log, "2026-10-23", "kahf");
    expect(log.days["2026-10-23"]).toEqual({ dua: true });
    expect(toggleFriday(log, "2026-10-22", "kahf")).toBe(log);
    expect(toggleFriday(log, "2026-10-23", "nope" as never)).toBe(log);
  });

  it("reads a saved log back field by field", () => {
    const log = toggleFriday(emptyFridayLog(), "2026-10-23", "salawat");
    expect(checkFridayLog(JSON.stringify(log))).toEqual({ log, damaged: false });
    expect(checkFridayLog(null)).toEqual({ log: emptyFridayLog(), damaged: false });
    expect(checkFridayLog("{oops").damaged).toBe(true);
    const odd = { v: 1, days: { "2026-10-23": { kahf: true, bogus: true, dua: "yes" }, "2026-10-22": { kahf: true }, x: {} } };
    expect(checkFridayLog(JSON.stringify(odd)).log.days).toEqual({ "2026-10-23": { kahf: true } });
  });

  it("has the five items in order", () => {
    expect(FRIDAY_ITEMS).toEqual(["kahf", "ghusl", "early", "salawat", "dua"]);
  });
});

describe("Friday reminders", () => {
  const before = at("2026-10-22T20:00:00Z");

  it("reminds in the morning and an hour before Maghrib, and mentions Al-Kahf until it is read", () => {
    const plan = planFriday(days, before, { enabled: true, done: emptyFridayLog() }, TZ);
    const ids = plan.map((r) => r.id);
    expect(ids).toEqual([202610237, 202610238, 202610307, 202610308]);
    const [morning, lastHour] = plan;
    expect(morning.at.getTime()).toBe(friday.sunrise.getTime() + 2 * 3600_000);
    expect(lastHour.at.getTime()).toBe(friday.maghrib.getTime() - 3600_000);
    expect(morning.body).toMatch(/Al-Kahf/);
    expect(lastHour.body).toMatch(/Al-Kahf/);
    const read = toggleFriday(emptyFridayLog(), "2026-10-23", "kahf");
    const after = planFriday(days, before, { enabled: true, done: read }, TZ);
    expect(after[0].body).not.toMatch(/Al-Kahf/);
    expect(after[1].body).not.toMatch(/Al-Kahf/);
    expect(after[2].body).toMatch(/Al-Kahf/);
  });

  it("skips reminders already past, and all of them when switched off", () => {
    const midday = at("2026-10-23T09:00:00Z");
    expect(planFriday(days, midday, { enabled: true, done: emptyFridayLog() }, TZ).map((r) => r.id)[0]).toBe(202610238);
    expect(planFriday(days, before, { enabled: false, done: emptyFridayLog() }, TZ)).toEqual([]);
  });

  it("counts as the app's own reminders, so stale ones are cancelled", () => {
    expect(isReminderId(202610237)).toBe(true);
    expect(isReminderId(202610238)).toBe(true);
    expect(isReminderId(202610239)).toBe(false);
  });

  it("shares the 60-reminder limit with the prayers, nearest first", () => {
    const all: Record<"fajr" | "dhuhr" | "asr" | "maghrib" | "isha", boolean> = { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };
    const many = Array.from({ length: 14 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 22 }, i), "Dubai"));
    const plan = planAll(planReminders(many, before, all, TZ), planFriday(many, before, { enabled: true, done: emptyFridayLog() }, TZ));
    expect(plan).toHaveLength(60);
    expect(plan.some((r) => r.id === 202610237)).toBe(true);
    const times = plan.map((r) => r.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("pages in the Madinah mushaf", () => {
  it("finds the page of an ayah and the pages of a surah", () => {
    expect(pageOfAyah(1, 1)).toBe(1);
    expect(pageOfAyah(2, 1)).toBe(2);
    expect(pageOfAyah(114, 6)).toBe(604);
    expect(surahPages(18)).toEqual({ first: 293, last: 304 });
    expect(surahPages(1)).toEqual({ first: 1, last: 1 });
    expect(surahPages(115)).toBeNull();
  });
});
