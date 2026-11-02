/**
 * The assistant's log_to_app tool, applied (talk/logTool.ts decides what it means). Each change is on screen and saved
 * as a tap's would be, syncs the same way, and shows on the Talk sheet with an Undo. Calls run one at a time. Each log
 * needs a yes of its own, the last thing the user said, so words in a calendar title cannot log anything on their own; a talk
 * logs at most LOGS_PER_TALK things. Undo goes back through this talk's logs, newest first, each only while nothing else
 * has changed that record since, so it can never undo what arrived from another device.
 */
import type { BodyLog } from "../body/body.ts";
import { adhkarFor, type AdhkarLog, type Session } from "../faith/adhkar.ts";
import { newId, type Learn } from "../learn/learn.ts";
import type { Money } from "../money/money.ts";
import type { PrayerLog } from "../prayer/log.ts";
import { prayerDayIndex } from "../prayer/window.ts";
import { bookmarkAfterLog, bookmarkPage } from "../quran/bookmark.ts";
import type { QuranLog } from "../quran/log.ts";
import { moveBookmark } from "../quran/marks.ts";
import { KEYS } from "../store.ts";
import { askedUndo, planLog, saidYes, type LogPlan } from "../talk/logTool.ts";
import { hooks, save, state, today } from "./state.ts";

export const LOGS_PER_TALK = 12;

const UNSAVED = "Not saved: the phone could not keep it. Tell them to try again.";
const STOPPED = "Not saved: that is as many as one talk can log. They can add the rest on the screen.";
const UNHEARD = "Not saved: they have not said anything since the last log. Ask them first.";
const NO_YES = "Not saved: they have not said yes to this. Read it back and ask them.";
const NO_UNDO = "Not undone: they have not asked for this. Ask them first.";

/** reverted: the record went back; saved: and that is on disk. */
interface Undone { reverted: boolean; saved: boolean }
interface Logged { said: string; undo: () => Promise<Undone> }

let logged: Logged[] = [];
let count = 0;
let sayings = 0;
let lastSaying = "";
/** The saying last spent on a log or an undo: each thing the user says allows one of them. */
let usedSaying = 0;
/** The saying that asked for an undo in words, so the yes to the agent's check straight after it counts. */
let sayingAskedUndo = -1;
/** Each talk's number: a log still running when the next talk starts stays out of that talk's list. */
let talkNumber = 0;
/** One at a time: the voice library runs tool calls side by side. */
let queue: Promise<unknown> = Promise.resolve();

const lineFor = (latest: string): string => (logged.length > 1 ? `${logged.length} logged. Last: ${latest}` : latest);

function showLine(line: string): void {
  state.talk = { ...state.talk, logged: line };
  softly(() => hooks.paintTalk());
}

/** Redrawing is not saving: a redraw that fails never makes a saved log look unsaved. */
function softly(draw: () => void): void {
  try {
    draw();
  } catch {
    // The next redraw shows it.
  }
}

/** A new talk: nothing of the last one can be undone from it. */
export function startTalkLog(): void {
  talkNumber += 1;
  logged = [];
  count = 0;
  sayings = 0;
  lastSaying = "";
  usedSaying = 0;
  sayingAskedUndo = -1;
  state.talk = { ...state.talk, logged: "" };
}

/** The user said something in this talk. */
export function heardHim(words: string): void {
  sayings += 1;
  lastSaying = words;
  if (askedUndo(words)) sayingAskedUndo = sayings;
}

export const canUndoLog = (): boolean => logged.length > 0;

function dhikrOpen(date: string, now: Date) {
  return (session: Session, id: number): boolean => {
    if (!adhkarFor(session).find((item) => item.id === id)?.night) return true;
    const day = state.days.find((d) => d.date === date);
    return !day || now.getTime() >= day.maghrib.getTime();
  };
}

interface Slot<T> { key: string; get: () => T; set: (value: T) => void }

const QURAN: Slot<QuranLog> = { key: KEYS.quran, get: () => state.quran, set: (v) => { state.quran = v; } };
const PRAYER_LOG: Slot<PrayerLog> = { key: KEYS.log, get: () => state.log, set: (v) => { state.log = v; } };
const ADHKAR: Slot<AdhkarLog> = { key: KEYS.adhkar, get: () => state.adhkar, set: (v) => { state.adhkar = v; } };
const LEARN: Slot<Learn> = { key: KEYS.learn, get: () => state.learn, set: (v) => { state.learn = v; } };
const BODY: Slot<BodyLog> = { key: KEYS.body, get: () => state.body, set: (v) => { state.body = v; } };
const MONEY: Slot<Money> = { key: KEYS.money, get: () => state.money, set: (v) => { state.money = v; } };

/** State first, as a tap does; one the phone could not keep is taken back, unless something has changed it since. */
async function commit<T>(slot: Slot<T>, next: T): Promise<(() => Promise<Undone>) | null> {
  const before = slot.get();
  slot.set(next);
  softly(() => hooks.render());
  if (!(await save(slot.key, next))) {
    if (slot.get() === next) slot.set(before);
    softly(() => hooks.render());
    return null;
  }
  return async () => {
    if (slot.get() !== next) return { reverted: false, saved: false };
    slot.set(before);
    softly(() => hooks.render());
    return { reverted: true, saved: await save(slot.key, before) };
  };
}

