/** The Books screens: the library, one book, and the sheets for adding a book. */
import {
  SHELF_LABEL, SHELVES, currentPage, finishedIn, inHand, needsCover, searchBooks, shelfCounts, type Book, type Library,
  type Shelf,
} from "../books/library.ts";
import { photoSrc } from "../books/media.ts";
import { deviceWord, onIos } from "./deviceWord.ts";
import { esc } from "./html.ts";

export interface BooksModel {
  library: Library;
  date: string;
  shelf: Shelf | "all";
  busy: boolean;
  removeArmed: string | null;
  search: string;
  showing: number;
  covers: { done: number; total: number } | null;
  /** How the TV's shelf stands, in words (books/shelf.ts), or "". */
  tv?: string;
  /** How the sync with the user's other devices stands, in words (books/sync.ts), or "". */
  sync?: string;
}

/** Books shown in the In hand card before it points to the Reading shelf. */
const IN_HAND_MAX = 12;

/** A book's cover, kept on the phone, else its first letter on glass (also shown if the file cannot be read). */
export function cover(book: Book, size: "s" | "m" | "l"): string {
  const letter = Array.from(book.title.trim())[0]?.toUpperCase() ?? "?";
  const src = photoSrc(book.photo);
  if (src) {
    return `<img class="cover ${size}" src="${esc(src)}" alt="" loading="lazy" decoding="async" data-letter="${esc(letter)}">`;
  }
  return `<span class="cover ${size} blank" aria-hidden="true">${esc(letter)}</span>`;
}

function percent(book: Book): number {
  return book.pages ? Math.min(100, Math.round((currentPage(book) / book.pages) * 100)) : 0;
}

function pageLine(book: Book): string {
  const page = currentPage(book);
  return book.pages ? `p. ${page} of ${book.pages}` : page > 0 ? `p. ${page}` : "Not started";
}

export function bookRow(book: Book): string {
  const authors = book.authors.join(", ");
  return `<button type="button" class="book-row" data-go="book:${esc(book.id)}">${cover(book, "s")}<span class="col grow">` +
    `<span class="title">${esc(book.title)}</span>${authors ? `<span class="small">${esc(authors)}</span>` : ""}` +
    (book.shelf === "reading" ? `<span class="small">${esc(pageLine(book))}</span><span class="bar thin"><span class="fill" ` +
      `data-w="${percent(book)}"></span></span>` : "") + `</span></button>`;
}

function yearCard(m: BooksModel): string {
  const year = Number(m.date.slice(0, 4));
  const done = finishedIn(m.library, year);
  const goal = m.library.goal;
  return `<section class="card"><div class="split"><h2 class="label">${year}</h2>` +
    `<span class="small">${goal ? `${Math.max(0, goal - done)} to go` : "Set a goal"}</span></div>` +
    `<div class="big">${done} <span class="soft">${goal ? `of ${goal} books` : `book${done === 1 ? "" : "s"} read`}</span></div>` +
    (goal ? `<div class="bar"><div class="fill" data-w="${Math.min(100, Math.round((done / goal) * 100))}"></div></div>` : "") +
    `<form class="inline" data-form="goal"><label class="small" for="goal">Books this year</label><input id="goal" ` +
    `class="field small-field" name="goal" type="number" inputmode="numeric" min="0" max="1000" value="${goal || ""}">` +
    `<button type="submit" class="pill">Set</button></form></section>`;
}

function shelfChips(m: BooksModel): string {
  const counts = shelfCounts(m.library);
  const chip = (value: Shelf | "all", label: string, n: number) => `<button type="button" class="chip ${m.shelf === value ? "on" : ""}" ` +
    `data-action="shelf-filter" data-value="${value}" aria-pressed="${m.shelf === value}">${esc(label)} <span class="soft">${n}</span></button>`;
  return `<nav class="chips start" aria-label="Shelves">${chip("all", "All", m.library.books.length)}` +
    SHELVES.map((s) => chip(s, SHELF_LABEL[s], counts[s])).join("") + `</nav>`;
}

