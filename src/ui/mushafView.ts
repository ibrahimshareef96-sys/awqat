/**
 * The mushaf reader: a page of the Madinah mushaf as printed, with the pages either side ready for a swipe (right to
 * left, as a mushaf turns). Words are buttons: holding one (or Enter on it) opens its ayah to mark a revision mistake or
 * write a note; a tap on the page shows or hides the bars.
 * Fonts are set from data-font by script (the page's policy allows no inline styles).
 */
import type { FridayItem } from "../faith/friday.ts";
import { JUZ_START_PAGE, PAGES, PAGE_START, SURA_NAMES, SURA_NAMES_AR } from "../quran/data.ts";
import { juzOfPage } from "../quran/log.ts";
import { surahPages } from "../quran/pages.ts";
import { ayahOfWord, type MushafLine, type MushafPage, type MushafWord } from "../quran/mushafPage.ts";
import type { MushafMarks } from "../quran/marks.ts";
import { deviceWord } from "./deviceWord.ts";
import { esc, icon } from "./html.ts";

export type ReaderPage =
  | { page: number; status: "ready"; data: MushafPage; font: string }
  | { page: number; status: "loading" | "offline" | "failed"; data: null; font: null };

export interface ReaderModel {
  /** The pages turn like a book's (pageTurn.ts) rather than slide. */
  book?: boolean;
  current: number;
  pages: ReaderPage[];
  /** The two pages open together on a big screen on its side (right, then left); null with one page open. */
  spread: number[] | null;
  /** The font and glyphs that draw the bismillah (Al-Fatiha's first ayah, page 1). */
  bismillah: { font: string | null; glyphs: string };
  marks: MushafMarks;
  /** Your place in the reading (last page read). */
  position: number;
  revisedToday: boolean;
  /** The Friday open now, with Al-Kahf still to tick. */
  kahfOpen: boolean;
  /** Where Back and Close return to: the screen the mushaf was opened from. */
  from: string;
  notice: string;
  /** The user jumped here in the go-to sheet: the page to go back to. */
  jumpFrom: number | null;
  /** A reading from a mode: it keeps its own place, so the logging buttons are not offered. */
  guest: {
    label: string;
    first: number;
    last: number;
    /** The Friday item to tick at its end, while its Friday is open. */
    tick: { item: FridayItem; done: boolean } | null;
    /** Where the user's own reading stays meanwhile. */
    bookmark: number;
  } | null;
}

const KAHF = surahPages(18);
const arabicDigits = (n: number): string => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
/** The surah a page opens in, from the page map (so the heading is right before the page's words arrive). */
const pageSurah = (page: number): number => PAGE_START[page - 1]?.[0] ?? 1;
/** A word's text is its ayah's number when the word is the end-of-ayah sign. */
const isAyahNumber = (text: string): boolean => /^[٠-٩۰-۹\s]*$/.test(text);

function lineHtml(line: MushafLine, m: ReaderModel): string {
  if (line.kind === "surah") {
    return `<div class="line surah" data-line="${line.n}"><span class="surah-frame"><span class="surah-ar" lang="ar">` +
      `سورة ${esc(SURA_NAMES_AR[line.sura - 1])}</span></span></div>`;
  }
  if (line.kind === "bismillah") {
    const { font, glyphs } = m.bismillah;
    // Drawn only in the mushaf's own script; until page 1 is here its line keeps its place, empty.
    return font && glyphs ? `<div class="line bism" data-line="${line.n}" data-font="${esc(font)}" role="img" ` +
      `aria-label="Bismillah ir-Rahman ir-Rahim">${esc(glyphs)}</div>`
      : `<div class="line bism" data-line="${line.n}" aria-hidden="true"></div>`;
  }
  return `<div class="line" data-line="${line.n}">${line.words.map((w) => {
    const miss = Object.hasOwn(m.marks.mistakes, w.key);
    const noted = Object.hasOwn(m.marks.notes, ayahOfWord(w.key));
    return `<button type="button" class="w${miss ? " miss" : ""}${noted ? " noted" : ""}" data-word="${esc(w.key)}" ` +
      `aria-label="${esc(w.text || w.key)}">${esc(w.glyph)}</button>`;
  }).join("")}</div>`;
}

