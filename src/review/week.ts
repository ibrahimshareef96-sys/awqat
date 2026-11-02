/**
 * The Weekly Review and the morning brief: what the user's own records say, added up, to read when they choose.
 * Separate numbers, never one score, and no pushes. Pure.
 */
import type { BodyLog } from "../body/body.ts";
import type { BodySummary } from "../body/summary.ts";
import { liftProgress, planFor, weekDoneDays } from "../body/training.ts";
import { adhkarWeek, type AdhkarLog } from "../faith/adhkar.ts";
import { activeTracks, nextItem, weekMinutes, type Learn } from "../learn/learn.ts";
import { dueLessons } from "../learn/review.ts";
import { monthSummary, type Money, type MoneySummary } from "../money/money.ts";
import { weekDots, type PrayerLog } from "../prayer/log.ts";
import { PRAYERS } from "../prayer/times.ts";
import { pagesOn, shiftDay, type QuranLog } from "../quran/log.ts";

const DAYS = 7;

export interface ReviewInput {
  today: string;
  /** The prayer day (Fajr to Fajr), which prayer marks and adhkar belong to. */
  prayerDay: string;
  /** How many of that day's prayers have come in: one not yet due is not counted as missed. */
  prayersDueToday: number;
  prayers: PrayerLog;
  quran: QuranLog;
  adhkar: AdhkarLog;
  learn: Learn;
  body: BodyLog;
  health: BodySummary | null;
  money: Money;
}

export interface WeekReview {
  prayers: { onTime: number; late: number; unmarked: number; due: number };
  quran: { pages: number; days: number; goal: number };
  adhkar: { morning: number; evening: number };
  study: { name: string; minutes: number; target: number }[];
  lessonsDue: number;
  steps: { average: number; goal: number | null; daysAtGoal: number } | null;
  sleepAverage: number | null;
  workouts: { days: number; target: number | null };
  /** Each exercise last done in these seven days and how it moved. */
  lifts: { exercise: string; kg: number; reps: number; sets: number; changeKg: number | null }[];
  money: MoneySummary;
}

export function weekReview(input: ReviewInput): WeekReview {
  const { today, body, health } = input;
  const dots = weekDots(input.prayers, input.prayerDay, DAYS).flatMap((d) => d.dots);
  const days = Array.from({ length: DAYS }, (_, i) => shiftDay(today, -i));
  const pages = days.map((d) => pagesOn(input.quran, d));
  const adhkar = adhkarWeek(input.adhkar, input.prayerDay);
  const from = shiftDay(today, -(DAYS - 1));
  const steps = health?.steps;
  // Full days only, as the average is: today is still going.
  const past = (steps?.days ?? []).slice(0, -1);
  const onTime = dots.filter((d) => d === "ontime").length;
  const late = dots.filter((d) => d === "late").length;
  const due = (DAYS - 1) * PRAYERS.length + input.prayersDueToday;
  return {
    prayers: { onTime, late, unmarked: Math.max(0, due - onTime - late), due },
    quran: { pages: pages.reduce((a, b) => a + b, 0), days: pages.filter((p) => p > 0).length, goal: input.quran.dailyGoal },
    adhkar: { morning: adhkar.filter((d) => d.morning).length, evening: adhkar.filter((d) => d.evening).length },
    study: activeTracks(input.learn).map((t) => ({ name: t.name, minutes: weekMinutes(input.learn, today, t.id), target: t.weeklyMinutes }))
      .filter((t) => t.minutes > 0 || t.target > 0),
    lessonsDue: dueLessons(input.learn, today).length,
    steps: steps ? { average: steps.average, goal: body.stepGoal,
      daysAtGoal: body.stepGoal === null ? 0 : past.filter((d) => d.steps >= (body.stepGoal as number)).length } : null,
    sleepAverage: health?.sleep?.average ?? null,
    workouts: { days: weekDoneDays(body, today).length, target: body.weeklyTarget },
    lifts: liftProgress(body).filter((l) => l.date >= from).map(({ exercise, kg, reps, sets, changeKg }) => ({ exercise, kg, reps, sets, changeKg })),
    money: monthSummary(input.money, today),
  };
}

export interface BriefInput extends ReviewInput {
  bookmark: number;
  /** Today's meetings still to come, as words. */
  meetings: readonly string[];
}

/** The morning's few facts, each on one line; nothing the user has not set up. */
export function morningBrief(input: BriefInput): string[] {
  const { today, body, quran, learn } = input;
  const money = monthSummary(input.money, today);
  const study = activeTracks(learn).flatMap((t) => {
    const item = nextItem(learn, t.id);
    return t.weeklyMinutes > 0 && item && weekMinutes(learn, today, t.id) < t.weeklyMinutes ? [`${t.name} next: ${item.title}`] : [];
  }).slice(0, 2);
  const due = dueLessons(learn, today).length;
  const plan = planFor(body, today);
  return [
    ...input.meetings.slice(0, 3),
    `Quran: read on from page ${input.bookmark}${quran.dailyGoal ? `, ${quran.dailyGoal} pages today` : ""}`,
    ...study,
    ...(due ? [`${due} of your own note${due === 1 ? "" : "s"} due for review`] : []),
    ...(plan ? [`Training: ${plan}`] : []),
    ...(body.stepGoal ? [`Steps goal: ${body.stepGoal.toLocaleString("en-GB")}`] : []),
    ...(money.overdue ? [`${money.overdue} payment${money.overdue === 1 ? "" : "s"} overdue to you`] : []),
  ];
}
