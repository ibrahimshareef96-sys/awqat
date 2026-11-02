/** What the mushaf reader does: open and turn pages, load their fonts, and keep revision marks and notes. */
import { PAGES } from "../quran/data.ts";
import { bookmarkPage } from "../quran/bookmark.ts";
import { juzOfPage, lastRevised } from "../quran/log.ts";
import {
  clearMistakes, markMistake, moveBookmark, setAyahNote, setPageNote, setTheme, type MushafMarks,
} from "../quran/marks.ts";
import { ayahOfWord, type MushafWord } from "../quran/mushafPage.ts";
import { pageOfAyah } from "../quran/pages.ts";
import { spreadNeighbours, spreadPages, spreadStart } from "../quran/spread.ts";
import { cachedPage, downloadFont, fontsOnPhone, loadPage, loadedFont, pageFont } from "../quran/mushafFiles.ts";
import { fridayWindow } from "../faith/friday.ts";
import { KEYS } from "../store.ts";
import type { ReaderModel, ReaderPage } from "../ui/mushafView.ts";
import { bookAllowed } from "../ui/pageTurn.ts";
import { placeOf, setPlace } from "../modes/modes.ts";
import { MESSAGES, announce, hooks, save, setNotice, state, today, type GuestReading } from "./state.ts";
import * as quran from "./quranActions.ts";

type Waiting = "loading" | "offline" | "failed";

const status = new Map<number, Waiting>();
let bismillahGlyphs = "";
let downloading = false;
let saving = false;

/** After a page that needed the internet, a short pause, so readying the whole mushaf is gentle on Quran.com. */
const DOWNLOAD_PAUSE_MS = 250;
/** A page already on the phone is read in a few milliseconds; one that took longer came over the internet. */
const LOCAL_MS = 40;

const clampPage = (page: number): number => Math.min(PAGES, Math.max(1, Math.round(Number.isFinite(page) ? page : 1)));
/** The pages drawn around the open one: one either side, or with two pages open, a spread either side. */
const neighbours = (page: number): number[] => state.spread ? spreadNeighbours(page)
  : [page - 1, page, page + 1].filter((p) => p >= 1 && p <= PAGES);
/** The pages in view: the open page, or both pages of the open spread. */
const inView = (page: number): number[] => (state.spread ? spreadPages(page) : [page]);
/**
 * The juz the reader names and ticks: the open page's, or with two pages open the left-hand page's, however the spread
 * was opened. A juz begins on a left-hand page in this print (27 of 30), which is where the muraja'ah plan opens it.
 */
const spreadJuz = (page: number): number => juzOfPage(Math.max(...inView(page)));
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Loads a page's lines and its font; the screen is redrawn (softly) once both are here, or once it is clear why not. */
async function prepare(page: number): Promise<void> {
  if (status.get(page) === "loading" || (loadedFont(page) && cachedPage(page))) return;
  status.set(page, "loading");
  const [data, font] = await Promise.all([loadPage(page), pageFont(page)]);
  if ("page" in data && "family" in font) status.delete(page);
  else status.set(page, "offline" in data || "offline" in font ? "offline" : "failed");
  hooks.softRender();
}

/** The bismillah is drawn with Al-Fatiha's first ayah from page 1, without its ayah number. */
async function prepareBismillah(): Promise<void> {
  if (bismillahGlyphs && loadedFont(1)) return;
  const [page1] = await Promise.all([loadPage(1), pageFont(1)]);
  const words = "page" in page1 ? page1.page.lines.flatMap((l) => (l.kind === "words" ? l.words : [])) : [];
  bismillahGlyphs = words.filter((w) => /^1:1:[1-4]$/.test(w.key)).map((w) => w.glyph).join(" ");
  hooks.softRender();
}

function preparePages(page: number): void {
  for (const p of neighbours(page)) void prepare(p);
  void prepareBismillah();
}

/**
 * Opens a page. `moves`: the user went there personally (a page turned, or one chosen in the go-to sheet), so while reading on
 * (state.mushafReading) the bookmark follows, saved only when it moved. Merely opening the mushaf never moves it, so a
 * device that has not heard from the others yet cannot put their bookmark back; a page opened to revise never does.
 */
export function open(page: number, moves = false): void {
  const target = clampPage(page);
  state.mushafPage = target;
  preparePages(target);
  if (moves) keepGuestPlace(target);
  if (!moves || !state.mushafReading || (state.mushaf.lastPage === target && state.mushaf.lastPageAt > 0)) return;
  state.mushaf = moveBookmark(state.mushaf, target);
  void save(KEYS.mushaf, state.mushaf);
}

