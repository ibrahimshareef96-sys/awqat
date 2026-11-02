/**
 * What Body keeps on the device itself: weights typed in by hand (for a scale whose app cannot share with the phone's
 * health store), the workouts planned a week, and whether the health store was connected. The readings themselves
 * stay in Health Connect or Apple Health and are read again each time, never copied here.
 */
import { cleanShown } from "../talk/text.ts";

export const KG_MIN = 20;
export const KG_MAX = 400;
/** Typed weights kept, newest first: well over a year of daily weigh-ins. */
export const WEIGHTS_MAX = 400;
export const TARGET_MAX = 14;
export const LIFTS_MAX = 5000;
export const DONE_MAX = 800;
export const NAME_MAX = 40;

export interface TypedWeight {
  at: number;
  kg: number;
}

export interface Lift {
  id: string;
  date: string;
  exercise: string;
  kg: number;
  reps: number;
  sets: number;
}

export interface BodyLog {
  v: 1;
  /** Connect was tapped, and the health store was asked for access. */
  connected: boolean;
  /** Workouts planned a week, or null for none set. */
  weeklyTarget: number | null;
  /** Newest first. */
  weights: TypedWeight[];
  /** Steps a day, or null for none set. */
  stepGoal: number | null;
  /** What is planned by weekday (0 is Sunday); a day with nothing planned has no entry. */
  plan: Record<number, string>;
  /** Days ticked done. */
  done: string[];
  /** Newest first. */
  lifts: Lift[];
}

export const emptyBody = (): BodyLog => ({ v: 1, connected: false, weeklyTarget: null, weights: [], stepGoal: null, plan: {}, done: [], lifts: [] });

const LIFT_ID = /^[A-Za-z0-9-]{1,64}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const STEP_GOAL_LIMITS = { min: 1000, max: 100_000 };
const LIFT_KG_MAX = 1000;
const REPS_MAX = 1000;
const SETS_MAX = 50;

export function validDay(day: unknown): day is string {
  return typeof day === "string" && DAY.test(day) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
}

export function validLift(l: Partial<Lift> | null | undefined): l is Lift {
  const whole = (n: unknown, max: number): boolean => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  return !!l && typeof l.id === "string" && LIFT_ID.test(l.id) && validDay(l.date) && typeof l.exercise === "string" &&
    cleanShown(l.exercise, NAME_MAX) !== "" && typeof l.kg === "number" && Number.isFinite(l.kg) && l.kg >= 0 && l.kg <= LIFT_KG_MAX &&
    whole(l.reps, REPS_MAX) && whole(l.sets, SETS_MAX);
}

/** The plan as read back: days 0 to 6 with a name; `bad` when something else was there. */
function checkPlan(raw: unknown): { plan: Record<number, string>; bad: boolean } {
  if (raw === undefined) return { plan: {}, bad: false };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { plan: {}, bad: true };
  const entries = Object.entries(raw);
  const kept = entries.filter(([day, name]) => /^[0-6]$/.test(day) && cleanShown(name, NAME_MAX) !== "")
    .map(([day, name]) => [day, cleanShown(name, NAME_MAX)]);
  return { plan: Object.fromEntries(kept), bad: kept.length !== entries.length };
}

/** A list as read back: at most `max` rows that pass; `bad` when any had to go. */
function checkList<T>(raw: unknown, max: number, ok: (row: unknown) => row is T): { rows: T[]; bad: boolean } {
  if (raw === undefined) return { rows: [], bad: false };
  if (!Array.isArray(raw)) return { rows: [], bad: true };
  const rows = raw.slice(0, max).filter(ok);
  return { rows, bad: rows.length !== raw.length };
}

/** A weight as typed ("82.4", "82,4", "82.4 kg"), to one decimal, or null when it is not a body weight. */
export function parseKg(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const m = /^\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg)?\s*$/i.exec(text);
  if (!m) return null;
  const kg = Math.round(Number(m[1].replace(",", ".")) * 10) / 10;
  return kg >= KG_MIN && kg <= KG_MAX ? kg : null;
}

const isKg = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= KG_MIN && n <= KG_MAX;
const isAt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

export function addWeight(log: BodyLog, kg: number, at: number): BodyLog {
  if (!isKg(kg) || !isAt(at)) return log;
  const weights = [{ at, kg }, ...log.weights.filter((w) => w.at !== at)].sort((a, b) => b.at - a.at)
    .slice(0, WEIGHTS_MAX);
  return { ...log, weights };
}

export function removeWeight(log: BodyLog, at: number): BodyLog {
  return { ...log, weights: log.weights.filter((w) => w.at !== at) };
}

/** A weekly target from what was typed: 1 to 14, or null to have none. */
export function setTarget(log: BodyLog, value: unknown): BodyLog {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
  const weeklyTarget = Number.isInteger(n) && n >= 1 && n <= TARGET_MAX ? n : null;
  return { ...log, weeklyTarget };
}

export function setConnected(log: BodyLog, connected: boolean): BodyLog {
  return { ...log, connected };
}

/** The saved log read back; `damaged` when something was saved but is not one. */
export function checkBody(json: string | null): { log: BodyLog; damaged: boolean } {
  if (json === null) return { log: emptyBody(), damaged: false };
  try {
    const raw = JSON.parse(json) as Partial<BodyLog> | null;
    if (!raw || raw.v !== 1 || !Array.isArray(raw.weights) || raw.weights.length > WEIGHTS_MAX) {
      return { log: emptyBody(), damaged: true };
    }
    const weights = raw.weights.filter((w): w is TypedWeight => isAt((w as TypedWeight)?.at) && isKg((w as TypedWeight)?.kg))
      .map((w) => ({ at: w.at, kg: Math.round(w.kg * 10) / 10 }))
      .filter((w, i, all) => all.findIndex((o) => o.at === w.at) === i)
      .sort((a, b) => b.at - a.at);
    const target = raw.weeklyTarget;
    const weeklyTarget = typeof target === "number" && Number.isInteger(target) && target >= 1 && target <= TARGET_MAX
      ? target : null;
    const goal = raw.stepGoal;
    const stepGoal = typeof goal === "number" && Number.isInteger(goal) && goal >= STEP_GOAL_LIMITS.min && goal <= STEP_GOAL_LIMITS.max
      ? goal : null;
    const plan = checkPlan(raw.plan);
    // Newest first in every copy, so a list at its limit lets go of the oldest day, whatever order it arrived in.
    const done = checkList(Array.isArray(raw.done) ? [...raw.done].sort().reverse() : raw.done, DONE_MAX, validDay);
    const lifts = checkList(raw.lifts, LIFTS_MAX, (l): l is Lift => validLift(l as Partial<Lift>));
    const log: BodyLog = { v: 1, connected: raw.connected === true, weeklyTarget, weights, stepGoal, plan: plan.plan, done: done.rows,
      lifts: [...lifts.rows].map((l) => ({ id: l.id, date: l.date, exercise: cleanShown(l.exercise, NAME_MAX), kg: l.kg, reps: l.reps, sets: l.sets }))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) };
    const badGoal = goal !== undefined && goal !== null && stepGoal === null;
    return { log, damaged: weights.length !== raw.weights.length || (target !== null && weeklyTarget === null) || badGoal ||
      plan.bad || done.bad || lifts.bad };
  } catch {
    return { log: emptyBody(), damaged: true };
  }
}
