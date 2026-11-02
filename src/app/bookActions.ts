/** What the Books screens do: add a book (scan, photo, typed, Goodreads), and keep its progress, lessons and notes. */
import {
  SHELF_LABEL, SHELVES, addBook, addLesson, currentPage, deleteBook, deleteLesson, logPages, photoInUse, setCommentary,
  setGoal, setShelf, updateBook, type Book, type Draft, type Library, type Shelf,
} from "../books/library.ts";
import { cleanIsbn } from "../books/isbn.ts";
import { lookupIsbn } from "../books/openlibrary.ts";
import { GOODREADS_MAX_ROWS, goodreadsDrafts, importDrafts, parseCsv } from "../books/goodreads.ts";
import { coverPhoto, downloadCover, removeCoverPhoto, scanIsbn } from "../books/media.ts";
import { KEYS } from "../store.ts";
import { LIST_PAGE, announce, busyWhile, emptyDraft, hooks, save, setNotice, state, today } from "./state.ts";
import { shelfChanged } from "./shelfActions.ts";
import { booksChanged } from "./syncActions.ts";
import { stampChanges } from "../books/sync.ts";

const GOODREADS_MAX_BYTES = 5 * 1024 * 1024;

interface SetOptions {
  said?: string;
  /** Saved without a redraw: the screen already shows it (notes being typed). */
  quiet?: boolean;
  /** Redrawn only if nobody is typing (background work). */
  soft?: boolean;
  /** What the sync took in or stamped itself (app/syncActions.ts): kept as it is, not marked to be sent back. */
  fromSync?: boolean;
  /** Changes already stamped as they were made (covers found in the background): saved, marked and synced as they are. */
  stamped?: boolean;
}

/**
 * Shows and saves a new library; true once it is on disk. A change made here is stamped and marked for the other
 * devices (books/sync.ts) and synced once the changes settle; the TV's shelf follows once it is saved.
 */
export async function setLibrary(library: Library, options: SetOptions = {}): Promise<boolean> {
  const stamped = options.fromSync || options.stamped ? null
    : stampChanges(state.library, library, Date.now(), state.bookSync);
  state.library = stamped?.library ?? library;
  const marked = options.stamped === true || (stamped !== null && stamped.sync !== state.bookSync);
  if (stamped) state.bookSync = stamped.sync;
  if (options.soft) hooks.softRender();
  else if (!options.quiet) hooks.render();
  if (options.said) announce(options.said);
  // The marks first: a mark for a change that was then not saved only sends a book again; a change saved without its
  // mark would never reach the other devices.
  const markSaved = marked ? await save(KEYS.bookSync, state.bookSync) : false;
  const saved = await save(KEYS.library, state.library);
  if (saved) {
    if (markSaved) booksChanged();
    shelfChanged();
  }
  return saved;
}

/** Deletes a cover file once no book shows it (an Open Library cover can be shared by two editions). */
export async function releasePhoto(name: string | null): Promise<void> {
  if (name && !photoInUse(state.library, name) && name !== state.draft.photo) await removeCoverPhoto(name);
}

function currentBookId(): string | null {
  return state.screen.startsWith("book:") ? state.screen.slice(5) : null;
}

function openSheet(sheet: "add-book" | "new-book"): void {
  state.sheet = sheet;
  hooks.renderOverlay();
}

function tryAdd(draft: Draft): ReturnType<typeof addBook> | null {
  try {
    return addBook(state.library, draft, today());
  } catch (error) {
    setNotice(error instanceof RangeError && /full/.test(error.message)
      ? "Your library is full. Remove some books to add more." : "A book needs a title.");
    return null;
  }
}

/** Adds a draft and opens the book; a book already there opens instead, and a spare cover is not kept twice. */
async function addAndOpen(draft: Draft): Promise<void> {
  const result = tryAdd(draft);
  if (!result) {
    if (draft.photo !== state.draft.photo) await releasePhoto(draft.photo);
    return;
  }
  let library = result.library;
  const attach = result.duplicate && draft.photo !== null && !result.book.photo;
  if (attach) library = updateBook(library, result.book.id, { photo: draft.photo });
  state.sheet = null;
  state.draft = emptyDraft();
  const saved = await setLibrary(library);
  if (saved && result.duplicate && !attach) await releasePhoto(draft.photo);
  hooks.renderOverlay();
  hooks.go(`book:${result.book.id}`);
  setNotice(result.duplicate ? `"${result.book.title}" is already in your library.` : `Added "${result.book.title}".`);
  hooks.render();
}

