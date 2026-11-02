// Body's plan: a daily step goal, what is planned each weekday, days done, and the lifts that show progress.
import { describe, expect, it } from "vitest";
import { addWeight, checkBody, emptyBody } from "../src/body/body.ts";
import { addLift, dayDone, liftProgress, parseStepGoal, planFor, removeLift, setPlan, setStepGoal, toggleDone, weekDoneDays } from "../src/body/training.ts";
import { bodyCollection } from "../src/sync/collections.ts";

const FRIDAY = "2026-10-30";
const lift = (id: string, date: string, kg: number, reps = 8, sets = 3) => ({ id, date, exercise: "Deadlift", kg, reps, sets });

describe("the step goal", () => {
  it("takes a sensible number, or none", () => {
    expect(parseStepGoal("8000")).toBe(8000);
    expect(parseStepGoal("8,000")).toBe(8000);
    expect(parseStepGoal("")).toBeNull();
    expect(parseStepGoal("12")).toBeUndefined();
    expect(parseStepGoal("lots")).toBeUndefined();
    expect(parseStepGoal("900000")).toBeUndefined();
    expect(parseStepGoal("0x2710")).toBeUndefined();
    expect(parseStepGoal("1e4")).toBeUndefined();
    expect(parseStepGoal("8,0,0,0")).toBeUndefined();
    expect(setStepGoal(emptyBody(), 8000).stepGoal).toBe(8000);
    expect(setStepGoal(setStepGoal(emptyBody(), 8000), null).stepGoal).toBeNull();
  });
});

describe("the plan", () => {
  it("says what is planned on a day, by weekday", () => {
    const log = setPlan(emptyBody(), { 5: " Pull ", 1: "Push", 2: "" });
    expect(planFor(log, FRIDAY)).toBe("Pull");
    expect(planFor(log, "2026-10-26")).toBe("Push");
    expect(planFor(log, "2026-10-27")).toBe("");
    expect(log.plan).toEqual({ 1: "Push", 5: "Pull" });
  });

  it("keeps names short, and ignores days that are not days", () => {
    const log = setPlan(emptyBody(), { 5: "x".repeat(100), 9: "nope" } as never);
    expect(log.plan[5]).toHaveLength(40);
    expect(Object.keys(log.plan)).toEqual(["5"]);
  });
});

describe("days done", () => {
  it("ticks and unticks, without changing what it was given", () => {
    const before = emptyBody();
    const on = toggleDone(before, FRIDAY);
    expect(before.done).toEqual([]);
    expect(dayDone(on, FRIDAY)).toBe(true);
    expect(dayDone(toggleDone(on, FRIDAY), FRIDAY)).toBe(false);
  });

  it("counts a day with a lift as done, and each day once", () => {
    let log = toggleDone(emptyBody(), "2026-10-26");
    log = addLift(log, lift("l-1", "2026-10-26", 100));
    log = addLift(log, lift("l-2", "2026-10-28", 100));
    log = addLift(log, lift("l-3", "2026-10-20", 100));
    expect(weekDoneDays(log, FRIDAY)).toEqual(["2026-10-26", "2026-10-28"]);
  });
});

describe("lifts", () => {
  it("refuses what does not check", () => {
    const log = emptyBody();
    expect(addLift(log, { ...lift("l-1", FRIDAY, 100), exercise: "  " })).toBe(log);
    expect(addLift(log, lift("l-1", "soon", 100))).toBe(log);
    expect(addLift(log, lift("l-1", FRIDAY, -5))).toBe(log);
    expect(addLift(log, lift("l-1", FRIDAY, 100, 0))).toBe(log);
    expect(addLift(log, lift("l-1", FRIDAY, 100, 8, 99))).toBe(log);
    expect(addLift(log, lift("bad id!", FRIDAY, 100))).toBe(log);
  });

  it("allows a bodyweight exercise at zero kilos", () => {
    expect(addLift(emptyBody(), lift("l-1", FRIDAY, 0)).lifts).toHaveLength(1);
  });

  it("shows the last time for each exercise and how it moved", () => {
    let log = addLift(emptyBody(), lift("l-1", "2026-10-20", 100));
    log = addLift(log, lift("l-2", "2026-10-27", 102.5));
    log = addLift(log, { ...lift("l-3", "2026-10-28", 60), exercise: "Bench" });
    const rows = liftProgress(log);
    expect(rows.map((r) => r.exercise)).toEqual(["Bench", "Deadlift"]);
    expect(rows[1]).toMatchObject({ kg: 102.5, reps: 8, sets: 3, changeKg: 2.5 });
    expect(rows[0].changeKg).toBeNull();
  });

  it("treats the same exercise in another case as one", () => {
    let log = addLift(emptyBody(), lift("l-1", "2026-10-20", 100));
    log = addLift(log, { ...lift("l-2", "2026-10-27", 105), exercise: "deadlift " });
    expect(liftProgress(log)).toHaveLength(1);
    expect(liftProgress(log)[0].changeKg).toBe(5);
  });

  it("compares with an earlier day, not another set the same day", () => {
    let log = addLift(emptyBody(), lift("l-1", "2026-10-20", 100));
    log = addLift(log, lift("l-2", "2026-10-27", 110));
    log = addLift(log, lift("l-3", "2026-10-27", 90));
    expect(liftProgress(log)[0].changeKg).toBe(10);
    expect(liftProgress(log)[0].kg).toBe(110);
  });

  it("removes one", () => {
    const log = addLift(emptyBody(), lift("l-1", FRIDAY, 100));
    expect(removeLift(log, "l-1").lifts).toEqual([]);
  });
});

