/**
 * A calendar file (iCalendar, RFC 5545) read into the occurrences that fall in a window of days. ical.js (Mozilla,
 * MPL-2.0) does the parsing, the recurrence rules, the dates left out and the time zones the file carries. This
 * module is loaded only when a calendar is read, so the app starts without it.
 *
 * Two things are done here rather than left to ical.js. A time whose zone the file names but does not define (a
 * "TZID=Europe/London" with no VTIMEZONE) is read in that zone when the device knows it, and a time with no zone at
 * all in the place's zone; ical.js would take both as the device's clock. And a moved occurrence is matched to its
 * series by the instant it was moved from, so one written in UTC still finds a series written in a named zone.
 */
import ICAL from "ical.js";
import { cleanCalendarName } from "./calendars.ts";
import { isTimeZone, startOfDay, wallInstant } from "./days.ts";
import { LOCATION_MAX, OCCURRENCES_MAX, TITLE_MAX, type Occurrence } from "./occurrence.ts";

export { OCCURRENCES_MAX, type Occurrence };

export interface Window {
  /** The window's first day and the day after its last ("YYYY-MM-DD"), in `timeZone`. */
  firstDay: string;
  endDay: string;
  timeZone: string;
}

export interface ReadCalendar {
  /** The name the file gives itself, or "" when it gives none. */
  name: string;
  events: Occurrence[];
  /** Not every occurrence could be kept: more than OCCURRENCES_MAX, or the file took too long to read in full. */
  truncated: boolean;
}

/** How long one calendar may take to read before the rest of it is let go (the screen waits on it). */
export const READ_BUDGET_MS = 1500;
/** Steps through one recurring event at most: a daily event begun decades ago still reaches today. */
const STEPS_MAX = 500000;
/** How far outside the window a moved occurrence may begin and still be looked at. */
const SLACK_MS = 31 * 86400000;
/** Rules this frequent are not meetings; they are left out rather than stepped through. */
const TOO_FREQUENT = new Set(["SECONDLY", "MINUTELY"]);
/** A rule that repeats only every so many periods (a meeting every 50 million weeks) is not a meeting either: ical.js
 * can spend half a minute inside one step looking for its next occurrence. */
const INTERVAL_MAX = 1000;
/** One-off events that ended this long before the window are taken out before the file is parsed. */
const OLD_DAYS = 31;

type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalComponent = InstanceType<typeof ICAL.Component>;

/** What one read works with: the window in instants, the clock it must stop by, and what it found. */
interface Reader {
  window: Window;
  from: number;
  to: number;
  deadline: number;
  out: Occurrence[];
  cut: boolean;
}

/** One line, no control characters, at most `max` characters. */
function oneLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
}

