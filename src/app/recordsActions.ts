/**
 * Keeps the user's records the same on every device (sync/records.ts): the prayer marks, the Quran log, the adhkar, the
 * Friday routine, the mushaf's marks and notes, the muraja'ah plan and Learn. Every save of one of them is compared
 * and stamped as it is saved (recordSaved, from state.ts's save), and synced a moment later; a sync also runs when the
 * app starts or comes back and after a Talk sign-in. One sync at a time; a change during one is sent right after it.
 * What another device changed is saved here directly (store.write), so it is never stamped as a change made here.
 */
import { isNative } from "../device.ts";
import {
  adhkarCollection, bodyCollection, foodCollection, fridayCollection, learnCollection, modesCollection, moneyCollection, murajaahCollection, mushafCollection,
  prayerCollection, quranCollection, reviewsCollection,
} from "../sync/collections.ts";
import {
  acknowledge, applyReply, joinPages, kindsOf, outgoing, postRecords, stampSaved, startFresh, type Collection,
  type Post, type RecordsNote, type Reply, type Wire,
} from "../sync/records.ts";
import { autoDelay, held, holdEnds, holdFor } from "../sync/pace.ts";
import { emptyLearn } from "../learn/learn.ts";
import { seedLearn } from "../learn/seed.ts";
import { KEYS, write } from "../store.ts";
import { clearSession, sessionToken } from "../talk/session.ts";
import { workerUrl } from "../voice.ts";
import { keepReviewDraft } from "./reviewActions.ts";
import { hooks, state } from "./state.ts";

/** Changes come in runs (dhikr after dhikr): a sync goes once they have paused this long, and the gap is kept. */
export const RECORDS_PAUSE_MS = 10_000;
/**
 * Exchanges in one sync at most: room for a whole run from cursor 0 at the Worker's limits (100,000 records and
 * 100,000 removals at 2,000 a page) and the sends after it, so a run is never cut off and started again forever.
 */
const ROUNDS_MAX = 120;
const STUCK = "The Worker kept saying there was more without sending it. Try again later.";
const NOTES_UNSAVED = "This device could not save its sync notes.";
const UNREADABLE = "Some records on this device could not be read, so syncing waits until the app restarts.";
const NOTHING_SENT: Wire = { cursor: 0, records: [], removed: [] };

const COLLECTIONS: readonly Collection[] = [prayerCollection, quranCollection, adhkarCollection, fridayCollection,
  mushafCollection, murajaahCollection, learnCollection, modesCollection, moneyCollection, bodyCollection,
  foodCollection, reviewsCollection] as readonly Collection[];
const KINDS = kindsOf(COLLECTIONS);

/** Each synced store key's value in the app's state, and how a value from another device is put back. */
const ACCESS: Readonly<Record<string, { get: () => unknown; set: (value: never) => void }>> = {
  [KEYS.log]: { get: () => state.log, set: (v) => { state.log = v; } },
  [KEYS.quran]: { get: () => state.quran, set: (v) => { state.quran = v; } },
  [KEYS.adhkar]: { get: () => state.adhkar, set: (v) => { state.adhkar = v; } },
  [KEYS.friday]: { get: () => state.friday, set: (v) => { state.friday = v; } },
  [KEYS.mushaf]: { get: () => state.mushaf, set: (v) => { state.mushaf = v; } },
  [KEYS.murajaah]: { get: () => state.murajaah, set: (v) => { state.murajaah = v; } },
  [KEYS.learn]: { get: () => state.learn, set: (v) => { state.learn = v; } },
  [KEYS.modes]: { get: () => state.modes, set: (v) => { state.modes = v; } },
  [KEYS.money]: { get: () => state.money, set: (v) => { state.money = v; } },
  [KEYS.body]: { get: () => state.body, set: (v) => { state.body = v; } },
  [KEYS.food]: { get: () => state.food, set: (v) => { state.food = v; } },
  [KEYS.reviews]: { get: () => state.reviews, set: (v) => { state.reviews = v; } },
};

let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;
let lastRun = 0;

/**
 * The collections that can sync now with their values: one whose saved copy could not be read is left out, and
 * Learn's unsaved starting tracks count as nothing (state.learnSeedOnly), so the user's other devices' Learn takes their place.
 */
