/**
 * Body's plan: a daily step goal, what is planned each weekday, the days the user ticked done, and the lifts the user logs, which is
 * how progress shows. Every change returns a new log. Weekdays are numbered as Date numbers them: 0 is Sunday.
 */
import { shiftKey } from "../agenda/days.ts";
import { weekStart, WEEK_DAYS } from "./summary.ts";
import { cleanShown } from "../talk/text.ts";
import { DONE_MAX, LIFTS_MAX, NAME_MAX, type BodyLog, type Lift, validDay, validLift } from "./body.ts";

export const STEP_GOAL_MIN = 1000;
export const STEP_GOAL_MAX = 100_000;

/** A goal as typed: a number, null for none, undefined when it cannot be one. */
export function parseStepGoal(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+)$/.test(t)) return undefined;
  const n = Number(t.replaceAll(",", ""));
  return Number.isInteger(n) && n >= STEP_GOAL_MIN && n <= STEP_GOAL_MAX ? n : undefined;
}

export function setStepGoal(log: BodyLog, goal: number | null): BodyLog {
  return { ...log, stepGoal: goal };
}

/** The whole week's plan: an empty name is a day with nothing planned. */
export function setPlan(log: BodyLog, plan: Readonly<Record<number, string>>): BodyLog {
  const days = Object.entries(plan).flatMap(([day, name]) => {
    const text = cleanShown(name, NAME_MAX);
    return /^[0-6]$/.test(day) && text ? [[day, text]] : [];
  });
  return { ...log, plan: Object.fromEntries(days) };
}

const weekdayOf = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay();

export function planFor(log: BodyLog, day: string): string {
  return log.plan[weekdayOf(day)] ?? "";
}

export function dayDone(log: BodyLog, day: string): boolean {
  return log.done.includes(day);
}

export function toggleDone(log: BodyLog, day: string): BodyLog {
  if (!validDay(day)) return log;
  const done = dayDone(log, day) ? log.done.filter((d) => d !== day) : [day, ...log.done];
  return { ...log, done: done.slice(0, DONE_MAX) };
}

/** This week's days with a tick or a lift, each once, oldest first. */
export function weekDoneDays(log: BodyLog, today: string): string[] {
  const first = weekStart(today);
  const last = shiftKey(first, WEEK_DAYS);
  const days = new Set([...log.done, ...log.lifts.map((l) => l.date)]);
  return [...days].filter((d) => d >= first && d < last).sort();
}

export function addLift(log: BodyLog, lift: Lift): BodyLog {
  if (!validLift(lift)) return log;
  const clean = { ...lift, exercise: cleanShown(lift.exercise, NAME_MAX) };
  return { ...log, lifts: [clean, ...log.lifts.filter((l) => l.id !== lift.id)].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, LIFTS_MAX) };
}

export function removeLift(log: BodyLog, id: string): BodyLog {
  return { ...log, lifts: log.lifts.filter((l) => l.id !== id) };
}

export interface LiftRow extends Lift {
  /** Heaviest on this day against the heaviest on the last day before it; null with no earlier day. */
  changeKg: number | null;
}

const exerciseKey = (name: string): string => name.trim().toLowerCase();

/** Each exercise's last day, its heaviest set that day, newest first. */
export function liftProgress(log: BodyLog): LiftRow[] {
  const byExercise = new Map<string, Lift[]>();
  for (const lift of log.lifts) {
    const key = exerciseKey(lift.exercise);
    byExercise.set(key, [...(byExercise.get(key) ?? []), lift]);
  }
  const rows = [...byExercise.values()].map((lifts): LiftRow => {
    const lastDay = lifts.reduce((day, l) => (l.date > day ? l.date : day), "");
    const top = (day: string): Lift => lifts.filter((l) => l.date === day).reduce((a, b) => (b.kg > a.kg ? b : a));
    const best = top(lastDay);
    const earlier = lifts.reduce((day, l) => (l.date < lastDay && l.date > day ? l.date : day), "");
    return { ...best, changeKg: earlier ? Math.round((best.kg - top(earlier).kg) * 10) / 10 : null };
  });
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.exercise < b.exercise ? -1 : 1));
}
