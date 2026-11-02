/**
 * What the modes do: count and tick steps for the occasion, put one off, open its readings in the reader without
 * touching the bookmark or the log, add the user's own du'as, and time a study. A count shows at once and is saved in order
 * behind it, as the adhkar's are.
 */
import { Capacitor } from "@capacitor/core";
import { activeTracks, trackOf } from "../learn/learn.ts";
import {
  addOwnDua, addToStep, isModeId, modeWindows, placeKey, placeOf, removeOwnDua, runningMinutes, setNotNow,
  setStep, setStudyAfter, startTimer, stepCount, stopTimer, AFTER_CHOICES, type ModeId, type ModeLog, type StudyAfter,
} from "../modes/modes.ts";
import {
  defOf, nextStep, stepProgress, stepsOf, suraPages, waitingNow, type ModeContext, type Step,
} from "../modes/registry.ts";
import { prayerDayIndex } from "../prayer/window.ts";
import { KEYS } from "../store.ts";
import { paintDhikrCard } from "../ui/adhkarView.ts";
import type { ModesModel } from "../ui/modesView.ts";
import { feelCount } from "./feel.ts";
import { WORKOUT_TIMER, applyTaps, dhikrItem, dhikrKey, dhikrOf, nextItem, openDhikr, startWorkoutTimer, stopWorkoutTimer, timerItem,
  type LiveItem, type LiveTap, type OpenDhikr } from "./live.ts";
import * as mushaf from "./mushafActions.ts";
import { MESSAGES, announce, hooks, save, setNotice, state, today } from "./state.ts";

let writing: Promise<void> = Promise.resolve();
let queued = false;

/** The saves still to finish (for tests, and for nothing else to wait on). */
export function saved(): Promise<void> {
  return writing;
}

function persist(): void {
  if (queued) return;
  queued = true;
  writing = writing.then(async () => {
    queued = false;
    try {
      if (!(await save(KEYS.modes, state.modes))) hooks.render();
    } catch {
      // A redraw that failed: the chain goes on, so later taps are still saved.
    }
  });
}

/** Changes the log and shows it, unless its saved copy could not be read (nothing is written over that). */
function change(next: (log: ModeLog) => ModeLog, paint?: (log: ModeLog) => boolean): boolean {
  if (state.blocked.has(KEYS.modes)) {
    setNotice(MESSAGES.unreadable);
    hooks.render();
    return false;
  }
  const after = next(state.modes);
  if (after === state.modes) return false;
  state.modes = after;
  persist();
  if (paint?.(after)) hooks.syncSurfaces();
  else hooks.render();
  return true;
}

/** A step's count, on its own card, so the ring runs on from where it is; false when the card is not on screen. */
function paintStep(id: string, n: number, of: number, moved: boolean): boolean {
  if (typeof document === "undefined") return false;
  const done = paintDhikrCard(document, `[data-step="${CSS.escape(id)}"]`, n, of, moved);
  if (done && moved) feelCount(n >= of);
  return done;
}

/** The mode on screen, when one is. */
export function openMode(): ModeId | null {
  const id = state.screen.startsWith("mode:") ? state.screen.slice(5) : "";
  return isModeId(id) ? id : null;
}

const windowsNow = (now: Date) => modeWindows(state.days, now, state.modes, activeTracks(state.learn).map((t) => t.id));
const dayNow = (now: Date) => state.days[prayerDayIndex(state.days, now)];

/** The date a mode's counts go on now: its open window's, else the day on screen. Jumu'ah counts only while open. */
export function occasion(mode: ModeId, now = new Date()): string | null {
  const open = windowsNow(now).find((w) => w.mode === mode);
  if (open) return open.date;
  if (mode === "jumuah" || state.days.length === 0) return null;
  return dayNow(now).date;
}

function context(mode: ModeId, now: Date): ModeContext {
  return { log: state.modes, friday: state.friday, adhkar: state.adhkar, date: occasion(mode, now) };
}

