/**
 * The home-screen widgets' side in the app. The widgets are native and run with the app closed, so they are handed a
 * snapshot: the coming prayers (they pick the next one themselves as time passes), today's and tomorrow's lines, each
 * prayer day's five prayers, the adhkar and the meetings ahead (app/widgetDays.ts). The app sends it only when what it
 * shows has changed. Taps on a widget, an app shortcut or a Siri phrase come back as awqat://go/<screen> links, and
 * only the screens these open are followed.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { prayerName } from "../faith/friday.ts";
import { adhkarWindow, type AdhkarLog, type Session } from "../faith/adhkar.ts";
import { iqamaAt } from "../prayer/iqama.ts";
import { PAGES } from "../quran/data.ts";
import { lastRevised, shiftDay, type QuranLog } from "../quran/log.ts";
import { revisionLine, type MurajaahPlan } from "../quran/murajaah.ts";
import { PRAYERS, formatTime, type DayTimes } from "../prayer/times.ts";
import { adhkarDays, meetingsAhead, prayerDays, readLine, type MeetingSource, type WidgetAdhkarDay, type WidgetMeeting,
  type WidgetPrayerDay } from "./widgetDays.ts";

export interface WidgetPrayer { name: string; time: string; at: number; iqama?: number }
export interface WidgetDay { date: string; quran: string; revise: string; read: string }
export interface WidgetDhikr { key: string; name: string; n: number; of: number }
/**
 * `place: "unset"` while the place is only guessed: no prayer, adhkar or dhikr then (their times would be Makkah's),
 * and the widgets say "Set your place". `calendar`: whether any calendar is connected.
 */
export interface WidgetSnapshot {
  v: 1; tz: string; prayers: WidgetPrayer[]; days: WidgetDay[]; dhikr?: WidgetDhikr; steps?: string; live?: false;
  place?: "unset"; prayerDays?: WidgetPrayerDay[]; adhkar?: WidgetAdhkarDay[]; calendar?: boolean; meetings?: WidgetMeeting[];
}

/** As many reminders as the phone keeps: about 12 days of prayers, enough for the widget to run on its own. */
const PRAYERS_MAX = 60;
const TARGETS = ["home", "faith", "quran", "mushaf", "revise", "modes", "body", "talk", "adhkar", "agenda"] as const;
export type LinkTarget = (typeof TARGETS)[number] | `mode:${string}`;
const MODE_LINK = /^mode:(?:[a-z]{1,16}|study:[A-Za-z0-9-]{1,64})$/;

interface WidgetBridge { update(options: { snapshot: string }): Promise<void> }
const bridge = registerPlugin<WidgetBridge>("WidgetBridge");
let lastSent = "";

export interface WidgetInput {
  days: readonly DayTimes[]; now: Date; tz: string; today: string; quran: QuranLog;
  /** The bookmark, where the user stopped reading (the widget's page line opens it). */
  page: number; plan: MurajaahPlan | null; dhikr?: WidgetDhikr | null; steps?: string; live?: boolean;
  /** False while the place is only guessed. */
  placeSet?: boolean; adhkar?: AdhkarLog;
  agenda?: { calendar: boolean; events: readonly MeetingSource[] };
}

function comingPrayers(days: readonly DayTimes[], now: number, tz: string): WidgetPrayer[] {
  return days.flatMap((day) => PRAYERS.map((p) => ({ day, p, at: day[p].getTime() })))
    .filter((x) => Number.isFinite(x.at) && x.at > now).sort((a, b) => a.at - b.at).slice(0, PRAYERS_MAX)
    .map(({ day, p, at }) => {
      const iqama = iqamaAt(day, p);
      return { name: prayerName(p, day.date), time: formatTime(new Date(at), tz), at, ...(iqama ? { iqama: iqama.getTime() } : {}) };
    });
}

function quranDays(input: WidgetInput): WidgetDay[] {
  const page = Math.min(PAGES, Math.max(1, Math.round(input.page) || 1));
  const revised = lastRevised(input.quran);
  return [input.today, shiftDay(input.today, 1)].map((date) => ({
    date, quran: `Page ${page} of ${PAGES}`, revise: input.plan ? revisionLine(input.plan, revised, date) : "",
    read: readLine(input.quran, date),
  }));
}

/** What the prayer times give: nothing at all for a guessed place. */
function timedParts(input: WidgetInput, placeSet: boolean): Partial<WidgetSnapshot> {
  if (!placeSet) return { place: "unset" };
  return { prayerDays: prayerDays(input.days, input.now, input.tz),
    ...(input.adhkar ? { adhkar: adhkarDays(input.days, input.now, input.adhkar) } : {}),
    ...(input.dhikr ? { dhikr: input.dhikr } : {}) };
}

function agendaParts(input: WidgetInput, placeSet: boolean): Partial<WidgetSnapshot> {
  if (!input.agenda) return {};
  return { calendar: input.agenda.calendar, meetings: meetingsAhead(input.agenda.events,
    { now: input.now, tz: input.tz, today: input.today, days: placeSet ? input.days : null }) };
}

export function widgetSnapshot(input: WidgetInput): WidgetSnapshot {
  const placeSet = input.placeSet !== false;
  return { v: 1, tz: input.tz, prayers: placeSet ? comingPrayers(input.days, input.now.getTime(), input.tz) : [],
    days: quranDays(input), ...timedParts(input, placeSet), ...agendaParts(input, placeSet),
    ...(input.steps ? { steps: input.steps } : {}), ...(input.live === false ? { live: false } : {}) };
}

/** Hands the widgets a new snapshot when it differs from the last one they took; a failed try is tried again next time. */
export function syncWidget(snapshot: WidgetSnapshot): void {
  if (!Capacitor.isNativePlatform()) return;
  const json = JSON.stringify(snapshot);
  if (json === lastSent) return;
  lastSent = json;
  bridge.update({ snapshot: json }).catch(() => { lastSent = ""; });
}

/** The screen a link from a widget or a shortcut opens, or null for anything they do not send. */
export function linkTarget(url: string): LinkTarget | null {
  const match = /^awqat:\/\/go\/([A-Za-z0-9:-]+)$/.exec(url);
  const target = match?.[1];
  if (!target) return null;
  if (MODE_LINK.test(target)) return target as LinkTarget;
  return (TARGETS as readonly string[]).includes(target) ? (target as LinkTarget) : null;
}

/** The adhkar a link opens: the set open now, or else the one that opens next (the evening after Dhuhr, the morning after the night). */
export function adhkarScreen(days: readonly DayTimes[], now: Date): `adhkar:${Session}` {
  const open = adhkarWindow(days, now);
  if (open) return `adhkar:${open.session}`;
  const next = days.flatMap((day) => [{ session: "morning" as const, at: day.fajr.getTime() },
    { session: "evening" as const, at: day.asr.getTime() }]).filter((x) => x.at > now.getTime()).sort((a, b) => a.at - b.at)[0];
  return `adhkar:${next?.session ?? "morning"}`;
}
