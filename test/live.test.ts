// What should be live on the lock screen and the island: this side decides, native only draws. Words and counts are
// checked here; how they look can only be seen on a device.
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  show: vi.fn(async () => undefined), end: vi.fn(async () => undefined), drain: vi.fn(async () => ({ taps: [] as unknown[] })), platform: "ios",
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.platform !== "web", getPlatform: () => native.platform },
  registerPlugin: () => ({ show: native.show, end: native.end, drain: native.drain }),
}));

import { emptyAdhkarLog } from "../src/faith/adhkar.ts";
import { emptyFridayLog } from "../src/faith/friday.ts";
import { sampleLearn as seedLearn } from "./fixtures/learn.ts";
import { emptyModeLog, setStep, stepCount, startTimer } from "../src/modes/modes.ts";
import { DUBAI } from "./fixtures/places.ts";
import { addDays, dayTimes } from "../src/prayer/times.ts";
import {
  applyTaps, dhikrItem, dhikrKey, dhikrOf, drainTaps, nextItem, openDhikr, startWorkoutTimer, stopWorkoutTimer, syncLive, timerItem, WORKOUT_TIMER, type LiveItem,
} from "../src/app/live.ts";

const days = Array.from({ length: 5 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 24 }, i), "Dubai"));
const saturday = days[0];
const MIN = 60_000;
const after = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);
const c = { log: emptyModeLog(), friday: emptyFridayLog(), adhkar: emptyAdhkarLog() };

describe("the next prayer", () => {
  it("counts down to the iqama once the adhan has sounded, on every platform", () => {
    for (const platform of ["ios", "android"]) {
      const item = nextItem(days, after(saturday.asr, 5), platform);
      expect(item).toMatchObject({ id: "next", title: "Asr", detail: "Iqama" });
      expect(item?.endsAt).toBe(after(saturday.asr, 20).getTime());
    }
  });

  it("counts down to the next prayer on iOS, and leaves that to the widget on Android", () => {
    const now = after(saturday.dhuhr, 40);
    expect(nextItem(days, now, "ios")).toMatchObject({ title: "Asr", detail: "Next prayer", endsAt: saturday.asr.getTime() });
    expect(nextItem(days, now, "android")).toBeNull();
  });

  it("stays away from a prayer more than eight hours off: Apple would end it before it came", () => {
    const far = dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 25 }, 0), "Dubai");
    // Isha's iqama has passed and tomorrow's Fajr is more than eight hours away.
    const lateEvening = after(saturday.isha, 25);
    expect(far.fajr.getTime() - lateEvening.getTime()).toBeGreaterThan(8 * 60 * MIN);
    expect(nextItem(days, lateEvening, "ios")).toBeNull();
  });

  it("names Friday's Dhuhr Jumu'ah", () => {
    const friday = dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 30 }, 0), "Dubai");
    expect(nextItem([friday], after(friday.dhuhr, -60), "ios")).toMatchObject({ title: "Jumu'ah" });
  });

  it("gives nothing with no days", () => {
    expect(nextItem([], new Date(), "ios")).toBeNull();
  });
});

describe("the dhikr to count", () => {
  const key = dhikrKey("dhuhr", saturday.date, "tasbih");

  it("reads a key back into its name and count, and never its words", () => {
    const d = dhikrOf(key, c);
    expect(d).toMatchObject({ key, n: 0, of: 100 });
    const item = dhikrItem(d as NonNullable<typeof d>, "dhuhr");
    expect(item).toMatchObject({ id: "dhikr", detail: "0 of 100", count: 0, of: 100, key, link: "awqat://go/mode:dhuhr" });
    expect(JSON.stringify(item)).not.toMatch(/[؀-ۿ]/);
  });

  it("is nothing for a key that means nothing", () => {
    for (const bad of ["", "a|b", "dhuhr|2026-10-24", "nope|2026-10-24|tasbih", "dhuhr|2026-10-24|nope", "dhuhr|2026-10-24|tasbih|more"]) {
      expect(dhikrOf(bad, c)).toBeNull();
    }
    // A step that is not counted with a ring.
    expect(dhikrOf(dhikrKey("fajr", saturday.date, "sit"), c)).toBeNull();
  });

  it("finds the first thing still to count in what is open now, for the home-screen counter", () => {
    const now = after(saturday.dhuhr, 30);
    const base = { days, now, ...c, learn: seedLearn(), today: saturday.date };
    expect(openDhikr(base)).toMatchObject({ key: dhikrKey("dhuhr", saturday.date, "istighfar"), n: 0, of: 1 });
    const log = setStep(c.log, saturday.date, "dhuhr", "istighfar", 1);
    expect(openDhikr({ ...base, log })).toMatchObject({ key: dhikrKey("dhuhr", saturday.date, "la-mani") });
  });

  it("is nothing when no mode is open", () => {
    const now = after(saturday.fajr, -60);
    expect(openDhikr({ days: days.slice(0, 1), now, ...c, learn: { ...seedLearn(), tracks: [] }, today: saturday.date })).toBeNull();
  });
});

