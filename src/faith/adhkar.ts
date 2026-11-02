/**
 * The morning and evening adhkar (Hisn al-Muslim's set, in adhkarData.ts): the count of each item kept per day, when
 * each set is open, and its reminder. The morning is open from Fajr to Dhuhr and best before sunrise; the evening from
 * Asr to the middle of the night (halfway from Maghrib to the next Fajr) and best before Maghrib. Every change returns
 * a new log.
 */
import { iqamaAt } from "../prayer/iqama.ts";
import { formatTime, type DayTimes } from "../prayer/times.ts";
import { ADHKAR_SLOT, type Reminder } from "../reminders/plan.ts";
import { ADHKAR } from "./adhkarData.ts";

export type Session = "morning" | "evening";
export const SESSIONS: readonly Session[] = ["morning", "evening"];

export const SESSION_NAME: Readonly<Record<Session, string>> = {
  morning: "Adhkar al-Sabah",
  evening: "Adhkar al-Masa",
};

export interface Dhikr {
  /** The dataset's order number, kept as the item's id in the log. */
  id: number;
  sessions: readonly Session[];
  /** How many times it is said. */
  count: number;
  /** The same, in the book's Arabic ("ثَلَاثُ مَرَّاتٍ"). */
  times: string;
  /** A short English name, ours (the dataset's English copies printed translations). */
  name: string;
  /** The Arabic words; for a Quran item only what is said before it, or "". */
  text: string;
  /** Where the hadith is found, in the book's Arabic. */
  source: string;
  /** A Quran item: read from the mushaf, never shown here; `words` says which, when not the whole of the ayahs. */
  quran?: { sura: number; from: number; to: number; words?: string };
  /** Read at night, so from Maghrib (the last two verses of Al-Baqarah). */
  night?: true;
}

export interface AdhkarLog {
  v: 1;
  /** By the date the set was opened on (YYYY-MM-DD), then the set, then the item's id: how many times it was said. */
  days: Record<string, Partial<Record<Session, Record<string, number>>>>;
}

/**
 * Days of counts kept; older ones go with the next change. Ten years since v0.12 (it was 14 days): the adhkar are
 * tracked over time now, and a day dropped here would be dropped on the user's other devices too.
 */
export const ADHKAR_KEEP_DAYS = 3660;
/**
 * Days ahead the reminders are planned for. The prayer reminders come first for the 60 pending iOS allows: three days
 * of adhkar keep about ten days of prayers (the app plans again whenever it opens).
 */
export const ADHKAR_PLAN_DAYS = 3;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** The reminder comes this long after the iqama (time to pray first), and at least this long before the best time ends. */
const AFTER_IQAMA_MS = 10 * MINUTE_MS;
const BEFORE_END_MS = 15 * MINUTE_MS;

const LISTS: Readonly<Record<Session, readonly Dhikr[]>> = {
  morning: ADHKAR.filter((item) => item.sessions.includes("morning")),
  evening: ADHKAR.filter((item) => item.sessions.includes("evening")),
};

export function adhkarFor(session: Session): readonly Dhikr[] {
  return LISTS[session];
}

const isSession = (value: string): value is Session => value === "morning" || value === "evening";
const itemIn = (session: Session, id: number): Dhikr | undefined => LISTS[session].find((item) => item.id === id);

export function emptyAdhkarLog(): AdhkarLog {
  return { v: 1, days: {} };
}

export function countOf(log: AdhkarLog, date: string, session: Session, id: number): number {
  return log.days[date]?.[session]?.[String(id)] ?? 0;
}

/** The log without the oldest days past ADHKAR_KEEP_DAYS. */
function keepRecent(log: AdhkarLog): AdhkarLog {
  const dates = Object.keys(log.days).sort();
  if (dates.length <= ADHKAR_KEEP_DAYS) return log;
  const kept = new Set(dates.slice(-ADHKAR_KEEP_DAYS));
  return { ...log, days: Object.fromEntries(Object.entries(log.days).filter(([date]) => kept.has(date))) };
}