function values(): [Collection, unknown][] {
  return COLLECTIONS.filter((c) => !state.blocked.has(c.key) && ACCESS[c.key])
    .map((c) => [c, c.key === KEYS.learn && state.learnSeedOnly ? emptyLearn() : ACCESS[c.key].get()]);
}

function show(next: RecordsNote): void {
  state.recordsNote = next;
  hooks.softRender();
}

const pending = (): boolean => state.recordsSync.dirty.length > 0 || state.recordsSync.removed.length > 0;

/**
 * A synced value was saved here (state.ts's save calls this once it is on disk): its changes are stamped and marked,
 * and a sync goes once the changes settle. Never throws.
 */
export function recordSaved(key: string, value: unknown): void {
  const collection = COLLECTIONS.find((c) => c.key === key);
  if (!collection || state.blocked.has(key)) return;
  try {
    let base = state.recordsSync;
    // The user's first change to Learn saves it: from then on its tracks are this device's own. The starting tracks the user left as
    // they were go in at the oldest stamp, so an edit or a removal made on another device meanwhile wins over them.
    if (key === KEYS.learn && state.learnSeedOnly) {
      state.learnSeedOnly = false;
      base = stampSaved(learnCollection, seedLearn(), base, 1);
    }
    // Money, Body, Food and the reviews are put in state before they are saved, so state is the newer: a sync that landed
    // during the save is in it, and stamping the older value would mark what arrived as removed, on every device.
    const current = key === KEYS.money || key === KEYS.body || key === KEYS.food || key === KEYS.reviews ? ACCESS[key].get() : value;
    const next = stampSaved(collection, current, base, Date.now());
    if (next === state.recordsSync) return;
    state.recordsSync = next;
    void write(KEYS.recordsSync, next);
    clearTimeout(timer);
    timer = setTimeout(() => void syncRecords(), autoDelay(lastRun, RECORDS_PAUSE_MS));
  } catch {
    // A value that could not be compared is sent with the next full sync.
  }
}