describe("taps made with the app closed", () => {
  const key = dhikrKey("dhuhr", saturday.date, "tasbih");

  it("are added to the count", () => {
    const log = applyTaps(c.log, [{ key, n: 3 }, { key, n: 2 }], c);
    expect(stepCount(log, saturday.date, "dhuhr", "tasbih")).toBe(5);
  });

  it("stop at the step's own number", () => {
    const log = applyTaps(setStep(c.log, saturday.date, "dhuhr", "tasbih", 99), [{ key, n: 50 }], c);
    expect(stepCount(log, saturday.date, "dhuhr", "tasbih")).toBe(100);
  });

  it("are let go when they make no sense", () => {
    const log = applyTaps(c.log, [{ key: "nope", n: 5 }, { key, n: -3 }, { key, n: 1.5 }, { key: dhikrKey("dhuhr", saturday.date, "nope"), n: 1 }], c);
    expect(log).toBe(c.log);
  });
});

describe("the timer", () => {
  it("is a study under its subject's name", () => {
    const log = startTimer(c.log, "t-1", 5000);
    expect(timerItem(log, (id) => (id === "t-1" ? "Trading" : null), "")).toMatchObject({ id: "timer", title: "Trading", detail: "Studying", startedAt: 5000,
      link: "awqat://go/mode:study:t-1" });
  });

  it("is a workout under what is planned today, or simply Workout", () => {
    const log = startWorkoutTimer(c.log, 5000);
    expect(log.timer?.trackId).toBe(WORKOUT_TIMER);
    expect(timerItem(log, () => null, "Push")).toMatchObject({ title: "Push", detail: "Training", link: "awqat://go/body" });
    expect(timerItem(log, () => null, "")).toMatchObject({ title: "Workout" });
  });

  it("is nothing with none running, or a subject that has gone", () => {
    expect(timerItem(c.log, () => null, "")).toBeNull();
    expect(timerItem(startTimer(c.log, "gone", 1), () => null, "")).toBeNull();
  });

  it("stopping a workout leaves a study's timer alone", () => {
    const study = startTimer(c.log, "t-1", 1);
    expect(stopWorkoutTimer(study)).toBe(study);
    expect(stopWorkoutTimer(startWorkoutTimer(c.log, 1)).timer).toBeNull();
  });
});

describe("keeping native in step", () => {
  const item: LiveItem = { id: "next", title: "Asr", detail: "Next prayer", endsAt: 1, link: "awqat://go/faith" };

  beforeEach(() => {
    native.show.mockClear();
    native.end.mockClear();
    native.platform = "ios";
  });

  it("shows only what changed, ends what is no longer wanted, and never restarts for a redraw", () => {
    syncLive([item]);
    expect(native.show).toHaveBeenCalledTimes(1);
    // The first run ended what an earlier run may have left up.
    expect(native.end.mock.calls.map((a) => (a as unknown as [{ id: string }])[0].id).sort()).toEqual(["dhikr", "timer"]);
    native.show.mockClear();
    native.end.mockClear();
    syncLive([item]);
    syncLive([{ ...item }]);
    expect(native.show).not.toHaveBeenCalled();
    syncLive([{ ...item, endsAt: 2 }]);
    expect(native.show).toHaveBeenCalledTimes(1);
    syncLive([]);
    expect(native.end).toHaveBeenCalledTimes(1);
    syncLive([]);
    expect(native.end).toHaveBeenCalledTimes(1);
  });

  it("after a refusal asks again in a minute, not at every redraw", async () => {
    const other: LiveItem = { id: "timer", title: "Trading", detail: "Studying", startedAt: 1, link: "awqat://go/modes" };
    native.show.mockRejectedValueOnce(new Error("off"));
    syncLive([other]);
    await Promise.resolve();
    await Promise.resolve();
    syncLive([other]);
    syncLive([other]);
    expect(native.show).toHaveBeenCalledTimes(1);
    const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    syncLive([other]);
    later.mockRestore();
    expect(native.show).toHaveBeenCalledTimes(2);
  });

  it("does nothing in a browser", () => {
    native.platform = "web";
    syncLive([item]);
    expect(native.show).not.toHaveBeenCalled();
  });

  it("reads taps, keeps only ones it can read, and survives a failure", async () => {
    native.drain.mockResolvedValueOnce({ taps: [{ key: "a", n: 1 }, { key: 5, n: 1 }, null] });
    expect(await drainTaps()).toEqual([{ key: "a", n: 1 }]);
    native.drain.mockRejectedValueOnce(new Error("no"));
    expect(await drainTaps()).toEqual([]);
    native.platform = "web";
    expect(await drainTaps()).toEqual([]);
  });
});
