/**
 * Recitation on screen: the recite-to-find sheet, the bar under a page being memorised, and the summary at its end.
 * What the speech model wrote is never shown: a slip is pointed at on the page itself, where the right word is drawn
 * in the mushaf's own script.
 */
import { SURA_NAMES } from "../quran/data.ts";
import { pageOfAyah } from "../quran/pages.ts";
import { summarise, type WordMark } from "../recite/align.ts";
import { DOWNLOAD_BYTES } from "../recite/assets.ts";
import type { Match } from "../recite/search.ts";
import type { FindFlow, MemoriseSession, ReciteProblem } from "../recite/session.ts";
import { deviceWord } from "./deviceWord.ts";
import { esc, icon } from "./html.ts";

const megabytes = (bytes: number): number => Math.round(bytes / 1_000_000);

const PROBLEM: Readonly<Record<ReciteProblem, () => string>> = {
  mic: () => "The microphone is off for Awqat. Turn it on in the phone's Settings, Apps, Awqat, Permissions.",
  noMic: () => `This ${deviceWord()} has no microphone Awqat can use.`,
  audio: () => "The microphone could not be started. Try again.",
  away: () => "Listening stopped when Awqat went to the background.",
  offline: () => "The download needs the internet. Connect, then try again.",
  download: () => "The download did not finish. Try again.",
  damaged: () => "The downloaded files did not match what was expected, so they were removed. Download them again.",
  model: () => `The speech model would not start on this ${deviceWord()}. Try again, or close other apps first.`,
  web: () => "Reciting works in the installed app.",
};

export const problemText = (problem: ReciteProblem): string => PROBLEM[problem]();

/** A place in the Quran, in words: "Al-Kahf 10", "Al-Kahf 10 to 11". */
export function placeName(m: Pick<Match, "sura" | "aya" | "lastAya">): string {
  const name = SURA_NAMES[m.sura - 1] ?? `Surah ${m.sura}`;
  return m.lastAya > m.aya ? `${name} ${m.aya} to ${m.lastAya}` : `${name} ${m.aya}`;
}

const pageLine = (m: Pick<Match, "sura" | "aya">): string => {
  const page = pageOfAyah(m.sura, m.aya);
  return page === null ? `Surah ${m.sura}, ayah ${m.aya}` : `Surah ${m.sura} · ayah ${m.aya} · page ${page}`;
};

const openButton = (m: Match, label: string, solid: boolean): string =>
  `<button type="button" class="pill${solid ? " solid" : ""} wide" data-action="recite-open" ` +
  `data-value="${m.sura}:${m.aya}">${esc(label)}</button>`;

const AGAIN = `<button type="button" class="pill wide" data-action="recite-again">Recite again</button>`;
const CLOSE = `<button type="button" class="link-button" data-go="close">Close</button>`;