const TRY_AGAIN = `<button type="button" class="ghost-link" data-action="mushaf-retry">Try again</button>`;

function pageBody(p: ReaderPage, m: ReaderModel): string {
  if (p.status === "ready") {
    return `<div class="page-lines${p.page <= 2 ? " opening" : ""}" data-font="${esc(p.font)}" lang="ar">` +
      p.data.lines.map((line) => lineHtml(line, m)).join("") + `</div>`;
  }
  if (p.status === "offline") {
    return `<p class="page-wait">This page opens once with the internet, then stays on the ${deviceWord()}. Connect, then ` +
      `${TRY_AGAIN}</p>`;
  }
  if (p.status === "failed") return `<p class="page-wait">This page did not load. ${TRY_AGAIN}</p>`;
  return `<p class="page-wait" aria-busy="true">Opening page ${p.page}…</p>`;
}

/** The pages in view: the open page, or both pages of the open spread. */
const inView = (m: ReaderModel): number[] => m.spread ?? [m.current];

/**
 * The open page takes focus after a turn; the pages either side are out of reach until they are turned to. With two
 * pages open, both are in reach, and the right-hand one is where a spread's turn comes to rest.
 */
function pageHtml(p: ReaderPage, m: ReaderModel): string {
  const open = inView(m).includes(p.page);
  const focus = p.page === m.current ? ` tabindex="-1"` : "";
  const start = m.spread && p.page % 2 === 1 ? " spread-start" : "";
  return `<section class="page${start}" data-page="${p.page}" aria-label="Page ${p.page}"${open ? focus : " inert"}>` +
    `${pageBody(p, m)}<p class="page-no" aria-hidden="true">${arabicDigits(p.page)}</p></section>`;
}

/** A note for each page in view: one round button, or with two pages open, one for each, with its page number. */
function noteButtons(m: ReaderModel): string {
  if (!m.spread) {
    return `<button type="button" class="round" data-action="mushaf-page-note" aria-label="A note on page ${m.current}">` +
      `${icon("note", 18)}</button>`;
  }
  return m.spread.map((p) => `<button type="button" class="pill note-pill" data-action="mushaf-page-note" ` +
    `data-value="${p}" aria-label="A note on page ${p}">${icon("note", 16)}<span>${p}</span></button>`).join("");
}

/** A mode's reading: how far along, that the user's own place has not moved, and the tick on its last page. */
function guestFooter(g: NonNullable<ReaderModel["guest"]>, m: ReaderModel): string {
  const shown = inView(m);
  const at = Math.min(g.last, Math.max(...shown));
  const total = g.last - g.first + 1;
  const end = shown.includes(g.last);
  const tick = g.tick && end ? `<button type="button" class="pill${g.tick.done ? " solid" : ""}" data-action="friday" ` +
    `data-value="${g.tick.item}" aria-pressed="${g.tick.done}">${esc(g.label)} read today</button>` : "";
  const along = total > 1 ? `${at - g.first + 1} of ${total} pages · ` : "";
  return `<footer class="reader-bottom">${pageNoteLines(m)}` +
    (m.notice ? `<p class="reader-notice" role="status">${esc(m.notice)}</p>` : "") +
    `<p class="small guest-line">${along}your reading stays on p. ${g.bookmark}</p>` +
    `<div class="reader-actions">${tick}${noteButtons(m)}</div></footer>`;
}