describe("what was saved", () => {
  it("reads a log from before the plan as a good one", () => {
    const old = JSON.stringify({ v: 1, connected: true, weeklyTarget: 4, weights: [{ at: 5, kg: 80 }] });
    const back = checkBody(old);
    expect(back.damaged).toBe(false);
    expect(back.log).toMatchObject({ connected: true, weeklyTarget: 4, stepGoal: null, plan: {}, done: [], lifts: [] });
  });

  it("drops bad parts and says so", () => {
    const raw = { ...emptyBody(), stepGoal: "lots", plan: { 5: 7, 9: "x" }, done: ["soon"], lifts: [{ id: "x" }] };
    const back = checkBody(JSON.stringify(raw));
    expect(back.damaged).toBe(true);
    expect(back.log).toMatchObject({ stepGoal: null, plan: {}, done: [], lifts: [] });
  });

  it("reads back everything it wrote", () => {
    let log = setPlan(setStepGoal(emptyBody(), 8000), { 5: "Pull" });
    log = toggleDone(addLift(log, lift("l-1", FRIDAY, 100)), FRIDAY);
    expect(checkBody(JSON.stringify(log))).toEqual({ log, damaged: false });
  });
});

describe("syncing", () => {
  function full() {
    let log = setPlan(setStepGoal({ ...emptyBody(), weeklyTarget: 4 }, 8000), { 5: "Pull" });
    log = toggleDone(addLift(addWeight(log, 82.4, 1000), lift("l-1", FRIDAY, 100)), FRIDAY);
    return log;
  }

  it("sends the plan, weights, lifts and days, and comes back the same", () => {
    const log = full();
    const records = bodyCollection.toRecords(log);
    expect(records.map((r) => r.kind).sort()).toEqual(["body.done", "body.lift", "body.plan", "body.weight"]);
    const back = bodyCollection.fromRecords(records.map((r) => ({ ...r, updated: 1 })) as never, { ...emptyBody(), connected: true });
    expect(back).toEqual({ ...log, connected: true });
  });

  it("keeps the newest weights when two devices' rows pass what a log holds, and loses nothing else", () => {
    const records = [
      ...Array.from({ length: 450 }, (_, i) => ({ kind: "body.weight", id: `w${i + 1}`, data: { at: i + 1, kg: 80 }, updated: 1 })),
      { kind: "body.plan", id: "plan", data: { weeklyTarget: 4, stepGoal: 8000, plan: { 5: "Pull" } }, updated: 1 },
      { kind: "body.lift", id: "l-1", data: lift("l-1", FRIDAY, 100), updated: 1 },
    ];
    const back = bodyCollection.fromRecords(records as never, { ...emptyBody(), connected: true });
    expect(back.weights).toHaveLength(400);
    expect(back.weights[0].at).toBe(450);
    expect(back).toMatchObject({ connected: true, stepGoal: 8000, weeklyTarget: 4, plan: { 5: "Pull" } });
    expect(back.lifts).toHaveLength(1);
  });

  it("never sends or takes whether this device connected its health store", () => {
    const records = bodyCollection.toRecords({ ...full(), connected: true });
    expect(JSON.stringify(records)).not.toContain("connected");
    const back = bodyCollection.fromRecords(records.map((r) => ({ ...r, updated: 1 })) as never, emptyBody());
    expect(back.connected).toBe(false);
  });

  it("sends nothing for an empty log", () => {
    expect(bodyCollection.toRecords(emptyBody())).toEqual([]);
  });
});