function sheet(label: string, body: string): string {
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="sheet-inner">` +
    `${body}${CLOSE}</div></section>`;
}

function introBody(flow: FindFlow): string {
  const what = flow.then === "memorise"
    ? "Memorise hides the page and fills it in as you recite, marking where you slip."
    : "Recite a few words of any ayah and its page opens.";
  return `<p class="eyebrow">${flow.then === "memorise" ? "MEMORISE" : "RECITE TO FIND"}</p><p class="text">${what} It needs ` +
    `a one-time download of about ${megabytes(DOWNLOAD_BYTES)} MB: the Quran speech model and the Quran text from the ` +
    `Tanzil Project. Both stay on this ${deviceWord()}, and what you recite is heard on it, never sent anywhere.</p>` +
    `<button type="button" class="pill solid wide" data-action="recite-download" data-autofocus>Download</button>`;
}

function resultBody(flow: FindFlow): string {
  const result = flow.result;
  if (!result || result.kind === "short") {
    return `<p class="eyebrow">RECITE TO FIND</p><p class="text">A few more words, please. Three or four is usually enough.` +
      `</p>${AGAIN}`;
  }
  if (result.kind === "none") {
    return `<p class="eyebrow">RECITE TO FIND</p><p class="text">That could not be placed in the Quran. Recite a few more ` +
      `words, a little closer to the ${deviceWord()}.</p>${AGAIN}`;
  }
  if (result.kind === "unsure") {
    return `<p class="eyebrow">CLOSE MATCHES</p><p class="text">It could be one of these.</p><div class="stack wide">` +
      result.matches.map((m) => openButton(m, `${placeName(m)} · page ${pageOfAyah(m.sura, m.aya) ?? "?"}`, false)).join("") +
      `</div>${AGAIN}`;
  }
  const { best, same } = result;
  const page = pageOfAyah(best.sura, best.aya);
  const also = same.length ? `<p class="small">The same words also stand at:</p><div class="stack wide">` +
    same.map((m) => openButton(m, placeName(m), false)).join("") + `</div>` : "";
  // Focus lands on the place found, so a screen reader says it before the buttons.
  return `<p class="eyebrow">FOUND</p><p class="numeral" tabindex="-1" data-autofocus>${esc(placeName(best))}</p><p class="mono small">` +
    `${esc(pageLine(best))}</p>${openButton(best, page === null ? "Open it" : `Open page ${page}`, true)}${also}${AGAIN}`;
}

/** The recite-to-find sheet, as its flow stands. The meter and the progress bar are painted in place (paintFind). */
export function reciteSheet(flow: FindFlow): string {
  const label = flow.then === "memorise" ? "Memorise" : "Recite to find";
  switch (flow.phase) {
    case "intro": return sheet(label, introBody(flow));
    case "downloading":
      return sheet(label, `<p class="eyebrow">DOWNLOADING</p><p class="text" data-recite-progress role="status">` +
        `${Math.round(flow.progress * 100)}% of ${megabytes(DOWNLOAD_BYTES)} MB</p><span class="bar"><span class="fill" ` +
        `data-w="${Math.round(flow.progress * 100)}" data-recite-fill></span></span><p class="small">Keep Awqat open until it ` +
        `finishes. A Wi-Fi network is best.</p>`);
    case "preparing":
      return sheet(label, `<p class="eyebrow">${flow.then === "memorise" ? "MEMORISE" : "RECITE TO FIND"}</p>` +
        `<p class="text" aria-busy="true">Getting the speech model ready…</p>`);
    case "listening":
      return sheet(label, `<p class="eyebrow">RECITE TO FIND</p><p class="text">Recite a few words</p>` +
        `<div class="recite-meter" aria-hidden="true">${"<span></span>".repeat(9)}</div>` +
        `<p class="small" role="status">Listening. It stops when you pause.</p>` +
        `<button type="button" class="pill solid wide" data-action="recite-stop" data-autofocus>Stop and find</button>` +
        `<p class="small">Heard on this ${deviceWord()} only.</p>`);
    case "finding":
      return sheet(label, `<p class="eyebrow">RECITE TO FIND</p><p class="text" aria-busy="true" role="status">Finding the ` +
        `ayah…</p>`);
    case "result": return sheet(label, resultBody(flow));
    case "problem": {
      const retry = flow.problem === "offline" || flow.problem === "download" || flow.problem === "damaged"
        ? `<button type="button" class="pill solid wide" data-action="recite-download">${flow.problem === "damaged" ? "Download" : "Try again"}</button>`
        : flow.problem === "model" || flow.problem === "audio" || flow.problem === "away" || flow.problem === "mic" ? AGAIN : "";
      return sheet(label, `<p class="eyebrow">${flow.then === "memorise" ? "MEMORISE" : "RECITE TO FIND"}</p>` +
        `<p class="text" role="alert">${esc(problemText(flow.problem ?? "model"))}</p>${retry}`);
    }
  }
}

/** The microphone's level, 0 to 1, on the meter; the download's progress on its bar. Painted in place. */
export function paintFind(root: ParentNode, flow: FindFlow, loudness: number): void {
  const bars = root.querySelectorAll<HTMLElement>(".recite-meter span");
  const shape = [0.35, 0.6, 0.85, 1, 0.75, 0.95, 0.65, 0.5, 0.3];
  bars.forEach((bar, i) => {
    const height = Math.min(1, 0.12 + loudness * 6 * shape[i % shape.length]);
    bar.style.transform = `scaleY(${height.toFixed(3)})`;
  });
  const fill = root.querySelector<HTMLElement>("[data-recite-fill]");
  if (fill) fill.style.width = `${Math.round(flow.progress * 100)}%`;
  const progress = root.querySelector<HTMLElement>("[data-recite-progress]");
  if (progress) progress.textContent = `${Math.round(flow.progress * 100)}% of ${megabytes(DOWNLOAD_BYTES)} MB`;
}

/**
 * What a problem says in the memorise bar, in a few words: the bar's line has a fixed height (two lines at 320 px), so
 * the sheet's longer sentences (problemText) would not fit.
 */
const BAR_PROBLEM: Readonly<Record<ReciteProblem, string>> = {
  mic: "The microphone is off. Turn it on in Settings.",
  noMic: "No microphone to use here.",
  audio: "The microphone would not start.",
  away: "Listening stopped in the background.",
  offline: "The download needs the internet.",
  download: "The download did not finish.",
  damaged: "The files were damaged. Download them again.",
  model: "The speech model would not start.",
  web: "Reciting works in the installed app.",
};

function memoriseLine(s: MemoriseSession): string {
  if (s.problem) return BAR_PROBLEM[s.problem];
  const sum = summarise(s.m);
  const total = s.m.keys.length;
  if (s.phase === "preparing") return "Getting the model ready…";
  if (s.phase === "left") return `You left ${s.pages.length > 1 ? "these pages" : `page ${s.page}`}.`;
  if (sum.done) return "Every word is in. Tap Done.";
  if (s.phase === "paused") return `Paused. ${total - sum.hidden} of ${total} words.`;
  return s.working > 0 ? "Filling in what you said…" : "Listening. Start anywhere.";
}

/**
 * Whether the bar's line is read out when it changes. While you recite it flips between "listening" and "filling in"
 * with every stretch heard, which a screen reader would say over your own voice: those two are shown, not spoken. A
 * problem, a pause, the end, and the model getting ready are spoken.
 */
const lineSpoken = (s: MemoriseSession): boolean =>
  s.problem !== null || s.phase !== "listening" || summarise(s.m).done;

/**
 * The bar under a page being memorised: what is happening, Peek, listen or pause, and Done. While the page is heard it
 * is painted in place (paintMemoriseBar, paintMemoriseLevel), so what is marked here must stay findable.
 */
export function memoriseBar(s: MemoriseSession): string {
  const live = lineSpoken(s) ? `role="status"` : `aria-live="off"`;
  const status = `<p class="small memorise-line" ${live} data-memorise-line>${esc(memoriseLine(s))}</p>`;
  if (s.phase === "left") {
    return `<footer class="reader-bottom" data-memorise-bar="left">${status}<div class="reader-actions"><button type="button" ` +
      `class="pill solid" data-action="memorise-back">Back to ${s.pages.length > 1 ? "the pages" : `page ${s.page}`}` +
      `</button><button type="button" class="pill" data-action="memorise-done">Done</button></div></footer>`;
  }
  const listening = s.phase === "listening";
  const off = s.phase === "preparing" || summarise(s.m).done ? " disabled" : "";
  // A toggle keeps one name; whether it is on is said by aria-pressed, not by a changing label.
  return `<footer class="reader-bottom" data-memorise-bar="on">${status}` +
    `<div class="memorise-level" aria-hidden="true"><span></span></div><div class="reader-actions">` +
    `<button type="button" class="pill" data-action="memorise-peek"${off}>Peek</button>` +
    `<button type="button" class="round mic-round${listening ? " listening" : ""}" data-action="memorise-toggle" ` +
    `aria-pressed="${listening}" aria-label="Listen"${off}>${icon(listening ? "pause" : "mic", 20)}</button>` +
    `<button type="button" class="pill solid" data-action="memorise-done">Done</button></div></footer>`;
}

const LEVEL_GAIN = 6;

/** The voice's level, 0 to 1, on the memorise bar's meter: a transform set in place, as paintFind does. */
export function paintMemoriseLevel(root: ParentNode, loudness: number): void {
  const fill = root.querySelector<HTMLElement>(".memorise-level span");
  if (fill) fill.style.transform = `scaleX(${Math.min(1, Math.max(0, loudness) * LEVEL_GAIN).toFixed(3)})`;
}

/** Sets a line's spoken or silent state before its words change, so the change is heard (or not) as it should be. */
function setSpoken(line: HTMLElement, spoken: boolean): void {
  if (spoken && line.getAttribute("role") !== "status") {
    line.removeAttribute("aria-live");
    line.setAttribute("role", "status");
  } else if (!spoken && line.getAttribute("aria-live") !== "off") {
    line.removeAttribute("role");
    line.setAttribute("aria-live", "off");
  }
}

/**
 * The bar brought up to date without drawing the page again: its line, and whether Peek and listen are off. A change
 * of phase (listening, paused, left) is a drawing of the bar, never this; the way-back bar is left as it is.
 */
export function paintMemoriseBar(root: ParentNode, s: MemoriseSession | null): void {
  if (!s || s.phase === "left") return;
  const bar = root.querySelector<HTMLElement>('[data-memorise-bar="on"]');
  if (!bar) return;
  const line = bar.querySelector<HTMLElement>("[data-memorise-line]");
  if (line) {
    const text = memoriseLine(s);
    setSpoken(line, lineSpoken(s));
    if (line.textContent !== text) line.textContent = text;
  }
  const off = s.phase === "preparing" || summarise(s.m).done;
  bar.querySelectorAll<HTMLButtonElement>('[data-action="memorise-peek"], [data-action="memorise-toggle"]').forEach((button) => {
    if (button.disabled !== off) button.disabled = off;
  });
  if (s.phase !== "listening") paintMemoriseLevel(bar, 0);
}

const MARK_TEXT: Readonly<Record<Exclude<WordMark, "said">, string>> = {
  different: "heard as a different word",
  skipped: "skipped",
  peeked: "you peeked",
};

/** Where a word stands: its page (when two are open), line and place on the line. */
export interface WordPlace {
  page: number;
  line: number;
  word: number;
}

/**
 * The end of a memorising: how it went, each slip with its line (tap to say it was right), and what to keep. While a
 * last stretch is still being heard, Keep waits for it, so no slip is left out of what is kept.
 */
export function memoriseDoneSheet(s: MemoriseSession, lineOf: ReadonlyMap<string, WordPlace>): string {
  const sum = summarise(s.m);
  const both = s.pages.length > 1;
  const rows = s.m.keys.map((key, i) => ({ key, mark: s.m.marks[i] })).filter((r) => r.mark && r.mark !== "said")
    .map(({ key, mark }) => {
      const at = lineOf.get(key);
      const where = !at ? "A word" : `${both ? `Page ${at.page}, line` : "Line"} ${at.line}, word ${at.word}`;
      const clear = mark === "peeked" ? "" : `<button type="button" class="ghost-link" data-action="memorise-clear" ` +
        `data-value="${esc(key)}">It was right</button>`;
      return `<li class="row-item"><span class="col grow"><span>${esc(where)}</span><span class="small">` +
        `${esc(MARK_TEXT[mark as Exclude<WordMark, "said">])}</span></span>${clear}</li>`;
    });
  const slipsCount = sum.different + sum.skipped + sum.peeked;
  const heard = sum.said + sum.different + sum.skipped + sum.peeked;
  const hearing = s.working > 0;
  const head = heard === 0 ? (hearing ? "Still hearing your last words…" : `Nothing was recited on ${both ? "these pages" : "this page"} yet.`)
    : slipsCount === 0 ? `${sum.said} words from memory, with no slips.`
    : `${sum.said} words from memory. ${slipsCount} place${slipsCount === 1 ? "" : "s"} to look at again.`;
  const keep = slipsCount ? `<button type="button" class="pill solid wide" data-action="memorise-keep" data-autofocus` +
    `${hearing ? " disabled" : ""}>Keep ${slipsCount === 1 ? "this" : `these ${slipsCount}`} for revision</button>` +
    `<p class="small"${hearing ? ' role="status"' : ""}>${hearing ? "Still hearing your last words…"
      : "They show on the page and among your revision's weak pages."}</p>` : "";
  const pagesName = both ? `pages ${s.pages.join(" and ")}` : `page ${s.page}`;
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Memorise, ${esc(pagesName)}"><div class="sheet-inner">` +
    `<p class="eyebrow">${esc(pagesName.toUpperCase())} · MEMORISE</p><p class="text"${hearing ? ' aria-busy="true"' : ""}>${esc(head)}</p>` +
    (rows.length ? `<ul class="plain wide">${rows.join("")}</ul>` : "") + keep +
    `<p class="small">It can mishear, most of all in a noisy room. Words are checked, not tajweed.</p>` +
    `<p class="sheet-error" data-sheet-error role="alert" hidden></p>` +
    `<div class="row-buttons center-row"><button type="button" class="pill" data-action="memorise-again">Recite again</button>` +
    `<button type="button" class="pill" data-action="memorise-end">${slipsCount ? "Close without keeping" : "Close"}</button>` +
    `</div></div></section>`;
}

