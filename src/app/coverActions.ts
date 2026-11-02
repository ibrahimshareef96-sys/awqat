/**
 * Finding covers for books that have none: when the user taps Find covers, and by itself after a Goodreads import, after a
 * sync brings books, and when the app starts, so imported books can get covers without a manual search.
 * Each lookup sends one ISBN to Open Library, or the title and first author for a book with none, and each cover found
 * is saved on the phone. Gentle (a pause between books), and it stops when Open Library says so.
 */
import { markCoverChecked, needsCover, updateBook, type Book, type Library } from "../books/library.ts";
import { findIsbn, findTitle, type Lookup } from "../books/openlibrary.ts";
import { stampChanges } from "../books/sync.ts";
import { removeUnusedCovers, saveCover } from "../books/media.ts";
import { KEYS } from "../store.ts";
import { releasePhoto, setLibrary } from "./bookActions.ts";
import { MESSAGES, hooks, setNotice, state, today } from "./state.ts";

const PER_RUN = 300;
const GAP_MS = 1200;
const FAILURES_BEFORE_STOP = 3;
const SAVE_EVERY = 10;
/** The pause before a run the app started takes its next batch. */
const AUTO_AGAIN_MS = 5000;
/** After Open Library asks to slow down, runs the app starts by itself wait this long (a tap still asks). */
const SLOW_DOWN_MS = 10 * 60 * 1000;
let slowUntil = 0;

/** For tests: forget a slow-down Open Library asked for. */
export function forgetSlowDown(): void {
  slowUntil = 0;
}
/** Books that failed this session wait for the next app start, so a few stubborn ones never block the rest. */
const failedThisSession = new Set<string>();

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Step = "found" | "none" | "failed" | "slow-down" | "skipped";

/** The book still wants this cover: it exists and nothing (the user's own photo, say) arrived while Open Library answered. */
const stillWanted = (id: string): boolean => state.library.books.some((b) => b.id === id && !b.photo);

/**
 * A change found in the background, stamped as it is made (books/sync.ts), so the cover's id, the pages and "Open
 * Library has none" reach the user's other devices; the cover file itself stays here. Stamped just after the copy it changed,
 * not with the clock: a lookup on a stale copy never outranks a real edit or a removal made elsewhere meanwhile. Saved
 * a batch at a time (keep).
 */
function change(next: Library): void {
  const stamped = stampChanges(state.library, next, 0, state.bookSync);
  state.library = stamped.library;
  state.bookSync = stamped.sync;
}

/** Open Library by ISBN first; when that finds no cover (or the book has no ISBN), by its title and first author. */
async function lookUp(book: Book): Promise<Lookup> {
  const byIsbn: Lookup = book.isbn ? await findIsbn(book.isbn) : { none: true };
  if ("failed" in byIsbn || ("found" in byIsbn && byIsbn.found.coverId !== null)) return byIsbn;
  // A title alone ("Poems", "Untitled") is too loose to trust a cover to.
  if (!book.authors[0]) return byIsbn;
  if (book.isbn) await pause(GAP_MS / 2);
  return findTitle(book.title, book.authors[0]);
}

/** One book: save its known cover, or ask Open Library for one. */
async function coverFor(id: string): Promise<Step> {
  const book = state.library.books.find((b) => b.id === id);
  if (!book || book.photo) return "skipped";
  let coverId = book.coverId;
  if (coverId === null) {
    const lookup = await lookUp(book);
    if ("failed" in lookup) return lookup.slowDown ? "slow-down" : "failed";
    if (!stillWanted(id)) return "skipped";
    if ("none" in lookup || lookup.found.coverId === null) {
      const pages = "found" in lookup ? lookup.found.pages : null;
      const known = state.library.books.find((b) => b.id === id)?.pages;
      change(markCoverChecked(pages && !known ? updateBook(state.library, id, { pages }) : state.library, id, today()));
      return "none";
    }
    coverId = lookup.found.coverId;
    const known = state.library.books.find((b) => b.id === id)?.pages;
    change(updateBook(state.library, id, { coverId, ...(known ? {} : { pages: lookup.found.pages }) }));
  }
  const saved = await saveCover(coverId);
  if ("failed" in saved) return "failed";
  if (!stillWanted(id)) {
    if ("photo" in saved) await releasePhoto(saved.photo);
    return "skipped";
  }
  if ("missing" in saved) {
    change(markCoverChecked(updateBook(state.library, id, { coverId: null }), id, today()));
    return "none";
  }
  change(updateBook(state.library, id, { photo: saved.photo }));
  return "found";
}

