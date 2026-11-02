/**
 * The widgets' days, worked out here so native only picks from them as time passes (docs/live-surfaces.md): each
 * prayer day's five prayers with its Hijri date, when the morning and evening adhkar are open and whether they are
 * said, the Quran read so far today, and the meetings of today and tomorrow with the prayers around them.
 */
import { prayerName } from "../faith/friday.ts";
import { isComplete, isNextDay, islamicMidnight, type AdhkarLog, type Session } from "../faith/adhkar.ts";
import { hijriParts } from "../prayer/hijri.ts";
import { iqamaAt } from "../prayer/iqama.ts";
import { PRAYERS, calendarDayIn, dayKey, formatTime, type DayTimes, type PrayerName } from "../prayer/times.ts";
import { pagesOn, shiftDay, type QuranLog } from "../quran/log.ts";
import { cleanShown } from "../talk/text.ts";

/** `until`: when its time is over (Fajr's at sunrise, Isha's at the next Fajr), so a widget can mark the one under way. */
export interface WidgetDayPrayer { name: string; time: string; at: number; until?: number; iqama?: number; iqamaTime?: string }
export interface WidgetHijri { text: string; day: number; month: string }
/** One prayer day, Fajr to Fajr: its date, its Hijri date when the device has the calendar, and its five prayers. */
export interface WidgetPrayerDay { date: string; hijri?: WidgetHijri; prayers: WidgetDayPrayer[] }
export interface WidgetAdhkarSet { from: number; to: number; said: boolean }
export interface WidgetAdhkarDay { date: string; morning: WidgetAdhkarSet; evening: WidgetAdhkarSet }
/** `before` and `after`: the prayer at or before the start, and the first one after it ("Asr 15:21"). */
export interface WidgetMeeting { title: string; date: string; time: string; start: number; end: number; before?: string; after?: string }
/** What the meetings are read from: the agenda's events, of any calendar. */
export interface MeetingSource { start: number; end: number; allDay: boolean; title: string }

/** About twelve days: as long as the coming prayers in the snapshot last. */
const DAYS_MAX = 12;
const MEETINGS_MAX = 8;
const TITLE_MAX = 60;
/** Nothing that starts this far ahead can start today or tomorrow, in any zone: those events are not read further. */
const MEETINGS_AHEAD_MS = 3 * 86_400_000;

interface DayLeft { day: DayTimes; next?: DayTimes }

/** The prayer days not over yet (one ends at the next day's Fajr), the one under way first. */
function daysLeft(days: readonly DayTimes[], now: number): DayLeft[] {
  return days.map((day, i) => ({ day, next: days[i + 1] }))
    .filter(({ day, next }) => (next?.fajr ?? day.isha).getTime() > now).slice(0, DAYS_MAX);
}

function hijriOf(date: string): WidgetHijri | undefined {
  const parts = hijriParts(new Date(`${date}T12:00:00Z`), "UTC");
  return parts ? { text: `${parts.day} ${parts.month} ${parts.year}`, day: parts.day, month: parts.month } : undefined;
}

/** When a prayer's time is over: sunrise for Fajr, the next adhan for the rest, the very next day's Fajr for Isha. */
function endOf(day: DayTimes, next: DayTimes | undefined, p: PrayerName): number | undefined {
  const i = PRAYERS.indexOf(p);
  const end = p === "fajr" ? day.sunrise : i < PRAYERS.length - 1 ? day[PRAYERS[i + 1]]
    : isNextDay(day, next) ? next.fajr : undefined;
  return end && Number.isFinite(end.getTime()) && end.getTime() > day[p].getTime() ? end.getTime() : undefined;
}

function prayerDay({ day, next }: DayLeft, tz: string): WidgetPrayerDay {
  const prayers = PRAYERS.filter((p) => Number.isFinite(day[p].getTime())).map((p) => {
    const iqama = iqamaAt(day, p);
    const until = endOf(day, next, p);
    return { name: prayerName(p, day.date), time: formatTime(day[p], tz), at: day[p].getTime(),
      ...(until ? { until } : {}), ...(iqama ? { iqama: iqama.getTime(), iqamaTime: formatTime(iqama, tz) } : {}) };
  });
  const hijri = hijriOf(day.date);
  return { date: day.date, ...(hijri ? { hijri } : {}), prayers };
}

