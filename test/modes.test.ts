// Modes: when each one opens by itself, what is kept for it, and that a saved log is read back with care.
import { describe, expect, it } from "vitest";
import { DUBAI } from "./fixtures/places.ts";
import { addDays, dayTimes, type DayTimes } from "../src/prayer/times.ts";
import {
  addOwnDua, addToStep, checkModeLog, emptyModeLog, isNotNow, modeWindows, ownDuas, placeOf, removeOwnDua, runningMinutes, setNotNow, setPlace, setStep,
  setStudyAfter, startTimer, stepCount, stopTimer, studyAfter,
} from "../src/modes/modes.ts";
import { TRADING_ID } from "./fixtures/learn.ts";

/** Wednesday 21 Oct 2026 to Saturday 31 Oct, Dubai method. */
const days: DayTimes[] = Array.from({ length: 11 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 21 }, i), "Dubai"));
const thursday = days[1];
const friday = days[2];
const saturday = days[3];
const MIN = 60_000;
const after = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);
const openAt = (now: Date, log = emptyModeLog(), tracks: readonly string[] = []) =>
  modeWindows(days, now, log, tracks).map((w) => w.mode);

describe("the dhikr after each prayer", () => {
  it("opens after Dhuhr's and Asr's iqama until the next prayer, on the day they belong to", () => {
    expect(openAt(after(saturday.dhuhr, 19))).not.toContain("dhuhr");
    expect(openAt(after(saturday.dhuhr, 20))).toContain("dhuhr");
    expect(openAt(after(saturday.asr, -1))).toContain("dhuhr");
    expect(openAt(after(saturday.asr, 0))).not.toContain("dhuhr");
    expect(openAt(after(saturday.asr, 20))).toContain("asr");
    expect(openAt(after(saturday.maghrib, 0))).not.toContain("asr");
    expect(modeWindows(days, after(saturday.dhuhr, 30), emptyModeLog(), []).find((w) => w.mode === "dhuhr")?.date).toBe(saturday.date);
  });

  it("opens after Isha's iqama until the middle of the night, past midnight on its own day", () => {
    expect(openAt(after(saturday.isha, 19))).not.toContain("isha");
    expect(openAt(after(saturday.isha, 20))).toContain("isha");
    const sunday = days[4];
    const middle = new Date((saturday.maghrib.getTime() + sunday.fajr.getTime()) / 2);
    const justBefore = modeWindows(days, after(middle, -1), emptyModeLog(), []).find((w) => w.mode === "isha");
    expect(justBefore?.date).toBe(saturday.date);
    expect(openAt(middle)).not.toContain("isha");
  });

  it("on a Friday opens past the khutbah and the prayer, as Jumu'ah has no iqama here, and Jumu'ah stays first", () => {
    expect(openAt(after(friday.dhuhr, 74))).not.toContain("dhuhr");
    const open = openAt(after(friday.dhuhr, 75));
    expect(open).toContain("dhuhr");
    expect(open[0]).toBe("jumuah");
  });

  it("keeps its counts in a saved log", () => {
    const log = addToStep(emptyModeLog(), saturday.date, "dhuhr", "tasbih", 100);
    expect(checkModeLog(JSON.stringify(log)).log.days[saturday.date].dhuhr.tasbih).toBe(1);
  });
});