function finish(found: number, total: number, stopped: string, saved: boolean, auto: boolean): void {
  state.covers = null;
  if (!saved) setNotice(MESSAGES.unsaved);
  // A run nobody asked for says only what it found; when Open Library was slow, the next start tries again.
  else if (auto) {
    if (found > 0) setNotice(`Found ${found} cover${found === 1 ? "" : "s"}.`);
  } else {
    setNotice(stopped || `Found ${found} cover${found === 1 ? "" : "s"} for ${total} book${total === 1 ? "" : "s"}.` +
      (needsCover(state.library).some((b) => !failedThisSession.has(b.id)) ? " Tap Find covers again for the rest." : ""));
  }
  hooks.softRender();
}

/** Finds covers; `auto` for a run the app starts by itself, which says nothing unless it found some. */
export async function findCovers(auto = false): Promise<void> {
  if (state.covers || (auto && Date.now() < slowUntil)) return;
  if (state.blocked.has(KEYS.library)) return auto ? undefined : void setNotice(MESSAGES.unreadable);
  const waiting = needsCover(state.library);
  const ids = waiting.filter((b) => !failedThisSession.has(b.id)).slice(0, PER_RUN).map((b) => b.id);
  if (ids.length === 0) {
    if (auto) return;
    return void setNotice(waiting.length ? "The books left could not get a cover just now. Try again after reopening the app."
      : "Every book that can have a cover from Open Library has one.");
  }
  state.covers = { done: 0, total: ids.length };
  // A run nobody tapped for must not redraw under someone typing.
  if (auto) hooks.softRender();
  else hooks.render();
  let found = 0;
  let failures = 0;
  let unsaved = 0;
  let stopped = "";
  let saved = true;
  // Each change was stamped as it was made (change below): saved as it is, a batch at a time.
  const keep = (): Promise<boolean> => setLibrary(state.library, { soft: true, stamped: true });
  try {
    for (const id of ids) {
      const step = await coverFor(id);
      if (step === "slow-down") {
        stopped = "Open Library asked the app to slow down. Try Find covers again later.";
        slowUntil = Date.now() + SLOW_DOWN_MS;
        break;
      }
      if (step === "failed") failedThisSession.add(id);
      failures = step === "failed" ? failures + 1 : 0;
      if (failures >= FAILURES_BEFORE_STOP) {
        stopped = "Open Library is not answering just now. Try Find covers again later.";
        break;
      }
      if (step === "found") found += 1;
      if (step === "found" || step === "none") unsaved += 1;
      if (unsaved >= SAVE_EVERY) {
        saved = (await keep()) && saved;
        unsaved = 0;
      }
      state.covers = { done: (state.covers?.done ?? 0) + 1, total: ids.length };
      hooks.softRender();
      if (step !== "skipped") await pause(GAP_MS);
    }
  } finally {
    saved = (await keep()) && saved;
    finish(found, ids.length, stopped, saved, auto);
  }
  // A run the app started goes on by itself, a batch at a time, until every book has been asked about once.
  if (auto && !stopped && saved && needsCover(state.library).some((b) => !failedThisSession.has(b.id))) {
    setTimeout(() => void findCovers(true), AUTO_AGAIN_MS);
  }
}

/**
 * Clears cover files left behind by an interrupted save; run once at start-up, and only when the library was read
 * cleanly. A library that could not be read looks empty, and every cover would look unused.
 */
export async function tidyCovers(libraryReadCleanly: boolean): Promise<void> {
  if (!libraryReadCleanly || state.blocked.has(KEYS.library)) return;
  const photos = state.library.books.flatMap((b) => (b.photo ? [b.photo] : []));
  await removeUnusedCovers(new Set(state.draft.photo ? [...photos, state.draft.photo] : photos));
}
