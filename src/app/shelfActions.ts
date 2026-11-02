/**
 * Keeps the TV's shelf in step with the books in hand: sent a moment after the library changes, when the app starts or
 * comes back, when Books opens, and after a Talk sign-in; only when what the TV would show (or the session) changed
 * since the Worker last took it. One send at a time; a change during a send is sent right after it.
 */
import { isNative } from "../device.ts";
import { sendShelf, shelfBooks, type Put, type ShelfState } from "../books/shelf.ts";
import { KEYS } from "../store.ts";
import { clearSession, sessionToken } from "../talk/session.ts";
import { workerUrl } from "../voice.ts";
import { hooks, state } from "./state.ts";

/** Library changes come in bursts (an import, a run of covers): one send after they settle. */
export const SHELF_PAUSE_MS = 3000;

/** The Worker, session and shelf the Worker last took, this run; kept in memory only. */
let lastTaken = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;

function show(next: ShelfState): void {
  state.tvShelf = next;
  hooks.softRender();
}

async function sendOnce(send?: Put): Promise<void> {
  // A library that could not be read is empty on screen, not empty: the TV keeps the shelf it has.
  if (state.blocked.has(KEYS.library)) return;
  const worker = workerUrl(state.settings.voiceUrl);
  const token = sessionToken(state.talk.session, worker);
  if (!worker || token === null) {
    // Whatever was sent before is no longer what the screen says: the next send with a session goes again.
    lastTaken = "";
    // With no server set up there is nothing to sign in to, so nothing is said.
    return show(worker ? { state: "signin" } : { state: "idle" });
  }
  const books = shelfBooks(state.library);
  const taken = `${worker}\n${token}\n${JSON.stringify(books)}`;
  if (taken === lastTaken) return;
  const sent = await sendShelf(worker, token, books, send);
  if (sent.ok) {
    lastTaken = taken;
    show({ state: "sent", count: books.length, at: new Date() });
    return;
  }
  // The Worker no longer knows this session (signed out elsewhere, or the passphrase changed): it is dropped, as Talk
  // drops it, so Settings stops saying signed in and the next sign-in starts afresh. Not if a new one came meanwhile.
  if (sent.why === "signin" && state.talk.session?.token === token) {
    state.talk = { ...state.talk, session: null };
    await clearSession();
  }
  show(sent.why === "refused" ? { state: "refused", error: sent.error } : { state: sent.why });
}

/** Sends the shelf now if it changed; in the installed app only, once the Talk session has been read. Never rejects. */
export function syncShelf(send?: Put): Promise<void> {
  if (!isNative() || !state.talk.sessionRead) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await sendOnce(send);
      } catch {
        // A redraw that failed: the shelf is tried again at the next change, Books or return to the app.
      }
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

/** The library changed: the shelf goes once the changes settle. */
export function shelfChanged(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncShelf(), SHELF_PAUSE_MS);
}

/** For tests: forget what was sent. */
export function resetShelf(): void {
  clearTimeout(timer);
  lastTaken = "";
  again = false;
}