const MARK_CLASS: Readonly<Record<WordMark, string>> = { said: "", different: "m-diff", skipped: "m-skip", peeked: "m-peek" };
const ALL_CLASSES = ["m-hid", "m-diff", "m-skip", "m-peek"];
const PAINTED = ".w.m-hid, .w.m-diff, .w.m-skip, .w.m-peek";

/** What each word was last painted as (its class, "" for a word said). A page drawn anew has new words: all unseen. */
const painted = new WeakMap<HTMLElement, string>();
/** The pages last painted in a root, so a different set is swept clean. */
const paintedPages = new WeakMap<ParentNode, string>();
/** A session's word keys to their places; the keys' array is the same through every stretch heard. */
const places = new WeakMap<readonly string[], Map<string, number>>();

function placesOf(keys: readonly string[]): Map<string, number> {
  const known = places.get(keys);
  if (known) return known;
  const made = new Map(keys.map((key, i) => [key, i]));
  places.set(keys, made);
  return made;
}

/** Puts a painted word back as drawn: its label and tab stop returned, its marks off. */
function unpaint(w: HTMLElement): void {
  painted.delete(w);
  if (!ALL_CLASSES.some((c) => w.classList.contains(c))) return;
  w.classList.remove(...ALL_CLASSES);
  if (w.dataset.label !== undefined) {
    if (w.dataset.label) w.setAttribute("aria-label", w.dataset.label);
    else w.removeAttribute("aria-label");
    delete w.dataset.label;
  }
  w.removeAttribute("tabindex");
}

