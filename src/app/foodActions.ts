/**
 * Food's actions: a meal typed in, photographed or scanned from a packet, the goals, and an estimate from the user's
 * own server when there is one. A photo stays on the phone unless the user taps Estimate. The meal on the form is kept
 * in memory (state.foodDraft), so a photo or a scan in the middle does not lose what was typed.
 */
import { addMeal, parseKcalGoal, parseProteinGoal, photosInUse, removeMeal, setGoal, KCAL_GOAL_MAX, KCAL_GOAL_MIN,
  PROTEIN_GOAL_MAX, PROTEIN_GOAL_MIN, type FoodLog } from "../food/food.ts";
import { FIELD_NAMES, emptyDraft, mealFromDraft, withFields, withPacket, type DraftFields, type DraftProblem, type FoodDraft } from "../food/draft.ts";
import { estimateMeal } from "../food/estimate.ts";
import { findPacket } from "../food/packet.ts";
import { mealPhoto, mealPhotoBase64, mealPhotoSrc, removeMealPhoto, removeUnusedMealPhotos, scanPacket } from "../food/phone.ts";
import { isNative } from "../device.ts";
import { KEYS } from "../store.ts";
import { readSession, sessionToken } from "../talk/session.ts";
import { workerUrl } from "../voice.ts";
import type { FoodModel } from "../ui/foodView.ts";
import { busyWhile, hooks, save, setNotice, state, today } from "./state.ts";

export const FOOD_MESSAGES = {
  name: "Say what you ate.",
  kcal: "Type the energy in kcal, a whole number like 450.",
  grams: "Protein, carbs and fat are grams, like 32 or 32.5, or left empty.",
  amount: "Type how many grams you ate, like 30.",
  goal: `A day's energy goal is ${KCAL_GOAL_MIN} to ${KCAL_GOAL_MAX.toLocaleString("en-GB")} kcal and a protein goal ${PROTEIN_GOAL_MIN} to ${PROTEIN_GOAL_MAX} g. Leave either empty for none.`,
  camera: "No photo was taken. Allow the camera for Awqat in the phone's Settings if it did not open.",
  scanner: "The scanner could not start. Allow the camera for Awqat in the phone's Settings.",
  notFood: "That is not a packet's barcode. Type the meal instead.",
  unknown: "Open Food Facts does not have this packet's numbers. Type them from the label.",
  lookupFailed: "The packet could not be looked up just now. Check the internet, or type the numbers from the label.",
  phoneOnly: "Photos and the scanner work in the installed app.",
  noServer: "An estimate from a photo needs your own server, set in Settings. Type the numbers instead.",
  signIn: "Sign in to your server in Settings first, then ask for the estimate again.",
  unsure: "Your server could not tell what the meal is. Type the numbers instead.",
  estimateFailed: "The estimate did not come back. Try again, or type the numbers.",
  estimated: "An estimate from the photo. Check it and correct it before you log it.",
  saved: "Saved.",
};

const PROBLEM: Readonly<Record<DraftProblem, string>> = { name: FOOD_MESSAGES.name, kcal: FOOD_MESSAGES.kcal,
  grams: FOOD_MESSAGES.grams, amount: FOOD_MESSAGES.amount };

/** A second tap this soon is one double tap, on a button that has just changed under the finger. */
const CONFIRM_PAUSE_MS = 500;
let mealArmedAt = Number.NEGATIVE_INFINITY;
let logging = false;