export function typeIn(): void {
  state.draft = emptyDraft();
  openSheet("new-book");
}

export function scan(): Promise<void> {
  return busyWhile(async () => {
    const result = await scanIsbn();
    if ("cancelled" in result) return;
    if ("failed" in result) return setNotice("The scanner could not start. Allow the camera for Awqat in the phone's Settings.");
    if ("notIsbn" in result) return setNotice("That barcode is not a book's ISBN. Try the barcode on the back cover.");
    announce("Looking the book up.");
    const found = await lookupIsbn(result.isbn);
    if (!found) {
      state.draft = { ...emptyDraft(), isbn: result.isbn };
      openSheet("new-book");
      return setNotice("Open Library has no record of that ISBN. Type the title and it is saved with the ISBN.");
    }
    const photo = found.coverId ? await downloadCover(found.coverId) : null;
    await addAndOpen({ ...found, isbn: result.isbn, photo, source: "scan" });
  });
}

export function photograph(from: "camera" | "gallery"): Promise<void> {
  return busyWhile(async () => {
    const photo = await coverPhoto(from);
    if (!photo) return setNotice(from === "camera" ? "No photo was taken." : "No photo was chosen, or it could not be read.");
    state.draft = { ...state.draft, photo };
    openSheet("new-book");
  });
}

export function submitNewBook(form: FormData): Promise<void> {
  // Read before any wait: the sheet's photo and fields are this book's, whatever happens meanwhile.
  const photo = state.draft.photo;
  const title = String(form.get("title") ?? "").trim();
  const author = String(form.get("author") ?? "");
  const isbn = cleanIsbn(String(form.get("isbn") ?? ""));
  const pages = Number(form.get("pages"));
  const shelfValue = String(form.get("shelf"));
  const shelf = SHELVES.includes(shelfValue as Shelf) ? (shelfValue as Shelf) : "want";
  return busyWhile(async () => {
    if (!title) return setNotice("A book needs a title.");
    const found = isbn ? await lookupIsbn(isbn) : null;
    const cover = photo ?? (found?.coverId ? await downloadCover(found.coverId) : null);
    await addAndOpen({
      title, authors: author.trim() ? [author] : found?.authors ?? [], isbn,
      pages: Number.isInteger(pages) && pages > 0 ? pages : found?.pages ?? null,
      coverId: found?.coverId ?? null, photo: cover, shelf,
      source: photo ? "photo" : "typed",
    });
  });
}

/** Leaving the new-book sheet without saving drops its photo, so no stray files stay behind. */
export function cancelNewBook(): void {
  const photo = state.draft.photo;
  state.draft = emptyDraft();
  void releasePhoto(photo);
}

export function importGoodreads(file: File): Promise<void> {
  return busyWhile(async () => {
    try {
      // Read no more than the cap, in bytes, whatever size the file says it is.
      const part = file.slice(0, GOODREADS_MAX_BYTES + 1);
      if (part.size > GOODREADS_MAX_BYTES) return setNotice("That file is larger than a Goodreads export should be.");
      // The header, the rows used, and one more to tell whether any were left out.
      const rows = parseCsv(await part.text(), GOODREADS_MAX_ROWS + 2);
      const drafts = goodreadsDrafts(rows);
      const result = importDrafts(state.library, drafts, today());
      state.sheet = null;
      await setLibrary(result.library);
      hooks.renderOverlay();
      hooks.go("books");
      const cut = rows.length - 1 > GOODREADS_MAX_ROWS ? ` Only the first ${GOODREADS_MAX_ROWS.toLocaleString("en-GB")} rows were read.` : "";
      setNotice(`Added ${result.added} book${result.added === 1 ? "" : "s"} from Goodreads` +
        `${result.skipped ? `; ${result.skipped} were already here or had no title` : ""}.${cut}` +
        `${result.added ? " Their covers are being found now." : ""}`);
      hooks.render();
      if (result.added) void hooks.findCovers(true);
    } catch (error) {
      setNotice(error instanceof Error && /Goodreads/.test(error.message) ? error.message : "That file could not be read.");
    }
  });
}

