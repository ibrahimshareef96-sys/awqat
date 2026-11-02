/**
 * The agenda kept on the device: the occurrences each calendar gave for the week ahead, the last time each was read
 * and what went wrong if it could not be. It is a copy, so it can be lost without harm: a copy that cannot be read is
 * simply started again. A calendar that cannot be read keeps its last good week, with the time it was read. Each
 * calendar's read remembers the time zone it was read in: all-day events begin at that zone's midnight, so a new zone
 * reads it again.
 */
import type { WorkDue } from "../feeds/feeds.ts";
import { PRAYERS, type DayTimes, type PrayerName } from "../prayer/times.ts";
import { CALENDARS_MAX } from "./calendars.ts";
import { isTimeZone, parseDayKey, shiftKey, startOfDay, wallInstant } from "./days.ts";
import { LOCATION_MAX, OCCURRENCES_MAX, TITLE_MAX, type Occurrence } from "./occurrence.ts";

/** Today and the seven days after it. */
export const AGENDA_DAYS = 8;
/** A read older than this is read again when Agenda opens. */
export const FRESH_MS = 15 * 60 * 1000;

export type ReadProblem = "offline" | "refused" | "notFound" | "tooBig" | "notCalendar" | "failed";

export interface AgendaEvent extends Occurrence {
  /** The calendar it came from. */
  cal: string;
}

export interface CalendarRead {
  cal: string;
  /** When it was last read, whether or not that worked. */
  at: number;
  /** When it last gave a good copy; 0 for never. */
  ok: number;
  problem: ReadProblem | null;
  truncated: boolean;
  /** The place's time zone it was read in; "" for none known (a copy kept before it was remembered). */
  tz: string;
}

export interface Agenda {
  v: 1;
  /** The week the events are for: its first day and the day after its last, in the place's zone. */
  firstDay: string;
  endDay: string;
  events: AgendaEvent[];
  reads: CalendarRead[];
}

export const emptyAgenda = (firstDay = "1970-01-01"): Agenda =>
  ({ v: 1, firstDay, endDay: shiftKey(firstDay, AGENDA_DAYS), events: [], reads: [] });

export const PROBLEMS: readonly ReadProblem[] = ["offline", "refused", "notFound", "tooBig", "notCalendar", "failed"];

/** A time a Date can hold (within 275,000 years of 1970): a saved 1e300 would make every date format throw. */
const TIME_MAX = 8.64e15;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= TIME_MAX;
const text = (s: unknown, max: number): s is string => typeof s === "string" && Array.from(s).length <= max;

function checkEvent(raw: unknown, cals: ReadonlySet<string>): AgendaEvent | null {
  const e = raw as Partial<AgendaEvent> | null;
  if (!e || typeof e.cal !== "string" || !cals.has(e.cal) || !finite(e.start) || !finite(e.end) || e.end < e.start ||
    typeof e.allDay !== "boolean" || !text(e.title, TITLE_MAX) || !text(e.location, LOCATION_MAX)) return null;
  return { cal: e.cal, start: e.start, end: e.end, allDay: e.allDay, title: e.title, location: e.location };
}

function checkRead(raw: unknown, cals: ReadonlySet<string>): CalendarRead | null {
  const r = raw as Partial<CalendarRead> | null;
  if (!r || typeof r.cal !== "string" || !cals.has(r.cal) || !finite(r.at) || !finite(r.ok)) return null;
  const problem = r.problem === null || (PROBLEMS as readonly unknown[]).includes(r.problem) ? r.problem ?? null : null;
  return { cal: r.cal, at: r.at, ok: r.ok, problem, truncated: r.truncated === true, tz: isTimeZone(r.tz) ? r.tz : "" };
}

