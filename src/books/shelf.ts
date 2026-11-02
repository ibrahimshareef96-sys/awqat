/**
 * The "reading now" shelf: the books in hand, sent to the user's own server (PUT /app/library), where another screen
 * can show them. At most twelve, each with its progress and an Open Library cover address (a cover photographed on the
 * phone stays on the phone). Native HTTP (CapacitorHttp), so no Origin header goes,
 * which is how the Worker tells the app from a web page; the Talk session is the bearer, and a redirect is never
 * followed, so the session never travels on to another address.
 */
import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import { formatTime } from "../prayer/times.ts";
import { cleanShown } from "../talk/text.ts";
import { currentPage, inHand, type Book, type Library } from "./library.ts";
import { cleanIsbn } from "./isbn.ts";

/** The Worker's limits (src/tv.ts there): twelve books, titles to 160 characters, authors to 120. */
export const SHELF_MAX = 12;
const TITLE_MAX = 160;
const AUTHOR_MAX = 120;
const ERROR_MAX = 300;
export const SHELF_DEADLINE_MS = 20000;
const COVERS = "https://covers.openlibrary.org/b";

export interface ShelfBook {
  title: string;
  author: string;
  progress: number;
  cover: string | null;
}

export type ShelfState =
  | { state: "idle" }
  | { state: "sent"; count: number; at: Date }
  | { state: "signin" }
  | { state: "missing" }
  | { state: "moved" }
  | { state: "offline" }
  | { state: "refused"; error: string };

export type Sent = { ok: true } | { ok: false; why: "signin" | "missing" | "moved" | "offline" } |
  { ok: false; why: "refused"; error: string };

export type Put = (options: HttpOptions) => Promise<HttpResponse>;
const nativePut: Put = (options) => CapacitorHttp.put(options);

const range = (from: number, to: number): string => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const one = (code: number): string => String.fromCodePoint(code);
/**
 * What the Worker drops from a title before it measures it (its logic.ts INVISIBLE, and controls), so a title made only
 * of these is left out here rather than refused there with the whole shelf. Built from code points, as escapes typed
 * into this file can turn into the very characters they name.
 */
const HIDDEN = new RegExp(`[\\p{Cf}\\p{Cc}\\p{Cs}${one(0x034f)}${one(0x115f)}${one(0x1160)}${one(0x17b4)}` +
  `${one(0x17b5)}${range(0x180b, 0x180f)}${range(0x2060, 0x206f)}${one(0x2800)}${one(0x3164)}${range(0xfe00, 0xfe0f)}` +
  `${one(0xffa0)}${range(0xfff0, 0xfffb)}${range(0xe0000, 0xe0fff)}]`, "gu");

/** Clean, then cut to `max` UTF-16 units (how the Worker counts) without splitting a character. */
function fit(text: string, max: number): string {
  const clean = text.replace(HIDDEN, "").replace(/\s+/gu, " ").trim();
  let out = "";
  for (const ch of clean) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trim();
}

/** Open Library's cover by its id when the library has one (a cover known to be there), else by ISBN, else none. */
function coverOf(book: Book): string | null {
  if (book.coverId !== null && Number.isSafeInteger(book.coverId) && book.coverId > 0) {
    return `${COVERS}/id/${book.coverId}-M.jpg`;
  }
  const isbn = book.isbn ? cleanIsbn(book.isbn) : null;
  return isbn ? `${COVERS}/isbn/${isbn}-M.jpg` : null;
}

function percent(book: Book): number {
  if (!book.pages || book.pages <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((currentPage(book) / book.pages) * 100)));
}

/** The books in hand as the TV shows them, the most recently read first. */
export function shelfBooks(library: Library): ShelfBook[] {
  return inHand(library).map((book) => ({
    title: fit(book.title, TITLE_MAX), author: fit(book.authors.join(", "), AUTHOR_MAX), progress: percent(book),
    cover: coverOf(book),
  })).filter((book) => book.title !== "").slice(0, SHELF_MAX);
}

/** The answer, or null once the deadline passes (the native request is left to finish on its own). */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Sends the shelf in place of the last one; says why when the Worker did not take it. Never throws. */
export async function sendShelf(worker: string, session: string, books: readonly ShelfBook[], send: Put = nativePut,
  deadline = SHELF_DEADLINE_MS): Promise<Sent> {
  let response: HttpResponse | null;
  try {
    response = await withDeadline(send({
      // The native timeouts end inside the deadline, so a send given up on rarely lands after a newer one (name
      // lookups are not covered on Android, and iOS reads the timeout as an idle time); the next change sends again.
      url: `${worker}/app/library`, data: { reading: books }, responseType: "json", disableRedirects: true,
      connectTimeout: 8000, readTimeout: 8000,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${session}` },
    }), deadline);
  } catch {
    response = null;
  }
  if (response === null) return { ok: false, why: "offline" };
  const body = response.data !== null && typeof response.data === "object" ? response.data as Record<string, unknown> : null;
  if (response.status === 200 && body?.ok === true) return { ok: true };
  if (response.status === 401) return { ok: false, why: "signin" };
  // Not found: a Worker from before the TV's shelf. Sent elsewhere: the address in Settings is not the Worker itself.
  if (response.status === 404) return { ok: false, why: "missing" };
  if (response.status >= 300 && response.status < 400) return { ok: false, why: "moved" };
  const own = response.status >= 400 ? cleanShown(body?.error, ERROR_MAX) : "";
  return { ok: false, why: "refused", error: own || "The Worker did not take the shelf." };
}

/**
 * Books' line about the "reading now" shelf on the user's server, or "" when there is nothing to say. A server that
 * does not take the shelf (404) is not a fault: the shelf is optional, so that says nothing too.
 */
export function shelfMessage(shelf: ShelfState, timeZone?: string): string {
  switch (shelf.state) {
    case "sent": {
      const when = `sent ${formatTime(shelf.at, timeZone)}.`;
      return shelf.count === 0 ? `Your reading-now shelf has no book in hand, ${when}`
        : `On your reading-now shelf: ${shelf.count} book${shelf.count === 1 ? "" : "s"}, ${when}`;
    }
    case "signin": return "Sign in once with Talk (the orb) and the books in hand go to your reading-now shelf.";
    case "moved": return "Your Worker's address sent the shelf somewhere else. Check the Voice address in Settings.";
    case "offline": return "The reading-now shelf is sent when there is a connection.";
    case "refused": return `The reading-now shelf was refused: ${shelf.error}`;
    default: return "";
  }
}
