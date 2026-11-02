/** Agenda: the week strip, a day with its prayers between the meetings, the calendars in Settings, and Home's card. */
import { CALENDARS_MAX, maskAddress, type Calendar } from "../agenda/calendars.ts";
import {
  AGENDA_DAYS, eventsOn, nextUp, timeline, updatedAt, type Agenda, type CalendarRead, type ReadProblem, type Row,
} from "../agenda/agenda.ts";
import { daysFrom, keyOf } from "../agenda/days.ts";
import { PRAYER_LABEL, formatTime, type DayTimes } from "../prayer/times.ts";
import { untilPhrase } from "../prayer/window.ts";
import { deviceWord } from "./deviceWord.ts";
import { esc } from "./html.ts";

export interface AgendaModel {
  calendars: Calendar[];
  agenda: Agenda;
  /** The day shown, and today, in the place's zone. */
  day: string;
  today: string;
  /** The prayer days the app works from. */
  days: DayTimes[];
  tz: string;
  now: number;
  reading: boolean;
  busy: boolean;
  removeArmed: string | null;
}

const PROBLEM_TEXT: Readonly<Record<ReadProblem, string>> = {
  offline: "could not be reached just now",
  refused: "refused the address; it may have been reset, so copy the secret address again",
  notFound: "is no longer at that address; copy the secret address again",
  tooBig: "is too big, or too slow, to read on this device",
  notCalendar: "did not send a calendar; check the address",
  failed: "could not be read just now",
};

const time = (m: Pick<AgendaModel, "tz">, at: number): string => formatTime(new Date(at), m.tz);

