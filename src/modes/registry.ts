/**
 * What is in each Islamic mode: its steps in order, each with where it comes from. Du'a words come only from
 * faith/duaData.ts (cut from Hisn al-Muslim by a script) or from what the user added personally; Quran is never written here,
 * only the surah and ayahs to open in the mushaf. And what is waiting now, for the prompt on Home.
 */
import { progress, type AdhkarLog, type Session } from "../faith/adhkar.ts";
import { DUAS } from "../faith/duaData.ts";
import { FRIDAY_ITEMS, FRIDAY_LABEL, FRIDAY_SOURCE, type FridayItem, type FridayLog } from "../faith/friday.ts";
import { activeTracks, weekMinutes, type Learn } from "../learn/learn.ts";
import type { DayTimes } from "../prayer/times.ts";
import { pageOfAyah, surahPages } from "../quran/pages.ts";
import { isNotNow, modeWindows, ownDuas, stepCount, type ModeId, type ModeLog, type ModeWindow } from "./modes.ts";

export interface Dua { id: string; name: string; text: string; count: number; source: string }

export type Step =
  /** A surah read in the mushaf with its own place, ticked in the Friday log. */
  | { kind: "read"; id: FridayItem; sura: number; name: string; source: string }
  | { kind: "friday"; id: FridayItem; name: string; source: string }
  | { kind: "dua"; id: string; name: string; text: string; count: number; source: string; hint?: string; own?: true }
  /** Ayat the user reads in the mushaf and counts here: never shown. */
  | { kind: "quran"; id: string; name: string; page: number; where: string; count: number; source: string }
  /** Part of a page the user gave the app, shown as the picture it is, so not a letter of it is typed. */
  | { kind: "page"; id: string; name: string; picture: string; width: number; height: number; alt: string; count: number; source: string }
  | { kind: "adhkar"; id: string; session: Session }
  | { kind: "sunnah"; id: string; name: string; detail: string; source: string; sunrise?: true };

export interface ModeGroup { title: string; steps: Step[] }

export interface ModeDef {
  id: ModeId;
  name: string;
  ar: string;
  /** When it opens, in words. */
  when: string;
  groups: ModeGroup[];
}

export interface ModeContext {
  log: ModeLog;
  friday: FridayLog;
  adhkar: AdhkarLog;
  /** The occasion these counts belong to; null when the mode is not open for one (Jumu'ah on a Tuesday). */
  date: string | null;
}

const dua = (id: string, hint?: string): Step => {
  const found = DUAS.find((d) => d.id === id);
  if (!found) throw new Error(`No du'a "${id}" in duaData.ts`);
  return { kind: "dua", ...found, ...(hint ? { hint } : {}) };
};

/** The tasbih is tapped through in full: 33 of each, then the last line. */
const TASBIH: Step = { ...(dua("tasbih") as Extract<Step, { kind: "dua" }>), count: 100,
  hint: "33 of each, then the last line once: a hundred in all." };

const quls = (count: number): Step => ({ kind: "quran", id: "quls", name: "Al-Ikhlas, Al-Falaq, An-Nas", page: pageOfAyah(112, 1) ?? 604,
  where: "The last three surahs", count,
  source: "Abu Dawud 1523, sahih (Al-Albani); three times after Fajr and Maghrib: Hisn al-Muslim 70" });

const AFTER_EVERY_SALAM: readonly Step[] = [
  dua("istighfar"), dua("la-mani"), dua("la-hawla"), TASBIH,
  { kind: "quran", id: "kursi", name: "Ayat al-Kursi", page: pageOfAyah(2, 255) ?? 42, where: "Al-Baqara 255", count: 1,
    source: "An-Nasa'i, Amal al-Yawm 100; Silsilah as-Sahihah 972" },
];

const AFTER_SALAM: readonly Step[] = [...AFTER_EVERY_SALAM, quls(3), dua("ten")];

const JUMUAH: ModeDef = {
  id: "jumuah", name: "Jumu'ah", ar: "الجمعة", when: "By itself, from Maghrib on Thursday to Maghrib on Friday",
  groups: [{ title: "Today", steps: FRIDAY_ITEMS.map((item): Step => (item === "kahf"
    ? { kind: "read", id: item, sura: 18, name: FRIDAY_LABEL[item], source: FRIDAY_SOURCE[item] }
    : { kind: "friday", id: item, name: FRIDAY_LABEL[item], source: FRIDAY_SOURCE[item] })) }],
};

const FAJR: ModeDef = {
  id: "fajr", name: "Fajr", ar: "الفجر", when: "By itself, from the Fajr adhan to half an hour after sunrise",
  groups: [
    { title: "After the salam", steps: [...AFTER_SALAM, dua("ilman")] },
    { title: "The morning", steps: [{ kind: "adhkar", id: "morning", session: "morning" }] },
    { title: "Until sunrise", steps: [{ kind: "sunnah", id: "sit", name: "Sit in remembrance, then two rak'ahs",
      detail: "Stay remembering Allah until the sun has risen, then pray two rak'ahs.",
      source: "Tirmidhi 586, from Anas. Hasan gharib (At-Tirmidhi); da'if (Darussalam)", sunrise: true }] },
  ],
};

