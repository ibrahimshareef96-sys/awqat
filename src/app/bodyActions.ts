/**
 * Body's actions: finding the health store, connecting it (read only), reading it when Body opens or Refresh is
 * tapped, typed weights and the weekly plan. Readings are kept in memory for the screen only.
 */
import { Capacitor } from "@capacitor/core";
import { addWeight, parseKg, removeWeight, setConnected, setTarget, TARGET_MAX, type BodyLog } from "../body/body.ts";
import { connectHealth, deniedTypes, healthAvailable, openHealthSettings, readHealth } from "../body/health.ts";
import { summarise, type BodySummary, type RawHealth } from "../body/summary.ts";
import { addLift, parseStepGoal, removeLift, setPlan, setStepGoal, STEP_GOAL_MAX, STEP_GOAL_MIN, toggleDone } from "../body/training.ts";
import { isNative } from "../device.ts";
import { KEYS } from "../store.ts";
import type { BodyModel } from "../ui/bodyView.ts";
import { WORKOUT_TIMER } from "./live.ts";
import { busyWhile, hooks, save, setNotice, state, today } from "./state.ts";

export const BODY_MESSAGES = {
  badWeight: "Type your weight in kilograms, like 82.4.",
  badTarget: `Type how many workouts you plan a week, from 1 to ${TARGET_MAX}, or leave it empty for none.`,
  connectFailed: "The health store could not be asked just now. Try again in a moment.",
  badStepGoal: `Type a step goal from ${STEP_GOAL_MIN.toLocaleString("en-GB")} to ${STEP_GOAL_MAX.toLocaleString("en-GB")}, or leave it empty for none.`,
  badLift: "Say the exercise, the reps and the sets. Kilos can stay empty for a bodyweight exercise.",
  saved: "Saved.",
};

/** A second tap this soon is one double tap, on a button that has just changed under the finger. */
const CONFIRM_PAUSE_MS = 500;
let liftArmedAt = Number.NEGATIVE_INFINITY;

const NOTHING: RawHealth = { weight: null, steps: null, sleep: null, workouts: null };

/** Worked out afresh, so a weight from another device or a new day shows without waiting for the next reading. */
export function healthNow(): BodySummary | null {
  return state.health.summary ? summarise(state.health.raw ?? NOTHING, state.body.weights, today(), state.place.tz, state.body.weeklyTarget) : null;
}

export function bodyModel(now: Date): BodyModel {
  return {
    log: state.body, available: state.health.available, denied: state.health.denied,
    summary: healthNow(),
    readAt: state.health.readAt, reading: state.health.reading, platform: Capacitor.getPlatform(), tz: state.place.tz,
    today: today(), now: now.getTime(), busy: state.busy, removeArmed: state.weightRemoveArmed, liftArmed: state.liftRemoveArmed,
    workoutSince: state.modes.timer?.trackId === WORKOUT_TIMER ? state.modes.timer.startedAt : null,
  };
}

/** The summary again from the last readings, with the typed weights and plan as they are now. */
function resummarise(): void {
  state.health.summary = summarise(state.health.raw ?? NOTHING, state.body.weights, today(), state.place.tz,
    state.body.weeklyTarget);
}

async function setBody(log: BodyLog): Promise<boolean> {
  state.body = log;
  resummarise();
  return save(KEYS.body, log);
}

/**
 * A fresh reading, kind by kind: a kind the store could not give this time keeps what it gave last time, unless it
 * is now not allowed, when it is let go.
 */
function merged(fresh: RawHealth, denied: readonly string[]): RawHealth {
  const last = state.health.raw ?? NOTHING;
  const pick = <K extends keyof RawHealth>(kind: K, name: string): RawHealth[K] =>
    fresh[kind] ?? (denied.includes(name) ? null : last[kind]);
  return { weight: pick("weight", "weight"), steps: pick("steps", "steps"), sleep: pick("sleep", "sleep"),
    workouts: pick("workouts", "workouts") };
}

/** Reads the health store, once at a time; nothing when it was never connected. */
export async function readBody(): Promise<void> {
  if (state.health.reading || !state.body.connected || !state.health.available?.available) return;
  state.health.reading = true;
  hooks.softRender();
  try {
    const now = Date.now();
    const fresh = await readHealth(now, today(), state.place.tz);
    state.health.denied = await deniedTypes();
    state.health.raw = merged(fresh, state.health.denied);
    state.health.readAt = now;
    resummarise();
  } finally {
    state.health.reading = false;
    hooks.softRender();
  }
}

/**
 * Body opened, or the app came back to it: the health store is looked for (again, if it was missing: it may have
 * been installed or updated meanwhile), then read if it was connected.
 */
