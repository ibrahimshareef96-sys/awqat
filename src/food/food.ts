/**
 * Food: what the user ate, meal by meal, with the energy and the protein, carbohydrate and fat they typed, scanned from
 * a packet or took from an estimate. Goals are the user's own numbers. Every change returns a new log; a photo is a file
 * on this device, named here and never sent anywhere by this module.
 */
import { cleanShown } from "../talk/text.ts";
import { shiftKey } from "../agenda/days.ts";
import { validDay } from "../body/body.ts";

export const MEALS_MAX = 6000;
export const MEAL_NAME_MAX = 60;
export const KCAL_MAX = 10_000;
export const GRAMS_MAX = 1000;
export const KCAL_GOAL_MIN = 500;
export const KCAL_GOAL_MAX = 10_000;
export const PROTEIN_GOAL_MIN = 10;
export const PROTEIN_GOAL_MAX = 500;

export type MealSource = "typed" | "barcode" | "photo";

export interface Meal {
  id: string;
  /** The day it was eaten, on the user's clock. */
  day: string;
  at: number;
  name: string;
  kcal: number;
  /** Grams, to one decimal; null when not given. */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** "meals/<id>.jpg" in the app's own folder, on this device only. */
  photo: string | null;
  source: MealSource;
}

export interface FoodGoal {
  kcal: number | null;
  protein: number | null;
}

export interface FoodLog {
  v: 1;
  goal: FoodGoal;
  /** Newest first. */
  meals: Meal[];
}

export const emptyFood = (): FoodLog => ({ v: 1, goal: { kcal: null, protein: null }, meals: [] });

const MEAL_ID = /^[A-Za-z0-9-]{1,64}$/;
const MEAL_PHOTO = /^meals\/[A-Za-z0-9-]{1,64}\.jpg$/;
const SOURCES: readonly MealSource[] = ["typed", "barcode", "photo"];

export const isMealPhoto = (name: unknown): name is string => typeof name === "string" && MEAL_PHOTO.test(name);

const isAt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const isGrams = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= GRAMS_MAX;
const isKcal = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= KCAL_MAX;
const gramsOrNull = (n: unknown): n is number | null => n === null || isGrams(n);

export function validMeal(m: Partial<Meal> | null | undefined): m is Meal {
  return !!m && typeof m.id === "string" && MEAL_ID.test(m.id) && validDay(m.day) && isAt(m.at) &&
    typeof m.name === "string" && cleanShown(m.name, MEAL_NAME_MAX) !== "" && isKcal(m.kcal) && gramsOrNull(m.protein) &&
    gramsOrNull(m.carbs) && gramsOrNull(m.fat) && (m.photo === null || isMealPhoto(m.photo)) &&
    SOURCES.includes(m.source as MealSource);
}

const tidy = (m: Meal): Meal => ({ id: m.id, day: m.day, at: m.at, name: cleanShown(m.name, MEAL_NAME_MAX), kcal: m.kcal,
  protein: m.protein === null ? null : round1(m.protein), carbs: m.carbs === null ? null : round1(m.carbs),
  fat: m.fat === null ? null : round1(m.fat), photo: m.photo, source: m.source });

const newestFirst = (a: Meal, b: Meal): number => (a.day === b.day ? b.at - a.at : a.day < b.day ? 1 : -1);

/** Adds a meal (or puts it in place of one with the same id); the log is returned as it was when the meal is not one. */
export function addMeal(log: FoodLog, meal: Meal): FoodLog {
  if (!validMeal(meal)) return log;
  return { ...log, meals: [tidy(meal), ...log.meals.filter((m) => m.id !== meal.id)].sort(newestFirst).slice(0, MEALS_MAX) };
}

export function removeMeal(log: FoodLog, id: string): FoodLog {
  return { ...log, meals: log.meals.filter((m) => m.id !== id) };
}

/** Whole energy as typed ("450", "1,200"), or null when it is not one. */
export function parseKcal(text: string): number | null {
  const t = text.trim();
  if (!/^(\d{1,2}(,\d{3})|\d{1,5})$/.test(t)) return null;
  const n = Number(t.replaceAll(",", ""));
  return isKcal(n) ? n : null;
}

/** Grams as typed ("32", "32.5", "32,5", "32 g"): a number, null for an empty field, undefined when it is neither. */
export function parseGrams(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const m = /^(\d{1,4}(?:[.,]\d)?)\s*g?$/i.exec(t);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return isGrams(n) ? round1(n) : undefined;
}

const goalIn = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** A goal as typed: a whole number in range, null for an empty field, undefined when it is neither. */
function parseGoal(text: string, min: number, max: number): number | null | undefined {
  const t = text.trim().replaceAll(",", "");
  if (t === "") return null;
  if (!/^\d{1,5}$/.test(t)) return undefined;
  const n = Number(t);
  return goalIn(n, min, max) ? n : undefined;
}