const GOODREADS_EXPORT_PAGE = "https://www.goodreads.com/review/import";

/** Copies the export page's address, to paste into Chrome (a tapped link can open the Goodreads app instead). */
export async function copyGoodreadsAddress(): Promise<void> {
  // The button sits in the sheet, over the screen's notice line, so it says the result itself.
  const button = document.querySelector<HTMLElement>('[data-action="copy-goodreads"]');
  try {
    await navigator.clipboard.writeText(GOODREADS_EXPORT_PAGE);
    if (button) button.textContent = "Copied. Paste it into Chrome";
    announce("Copied. Paste it into Chrome's address bar.");
  } catch {
    if (button) button.textContent = "Type goodreads.com/review/import in Chrome";
    announce("Copying did not work. In Chrome, type goodreads.com/review/import.");
  }
}

function withCurrent(change: (id: string, book: Book) => void): void {
  const id = currentBookId();
  const book = state.library.books.find((b) => b.id === id);
  if (id && book) change(id, book);
}

export function logPage(page: number, note: string): void {
  withCurrent((id) => {
    const library = logPages(state.library, id, page, note, today());
    const book = library.books.find((b) => b.id === id);
    const reached = book ? currentPage(book) : page;
    void setLibrary(library, { said: book?.shelf === "read" && book.finished === today() ? `Finished at page ${reached}.` : `Now on page ${reached}.` });
  });
}

export function addLessonNow(text: string): void {
  withCurrent((id) => void setLibrary(addLesson(state.library, id, text, today()), { said: "Lesson saved." }));
}

export function removeLesson(lessonId: string): void {
  withCurrent((id) => void setLibrary(deleteLesson(state.library, id, lessonId), { said: "Lesson deleted." }));
}

/** Saves a book's notes when they changed. Quiet saves happen while typing, so the field is not redrawn under the thumb. */
export function saveCommentary(text: string, quiet = false, id: string | null = currentBookId()): void {
  const book = state.library.books.find((b) => b.id === id);
  if (!id || !book) return;
  const next = setCommentary(state.library, id, text);
  if (next.books.find((b) => b.id === id)?.commentary === book.commentary) return;
  // Leaving the box is often a tap on something else: the redraw waits for that tap, so it is not swallowed.
  void setLibrary(next, quiet ? { quiet: true } : { soft: true, said: "Notes saved." });
}

export function moveShelf(value: string): void {
  if (!SHELVES.includes(value as Shelf)) return;
  withCurrent((id) => void setLibrary(setShelf(state.library, id, value as Shelf, today()), { said: `Moved to ${SHELF_LABEL[value as Shelf]}.` }));
}

/** A new cover photo for the book that was open when the camera started, even if the screen changed since. */
export function changeCover(): Promise<void> {
  const id = currentBookId();
  return busyWhile(async () => {
    if (!id) return;
    const photo = await coverPhoto("camera");
    if (!photo) return setNotice("No photo was taken.");
    const book = state.library.books.find((b) => b.id === id);
    if (!book) return void removeCoverPhoto(photo);
    if (await setLibrary(updateBook(state.library, id, { photo }), { said: "Cover photo saved." })) await releasePhoto(book.photo);
  });
}

export function setYearGoal(goal: number): void {
  const next = setGoal(state.library, goal);
  void setLibrary(next, { said: next.goal ? `Goal: ${next.goal} books this year.` : "Goal cleared." });
}

export function filterShelf(value: string): void {
  state.shelf = value === "all" || SHELVES.includes(value as Shelf) ? (value as Shelf | "all") : "all";
  state.showing = LIST_PAGE;
  hooks.render();
}

export function searchLibrary(query: string): void {
  state.search = Array.from(query.trim()).slice(0, 80).join("");
  state.showing = LIST_PAGE;
  hooks.render();
}

export function showMore(): void {
  state.showing += LIST_PAGE;
  hooks.render();
}

/** The first tap arms the button; the second removes the book, then its cover once the change is saved. */
export function removeBook(): void {
  withCurrent((id, book) => {
    if (state.removeArmed !== id) {
      state.removeArmed = id;
      hooks.render();
      return;
    }
    state.removeArmed = null;
    hooks.go("books");
    void (async () => {
      if (await setLibrary(deleteBook(state.library, id), { said: `Removed "${book.title}".` })) await releasePhoto(book.photo);
    })();
  });
}