/** Sets an item's count (0 removes it, and a set or day left empty goes too). */
function withCount(log: AdhkarLog, date: string, session: Session, id: number, count: number): AdhkarLog {
  const { [date]: day = {}, ...otherDays } = log.days;
  const { [session]: counts = {}, ...otherSessions } = day;
  const { [String(id)]: _old, ...otherCounts } = counts;
  const nextCounts = count > 0 ? { ...otherCounts, [String(id)]: count } : otherCounts;
  const nextDay = Object.keys(nextCounts).length > 0 ? { ...otherSessions, [session]: nextCounts } : otherSessions;
  const days = Object.keys(nextDay).length > 0 ? { ...otherDays, [date]: nextDay } : otherDays;
  return keepRecent({ ...log, days });
}

/** One more time said, up to the item's count. An item not in that set, or a date that is not one, changes nothing. */
export function addOne(log: AdhkarLog, date: string, session: Session, id: number): AdhkarLog {
  const item = itemIn(session, id);
  if (!item || !DAY_KEY.test(date)) return log;
  const now = countOf(log, date, session, id);
  return now >= item.count ? log : withCount(log, date, session, id, now + 1);
}

/** One fewer, for a tap that slipped; never below none. */
export function backOne(log: AdhkarLog, date: string, session: Session, id: number): AdhkarLog {
  const item = itemIn(session, id);
  if (!item || !DAY_KEY.test(date)) return log;
  const now = countOf(log, date, session, id);
  return now <= 0 ? log : withCount(log, date, session, id, now - 1);
}

/** The whole count at once (said from memory, or on beads), or back to none. */
export function setDone(log: AdhkarLog, date: string, session: Session, id: number, done: boolean): AdhkarLog {
  const item = itemIn(session, id);
  if (!item || !DAY_KEY.test(date)) return log;
  return withCount(log, date, session, id, done ? item.count : 0);
}

export function progress(log: AdhkarLog, date: string, session: Session): { done: number; total: number } {
  const list = LISTS[session];
  return { done: list.filter((item) => countOf(log, date, session, item.id) >= item.count).length, total: list.length };
}

const dayBefore = (date: string): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Days in a row with the set said in full, ending today, or yesterday while today's is still to say. */
export function adhkarStreak(log: AdhkarLog, today: string, session: Session): number {
  let day = isComplete(log, today, session) ? today : dayBefore(today);
  let streak = 0;
  while (streak < ADHKAR_KEEP_DAYS && isComplete(log, day, session)) {
    streak += 1;
    day = dayBefore(day);
  }
  return streak;
}

/** The last seven days, oldest first: whether each set was said in full. */
export function adhkarWeek(log: AdhkarLog, today: string): { date: string; morning: boolean; evening: boolean }[] {
  const days = [today];
  while (days.length < 7) days.unshift(dayBefore(days[0]));
  return days.map((date) => ({ date, morning: isComplete(log, date, "morning"), evening: isComplete(log, date, "evening") }));
}

/**
 * Every item said in full. Without `withNight`, the items read at night (the end of Al-Baqarah, from Maghrib) are left
 * out: what can be said before Maghrib is all said, so the evening's reminder and Home's card can go until then.
 */
export function isComplete(log: AdhkarLog, date: string, session: Session, withNight = true): boolean {
  return LISTS[session].every((item) => (!withNight && item.night) || countOf(log, date, session, item.id) >= item.count);
}

/** Reads a saved log back: only real days, sets and items, whole counts from 1, capped at each item's count. */
export function checkAdhkarLog(json: string | null): { log: AdhkarLog; damaged: boolean } {
  if (json === null) return { log: emptyAdhkarLog(), damaged: false };
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null;
    if (typeof raw !== "object" || raw === null || raw.v !== 1) return { log: emptyAdhkarLog(), damaged: true };
    const source = typeof raw.days === "object" && raw.days !== null ? (raw.days as Record<string, unknown>) : {};
    // Built in one pass and trimmed once (years of days are kept since v0.12; a copy per count would take minutes).
    const days: AdhkarLog["days"] = {};
    for (const [date, day] of Object.entries(source)) {
      if (!DAY_KEY.test(date) || typeof day !== "object" || day === null) continue;
      const kept: Partial<Record<Session, Record<string, number>>> = {};
      for (const [session, counts] of Object.entries(day as Record<string, unknown>)) {
        if (!isSession(session) || typeof counts !== "object" || counts === null) continue;
        const said: Record<string, number> = {};
        for (const [id, count] of Object.entries(counts as Record<string, unknown>)) {
          const item = itemIn(session, Number(id));
          if (!item || String(item.id) !== id || typeof count !== "number" || !Number.isInteger(count) || count < 1) {
            continue;
          }
          said[id] = Math.min(count, item.count);
        }
        if (Object.keys(said).length > 0) kept[session] = said;
      }
      if (Object.keys(kept).length > 0) days[date] = kept;
    }
    return { log: keepRecent({ v: 1, days }), damaged: false };
  } catch {
    return { log: emptyAdhkarLog(), damaged: true };
  }
}

