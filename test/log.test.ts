// The prayer log kept on the device: marks, sunnah prayers and the count to make up.
import { describe, expect, it } from "vitest";
import { adjustOwed, cycleMark, emptyLog, parseLog, toggleSunnah, weekDots } from "../src/prayer/log.ts";

const D = "2026-10-22";

describe("a prayer's mark", () => {
  it("cycles: none, on time, on time at the mosque, late, none", () => {
    let log = emptyLog();
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const mark = log.days[D]?.prayers.asr;
      seen.push(mark ? `${mark.status}${mark.mosque ? "+mosque" : ""}` : "none");
      log = cycleMark(log, D, "asr");
    }
    expect(seen).toEqual(["none", "ontime", "ontime+mosque", "late", "none"]);
  });

  it("never changes the log it was given", () => {
    const before = emptyLog();
    const after = cycleMark(before, D, "fajr");
    expect(before.days).toEqual({});
    expect(after.days[D].prayers.fajr).toEqual({ status: "ontime", mosque: false });
  });
});

describe("sunnah prayers and the count to make up", () => {
  it("toggles Duha, Witr and the night prayer on their own", () => {
    const log = toggleSunnah(toggleSunnah(emptyLog(), D, "witr"), D, "duha");
    expect(log.days[D].sunnah).toEqual({ duha: true, witr: true, night: false });
    expect(toggleSunnah(log, D, "witr").days[D].sunnah.witr).toBe(false);
  });

  it("keeps the count to make up between 0 and 99,999", () => {
    expect(adjustOwed(emptyLog(), -3).owed).toBe(0);
    expect(adjustOwed(adjustOwed(emptyLog(), 5), -2).owed).toBe(3);
    expect(adjustOwed(emptyLog(), 1e9).owed).toBe(99999);
  });
});

describe("the last seven days", () => {
  it("gives five dots a day, oldest first, ending today", () => {
    let log = cycleMark(emptyLog(), D, "fajr");
    log = cycleMark(cycleMark(cycleMark(log, "2026-10-21", "isha"), "2026-10-21", "isha"), "2026-10-21", "isha");
    const week = weekDots(log, D);
    expect(week).toHaveLength(7);
    expect(week[6].date).toBe(D);
    expect(week[6].dots).toEqual(["ontime", "none", "none", "none", "none"]);
    expect(week[5].dots[4]).toBe("late");
    expect(week[0].date).toBe("2026-10-16");
  });
});

describe("reading a saved log", () => {
  it("starts empty from nothing or from damaged data", () => {
    expect(parseLog(null)).toEqual(emptyLog());
    expect(parseLog("{not json")).toEqual(emptyLog());
    expect(parseLog(JSON.stringify({ v: 9 }))).toEqual(emptyLog());
  });

  it("keeps good days and drops bad entries", () => {
    const saved = JSON.stringify({
      v: 1, owed: 4,
      days: {
        "2026-10-22": { prayers: { fajr: { status: "ontime", mosque: true }, dhuhr: { status: "maybe" } },
          sunnah: { duha: true } },
        "not-a-date": { prayers: {} },
      },
    });
    const log = parseLog(saved);
    expect(log.owed).toBe(4);
    expect(Object.keys(log.days)).toEqual(["2026-10-22"]);
    expect(log.days["2026-10-22"].prayers).toEqual({ fajr: { status: "ontime", mosque: true } });
    expect(log.days["2026-10-22"].sunnah).toEqual({ duha: true, witr: false, night: false });
  });
});