/** The kept agenda read back, holding only what belongs to the calendars still listed. */
export function checkAgenda(json: string | null, calendarIds: readonly string[]): Agenda {
  if (json === null) return emptyAgenda();
  try {
    const raw = JSON.parse(json) as Partial<Agenda> | null;
    const cals = new Set(calendarIds);
    if (!raw || raw.v !== 1 || typeof raw.firstDay !== "string" || !parseDayKey(raw.firstDay) ||
      !Array.isArray(raw.events) || raw.events.length > CALENDARS_MAX * OCCURRENCES_MAX || !Array.isArray(raw.reads) ||
      raw.reads.length > CALENDARS_MAX) return emptyAgenda();
    // Only events near the week they were read for: anything far outside it was never written by a read.
    const near = Date.parse(`${raw.firstDay}T00:00:00Z`);
    const close = (e: AgendaEvent) => e.end >= near - 2 * 86400000 && e.start <= near + (AGENDA_DAYS + 2) * 86400000;
    return {
      v: 1, firstDay: raw.firstDay, endDay: shiftKey(raw.firstDay, AGENDA_DAYS),
      events: raw.events.map((e) => checkEvent(e, cals)).filter((e): e is AgendaEvent => e !== null && close(e)),
      reads: raw.reads.map((r) => checkRead(r, cals)).filter((r): r is CalendarRead => r !== null)
        .filter((r, i, all) => all.findIndex((o) => o.cal === r.cal) === i),
    };
  } catch {
    return emptyAgenda();
  }
}

export type ReadOutcome = { events: Occurrence[]; truncated: boolean } | { problem: ReadProblem };

/**
 * One calendar's read put into the agenda for the week from `firstDay`. A good read replaces that calendar's
 * events; a failed one keeps them, as long as they are for the same week. Another week drops what is outside it. A
 * failed read in another time zone than that calendar's last keeps its meetings (their times are instants) and lets
 * its all-day events go: they begin at the old zone's midnight, so they would stand on the wrong days.
 */
export function withRead(agenda: Agenda, cal: string, outcome: ReadOutcome, firstDay: string, tz: string,
  now: number): Agenda {
  const endDay = shiftKey(firstDay, AGENDA_DAYS);
  const from = startOfDay(firstDay, tz);
  const to = startOfDay(endDay, tz);
  const inWeek = (e: Occurrence) => (e.end > e.start ? e.start < to && e.end > from : e.start >= from && e.start < to);
  const before = agenda.reads.find((r) => r.cal === cal);
  const failed = "problem" in outcome;
  const zoneMoved = before !== undefined && before.tz !== tz;
  const kept = agenda.events.filter((e) => inWeek(e) && (e.cal !== cal || (failed && !(zoneMoved && e.allDay))));
  const added = "problem" in outcome ? [] : outcome.events.filter(inWeek).map((e) => ({ ...e, cal }));
  const read: CalendarRead = "problem" in outcome
    ? { cal, at: now, ok: before?.ok ?? 0, problem: outcome.problem, truncated: before?.truncated ?? false, tz }
    : { cal, at: now, ok: now, problem: null, truncated: outcome.truncated, tz };
  return {
    v: 1, firstDay, endDay, events: [...kept, ...added].sort(byStart),
    reads: [...agenda.reads.filter((r) => r.cal !== cal), read],
  };
}

/** A calendar removed: its events and its read go with it. */
export function withoutCalendar(agenda: Agenda, cal: string): Agenda {
  return { ...agenda, events: agenda.events.filter((e) => e.cal !== cal), reads: agenda.reads.filter((r) => r.cal !== cal) };
}

const sortKey = (e: Occurrence): number => (e.allDay ? e.start - 1 : e.start);
const byStart = (a: Occurrence, b: Occurrence): number => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title);

/**
 * True when a calendar has never been read, was read more than FRESH_MS ago or in another time zone than the place's
 * now, or the agenda is for another week.
 */
export function needsRead(agenda: Agenda, calendarIds: readonly string[], firstDay: string, now: number, tz: string): boolean {
  if (calendarIds.length === 0) return false;
  if (agenda.firstDay !== firstDay) return true;
  return calendarIds.some((cal) => {
    const read = agenda.reads.find((r) => r.cal === cal);
    return !read || read.tz !== tz || now - read.at > FRESH_MS || now < read.at;
  });
}

