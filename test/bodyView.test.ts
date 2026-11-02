// Body's screen in each state: looking, not there, not connected, and connected with its four cards.
import { describe, expect, it } from "vitest";
import { addWeight, emptyBody, setConnected, setTarget } from "../src/body/body.ts";
import { summarise } from "../src/body/summary.ts";
import { addLift, setPlan, toggleDone } from "../src/body/training.ts";
import { bodyView, homeBodyCard, hoursMinutes, workoutCount, type BodyModel } from "../src/ui/bodyView.ts";

const TZ = "Asia/Dubai";
const TODAY = "2026-10-26";
const iso = (day: number, h: number) => new Date(Date.UTC(2026, 9, day, h - 4)).toISOString();

function model(extra: Partial<BodyModel> = {}): BodyModel {
  return { log: emptyBody(), available: { available: true }, denied: [], summary: null, readAt: null, reading: false,
    platform: "android", tz: TZ, today: TODAY, now: Date.UTC(2026, 9, 26, 8), busy: false, removeArmed: null, liftArmed: null, ...extra };
}

describe("the plan and the steps", () => {
  const steps = (today: number, average = 5000) => ({ steps: { today, average, days: [{ day: TODAY, steps: today }] } }) as never;
  const connected = { ...emptyBody(), connected: true };

  it("asks for the user's own goal, and shows it against today", () => {
    const none = bodyView(model({ log: connected, summary: { ...(steps(4210) as object), weight: null, sleep: null, workouts: null } as never }), "", "", "");
    expect(none).toContain("Choose a goal of your own");
    expect(none).toContain('data-form="step-goal"');
    const goal = bodyView(model({ log: { ...connected, stepGoal: 8000 }, summary: { ...(steps(4210) as object), weight: null, sleep: null, workouts: null } as never }), "", "", "");
    expect(goal).toContain("3,790 to go of 8,000");
    expect(goal).toContain('data-w="52"');
  });

  it("says when the goal is reached, and the bar stops at the end", () => {
    const html = bodyView(model({ log: { ...connected, stepGoal: 8000 }, summary: { ...(steps(9000) as object), weight: null, sleep: null, workouts: null } as never }), "", "", "");
    expect(html).toContain("Goal reached");
    expect(html).toContain('data-w="100"');
  });

  it("shows today's plan and each lift with what to try next, escaped", () => {
    const log = addLift(setPlan(connected, { 1: "<b>Pull</b>" }), { id: "l-1", date: TODAY, exercise: "<i>Row</i>", kg: 60, reps: 8, sets: 3 });
    const html = bodyView(model({ log }), "", "", "");
    expect(html).toContain("&lt;b&gt;Pull&lt;/b&gt;");
    expect(html).not.toContain("<i>Row</i>");
    expect(html).toContain("60 kg × 8 reps × 3 sets");
    expect(html).toContain("Next: 9 reps, or a little more weight");
  });

  it("offers the plan and the lifts before a health store is connected", () => {
    const html = bodyView(model(), "", "", "");
    expect(html).toContain('data-form="lift-add"');
    expect(html).toContain('data-form="workout-plan"');
  });

  it("counts a ticked day once, not again when the store saw a workout that day", () => {
    const log = toggleDone(connected, TODAY);
    expect(workoutCount({ log, summary: null, today: TODAY, tz: TZ })).toBe(1);
    const week = [{ at: Date.UTC(2026, 9, 26, 6), minutes: 30, label: "Run" }];
    const summary = { workouts: { week, count: 1, target: null, weekStart: TODAY } } as never;
    expect(workoutCount({ log, summary, today: TODAY, tz: TZ })).toBe(1);
  });

  it("leaves Home alone until there is something to say", () => {
    expect(homeBodyCard(model())).toBe("");
    const card = homeBodyCard(model({ log: { ...setPlan(connected, { 1: "Pull" }), stepGoal: 8000, weeklyTarget: 4 },
      summary: { ...(steps(4210) as object), weight: null, workouts: null, sleep: { last: { day: TODAY, minutes: 430 }, nights: [], average: 430 } } as never }));
    expect(card).toContain('data-go="body"');
    expect(card).toContain("4,210");
    expect(card).toContain("of 8,000 steps");
    expect(card).toContain("Today: Pull");
    expect(card).toContain("Sleep 7 h 10 m");
    expect(card).toContain("Workouts 0 of 4");
  });

  it("draws a dash on Home before the first reading", () => {
    expect(homeBodyCard(model({ log: connected }))).toContain("–");
  });
});

describe("the Body screen", () => {
  it("says it is looking before the health store has answered", () => {
    expect(bodyView(model({ available: null }), "", "", "")).toContain("Looking for Health Connect");
  });

  it("offers to open Health Connect when it is missing, and still takes typed weights", () => {
    const html = bodyView(model({ available: { available: false, reason: "not installed" } }), "", "", "");
    expect(html).toContain("HEALTH CONNECT IS NOT READY");
    expect(html).toContain('data-action="health-settings"');
    expect(html).toContain('data-form="weight-add"');
  });

  it("asks to connect, read only, naming the store each platform has", () => {
    expect(bodyView(model(), "", "", "")).toContain("Use Health Connect");
    expect(bodyView(model(), "", "", "")).toContain("Samsung Health and your scale");
    const ios = bodyView(model({ platform: "ios" }), "", "", "");
    expect(ios).toContain("Use Apple Health");
    expect(ios).not.toContain("Samsung Health");
  });

  it("shows weight, steps, sleep and workouts against the plan once connected", () => {
    const log = setTarget(addWeight(setConnected(emptyBody(), true), 81.6, Date.UTC(2026, 9, 26, 3)), 4);
    const summary = summarise({
      weight: [{ value: 82.6, startDate: iso(1, 8), endDate: iso(1, 8) }],
      steps: [{ startDate: iso(26, 0), value: 4321 }],
      sleep: [{ value: 480, startDate: iso(25, 23), endDate: iso(26, 7) }],
      workouts: [{ workoutType: "strengthTraining", duration: 3000, startDate: iso(26, 6) }],
    }, log.weights, TODAY, TZ, log.weeklyTarget);
    const html = bodyView(model({ log, summary, readAt: Date.UTC(2026, 9, 26, 8) }), "", "", "");
    expect(html).toContain("81.6 <span class=\"soft\">kg</span></div><p class=\"small\">26 Oct, typed");
    expect(html).toContain("−1.0 kg in 30 days");
    expect(html).toContain("4,321 <span class=\"soft\">today");
    expect(html).toContain("8 h 00 m <span class=\"soft\">last night");
    expect(html).toContain("1 of 4 this week");
    expect(html).toContain("Strength training");
    expect(html).toContain("Read from Health Connect at 12:00.");
  });

  it("says which kinds are not allowed, with a way to allow them", () => {
    const html = bodyView(model({ log: setConnected(emptyBody(), true), denied: ["sleep"],
      summary: summarise({ weight: null, steps: null, sleep: null, workouts: null }, [], TODAY, TZ, null) }), "", "", "");
    expect(html).toContain("does not allow your sleep yet");
    expect(html).not.toContain("does not allow your steps");
  });

  it("writes hours and minutes plainly", () => {
    expect(hoursMinutes(450)).toBe("7 h 30 m");
    expect(hoursMinutes(65)).toBe("1 h 05 m");
    expect(hoursMinutes(40)).toBe("40 m");
  });
});