export interface AdhkarWindow {
  session: Session;
  /** The day the set belongs to (the evening keeps its day past midnight). */
  date: string;
  start: Date;
  end: Date;
  /** The best time ends: sunrise for the morning, Maghrib for the evening. */
  bestBefore: Date;
}

/** Halfway from a day's Maghrib to the next day's Fajr. */
export function islamicMidnight(day: DayTimes, next: DayTimes): Date {
  return new Date(day.maghrib.getTime() + (next.fajr.getTime() - day.maghrib.getTime()) / 2);
}

const utcNoon = (key: string): number => Date.parse(`${key}T12:00:00Z`);

/** `next` is the very next calendar day after `day`: what a day's evening (or its Isha) needs to know its end. */
export const isNextDay = (day: DayTimes, next: DayTimes | undefined): next is DayTimes =>
  next !== undefined && utcNoon(next.date) - utcNoon(day.date) === DAY_MS;
const inside = (now: Date, start: Date, end: Date): boolean =>
  now.getTime() >= start.getTime() && now.getTime() < end.getTime();

/** The set open now, or null between Dhuhr and Asr and from the middle of the night to Fajr. */
export function adhkarWindow(days: readonly DayTimes[], now: Date): AdhkarWindow | null {
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    if (inside(now, day.fajr, day.dhuhr)) {
      return { session: "morning", date: day.date, start: day.fajr, end: day.dhuhr, bestBefore: day.sunrise };
    }
    const next = days[i + 1];
    // The evening's end needs the next day's Fajr, so the next day must be the very next one.
    if (!isNextDay(day, next)) continue;
    const end = islamicMidnight(day, next);
    if (inside(now, day.asr, end)) {
      return { session: "evening", date: day.date, start: day.asr, end, bestBefore: day.maghrib };
    }
  }
  return null;
}

const adhkarId = (date: string, session: Session): number =>
  Number(date.replaceAll("-", "")) * 10 + ADHKAR_SLOT[session];

/** Ten minutes after the iqama (Fajr's or Asr's), but at least fifteen before the best time ends, and never before the adhan. */
function reminderTime(day: DayTimes, session: Session): Date {
  const adhan = session === "morning" ? day.fajr : day.asr;
  const bestBefore = session === "morning" ? day.sunrise : day.maghrib;
  const iqama = iqamaAt(day, session === "morning" ? "fajr" : "asr") ?? adhan;
  const latest = bestBefore.getTime() - BEFORE_END_MS;
  return new Date(Math.max(adhan.getTime(), Math.min(iqama.getTime() + AFTER_IQAMA_MS, latest)));
}

/**
 * One reminder for each set each day, for the next ADHKAR_PLAN_DAYS, until what that day's set can be said before its
 * best time ends is said (the end of Al-Baqarah waits for Maghrib, so it never holds the evening's reminder).
 */
export function planAdhkar(days: readonly DayTimes[], now: Date, options: { enabled: boolean; log: AdhkarLog },
  timeZone?: string): Reminder[] {
  if (!options.enabled) return [];
  const horizon = now.getTime() + ADHKAR_PLAN_DAYS * DAY_MS;
  return days.flatMap((day) => SESSIONS.map((session): Reminder => {
    const bestBefore = session === "morning" ? day.sunrise : day.maghrib;
    const until = session === "morning" ? "sunrise" : "Maghrib";
    return { id: adhkarId(day.date, session), title: SESSION_NAME[session], at: reminderTime(day, session),
      body: `Best before ${until}, ${formatTime(bestBefore, timeZone)}.` };
  }).filter((r, i) => Number.isFinite(r.at.getTime()) && r.at.getTime() > now.getTime() && r.at.getTime() <= horizon &&
    !isComplete(options.log, day.date, SESSIONS[i], false)));
}