export type Row =
  | { kind: "event"; event: AgendaEvent; past: boolean; now: boolean }
  | { kind: "prayer"; name: PrayerName; at: number; past: boolean }
  /** Work due that day from the user's Work feed, read only; `at` is null for one with no time. */
  | { kind: "due"; item: WorkDue; at: number | null; past: boolean };

/** The events on a day (all-day first), each one that touches it, including one carried over from the day before. */
export function eventsOn(agenda: Agenda, day: string, tz: string): AgendaEvent[] {
  const from = startOfDay(day, tz);
  const to = startOfDay(shiftKey(day, 1), tz);
  return agenda.events.filter((e) => (e.end > e.start ? e.start < to && e.end > from : e.start >= from && e.start < to))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || byStart(a, b));
}

/** When a due item's time falls on its day, on the place's clock; null with no time. */
function dueAt(item: WorkDue, tz: string): number | null {
  const day = parseDayKey(item.date);
  if (!day || !item.time) return null;
  const [hour, minute] = item.time.split(":").map(Number);
  const at = wallInstant({ year: day.y, month: day.m, day: day.d, hour, minute, second: 0 }, tz);
  return Number.isFinite(at) ? at : null;
}

/** At the same minute a prayer comes first, then what is due, then a meeting: the meeting waits for the prayer. */
const KIND_ORDER: Readonly<Record<Row["kind"], number>> = { prayer: 0, due: 1, event: 2 };

/**
 * A day as it is lived: work due with no time, its all-day events, then the five prayers, meetings and work due at a
 * time in the order they come.
 */
export function timeline(agenda: Agenda, day: string, prayers: DayTimes | undefined, tz: string, now: number,
  due: readonly WorkDue[] = []): Row[] {
  const from = startOfDay(day, tz);
  const events = eventsOn(agenda, day, tz);
  const dues = due.filter((item) => item.date === day).map((item) => ({ item, at: dueAt(item, tz) }));
  const untimed: Row[] = dues.filter((d) => d.at === null).map(({ item }) => ({ kind: "due", item, at: null, past: false }));
  const dueTimed = dues.flatMap(({ item, at }) => (at === null ? [] : [{ at, row: { kind: "due", item, at, past: at <= now } as Row }]));
  const allDay: Row[] = events.filter((e) => e.allDay).map((event) => ({ kind: "event", event, past: event.end <= now,
    now: false }));
  const timed = events.filter((e) => !e.allDay).map((event) => ({ at: Math.max(event.start, from), row: { kind: "event",
    event, past: event.end <= now && event.start < now, now: event.start <= now && now < event.end } as Row }));
  const marks = prayers ? PRAYERS.map((name) => ({ at: prayers[name].getTime(), row: { kind: "prayer", name,
    at: prayers[name].getTime(), past: prayers[name].getTime() <= now } as Row })) : [];
  const ordered = [...marks, ...dueTimed, ...timed].sort((a, b) => a.at - b.at || KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind]);
  return [...untimed, ...allDay, ...ordered.map((o) => o.row)];
}

/** The meeting on now, or the next one to begin; all-day events are not meetings. */
export function nextUp(agenda: Agenda, now: number): { event: AgendaEvent; now: boolean } | null {
  const timed = agenda.events.filter((e) => !e.allDay);
  const running = timed.find((e) => e.start <= now && now < e.end);
  if (running) return { event: running, now: true };
  const next = timed.filter((e) => e.start > now).sort((a, b) => a.start - b.start)[0];
  return next ? { event: next, now: false } : null;
}

/** When the agenda last had a good copy of every calendar (the oldest of them), or 0 when one has none. */
export function updatedAt(agenda: Agenda, calendarIds: readonly string[]): number {
  if (calendarIds.length === 0) return 0;
  const oks = calendarIds.map((cal) => agenda.reads.find((r) => r.cal === cal)?.ok ?? 0);
  return Math.min(...oks);
}