async function syncOnce(send?: Post): Promise<void> {
  const worker = workerUrl(state.settings.voiceUrl);
  // No sync server set up: the records simply live on this device, and nothing asks for a sign-in.
  if (!worker) return show({ state: "idle" });
  const token = sessionToken(state.talk.session, worker);
  if (token === null) return show({ state: "signin" });
  // A record that could not be read here would pass over what arrives for it while the cursor moves on: no sync until
  // the app restarts and reads it again.
  if (COLLECTIONS.some((c) => state.blocked.has(c.key))) return show({ state: "refused", error: UNREADABLE });
  if (state.recordsSync.worker !== worker) {
    state.recordsSync = { ...startFresh(values(), worker, Date.now()), kinds: KINDS };
    if (!(await write(KEYS.recordsSync, state.recordsSync))) return show({ state: "refused", error: NOTES_UNSAVED });
  } else if (state.recordsSync.kinds !== KINDS) {
    // This version syncs kinds the last did not: everything once more, so records of them passed over arrive now. Body's
    // log was kept on each device before it synced: what is here goes too, at the oldest stamp, so a later edit elsewhere wins.
    state.recordsSync = { ...stampSaved(bodyCollection, state.body, state.recordsSync, 1), kinds: KINDS, cursor: 0 };
    if (!(await write(KEYS.recordsSync, state.recordsSync))) return show({ state: "refused", error: NOTES_UNSAVED });
  }
  show({ state: "syncing" });
  let first = !state.recordsSync.listened;
  // With changes of its own waiting, a device hears first and sends after, so a day marked on two devices is joined
  // here before it goes (sending first would overwrite the other device's marks on the Worker).
  let pull = first || pending();
  let reminders = false;
  // A paged run (the Worker says "more") is gathered and taken in once it ends, so a Learn item and its track, sent on
  // different pages, are read together. Until then the run's cursor stays out of the saved notes.
  let pages: Reply[] = [];
  let cursor = state.recordsSync.cursor;
  let done = false;
  for (let round = 0; round < ROUNDS_MAX && !done; round += 1) {
    // While pages of a run wait to be taken in, nothing is sent: a record sent now could be overwritten here by an
    // older copy on one of those pages.
    const listening = pull || pages.length > 0;
    const wire = { ...outgoing(values(), state.recordsSync, listening), cursor };
    const sent = await postRecords(worker, token, wire, send);
    if (!sent.ok) {
      if (sent.why === "signin" && state.talk.session?.token === token) {
        state.talk = { ...state.talk, session: null };
        await clearSession();
      }
      if (sent.why === "busy") return show({ state: "busy", until: holdFor(sent.retryAfter) });
      return show(sent.why === "refused" ? { state: "refused", error: sent.error } : { state: sent.why });
    }
    const reply = sent.reply;
    if (reply.more && reply.cursor <= cursor) return show({ state: "refused", error: STUCK });
    // What the Worker took is acknowledged at once; anything changed during the exchange stays marked.
    state.recordsSync = acknowledge(state.recordsSync, wire);
    pages = [...pages, reply];
    cursor = reply.cursor;
    if (reply.more) continue;
    // The run is whole: taken in against the values as they are now.
    const applied = applyReply(values(), state.recordsSync, NOTHING_SENT, joinPages(pages), Date.now(), first);
    pages = [];
    // State first, all at once and before any wait, so a save made meanwhile is stamped on top of it, never under it.
    const bookmarkBefore = state.mushaf.lastPageAt;
    for (const [key, value] of applied.values) {
      // What is typed in this week's review, and not kept yet, is held before the week it was typed over changes.
      if (key === KEYS.reviews) keepReviewDraft();
      ACCESS[key].set(value as never);
      if (key === KEYS.learn) state.learnSeedOnly = false;
      // A week reviewed on another device needs no review reminder here.
      if (key === KEYS.log || key === KEYS.adhkar || key === KEYS.friday || key === KEYS.reviews) reminders = true;
    }
    state.recordsSync = applied.sync;
    // The mushaf's bookmark itself came from another device (not a mark or note beside it): the open reader may follow.
    if (state.mushaf.lastPageAt !== bookmarkBefore) hooks.bookmarkArrived();
    // Then the disk: the values first, the notes last (a note saved without its value would make the old value look
    // like a change made here). Each value as it stands now, so a save made during these writes is not undone.
    for (const key of applied.values.keys()) {
      if (!(await write(key, ACCESS[key].get()))) return show({ state: "refused", error: "This device could not save what arrived." });
    }
    if (!(await write(KEYS.recordsSync, state.recordsSync))) return show({ state: "refused", error: NOTES_UNSAVED });
    if (applied.values.size > 0) hooks.softRender();
    first = false;
    pull = false;
    // Done once nothing waits, or once a round sent nothing (what is left cannot be sent: it waits for a change).
    done = !pending() || (wire.records.length === 0 && wire.removed.length === 0 && !listening);
  }
  show(done ? { state: "synced", at: new Date() } : { state: "partial" });
  // A prayer, the adhkar, the Friday routine or a review marked elsewhere changes what the reminders here should say.
  if (reminders) await hooks.reschedule();
}

/** Syncs now; in the installed app only, once the Talk session has been read. Never rejects. */
export function syncRecords(send?: Post): Promise<void> {
  if (!isNative() || !state.talk.sessionRead) return Promise.resolve();
  clearTimeout(timer);
  if (held()) {
    // The Worker asked for a pause: a change made meanwhile goes once it is over.
    show({ state: "busy", until: holdEnds() });
    if (pending()) timer = setTimeout(() => void syncRecords(), holdEnds().getTime() - Date.now() + 1000);
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      lastRun = Date.now();
      try {
        await syncOnce(send);
      } catch {
        show({ state: "offline" });
      }
    } while (again && !held());
    // A run the Worker paused with changes still waiting: they go once the pause is over.
    if (held() && pending()) {
      clearTimeout(timer);
      timer = setTimeout(() => void syncRecords(), holdEnds().getTime() - Date.now() + 1000);
    }
  })().finally(() => { running = null; });
  return running;
}

/**
 * A sync for a screen opened or the app come back: now, unless one ran in the last half minute, then once the gap is
 * over, so moving between screens never spends the Worker's hourly allowance.
 */
export function syncRecordsSoon(): void {
  if (!isNative() || !state.talk.sessionRead) return;
  const wait = autoDelay(lastRun, 0);
  if (wait <= 0) {
    void syncRecords();
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => void syncRecords(), wait);
}

/** For tests: forget any planned sync. */
export function resetRecordsSync(): void {
  clearTimeout(timer);
  again = false;
  lastRun = 0;
}