/**
 * How the reader was opened from outside it: "continue" (Home, the Quran screen, the widget: at the bookmark),
 * "chosen" (a page picked in the go-to sheet while reading on: the bookmark moves there), or "revise" (a muraja'ah,
 * Al-Kahf, adhkar or history link: the bookmark stays). The bars show again on every opening.
 */
export type OpenMode = "continue" | "chosen" | "revise";

/**
 * How a go to the mushaf opens it: "mushaf" continues at the bookmark; a page picked in the go-to sheet while reading
 * on is chosen; any other page (a revision link, or the go-to sheet inside a revision) is revision.
 */
export function openModeFor(target: string, sheet: string | null, reading: boolean): OpenMode {
  if (target === "mushaf") return "continue";
  return sheet === "goto" && reading ? "chosen" : "revise";
}

export function openFrom(page: number, mode: OpenMode): void {
  // A page chosen while reading on is a jump: where the user came from stays one tap away. Anything else starts clean.
  const from = bookmarkPage(state.mushaf, state.quran);
  state.mushafJumpFrom = mode === "chosen" && from !== clampPage(page) ? (state.mushafJumpFrom ?? from) : null;
  state.mushafReading = mode !== "revise";
  state.mushafTurned = false;
  state.mushafBarsHidden = false;
  state.mushafGuest = null;
  open(page, mode === "chosen");
}

/** One tap back to where the user was reading before a jump in the go-to sheet: the bookmark goes back with the user. */
export function jumpBack(): void {
  const page = state.mushafJumpFrom;
  if (page === null) return;
  openFrom(page, "chosen");
  state.mushafJumpFrom = null;
  hooks.render();
}

/**
 * A mode's reading: never the bookmark, never the log. It opens at its own place, stays within its own pages, and Back
 * returns to `from`.
 */
export function openGuest(guest: GuestReading, page: number, from: string): void {
  openFrom(Math.min(guest.last, Math.max(guest.first, page)), "revise");
  state.mushafGuest = guest;
  state.mushafFrom = from;
}

/** The pages in view at a page are all outside a mode's reading: a swipe there does not turn. */
function outsideGuest(page: number): boolean {
  const guest = state.mushafGuest;
  return guest !== null && !inView(page).some((p) => p >= guest.first && p <= guest.last);
}

/** A page turned in a mode's reading is its place, on every device. */
function keepGuestPlace(page: number): void {
  const guest = state.mushafGuest;
  if (!guest?.placeKey) return;
  const inside = inView(page).filter((p) => p >= guest.first && p <= guest.last);
  if (inside.length === 0 || placeOf(state.modes, guest.placeKey) === Math.max(...inside)) return;
  state.modes = setPlace(state.modes, guest.placeKey, Math.max(...inside), Date.now());
  void save(KEYS.modes, state.modes);
}

/**
 * The bars are hidden now: as the user left them, unless a notice is showing (then they stay up so it is read), or a
 * page is being memorised (its bar holds the microphone and Done).
 */
export const barsHidden = (): boolean => state.mushafBarsHidden && !state.notice && !state.memorise;

/** The pages in view now: the open page, or both pages of the open spread. */
export const pagesInView = (): number[] => inView(state.mushafPage);

/**
 * The user's bookmark arrived from another device (its time changed in this sync) while the reader waits on the page it
 * opened to read on: the reader moves to it. Once a page has turned here, the pages stay where the user is.
 */
export function bookmarkArrived(): void {
  if (state.screen !== "mushaf" || !state.mushafReading || state.mushafTurned) return;
  const page = state.mushaf.lastPage;
  if (page === state.mushafPage) return;
  state.mushafPage = clampPage(page);
  preparePages(state.mushafPage);
}

/** The bars over the page shown or hidden: a tap anywhere on the page (not while a notice holds them up). */
export function toggleBars(): void {
  if (state.notice) return;
  state.mushafBarsHidden = !state.mushafBarsHidden;
}

/**
 * A swipe settled on another page (with two pages open, another spread: its right-hand page becomes the open one).
 * Focus follows the page for a screen reader, and the new page is announced. Says whether it turned.
 */
export function turnTo(page: number): boolean {
  const target = state.spread ? spreadStart(clampPage(page)) : clampPage(page);
  if (target === (state.spread ? spreadStart(state.mushafPage) : state.mushafPage) || outsideGuest(target)) return false;
  const focusInPages = Boolean(document.activeElement?.closest("[data-pager]"));
  state.mushafTurned = true;
  // The bars stay as the user left them, and only a tap on the page changes that. In a book that also picks the turn: up, the user is
  // leafing through and the pages slide; hidden, the user is reading and they curl. A notice that only informs (the mushaf ready
  // offline) goes with a turn; one saying a change was not saved stays, holding the bars up.
  if (state.notice && state.notice !== MESSAGES.unsaved && state.notice !== MESSAGES.unreadable) state.notice = "";
  open(target, true);
  hooks.render();
  const shown = inView(target);
  announce(shown.length > 1 ? `Pages ${shown[0]} and ${shown[1]}` : `Page ${target}`);
  if (focusInPages) document.querySelector<HTMLElement>(`[data-page="${target}"]`)?.focus({ preventScroll: true });
  return true;
}

