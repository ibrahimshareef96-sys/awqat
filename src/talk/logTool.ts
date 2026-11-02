/**
 * What the assistant may log, as one tool it calls in a talk (log_to_app, a client tool: it runs here, in the app, so
 * nothing new is held on the Worker). The agent reads the line back and gets the user's yes first (its prompt); the words it
 * sends are still model output, so every field is checked here like anything else from outside. Pure: the arguments and
 * the records come in, and the change and the sentence to say back come out. It adds records, marks a prayer or a set of
 * adhkar, and moves the user's place in the Quran forward; it never removes anything. A value it does not know is refused, never
 * taken for the nearest thing. Arabic is refused in lessons and notes: nothing of the Quran is typed, and the assistant
 * hears English. That rule cannot catch a translation; the prompt asks it to name the surah and ayah instead.
 */
import { addWeight, parseKg, type BodyLog } from "../body/body.ts";
import { addLift, dayDone, toggleDone } from "../body/training.ts";
import { adhkarFor, setDone, type AdhkarLog, type Session } from "../faith/adhkar.ts";
import { activeTracks, addLesson, formatMinutes, logSession, type Learn, type LearnTrack } from "../learn/learn.ts";
import { addIncome, addOwed, CURRENCIES, parseAmount, type Currency, type Money } from "../money/money.ts";
import { setMark, type PrayerLog } from "../prayer/log.ts";
import { PRAYER_LABEL, PRAYERS, type PrayerName } from "../prayer/times.ts";
import { PAGES } from "../quran/data.ts";
import { logRead, setPosition, type QuranLog } from "../quran/log.ts";
import { cleanShown } from "./text.ts";

