/**
 * The home-screen widget's side in the app. The widget is native and runs with the app closed, so it is handed a
 * snapshot: the coming prayers (it picks the next one itself as time passes) and today's and tomorrow's lines. The app
 * sends it only when what it shows has changed. Taps on the widget come back as awqat://go/<screen> links, and
 * only the screens the widget opens are followed.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { prayerName } from "../faith/friday.ts";
import { iqamaAt } from "../prayer/iqama.ts";
import { PAGES } from "../quran/data.ts";
import { lastRevised, shiftDay, type QuranLog } from "../quran/log.ts";
import { revisionLine, type MurajaahPlan } from "../quran/murajaah.ts";
import { PRAYERS, formatTime, type DayTimes } from "../prayer/times.ts";

export interface WidgetPrayer { name: string; time: string; at: number; iqama?: number }
export interface WidgetDay { date: string; quran: string; revise: string }
export interface WidgetDhikr { key: string; name: string; n: number; of: number }
export interface WidgetSnapshot { v: 1; tz: string; prayers: WidgetPrayer[]; days: WidgetDay[]; dhikr?: WidgetDhikr; steps?: string; live?: false }

/** As many reminders as the phone keeps: about 12 days of prayers, enough for the widget to run on its own. */
const PRAYERS_MAX = 60;
const TARGETS = ["home", "faith", "quran", "mushaf", "revise", "modes", "body"] as const;
export type LinkTarget = (typeof TARGETS)[number] | `mode:${string}`;
const MODE_LINK = /^mode:(?:[a-z]{1,16}|study:[A-Za-z0-9-]{1,64})$/;

interface WidgetBridge { update(options: { snapshot: string }): Promise<void> }
const bridge = registerPlugin<WidgetBridge>("WidgetBridge");
let lastSent = "";

/** `page`: the bookmark, where the user stopped reading (the widget's page line opens it). */
export function widgetSnapshot(input: { days: readonly DayTimes[]; now: Date; tz: string; today: string; quran: QuranLog;
  page: number; plan: MurajaahPlan | null; dhikr?: WidgetDhikr | null; steps?: string; live?: boolean }): WidgetSnapshot {
  const now = input.now.getTime();
  const prayers = input.days.flatMap((day) => PRAYERS.map((p) => ({ day, p, at: day[p].getTime() })))
    .filter((x) => Number.isFinite(x.at) && x.at > now).sort((a, b) => a.at - b.at).slice(0, PRAYERS_MAX)
    .map(({ day, p, at }) => {
      const iqama = iqamaAt(day, p);
      return { name: prayerName(p, day.date), time: formatTime(new Date(at), input.tz), at, ...(iqama ? { iqama: iqama.getTime() } : {}) };
    });
  const page = Math.min(PAGES, Math.max(1, Math.round(input.page) || 1));
  const revised = lastRevised(input.quran);
  const days = [input.today, shiftDay(input.today, 1)].map((date) => ({
    date, quran: `Page ${page} of ${PAGES}`, revise: input.plan ? revisionLine(input.plan, revised, date) : "",
  }));
  return { v: 1, tz: input.tz, prayers, days, ...(input.dhikr ? { dhikr: input.dhikr } : {}), ...(input.steps ? { steps: input.steps } : {}),
    ...(input.live === false ? { live: false } : {}) };
}

/** Hands the widgets a new snapshot when it differs from the last one they took; a failed try is tried again next time. */
export function syncWidget(snapshot: WidgetSnapshot): void {
  if (!Capacitor.isNativePlatform()) return;
  const json = JSON.stringify(snapshot);
  if (json === lastSent) return;
  lastSent = json;
  bridge.update({ snapshot: json }).catch(() => { lastSent = ""; });
}

/** The screen a link from the widget opens, or null for anything the widget does not send. */
export function linkTarget(url: string): LinkTarget | null {
  const match = /^awqat:\/\/go\/([A-Za-z0-9:-]+)$/.exec(url);
  const target = match?.[1];
  if (!target) return null;
  if (MODE_LINK.test(target)) return target as LinkTarget;
  return (TARGETS as readonly string[]).includes(target) ? (target as LinkTarget) : null;
}