export async function openBody(): Promise<void> {
  resummarise();
  if (!state.health.available?.available) {
    state.health.available = isNative() ? await healthAvailable() : { available: false, reason: "web" };
    hooks.softRender();
  }
  await readBody();
}

export function connect(): Promise<void> {
  return busyWhile(async () => {
    const result = await connectHealth();
    if (!result) return setNotice(BODY_MESSAGES.connectFailed);
    state.health.denied = result.denied;
    if (await setBody(setConnected(state.body, true))) await readBody();
  });
}

/** A typed weight; the field clears as it is sent. */
export function addTypedWeight(text: string): Promise<void> {
  return busyWhile(async () => {
    const kg = parseKg(text);
    if (kg === null) return setNotice(BODY_MESSAGES.badWeight);
    if (await setBody(addWeight(state.body, kg, Date.now()))) setNotice("");
  });
}

/** Remove is tapped twice for a typed weight. */
export async function removeTypedWeightTap(at: number): Promise<void> {
  if (state.weightRemoveArmed !== at) {
    state.weightRemoveArmed = at;
    return hooks.render();
  }
  state.weightRemoveArmed = null;
  const saving = setBody(removeWeight(state.body, at));
  hooks.render();
  await saving;
  // Again once saved, so a save that failed says so now, not at the next tap.
  hooks.render();
}

/** The weekly plan: 1 to 14, or empty for none; anything else is asked for again, and the plan stays as it was. */
export async function setWeeklyTarget(value: string): Promise<void> {
  const next = setTarget(state.body, value);
  if (value.trim() && next.weeklyTarget === null) {
    setNotice(BODY_MESSAGES.badTarget);
    return hooks.render();
  }
  if (await setBody(next)) setNotice(BODY_MESSAGES.saved);
  hooks.render();
}

/** The step goal: the user's own number, or empty for none. */
export async function setStepGoalText(value: string): Promise<void> {
  const goal = parseStepGoal(value);
  if (goal === undefined) {
    setNotice(BODY_MESSAGES.badStepGoal);
    return renderKeepingFields();
  }
  if (await setBody(setStepGoal(state.body, goal))) setNotice(BODY_MESSAGES.saved);
  hooks.render();
}

export async function savePlan(form: FormData): Promise<void> {
  const plan = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [day, String(form.get(`day${day}`) ?? "")]));
  if (await setBody(setPlan(state.body, plan))) setNotice(BODY_MESSAGES.saved);
  hooks.render();
}

export async function toggleTodayDone(): Promise<void> {
  const saving = setBody(toggleDone(state.body, today()));
  hooks.render();
  await saving;
  hooks.render();
}

/** A form just sent loses its fields in the redraw of that same moment: one that needs correcting redraws just after. */
function renderKeepingFields(): void {
  setTimeout(() => hooks.render(), 0);
}

let logging = false;
const whole = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);
const newLiftId = (at: number): string => `l${at.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** One exercise as the user did it: an empty kilos field is a bodyweight exercise. */
export async function logLift(form: FormData, at = Date.now()): Promise<void> {
  if (logging) return;
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const kgText = text("kg").replace(",", ".");
  const kg = kgText === "" ? 0 : Number(kgText);
  const next = addLift(state.body, { id: newLiftId(at), date: today(), exercise: text("exercise"), kg, reps: whole(text("reps")), sets: whole(text("sets")) });
  if (next === state.body) {
    setNotice(BODY_MESSAGES.badLift);
    return renderKeepingFields();
  }
  logging = true;
  try {
    const saving = setBody(next);
    // In the same moment as the tap, so the form comes back empty and a second tap cannot log it again.
    hooks.render();
    if (await saving) setNotice("");
    hooks.render();
  } finally {
    logging = false;
  }
}

/** Remove is tapped twice for a lift, with a moment between so a double tap is one. */
export async function removeLiftTap(id: string, now = Date.now()): Promise<void> {
  if (state.liftRemoveArmed !== id) {
    state.liftRemoveArmed = id;
    liftArmedAt = now;
    return hooks.render();
  }
  if (now >= liftArmedAt && now - liftArmedAt < CONFIRM_PAUSE_MS) return;
  state.liftRemoveArmed = null;
  const saving = setBody(removeLift(state.body, id));
  hooks.render();
  await saving;
  hooks.render();
}

/** Home's card reads the health store too: at most this often, on opening and coming back. */
const HOME_READ_GAP_MS = 10 * 60_000;

export function readForHome(now = Date.now()): void {
  if (!state.body.connected || state.health.reading) return;
  if (state.health.readAt !== null && now - state.health.readAt < HOME_READ_GAP_MS) return;
  void openBody();
}

export function healthSettings(): void {
  void openHealthSettings();
}