/** The books in hand, and under them how the TV's shelf (the same books) stands. */
function inHandCard(m: BooksModel): string {
  const reading = inHand(m.library);
  const tv = m.tv ? `<p class="small">${esc(m.tv)}</p>` : "";
  if (!reading.length) return tv ? `<section class="card">${tv}</section>` : "";
  const more = reading.length - IN_HAND_MAX;
  return `<section class="card"><h2 class="label">IN HAND</h2>${reading.slice(0, IN_HAND_MAX).map(bookRow).join("")}` +
    (more > 0 ? `<button type="button" class="link-button" data-action="shelf-filter" data-value="reading" data-from="in-hand">` +
      `${more} more on the Reading shelf</button>` : "") + `${tv}</section>`;
}

function coversCard(m: BooksModel): string {
  if (m.covers) {
    const pct = Math.round((m.covers.done / Math.max(1, m.covers.total)) * 100);
    return `<section class="card" aria-live="polite"><p class="small">Finding covers: ${m.covers.done} of ${m.covers.total}</p>` +
      `<div class="bar"><div class="fill" data-w="${pct}"></div></div></section>`;
  }
  const missing = needsCover(m.library).length;
  if (!missing) return "";
  return `<section class="card"><div class="split"><span>${missing} book${missing === 1 ? "" : "s"} without a cover</span>` +
    `<button type="button" class="pill" data-action="books-covers">Find covers</button></div><p class="small">Sends each ` +
    `book's ISBN, or its title and author when it has none, to Open Library and keeps the cover on this ` +
    `${deviceWord()}.</p></section>`;
}

/** How the library's sync with the user's other devices stands (books/sync.ts), in one line. */
function syncLine(m: BooksModel): string {
  return m.sync ? `<p class="small" aria-live="polite">${esc(m.sync)}</p>` : "";
}

function searchForm(m: BooksModel): string {
  return `<form class="inline search-row" data-form="book-search" role="search"><input id="book-search" class="field" ` +
    `type="search" name="q" maxlength="80" enterkeyhint="search" placeholder="Search titles and authors" ` +
    `aria-label="Search your library" value="${esc(m.search)}"><button type="submit" class="pill">Search</button>` +
    (m.search ? `<button type="button" class="pill" data-action="book-search-clear">Clear</button>` : "") + `</form>`;
}

/** Newest first, then by title; dates compare as text, which is quick for a long list. */
function newestFirst(a: Book, b: Book): number {
  return a.added === b.added ? a.title.localeCompare(b.title) : a.added < b.added ? 1 : -1;
}

export function booksView(m: BooksModel, header: string, notice: string, chrome: string): string {
  const onShelf = m.library.books.filter((b) => m.shelf === "all" || b.shelf === m.shelf);
  const shown = searchBooks(onShelf, m.search).sort(newestFirst);
  const list = shown.slice(0, m.showing).map(bookRow).join("");
  const empty = m.search ? `<p class="muted">No book matches "${esc(m.search)}".</p>` : `<p class="muted">No books here ` +
    `yet. Scan a barcode, photograph a cover, or import your Goodreads library.</p>`;
  const rest = shown.length - m.showing;
  return `<main class="screen single">${header}${notice}<button type="button" class="pill solid wide" data-go="add-book">` +
    `Add a book</button>${yearCard(m)}${inHandCard(m)}${coversCard(m)}${shelfChips(m)}${searchForm(m)}` +
    `<section class="card">${list || empty}${rest > 0 ? `<p class="small">Showing ${m.showing} of ${shown.length}.</p>` +
      `<button type="button" class="pill wide" data-action="books-more">Show more <span class="soft">${rest} left</span>` +
      `</button>` : ""}` +
    `</section>${syncLine(m)}<p class="foot">Book details and covers: Open Library</p></main>${chrome}`;
}

