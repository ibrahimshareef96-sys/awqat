/**
 * What should be live on the lock screen and the Dynamic Island (docs/live-surfaces.md). This decides; native code only
 * draws. At most one of each: the next prayer or iqama, a dhikr the user chose to count there, and a timer the user started.
 * `show` is called only when an item changed, and native never restarts one that is already up.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { prayerName } from "../faith/friday.ts";
import { isModeId, setStep, startTimer, stepCount, stopTimer, type ModeLog } from "../modes/modes.ts";
import { defOf, stepProgress, stepsOf, type ModeContext, type Step, type WaitingContext, waitingNow } from "../modes/registry.ts";
import { awaitingIqama } from "../prayer/iqama.ts";
import { PRAYERS, type DayTimes } from "../prayer/times.ts";

export type LiveId = "next" | "dhikr" | "timer";

export interface LiveItem {
  id: LiveId;
  title: string;
  detail: string;
  endsAt?: number;
  startedAt?: number;
  count?: number;
  of?: number;
  key?: string;
  link: string;
}

export interface LiveTap { key: string; n: number }

interface LiveBridge {
  available(): Promise<{ live: boolean }>;
  show(item: LiveItem): Promise<void>;
  end(options: { id: LiveId }): Promise<void>;
  drain(): Promise<{ taps: LiveTap[] }>;
}

const bridge = registerPlugin<LiveBridge>("LiveBridge");

/** Apple ends a Live Activity after eight hours, so a prayer further off than that is the widget's to show. */
const LIVE_MAX_MS = 8 * 60 * 60 * 1000;
const IDS: readonly LiveId[] = ["next", "dhikr", "timer"];

/** The id a workout runs under in the one timer the modes keep. Never a track's: tracks are given longer ids. */
export const WORKOUT_TIMER = "workout";

/** Waiting for the iqama, or the next prayer if it is near enough. Android has this only for the iqama: Google keeps Live Updates for what is about to start. */
export function nextItem(days: readonly DayTimes[], now: Date, platform: string): LiveItem | null {
  for (const day of days) {
    const waiting = awaitingIqama(day, now);
    if (waiting) return { id: "next", title: prayerName(waiting.prayer, day.date), detail: "Iqama", endsAt: waiting.at.getTime(), link: "awqat://go/faith" };
  }
  if (platform === "android") return null;
  const at = now.getTime();
  const coming = days.flatMap((day) => PRAYERS.map((p) => ({ name: prayerName(p, day.date), at: day[p].getTime() })))
    .filter((x) => Number.isFinite(x.at) && x.at > at).sort((a, b) => a.at - b.at)[0];
  return coming && coming.at - at <= LIVE_MAX_MS ? { id: "next", title: coming.name, detail: "Next prayer", endsAt: coming.at, link: "awqat://go/faith" } : null;
}

type Counted = Extract<Step, { kind: "dua" | "quran" | "page" }>;
const isCounted = (step: Step): step is Counted => step.kind === "dua" || step.kind === "quran" || step.kind === "page";

/** "mode|date|step": what a tap on a widget or the island counts towards. Native never reads inside it. */
export const dhikrKey = (mode: string, date: string, step: string): string => `${mode}|${date}|${step}`;

function readKey(key: string): { mode: string; date: string; step: string } | null {
  const [mode, date, step, more] = key.split("|");
  return mode && date && step && more === undefined && isModeId(mode) ? { mode, date, step } : null;
}

export interface OpenDhikr { key: string; name: string; n: number; of: number }

/** What a key stands for now, in words and numbers; null when it is no longer a counted step. */
export function dhikrOf(key: string, c: Omit<ModeContext, "date">): OpenDhikr | null {
  const k = readKey(key);
  const def = k ? defOf(k.mode) : null;
  if (!k || !def) return null;
  const step = stepsOf(def, c.log).find((s) => s.id === k.step);
  if (!step || !isCounted(step)) return null;
  const { n, of } = stepProgress(def.id, step, { ...c, date: k.date });
  return { key, name: step.name, n, of };
}

