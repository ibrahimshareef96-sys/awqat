/**
 * Body's numbers from what the health store gave: the weight trend over 30 days (typed weights included), steps by
 * day, sleep by night, and this week's workouts against the plan. Pure: the readings come in, the summary goes out.
 */
import { daysFrom, keyOf, shiftKey, startOfDay } from "../agenda/days.ts";
import type { TypedWeight } from "./body.ts";
import { KG_MAX, KG_MIN } from "./body.ts";

export const TREND_DAYS = 30;
export const WEEK_DAYS = 7;
const DAY_MS = 86400000;
/** A night belongs to the day it ends on, counting from 18:00 the evening before to 18:00 that day. */
const NIGHT_SHIFT_MS = 6 * 3600000;

export interface Sample {
  value: number;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sleepState?: string;
  stages?: { stage: string; durationMinutes: number; startDate?: string; endDate?: string }[];
}

export interface Bucket {
  startDate: string;
  value: number;
}

export interface WorkoutSample {
  workoutType: string;
  duration: number;
  startDate: string;
  sourceName?: string;
}

export interface RawHealth {
  weight: Sample[] | null;
  steps: Bucket[] | null;
  sleep: Sample[] | null;
  workouts: WorkoutSample[] | null;
}

export interface WeightPoint {
  at: number;
  kg: number;
  typed: boolean;
}

export interface BodySummary {
  weight: { latest: WeightPoint | null; change: number | null; points: WeightPoint[] } | null;
  steps: { today: number; days: { day: string; steps: number }[]; average: number } | null;
  sleep: { last: { day: string; minutes: number } | null; nights: { day: string; minutes: number }[];
    average: number | null } | null;
  workouts: { week: { at: number; minutes: number; label: string }[]; count: number; target: number | null;
    weekStart: string } | null;
}

const time = (iso: string): number => Date.parse(iso);
const real = (n: number): boolean => Number.isFinite(n);

/** The week's first day: Monday. */
export function weekStart(today: string): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shiftKey(today, -((weekday + 6) % 7));
}

/** The last weight of each day in the 30 days to today, typed and read together, oldest first. */
export function weightPoints(read: Sample[], typed: readonly TypedWeight[], today: string, tz: string): WeightPoint[] {
  const from = startOfDay(shiftKey(today, -(TREND_DAYS - 1)), tz);
  const to = startOfDay(shiftKey(today, 1), tz);
  const all: WeightPoint[] = [
    ...read.map((s) => ({ at: time(s.startDate), kg: s.value, typed: false })),
    ...typed.map((w) => ({ at: w.at, kg: w.kg, typed: true })),
  ].filter((p) => real(p.at) && p.at >= from && p.at < to && p.kg >= KG_MIN && p.kg <= KG_MAX);
  const byDay = new Map<string, WeightPoint>();
  for (const p of all.sort((a, b) => a.at - b.at)) byDay.set(keyOf(p.at, tz), { ...p, kg: Math.round(p.kg * 10) / 10 });
  return [...byDay.values()];
}

export function weightSummary(points: WeightPoint[]): BodySummary["weight"] {
  if (points.length === 0) return { latest: null, change: null, points };
  const latest = points[points.length - 1];
  const change = points.length > 1 ? Math.round((latest.kg - points[0].kg) * 10) / 10 : null;
  return { latest, change, points };
}

/** Steps on each of the last seven days, today last; a day with no reading counts as none. */
export function stepsSummary(buckets: Bucket[], today: string, tz: string): BodySummary["steps"] {
  const days = daysFrom(shiftKey(today, -(WEEK_DAYS - 1)), WEEK_DAYS);
  const totals = new Map<string, number>();
  for (const b of buckets) {
    const at = time(b.startDate);
    if (!real(at) || !real(b.value) || b.value < 0) continue;
    // A day's bucket can begin a moment before midnight in another zone; the middle of the bucket names the day.
    const day = keyOf(at + DAY_MS / 2, tz);
    totals.set(day, (totals.get(day) ?? 0) + Math.round(b.value));
  }
  const list = days.map((day) => ({ day, steps: totals.get(day) ?? 0 }));
  const past = list.slice(0, -1);
  const average = Math.round(past.reduce((sum, d) => sum + d.steps, 0) / Math.max(1, past.length));
  return { today: list[list.length - 1].steps, days: list, average };
}