function footer(m: ReaderModel): string {
  if (m.guest) return guestFooter(m.guest, m);
  const shown = inView(m);
  const last = Math.max(...shown);
  // With two pages open, the spread's juz is its left-hand page's, however it was opened: a juz begins on a left-hand
  // page in this print (27 of 30), which is where the muraja'ah plan opens it.
  const juz = juzOfPage(last);
  const ahead = last > m.position;
  const kahfEnd = m.kahfOpen && KAHF !== null && shown.includes(KAHF.last);
  return `<footer class="reader-bottom">${pageNoteLines(m)}` +
    (m.notice ? `<p class="reader-notice" role="status">${esc(m.notice)}</p>` : "") + `<div class="reader-actions">` +
    `<button type="button" class="pill${ahead ? " solid" : ""}" data-action="mushaf-read"${ahead ? "" : " disabled"}>` +
    `${ahead ? `Read to p. ${last}` : "Read"}</button>` +
    `<button type="button" class="pill${m.revisedToday ? " solid" : ""}" data-action="mushaf-revise" aria-pressed="${m.revisedToday}">` +
    `Juz ${juz} revised</button>${noteButtons(m)}` +
    `${m.jumpFrom !== null ? `<button type="button" class="pill" data-action="mushaf-jump-back">Back to p. ${m.jumpFrom}</button>` : ""}` +
    `</div>${kahfEnd ? `<button type="button" class="ghost-link" data-action="friday" data-value="kahf">Al-Kahf read today</button>` : ""}` +
    `</footer>`;
}

/** The page notes in view, under the pages; with two pages open, each says which page it is on. */
function pageNoteLines(m: ReaderModel): string {
  return inView(m).map((p) => {
    const note = m.marks.pageNotes[String(p)];
    return note ? `<p class="page-note-line">${esc(m.spread ? `p. ${p}: ${note.text}` : note.text)}</p>` : "";
  }).join("");
}

const SHEET_ERROR = `<p class="sheet-error" data-sheet-error role="alert" hidden></p>`;

/** A held word: its ayah as text (the words given, in order), a mistake to mark or clear, and the ayah's note. */
export function wordSheet(word: string, words: readonly MushafWord[], marks: MushafMarks): string {
  const ayah = ayahOfWord(word);
  const [sura, aya] = ayah.split(":").map(Number);
  const text = words.filter((w) => !isAyahNumber(w.text)).map((w) =>
    w.key === word ? `<mark>${esc(w.text)}</mark>` : esc(w.text)).join(" ");
  const count = Object.hasOwn(marks.mistakes, word) ? marks.mistakes[word].count : 0;
  const note = Object.hasOwn(marks.notes, ayah) ? marks.notes[ayah].text : "";
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Ayah ${esc(ayah)}"><div class="sheet-inner">` +
    `<p class="eyebrow">${esc(SURA_NAMES[sura - 1] ?? "")} · ayah ${aya}</p>` +
    (text ? `<p class="ayah-text" lang="ar" dir="rtl">${text}</p>` : "") +
    `<div class="row-buttons center-row"><button type="button" class="pill solid" data-action="mushaf-mistake" data-autofocus>` +
    `Mark a mistake${count ? ` (${count})` : ""}</button>` +
    (count ? `<button type="button" class="pill" data-action="mushaf-clear">Clear</button>` : "") + `</div>` +
    `<form class="stack wide" data-form="ayah-note"><label class="label" for="ayah-note">NOTE ON THIS AYAH</label>` +
    `<textarea id="ayah-note" class="field area" name="text" maxlength="1000" rows="3" placeholder="A mutashabih, a meaning, ` +
    `where you slip">${esc(note)}</textarea><button type="submit" class="pill solid wide">Save the note</button></form>` +
    `${SHEET_ERROR}<button type="button" class="link-button" data-go="close">Close</button></div></section>`;
}