function findStep(mode: ModeId, id: string): Step | undefined {
  const def = defOf(mode);
  return def ? stepsOf(def, state.modes).find((s) => s.id === id) : undefined;
}

/** A step counted with the ring. */
const isCounted = (step: Step): step is Extract<Step, { kind: "dua" | "quran" | "page" }> =>
  step.kind === "dua" || step.kind === "quran" || step.kind === "page";

/** One tap on the words: one more, up to the step's count. */
export function count(value: string, now = new Date()): void {
  const mode = openMode();
  const date = mode ? occasion(mode, now) : null;
  const step = mode ? findStep(mode, value) : undefined;
  if (!mode || !date || !step || !isCounted(step)) return;
  const max = step.count;
  const paint = (log: ModeLog): boolean => paintStep(step.id, stepCount(log, date, mode, step.id), max, true);
  if (change((log) => addToStep(log, date, mode, step.id, max), paint) && stepCount(state.modes, date, mode, step.id) === max) {
    announce(`${step.name}: done.`);
  }
}

/** One fewer, for a tap that slipped. */
export function takeBack(value: string, now = new Date()): void {
  const mode = openMode();
  const date = mode ? occasion(mode, now) : null;
  const step = mode ? findStep(mode, value) : undefined;
  if (!mode || !date || !step || !isCounted(step)) return;
  const max = step.count;
  const n = stepCount(state.modes, date, mode, step.id);
  if (n <= 0) return;
  change((log) => setStep(log, date, mode, step.id, n - 1), (log) => paintStep(step.id, stepCount(log, date, mode, step.id), max, false));
}

/** Done: said in full at once, or, when it already was, back to none. */
export function toggleDone(value: string, now = new Date()): void {
  const mode = openMode();
  const date = mode ? occasion(mode, now) : null;
  const step = mode ? findStep(mode, value) : undefined;
  if (!mode || !date || !step || (!isCounted(step) && step.kind !== "sunnah")) return;
  const { n, of } = stepProgress(mode, step, context(mode, now));
  const finished = n < of;
  if (change((log) => setStep(log, date, mode, step.id, finished ? of : 0))) {
    announce(`${step.name}: ${finished ? "done" : "not done"}.`);
  }
}

/** "Not now": the prompt stays away until this mode's next occasion. It is still in the list. */
export function notNow(value: string, now = new Date()): void {
  if (!isModeId(value)) return;
  const open = windowsNow(now).find((w) => w.mode === value);
  if (open) change((log) => setNotNow(log, open.date, value));
}

/**
 * Opens a surah of a mode at the user's place in it, for this occasion; Back returns to `from`. The reader keeps that place,
 * not the bookmark.
 */
function readSurah(mode: ModeId, step: Extract<Step, { kind: "read" }>, now: Date, from: string): void {
  const pages = suraPages(step.sura);
  if (!pages) return;
  const date = occasion(mode, now);
  const key = date ? placeKey(step.sura, date) : null;
  const at = key ? placeOf(state.modes, key) : null;
  mushaf.openGuest({ label: step.name, first: pages.first, last: pages.last, placeKey: key, tick: step.id },
    at ?? pages.first, from);
  hooks.showReader();
}

/** The reading a mode names, from its own screen. */
export function read(value: string, now = new Date()): void {
  const mode = openMode();
  const step = mode ? findStep(mode, value) : undefined;
  if (mode && step?.kind === "read") readSurah(mode, step, now, `mode:${mode}`);
}

/** Ayat counted in a mode: opened to read, with nothing kept but the count. */
export function readAyat(value: string): void {
  const mode = openMode();
  const step = mode ? findStep(mode, value) : undefined;
  if (!mode || step?.kind !== "quran") return;
  mushaf.openGuest({ label: step.name, first: step.page, last: step.page, placeKey: null, tick: null }, step.page, `mode:${mode}`);
  hooks.showReader();
}