function dayName(day: string, today: string, style: "short" | "long"): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  return style === "short"
    ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function weekStrip(m: AgendaModel): string {
  const days = daysFrom(m.today, AGENDA_DAYS);
  return `<div class="chips start" role="group" aria-label="Days">${days.map((day) => {
    const count = eventsOn(m.agenda, day, m.tz).length;
    const label = `${dayName(day, m.today, "long")}: ${count} event${count === 1 ? "" : "s"}`;
    return `<button type="button" class="chip${day === m.day ? " on" : ""}" data-action="agenda-day" data-value="${day}" ` +
      `aria-pressed="${day === m.day}" aria-label="${esc(label)}">${esc(dayName(day, m.today, "short"))}` +
      `${count ? ` <span class="soft">${count}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

function rowHtml(m: AgendaModel, row: Row): string {
  if (row.kind === "prayer") {
    return `<div class="row-item prayer-row${row.past ? " past" : ""}"><span class="label">${esc(PRAYER_LABEL[row.name])}` +
      `</span><span class="mono">${time(m, row.at)}</span></div>`;
  }
  const e = row.event;
  const when = e.allDay ? "All day" : `${time(m, e.start)} to ${time(m, e.end)}`;
  return `<div class="row-item event-row${row.past ? " past" : ""}${row.now ? " now" : ""}"><span class="col grow">` +
    `<span class="title">${esc(e.title)}</span>${e.location ? `<span class="small">${esc(e.location)}</span>` : ""}</span>` +
    `<span class="col end"><span class="mono">${esc(when)}</span>${row.now ? `<span class="small">Now</span>` : ""}` +
    `</span></div>`;
}

function dayCard(m: AgendaModel): string {
  const prayers = m.days.find((d) => d.date === m.day);
  const rows = timeline(m.agenda, m.day, prayers, m.tz, m.now);
  const meetings = rows.filter((r) => r.kind === "event").length;
  return `<section class="card"><div class="split"><h2 class="label">${esc(dayName(m.day, m.today, "long").toUpperCase())}` +
    `</h2><span class="small">${meetings ? `${meetings} on your calendar` : "Nothing on your calendar"}</span></div>` +
    `<div class="stack">${rows.map((r) => rowHtml(m, r)).join("")}</div></section>`;
}

/** A moment as its time today, or with its date on another day. */
function stamp(m: AgendaModel, at: number): string {
  return keyOf(at, m.tz) === m.today ? time(m, at) : new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: m.tz });
}

function readLine(m: AgendaModel): string {
  if (m.reading) return "Reading your calendars…";
  const at = updatedAt(m.agenda, m.calendars.map((c) => c.id));
  return at ? `Updated ${stamp(m, at)}.` : "Not read yet.";
}

function problems(m: AgendaModel): string {
  const lines = m.calendars.map((c) => ({ c, read: m.agenda.reads.find((r) => r.cal === c.id) }))
    .filter((x): x is { c: Calendar; read: CalendarRead } => Boolean(x.read?.problem))
    .map(({ c, read }) => `<p class="small">${esc(c.name)} ${esc(PROBLEM_TEXT[read.problem!])}` +
      `${read.ok ? `; the copy from ${esc(stamp(m, read.ok))} is shown` : ""}.</p>`);
  const cut = m.agenda.reads.some((r) => r.truncated)
    ? `<p class="small">A calendar could not be read in full (too many events, or too slow to read); some events may ` +
      `be missing.</p>` : "";
  return lines.join("") + cut;
}

export function addCalendarForm(busy: boolean): string {
  return `<form class="stack" data-form="calendar-add" autocomplete="off"><label class="small" for="calendar-address">` +
    `Secret address in iCal format</label><input id="calendar-address" class="field" name="ical-url" type="url" ` +
    `inputmode="url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="2048" required ` +
    `placeholder="https://calendar.google.com/…/basic.ics"><div class="row-buttons"><button type="submit" ` +
    `class="pill solid"${busy ? " disabled" : ""}>Add calendar</button></div></form>` +
    `<details class="small"><summary>Where to find it</summary><p class="small">Google Calendar, on a computer: ` +
    `Settings, then your calendar on the left, then Integrate calendar, then "Secret address in iCal format". A ` +
    `work account only shows it if its admin allows. iCloud: share the calendar as a public calendar and copy its ` +
    `link. Outlook: Settings, Calendar, Shared calendars, Publish a calendar, then the ICS link.</p><p class="small">` +
    `The address works like a password. It is kept on this ${deviceWord()} only and is never shown here in full.</p></details>`;
}

export function agendaView(m: AgendaModel, header: string, notice: string, chrome: string): string {
  if (m.calendars.length === 0) {
    return `<main class="screen single">${header}${notice}<section class="card"><h2 class="label">CONNECT A CALENDAR` +
      `</h2><p class="text">Agenda shows your meetings with the prayer times between them, for today and the seven days ` +
      `after. It reads your calendar's private address on this ${deviceWord()}; nothing is sent anywhere else.</p>` +
      `${addCalendarForm(m.busy)}</section></main>${chrome}`;
  }
  return `<main class="screen single">${header}${notice}${weekStrip(m)}${dayCard(m)}<section class="card">` +
    `<div class="split"><p class="small">${esc(readLine(m))}</p><button type="button" class="ghost-link" ` +
    `data-action="agenda-refresh"${m.reading || m.busy ? " disabled" : ""}>Refresh</button></div>${problems(m)}` +
    `</section></main>${chrome}`;
}

/** Settings: the calendars read, each shown by name and the end of its address, with a two-tap Remove. */
export function calendarsCard(m: AgendaModel): string {
  const rows = m.calendars.map((c) => {
    const armed = m.removeArmed === c.id;
    return `<div class="row-item"><span class="col grow"><span class="title">${esc(c.name)}</span><span class="small">` +
      `${esc(maskAddress(c.url))}</span></span><button type="button" class="ghost-link" data-action="calendar-remove" ` +
      `data-value="${esc(c.id)}"${m.busy ? " disabled" : ""}>${armed ? "Tap again to remove" : "Remove"}</button></div>`;
  }).join("");
  return `<section class="card"><h2 class="label">CALENDARS</h2>${rows ? `<div class="stack">${rows}</div>` : ""}` +
    `${m.calendars.length < CALENDARS_MAX ? addCalendarForm(m.busy)
      : `<p class="small">${CALENDARS_MAX} calendars is the most Agenda reads.</p>`}` +
    `</section>`;
}

/** Home: the meeting on now or next, when there are calendars. */
export function homeAgendaCard(m: AgendaModel): string {
  if (m.calendars.length === 0) return "";
  const up = nextUp(m.agenda, m.now);
  if (!up) {
    return `<button type="button" class="card link" data-go="agenda"><span class="col"><span class="label">AGENDA</span>` +
      `<span class="muted">Nothing more on your calendar this week</span></span></button>`;
  }
  const e = up.event;
  const day = keyOf(e.start, m.tz);
  const when = up.now ? `Now · until ${time(m, e.end)}`
    : `${day === m.today ? time(m, e.start) : `${dayName(day, m.today, "short")} ${time(m, e.start)}`} · ` +
      untilPhrase(new Date(m.now), new Date(e.start));
  return `<button type="button" class="card link" data-go="agenda"><span class="col"><span class="label">` +
    `${up.now ? "NOW" : "NEXT MEETING"}</span><span class="title">${esc(e.title)}</span><span class="small">` +
    `${esc(when)}</span></span></button>`;
}
