/**
 * A meal while it is still on the form: what was typed so far, the photo taken for it, the packet scanned for it. Kept
 * in memory only. Turning it into a meal is pure, so every way a form can be wrong is tested without a phone.
 */
import { cleanShown } from "../talk/text.ts";
import { MEAL_NAME_MAX, parseGrams, parseKcal, portion, type Meal, type MealSource } from "./food.ts";
import type { Packet } from "./packet.ts";

export interface FoodDraft {
  /** "meals/<id>.jpg", already on disk; removed again if the draft is let go. */
  photo: string | null;
  packet: Packet | null;
  name: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  /** Grams eaten of a scanned packet. */
  grams: string;
  /** The numbers came from the user's server looking at the photo: shown as an estimate to check. */
  estimated: boolean;
}

export const emptyDraft = (): FoodDraft => ({ photo: null, packet: null, name: "", kcal: "", protein: "", carbs: "", fat: "",
  grams: "", estimated: false });

export type DraftFields = Pick<FoodDraft, "name" | "kcal" | "protein" | "carbs" | "fat" | "grams">;

export const FIELD_NAMES: readonly (keyof DraftFields)[] = ["name", "kcal", "protein", "carbs", "fat", "grams"];

/** What the form holds now, laid over the draft: a field the form does not have keeps the draft's own. */
export function withFields(draft: FoodDraft, read: (name: keyof DraftFields) => string | null): FoodDraft {
  const typed = Object.fromEntries(FIELD_NAMES.flatMap((name) => {
    const value = read(name);
    return value === null ? [] : [[name, value.slice(0, 80)]];
  }));
  return { ...draft, ...typed };
}

/** A packet just scanned: its name, and one serving (or 100 g) to start from. */
export function withPacket(draft: FoodDraft, packet: Packet): FoodDraft {
  return { ...draft, packet, name: packet.name, grams: String(packet.serving ?? 100), kcal: "", protein: "", carbs: "", fat: "",
    estimated: false };
}

export type DraftProblem = "name" | "kcal" | "grams" | "amount";
export type DraftResult = { meal: Meal } | { problem: DraftProblem };

/** The draft as a meal, or what is wrong with it. `id`, `day` and `at` are the caller's: this stays pure. */
export function mealFromDraft(draft: FoodDraft, id: string, day: string, at: number): DraftResult {
  const name = cleanShown(draft.name, MEAL_NAME_MAX);
  if (name === "") return { problem: "name" };
  const source: MealSource = draft.packet ? "barcode" : draft.photo ? "photo" : "typed";
  const base = { id, day, at, name, photo: draft.photo, source };
  if (draft.packet) {
    const grams = parseGrams(draft.grams);
    const eaten = typeof grams === "number" && grams > 0 ? portion(draft.packet.per100, grams) : null;
    return eaten ? { meal: { ...base, ...eaten } } : { problem: "amount" };
  }
  const kcal = parseKcal(draft.kcal);
  if (kcal === null) return { problem: "kcal" };
  const [protein, carbs, fat] = [parseGrams(draft.protein), parseGrams(draft.carbs), parseGrams(draft.fat)];
  if (protein === undefined || carbs === undefined || fat === undefined) return { problem: "grams" };
  return { meal: { ...base, kcal, protein, carbs, fat } };
}