/** After a save, what else follows it: never the reason a log counts as unsaved. */
async function follow(work: () => void | Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    // The reminders catch up at the next change.
  }
}

async function logQuran(value: QuranLog): Promise<(() => Promise<Undone>) | null> {
  const before = state.quran;
  const bookmark = bookmarkPage(state.mushaf, before);
  const undo = await commit(QURAN, value);
  if (!undo) return null;
  const page = bookmarkAfterLog(bookmark, before, value, "read");
  if (page !== null) {
    state.mushaf = moveBookmark(state.mushaf, page);
    await save(KEYS.mushaf, state.mushaf);
  }
  return async () => {
    const done = await undo();
    if (!done.reverted) return done;
    const back = bookmarkAfterLog(bookmarkPage(state.mushaf, value), value, before, "undo");
    if (back !== null) {
      state.mushaf = moveBookmark(state.mushaf, back);
      await save(KEYS.mushaf, state.mushaf);
    }
    return done;
  };
}

async function logPrayer(value: PrayerLog): Promise<(() => Promise<Undone>) | null> {
  const undo = await commit(PRAYER_LOG, value);
  if (!undo) return null;
  await follow(() => hooks.reschedule());
  return async () => {
    const done = await undo();
    if (done.reverted) await follow(() => hooks.reschedule());
    return done;
  };
}

async function logAdhkar(value: AdhkarLog): Promise<(() => Promise<Undone>) | null> {
  const undo = await commit(ADHKAR, value);
  if (!undo) return null;
  await follow(() => hooks.reschedule());
  return async () => {
    const done = await undo();
    if (done.reverted) await follow(() => hooks.reschedule());
    return done;
  };
}

function apply(plan: LogPlan): Promise<(() => Promise<Undone>) | null> {
  if (plan.store === "quran") return logQuran(plan.value);
  if (plan.store === "prayers") return logPrayer(plan.value);
  if (plan.store === "adhkar") return logAdhkar(plan.value);
  if (plan.store === "learn") return commit(LEARN, plan.value);
  if (plan.store === "body") return commit(BODY, plan.value);
  return commit(MONEY, plan.value);
}

const dayNow = (now = new Date()): string => (state.days.length > 0 ? state.days[prayerDayIndex(state.days, now)].date : today());

async function logOne(args: unknown, now: Date): Promise<string> {
  if (count >= LOGS_PER_TALK) return STOPPED;
  if (sayings === 0 || sayings === usedSaying) return UNHEARD;
  // A yes straight after the user asked for an undo answers that, not a log.
  if (!saidYes(lastSaying) || sayingAskedUndo === sayings - 1) return NO_YES;
  // Taken now, before the save: a second call for this yes, in the same breath, is refused.
  usedSaying = sayings;
  const talk = talkNumber;
  const outcome = planLog(args, {
    today: today(), prayerDay: dayNow(now), bookmark: bookmarkPage(state.mushaf, state.quran), quran: state.quran, prayers: state.log,
    adhkar: state.adhkar, learn: state.learn, body: state.body, money: state.money, moneyAllowed: state.settings.assistantMoney,
    dhikrOpen: dhikrOpen(dayNow(now), now), newId: () => `t${now.getTime().toString(36)}-${newId().slice(-8)}`,
  }, now.getTime());
  if (!outcome.ok) return `Not saved: ${outcome.said}`;
  const undo = await apply(outcome.plan);
  if (!undo) return UNSAVED;
  if (talk === talkNumber) {
    count += 1;
    logged =[...logged, { said: outcome.plan.said, undo }];
    showLine(lineFor(outcome.plan.said));
  }
  return `Saved. ${outcome.plan.said} It can be undone.`;
}

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const turn = queue.then(work, work);
  queue = turn.catch(() => undefined);
  return turn;
}

/** A tool call from the assistant: what it should say back. Never throws. */
export function logFromTalk(args: unknown, now = new Date()): Promise<string> {
  return inTurn(() => logOne(args, now).catch(() => UNSAVED));
}

async function undoOne(): Promise<string> {
  const last = logged[logged.length - 1];
  if (!last) return "There is nothing to undo.";
  logged = logged.slice(0, -1);
  const done = await last.undo().catch((): Undone => ({ reverted: false, saved: false }));
  if (!done.reverted) {
    const said = `Could not undo: "${last.said}" changed since. Change it on the screen.`;
    showLine(said);
    return said;
  }
  if (!done.saved) {
    const said = `Undone here, but this phone could not save that. Check "${last.said}" after a restart.`;
    showLine(said);
    return said;
  }
  const previous = logged[logged.length - 1];
  showLine(previous ? lineFor(previous.said) : "");
  return "Undone.";
}

/** The button on the sheet: the user's own tap, so nothing more to check. */
export function undoTalkLog(): Promise<string> {
  return inTurn(undoOne);
}

/** The assistant's undo_log: one undo for each time the user asks, so words in a data block cannot take back what the user logged. */
export function undoFromTalk(): Promise<string> {
  return inTurn(async () => {
    // A saying used for one thing is not used again, and a yes counts only as the answer to the user's asking for an undo.
    const asked = sayingAskedUndo === sayings || (sayingAskedUndo === sayings - 1 && saidYes(lastSaying));
    if (sayings === usedSaying || !asked) return NO_UNDO;
    usedSaying = sayings;
    sayingAskedUndo = -1;
    return undoOne();
  });
}
