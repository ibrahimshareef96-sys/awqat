// Body: typed weights, the weekly plan, and the numbers drawn from the health store's readings.
import { describe, expect, it } from "vitest";
import { addWeight, checkBody, emptyBody, parseKg, removeWeight, setConnected, setTarget, WEIGHTS_MAX } from "../src/body/body.ts";
import {
  sleepSummary, stepsSummary, summarise, weekStart, weightPoints, weightSummary, workoutLabel, workoutsSummary,
} from "../src/body/summary.ts";

const TZ = "Asia/Dubai";
const TODAY = "2026-10-26";
/** An ISO instant on a day of October 2026, Dubai time. */
const iso = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h - 4, m)).toISOString();
const ms = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h - 4, m);

describe("typed weights and the plan", () => {
  it("reads a weight as people type it, and refuses one that is not a body weight", () => {
    expect(parseKg("82.4")).toBe(82.4);
    expect(parseKg(" 82,45 kg ")).toBe(82.5);
    expect(parseKg("82")).toBe(82);
    for (const bad of ["", "8", "1000", "eighty", "82.4.1", "-82", 82]) expect(parseKg(bad)).toBeNull();
  });

  it("keeps typed weights newest first, one per moment, at most 400", () => {
    let log = addWeight(emptyBody(), 82.4, 1000);
    log = addWeight(log, 82.1, 2000);
    log = addWeight(log, 82.0, 2000);
    expect(log.weights).toEqual([{ at: 2000, kg: 82 }, { at: 1000, kg: 82.4 }]);
    expect(addWeight(log, 5, 3000)).toBe(log);
    expect(removeWeight(log, 2000).weights).toEqual([{ at: 1000, kg: 82.4 }]);
    let many = emptyBody();
    for (let i = 1; i <= WEIGHTS_MAX + 5; i++) many = addWeight(many, 80, i);
    expect(many.weights).toHaveLength(WEIGHTS_MAX);
    expect(many.weights[0].at).toBe(WEIGHTS_MAX + 5);
  });

  it("takes a weekly target of 1 to 14, and none for anything else", () => {
    expect(setTarget(emptyBody(), "4").weeklyTarget).toBe(4);
    expect(setTarget(emptyBody(), 14).weeklyTarget).toBe(14);
    for (const none of ["", "0", "15", "2.5", "x", null]) expect(setTarget(emptyBody(), none).weeklyTarget).toBeNull();
    expect(setConnected(emptyBody(), true).connected).toBe(true);
  });

  it("reads the saved log back, and says when it was damaged", () => {
    const log = setTarget(addWeight(setConnected(emptyBody(), true), 81.9, 5000), 3);
    expect(checkBody(JSON.stringify(log))).toEqual({ log, damaged: false });
    expect(checkBody(null)).toEqual({ log: emptyBody(), damaged: false });
    expect(checkBody("{x").damaged).toBe(true);
    const odd = checkBody(JSON.stringify({ ...log, weights: [...log.weights, { at: -1, kg: 80 }, { at: 9, kg: 900 }] }));
    expect(odd).toEqual({ log, damaged: true });
    expect(checkBody(JSON.stringify({ ...log, weeklyTarget: 99 })).damaged).toBe(true);
  });
});

describe("the weight trend", () => {
  it("takes the last weight of each day in 30 days, read and typed together", () => {
    const read = [
      { value: 83.0, startDate: iso(1, 8), endDate: iso(1, 8) },
      { value: 82.6, startDate: iso(20, 7), endDate: iso(20, 7) },
      { value: 82.9, startDate: iso(20, 21), endDate: iso(20, 21) },
      // Before the 30 days: left out.
      { value: 90, startDate: iso(-10 + 30 - 30, 8), endDate: iso(0, 8) },
    ];
    const points = weightPoints(read, [{ at: ms(26, 7), kg: 82.04 }], TODAY, TZ);
    expect(points.map((p) => [p.kg, p.typed])).toEqual([[83, false], [82.9, false], [82, true]]);
    expect(weightSummary(points)).toMatchObject({ latest: { kg: 82, typed: true }, change: -1 });
  });

  it("has no change from a single weight, and nothing from none", () => {
    expect(weightSummary(weightPoints([], [{ at: ms(26, 7), kg: 80 }], TODAY, TZ))).toMatchObject({ change: null });
    expect(weightSummary([])).toEqual({ latest: null, change: null, points: [] });
  });
});

