/**
 * What the adhkar lists do: count a dhikr one at a time, or all at once, for the day it is said on. A count shows at
 * once and is saved in order behind it (a hundred quick taps make one save at a time, the last with every tap in it).
 * A set finished, or opened again, plans the reminders again. Nothing scrolls or moves on its own, so a finger counting
 * fast never lands on the next dhikr.
 */
import {
  SESSION_NAME, addOne, adhkarFor, backOne, countOf, isComplete, progress, setDone, type AdhkarLog, type Session,
} from "../faith/adhkar.ts";
import { prayerDayIndex } from "../prayer/window.ts";
import { KEYS } from "../store.ts";
import { paintAdhkarTotal, paintDhikrCard } from "../ui/adhkarView.ts";
import { feelCount } from "./feel.ts";
import { MESSAGES, announce, hooks, save, setNotice, state } from "./state.ts";

let writing: Promise<void> = Promise.resolve();
let queued = false;

/** The set on screen, when an adhkar list is open. */
export function openSession(): Session | null {
  return state.screen === "adhkar:morning" ? "morning" : state.screen === "adhkar:evening" ? "evening" : null;
}

/** The day a count belongs to: the prayer day (Fajr to Fajr), so an evening said after midnight keeps its evening. */
export function adhkarDate(now = new Date()): string | null {
  return state.days.length > 0 ? state.days[prayerDayIndex(state.days, now)].date : null;
}

/** The end of Al-Baqarah is read at night: before that day's Maghrib it waits, and this is when it opens. */
export function lockedUntil(session: Session, id: number, date: string, now = new Date()): Date | null {
  if (!adhkarFor(session).find((item) => item.id === id)?.night) return null;
  const day = state.days.find((d) => d.date === date);
  return day && now.getTime() < day.maghrib.getTime() ? day.maghrib : null;
}

/** The saves still to finish (for tests, and for nothing else to wait on). */
export function saved(): Promise<void> {
  return writing;
}

/** One save at a time, each of the log as it is when its turn comes; a save waiting already covers a new tap. */
function persist(): void {
  if (queued) return;
  queued = true;
  writing = writing.then(async () => {
    queued = false;
    try {
      // A save that fails says so (save() sets the notice); the counts stay on screen and the next tap tries again.
      if (!(await save(KEYS.adhkar, state.adhkar))) hooks.render();
    } catch {
      // A redraw that failed: the chain goes on, so later taps are still saved.
    }
  });
}

function change(value: string, now: Date, next: (log: AdhkarLog, date: string, session: Session, id: number) => AdhkarLog):
  void {
  const session = openSession();
  const id = Number(value);
  const date = adhkarDate(now);
  const item = session ? adhkarFor(session).find((i) => i.id === id) : undefined;
  if (!session || !item || !date || lockedUntil(session, id, date, now)) return;
  if (state.blocked.has(KEYS.adhkar)) {
    setNotice(MESSAGES.unreadable);
    hooks.render();
    return;
  }
  const before = state.adhkar;
  const after = next(before, date, session, id);
  if (after === before) return;
  state.adhkar = after;
  persist();
  // On the card itself where it can be, so the ring runs on from where it is; a redraw would start it again.
  const counted = countOf(after, date, session, id);
  const grew = counted > countOf(before, date, session, id);
  if (typeof document !== "undefined" && paintDhikrCard(document, `[data-dhikr="${id}"]`, counted, item.count, grew)) {
    const total = progress(after, date, session);
    paintAdhkarTotal(document, total.done, total.total);
    if (grew) feelCount(counted >= item.count);
  } else {
    hooks.render();
  }
  const complete = isComplete(after, date, session);
  announce(complete && !isComplete(before, date, session) ? `${SESSION_NAME[session]} complete.`
    : `${item.name}: ${countOf(after, date, session, id)} of ${item.count}.`);
  // The reminder goes once what can be said before the best time ends is said (adhkar.ts planAdhkar), and comes back
  // when that is opened again.
  if (isComplete(after, date, session, false) !== isComplete(before, date, session, false)) void hooks.reschedule();
}

/** One more time said. */
export function count(value: string, now = new Date()): void {
  change(value, now, addOne);
}

/** One fewer, for a tap that slipped. */
export function takeBack(value: string, now = new Date()): void {
  change(value, now, backOne);
}

/** Said in full at once, or, when it already was, back to none. */
export function toggleDone(value: string, now = new Date()): void {
  change(value, now, (log, date, session, id) => {
    const item = adhkarFor(session).find((i) => i.id === id);
    return setDone(log, date, session, id, !item || countOf(log, date, session, id) < item.count);
  });
}
