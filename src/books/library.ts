/**
 * The library kept on the device: every book with its cover, shelf, progress, commentary and lessons. Every change
 * returns a new library; nothing is changed in place.
 */
import { cleanIsbn, toIsbn13 } from "./isbn.ts";

export type Shelf = "reading" | "want" | "owned" | "read" | "paused";
export const SHELVES: readonly Shelf[] = ["reading", "want", "owned", "read", "paused"];
export const SHELF_LABEL: Readonly<Record<Shelf, string>> = {
  reading: "Reading", want: "Want to read", owned: "On my shelves", read: "Read", paused: "Paused",
};

export interface ProgressEntry { id: string; date: string; page: number; note: string }
export interface Lesson { id: string; date: string; text: string }

export interface Book {
  id: string;
  title: string;
  authors: string[];
  isbn: string | null;
  pages: number | null;
  /** Open Library cover id, when the cover comes from there. */
  coverId: number | null;
  /** The cover on the phone (the user's photo, or Open Library's saved there): its file name in the app's data folder. */
  photo: string | null;
  /** The day Open Library was asked for a cover and had none, so it is not asked again. */
  coverChecked: string | null;
  shelf: Shelf;
  added: string;
  started: string | null;
  finished: string | null;
  rating: number | null;
  commentary: string;
  progress: ProgressEntry[];
  lessons: Lesson[];
  source: "scan" | "photo" | "typed" | "goodreads";
  /** When this book last changed on any device, in ms since the epoch, for syncing (books/sync.ts); 0 before sync. */
  updated: number;
}

export interface Library { v: 1; books: Book[]; goal: number }

export interface Draft {
  title: string;
  authors: string[];
  isbn: string | null;
  pages: number | null;
  coverId: number | null;
  photo: string | null;
  source: Book["source"];
  shelf?: Shelf;
  finished?: string | null;
  rating?: number | null;
  commentary?: string;
}

export const COMMENTARY_MAX = 4000;
export const LESSON_MAX = 500;
export const NOTE_MAX = 300;
export const GOAL_MAX = 1000;
export const PAGES_MAX = 20000;
/** A library past this many books stops taking more: far beyond a lifetime of reading, short of freezing the phone. */
export const BOOKS_MAX = 20000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_NAME = /^covers\/[A-Za-z0-9-]{1,64}\.jpg$/;
/**
 * Characters that hide or spoof what a title says: control characters, the ones that reverse or isolate text
 * direction, zero-width spaces, word joiners, byte-order marks and tag characters. The joiners emoji and Persian need
 * (U+200C, U+200D) stay. Built from code points so no invisible character sits in this file.
 */
const INVISIBLE = [0x200b, 0x2060, 0xfeff].map((c) => String.fromCodePoint(c)).join("") +
  `${String.fromCodePoint(0xe0000)}-${String.fromCodePoint(0xe007f)}`;
const HIDDEN = new RegExp(`(?![\\n\\t])[\\p{Cc}\\p{Bidi_Control}${INVISIBLE}]`, "gu");
/** Open Library cover ids are in the tens of millions; anything past this is not one. */
export const COVER_ID_MAX = 9_999_999_999;

export const isPhotoName = (name: unknown): name is string => typeof name === "string" && PHOTO_NAME.test(name);