/** Go to a page, a juz or a surah. */
export function gotoSheet(current: number): string {
  const juz = JUZ_START_PAGE.map((page, i) => `<button type="button" class="juz" data-go="mushaf:${page}" ` +
    `aria-label="Juz ${i + 1}, page ${page}">${i + 1}</button>`).join("");
  const suras = SURA_NAMES.map((name, i) => {
    const pages = surahPages(i + 1);
    return pages ? `<li><button type="button" class="row-item note-row" data-go="mushaf:${pages.first}"><span>${i + 1}. ` +
      `${esc(name)}</span><span class="col end"><span lang="ar" class="sura-ar-small">${esc(SURA_NAMES_AR[i])}</span>` +
      `<span class="small">p. ${pages.first}</span></span></button></li>` : "";
  }).join("");
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Go to"><div class="sheet-inner">` +
    `<form class="inline wide" data-form="mushaf-goto"><label class="label" for="goto-page">PAGE</label><input id="goto-page" ` +
    `class="field small-field" name="page" type="number" inputmode="numeric" min="1" max="${PAGES}" value="${current}" required>` +
    `<button type="submit" class="pill solid" data-autofocus>Go</button></form><h2 class="label wide">JUZ</h2>` +
    `<div class="juz-grid wide">` +
    `${juz}</div><h2 class="label wide">SURAH</h2><ul class="plain wide">${suras}</ul>` +
    `<button type="button" class="link-button" data-go="close">Close</button></div></section>`;
}

export function pageNoteSheet(page: number, marks: MushafMarks): string {
  const note = marks.pageNotes[String(page)]?.text ?? "";
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Note on page ${page}"><div class="sheet-inner">` +
    `<p class="eyebrow">Page ${page} · juz ${juzOfPage(page)}</p><form class="stack wide" data-form="page-note">` +
    `<label class="label" for="page-note">NOTE ON THIS PAGE</label><textarea id="page-note" class="field area" name="text" ` +
    `maxlength="1000" rows="4" placeholder="How the revision went, what to go over again">${esc(note)}</textarea>` +
    `<button type="submit" class="pill solid wide">Save the note</button></form>` +
    `${SHEET_ERROR}<button type="button" class="link-button" data-go="close">Close</button></div></section>`;
}

export function mushafView(m: ReaderModel): string {
  const shown = inView(m);
  const sura = pageSurah(shown[0]);
  const juz = juzOfPage(Math.max(...shown));
  const where = shown.length > 1 ? `pages ${shown[0]} and ${shown[1]}` : `page ${m.current}`;
  const night = m.marks.theme === "night";
  // The bars are laid over the page, which is fitted to the whole screen; a tap on the page shows or hides them.
  // Whether they are hidden is set on the drawn reader (main.ts paintReaderBars), never in this HTML.
  // A mode's reading stays within its own pages, so its title goes nowhere.
  const titleInner = `<span class="reader-sura">${esc(SURA_NAMES[sura - 1])} <span lang="ar">${esc(SURA_NAMES_AR[sura - 1])}</span></span>` +
    `<span class="small">Juz ${juz} · ${where} of ${PAGES}</span>`;
  // Its name is the reading's, even where the page opens in the surah before (Al-Kahf begins partway down page 293).
  const title = m.guest ? `<div class="reader-title"><span class="reader-sura">${esc(m.guest.label)}</span>` +
    `<span class="small">Juz ${juz} · ${where} of ${PAGES}</span></div>`
    : `<button type="button" class="reader-title" data-action="mushaf-goto" aria-label="${esc(SURA_NAMES[sura - 1])}, juz ` +
      `${juz}, ${where} of ${PAGES}. Go to another page">${titleInner}</button>`;
  return `<main class="reader theme-${m.marks.theme}"><header class="reader-top">` +
    `<button type="button" class="round" data-go="${esc(m.from)}" aria-label="Close the mushaf">${icon("back")}</button>${title}` +
    `<button type="button" class="round" data-action="mushaf-theme" aria-label="${night ? "Paper page" : "Night page"}">` +
    `${icon(night ? "sun" : "moon")}</button></header>` +
    `<div class="pager${m.spread ? " spread" : ""}${m.book ? " book" : ""}" dir="rtl" data-pager>${m.pages.map((p) => pageHtml(p, m)).join("")}</div>` +
    // A book's pages turn under a finger only: a screen reader's swipe or a switch turns them with these.
    (m.book ? `<button type="button" class="sr-only" data-action="book-next">Next page</button>` +
      `<button type="button" class="sr-only" data-action="book-back">Previous page</button>` : "") +
    footer(m) + `</main>`;
}
