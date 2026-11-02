/**
 * The muraja'ah (revision) plan: the juz the user has memorised and how many to revise a day. Each day it gives the juz
 * revised longest ago (one never revised comes first, then juz order), so a missed day never breaks the plan, and it
 * points at the pages where the user's marked mistakes gather. Nothing about a cycle is stored: only the choice the user made.
 */
import { JUZ_START_PAGE, PAGES } from "./data.ts";
import { shiftDay } from "./log.ts";
import type { MushafMarks } from "./marks.ts";
import { pageOfAyah } from "./pages.ts";

export const PER_DAY_CHOICES = [1, 2, 3, 5] as const;

export interface MurajaahPlan {
  v: 1;
  /** Juz revised each day, one of PER_DAY_CHOICES. */
  perDay: number;
  /** The juz the user has memorised, ascending. */
  juz: number[];
}

export interface TodaysRevision {
  /** Today's juz still to revise, in the order to take them. */
  todo: number[];
  /** Juz of the plan already revised today. */
  doneToday: number[];
  /** Today's share is revised. */
  done: boolean;
  /** Once today is done: the juz that would come next, for a day the user wants to keep going. */
  next: number | null;
  /** Juz of the plan revised within the last `cycle` days, today included. */
  fresh: number;
  /** Days one turn through the plan takes. */
  cycle: number;
}

const isJuz = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 30;
const isPerDay = (n: unknown): n is number => (PER_DAY_CHOICES as readonly unknown[]).includes(n);

/** A plan from what the user chose, or null when the choice is not one (no juz, a juz that does not exist, an odd count). */
export function makePlan(juz: readonly unknown[], perDay: unknown): MurajaahPlan | null {
  if (!isPerDay(perDay) || juz.length === 0 || !juz.every(isJuz)) return null;
  return { v: 1, perDay, juz: [...new Set(juz as number[])].sort((a, b) => a - b) };
}

/** A saved plan read back; `damaged` when something was saved but is not a plan. */
export function checkPlan(json: string | null): { plan: MurajaahPlan | null; damaged: boolean } {
  if (json === null) return { plan: null, damaged: false };
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null;
    const plan = raw && raw.v === 1 && Array.isArray(raw.juz) && raw.juz.length <= 30 ? makePlan(raw.juz, raw.perDay) : null;
    return { plan, damaged: plan === null };
  } catch {
    return { plan: null, damaged: true };
  }
}

/**
 * What to revise on a day: the juz already revised that day count toward it, and the rest of its share are the juz
 * revised longest ago. Works for tomorrow too (nothing is revised tomorrow yet, and today's juz go to the back).
 */
export function todaysRevision(plan: MurajaahPlan, revised: Readonly<Record<number, string>>, day: string): TodaysRevision {
  const cycle = Math.ceil(plan.juz.length / plan.perDay);
  const doneToday = plan.juz.filter((j) => revised[j] === day);
  const waiting = plan.juz.filter((j) => revised[j] !== day)
    .sort((a, b) => (revised[a] ?? "").localeCompare(revised[b] ?? "") || a - b);
  // A plan smaller than a day's share is done once all of it is revised.
  const share = Math.max(0, Math.min(plan.perDay, plan.juz.length) - doneToday.length);
  const freshFrom = shiftDay(day, -(cycle - 1));
  return {
    todo: waiting.slice(0, share),
    doneToday,
    done: share === 0,
    next: share === 0 ? (waiting[0] ?? null) : null,
    fresh: plan.juz.filter((j) => revised[j] !== undefined && revised[j] >= freshFrom && revised[j] <= day).length,
    cycle,
  };
}

/** The day's revision in a line, for Home and the home-screen widget: what is left, or that it is done. */
export function revisionLine(plan: MurajaahPlan, revised: Readonly<Record<number, string>>, day: string): string {
  const t = todaysRevision(plan, revised, day);
  return t.done ? "Revision done today" : `Revise Juz ${t.todo.join(", ")}`;
}

/** The first and last page of a juz in the Madinah mushaf (the same pages in the 1405 and 1421 prints). */
export function juzPages(juz: number): { first: number; last: number } {
  const first = JUZ_START_PAGE[juz - 1];
  const after = JUZ_START_PAGE[juz];
  return { first, last: after === undefined ? PAGES : after - 1 };
}

/** The juz's pages with marked mistakes, most first (then in page order), at most `limit` of them. */
export function weakPages(marks: MushafMarks, juz: number, limit = 3): { page: number; mistakes: number }[] {
  const { first, last } = juzPages(juz);
  const byPage = new Map<number, number>();
  for (const [key, mistake] of Object.entries(marks.mistakes)) {
    const [sura, aya] = key.split(":").map(Number);
    const page = pageOfAyah(sura, aya);
    if (page !== null && page >= first && page <= last) byPage.set(page, (byPage.get(page) ?? 0) + mistake.count);
  }
  return [...byPage].map(([page, mistakes]) => ({ page, mistakes }))
    .sort((a, b) => b.mistakes - a.mistakes || a.page - b.page).slice(0, limit);
}
