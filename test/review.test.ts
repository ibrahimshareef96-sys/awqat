// The Weekly Review and the morning brief: the user's records added up, each number on its own.
import { describe, expect, it } from "vitest";
import { emptyBody } from "../src/body/body.ts";
import { addLift, setPlan, setStepGoal, toggleDone } from "../src/body/training.ts";
import { emptyAdhkarLog } from "../src/faith/adhkar.ts";
import { logSession } from "../src/learn/learn.ts";
import { sampleLearn as seedLearn, TRADING_ID } from "./fixtures/learn.ts";
import { addCommitment, addIncome, addOwed, emptyMoney, setGoal } from "../src/money/money.ts";
import { emptyLog, setMark } from "../src/prayer/log.ts";
import { emptyQuranLog, logRead } from "../src/quran/log.ts";
import { morningBrief, weekReview, type ReviewInput } from "../src/review/week.ts";
import { briefCard, weekReviewView as reviewView } from "../src/ui/reviewView.ts";

const TODAY = "2026-10-30";

function input(patch: Partial<ReviewInput> = {}): ReviewInput {
  return { today: TODAY, prayerDay: TODAY, prayersDueToday: 5, prayers: emptyLog(), quran: emptyQuranLog(), adhkar: emptyAdhkarLog(), learn: seedLearn(), body: emptyBody(),
    health: null, money: emptyMoney(), ...patch };
}

describe("the week", () => {
  it("counts prayers, on time, late and not marked", () => {
    let prayers = setMark(emptyLog(), TODAY, "fajr", { status: "ontime", mosque: true });
    prayers = setMark(prayers, "2026-10-29", "asr", { status: "late", mosque: false });
    prayers = setMark(prayers, "2026-10-01", "asr", { status: "ontime", mosque: false });
    expect(weekReview(input({ prayers })).prayers).toEqual({ onTime: 1, late: 1, unmarked: 33, due: 35 });
  });

  it("does not count a prayer not yet due as unmarked, and keeps marks on the prayer day", () => {
    const prayers = setMark(emptyLog(), "2026-10-29", "isha", { status: "ontime", mosque: false });
    const before = weekReview(input({ prayers, today: "2026-10-30", prayerDay: "2026-10-29", prayersDueToday: 5 })).prayers;
    expect(before).toEqual({ onTime: 1, late: 0, unmarked: 34, due: 35 });
    expect(weekReview(input({ prayersDueToday: 1 })).prayers).toEqual({ onTime: 0, late: 0, unmarked: 31, due: 31 });
  });

  it("adds up Quran pages over the last seven days only", () => {
    let quran = logRead(emptyQuranLog(), "2026-10-01", 5);
    quran = logRead(quran, "2026-10-29", 9);
    quran = logRead(quran, TODAY, 10);
    expect(weekReview(input({ quran })).quran).toMatchObject({ pages: 5, days: 2 });
  });

  it("lists study with a target or minutes, against its target", () => {
    const { learn } = logSession(seedLearn(), { trackId: TRADING_ID, itemId: null, minutes: 40, note: "" }, TODAY);
    const study = weekReview(input({ learn })).study;
    expect(study.find((t) => t.name === "Trading")).toMatchObject({ minutes: 40 });
  });

  it("counts a training day once, ticked or lifted", () => {
    const body = addLift(toggleDone(emptyBody(), TODAY), { id: "l-1", date: TODAY, exercise: "Row", kg: 60, reps: 8, sets: 3 });
    expect(weekReview(input({ body })).workouts.days).toBe(1);
  });

  it("shows only lifts from these seven days", () => {
    const body = addLift(addLift(emptyBody(), { id: "l-1", date: "2026-10-01", exercise: "Old", kg: 60, reps: 8, sets: 3 }),
      { id: "l-2", date: TODAY, exercise: "New", kg: 60, reps: 8, sets: 3 });
    expect(weekReview(input({ body })).lifts.map((l) => l.exercise)).toEqual(["New"]);
  });

  it("counts days at the user's own step goal", () => {
    const body = setStepGoal(emptyBody(), 8000);
    // Oldest first, today last: today is still going, so only the full days count.
    const health = { steps: { today: 9000, average: 5000, days: [{ day: "2026-10-28", steps: 8500 }, { day: "2026-10-29", steps: 100 }, { day: TODAY, steps: 9000 }] }, weight: null, sleep: null, workouts: null };
    expect(weekReview(input({ body, health })).steps).toEqual({ average: 5000, goal: 8000, daysAtGoal: 1 });
  });
});

describe("the screen", () => {
  it("draws each number on its own, and no score", () => {
    let money = setGoal(emptyMoney(), 4_000_000, "AED");
    money = addIncome(money, { id: "a-1", date: TODAY, cents: 1_000_000, currency: "AED", from: "x" });
    money = addCommitment(money, { id: "c-1", name: "y", cents: 2_000_000, currency: "AED" });
    money = addOwed(money, { id: "o-1", who: "z", cents: 100, currency: "AED", due: "2026-10-01" });
    const html = reviewView(weekReview(input({ money })), "", "", "");
    expect(html).toContain("0 of 35");
    expect(html).toContain("AED 30,000 to go");
    expect(html).toContain("AED 10,000 short");
    expect(html).toContain("1 overdue");
    expect(html).toContain("Nothing here is a score");
  });

  it("leaves out Body's health lines before anything was read, and escapes names", () => {
    const body = addLift(emptyBody(), { id: "l-1", date: TODAY, exercise: "<i>Row</i>", kg: 60, reps: 8, sets: 3 });
    const html = reviewView(weekReview(input({ body })), "", "", "");
    expect(html).not.toContain("Steps a day");
    expect(html).not.toContain("<i>Row</i>");
  });
});

describe("the morning brief", () => {
  const brief = (patch: Partial<ReviewInput> = {}, meetings: string[] = []) => morningBrief({ ...input(patch), bookmark: 413, meetings });

  it("says where to read on, with the user's goal", () => {
    expect(brief()[0]).toBe("Quran: read on from page 413");
    expect(brief({ quran: { ...emptyQuranLog(), dailyGoal: 5 } })[0]).toContain("5 pages today");
  });

  it("puts meetings first, and today's training and step goal after", () => {
    const body = setStepGoal(setPlan(emptyBody(), { 5: "Pull" }), 8000);
    const lines = brief({ body }, ["09:00 Call"]);
    expect(lines[0]).toBe("09:00 Call");
    expect(lines).toContain("Training: Pull");
    expect(lines).toContain("Steps goal: 8,000");
  });

  it("names a late payment by count, with no amount", () => {
    const money = addOwed(emptyMoney(), { id: "o-1", who: "z", cents: 100, currency: "AED", due: "2026-10-01" });
    const lines = brief({ money });
    expect(lines).toContain("1 payment overdue to you");
    expect(lines.join(" ")).not.toContain("AED");
  });

  it("draws as a card, escaped, and nothing with no lines", () => {
    expect(briefCard([])).toBe("");
    expect(briefCard(["<b>x</b>"])).not.toContain("<b>x</b>");
  });
});