describe("when a mode opens by itself", () => {
  it("opens Jumu'ah from Maghrib on Thursday to Maghrib on Friday", () => {
    expect(openAt(after(thursday.maghrib, -1))).not.toContain("jumuah");
    expect(openAt(after(thursday.maghrib, 1))).toContain("jumuah");
    expect(openAt(after(friday.dhuhr, 0))).toContain("jumuah");
    expect(openAt(after(friday.maghrib, 0))).not.toContain("jumuah");
  });

  it("opens Fajr from the adhan until half an hour after sunrise, for the two rak'ahs", () => {
    expect(openAt(after(saturday.fajr, -1))).not.toContain("fajr");
    expect(openAt(after(saturday.fajr, 0))).toContain("fajr");
    expect(openAt(after(saturday.sunrise, 29))).toContain("fajr");
    expect(openAt(after(saturday.sunrise, 30))).not.toContain("fajr");
  });

  it("opens Maghrib from the adhan until Isha", () => {
    expect(openAt(after(saturday.maghrib, -1))).not.toContain("maghrib");
    expect(openAt(after(saturday.maghrib, 0))).toContain("maghrib");
    expect(openAt(after(saturday.isha, 0))).not.toContain("maghrib");
  });

  it("never opens Istikhara by itself", () => {
    for (const d of days) expect(openAt(after(d.dhuhr, 5))).not.toContain("istikhara");
  });

  it("keeps a window's date on the day it belongs to, so a Friday's ticks stay on that Friday", () => {
    const [w] = modeWindows(days, after(thursday.maghrib, 1), emptyModeLog(), []).filter((x) => x.mode === "jumuah");
    expect(w.date).toBe("2026-10-23");
    expect(w.end.getTime()).toBe(friday.maghrib.getTime());
  });

  it("puts what ends soonest first, and Islamic modes before study", () => {
    const log = setStudyAfter(emptyModeLog(), "t1", "fajr", 1);
    const order = modeWindows(days, after(friday.fajr, 1), log, ["t1"]).map((w) => w.mode);
    expect(order).toEqual(["fajr", "jumuah", "study:t1"]);
  });

  it("opens a study mode after the prayer the user chose, until the next one", () => {
    const log = setStudyAfter(emptyModeLog(), "t1", "asr", 1);
    expect(openAt(after(saturday.asr, 1), log, ["t1"])).toContain("study:t1");
    expect(openAt(after(saturday.asr, -1), log, ["t1"])).not.toContain("study:t1");
    expect(openAt(after(saturday.maghrib, 0), log, ["t1"])).not.toContain("study:t1");
  });

  it("runs a study mode after Isha until the middle of the night", () => {
    const log = setStudyAfter(emptyModeLog(), "t1", "isha", 1);
    const middle = new Date((saturday.maghrib.getTime() + days[4].fajr.getTime()) / 2);
    expect(openAt(after(saturday.isha, 1), log, ["t1"])).toContain("study:t1");
    expect(openAt(after(middle, -1), log, ["t1"])).toContain("study:t1");
    expect(openAt(middle, log, ["t1"])).not.toContain("study:t1");
  });

  it("leaves every study mode closed until a time is chosen for it", () => {
    expect(studyAfter(emptyModeLog(), "t1")).toBe("off");
    expect(studyAfter(emptyModeLog(), TRADING_ID)).toBe("off");
    expect(openAt(after(saturday.asr, 1), emptyModeLog(), ["t1"])).not.toContain("study:t1");
    expect(openAt(after(saturday.isha, 1), emptyModeLog(), [TRADING_ID])).not.toContain(`study:${TRADING_ID}`);
    const isha = setStudyAfter(emptyModeLog(), TRADING_ID, "isha", 1);
    expect(openAt(after(saturday.isha, 1), isha, [TRADING_ID])).toContain(`study:${TRADING_ID}`);
  });

  it("turns off when the user says so", () => {
    const log = setStudyAfter(setStudyAfter(emptyModeLog(), "t1", "asr", 1), "t1", "off", 2);
    expect(openAt(after(saturday.asr, 1), log, ["t1"])).not.toContain("study:t1");
  });

  it("opens nothing on an empty list of days", () => {
    expect(modeWindows([], after(saturday.asr, 1), emptyModeLog(), [TRADING_ID])).toEqual([]);
  });
});