export const LOG_KINDS = ["quran_read", "prayer", "adhkar", "study", "lesson", "weight", "lift", "workout_done", "money_in",
  "owed"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

const PAGES_MAX = 60;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u;
const NO_ARABIC = "Arabic is not kept from a talk, so nothing of the Quran is typed. Name the surah and ayah, or the book, in English.";
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface LogWorld {
  today: string;
  /** The prayer day (Fajr to Fajr), which marks and adhkar belong to. */
  prayerDay: string;
  /** Where the mushaf is open: a log behind it catches up to it, and never takes it back. */
  bookmark: number;
  quran: QuranLog;
  prayers: PrayerLog;
  adhkar: AdhkarLog;
  learn: Learn;
  body: BodyLog;
  money: Money;
  /** The user has allowed the assistant money (Settings). */
  moneyAllowed: boolean;
  /** Whether this dhikr can be said yet (the end of Al-Baqarah waits for that day's Maghrib). */
  dhikrOpen: (session: Session, id: number) => boolean;
  newId: () => string;
}

/** One change: the record it goes in, its new value, and what to say back. */
export type LogPlan =
  | { store: "quran"; value: QuranLog; said: string }
  | { store: "prayers"; value: PrayerLog; said: string; prayer: PrayerName }
  | { store: "adhkar"; value: AdhkarLog; said: string }
  | { store: "learn"; value: Learn; said: string }
  | { store: "body"; value: BodyLog; said: string }
  | { store: "money"; value: Money; said: string };

export type LogOutcome = { ok: true; plan: LogPlan } | { ok: false; said: string };

const refuse = (said: string): LogOutcome => ({ ok: false, said });
const text = (value: unknown, max: number): string => cleanShown(value, max);

const YES_FIRST = new Set(["yes", "yeah", "yep", "yup", "correct", "right", "sure", "ok", "okay", "confirm", "confirmed", "exactly", "absolutely",
  "naam", "aywa", "go", "do", "save", "log", "please", "thats"]);
const YES_REST = new Set([...YES_FIRST, "ahead", "it", "that", "is", "thanks", "thank", "you"]);
const YES_WORDS_MAX = 6;
const NEGATION = /\b(\w+n't|dont|wont|cant|cannot|didnt|wouldnt|shouldnt|not|never|no)\b/;
const UNDO_WORDS_MAX = 8;

const wordsOf = (said: string): string[] =>
  said.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/'/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/**
 * What the user last said is nothing but a clear yes, so the read-back is confirmed here as well as asked for in the agent's
 * prompt. The whole of it, not a word found in it: "that's not right" and "yes but wait" are not yes.
 */
export function saidYes(said: string): boolean {
  const words = wordsOf(said);
  return words.length > 0 && words.length <= YES_WORDS_MAX && YES_FIRST.has(words[0]) && words.every((w) => YES_REST.has(w));
}

/** What the user said asks for an undo in so many words. */
export function askedUndo(said: string): boolean {
  const plain = said.toLowerCase().replace(/[‘’ʼ]/g, "'");
  return wordsOf(said).length <= UNDO_WORDS_MAX && /\b(undo|take (that|it) back|remove (that|it))\b/.test(plain) && !NEGATION.test(plain);
}

function whole(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

function quranRead(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const pages = whole(args.pages);
  if (pages === null || pages < 1 || pages > PAGES_MAX) return refuse(`Say how many pages, from 1 to ${PAGES_MAX}.`);
  // The reader moves the bookmark as the user turns: a log behind it starts where these pages would have begun.
  const start = Math.min(PAGES - 1, Math.max(w.quran.position, w.bookmark - 1 - pages));
  const from = start === w.quran.position ? w.quran : setPosition(w.quran, start);
  const value = logRead(from, w.today, Math.min(PAGES, start + pages));
  if (value === from) return refuse("Those pages could not be added.");
  const said = value.position === 0 ? "A full reading complete." : `${pages} page${pages === 1 ? "" : "s"} logged, up to page ${value.position}.`;
  return { ok: true, plan: { store: "quran", value, said } };
}

function prayer(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const name = text(args.prayer, 12).toLowerCase();
  if (!PRAYERS.includes(name as PrayerName)) return refuse("Say which prayer: Fajr, Dhuhr, Asr, Maghrib or Isha.");
  const status = text(args.status, 12).toLowerCase().replace(/[\s_-]/g, "");
  if (status !== "" && status !== "late" && status !== "ontime") return refuse("Say on time or late.");
  const late = status === "late";
  const mosque = !late && args.mosque === true;
  const value = setMark(w.prayers, w.prayerDay, name as PrayerName, { status: late ? "late" : "ontime", mosque });
  return { ok: true, plan: { store: "prayers", value, prayer: name as PrayerName,
    said: `${PRAYER_LABEL[name as PrayerName]} marked ${late ? "late" : mosque ? "on time at the mosque" : "on time"}.` } };
}

function adhkar(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const session = args.session === "morning" || args.session === "evening" ? args.session : null;
  if (!session) return refuse("Say morning or evening adhkar.");
  const open = adhkarFor(session).filter((item) => w.dhikrOpen(session, item.id));
  const value = open.reduce((log, item) => setDone(log, w.prayerDay, session, item.id, true), w.adhkar);
  const waiting = adhkarFor(session).length - open.length;
  return { ok: true, plan: { store: "adhkar", value,
    said: `${session === "morning" ? "Morning" : "Evening"} adhkar marked done${waiting ? ", except the end of Al-Baqarah, which waits for Maghrib" : ""}.` } };
}

/** The subject the user named, by its name or a clear part of it. */
function trackNamed(learn: Learn, name: unknown): { track: LearnTrack } | { said: string } {
  const tracks = activeTracks(learn);
  const words = text(name, 60).toLowerCase();
  const names = tracks.map((t) => t.name).join(", ");
  if (!words) return { said: `Say which subject: ${names}.` };
  const exact = tracks.filter((t) => t.name.toLowerCase() === words);
  const found = exact.length > 0 ? exact : tracks.filter((t) => t.name.toLowerCase().includes(words));
  if (found.length === 1) return { track: found[0] };
  return { said: `That matches ${found.length === 0 ? "no subject" : "more than one subject"}. The user's subjects are: ${names}.` };
}

function study(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const named = trackNamed(w.learn, args.track);
  if ("said" in named) return refuse(named.said);
  const minutes = whole(args.minutes);
  if (minutes === null) return refuse("Say how many minutes.");
  const note = text(args.text, 300);
  if (ARABIC.test(note)) return refuse(NO_ARABIC);
  const added = logSession(w.learn, { trackId: named.track.id, itemId: null, minutes, note }, w.today);
  if (added.refused) return refuse(added.refused === "minutes" ? "Say how many minutes, from 1 to 600." : "That could not be added.");
  return { ok: true, plan: { store: "learn", value: added.learn, said: `${formatMinutes(minutes)} of ${named.track.name} logged.` } };
}

function lesson(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const named = trackNamed(w.learn, args.track);
  if ("said" in named) return refuse(named.said);
  const words = text(args.text, 1000);
  if (!words) return refuse("Say the lesson in the user's own words.");
  if (ARABIC.test(words)) return refuse(NO_ARABIC);
  const added = addLesson(w.learn, { trackId: named.track.id, itemId: null, text: words, source: "" }, w.today);
  if (added.refused) return refuse("That lesson could not be added.");
  return { ok: true, plan: { store: "learn", value: added.learn, said: `Lesson added to ${named.track.name}. It comes back for review tomorrow.` } };
}

function weight(args: Record<string, unknown>, w: LogWorld, at: number): LogOutcome {
  const kg = parseKg(String(args.kg ?? ""));
  if (kg === null) return refuse("Say the user's weight in kilograms.");
  return { ok: true, plan: { store: "body", value: addWeight(w.body, kg, at), said: `${kg} kilos logged.` } };
}

function lift(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const exercise = text(args.exercise, 40);
  const reps = whole(args.reps);
  const sets = args.sets === undefined || args.sets === null ? 1 : whole(args.sets);
  const rawKg = typeof args.kg === "string" ? args.kg.trim() : args.kg;
  const kg = rawKg === undefined || rawKg === null || rawKg === "" ? 0
    : typeof rawKg === "number" || (typeof rawKg === "string" && /^\d+(\.\d+)?$/.test(rawKg)) ? Math.round(Number(rawKg) * 10) / 10 : NaN;
  if (!exercise || reps === null || sets === null) return refuse("Say the exercise, the reps and the sets.");
  const value = addLift(w.body, { id: w.newId(), date: w.today, exercise, kg, reps, sets });
  if (value === w.body) return refuse("That lift could not be added. Check the kilos, reps and sets.");
  return { ok: true, plan: { store: "body", value, said: `${exercise} logged: ${kg > 0 ? `${kg} kilos, ` : ""}${reps} reps, ${sets} set${sets === 1 ? "" : "s"}.` } };
}

function workoutDone(w: LogWorld): LogOutcome {
  if (dayDone(w.body, w.today)) return refuse("Today's workout is already marked done.");
  return { ok: true, plan: { store: "body", value: toggleDone(w.body, w.today), said: "Today's workout marked done." } };
}

function amountOf(args: Record<string, unknown>): { cents: number; currency: Currency } | null {
  const cents = parseAmount(String(args.amount ?? ""));
  const currency = text(args.currency, 8).toUpperCase() || "AED";
  if (cents === null || !CURRENCIES.includes(currency as Currency)) return null;
  return { cents, currency: currency as Currency };
}

function moneyIn(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const who = text(args.who, 80);
  const amount = amountOf(args);
  if (!who || !amount) return refuse("Say who it came from and the amount, in AED or USD.");
  const value = addIncome(w.money, { id: w.newId(), date: w.today, from: who, ...amount });
  if (value === w.money) return refuse("That could not be added.");
  return { ok: true, plan: { store: "money", value, said: `${amount.currency} ${amount.cents / 100} from ${who} logged.` } };
}

function owed(args: Record<string, unknown>, w: LogWorld): LogOutcome {
  const who = text(args.who, 80);
  const amount = amountOf(args);
  const due = typeof args.due === "string" && DAY.test(args.due) ? args.due : "";
  if (!who || !amount) return refuse("Say who owes it and the amount, in AED or USD.");
  if (typeof args.due === "string" && args.due.trim() !== "" && due === "") return refuse("Say the due day as a date, or leave it out.");
  const value = addOwed(w.money, { id: w.newId(), who, due, ...amount });
  if (value === w.money) return refuse("That could not be added.");
  return { ok: true, plan: { store: "money", value, said: `${who} owes ${amount.currency} ${amount.cents / 100}, logged.` } };
}

/** The change a tool call asks for, or why it cannot be made, in words the agent can say. */
export function planLog(args: unknown, w: LogWorld, at: number): LogOutcome {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return refuse("Nothing was said to log.");
  const a = args as Record<string, unknown>;
  switch (a.kind) {
    case "quran_read": return quranRead(a, w);
    case "prayer": return prayer(a, w);
    case "adhkar": return adhkar(a, w);
    case "study": return study(a, w);
    case "lesson": return lesson(a, w);
    case "weight": return weight(a, w, at);
    case "lift": return lift(a, w);
    case "workout_done": return workoutDone(w);
    case "money_in":
    case "owed":
      if (!w.moneyAllowed) return refuse("Money is switched off for the assistant. The user can switch it on in Settings, or add it on the Money screen.");
      return a.kind === "owed" ? owed(a, w) : moneyIn(a, w);
    default: return refuse("That is not something the app can log.");
  }
}