/** The prompt's button: straight to the reading when that is next, otherwise the mode's screen. */
export function pick(value: string, now = new Date()): void {
  if (!isModeId(value)) return;
  const def = defOf(value);
  const step = def ? nextStep(def, context(value, now)) : null;
  if (step?.kind === "read") readSurah(value, step, now, state.screen);
  else hooks.go(`mode:${value}`);
}

export function openDuaSheet(mode: string): void {
  if (!defOf(mode)) return;
  state.modeDuaFor = mode;
  state.sheet = "mode-dua";
  hooks.renderOverlay();
}

/** A du'a half written in its sheet: the first close says so, so the user's words are not lost to a stray tap. */
export function duaTyped(): boolean {
  if (state.sheet !== "mode-dua") return false;
  const area = document.querySelector<HTMLTextAreaElement>("#overlay textarea");
  return area !== null && area.value.trim() !== "";
}

function sheetError(text: string): void {
  const el = document.querySelector<HTMLElement>("#overlay [data-sheet-error]");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

const newId = (at: number): string => `d${at.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** A du'a being saved: Save does nothing meanwhile, so nothing is added twice. */
let addingDua = false;

/** Saved first and shown second: a du'a the phone could not keep stays in the sheet. */
export async function submitDua(form: FormData, at = Date.now()): Promise<void> {
  if (addingDua) return;
  const text = String(form.get("text") ?? "");
  const next = addOwnDua(state.modes, state.modeDuaFor ?? "", String(form.get("name") ?? ""), text, at, newId(at));
  if (next === state.modes) return sheetError(text.trim() ? "That is as many du'as as this holds." : "Write or paste the du'a first.");
  if (state.blocked.has(KEYS.modes)) return sheetError(MESSAGES.unreadable);
  addingDua = true;
  try {
    if (!(await save(KEYS.modes, next))) return sheetError(state.notice || MESSAGES.unsaved);
    const added = Object.keys(next.duas).filter((id) => !Object.hasOwn(state.modes.duas, id));
    // A change that landed during the save goes under this one.
    const merged = added.reduce((log, id) => ({ ...log, duas: { ...log.duas, [id]: next.duas[id] } }), state.modes);
    state.modes = merged;
    const moved = merged.days !== next.days || merged.places !== next.places || merged.study !== next.study ||
      Object.keys(merged.duas).length !== Object.keys(next.duas).length;
    if (moved) void save(KEYS.modes, merged);
    hooks.render();
    hooks.closeSheet(true);
    announce("Du'a added.");
  } finally {
    addingDua = false;
  }
}

/** A second tap this soon is one double tap, on a button that has just changed under the finger. */
const CONFIRM_PAUSE_MS = 500;
let armedAt = Number.NEGATIVE_INFINITY;

/** Two taps with a moment between them: the first arms what is about to go, the second confirms. */
function confirmed(key: string, now: number): boolean {
  if (state.modeRemoveArmed !== key) {
    state.modeRemoveArmed = key;
    armedAt = now;
    hooks.render();
    return false;
  }
  if (now >= armedAt && now - armedAt < CONFIRM_PAUSE_MS) return false;
  state.modeRemoveArmed = null;
  return true;
}

export function removeDuaTap(id: string, now = Date.now()): void {
  if (confirmed(id, now)) change((log) => removeOwnDua(log, id));
}

export function startStudy(trackId: string, at = Date.now()): void {
  if (!trackOf(state.learn, trackId)) return;
  if (change((log) => startTimer(log, trackId, at))) announce("Timing your study.");
}

/** Stop opens the log sheet with the minutes in it, so the user can correct them; the timer stops once they are saved. */
export function stopStudy(trackId: string, now = Date.now()): void {
  if (state.modes.timer?.trackId !== trackId) return;
  state.learnSheetMinutes = runningMinutes(state.modes, now);
  state.learnSheetTrack = trackId;
  state.sheet = "learn-session";
  hooks.renderOverlay();
}

/** Letting a running timer go loses its time: two taps, as with a du'a. */
export function dropStudy(now = Date.now()): void {
  if (confirmed("timer", now) && change(stopTimer)) announce("Timer stopped. Nothing logged.");
}

/** After the log sheet saved: a timer it came from has done its job. Called with whether the sheet has closed. */
export function studyLogged(): void {
  if (state.learnSheetMinutes === null || state.sheet === "learn-session") return;
  state.learnSheetMinutes = null;
  if (state.modes.timer) change(stopTimer);
}

export function setAfter(trackId: string, value: string, at = Date.now()): void {
  if (!(AFTER_CHOICES as readonly string[]).includes(value) || !trackOf(state.learn, trackId)) return;
  if (change((log) => setStudyAfter(log, trackId, value as StudyAfter, at))) {
    announce(value === "off" ? "It opens only when you open it." : "It comes up by itself now.");
  }
}

/** The first thing to count in what is open now, for the home-screen widget. */
export function openCount(now: Date): OpenDhikr | null {
  if (state.days.length === 0) return null;
  return openDhikr({ days: state.days, now, log: state.modes, friday: state.friday, adhkar: state.adhkar, learn: state.learn, today: today() });
}

/** What should be live now: nothing at all when the user has turned it off. A dhikr that reached its count comes off by itself. */
export function liveItems(now: Date, workoutName: string): LiveItem[] {
  if (!state.settings.live) return [];
  const context = { log: state.modes, friday: state.friday, adhkar: state.adhkar };
  const dhikr = state.liveDhikr ? dhikrOf(state.liveDhikr, context) : null;
  const running = dhikr && dhikr.n < dhikr.of ? dhikr : null;
  const mode = state.liveDhikr?.split("|")[0] ?? "";
  const items = [nextItem(state.days, now, Capacitor.getPlatform()), running ? dhikrItem(running, mode) : null,
    timerItem(state.modes, (id) => trackOf(state.learn, id)?.name ?? null, workoutName)];
  return items.filter((item): item is LiveItem => item !== null);
}

/** Counting a dhikr on the lock screen and the island, or no longer. */
export function toggleLive(stepId: string, now = new Date()): void {
  const mode = openMode();
  const date = mode ? occasion(mode, now) : null;
  if (!mode || !date) return;
  const key = dhikrKey(mode, date, stepId);
  state.liveDhikr = state.liveDhikr === key ? null : key;
  hooks.render();
}

/**
 * Start or stop the workout's timer. True when it stopped. One timer runs at a time, and a study's holds minutes not yet
 * logged, so it is not stopped from here: the user stops it first, where its minutes can be logged.
 */
export function toggleWorkout(at = Date.now()): boolean {
  const timer = state.modes.timer;
  if (timer && timer.trackId !== WORKOUT_TIMER) {
    setNotice(`${trackOf(state.learn, timer.trackId)?.name ?? "A study"} is being timed. Stop it first.`);
    hooks.render();
    return false;
  }
  const running = timer !== null;
  return change((log) => (running ? stopWorkoutTimer(log) : startWorkoutTimer(log, at))) && running;
}

/** Taps from a widget or the island, added to the counts. */
export function addTaps(taps: readonly LiveTap[]): void {
  change((log) => applyTaps(log, taps, { friday: state.friday, adhkar: state.adhkar }));
}

/** What the screens show of the modes. */
export function modesModel(now: Date, tz: string): ModesModel {
  const day = state.days.length > 0 ? dayNow(now) : null;
  const date = today();
  const context = { days: state.days, now, log: state.modes, friday: state.friday, adhkar: state.adhkar, learn: state.learn, today: date };
  return {
    log: state.modes, friday: state.friday, adhkar: state.adhkar, learn: state.learn, now, tz, today: date,
    open: windowsNow(now), waiting: waitingNow(context), day: day as NonNullable<typeof day>, removeArmed: state.modeRemoveArmed,
    live: Capacitor.isNativePlatform() && state.settings.live, liveKey: state.liveDhikr,
  };
}