/** Paints one word as `want` (a mark's class, "m-hid" for a hidden word, or "" for a word said); nothing if it already is. */
function paintWord(w: HTMLElement, want: string): void {
  if (painted.get(w) === want && (want === "" || w.classList.contains(want))) return;
  unpaint(w);
  if (want === "m-hid") {
    w.classList.add("m-hid");
    w.dataset.label = w.getAttribute("aria-label") ?? "";
    w.setAttribute("aria-label", "Hidden word");
    w.setAttribute("tabindex", "-1");
  } else if (want) w.classList.add(want);
  painted.set(w, want);
}

/** Every painted word that is not on one of `keep`'s pages is put back as drawn. */
function sweep(root: ParentNode, keep: readonly number[]): void {
  root.querySelectorAll<HTMLElement>(PAINTED).forEach((w) => {
    if (!keep.some((p) => w.closest(`[data-page="${p}"]`))) unpaint(w);
  });
}

/**
 * The pages being memorised, painted in place over the words already drawn: a hidden word keeps its place on its line
 * (its ink is clear), so nothing moves as words fill in. It is out of the tab order, and its label says only that it
 * is hidden, so neither a keyboard nor a screen reader gives the word away. Only the words whose mark changed since
 * the last paint are touched (a page drawn anew has new words, so it is painted whole).
 */