/**
 * The last prayer days worked out, kept while the days, the zone and the day under way are the same: a dozen days of
 * times written out is the costliest part of a snapshot, and the snapshot is made at every redraw. Never changed in
 * place; a new value replaces it.
 */
let lastPrayerDays: { days: readonly DayTimes[]; tz: string; first: DayTimes | undefined; value: WidgetPrayerDay[] } | null = null;

/** Each prayer day left with its five prayers, when each is over, their iqama (none for Jumu'ah) and the Hijri date. */
export function prayerDays(days: readonly DayTimes[], now: Date, tz: string): WidgetPrayerDay[] {
  const left = daysLeft(days, now.getTime());
  const first = left[0]?.day;
  if (lastPrayerDays && lastPrayerDays.days === days && lastPrayerDays.tz === tz && lastPrayerDays.first === first) {
    return lastPrayerDays.value;
  }
  const value = left.map((d) => prayerDay(d, tz));
  lastPrayerDays = { days, tz, first, value };
  return value;
}

const adhkarSet = (log: AdhkarLog, date: string, session: Session, from: Date, to: Date): WidgetAdhkarSet =>
  ({ from: from.getTime(), to: to.getTime(), said: isComplete(log, date, session) });

/**
 * When each set is open on each prayer day left (the morning Fajr to Dhuhr, the evening Asr to the middle of the
 * night), and whether it is said in full. A day without the very next one after it cannot know its evening's end.
 */
export function adhkarDays(days: readonly DayTimes[], now: Date, log: AdhkarLog): WidgetAdhkarDay[] {
  return daysLeft(days, now.getTime()).flatMap(({ day, next }) => {
    if (!isNextDay(day, next)) return [];
    const times = [day.fajr, day.dhuhr, day.asr, islamicMidnight(day, next)];
    if (!times.every((t) => Number.isFinite(t.getTime()))) return [];
    return [{ date: day.date, morning: adhkarSet(log, day.date, "morning", day.fajr, day.dhuhr),
      evening: adhkarSet(log, day.date, "evening", day.asr, times[3]) }];
  });
}

/** Today's reading in a line: "3 of 5 pages today" with a daily goal, "3 pages today" without one. */
export function readLine(log: QuranLog, date: string): string {
  const pages = pagesOn(log, date);
  if (log.dailyGoal > 0) return `${pages} of ${log.dailyGoal} ${log.dailyGoal === 1 ? "page" : "pages"} today`;
  return pages === 1 ? "1 page today" : `${pages} pages today`;
}

interface Marked { label: string; at: number }

function prayerMarks(days: readonly DayTimes[], tz: string): Marked[] {
  return days.flatMap((day) => PRAYERS.map((p) => ({ label: `${prayerName(p, day.date)} ${formatTime(day[p], tz)}`,
    at: day[p].getTime() }))).filter((m) => Number.isFinite(m.at)).sort((a, b) => a.at - b.at);
}

function around(marks: readonly Marked[], start: number): { before?: string; after?: string } {
  const before = marks.filter((m) => m.at <= start).at(-1)?.label;
  const after = marks.find((m) => m.at > start)?.label;
  return { ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/**
 * The meetings still to end that start today or tomorrow, soonest first; all-day events are not meetings. The prayers
 * around each come only with `days` (none for a place the app only guessed), and are written out only when a meeting
 * is there to need them.
 */
export function meetingsAhead(events: readonly MeetingSource[], input: { now: Date; tz: string; today: string;
  days: readonly DayTimes[] | null }): WidgetMeeting[] {
  const now = input.now.getTime();
  const tomorrow = shiftDay(input.today, 1);
  const ahead = events.filter((e) => !e.allDay && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > now &&
    e.start < now + MEETINGS_AHEAD_MS)
    .map((e) => ({ e, date: dayKey(calendarDayIn(new Date(e.start), input.tz)) }))
    .filter(({ date }) => date <= tomorrow).sort((a, b) => a.e.start - b.e.start).slice(0, MEETINGS_MAX);
  const marks = input.days && ahead.length > 0 ? prayerMarks(input.days, input.tz) : [];
  return ahead.map(({ e, date }) => ({ title: cleanShown(e.title, TITLE_MAX) || "Untitled", date,
    time: formatTime(new Date(e.start), input.tz), start: e.start, end: e.end, ...around(marks, e.start) }));
}