describe("steps, sleep and workouts", () => {
  it("gives steps for each of the last seven days, today last, and the six days' average", () => {
    const buckets = [
      { startDate: iso(20, 0), value: 6000 }, { startDate: iso(25, 0), value: 9000.4 },
      { startDate: iso(26, 0), value: 2500 }, { startDate: iso(19, 0), value: 99999 },
    ];
    const steps = stepsSummary(buckets, TODAY, TZ);
    expect(steps?.days.map((d) => d.steps)).toEqual([6000, 0, 0, 0, 0, 9000, 2500]);
    expect(steps?.today).toBe(2500);
    expect(steps?.average).toBe(2500);
  });

  it("names a day's steps by the middle of its bucket, wherever the bucket begins", () => {
    // A bucket that began a minute before Dubai's midnight still belongs to the next day.
    expect(stepsSummary([{ startDate: iso(25, 23, 59), value: 100 }], TODAY, TZ)?.today).toBe(100);
  });

  it("counts a night on the day it ends, its stages without the time awake", () => {
    const sleep = sleepSummary([
      { value: 480, startDate: iso(25, 23), endDate: iso(26, 7), stages: [
        { stage: "light", durationMinutes: 240 }, { stage: "deep", durationMinutes: 120 },
        { stage: "awake", durationMinutes: 30 }, { stage: "rem", durationMinutes: 90 }] },
      { value: 400, startDate: iso(24, 0), endDate: iso(24, 6, 40) },
      // A nap in the afternoon joins that day's night.
      { value: 30, startDate: iso(24, 14), endDate: iso(24, 14, 30) },
    ], TODAY, TZ);
    expect(sleep?.last).toEqual({ day: TODAY, minutes: 450 });
    expect(sleep?.nights.find((n) => n.day === "2026-10-24")?.minutes).toBe(430);
    expect(sleep?.average).toBe(440);
  });

  it("counts a night recorded by two sources once, by when each stretch began and ended", () => {
    // A phone and a watch both wrote 23:00 to 06:00; the watch's stages are timed.
    const sleep = sleepSummary([
      { value: 420, startDate: iso(25, 23), endDate: iso(26, 6), sleepState: "asleep" },
      { value: 420, startDate: iso(25, 23), endDate: iso(26, 6), stages: [
        { stage: "core", durationMinutes: 180, startDate: iso(25, 23), endDate: iso(26, 2) },
        { stage: "awake", durationMinutes: 30, startDate: iso(26, 2), endDate: iso(26, 2, 30) },
        { stage: "deep", durationMinutes: 210, startDate: iso(26, 2, 30), endDate: iso(26, 6) }] },
    ], TODAY, TZ);
    expect(sleep?.last).toEqual({ day: TODAY, minutes: 420 });
  });

  it("says there is no last night when none was slept", () => {
    expect(sleepSummary([], TODAY, TZ)).toMatchObject({ last: null, average: null });
  });

  it("lists this week's workouts from Monday, with plain names, against the plan", () => {
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2026-10-31")).toBe("2026-10-26");
    const workouts = workoutsSummary([
      { workoutType: "strengthTraining", duration: 3600, startDate: iso(26, 6) },
      { workoutType: "running", duration: 1500, startDate: iso(25, 18) },
      { workoutType: "highIntensityIntervalTraining", duration: 900, startDate: iso(26, 19) },
    ], TODAY, TZ, 4);
    expect(workouts).toMatchObject({ count: 2, target: 4, weekStart: TODAY });
    expect(workouts?.week.map((w) => [w.label, w.minutes])).toEqual([["Strength training", 60],
      ["High intensity interval training", 15]]);
    expect(workoutLabel("other")).toBe("Workout");
    expect(workoutLabel("HIIT")).toBe("Hiit");
  });

  it("keeps a kind the store could not give as nothing, and the rest as read", () => {
    const summary = summarise({ weight: null, steps: [], sleep: null, workouts: null },
      [{ at: ms(26, 7), kg: 80 }], TODAY, TZ, null);
    expect(summary.steps?.today).toBe(0);
    expect(summary.sleep).toBeNull();
    expect(summary.workouts).toBeNull();
    expect(summary.weight?.latest?.kg).toBe(80);
  });
});
