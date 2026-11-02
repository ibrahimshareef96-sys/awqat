/**
 * What the app knows about today, in words, for the assistant. Sent as the {{life}} variable when a talk starts:
 * the date, the next prayer and today's times with iqama, the user's prayer marks and adhkar, the calendar for the
 * rest of today and tomorrow, the books being read, the week's intentions and the weather. Calendar and book titles
 * are user data from outside the app, so they are cleaned and cut here, as the intentions are. The agent's prompt
 * fences the whole block as data.
 * Pure: the caller passes in state.
 */
import type { Agenda } from "../agenda/agenda.ts";
import { eventsOn } from "../agenda/agenda.ts";
import { shiftKey } from "../agenda/days.ts";
import type { AdhkarLog } from "../faith/adhkar.ts";
import { progress } from "../faith/adhkar.ts";
import type { Library } from "../books/library.ts";
import { currentPage, inHand } from "../books/library.ts";
import type { BodyLog } from "../body/body.ts";
import type { BodySummary } from "../body/summary.ts";
import { dayDone, planFor } from "../body/training.ts";
import { activeTracks, formatMinutes, weekMinutes, type Learn } from "../learn/learn.ts";
import { monthSummary, type Money } from "../money/money.ts";
import { dueLessons } from "../learn/review.ts";
import { PAGES } from "../quran/data.ts";
import { pagesOn, readingStreak, type QuranLog } from "../quran/log.ts";
import type { Intention } from "../review/muhasabah.ts";
import { hijriDate } from "../prayer/hijri.ts";
import { iqamaAt } from "../prayer/iqama.ts";
import type { PrayerLog } from "../prayer/log.ts";
import { PRAYERS, PRAYER_LABEL, formatTime, type DayTimes } from "../prayer/times.ts";
import { cleanShown } from "./text.ts";
import { weatherText, type Weather } from "./weather.ts";

export interface LifeInput {
  now: Date;
  /** Today's key (YYYY-MM-DD) in the place's zone. */
  today: string;
  tz: string;
  place: string;
  days: readonly DayTimes[];
  log: PrayerLog;
  adhkar: AdhkarLog;
  agenda: Agenda;
  library: Library;
  weather: Weather | null;
  quran: QuranLog;
  learn: Learn;
  body: BodyLog;
  /** What the health store last gave, only when the user has allowed the assistant to hear it; otherwise null. */
  health: BodySummary | null;
  /** The user's money, only when the user has allowed the assistant to hear it. */
  money: Money | null;
  /** The intentions the user set for the week in the Weekly Review, as Home shows them; none, none said. */
  intentions: readonly Intention[];
}

/** What one variable may hold: room for a full day, small next to the prompt. */
export const LIFE_MAX = 3000;

/**
 * A word from outside the app (a calendar invite's title, a book's title, a place's name), cleaned and cut, with the
 * marks that could close the prompt's data fence or open a variable ("</data>", "{{") made spaces: anyone who can send
 * the user an invite chooses its title.
 */
export function safe(text: string, max: number): string {
  return cleanShown(cleanShown(text, max * 2).replace(FENCE_MARKS, " ").replace(/\s+/g, " "), max);
}

/** Angle brackets and their look-alikes, braces in pairs, and double quotes (titles are quoted below). */
const FENCE_MARKS = new RegExp(`[<>"${[0xff1c, 0xff1e, 0x2039, 0x203a, 0x3008, 0x3009, 0xfe64, 0xfe65, 0x2329, 0x232a,
  0x27e8, 0x27e9].map((c) => String.fromCodePoint(c)).join("")}]|\\{\\{|\\}\\}`, "gu");

/** An outside title in quotes, so the assistant hears it as a name, not as words addressed to it. */
const quoted = (text: string, max: number): string => {
  const words = safe(text, max);
  return words ? `"${words}"` : "Untitled";
};
const TITLE_MAX = 90;
const EVENTS_MAX = 8;
const BOOKS_MAX = 4;

function dateLine(input: LifeInput): string {
  const day = input.now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: input.tz });
  const hijri = hijriDate(input.now);
  return `Today is ${day}${hijri ? `, ${hijri} by calculation` : ""}. It is ${formatTime(input.now, input.tz)} ` +
    `where the user is (${safe(input.place, 60)}).`;
}

function prayerLines(input: LifeInput): string[] {
  const times = input.days.find((d) => d.date === input.today);
  if (!times) return ["Prayer times for today are not worked out yet."];
  const at = (d: Date) => formatTime(d, input.tz);
  const list = PRAYERS.map((name) => {
    const iqama = iqamaAt(times, name);
    const label = name === "dhuhr" && iqama === null ? "Jumuah" : PRAYER_LABEL[name];
    return `${label} ${at(times[name])}${iqama ? ` (iqama ${at(iqama)})` : ""}`;
  });
  const lines = [`Prayer times today: ${list.join(", ")}. Sunrise ${at(times.sunrise)}.`];
  const next = PRAYERS.find((name) => times[name].getTime() > input.now.getTime());
  lines.push(next ? `Next prayer: ${next === "dhuhr" && iqamaAt(times, next) === null ? "Jumuah" : PRAYER_LABEL[next]} ` +
    `at ${at(times[next])}.` : "Every prayer time today has passed; the next is Fajr tomorrow.");
  const marks = input.log.days[input.today]?.prayers ?? {};
  const marked = PRAYERS.flatMap((name) => {
    const mark = marks[name];
    return mark ? [`${PRAYER_LABEL[name]} ${mark.status === "ontime" ? "on time" : "late"}` +
      `${mark.mosque ? " at the mosque" : ""}`] : [];
  });
  lines.push(marked.length ? `Prayers the user marked today: ${marked.join(", ")}.` : "The user has marked no prayer today yet.");
  return lines;
}