const dateKey = (t: IcalTime): string =>
  `${String(t.year).padStart(4, "0")}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

const cancelled = (event: IcalEvent): boolean =>
  String(event.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";

/** The zone a component's times are read in when ical.js could not place them: the named one if known, else the place's. */
function zoneFor(component: IcalComponent, property: string, window: Window): string {
  const named = component.getFirstProperty(property)?.getParameter("tzid");
  return isTimeZone(named) ? named : window.timeZone;
}

/** When a time begins: a date at its midnight in the window's zone, a floating time in `zone`, else as the file says. */
function instant(t: IcalTime, window: Window, zone: string): number {
  if (t.isDate) return startOfDay(dateKey(t), window.timeZone);
  if (t.zone === ICAL.Timezone.localTimezone || t.zone?.tzid === "floating") return wallInstant(t, zone);
  return t.toJSDate().getTime();
}

/**
 * The occurrence from its start and end, when it falls in the window. `zone` is for the start; the end is read in the
 * zone its own property names (a meeting can begin in London and end in Dubai).
 */
function occurrence(event: IcalEvent, start: IcalTime, end: IcalTime | null, r: Reader, zone: string): Occurrence | null {
  if (cancelled(event)) return null;
  const from = instant(start, r.window, zone);
  const endZone = event.component.hasProperty("dtend") ? zoneFor(event.component, "dtend", r.window) : zone;
  let to = end ? instant(end, r.window, endZone) : from;
  // An all-day event with no end, or an end not after its start, is one day long.
  if (start.isDate && !(to > from)) {
    const next = start.clone();
    next.adjust(1, 0, 0, 0);
    to = instant(next, r.window, zone);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  to = Math.max(from, to);
  const inWindow = to > from ? from < r.to && to > r.from : from >= r.from && from < r.to;
  if (!inWindow) return null;
  const title = oneLine(event.summary, TITLE_MAX) || "Untitled";
  return { start: from, end: to, allDay: start.isDate, title, location: oneLine(event.location, LOCATION_MAX) };
}

/** A series' moved occurrences, by the instant each was moved from. */
function movedByInstant(exceptions: IcalComponent[], r: Reader): Map<number, IcalEvent> {
  const moved = new Map<number, IcalEvent>();
  for (const component of exceptions) {
    try {
      const event = new ICAL.Event(component, { exceptions: [] });
      const from = instant(event.recurrenceId, r.window, zoneFor(component, "recurrence-id", r.window));
      if (Number.isFinite(from)) moved.set(from, event);
    } catch {
      // A moved occurrence that cannot be read leaves its series as it was.
    }
  }
  return moved;
}

const movedOccurrence = (shifted: IcalEvent, r: Reader): Occurrence | null =>
  occurrence(shifted, shifted.startDate, shifted.endDate, r, zoneFor(shifted.component, "dtstart", r.window));

/** Every occurrence of a recurring event in the window, its moved and cancelled ones included. */
function expand(event: IcalEvent, exceptions: IcalComponent[], zone: string, r: Reader): void {
  const rule = event.component.getFirstPropertyValue("rrule") as { freq?: string; interval?: number } | null;
  if ((rule?.freq && TOO_FREQUENT.has(rule.freq)) || Number(rule?.interval ?? 1) > INTERVAL_MAX) return;
  const moved = movedByInstant(exceptions, r);
  const iterator = event.iterator();
  let reached = -Infinity;
  for (let step = 0; ; step++) {
    if (step >= STEPS_MAX || ((step & 255) === 0 && Date.now() > r.deadline)) {
      r.cut = true;
      return;
    }
    const next = iterator.next();
    if (!next) break;
    const at = instant(next, r.window, zone);
    // Occurrences come in order of where they were first put. One moved may land anywhere, so those nearby are read.
    if (at > r.to + SLACK_MS) break;
    reached = at;
    const shifted = moved.get(at);
    if (at < r.from - SLACK_MS && !shifted) continue;
    const found = shifted ? movedOccurrence(shifted, r) : occurrenceOf(event, next, r, zone);
    if (found) r.out.push(found);
  }
  // One moved here from further on than the series was read (a meeting next spring brought forward to this week).
  for (const [from, shifted] of moved) {
    const found = from > reached ? movedOccurrence(shifted, r) : null;
    if (found) r.out.push(found);
  }
}

/** One occurrence of a series as ical.js places it (a range of moved ones it handles itself). */
function occurrenceOf(event: IcalEvent, next: IcalTime, r: Reader, zone: string): Occurrence | null {
  const details = event.getOccurrenceDetails(next);
  const own = details.item === event ? zone : zoneFor(details.item.component, "dtstart", r.window);
  return occurrence(details.item, details.startDate, details.endDate, r, own);
}

function readOne(vevent: IcalComponent, exceptions: IcalComponent[], r: Reader): void {
  try {
    // Moved occurrences go to ical.js too, for the ones it can match itself (and ranges of them); the rest are
    // matched by instant in expand. Left to itself, ical.js ties every moved occurrence in the file to each event.
    const event = new ICAL.Event(vevent, { exceptions });
    if (!event.startDate) return;
    const zone = zoneFor(vevent, "dtstart", r.window);
    if (event.isRecurring()) return expand(event, exceptions, zone, r);
    const found = occurrence(event, event.startDate, event.endDate, r, zone);
    if (found) r.out.push(found);
  } catch {
    // One event that cannot be read does not cost the rest of the calendar.
  }
}

function registerZones(root: IcalComponent): void {
  // Each file brings its own zones; none is kept from a calendar read before.
  ICAL.TimezoneService.reset();
  for (const zone of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(zone);
    } catch {
      // A zone that cannot be read: times in it are read in the zone it is named for, or the place's.
    }
  }
}

/** All-day events come first on the day they begin. */
const sortKey = (o: Occurrence): number => (o.allDay ? o.start - 1 : o.start);

function occurrences(root: IcalComponent, r: Reader): void {
  const all = root.getAllSubcomponents("vevent");
  const uidOf = (c: IcalComponent) => String(c.getFirstPropertyValue("uid") ?? "");
  const moved = new Map<string, IcalComponent[]>();
  for (const vevent of all) {
    if (vevent.hasProperty("recurrence-id")) moved.set(uidOf(vevent), [...(moved.get(uidOf(vevent)) ?? []), vevent]);
  }
  const series = new Set<string>();
  for (const vevent of all) {
    if (Date.now() > r.deadline) {
      r.cut = true;
      return;
    }
    if (vevent.hasProperty("recurrence-id")) continue;
    series.add(uidOf(vevent));
    readOne(vevent, moved.get(uidOf(vevent)) ?? [], r);
  }
  // A moved occurrence whose series is not in the file stands on its own.
  for (const [uid, list] of moved) {
    if (!series.has(uid)) list.forEach((vevent) => readOne(vevent, [], r));
  }
}

const VEVENT_BEGIN = /^BEGIN:VEVENT\s*$/i;
const VEVENT_END = /^END:VEVENT\s*$/i;

/** Whether an event (its lines unfolded) can still touch the window: it repeats, or one of its dates is recent. */
function stillRelevant(lines: readonly string[], cutoff: string): boolean {
  const text = lines.join("\n").replace(/\n[ \t]/g, "");
  // Repeating, lasting a stated time (its end is not a date to compare), or moving a series: kept.
  if (/^(RRULE|RDATE|DURATION|RECURRENCE-ID)[;:]/im.test(text)) return true;
  const dates = [...text.matchAll(/^(?:DTSTART|DTEND|RECURRENCE-ID)[^:\n]*:(\d{8})/gim)].map((m) => m[1]);
  return dates.length === 0 || dates.some((d) => d >= cutoff);
}

/**
 * The file without its one-off events that ended long before the window. A calendar used for years carries thousands
 * of them, and parsing them all can take a gigabyte of memory on the phone. Repeating events are all kept.
 */
export function recentOnly(text: string, firstDay: string): string {
  const cutoff = new Date(Date.parse(`${firstDay}T00:00:00Z`) - OLD_DAYS * 86400000).toISOString().slice(0, 10)
    .replaceAll("-", "");
  const out: string[] = [];
  let block: string[] | null = null;
  // Lines are moved one at a time: spreading a block of a million lines would overflow the stack.
  const keep = (lines: readonly string[]) => { for (const l of lines) out.push(l); };
  for (const line of text.split(/\r?\n/)) {
    if (block) {
      block.push(line);
      if (VEVENT_END.test(line)) {
        if (stillRelevant(block, cutoff)) keep(block);
        block = null;
      }
    } else if (VEVENT_BEGIN.test(line)) block = [line];
    else out.push(line);
  }
  // An event never closed is kept as it is: the parser decides what it makes of it.
  if (block) keep(block);
  return out.join("\r\n");
}

/** The events of one calendar file that fall in the window, in order. Null when the text is not a calendar. */
export function readCalendar(text: string, window: Window, budgetMs = READ_BUDGET_MS): ReadCalendar | null {
  // The clock starts before parsing, so parsing and reading together keep within the budget.
  const deadline = Date.now() + budgetMs;
  let root: IcalComponent;
  try {
    // A byte-order mark (U+FEFF) before BEGIN:VCALENDAR, as some servers send, is let go.
    root = new ICAL.Component(ICAL.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    return null;
  }
  if (root.name !== "vcalendar") return null;
  const r: Reader = { window, from: startOfDay(window.firstDay, window.timeZone),
    to: startOfDay(window.endDay, window.timeZone), deadline, out: [], cut: false };
  registerZones(root);
  try {
    occurrences(root, r);
  } finally {
    ICAL.TimezoneService.reset();
  }
  const events = r.out.sort((a, b) => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title));
  return {
    name: cleanCalendarName(root.getFirstPropertyValue("x-wr-calname")),
    events: events.slice(0, OCCURRENCES_MAX),
    truncated: r.cut || events.length > OCCURRENCES_MAX,
  };
}
