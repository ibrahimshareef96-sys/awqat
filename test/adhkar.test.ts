// The morning and evening adhkar: the lists, the counts kept per day, when each is open, and their reminders.
import { describe, expect, it } from "vitest";
import {
  ADHKAR_KEEP_DAYS, SESSION_NAME, addOne, adhkarFor, adhkarStreak, adhkarWeek, adhkarWindow, checkAdhkarLog, countOf,
  emptyAdhkarLog,
  islamicMidnight, isComplete, planAdhkar, progress, setDone, type AdhkarLog,
} from "../src/faith/adhkar.ts";
import { ADHKAR } from "../src/faith/adhkarData.ts";
import { pageOfAyah } from "../src/quran/pages.ts";
import { ADHKAR_SLOT, isReminderId, planAll, planReminders } from "../src/reminders/plan.ts";
import type { DayTimes } from "../src/prayer/times.ts";

const TZ = "Asia/Dubai";
const at = (time: string, date = "2026-10-27"): Date => new Date(`${date}T${time}:00+04:00`);

function day(date: string): DayTimes {
  return { date, fajr: at("05:06", date), sunrise: at("06:20", date), dhuhr: at("12:06", date), asr: at("15:20", date),
    maghrib: at("17:46", date), isha: at("19:00", date), method: "Dubai", adjusted: "none" };
}

const days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"].map(day);
const ALL_ON = { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };

/** Every item of a session counted in full on a date. */
function finished(date: string, session: "morning" | "evening"): AdhkarLog {
  return adhkarFor(session).reduce((log, item) => setDone(log, date, session, item.id, true), emptyAdhkarLog());
}