describe("what is kept for a mode", () => {
  const date = "2026-10-31";

  it("counts a step up to its count, and returns a new log", () => {
    const empty = emptyModeLog();
    const one = addToStep(empty, date, "fajr", "ten", 2);
    const two = addToStep(one, date, "fajr", "ten", 2);
    expect(addToStep(two, date, "fajr", "ten", 2)).toBe(two);
    expect(stepCount(two, date, "fajr", "ten")).toBe(2);
    expect(stepCount(empty, date, "fajr", "ten")).toBe(0);
  });

  it("clears a step when set to zero, without keeping an empty day", () => {
    const log = setStep(setStep(emptyModeLog(), date, "fajr", "ten", 10), date, "fajr", "ten", 0);
    expect(log.days).toEqual({});
  });

  it("does not count on a date that is not one", () => {
    const empty = emptyModeLog();
    expect(addToStep(empty, "soon", "fajr", "ten", 3)).toBe(empty);
    expect(setPlace(empty, "18-soon", 293, 1)).toBe(empty);
  });

  it("remembers Not now for that occasion only", () => {
    const log = setNotNow(emptyModeLog(), date, "fajr");
    expect(isNotNow(log, date, "fajr")).toBe(true);
    expect(isNotNow(log, "2026-11-01", "fajr")).toBe(false);
    expect(isNotNow(log, date, "maghrib")).toBe(false);
  });

  it("keeps a place in a reading by itself, for that Friday", () => {
    const log = setPlace(emptyModeLog(), "18-2026-10-30", 297, 100);
    expect(placeOf(log, "18-2026-10-30")).toBe(297);
    expect(placeOf(log, "18-2026-11-06")).toBeNull();
  });

  it("forgets places a month old as a new one is kept", () => {
    const old = setPlace(emptyModeLog(), "18-2026-09-04", 300, 100);
    const next = setPlace(old, "18-2026-10-30", 293, 200);
    expect(placeOf(next, "18-2026-09-04")).toBeNull();
    expect(placeOf(next, "18-2026-10-30")).toBe(293);
  });

  it("times a study from when it began, and says so in whole minutes", () => {
    const started = startTimer(emptyModeLog(), "t1", 1000);
    expect(started.timer).toEqual({ trackId: "t1", startedAt: 1000 });
    expect(runningMinutes(started, 1000 + 25 * MIN + 29_000)).toBe(25);
    expect(runningMinutes(started, 1000 + 25 * MIN + 31_000)).toBe(26);
    expect(runningMinutes(started, 1000 + 10_000)).toBe(1);
    expect(runningMinutes(emptyModeLog(), 1000)).toBe(0);
    expect(stopTimer(started).timer).toBeNull();
  });

  it("never counts a clock set back as negative time", () => {
    expect(runningMinutes(startTimer(emptyModeLog(), "t1", 5000), 1000)).toBe(1);
  });
});

describe("du'as the user adds personally", () => {
  it("keeps the user's words on the mode the user chose, oldest first", () => {
    const one = addOwnDua(emptyModeLog(), "fajr", " The example du'a ", " the user's words ", 5, "d-1");
    const two = addOwnDua(one, "fajr", "", "more", 3, "d-2");
    expect(ownDuas(two, "fajr").map((d) => [d.id, d.name, d.text])).toEqual([
      ["d-2", "My du'a", "more"], ["d-1", "The example du'a", "the user's words"]]);
    expect(ownDuas(two, "maghrib")).toEqual([]);
  });

  it("takes nothing empty, nothing on a study, and no odd id", () => {
    const empty = emptyModeLog();
    expect(addOwnDua(empty, "fajr", "x", "   ", 1, "d-1")).toBe(empty);
    expect(addOwnDua(empty, "study:t1", "x", "y", 1, "d-1")).toBe(empty);
    expect(addOwnDua(empty, "fajr", "x", "y", 1, "__proto__")).toBe(empty);
  });

  it("removes one, and leaves the log as it was for one not there", () => {
    const log = addOwnDua(emptyModeLog(), "fajr", "x", "y", 1, "d-1");
    expect(ownDuas(removeOwnDua(log, "d-1"), "fajr")).toEqual([]);
    expect(removeOwnDua(log, "toString")).toBe(log);
  });

  it("reads back only what is whole", () => {
    const { log } = checkModeLog(JSON.stringify({ v: 1, duas: {
      "d-1": { mode: "fajr", name: "a", text: "b", at: 1 }, "d-2": { mode: "fajr", name: "a", text: " ", at: 1 },
      "d-3": { mode: "nope", name: "a", text: "b", at: 1 }, bad: { mode: "fajr", name: "a", text: "b", at: 1 },
    } }));
    expect(Object.keys(log.duas)).toEqual(["d-1"]);
  });

  it("never shares an id with a step", () => {
    const empty = emptyModeLog();
    expect(addOwnDua(empty, "jumuah", "x", "y", 1, "dua")).toBe(empty);
    expect(Object.keys(checkModeLog(JSON.stringify({ v: 1, duas: { dua: { mode: "jumuah", name: "a", text: "b", at: 1 } } })).log.duas))
      .toEqual([]);
  });

  it("does not let junk push the user's own out", () => {
    const junk = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [String(i), { mode: "fajr", name: "a", text: "b", at: 1 }]));
    const { log } = checkModeLog(JSON.stringify({ v: 1, duas: { ...junk, "d-1": { mode: "fajr", name: "a", text: "mine", at: 1 } } }));
    expect(Object.keys(log.duas)).toEqual(["d-1"]);
  });
});

