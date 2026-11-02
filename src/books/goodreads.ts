/**
 * The Goodreads export (My Books, Import and export, Export Library): a CSV parsed on the phone. Goodreads issues no
 * API keys, so this file is the only way in. Re-importing adds only books not already in the library.
 */
import { cleanIsbn } from "./isbn.ts";
import { COMMENTARY_MAX, PAGES_MAX, addBooks, type Draft, type Library, type Shelf } from "./library.ts";

/** Real exports have about 25 columns and a row per book; a file far past these is not one. */
export const GOODREADS_MAX_ROWS = 10000;
const MAX_COLUMNS = 200;
/** Longer than any real review; a field past this means the file is not an export (or is broken). */
const MAX_FIELD = 200_000;
const NOT_AN_EXPORT = "This file is not a Goodreads export.";

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF. Blank lines are
 * skipped, and parsing stops after `maxRows` rows, so a huge file costs no more than the rows that are used.
 */
export function parseCsv(text: string, maxRows = Number.POSITIVE_INFINITY): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = (): void => {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
    field = "";
  };
  for (let i = 0; i < text.length && rows.length < maxRows; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else field += ch;
    if (field.length > MAX_FIELD || row.length > MAX_COLUMNS) throw new Error(NOT_AN_EXPORT);
  }
  if (rows.length < maxRows && (field !== "" || row.length > 0)) endRow();
  return rows;
}

const SHELF: ReadonlyMap<string, Shelf> = new Map([["read", "read"], ["currently-reading", "reading"], ["to-read", "want"]]);

export interface GoodreadsDraft extends Draft {
  shelf: Shelf;
}

/**
 * Reviews are stored as HTML: line breaks become new lines and any other tag is dropped. Cut to what a note can hold
 * first, and tags are bounded in length, so a review of a million "<" takes no longer than a short one.
 */
function reviewText(html: string): string {
  return html.slice(0, COMMENTARY_MAX * 4).replace(/<br\s{0,10}\/?>/gi, "\n").replace(/<[^<>]{0,500}>/g, "")
    .replace(/&(lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITY[name] ?? "").replace(/&amp;/g, "&");
}

/** The entities Goodreads writes into reviews; "&amp;" is undone last so "&amp;lt;" stays "&lt;". */
const ENTITY: Readonly<Record<string, string>> = { lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** The books in an export, the first GOODREADS_MAX_ROWS of them. Throws when the file is not a Goodreads export. */
export function goodreadsDrafts(rows: string[][]): GoodreadsDraft[] {
  if ((rows[0]?.length ?? 0) > MAX_COLUMNS) throw new Error(NOT_AN_EXPORT);
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const index = new Map(header.map((h, i) => [h, i] as const));
  if (!index.has("Title") || !index.has("Exclusive Shelf")) throw new Error(NOT_AN_EXPORT);
  const get = (row: string[], name: string): string => {
    const i = index.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  return rows.slice(1, 1 + GOODREADS_MAX_ROWS).flatMap((row) => {
    const title = get(row, "Title");
    if (!title) return [];
    const authors = [get(row, "Author"), ...get(row, "Additional Authors").split(",")].map((a) => a.trim()).filter(Boolean);
    const pages = Number(get(row, "Number of Pages"));
    const read = get(row, "Date Read").replaceAll("/", "-");
    const rating = Number(get(row, "My Rating"));
    return [{
      title, authors,
      isbn: cleanIsbn(get(row, "ISBN13")) ?? cleanIsbn(get(row, "ISBN")),
      pages: Number.isInteger(pages) && pages > 0 && pages <= PAGES_MAX ? pages : null,
      coverId: null, photo: null, source: "goodreads" as const,
      shelf: SHELF.get(get(row, "Exclusive Shelf")) ?? "want",
      finished: /^\d{4}-\d{2}-\d{2}$/.test(read) ? read : null,
      rating: rating >= 1 && rating <= 5 ? rating : null,
      commentary: reviewText(get(row, "My Review")),
    }];
  });
}

export function importDrafts(library: Library, drafts: Draft[], today: string): { library: Library; added: number; skipped: number } {
  return addBooks(library, drafts, today);
}