export function emptyLibrary(): Library {
  return { v: 1, books: [], goal: 0 };
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Text that may run over lines (notes, lessons, commentary): hidden characters out, runs of spaces made one. */
const clip = (text: string, max: number): string =>
  Array.from(text.replace(HIDDEN, "").replace(/[ \t]+/g, " ").trim()).slice(0, max).join("");
/** Text on one line (titles, authors). */
const line = (text: string, max: number): string => clip(text.replace(/\s+/g, " "), max);
const normal = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const goodPages = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= PAGES_MAX;
const goodCoverId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= COVER_ID_MAX;

/** The same book: the same ISBN when both have one, else the same title and first author. */
export const titleKey = (b: Pick<Book, "title" | "authors">): string => `${normal(b.title)}|${normal(b.authors[0] ?? "")}`;

export function sameBook(a: Pick<Book, "isbn" | "title" | "authors">, b: Pick<Book, "isbn" | "title" | "authors">): boolean {
  if (a.isbn && b.isbn) return toIsbn13(a.isbn) === toIsbn13(b.isbn);
  return titleKey(a) === titleKey(b);
}

/** A new book from a draft. A book marked read by hand is read today; an import without a date stays undated. */
function makeBook(draft: Draft, today: string): Book {
  const title = line(draft.title, 300);
  if (!title) throw new RangeError("A book needs a title.");
  const shelf = draft.shelf ?? "want";
  const dated = draft.finished && DAY_KEY.test(draft.finished) ? draft.finished : null;
  return {
    id: newId(), title,
    authors: draft.authors.map((a) => line(a, 120)).filter(Boolean).slice(0, 5),
    isbn: draft.isbn ? cleanIsbn(draft.isbn) : null,
    pages: goodPages(draft.pages) ? draft.pages : null,
    coverId: goodCoverId(draft.coverId) ? draft.coverId : null,
    photo: isPhotoName(draft.photo) ? draft.photo : null,
    coverChecked: null,
    shelf, added: today, started: shelf === "reading" ? today : null,
    finished: shelf === "read" ? dated ?? (draft.source === "goodreads" ? null : today) : null,
    rating: draft.rating && draft.rating >= 1 && draft.rating <= 5 ? Math.round(draft.rating) : null,
    commentary: clip(draft.commentary ?? "", COMMENTARY_MAX), progress: [], lessons: [], source: draft.source,
    updated: 0,
  };
}

/** Adds a book, or finds it already there (same ISBN, or the same title and first author). */
export function addBook(library: Library, draft: Draft, today: string): { library: Library; book: Book; duplicate: boolean } {
  const book = makeBook(draft, today);
  const existing = library.books.find((b) => sameBook(b, book));
  if (existing) return { library, book: existing, duplicate: true };
  if (library.books.length >= BOOKS_MAX) throw new RangeError("The library is full.");
  return { library: { ...library, books: [...library.books, book] }, book, duplicate: false };
}

/** The keys of books already seen, so a large import checks each draft once instead of against every book. */
interface Seen { isbns: Set<string>; titlesWithoutIsbn: Set<string>; titles: Set<string> }

function remember(seen: Seen, book: Book): void {
  const key = titleKey(book);
  seen.titles.add(key);
  if (book.isbn) seen.isbns.add(toIsbn13(book.isbn));
  else seen.titlesWithoutIsbn.add(key);
}

function seenBefore(seen: Seen, book: Book): boolean {
  const key = titleKey(book);
  return book.isbn ? seen.isbns.has(toIsbn13(book.isbn)) || seen.titlesWithoutIsbn.has(key) : seen.titles.has(key);
}

/** Adds many books in one pass, the same way addBook decides what is a duplicate. Drafts without a title are skipped. */
export function addBooks(library: Library, drafts: readonly Draft[], today: string): { library: Library; added: number; skipped: number } {
  const seen: Seen = { isbns: new Set(), titlesWithoutIsbn: new Set(), titles: new Set() };
  library.books.forEach((b) => remember(seen, b));
  const fresh: Book[] = [];
  for (const draft of drafts) {
    if (library.books.length + fresh.length >= BOOKS_MAX) break;
    if (!line(draft.title, 300)) continue;
    const book = makeBook(draft, today);
    if (seenBefore(seen, book)) continue;
    remember(seen, book);
    fresh.push(book);
  }
  const books = fresh.length ? [...library.books, ...fresh] : library.books;
  return { library: fresh.length ? { ...library, books } : library, added: fresh.length, skipped: drafts.length - fresh.length };
}

function withBook(library: Library, id: string, change: (book: Book) => Book): Library {
  return { ...library, books: library.books.map((b) => (b.id === id ? change(b) : b)) };
}

export function updateBook(library: Library, id: string, patch: Partial<Pick<Book, "title" | "authors" | "pages" | "photo" | "coverId">>): Library {
  return withBook(library, id, (b) => ({
    ...b,
    ...(patch.title !== undefined && line(patch.title, 300) ? { title: line(patch.title, 300) } : {}),
    ...(patch.authors ? { authors: patch.authors.map((a) => line(a, 120)).filter(Boolean).slice(0, 5) } : {}),
    ...(patch.pages !== undefined ? { pages: goodPages(patch.pages) ? patch.pages : null } : {}),
    ...(patch.photo !== undefined ? { photo: isPhotoName(patch.photo) ? patch.photo : null } : {}),
    ...(patch.coverId !== undefined ? { coverId: goodCoverId(patch.coverId) ? patch.coverId : null } : {}),
  }));
}

export function markCoverChecked(library: Library, id: string, today: string): Library {
  return withBook(library, id, (b) => ({ ...b, coverChecked: today }));
}

/** Whether any book still shows this cover file, so it is only deleted when the last one lets go of it. */
export function photoInUse(library: Library, name: string | null): boolean {
  return name !== null && library.books.some((b) => b.photo === name);
}

/**
 * Books whose cover can still come from Open Library: a known cover not yet saved on this phone, or a book not yet
 * asked about (by its ISBN, or by its title and author when it has none, as many Goodreads rows do).
 */
export function needsCover(library: Library): Book[] {
  return library.books.filter((b) => !b.photo && (b.coverId !== null || b.coverChecked === null));
}

export function setShelf(library: Library, id: string, shelf: Shelf, today: string): Library {
  return withBook(library, id, (b) => ({
    ...b, shelf,
    started: shelf === "reading" ? b.started ?? today : b.started,
    finished: shelf === "read" ? b.finished ?? today : shelf === "reading" ? null : b.finished,
  }));
}

export function currentPage(book: Book): number {
  const last = book.progress[book.progress.length - 1];
  if (last) return last.page;
  return book.shelf === "read" && book.pages ? book.pages : 0;
}

/** Records reaching `page` today; starts the book, and finishes it at its last page. */
export function logPages(library: Library, id: string, page: number, note: string, today: string): Library {
  if (!Number.isFinite(page) || page < 0) return library;
  return withBook(library, id, (b) => {
    const reached = Math.min(Math.round(page), b.pages ?? PAGES_MAX);
    const done = b.pages !== null && reached >= b.pages;
    return {
      ...b,
      progress: [...b.progress, { id: newId(), date: today, page: reached, note: line(note, NOTE_MAX) }],
      shelf: done ? "read" : b.shelf === "read" ? b.shelf : "reading",
      started: b.started ?? today,
      finished: done ? today : b.finished,
    };
  });
}

export function addLesson(library: Library, id: string, text: string, today: string): Library {
  const clean = clip(text, LESSON_MAX);
  if (!clean) return library;
  return withBook(library, id, (b) => ({ ...b, lessons: [...b.lessons, { id: newId(), date: today, text: clean }] }));
}

export function deleteLesson(library: Library, id: string, lessonId: string): Library {
  return withBook(library, id, (b) => ({ ...b, lessons: b.lessons.filter((l) => l.id !== lessonId) }));
}

export function setCommentary(library: Library, id: string, text: string): Library {
  return withBook(library, id, (b) => ({ ...b, commentary: clip(text, COMMENTARY_MAX) }));
}

export function deleteBook(library: Library, id: string): Library {
  return { ...library, books: library.books.filter((b) => b.id !== id) };
}

export function setGoal(library: Library, goal: number): Library {
  return { ...library, goal: Number.isFinite(goal) ? Math.min(GOAL_MAX, Math.max(0, Math.round(goal))) : 0 };
}

export function finishedIn(library: Library, year: number): number {
  return library.books.filter((b) => b.shelf === "read" && b.finished?.startsWith(`${year}-`)).length;
}

export function shelfCounts(library: Library): Record<Shelf, number> {
  const counts: Record<Shelf, number> = { reading: 0, want: 0, owned: 0, read: 0, paused: 0 };
  for (const b of library.books) counts[b.shelf] += 1;
  return counts;
}

/** Books being read, the most recently read first. */
export function inHand(library: Library): Book[] {
  const lastTouch = (b: Book) => b.progress[b.progress.length - 1]?.date ?? b.started ?? b.added;
  return library.books.filter((b) => b.shelf === "reading").sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)));
}