const newMealId = (at: number): string => `m${at.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

export function foodModel(): FoodModel {
  return { log: state.food, today: today(), tz: state.place.tz, draft: state.foodDraft, armed: state.mealRemoveArmed, busy: state.busy,
    native: isNative(), server: workerUrl(state.settings.voiceUrl) !== "", photoSrc: mealPhotoSrc };
}

async function setFood(log: FoodLog): Promise<boolean> {
  state.food = log;
  return save(KEYS.food, log);
}

/** What is typed on the form now goes into the draft, so the redraw after a photo or a scan gives it back. */
function keepTyped(): FoodDraft {
  const form = typeof document === "undefined" ? null : document.querySelector<HTMLFormElement>('form[data-form="meal-add"]');
  const read = (name: keyof DraftFields): string | null => {
    const field = form?.elements.namedItem(name);
    return field instanceof HTMLInputElement ? field.value : null;
  };
  return withFields(state.foodDraft ?? emptyDraft(), read);
}

/** A photo for the meal on the form. It stays on the phone; a photo it takes the place of is deleted. */
export function addPhoto(from: "camera" | "gallery"): Promise<void> {
  if (!isNative()) {
    setNotice(FOOD_MESSAGES.phoneOnly);
    return Promise.resolve(hooks.render());
  }
  const typed = keepTyped();
  return busyWhile(async () => {
    const photo = await mealPhoto(from);
    if (!photo) return setNotice(FOOD_MESSAGES.camera);
    const draft = state.foodDraft ?? typed;
    if (draft.photo) await removeMealPhoto(draft.photo);
    // A new photo: numbers estimated from the one before are no longer this photo's.
    state.foodDraft = { ...draft, photo, estimated: false };
    setNotice("");
  });
}

/** A packet's barcode: its numbers per 100 g from Open Food Facts. Only the barcode leaves the phone. */
export function scan(): Promise<void> {
  if (!isNative()) {
    setNotice(FOOD_MESSAGES.phoneOnly);
    return Promise.resolve(hooks.render());
  }
  const typed = keepTyped();
  return busyWhile(async () => {
    const result = await scanPacket();
    if ("cancelled" in result) return;
    if ("failed" in result) return setNotice(FOOD_MESSAGES.scanner);
    if ("notFood" in result) return setNotice(FOOD_MESSAGES.notFood);
    const lookup = await findPacket(result.code);
    if ("failed" in lookup) return setNotice(FOOD_MESSAGES.lookupFailed);
    if ("none" in lookup) return setNotice(FOOD_MESSAGES.unknown);
    state.foodDraft = withPacket(state.foodDraft ?? typed, lookup.found);
    setNotice("");
  });
}

/**
 * The photo on the form goes to the user's own server for an estimate: only on this tap, only to the server in
 * Settings, only with its session. What comes back fills the form for the user to check; nothing is logged.
 */
export function estimate(): Promise<void> {
  const typed = keepTyped();
  return busyWhile(async () => {
    const photo = typed.photo;
    if (!photo) return;
    state.foodDraft = typed;
    const worker = workerUrl(state.settings.voiceUrl);
    if (!worker) return setNotice(FOOD_MESSAGES.noServer);
    const token = sessionToken(await readSession(), worker);
    if (token === null) return setNotice(FOOD_MESSAGES.signIn);
    const image = await mealPhotoBase64(photo);
    if (!image) return setNotice(FOOD_MESSAGES.estimateFailed);
    const answer = await estimateMeal(worker, token, image);
    // The form was let go, or another photo took this one's place, while the server looked: the answer is let go too.
    if (state.foodDraft?.photo !== photo) return;
    if ("failed" in answer) return setNotice(answer.signedOut ? FOOD_MESSAGES.signIn : FOOD_MESSAGES.estimateFailed);
    if ("unsure" in answer) return setNotice(FOOD_MESSAGES.unsure);
    const e = answer.estimate;
    const grams = (n: number | null): string => (n === null ? "" : String(n));
    state.foodDraft = { ...state.foodDraft, packet: null, grams: "", name: state.foodDraft.name.trim() || e.name, kcal: String(e.kcal),
      protein: grams(e.protein), carbs: grams(e.carbs), fat: grams(e.fat), estimated: true };
    setNotice(FOOD_MESSAGES.estimated);
  });
}

/**
 * Lets the meal on the form go, with its photo. Never while the camera, the scanner or the server is still at work
 * for it: what they bring back would be laid over a form whose photo is gone.
 */
export async function cancelDraft(): Promise<void> {
  if (state.busy) return;
  const draft = state.foodDraft;
  state.foodDraft = null;
  setNotice("");
  hooks.render();
  // The redraw gives back what was typed since the last draw (ui/keep.ts): clearing the form means that goes too.
  if (typeof document !== "undefined") document.querySelector<HTMLFormElement>('form[data-form="meal-add"]')?.reset();
  if (draft?.photo) await removeMealPhoto(draft.photo);
}

/** A form just sent loses its fields in the redraw of that same moment: one that needs correcting redraws just after. */
function renderKeepingFields(): void {
  setTimeout(() => hooks.render(), 0);
}

/** The form sent: the meal is logged for today, or the form says what to correct and keeps what was typed. */
export async function logMeal(form: FormData, at = Date.now()): Promise<void> {
  if (logging || state.busy) return;
  const fields = Object.fromEntries(FIELD_NAMES.map((name) => [name, form.get(name)])) as Record<keyof DraftFields, FormDataEntryValue | null>;
  const draft = withFields(state.foodDraft ?? emptyDraft(), (name) => (typeof fields[name] === "string" ? fields[name] as string : null));
  const result = mealFromDraft(draft, newMealId(at), today(), at);
  if ("problem" in result) {
    state.foodDraft = draft;
    setNotice(PROBLEM[result.problem]);
    return renderKeepingFields();
  }
  logging = true;
  try {
    state.foodDraft = null;
    const saving = setFood(addMeal(state.food, result.meal));
    // In the same moment as the tap, so the form comes back empty and a second tap cannot log it again.
    hooks.render();
    // A save that failed says so itself (state.ts save), as for every other record.
    if (await saving) setNotice("");
    hooks.render();
  } finally {
    logging = false;
  }
}

/** Remove is tapped twice for a meal, with a moment between so a double tap is one. Its photo goes once that is saved. */
export async function removeMealTap(id: string, now = Date.now()): Promise<void> {
  if (state.mealRemoveArmed !== id) {
    state.mealRemoveArmed = id;
    mealArmedAt = now;
    return hooks.render();
  }
  if (now >= mealArmedAt && now - mealArmedAt < CONFIRM_PAUSE_MS) return;
  state.mealRemoveArmed = null;
  const meal = state.food.meals.find((m) => m.id === id);
  const saving = setFood(removeMeal(state.food, id));
  hooks.render();
  if ((await saving) && meal?.photo && !photosInUse(state.food).has(meal.photo)) await removeMealPhoto(meal.photo);
  hooks.render();
}

/** The day's goals, the user's own numbers: either may be left empty. */
export async function saveGoal(form: FormData): Promise<void> {
  const kcal = parseKcalGoal(String(form.get("kcal") ?? ""));
  const protein = parseProteinGoal(String(form.get("protein") ?? ""));
  if (kcal === undefined || protein === undefined) {
    setNotice(FOOD_MESSAGES.goal);
    return renderKeepingFields();
  }
  if (await setFood(setGoal(state.food, { kcal, protein }))) setNotice(FOOD_MESSAGES.saved);
  hooks.render();
}

/** At start-up: photos no meal holds (a form let go by closing the app) are deleted, only when Food was read whole. */
export async function tidyMealPhotos(readCleanly: boolean): Promise<void> {
  if (!readCleanly || state.blocked.has(KEYS.food)) return;
  const inUse = photosInUse(state.food);
  if (state.foodDraft?.photo) inUse.add(state.foodDraft.photo);
  await removeUnusedMealPhotos(inUse);
}
