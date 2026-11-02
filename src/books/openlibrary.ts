/**
 * Open Library: a book by its ISBN (free, no key, cross-origin allowed), and the address of its cover. Covers are
 * downloaded once by the phone itself and kept with the book, so the page never loads images from elsewhere.
 */
import { cleanIsbn } from "./isbn.ts";
import { COVER_ID_MAX } from "./library.ts";

export interface Found {
  title: string;
  authors: string[];
  pages: number | null;
  coverId: number | null;
}

/** What a lookup learned: the book, that Open Library has no record of it, or that asking failed (and whether to back off). */
export type Lookup = { found: Found } | { none: true } | { failed: true; slowDown: boolean };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10000;

export function parseSearch(json: unknown): Found | null {
  const docs = (json as { docs?: unknown })?.docs;
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const d = docs[0] as Record<string, unknown>;
  if (typeof d.title !== "string" || !d.title.trim()) return null;
  const authors = Array.isArray(d.author_name)
    ? d.author_name.filter((a): a is string => typeof a === "string").slice(0, 5).map((a) => a.slice(0, 120)) : [];
  const pages = typeof d.number_of_pages_median === "number" && d.number_of_pages_median > 0 &&
    d.number_of_pages_median < 20000 ? Math.round(d.number_of_pages_median) : null;
  const coverId = isCoverId(d.cover_i) ? d.cover_i : null;
  return { title: d.title.trim().slice(0, 300), authors, pages, coverId };
}

const isCoverId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= COVER_ID_MAX;

/** The medium cover. `default=false` makes a missing cover a 404 rather than a blank placeholder image. */
export function coverUrl(coverId: number | null): string | null {
  return isCoverId(coverId) ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false` : null;
}

/** Asks Open Library for an ISBN. Only the ISBN leaves the phone. */
export async function findIsbn(isbn: string, fetcher: Fetcher = fetch): Promise<Lookup> {
  const clean = cleanIsbn(isbn);
  if (!clean) return { none: true };
  const url = `https://openlibrary.org/search.json?isbn=${clean}` +
    "&fields=title,author_name,number_of_pages_median,cover_i&limit=1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return { failed: true, slowDown: response.status === 429 || response.status === 503 };
    const found = parseSearch(await response.json());
    return found ? { found } : { none: true };
  } catch {
    return { failed: true, slowDown: false };
  } finally {
    clearTimeout(timer);
  }
}

/** A title compared loosely: case, accents and punctuation set aside ("Les Misérables" is "les miserables"). */
const plain = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * A title as Goodreads writes it, cut to the book's own name: "The Name of the Wind (The Kingkiller Chronicle, #1)"
 * and "Atomic Habits: An Easy & Proven Way..." are searched as "The Name of the Wind" and "Atomic Habits".
 */
export function mainTitle(title: string): string {
  return title.replace(/\s*\([^()]*\)\s*$/u, "").split(/:\s/u)[0].trim().slice(0, 200);
}

/** What follows the main title after ": ", without a closing series note: "Mistborn: The Hero of Ages" gives "the hero of ages". */
const subtitle = (title: string): string => {
  const cut = title.replace(/\s*\([^()]*\)\s*$/u, "").search(/:\s/u);
  return cut < 0 ? "" : plain(title.replace(/\s*\([^()]*\)\s*$/u, "").slice(cut + 1));
};

/**
 * The first answer that is this book: its main title the same as the one searched for, the subtitle too when both
 * have one (so one volume of a series never takes another's cover), and a cover on file.
 */
export function pickByTitle(json: unknown, title: string): Found | null {
  const docs = (json as { docs?: unknown })?.docs;
  if (!Array.isArray(docs)) return null;
  const wanted = plain(mainTitle(title));
  const wantedSub = subtitle(title);
  if (!wanted) return null;
  for (const doc of docs.slice(0, 5)) {
    const found = parseSearch({ docs: [doc] });
    if (!found || found.coverId === null || plain(mainTitle(found.title)) !== wanted) continue;
    const sub = subtitle(found.title);
    if (wantedSub && sub && sub !== wantedSub) continue;
    return found;
  }
  return null;
}

/**
 * Asks Open Library by title and first author, for a book with no ISBN (many Goodreads rows have none). Only the title
 * and the author's name leave the phone. A loose match is no match: a wrong cover is worse than none.
 */
export async function findTitle(title: string, author: string | undefined, fetcher: Fetcher = fetch): Promise<Lookup> {
  const name = mainTitle(title);
  if (!name) return { none: true };
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(name)}` +
    (author ? `&author=${encodeURIComponent(author.slice(0, 120))}` : "") +
    "&fields=title,author_name,number_of_pages_median,cover_i&limit=5";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return { failed: true, slowDown: response.status === 429 || response.status === 503 };
    const found = pickByTitle(await response.json(), title);
    return found ? { found } : { none: true };
  } catch {
    return { failed: true, slowDown: false };
  } finally {
    clearTimeout(timer);
  }
}

/** The book for an ISBN, or null when it is not a valid ISBN, Open Library has none, or the network fails. */
export async function lookupIsbn(isbn: string, fetcher: Fetcher = fetch): Promise<Found | null> {
  const result = await findIsbn(isbn, fetcher);
  return "found" in result ? result.found : null;
}