/** Books whose title or an author holds every word searched for, ignoring case and punctuation. */
export function searchBooks(books: readonly Book[], query: string): Book[] {
  const words = normal(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...books];
  return books.filter((b) => {
    const text = ` ${normal(`${b.title} ${b.authors.join(" ")}`)} `;
    return words.every((w) => text.includes(` ${w}`));
  });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const day = (v: unknown): string | null => (typeof v === "string" && DAY_KEY.test(v) ? v : null);

/** A book as saved or as another device sent it, every field checked and cut to its limit; null when it is not one. */
export function readBook(value: unknown): Book | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const title = line(str(v.title, 600), 300);
  if (typeof v.id !== "string" || v.id.length > 64 || !title) return null;
  const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  return {
    id: v.id, title,
    authors: list(v.authors).filter((a): a is string => typeof a === "string").map((a) => line(a, 120)).filter(Boolean).slice(0, 5),
    isbn: typeof v.isbn === "string" ? cleanIsbn(v.isbn) : null,
    pages: goodPages(v.pages) ? v.pages : null,
    coverId: goodCoverId(v.coverId) ? v.coverId : null,
    photo: isPhotoName(v.photo) ? v.photo : null,
    coverChecked: day(v.coverChecked),
    shelf: SHELVES.includes(v.shelf as Shelf) ? (v.shelf as Shelf) : "want",
    added: day(v.added) ?? "2000-01-01", started: day(v.started), finished: day(v.finished),
    rating: typeof v.rating === "number" && v.rating >= 1 && v.rating <= 5 ? Math.round(v.rating) : null,
    commentary: clip(str(v.commentary, COMMENTARY_MAX * 2), COMMENTARY_MAX),
    progress: list(v.progress).flatMap((p) => {
      const e = p as Record<string, unknown>;
      return typeof e?.id === "string" && day(e.date) && typeof e.page === "number" && Number.isFinite(e.page) && e.page >= 0
        ? [{ id: e.id.slice(0, 64), date: e.date as string, page: Math.min(PAGES_MAX, Math.round(e.page)),
          note: line(str(e.note, NOTE_MAX * 2), NOTE_MAX) }] : [];
    }),
    lessons: list(v.lessons).flatMap((l) => {
      const e = l as Record<string, unknown>;
      const text = clip(str(e?.text, LESSON_MAX * 2), LESSON_MAX);
      return typeof e?.id === "string" && day(e.date) && text ? [{ id: e.id.slice(0, 64), date: e.date as string, text }] : [];
    }),
    source: v.source === "scan" || v.source === "photo" || v.source === "goodreads" ? v.source : "typed",
    updated: typeof v.updated === "number" && Number.isSafeInteger(v.updated) && v.updated > 0 ? v.updated : 0,
  };
}

export function checkLibrary(json: string | null): { library: Library; damaged: boolean } {
  if (json === null) return { library: emptyLibrary(), damaged: false };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || raw.v !== 1) return { library: emptyLibrary(), damaged: true };
    const books = (Array.isArray(raw.books) ? raw.books : []).slice(0, BOOKS_MAX).map(readBook).filter((b): b is Book => b !== null);
    return { library: setGoal({ v: 1, books, goal: 0 }, typeof raw.goal === "number" ? raw.goal : 0), damaged: false };
  } catch {
    return { library: emptyLibrary(), damaged: true };
  }
}