function adhkarLine(input: LifeInput): string {
  const say = (session: "morning" | "evening") => {
    const p = progress(input.adhkar, input.today, session);
    return p.done >= p.total ? `${session} done` : `${session} ${p.done} of ${p.total}`;
  };
  return `Adhkar today: ${say("morning")}, ${say("evening")}.`;
}

function eventWords(start: number, allDay: boolean, title: string, tz: string): string {
  const name = quoted(title, TITLE_MAX);
  return allDay ? `${name} (all day)` : `${formatTime(new Date(start), tz)} ${name}`;
}

function calendarLines(input: LifeInput): string[] {
  const now = input.now.getTime();
  const later = eventsOn(input.agenda, input.today, input.tz).filter((e) => e.end > now || e.allDay);
  const tomorrow = eventsOn(input.agenda, shiftKey(input.today, 1), input.tz);
  const list = (events: typeof later) => events.slice(0, EVENTS_MAX)
    .map((e) => eventWords(e.start, e.allDay, e.title, input.tz)).join("; ");
  return [
    later.length ? `Calendar, the rest of today: ${list(later)}.` : "Calendar: nothing more today.",
    tomorrow.length ? `Calendar tomorrow: ${list(tomorrow)}.` : "Calendar tomorrow: nothing.",
  ];
}

function booksLine(input: LifeInput): string {
  const books = inHand(input.library).slice(0, BOOKS_MAX);
  if (books.length === 0) return "Books: none marked as reading.";
  return `Books the user is reading: ${books.map((b) => {
    const title = quoted(b.title, TITLE_MAX);
    const page = currentPage(b);
    return page > 0 ? `${title}, page ${page}${b.pages ? ` of ${b.pages}` : ""}` : title;
  }).join("; ")}.`;
}

/** The user's Quran reading: the page, today's pages against the goal, the streak. Never any words of the Quran. */
function quranLine(input: LifeInput): string {
  const q = input.quran;
  const today = pagesOn(q, input.today);
  const streak = readingStreak(q, input.today);
  return `Quran: page ${q.position} of ${PAGES} in this reading${q.completed ? ` (${q.completed} completed before)` : ""}; ` +
    `${today} page${today === 1 ? "" : "s"} today${q.dailyGoal ? ` of a ${q.dailyGoal}-page goal` : ""}` +
    `${streak > 1 ? `; ${streak} days in a row` : ""}.`;
}

/** This week's study by track against its target, and the notes due for review. */
function learnLine(input: LifeInput): string {
  const parts = activeTracks(input.learn).flatMap((t) => {
    const done = weekMinutes(input.learn, input.today, t.id);
    if (!done && !t.weeklyMinutes) return [];
    return [`${quoted(t.name, 60)} ${done ? formatMinutes(done) : "nothing yet"}` +
      `${t.weeklyMinutes ? ` of ${formatMinutes(t.weeklyMinutes)}` : ""}`];
  });
  const due = dueLessons(input.learn, input.today).length;
  return `${parts.length ? `Study this week: ${parts.join("; ")}.` : "Study this week: none logged."}` +
    `${due ? ` ${due} of the user's own note${due === 1 ? "" : "s"} due for review.` : ""}`;
}

/** The week's intentions, in one line, each quoted: the user's own words, cleaned as any outside text is. */
function intentionsLine(input: LifeInput): string[] {
  if (input.intentions.length === 0) return [];
  return [`The user's intentions for this week: ${input.intentions.map((i) => `${quoted(i.text, 80)}${i.done ? " (done)" : ""}`)
    .join("; ")}.`];
}

/** Steps against the user's own goal, last night's sleep, this week's workouts and what is planned today. */
function bodyLine(input: LifeInput): string {
  const { body, health } = input;
  const steps = health?.steps;
  const parts = [
    steps ? `${steps.today} steps today${body.stepGoal ? ` of the user's goal of ${body.stepGoal}` : ""}` : "",
    health?.sleep?.last ? `slept ${Math.round(health.sleep.last.minutes / 6) / 10} hours last night` : "",
    planFor(body, input.today) ? `planned today: ${quoted(planFor(body, input.today), 40)}` : "",
    dayDone(body, input.today) ? "today's workout is done" : "",
  ].filter(Boolean);
  return parts.length ? `Body: ${parts.join("; ")}.` : "Body: nothing to report yet.";
}

/** The month's money in dirhams, only when the user allowed it; otherwise a line that says so and no figure. */
function moneyLine(input: LifeInput): string {
  if (!input.money) return "Money: switched off for the assistant. You cannot see or log it; the user can switch it on in Settings.";
  const s = monthSummary(input.money, input.today);
  const aed = (cents: number) => `AED ${Math.round(cents / 100)}`;
  return `Money this month: ${aed(s.inAed)} in${s.goalAed ? ` of a goal of ${aed(s.goalAed)}` : ""}; owed to the user ${aed(s.owedAed)}` +
    `${s.overdue ? `, ${s.overdue} overdue` : ""}.`;
}

/** Today in a few plain lines, cut to LIFE_MAX characters. */
export function lifeText(input: LifeInput): string {
  const lines = [
    dateLine(input),
    ...prayerLines(input),
    adhkarLine(input),
    quranLine(input),
    ...calendarLines(input),
    booksLine(input),
    learnLine(input),
    ...intentionsLine(input),
    bodyLine(input),
    moneyLine(input),
    input.weather ? safe(weatherText(input.weather), 600) : "Weather: not available just now.",
  ];
  return Array.from(lines.join("\n")).slice(0, LIFE_MAX).join("");
}