const MAGHRIB: ModeDef = {
  id: "maghrib", name: "Maghrib", ar: "المغرب", when: "By itself, from the Maghrib adhan to Isha",
  groups: [
    { title: "After the salam", steps: [...AFTER_SALAM] },
    { title: "The sunnah", steps: [{ kind: "sunnah", id: "two", name: "Two rak'ahs after Maghrib",
      detail: "At home, as the Prophet ﷺ prayed them.", source: "Bukhari 1180" }] },
    { title: "The evening", steps: [{ kind: "adhkar", id: "evening", session: "evening" }] },
  ],
};

/** After Dhuhr, Asr or Isha: the same dhikr, with the last three surahs once. The tahlil ten times is for Fajr and Maghrib. */
const afterPrayer = (id: "dhuhr" | "asr" | "isha", prayer: string, ar: string, until: string): ModeDef => ({
  id, name: `After ${prayer}`, ar, when: `By itself, from the ${prayer} iqama ${until}`,
  groups: [{ title: "After the salam", steps: [...AFTER_EVERY_SALAM, quls(1)] }],
});

const ISTIKHARA: ModeDef = {
  id: "istikhara", name: "Istikhara", ar: "الاستخارة", when: "When you need it",
  groups: [{ title: "When you have a decision to make", steps: [
    { kind: "sunnah", id: "two", name: "Pray two rak'ahs", detail: "Any two rak'ahs, other than the obligatory prayer.",
      source: "Bukhari 1166" },
    dua("istikhara", "At \"this matter\" (hadha al-amr), name what you are deciding."),
  ] }],
};

const FIXED: readonly ModeDef[] = [JUMUAH, FAJR, afterPrayer("dhuhr", "Dhuhr", "الظهر", "to Asr"), afterPrayer("asr", "Asr", "العصر", "to Maghrib"),
  MAGHRIB, afterPrayer("isha", "Isha", "العشاء", "to the middle of the night"), ISTIKHARA];
export const ISLAMIC_MODES: readonly ModeDef[] = FIXED;
export const defOf = (mode: string): ModeDef | null => FIXED.find((d) => d.id === mode) ?? null;

/** Every step of a mode, with the du'as the user added at the end. */
export function stepsOf(def: ModeDef, log: ModeLog): Step[] {
  return [...def.groups.flatMap((g) => g.steps), ...ownSteps(def, log)];
}

export function ownSteps(def: ModeDef, log: ModeLog): Step[] {
  return ownDuas(log, def.id).map((d): Step => ({ kind: "dua", id: d.id, name: d.name, text: d.text, count: 1,
    source: "Added by you", own: true }));
}

/** How far a step has got, out of how many. */
export function stepProgress(mode: ModeId, step: Step, c: ModeContext): { n: number; of: number } {
  if (step.kind === "adhkar") {
    if (!c.date) return { n: 0, of: 1 };
    const { done, total } = progress(c.adhkar, c.date, step.session);
    return { n: done, of: total };
  }
  if (step.kind === "read" || step.kind === "friday") return { n: c.date && c.friday.days[c.date]?.[step.id] ? 1 : 0, of: 1 };
  const of = step.kind === "dua" || step.kind === "quran" || step.kind === "page" ? step.count : 1;
  return { n: c.date ? Math.min(of, stepCount(c.log, c.date, mode, step.id)) : 0, of };
}

export const stepDone = (mode: ModeId, step: Step, c: ModeContext): boolean => {
  const { n, of } = stepProgress(mode, step, c);
  return n >= of;
};

/** The step to pick up: the first not done. */
export const nextStep = (def: ModeDef, c: ModeContext): Step | null =>
  stepsOf(def, c.log).find((s) => !stepDone(def.id, s, c)) ?? null;

/** What a Friday's Al-Kahf covers, for the reader and the prompt. */
export const suraPages = (sura: number): { first: number; last: number } | null => surahPages(sura);

export interface WaitingContext {
  days: readonly DayTimes[];
  now: Date;
  log: ModeLog;
  friday: FridayLog;
  adhkar: AdhkarLog;
  learn: Learn;
  /** Today in the user's zone, YYYY-MM-DD. */
  today: string;
}

/**
 * A study has had its due once the user studied it today, or reached its week's target. `occasion` is the day its window
 * belongs to: an Isha window can run past midnight, and what the user logged before midnight still counts for it.
 */
function studied(learn: Learn, trackId: string, today: string, occasion: string): boolean {
  const track = learn.tracks.find((t) => t.id === trackId);
  if (!track) return true;
  if (learn.sessions.some((s) => s.trackId === trackId && (s.date === today || s.date === occasion))) return true;
  return track.weeklyMinutes > 0 && weekMinutes(learn, today, trackId) >= track.weeklyMinutes;
}

/** The modes open by themselves now that still have something to do and that the user has not put off. */
export function waitingNow(w: WaitingContext): ModeWindow[] {
  const tracks = activeTracks(w.learn).map((t) => t.id);
  return modeWindows(w.days, w.now, w.log, tracks).filter((open) => {
    if (isNotNow(w.log, open.date, open.mode)) return false;
    if (open.mode.startsWith("study:")) return !studied(w.learn, open.mode.slice(6), w.today, open.date);
    const def = defOf(open.mode);
    return def !== null && nextStep(def, { log: w.log, friday: w.friday, adhkar: w.adhkar, date: open.date }) !== null;
  });
}
