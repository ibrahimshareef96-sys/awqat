/**
 * The Weekly Review's look ahead: the seven days from today in a few lines. Friday always; the rest only for what the
 * user has set up (calendars, a revision plan, a training plan or target, a Work feed from their own server). Pure.
 */
import { eventsOn, type Agenda } from "../agenda/agenda.ts";
import { daysFrom, shiftKey } from "../agenda/days.ts";
import type { BodyLog } from "../body/body.ts";
import { planFor } from "../body/training.ts";
import { isFriday } from "../faith/friday.ts";
import type { WorkDue } from "../feeds/feeds.ts";
import type { MurajaahPlan } from "../quran/murajaah.ts";

export const AHEAD_DAYS = 7;
/** Work items named at most; the rest are counted. */
const WORK_SHOWN = 3;

export interface AheadInput {
  today: string;
  tz: string;
  now: number;
  /** How many calendars are connected: the meetings line is only for someone with one. */
  calendars: number;
  agenda: Agenda;
  murajaah: MurajaahPlan | null;
  body: BodyLog;
  /** What the Work feed has due, when a backend is set and the feed has been read; null otherwise. */
  due: readonly WorkDue[] | null;
}

const weekday = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const dayMonth = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** Meetings still to come on each day (all-day events are not meetings). */
function meetingsLine(m: AheadInput, days: readonly string[]): string[] {
  if (m.calendars === 0) return [];
  // A read that failed is not an empty week: "none" only from a calendar that gave a good copy.
  if (!m.agenda.reads.some((r) => r.ok > 0)) return ["Meetings: your calendars have not been read yet"];
  const counts = days.map((day) => ({ day, n: eventsOn(m.agenda, day, m.tz).filter((e) => !e.allDay && e.end > m.now).length }))
    .filter((d) => d.n > 0);
  if (counts.length === 0) return ["Meetings: none on your calendars"];
  return [`Meetings: ${counts.map((d) => `${d.day === m.today ? "Today" : weekday(d.day)} ${d.n}`).join(", ")}`];
}

function fridayLine(m: AheadInput, days: readonly string[]): string[] {
  const friday = days.find(isFriday);
  if (!friday) return [];
  return [`${friday === m.today ? "Friday is today" : `Friday ${dayMonth(friday)}`}: Jumu'ah, and Surah Al-Kahf`];
}

function revisionLine(m: AheadInput): string[] {
  const plan = m.murajaah;
  if (!plan) return [];
  const cycle = Math.ceil(plan.juz.length / plan.perDay);
  return [`Quran revision: ${plan.perDay} juz a day, your ${plan.juz.length} juz round every ${cycle === 1 ? "day" : `${cycle} days`}`];
}

function trainingLine(m: AheadInput, days: readonly string[]): string[] {
  const planned = days.flatMap((day) => {
    const plan = planFor(m.body, day);
    return plan ? [`${weekday(day)} ${plan}`] : [];
  });
  const target = m.body.weeklyTarget ? `${m.body.weeklyTarget} days a week` : "";
  if (planned.length === 0 && !target) return [];
  return [`Training: ${[planned.join(", "), target].filter(Boolean).join("; ")}`];
}

function workLine(m: AheadInput): string[] {
  if (m.due === null) return [];
  const end = shiftKey(m.today, AHEAD_DAYS);
  const due = m.due.filter((d) => d.date >= m.today && d.date < end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (due.length === 0) return [`Work: nothing due in the next ${AHEAD_DAYS} days`];
  const named = due.slice(0, WORK_SHOWN).map((d) => `${weekday(d.date)} ${d.text}`);
  const more = due.length - named.length;
  return [`Work due: ${named.join("; ")}${more > 0 ? `; and ${more} more` : ""}`];
}

/** The next seven days in a few lines: meetings, Friday, revision, training, work. */
export function lookAhead(m: AheadInput): string[] {
  const days = daysFrom(m.today, AHEAD_DAYS);
  return [...meetingsLine(m, days), ...fridayLine(m, days), ...revisionLine(m), ...trainingLine(m, days), ...workLine(m)];
}
