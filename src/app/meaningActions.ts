/**
 * The Arabic, Sound and Meaning toggles above the adhkar and the du'a after the salam, and the translation fetched for
 * the list on screen (faith/meaning.ts): asked for only while Sound or Meaning is on, and put into the open list in
 * place as each text arrives, the screen held where the finger is, so a tap under way still lands on its dhikr. Never
 * while the list is scrolling: a fling keeps its speed.
 */
import { adhkarFor, type Session } from "../faith/adhkar.ts";
import { ADHKAR } from "../faith/adhkarData.ts";
import { DUAS } from "../faith/duaData.ts";
import {
  adhkarNeeds, dhikrMeaning, duaMeaning, duaNeeds, ensureMeanings, pruneMeanings, type Meaning, type Needs,
} from "../faith/meaning.ts";
import { defOf } from "../modes/registry.ts";
import type { AdhkarShow } from "../settings.ts";
import { KEYS } from "../store.ts";
import { markPaintedInPlace } from "../ui/counter.ts";
import { anchorFor, keepInPlace, paintMeanings } from "../ui/meaningView.ts";
import { announce, hooks, save, state } from "./state.ts";

const PARTS: Readonly<Record<keyof AdhkarShow, string>> = { arabic: "Arabic", sound: "Sound", meaning: "Meaning" };
/** A press older than this says nothing about where the finger is now. */
const PRESS_FRESH_MS = 30_000;
/** The list counts as still moving this long after its last scroll (a fling sends one at least every frame). */
const SCROLL_QUIET_MS = 180;

let press: { x: number; y: number; at: number } | null = null;
let lastScroll = -Infinity;
let paintTimer: ReturnType<typeof setTimeout> | undefined;

/** Where the finger last pressed, for holding the screen still while a translation goes in. */
export function notePress(event: PointerEvent): void {
  press = { x: event.clientX, y: event.clientY, at: Date.now() };
}

/** The list moved: what arrives waits until it stops. */
export function noteScroll(): void {
  lastScroll = Date.now();
}

const sessionOf = (screen: string): Session | null =>
  (screen === "adhkar:morning" ? "morning" : screen === "adhkar:evening" ? "evening" : null);

/** Each dhikr of a list, by id: what shows under its Arabic. */
export function adhkarMeanings(session: Session, now = Date.now()): Record<number, Meaning | null> {
  return Object.fromEntries(adhkarFor(session).map((item) => [item.id, dhikrMeaning(item, session, now)]));
}

/** Each of the du'as (duaData.ts), by id: what shows under its Arabic. */
export function duaMeanings(): Record<string, Meaning | null> {
  return Object.fromEntries(DUAS.map((d) => [d.id, duaMeaning(d.id)]));
}

/** What the screen needs fetched; null when it shows none (another screen, or Sound and Meaning both off). */
function needsOn(screen: string): Needs | null {
  const show = state.settings.adhkarShow;
  if (!show.sound && !show.meaning) return null;
  const session = sessionOf(screen);
  if (session) return adhkarNeeds(session);
  const def = screen.startsWith("mode:") ? defOf(screen.slice(5)) : null;
  const needs = def ? duaNeeds(def.groups.flatMap((g) => g.steps).flatMap((s) => (s.kind === "dua" ? [s.id] : []))) : null;
  return needs && needs.chapters.length > 0 ? needs : null;
}

/** What a block on `screen` shows, by its key ("a:9" a dhikr of the list, "d:ten" a du'a). */
function lookupOn(screen: string, now: number): (key: string) => Meaning | null {
  const session = sessionOf(screen);
  return (key) => {
    if (key.startsWith("d:")) return duaMeaning(key.slice(2));
    const item = session && key.startsWith("a:") ? ADHKAR.find((d) => d.id === Number(key.slice(2))) : undefined;
    return item && session ? dhikrMeaning(item, session, now) : null;
  };
}

/** What arrived, into the open list in place, once it is still: nothing it draws moves under the finger. */
function paintOnScreen(screen: string, now: number): void {
  if (typeof document === "undefined" || state.screen !== screen) return;
  const moving = Date.now() - lastScroll;
  clearTimeout(paintTimer);
  if (moving < SCROLL_QUIET_MS) {
    paintTimer = setTimeout(() => paintOnScreen(screen, now), SCROLL_QUIET_MS - moving);
    return;
  }
  const recent = press && Date.now() - press.at < PRESS_FRESH_MS ? press : null;
  keepInPlace(anchorFor(document, recent), () => paintMeanings(document, lookupOn(screen, now), state.settings.adhkarShow));
  markPaintedInPlace();
}

/**
 * Fetches what the list on screen shows, when it is not on the phone or is a week old, and fills each text in as it
 * comes. On any screen, Quran.com's words a week old are let go from the phone.
 */
export async function fetchMeanings(now = Date.now()): Promise<void> {
  const screen = state.screen;
  try {
    const needs = needsOn(screen);
    if (!needs) {
      await pruneMeanings(now);
      return;
    }
    // Left meanwhile: the next screen draws what is there when it opens.
    if (await ensureMeanings(needs, now, () => paintOnScreen(screen, now))) paintOnScreen(screen, now);
  } catch {
    // Nothing shown changes: the list keeps what it says, and the next open asks again.
  }
}

/** Reads the phone's copy at start-up, so a list opens with its translation already there. */
export async function warmUp(): Promise<void> {
  try {
    await pruneMeanings();
    if (needsOn(state.screen)) paintOnScreen(state.screen, Date.now());
  } catch {
    // The copy is read again the next time a list opens.
  }
}

/** A toggle: that part shown or hidden on every list, kept in Settings. Turned on, what it needs is fetched. */
export function toggleShow(part: string): void {
  if (!Object.hasOwn(PARTS, part)) return;
  const key = part as keyof AdhkarShow;
  const on = !state.settings.adhkarShow[key];
  const next = { ...state.settings.adhkarShow, [key]: on };
  // One of the three always stays on, so a dhikr always has words to read.
  if (!next.arabic && !next.sound && !next.meaning) {
    announce(`${PARTS[key]} stays on: keep one of Arabic, Sound or Meaning.`);
    return;
  }
  state.settings = { ...state.settings, adhkarShow: next };
  announce(`${PARTS[key]} ${on ? "on" : "off"}.`);
  // A save that fails says so (save() sets the notice); the choice holds for this session.
  void save(KEYS.settings, state.settings);
  hooks.render();
  if (on && key !== "arabic") void fetchMeanings();
}