/** The screen turned or changed size: two pages open on a big screen on its side, one otherwise. */
export function setSpread(spread: boolean): void {
  if (state.spread === spread) return;
  state.spread = spread;
  if (state.screen === "mushaf") preparePages(state.mushafPage);
}

/** Tries the open page and its neighbours again (a tap on Try again, or a return to the app). */
export function retry(): void {
  for (const p of neighbours(state.mushafPage)) {
    if (status.get(p) !== "loading") status.delete(p);
  }
  preparePages(state.mushafPage);
  hooks.render();
}

export function toggleTheme(): void {
  state.mushaf = setTheme(state.mushaf, state.mushaf.theme === "paper" ? "night" : "paper");
  hooks.render();
  // Not saved: the reader shows why (its notice line).
  void save(KEYS.mushaf, state.mushaf).then((saved) => { if (!saved) hooks.render(); });
}

/** Read to the open page, or with two pages open, to the left-hand one: both have been read. */
export function readHere(): void {
  quran.readTo(Math.max(...inView(state.mushafPage)));
}

export function reviseJuz(): void {
  quran.toggleJuz(spreadJuz(state.mushafPage));
}

export function openWord(word: string): void {
  state.word = word;
  state.sheet = "word";
  hooks.renderOverlay();
}

/** The note on a page in view: the one named (either page of an open spread), or the open page. */
export function openPageNote(value = ""): void {
  const page = Number(value);
  state.notePage = inView(state.mushafPage).includes(page) ? page : state.mushafPage;
  state.sheet = "page-note";
  hooks.renderOverlay();
}

export function openGoto(): void {
  state.sheet = "goto";
  hooks.renderOverlay();
}

/** A note typed in the open mushaf sheet and not saved yet. */
export function noteTyped(): boolean {
  if (state.sheet !== "word" && state.sheet !== "page-note") return false;
  const area = document.querySelector<HTMLTextAreaElement>("#overlay textarea");
  return area !== null && area.value.trim() !== area.defaultValue.trim();
}