export const parseKcalGoal = (text: string): number | null | undefined => parseGoal(text, KCAL_GOAL_MIN, KCAL_GOAL_MAX);
export const parseProteinGoal = (text: string): number | null | undefined => parseGoal(text, PROTEIN_GOAL_MIN, PROTEIN_GOAL_MAX);

export function setGoal(log: FoodLog, goal: FoodGoal): FoodLog {
  return { ...log, goal: { kcal: goalIn(goal.kcal, KCAL_GOAL_MIN, KCAL_GOAL_MAX) ? goal.kcal : null,
    protein: goalIn(goal.protein, PROTEIN_GOAL_MIN, PROTEIN_GOAL_MAX) ? goal.protein : null } };
}

export interface DayTotal {
  day: string;
  meals: number;
  kcal: number;
  /** Grams of what was given; a meal with none given adds nothing. */
  protein: number;
  carbs: number;
  fat: number;
}

export function mealsOn(log: FoodLog, day: string): Meal[] {
  return log.meals.filter((m) => m.day === day);
}

export function dayTotal(log: FoodLog, day: string): DayTotal {
  const meals = mealsOn(log, day);
  const sum = (pick: (m: Meal) => number | null): number => round1(meals.reduce((n, m) => n + (pick(m) ?? 0), 0));
  return { day, meals: meals.length, kcal: meals.reduce((n, m) => n + m.kcal, 0), protein: sum((m) => m.protein),
    carbs: sum((m) => m.carbs), fat: sum((m) => m.fat) };
}

/** The last `count` days ending today, oldest first. */
export function lastDays(log: FoodLog, today: string, count = 7): DayTotal[] {
  return Array.from({ length: count }, (_, i) => dayTotal(log, shiftKey(today, i - (count - 1))));
}

/** What 100 g holds, as a packet says it. */
export interface Per100 {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

/** The numbers for `grams` eaten of something known per 100 g, or null when that passes what a meal can hold. */
export function portion(per100: Per100, grams: number): Pick<Meal, "kcal" | "protein" | "carbs" | "fat"> | null {
  if (!(typeof grams === "number" && Number.isFinite(grams) && grams > 0 && grams <= 5000)) return null;
  const of = (n: number | null): number | null => (n === null ? null : round1((n * grams) / 100));
  const meal = { kcal: Math.round((per100.kcal * grams) / 100), protein: of(per100.protein), carbs: of(per100.carbs), fat: of(per100.fat) };
  return isKcal(meal.kcal) && gramsOrNull(meal.protein) && gramsOrNull(meal.carbs) && gramsOrNull(meal.fat) ? meal : null;
}

/** Every photo a meal holds, so the clean-up never deletes one in use. */
export function photosInUse(log: FoodLog): Set<string> {
  return new Set(log.meals.flatMap((m) => (m.photo ? [m.photo] : [])));
}

export interface PhotoFile { name: string; type: string; mtime: unknown }

/** Files in meals/ that can go: named like a meal photo, held by no meal, and older than `minAgeMs`. */
export function staleMealPhotos(files: readonly PhotoFile[], inUse: ReadonlySet<string>, now: number, minAgeMs: number): string[] {
  return files.flatMap((f) => {
    const name = `meals/${f.name}`;
    const mtime = typeof f.mtime === "number" && Number.isFinite(f.mtime) && f.mtime > 0 ? f.mtime : null;
    return f.type === "file" && isMealPhoto(name) && !inUse.has(name) && mtime !== null && now - mtime > minAgeMs ? [name] : [];
  });
}

/** The saved log read back; `damaged` when something was saved but is not one, or rows had to go. */
export function checkFood(json: string | null): { log: FoodLog; damaged: boolean } {
  if (json === null) return { log: emptyFood(), damaged: false };
  try {
    const raw = JSON.parse(json) as Partial<FoodLog> | null;
    if (!raw || raw.v !== 1 || !Array.isArray(raw.meals)) return { log: emptyFood(), damaged: true };
    const kept = raw.meals.slice(0, MEALS_MAX).filter((m): m is Meal => validMeal(m as Partial<Meal>)).map(tidy)
      .filter((m, i, all) => all.findIndex((o) => o.id === m.id) === i).sort(newestFirst);
    const goal = raw.goal ?? { kcal: null, protein: null };
    const log = setGoal({ v: 1, goal: { kcal: null, protein: null }, meals: kept }, goal as FoodGoal);
    const badGoal = typeof goal !== "object" || (goal.kcal != null && log.goal.kcal === null) || (goal.protein != null && log.goal.protein === null);
    return { log, damaged: kept.length !== raw.meals.length || badGoal };
  } catch {
    return { log: emptyFood(), damaged: true };
  }
}