export function paintMemorise(root: ParentNode, s: MemoriseSession | null): void {
  const active = s !== null && s.phase !== "left";
  const reader = root.querySelector<HTMLElement>(".reader");
  if (reader && reader.classList.contains("memorising") !== active) reader.classList.toggle("memorising", active);
  const pages = active ? s.pages.map((p) => Math.trunc(p)) : [];
  const signature = pages.join(",");
  if (!active || paintedPages.get(root) !== signature) sweep(root, pages);
  paintedPages.set(root, signature);
  if (!active || pages.length === 0) return;
  const index = placesOf(s.m.keys);
  const selector = pages.map((p) => `[data-page="${p}"] .w[data-word]`).join(", ");
  root.querySelectorAll<HTMLElement>(selector).forEach((w) => {
    const i = index.get(w.dataset.word ?? "");
    if (i === undefined) return;
    const mark = s.m.marks[i];
    paintWord(w, mark === null ? "m-hid" : MARK_CLASS[mark]);
  });
}

/** The ayah just found by reciting, lit on its page. */
export function paintLit(root: ParentNode, ayah: string | null): void {
  root.querySelectorAll(".w.lit").forEach((w) => w.classList.remove("lit"));
  if (!ayah || !/^\d{1,3}:\d{1,3}$/.test(ayah)) return;
  root.querySelectorAll(`.w[data-word^="${ayah}:"]`).forEach((w) => w.classList.add("lit"));
}