/** Says inside the open sheet why it is still open; its typed text stays. */
export function sheetError(text: string): void {
  const el = document.querySelector<HTMLElement>("#overlay [data-sheet-error]");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

/**
 * Saves a change to the marks first, and only then shows it, so a mark or note that could not be saved never looks
 * as if it was. If the place in the mushaf moved while saving, the change is made again on top of that and saved.
 * `savesNote`: the change is the sheet's own note, so the sheet may close with it. A mark or clear made while a note
 * is half typed leaves the sheet open, so the note is not lost.
 */
async function commit(change: (marks: MushafMarks) => MushafMarks, said: string, savesNote: boolean): Promise<boolean> {
  if (saving) return false;
  saving = true;
  try {
    const before = state.mushaf;
    const next = change(before);
    if (!(await save(KEYS.mushaf, next))) {
      sheetError(state.notice || MESSAGES.unsaved);
      return false;
    }
    state.mushaf = state.mushaf === before ? next : change(state.mushaf);
    if (state.mushaf !== next) void save(KEYS.mushaf, state.mushaf);
    hooks.render();
    announce(said);
    if (savesNote || !noteTyped()) hooks.closeSheet(true);
    else keptOpen(said);
    return true;
  } finally {
    saving = false;
  }
}

/** The sheet stayed open over a half-typed note: its mistake count is brought up to date in place, and it says why. */
function keptOpen(said: string): void {
  const word = state.word;
  const count = word && Object.hasOwn(state.mushaf.mistakes, word) ? state.mushaf.mistakes[word].count : 0;
  const button = document.querySelector<HTMLElement>('#overlay [data-action="mushaf-mistake"]');
  if (button) button.textContent = `Mark a mistake${count ? ` (${count})` : ""}`;
  sheetError(`${said} Your note is not saved yet: save it, or close again to let it go.`);
}

/** A page's words in reading order (ayah numbers included), with each one's line and place on it; null until it opens. */
export function pageWords(page: number): { words: MushafWord[]; at: Map<string, { line: number; word: number }> } | null {
  const data = cachedPage(page);
  if (!data) return null;
  const words: MushafWord[] = [];
  const at = new Map<string, { line: number; word: number }>();
  for (const line of data.lines) {
    if (line.kind !== "words") continue;
    line.words.forEach((w, i) => { words.push(w); at.set(w.key, { line: line.n, word: i + 1 }); });
  }
  return { words, at };
}

/**
 * Memorising's slips and peeks, kept as revision mistakes on their words (the sheet that asked for it then closes).
 * True once they are saved; false when the save failed or another was still going, so nothing is let go.
 */
export function keepMistakes(words: readonly string[], said: string): Promise<boolean> {
  const day = today();
  return commit((m) => words.reduce((marks, word) => markMistake(marks, word, day), m), said, true);
}

export function markWord(): void {
  const word = state.word;
  if (word) void commit((m) => markMistake(m, word, today()), "Mistake marked.", false);
}

export function clearWord(): void {
  const word = state.word;
  if (word) void commit((m) => clearMistakes(m, word), "Marks cleared.", false);
}

export function saveAyahNote(text: string): void {
  const word = state.word;
  if (word) {
    void commit((m) => setAyahNote(m, ayahOfWord(word), text, today()), text.trim() ? "Note saved." : "Note removed.", true);
  }
}

export function savePageNote(text: string): void {
  const page = state.notePage ?? state.mushafPage;
  void commit((m) => setPageNote(m, page, text, today()), text.trim() ? "Page note saved." : "Page note removed.", true);
}

/** The tapped word's ayah, word by word, from the pages it is on (an ayah can run on to the next page). */
export function ayahWords(word: string): MushafWord[] {
  const ayah = ayahOfWord(word);
  const [sura, aya] = ayah.split(":").map(Number);
  const start = pageOfAyah(sura, aya);
  if (start === null) return [];
  return [start, start + 1].flatMap((p) => cachedPage(p)?.lines.flatMap((l) => (l.kind === "words" ? l.words : [])) ?? [])
    .filter((w) => ayahOfWord(w.key) === ayah);
}

/**
 * Readies the whole mushaf for offline reading, gently: every page's font (kept) and every page's words (kept for 7
 * days, as Quran Foundation allows; opening a page with a connection refreshes it). Stops after 3 failures in a row.
 */
export async function downloadAll(): Promise<void> {
  if (downloading) return;
  downloading = true;
  state.mushafDownload = { done: 0, total: PAGES };
  hooks.render();
  let failures = 0;
  let done = 0;
  try {
    for (let page = 1; page <= PAGES && failures < 3; page += 1) {
      const started = Date.now();
      const [font, data] = await Promise.all([downloadFont(page), loadPage(page)]);
      const ok = font === "ok" && "page" in data;
      failures = ok ? 0 : failures + 1;
      if (ok) done += 1;
      state.mushafDownload = { done, total: PAGES };
      hooks.softRender();
      if (Date.now() - started > LOCAL_MS) await pause(DOWNLOAD_PAUSE_MS);
    }
  } finally {
    downloading = false;
    state.mushafDownload = null;
    const fonts = await fontsOnPhone();
    setNotice(done >= PAGES ? "The whole mushaf is ready offline. Its words refresh every 7 days when you are online."
      : `${fonts} of ${PAGES} pages are ready offline. Connect to the internet and tap again for the rest.`);
    hooks.softRender();
  }
}

/**
 * A page as the reader draws it: ready (its words and font are both here), or why not yet. Words kept on the phone run
 * out after 7 days even with the reader open; a page found without them is fetched again.
 */
function readerPage(page: number): ReaderPage {
  const data = cachedPage(page);
  const font = loadedFont(page);
  if (data && font) return { page, status: "ready", data, font };
  if (!status.has(page)) void prepare(page);
  return { page, status: status.get(page) ?? "loading", data: null, font: null };
}

/** What the reader says of a mode's reading: how far along, and the tick at its end while its Friday is open. */
function guestModel(friday: string | null): ReaderModel["guest"] {
  const guest = state.mushafGuest;
  if (!guest) return null;
  const tick = guest.tick && friday ? { item: guest.tick, done: state.friday.days[friday]?.[guest.tick] === true } : null;
  return { label: guest.label, first: guest.first, last: guest.last, tick, bookmark: bookmarkPage(state.mushaf, state.quran) };
}

export function readerModel(now = new Date()): ReaderModel {
  const current = state.mushafPage;
  const open = fridayWindow(state.days, now);
  return {
    book: bookAllowed(state.settings.bookPages),
    current, pages: neighbours(current).filter((p) => !outsideGuest(p)).map(readerPage), marks: state.mushaf, position: state.quran.position,
    spread: state.spread ? spreadPages(current) : null,
    bismillah: { font: loadedFont(1), glyphs: bismillahGlyphs },
    revisedToday: lastRevised(state.quran)[spreadJuz(current)] === today(),
    kahfOpen: open !== null && state.friday.days[open.friday]?.kahf !== true,
    from: state.mushafFrom, notice: state.notice, jumpFrom: state.mushafJumpFrom,
    guest: guestModel(open?.friday ?? null),
    memorise: state.memorise,
  };
}