/** The first thing to count in what is open now, for the home-screen counter; its name only, never its words. */
export function openDhikr(w: WaitingContext): OpenDhikr | null {
  for (const open of waitingNow(w)) {
    const def = defOf(open.mode);
    if (!def) continue;
    const c: ModeContext = { log: w.log, friday: w.friday, adhkar: w.adhkar, date: open.date };
    const step = stepsOf(def, w.log).find((s) => {
      if (!isCounted(s)) return false;
      const { n, of } = stepProgress(def.id, s, c);
      return n < of;
    });
    if (step) return dhikrOf(dhikrKey(def.id, open.date, step.id), { log: w.log, friday: w.friday, adhkar: w.adhkar });
  }
  return null;
}

export function dhikrItem(d: OpenDhikr, mode: string): LiveItem {
  return { id: "dhikr", title: d.name, detail: `${d.n} of ${d.of}`, count: d.n, of: d.of, key: d.key, link: `awqat://go/mode:${mode}` };
}

/** The timer the user started: a study, under its subject's name, or a workout, under what is planned today. */
export function timerItem(log: ModeLog, studyName: (trackId: string) => string | null, workoutName: string): LiveItem | null {
  if (!log.timer) return null;
  if (log.timer.trackId === WORKOUT_TIMER) {
    return { id: "timer", title: workoutName || "Workout", detail: "Training", startedAt: log.timer.startedAt, link: "awqat://go/body" };
  }
  const name = studyName(log.timer.trackId);
  return name ? { id: "timer", title: name, detail: "Studying", startedAt: log.timer.startedAt, link: `awqat://go/mode:study:${log.timer.trackId}` } : null;
}

/** Taps made with the app closed, added to the counts: each stops at its step's own number, and an unknown key is let go. */
export function applyTaps(log: ModeLog, taps: readonly LiveTap[], c: Omit<ModeContext, "date" | "log">): ModeLog {
  return taps.reduce((acc, tap) => {
    const k = readKey(tap.key);
    const found = k && Number.isInteger(tap.n) && tap.n > 0 ? dhikrOf(tap.key, { ...c, log: acc }) : null;
    if (!k || !found) return acc;
    return setStep(acc, k.date, k.mode, k.step, Math.min(found.of, stepCount(acc, k.date, k.mode, k.step) + tap.n));
  }, log);
}

export const startWorkoutTimer = (log: ModeLog, at: number): ModeLog => startTimer(log, WORKOUT_TIMER, at);
export const stopWorkoutTimer = (log: ModeLog): ModeLog => (log.timer?.trackId === WORKOUT_TIMER ? stopTimer(log) : log);

/** Starts as all three, so a run of the app ends whatever an earlier one left up that is no longer wanted. */
const shown = new Map<LiveId, string>(IDS.map((id) => [id, "?"]));
const RETRY_MS = 60_000;
const restAfterFailure = new Map<LiveId, number>();

/** Brings the native side to these items, changing only what differs; a failed call is tried again next time. */
export function syncLive(items: readonly LiveItem[]): void {
  if (!Capacitor.isNativePlatform()) return;
  const wanted = new Map(items.map((item) => [item.id, item]));
  for (const id of IDS) {
    const item = wanted.get(id);
    const was = shown.get(id);
    if (!item) {
      if (was !== undefined) {
        shown.delete(id);
        bridge.end({ id }).catch(() => undefined);
      }
    } else {
      const json = JSON.stringify(item);
      if (json !== was && (restAfterFailure.get(id) ?? 0) <= Date.now()) {
        shown.set(id, json);
        bridge.show(item).then(() => { restAfterFailure.delete(id); }, () => {
          // Off in the system's settings, most likely: this asks again in a while, not at every redraw.
          shown.delete(id);
          restAfterFailure.set(id, Date.now() + RETRY_MS);
        });
      }
    }
  }
}

/** Taps waiting from a widget or the island, and clears them. Nothing, where there is no native side. */
export async function drainTaps(): Promise<LiveTap[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const { taps } = await bridge.drain();
    return Array.isArray(taps) ? taps.filter((t) => typeof t?.key === "string" && typeof t?.n === "number") : [];
  } catch {
    return [];
  }
}
