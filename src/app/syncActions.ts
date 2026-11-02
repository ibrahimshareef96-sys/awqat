/**
 * Keeps the library the same on every device (books/sync.ts): synced when the app starts or comes back, when Books
 * opens, after a Talk sign-in, and a moment after the library changes. One sync at a time; a change during one is sent
 * right after it. A first sync listens until it has everything before it sends anything. Books that arrive without a
 * cover saved here get theirs found afterwards.
 */
import { isNative } from "../device.ts";
import { needsCover } from "../books/library.ts";
import { applyReply, outgoing, postBooks, startFresh, type BookSyncState, type Post } from "../books/sync.ts";
import { autoDelay, held, holdEnds, holdFor } from "../sync/pace.ts";
import { KEYS } from "../store.ts";
import { clearSession, sessionToken } from "../talk/session.ts";
import { workerUrl } from "../voice.ts";
import { releasePhoto, setLibrary } from "./bookActions.ts";
import { hooks, save, state } from "./state.ts";

/** Library changes come in bursts (an import, a run of covers): one sync after they settle. */
export const SYNC_PAUSE_MS = 3000;
/** A sync gives up for now after this many exchanges; the next trigger carries on from where it stopped. */
const ROUNDS_MAX = 30;
const STUCK = "The Worker kept saying there was more without sending it. Try again later.";

let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;
let lastRun = 0;

function show(next: BookSyncState): void {
  state.bookSyncNote = next;
  hooks.softRender();
}

const pending = (): boolean =>
  state.bookSync.dirty.length > 0 || state.bookSync.removed.length > 0 || state.bookSync.goalDirty;

async function syncOnce(send?: Post): Promise<void> {
  // A library or sync state that could not be read is not the user's library: nothing is sent from it or taken into it.
  if (state.blocked.has(KEYS.library) || state.blocked.has(KEYS.bookSync)) return;
  const worker = workerUrl(state.settings.voiceUrl);
  // No sync server set up: the library simply lives on this device, and nothing asks for a sign-in.
  if (!worker) return show({ state: "idle" });
  const token = sessionToken(state.talk.session, worker);
  if (token === null) return show({ state: "signin" });
  if (state.bookSync.worker !== worker) {
    const fresh = startFresh(state.library, worker, Date.now());
    state.bookSync = fresh.sync;
    if (fresh.library !== state.library && !(await setLibrary(fresh.library, { soft: true, fromSync: true }))) return;
    if (!(await save(KEYS.bookSync, state.bookSync))) return;
  }
  show({ state: "syncing" });
  let arrived = 0;
  // Until it has heard everything once, this device only listens, so its own copies of books already there are folded
  // in; a first sync cut off half way listens again next time.
  let first = !state.bookSync.listened;
  for (let round = 0; round < ROUNDS_MAX; round += 1) {
    const listen = first;
    const { wire, tooBig } = outgoing(state.library, state.bookSync, listen);
    const before = state.bookSync.cursor;
    const sent = await postBooks(worker, token, wire, send);
    if (!sent.ok) {
      if (sent.why === "signin" && state.talk.session?.token === token) {
        state.talk = { ...state.talk, session: null };
        await clearSession();
      }
      if (sent.why === "busy") return show({ state: "busy", until: holdFor(sent.retryAfter) });
      return show(sent.why === "refused" ? { state: "refused", error: sent.error } : { state: sent.why });
    }
    // Taken in against the library as it is now: anything changed during the exchange is still marked.
    const applied = applyReply(state.library, state.bookSync, wire, sent.reply, Date.now(), first);
    const skipped = new Set(tooBig);
    state.bookSync = { ...applied.sync, dirty: applied.sync.dirty.filter((id) => !skipped.has(id)) };
    arrived += applied.arrived;
    if (applied.library !== state.library && !(await setLibrary(applied.library, { soft: true, fromSync: true }))) return;
    if (!(await save(KEYS.bookSync, state.bookSync))) return;
    for (const name of applied.freed) await releasePhoto(name);
    if (!sent.reply.more) first = false;
    if (!sent.reply.more && !pending()) break;
    // "More" without moving on is a Worker gone wrong: stop rather than ask the same thing again and again.
    if (sent.reply.more && sent.reply.cursor <= before) return show({ state: "refused", error: STUCK });
  }
  show({ state: "synced", at: new Date() });
  // Books that came without a cover saved here, or whose cover changed elsewhere, get theirs.
  if (arrived > 0 || needsCover(state.library).length > 0) void hooks.findCovers(true);
}

/** Syncs now; in the installed app only, once the Talk session has been read. Never rejects. */
export function syncBooks(send?: Post): Promise<void> {
  if (!isNative() || !state.talk.sessionRead) return Promise.resolve();
  clearTimeout(timer);
  if (held()) {
    show({ state: "busy", until: holdEnds() });
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
        // A redraw or a save that threw: the next trigger syncs again from the saved state.
        show({ state: "offline" });
      }
    } while (again && !held());
    // A run the Worker paused with changes still waiting: they go once the pause is over.
    if (held() && pending()) {
      clearTimeout(timer);
      timer = setTimeout(() => void syncBooks(), holdEnds().getTime() - Date.now() + 1000);
    }
  })().finally(() => { running = null; });
  return running;
}

/** A sync for Books opened or the app come back: now, or once the half-minute gap since the last is over. */
export function syncBooksSoon(): void {
  if (!isNative() || !state.talk.sessionRead) return;
  const wait = autoDelay(lastRun, 0);
  if (wait <= 0) {
    void syncBooks();
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => void syncBooks(), wait);
}

/** The library changed here: a sync goes once the changes settle, keeping the gap between syncs (sync/pace.ts). */
export function booksChanged(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncBooks(), autoDelay(lastRun, SYNC_PAUSE_MS));
}

/** For tests: forget any planned sync. */
export function resetBookSync(): void {
  clearTimeout(timer);
  again = false;
  lastRun = 0;
}