describe("the lists", () => {
  it("has Hisn al-Muslim's morning and evening sets", () => {
    expect(adhkarFor("morning")).toHaveLength(25);
    expect(adhkarFor("evening")).toHaveLength(23);
    expect(SESSION_NAME).toEqual({ morning: "Adhkar al-Sabah", evening: "Adhkar al-Masa" });
    expect(adhkarFor("morning").every((i) => i.sessions.includes("morning"))).toBe(true);
    expect(adhkarFor("evening").map((i) => i.id)).not.toContain(7);
    expect(adhkarFor("morning").map((i) => i.id)).not.toContain(8);
  });

  it("carries nothing of the Quran: those items name where they are read in the mushaf", () => {
    const quran = ADHKAR.filter((i) => i.quran);
    expect(quran.map((i) => [i.id, i.quran])).toEqual([
      [2, { sura: 2, from: 255, to: 255 }], [3, { sura: 2, from: 285, to: 286 }], [4, { sura: 112, from: 1, to: 4 }],
      [5, { sura: 113, from: 1, to: 5 }], [6, { sura: 114, from: 1, to: 6 }],
      // "Hasbiya Allah ... al-'arsh al-'azim" is At-Tawbah 129's closing words, said as they stand.
      [17, { sura: 9, from: 129, to: 129, words: "its closing words" }],
    ]);
    // Only the isti'adha said before Ayat al-Kursi and the end of Al-Baqarah; nothing for the others.
    expect(new Set(quran.filter((i) => i.text).map((i) => i.text)).size).toBe(1);
    expect(quran.filter((i) => !i.text).map((i) => i.id)).toEqual([4, 5, 6, 17]);
    expect(ADHKAR.some((i) => /[﴿﴾]/.test(i.text + i.source))).toBe(false);
    // The words of At-Tawbah 129's close appear nowhere ("hasbiya" written with its vowels as the dataset had it).
    expect(ADHKAR.some((i) => i.text.includes("حَسْبِيَ"))).toBe(false);
    expect(pageOfAyah(2, 255)).toBe(42);
    expect(pageOfAyah(2, 285)).toBe(49);
    expect(pageOfAyah(9, 129)).toBe(207);
    expect(pageOfAyah(112, 1)).toBe(604);
  });

  it("keeps the end of Al-Baqarah for the night, and every count is a real one", () => {
    expect(ADHKAR.filter((i) => i.night).map((i) => i.id)).toEqual([3]);
    expect(ADHKAR.every((i) => Number.isInteger(i.count) && i.count >= 1 && i.count <= 100)).toBe(true);
    expect(ADHKAR.find((i) => i.id === 17)?.count).toBe(7);
    expect(ADHKAR.find((i) => i.id === 34)?.count).toBe(100);
  });

  it("keeps the words as Arabic only, with no invisible characters or stray marks", () => {
    // Arabic letters and marks, the ﷺ ligature, spaces, digits and the punctuation the sources use.
    const allowed = /^[؀-ۿﷺ\s0-9()[\]/.:,!-]*$/u;
    for (const item of ADHKAR) {
      expect(item.text, `item ${item.id}`).toMatch(allowed);
      expect(item.times, `item ${item.id}`).toMatch(allowed);
      expect(item.source, `item ${item.id}`).toMatch(allowed);
      expect(item.name, `item ${item.id}`).toMatch(/^[A-Za-z' ,-]+( ﷺ)?$/);
    }
  });
});

describe("counting", () => {
  it("adds one at a time up to the item's count, and never changes the log it was given", () => {
    const start = emptyAdhkarLog();
    let log = addOne(start, "2026-10-27", "morning", 17);
    expect(start).toEqual(emptyAdhkarLog());
    expect(countOf(log, "2026-10-27", "morning", 17)).toBe(1);
    for (let i = 0; i < 10; i += 1) log = addOne(log, "2026-10-27", "morning", 17);
    expect(countOf(log, "2026-10-27", "morning", 17)).toBe(7);
    expect(countOf(log, "2026-10-27", "evening", 17)).toBe(0);
  });

  it("ignores an item that is not in that session, or does not exist", () => {
    const log = emptyAdhkarLog();
    expect(addOne(log, "2026-10-27", "evening", 7)).toBe(log);
    expect(addOne(log, "2026-10-27", "morning", 999)).toBe(log);
    expect(addOne(log, "not a date", "morning", 17)).toBe(log);
    expect(setDone(log, "2026-10-27", "evening", 7, true)).toBe(log);
  });

  it("marks an item done at once, or clears it", () => {
    let log = setDone(emptyAdhkarLog(), "2026-10-27", "morning", 34, true);
    expect(countOf(log, "2026-10-27", "morning", 34)).toBe(100);
    log = setDone(log, "2026-10-27", "morning", 34, false);
    expect(countOf(log, "2026-10-27", "morning", 34)).toBe(0);
    expect(log.days["2026-10-27"]).toBeUndefined();
  });

  it("counts the items done, and knows when a session is complete", () => {
    let log = setDone(emptyAdhkarLog(), "2026-10-27", "morning", 7, true);
    log = addOne(log, "2026-10-27", "morning", 17);
    expect(progress(log, "2026-10-27", "morning")).toEqual({ done: 1, total: 25 });
    expect(isComplete(log, "2026-10-27", "morning")).toBe(false);
    const full = finished("2026-10-27", "morning");
    expect(progress(full, "2026-10-27", "morning")).toEqual({ done: 25, total: 25 });
    expect(isComplete(full, "2026-10-27", "morning")).toBe(true);
    expect(isComplete(full, "2026-10-27", "evening")).toBe(false);
  });

  it("can leave out the end of Al-Baqarah, which waits for Maghrib", () => {
    const allButNight = adhkarFor("evening").filter((i) => !i.night)
      .reduce((log, item) => setDone(log, "2026-10-27", "evening", item.id, true), emptyAdhkarLog());
    expect(isComplete(allButNight, "2026-10-27", "evening")).toBe(false);
    expect(isComplete(allButNight, "2026-10-27", "evening", false)).toBe(true);
  });

  it("counts each set's days in a row, holding until today's is said, and shows the last seven days", () => {
    const sayAll = (log: AdhkarLog, date: string, session: "morning" | "evening") =>
      adhkarFor(session).reduce((l, item) => setDone(l, date, session, item.id, true), log);
    let log = emptyAdhkarLog();
    for (const date of ["2026-10-25", "2026-10-26", "2026-10-27"]) log = sayAll(log, date, "morning");
    log = sayAll(log, "2026-10-27", "evening");
    expect(adhkarStreak(log, "2026-10-28", "morning")).toBe(3);
    expect(adhkarStreak(sayAll(log, "2026-10-28", "morning"), "2026-10-28", "morning")).toBe(4);
    expect(adhkarStreak(log, "2026-10-28", "evening")).toBe(1);
    expect(adhkarStreak(emptyAdhkarLog(), "2026-10-28", "evening")).toBe(0);
    const week = adhkarWeek(log, "2026-10-28");
    expect(week.map((w) => w.date)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26",
      "2026-10-27", "2026-10-28"]);
    expect(week.at(-2)).toEqual({ date: "2026-10-27", morning: true, evening: true });
    expect(week.at(-1)).toEqual({ date: "2026-10-28", morning: false, evening: false });
  });

  it("reads ten years of full days back quickly, in one pass", () => {
    const full = Object.fromEntries((["morning", "evening"] as const).map((s) =>
      [s, Object.fromEntries(adhkarFor(s).map((d) => [String(d.id), d.count]))]));
    const days = Object.fromEntries(Array.from({ length: ADHKAR_KEEP_DAYS }, (_, i) =>
      [new Date(Date.UTC(2016, 0, 1 + i)).toISOString().slice(0, 10), full]));
    const started = performance.now();
    const { log, damaged } = checkAdhkarLog(JSON.stringify({ v: 1, days }));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(damaged).toBe(false);
    expect(Object.keys(log.days)).toHaveLength(ADHKAR_KEEP_DAYS);
  });

  it("keeps ten years of days, then lets the oldest go", () => {
    expect(ADHKAR_KEEP_DAYS).toBe(3660);
    const days = Object.fromEntries(Array.from({ length: ADHKAR_KEEP_DAYS }, (_, i) =>
      [new Date(Date.UTC(2016, 0, 1 + i)).toISOString().slice(0, 10), { morning: { 7: 1 } }]));
    const full = { v: 1 as const, days };
    const first = Object.keys(days).sort()[0];
    const log = addOne(full, "2026-10-28", "morning", 7);
    const kept = Object.keys(log.days).sort();
    expect(kept).toHaveLength(ADHKAR_KEEP_DAYS);
    expect(kept).not.toContain(first);
    expect(kept.at(-1)).toBe("2026-10-28");
  });
});

describe("reading a saved log back", () => {
  it("gives back what was saved", () => {
    const log = addOne(setDone(emptyAdhkarLog(), "2026-10-27", "evening", 3, true), "2026-10-27", "morning", 34);
    expect(checkAdhkarLog(JSON.stringify(log))).toEqual({ log, damaged: false });
    expect(checkAdhkarLog(null)).toEqual({ log: emptyAdhkarLog(), damaged: false });
  });

  it("says when it could not be read", () => {
    expect(checkAdhkarLog("{oops").damaged).toBe(true);
    expect(checkAdhkarLog(JSON.stringify({ v: 2, days: {} })).damaged).toBe(true);
    expect(checkAdhkarLog("null").damaged).toBe(true);
  });

  it("keeps only real days, sessions, items and counts, and caps a count at the item's", () => {
    const odd = {
      v: 1,
      days: {
        "2026-10-27": { morning: { "7": 1, "8": 1, "17": 50, "34": 2.5, "999": 1, "20": 0, "21": "3" }, noon: { "7": 1 } },
        "yesterday": { morning: { "7": 1 } },
        "2026-10-26": { evening: {} },
      },
    };
    expect(checkAdhkarLog(JSON.stringify(odd))).toEqual({
      log: { v: 1, days: { "2026-10-27": { morning: { "7": 1, "17": 7 } } } }, damaged: false,
    });
  });
});

describe("when the adhkar are open", () => {
  it("opens the morning from Fajr to Dhuhr, best before sunrise", () => {
    // Before Fajr the evening before has already ended (at 23:26 the night before).
    expect(adhkarWindow(days, at("05:05"))).toBeNull();
    expect(adhkarWindow(days, at("05:06"))).toEqual({
      session: "morning", date: "2026-10-27", start: at("05:06"), end: at("12:06"), bestBefore: at("06:20"),
    });
    expect(adhkarWindow(days, at("12:05"))?.session).toBe("morning");
    expect(adhkarWindow(days, at("12:06"))).toBeNull();
    expect(adhkarWindow(days, at("15:19"))).toBeNull();
  });

  it("opens the evening from Asr to the middle of the night, best before Maghrib", () => {
    const midnight = islamicMidnight(days[1], days[2]);
    // Halfway from Maghrib (17:46) to the next Fajr (05:06): 23:26.
    expect(midnight).toEqual(at("23:26"));
    expect(adhkarWindow(days, at("15:20"))).toEqual({
      session: "evening", date: "2026-10-27", start: at("15:20"), end: midnight, bestBefore: at("17:46"),
    });
    expect(adhkarWindow(days, at("23:25"))?.date).toBe("2026-10-27");
    expect(adhkarWindow(days, at("23:26"))).toBeNull();
    expect(adhkarWindow(days, at("03:00", "2026-10-28"))).toBeNull();
  });

  it("has no evening for a day whose next day is not known", () => {
    expect(adhkarWindow(days.slice(0, 2), at("16:00"))).toBeNull();
    expect(adhkarWindow([days[1], days[3]], at("16:00"))).toBeNull();
  });
});

describe("the adhkar reminders", () => {
  it("comes ten minutes after the Fajr and Asr iqamas, inside the best time", () => {
    const plan = planAdhkar(days, at("00:00", "2026-10-27"), { enabled: true, log: emptyAdhkarLog() }, TZ);
    const first = plan.filter((r) => r.at.getTime() < at("23:59").getTime());
    // Fajr 05:06 + 25 min iqama + 10 = 05:41; Asr 15:20 + 20 + 10 = 15:50. Ids: the date, then slot 5 or 6.
    expect(first.map((r) => [r.id, r.title, r.at.toISOString()])).toEqual([
      [202610275, "Adhkar al-Sabah", at("05:41").toISOString()],
      [202610276, "Adhkar al-Masa", at("15:50").toISOString()],
    ]);
    expect(first[0].body).toBe("Best before sunrise, 06:20.");
    expect(first[1].body).toBe("Best before Maghrib, 17:46.");
    expect(plan.every((r) => isReminderId(r.id))).toBe(true);
    expect(ADHKAR_SLOT).toEqual({ morning: 5, evening: 6 });
  });

  it("comes no later than fifteen minutes before sunrise or Maghrib, and never before the adhan", () => {
    const short: DayTimes = { ...day("2026-10-27"), sunrise: at("05:40"), maghrib: at("15:40") };
    const plan = planAdhkar([short, day("2026-10-28")], at("00:00"), { enabled: true, log: emptyAdhkarLog() }, TZ);
    expect(plan[0].at).toEqual(at("05:25"));
    expect(plan[1].at).toEqual(at("15:25"));
    const tight: DayTimes = { ...day("2026-10-27"), sunrise: at("05:10") };
    expect(planAdhkar([tight], at("00:00"), { enabled: true, log: emptyAdhkarLog() }, TZ)[0].at).toEqual(at("05:06"));
  });

  it("leaves out a session already complete, past times, and everything when turned off", () => {
    const done = finished("2026-10-27", "morning");
    const plan = planAdhkar(days, at("00:00"), { enabled: true, log: done }, TZ);
    expect(plan.map((r) => r.id)).not.toContain(202610275);
    expect(plan.map((r) => r.id)).toContain(202610276);
    expect(planAdhkar(days, at("12:00"), { enabled: true, log: emptyAdhkarLog() }, TZ)[0].id).toBe(202610276);
    expect(planAdhkar(days, at("00:00"), { enabled: false, log: emptyAdhkarLog() }, TZ)).toEqual([]);
  });

  it("leaves out the evening's reminder once all but the end of Al-Baqarah is said", () => {
    const allButNight = adhkarFor("evening").filter((i) => !i.night)
      .reduce((log, item) => setDone(log, "2026-10-27", "evening", item.id, true), emptyAdhkarLog());
    const plan = planAdhkar(days, at("15:30"), { enabled: true, log: allButNight }, TZ);
    expect(plan.map((r) => r.id)).not.toContain(202610276);
  });

  it("plans only the next three days, so the prayer reminders keep most of the phone's 60", () => {
    const many = ["26", "27", "28", "29", "30", "31"].map((d) => day(`2026-10-${d}`));
    const plan = planAdhkar(many, at("00:00"), { enabled: true, log: emptyAdhkarLog() }, TZ);
    // 27, 28 and 29 October, morning and evening; the 30th's morning is past the three days.
    const last = Math.max(...plan.map((r) => r.at.getTime()));
    expect(last).toBeLessThanOrEqual(at("00:00").getTime() + 3 * 86_400_000);
    expect(plan).toHaveLength(6);
  });

  it("fits with the prayer reminders inside the limit, nearest first", () => {
    const prayers = planReminders(days, at("00:00"), ALL_ON, TZ);
    const adhkar = planAdhkar(days, at("00:00"), { enabled: true, log: emptyAdhkarLog() }, TZ);
    const all = planAll(prayers, adhkar);
    expect(all.length).toBe(prayers.length + adhkar.length);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(all.map((r) => r.at.getTime())).toEqual([...all.map((r) => r.at.getTime())].sort((a, b) => a - b));
  });
});