function bookHead(book: Book, m: BooksModel): string {
  const options = SHELVES.map((s) => `<option value="${s}"${book.shelf === s ? " selected" : ""}>${esc(SHELF_LABEL[s])}</option>`).join("");
  return `<section class="card book-head">${cover(book, "l")}<div class="col grow"><h2 class="book-title">${esc(book.title)}</h2>` +
    `${book.authors.length ? `<p class="small">${esc(book.authors.join(", "))}</p>` : ""}<label class="small" for="shelf">Shelf</label>` +
    `<select id="shelf" class="field" data-field="book-shelf">${options}</select><button type="button" class="link-button" ` +
    `data-action="book-photo"${m.busy ? " disabled" : ""}>${book.photo ? "Change the cover photo" : "Take a cover photo"}</button></div></section>`;
}

function progressCard(book: Book): string {
  const recent = book.progress.slice(-5).reverse().map((p) => `<li class="row-item"><span class="small">${esc(p.date)}</span>` +
    `<span>p. ${p.page}${p.note ? ` · ${esc(p.note)}` : ""}</span></li>`).join("");
  return `<section class="card"><div class="split"><h2 class="label">PROGRESS</h2><span class="small">${esc(pageLine(book))}</span></div>` +
    `<div class="bar"><div class="fill" data-w="${percent(book)}"></div></div><form class="stack" data-form="book-page">` +
    `<div class="inline"><label class="small" for="book-page">I'm on page</label><input id="book-page" class="field small-field" ` +
    `name="page" type="number" inputmode="numeric" min="0"${book.pages ? ` max="${book.pages}"` : ""} value="${currentPage(book) || ""}" required>` +
    `<button type="submit" class="pill solid">Save</button></div><input class="field" name="note" maxlength="300" ` +
    `placeholder="A line about this session (optional)" aria-label="A line about this session"></form>` +
    (recent ? `<ul class="plain">${recent}</ul>` : "") + `</section>`;
}

function lessonsCard(book: Book): string {
  const items = book.lessons.slice().reverse().map((l) => `<li class="row-item"><span class="grow">${esc(l.text)}</span>` +
    `<button type="button" class="round small-round" data-action="lesson-delete" data-value="${esc(l.id)}" ` +
    `aria-label="Delete this lesson">×</button></li>`).join("");
  return `<section class="card"><h2 class="label">LESSONS</h2>${items ? `<ul class="plain">${items}</ul>` : ""}` +
    `<form class="inline" data-form="book-lesson"><input class="field grow" name="text" maxlength="500" ` +
    `placeholder="One thing you learned" aria-label="A lesson from this book" required><button type="submit" class="pill solid">` +
    `Add</button></form></section>`;
}

function commentaryCard(book: Book): string {
  return `<section class="card"><label class="label" for="commentary">YOUR NOTES</label><textarea id="commentary" ` +
    `class="field area" data-field="commentary" maxlength="4000" rows="5" placeholder="What you think of it, for you only">` +
    `${esc(book.commentary)}</textarea></section>`;
}

export function bookView(book: Book, m: BooksModel, header: string, notice: string, chrome: string): string {
  const armed = m.removeArmed === book.id;
  return `<main class="screen">${header}${notice}${bookHead(book, m)}${progressCard(book)}${lessonsCard(book)}` +
    `${commentaryCard(book)}<button type="button" class="pill ${armed ? "danger" : ""}" data-action="book-remove">` +
    `${armed ? "Tap again to remove this book" : "Remove this book"}</button></main>${chrome}`;
}