const awake = (state: string | undefined): boolean => state === "awake" || state === "inBed";

/**
 * The stretches asleep in one sample, as instants: its stages (awake and in bed left out), else the whole sample.
 * A stage with no times can only be counted by its length (`loose` minutes), not laid against the others.
 */
function asleep(s: Sample): { spans: [number, number][]; loose: number; end: number } {
  const end = time(s.endDate);
  const spans: [number, number][] = [];
  let loose = 0;
  if (s.stages && s.stages.length > 0) {
    for (const st of s.stages.filter((x) => !awake(x.stage))) {
      const from = time(st.startDate ?? "");
      const to = time(st.endDate ?? "");
      if (real(from) && real(to) && to > from) spans.push([from, to]);
      else if (real(st.durationMinutes) && st.durationMinutes > 0) loose += st.durationMinutes;
    }
  } else if (!awake(s.sleepState)) {
    const from = time(s.startDate);
    if (real(from) && real(end) && end > from) spans.push([from, end]);
    else if (real(s.value) && s.value > 0) loose += s.value;
  }
  return { spans, loose, end };
}

/** Minutes covered by stretches that may overlap (two sources writing the same night count once). */
function coveredMinutes(spans: [number, number][]): number {
  let total = 0;
  let reach = -Infinity;
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (to <= reach) continue;
    total += to - Math.max(from, reach);
    reach = to;
  }
  return total / 60000;
}

/** Sleep by night for the last seven nights, last night last. */
export function sleepSummary(samples: Sample[], today: string, tz: string): BodySummary["sleep"] {
  const days = daysFrom(shiftKey(today, -(WEEK_DAYS - 1)), WEEK_DAYS);
  const byNight = new Map<string, { spans: [number, number][]; loose: number }>();
  for (const s of samples) {
    const { spans, loose, end } = asleep(s);
    if (!real(end)) continue;
    const day = keyOf(end + NIGHT_SHIFT_MS, tz);
    const night = byNight.get(day) ?? { spans: [], loose: 0 };
    byNight.set(day, { spans: [...night.spans, ...spans], loose: night.loose + loose });
  }
  const minutes = (day: string) => {
    const night = byNight.get(day);
    return night ? Math.min(24 * 60, coveredMinutes(night.spans) + night.loose) : 0;
  };
  const nights = days.map((day) => ({ day, minutes: Math.round(minutes(day)) }));
  const slept = nights.filter((n) => n.minutes > 0);
  const lastNight = nights[nights.length - 1];
  return {
    last: lastNight.minutes > 0 ? lastNight : null,
    nights,
    average: slept.length ? Math.round(slept.reduce((sum, n) => sum + n.minutes, 0) / slept.length) : null,
  };
}

/** "strengthTraining" as "Strength training"; an unnamed type as "Workout". */
export function workoutLabel(type: string): string {
  if (!type || type === "other") return "Workout";
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function workoutsSummary(workouts: WorkoutSample[], today: string, tz: string, target: number | null):
  BodySummary["workouts"] {
  const first = weekStart(today);
  const from = startOfDay(first, tz);
  const to = startOfDay(shiftKey(first, WEEK_DAYS), tz);
  const week = workouts.map((w) => ({ at: time(w.startDate), minutes: Math.round((real(w.duration) ? w.duration : 0) / 60),
    label: workoutLabel(w.workoutType) }))
    .filter((w) => real(w.at) && w.at >= from && w.at < to)
    .sort((a, b) => a.at - b.at);
  return { week, count: week.length, target, weekStart: first };
}

/** Everything Body shows, from whatever the health store could give (a part it could not give stays null). */
export function summarise(raw: RawHealth, typed: readonly TypedWeight[], today: string, tz: string,
  target: number | null): BodySummary {
  return {
    weight: weightSummary(weightPoints(raw.weight ?? [], typed, today, tz)),
    steps: raw.steps ? stepsSummary(raw.steps, today, tz) : null,
    sleep: raw.sleep ? sleepSummary(raw.sleep, today, tz) : null,
    workouts: raw.workouts ? workoutsSummary(raw.workouts, today, tz, target) : null,
  };
}