describe("reading a saved log back", () => {
  it("takes nothing as nothing, and damage as damage", () => {
    expect(checkModeLog(null)).toEqual({ log: emptyModeLog(), damaged: false });
    expect(checkModeLog("{oops").damaged).toBe(true);
    expect(checkModeLog(JSON.stringify({ v: 9 })).damaged).toBe(true);
  });

  it("keeps what is good and drops what is not", () => {
    const { log, damaged } = checkModeLog(JSON.stringify({
      v: 1,
      days: {
        "2026-10-31": { fajr: { ten: 4, bad: -1, worse: "x", huge: 1e9 }, nope: { a: 1 }, "study:t1": { lesson: 1 } },
        soon: { fajr: { ten: 1 } },
      },
      places: { "18-2026-10-30": { page: 297, at: 5 }, "18-2026-10-31": { page: 9999, at: 5 }, x: { page: 1, at: 1 } },
      study: { t1: { after: "asr", at: 3 }, t2: { after: "noon", at: 3 } },
      timer: { trackId: "t1", startedAt: 77 },
    }));
    expect(damaged).toBe(false);
    expect(log.days).toEqual({ "2026-10-31": { fajr: { ten: 4 }, "study:t1": { lesson: 1 } } });
    expect(log.places).toEqual({ "18-2026-10-30": { page: 297, at: 5 } });
    expect(log.study).toEqual({ t1: { after: "asr", at: 3 } });
    expect(log.timer).toEqual({ trackId: "t1", startedAt: 77 });
  });

  it("drops a timer that makes no sense", () => {
    expect(checkModeLog(JSON.stringify({ v: 1, timer: { trackId: 3, startedAt: "x" } })).log.timer).toBeNull();
  });

  it("takes in no more than it could ever need, keeping the newest", () => {
    const manyDays = Object.fromEntries(Array.from({ length: 5000 }, (_, i) =>
      [new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10), { fajr: { ten: 1 } }]));
    const manyModes = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`study:t${i}`, { a: 1 }]));
    const manySteps = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`s${i}`, 1]));
    const { log } = checkModeLog(JSON.stringify({
      v: 1,
      days: { ...manyDays, "2030-01-01": manyModes, "2030-01-02": { fajr: manySteps } },
      places: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`${(i % 114) + 1}-20${String(i % 90).padStart(2, "0")}-01-01`, { page: 1, at: i }])),
      study: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`t${i}`, { after: "asr", at: 1 }])),
    }));
    expect(Object.keys(log.days).length).toBeLessThanOrEqual(3660);
    expect(log.days["2000-01-01"]).toBeUndefined();
    expect(Object.keys(log.days["2030-01-01"]).length).toBeLessThanOrEqual(60);
    expect(Object.keys(log.days["2030-01-02"].fajr).length).toBeLessThanOrEqual(150);
    expect(Object.keys(log.places).length).toBeLessThanOrEqual(100);
    expect(Object.keys(log.study).length).toBeLessThanOrEqual(60);
  });

  it("survives a saved log with a poisoned key", () => {
    const { log } = checkModeLog('{"v":1,"days":{"__proto__":{"fajr":{"ten":1}}},"places":{"__proto__":{"page":1,"at":1}}}');
    expect(Object.keys(log.days)).toEqual([]);
    expect(Object.keys(log.places)).toEqual([]);
  });
});