export function addBookSheet(busy: boolean): string {
  const d = busy ? " disabled" : "";
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Add a book"><div class="sheet-inner">` +
    `<h2 class="sheet-title">Add a book</h2><div class="stack wide">` +
    `<button type="button" class="pill solid wide" data-action="book-scan"${d}>Scan the barcode</button>` +
    `<button type="button" class="pill wide" data-action="book-camera"${d}>Photograph the cover</button>` +
    `<button type="button" class="pill wide" data-action="book-gallery"${d}>Choose a photo</button>` +
    `<button type="button" class="pill wide" data-action="book-type"${d}>Type it in</button>` +
    `<label class="pill wide file-pill">Import your Goodreads export (.csv)<input type="file" ` +
    `accept=".csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain" ` +
    `data-file="goodreads" class="sr-only"${d}></label>${goodreadsHelp()}</div><button type="button" class="link-button" ` +
    `data-go="close">Close</button></div></section>`;
}

/**
 * The Goodreads app cannot export; the website can, in its desktop form. Checked against Goodreads' help, 23 Oct 2026.
 * Android: Chrome with Desktop site on. iOS: Safari (an iPad already shows the desktop site), the file saved to Files.
 */
function goodreadsHelp(): string {
  const browser = onIos()
    ? `<li>Copy the address below and paste it into Safari (a tapped link may open the Goodreads app instead). Sign ` +
      `in.</li><li>On an iPhone, open the page menu and choose <b>Request Desktop Website</b>; an iPad shows it ` +
      `already.</li>`
    : `<li>Copy the address below and paste it into Chrome (a tapped link may open the Goodreads app instead). Sign ` +
      `in.</li><li>Tap ⋮ and turn on <b>Desktop site</b>.</li>`;
  const lands = onIos() ? "is saved to Downloads in the Files app" : "lands in Downloads";
  return `<details class="more wide" id="goodreads-help"><summary class="link-button">How to get the file on your ` +
    `${deviceWord()}</summary><ol class="steps">${browser}<li>Under Export, tap <b>Export Library</b> and wait; a large ` +
    `library takes a few minutes.</li><li>Tap <b>Your export from…</b>. The file goodreads_library_export.csv ${lands}.` +
    `</li><li>Come back here and tap Import above.</li></ol>` +
    `<button type="button" class="ghost-link" data-action="copy-goodreads">Copy goodreads.com/review/import</button></details>`;
}

export interface NewBookDraft { title: string; author: string; pages: string; isbn: string; photo: string | null }

export function newBookSheet(draft: NewBookDraft, busy: boolean): string {
  const preview = photoSrc(draft.photo);
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="New book"><div class="sheet-inner">` +
    `<h2 class="sheet-title">New book</h2>${preview ? `<img class="cover m" src="${esc(preview)}" alt="Your cover photo">` : ""}` +
    `<form class="stack wide" data-form="book-new"><label class="small" for="nb-title">Title</label><input id="nb-title" ` +
    `class="field" name="title" maxlength="300" required value="${esc(draft.title)}"><label class="small" for="nb-author">` +
    `Author</label><input id="nb-author" class="field" name="author" maxlength="120" value="${esc(draft.author)}">` +
    `<div class="inline"><label class="small" for="nb-pages">Pages</label><input id="nb-pages" class="field small-field" ` +
    `name="pages" type="number" inputmode="numeric" min="1" max="20000" value="${esc(draft.pages)}"><label class="small" ` +
    `for="nb-isbn">ISBN</label><input id="nb-isbn" class="field" name="isbn" inputmode="numeric" maxlength="20" ` +
    `value="${esc(draft.isbn)}"></div><label class="small" for="nb-shelf">Shelf</label><select id="nb-shelf" class="field" ` +
    `name="shelf">${SHELVES.map((s) => `<option value="${s}"${s === "want" ? " selected" : ""}>${esc(SHELF_LABEL[s])}</option>`).join("")}` +
    `</select><button type="submit" class="pill solid wide"${busy ? " disabled" : ""}>Add to my library</button></form>` +
    `<button type="button" class="link-button" data-go="close">Cancel</button></div></section>`;
}
