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
  return `<p class="eyebrow">FOUND</p><p class="numeral">${esc(placeName(best))}</p><p class="mono small">` +
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
        : flow.problem === "model" ? AGAIN : "";
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

function memoriseLine(s: MemoriseSession): string {
  if (s.problem) return problemText(s.problem);
  const sum = summarise(s.m);
  const total = s.m.keys.length;
  if (s.phase === "preparing") return "Getting the speech model ready…";
  if (s.phase === "left") return `You turned away from page ${s.page}.`;
  if (sum.done) return "Every word is in. Tap Done to see how it went.";
  if (s.phase === "paused") return `Paused. ${total - sum.hidden} of ${total} words.`;
  return s.working > 0 ? "Listening, and filling in what it heard…" : "Listening. Recite from the top, or from anywhere on the page.";
}

/** The bar under a page being memorised: what is happening, Peek, listen or pause, and Done. */
export function memoriseBar(s: MemoriseSession): string {
  const status = `<p class="small memorise-line" role="status">${esc(memoriseLine(s))}</p>`;
  if (s.phase === "left") {
    return `<footer class="reader-bottom">${status}<div class="reader-actions"><button type="button" class="pill solid" ` +
      `data-action="memorise-back">Back to page ${s.page}</button><button type="button" class="pill" data-action="memorise-done">` +
      `Done</button></div></footer>`;
  }
  const listening = s.phase === "listening";
  const ended = summarise(s.m).done;
  return `<footer class="reader-bottom">${status}<div class="reader-actions">` +
    `<button type="button" class="pill" data-action="memorise-peek"${s.phase === "preparing" || ended ? " disabled" : ""}>Peek</button>` +
    `<button type="button" class="round mic-round${listening ? " listening" : ""}" data-action="memorise-toggle" ` +
    `aria-pressed="${listening}" aria-label="${listening ? "Pause listening" : "Listen"}"${s.phase === "preparing" || ended ? " disabled" : ""}>` +
    `${icon(listening ? "pause" : "mic", 20)}</button>` +
    `<button type="button" class="pill solid" data-action="memorise-done">Done</button></div></footer>`;
}

const MARK_TEXT: Readonly<Record<Exclude<WordMark, "said">, string>> = {
  different: "heard as a different word",
  skipped: "skipped",
  peeked: "you peeked",
};

/** The end of a memorising: how it went, each slip with its line (tap to say it was right), and what to keep. */
export function memoriseDoneSheet(s: MemoriseSession, lineOf: ReadonlyMap<string, { line: number; word: number }>): string {
  const sum = summarise(s.m);
  const rows = s.m.keys.map((key, i) => ({ key, mark: s.m.marks[i] })).filter((r) => r.mark && r.mark !== "said")
    .map(({ key, mark }) => {
      const at = lineOf.get(key);
      const where = at ? `Line ${at.line}, word ${at.word}` : "A word";
      const clear = mark === "peeked" ? "" : `<button type="button" class="ghost-link" data-action="memorise-clear" ` +
        `data-value="${esc(key)}">It was right</button>`;
      return `<li class="row-item"><span class="col grow"><span>${esc(where)}</span><span class="small">` +
        `${esc(MARK_TEXT[mark as Exclude<WordMark, "said">])}</span></span>${clear}</li>`;
    });
  const slipsCount = sum.different + sum.skipped + sum.peeked;
  const heard = sum.said + sum.different + sum.skipped + sum.peeked;
  const head = heard === 0 ? "Nothing was recited on this page yet."
    : slipsCount === 0 ? `${sum.said} words from memory, with no slips.`
    : `${sum.said} words from memory. ${slipsCount} place${slipsCount === 1 ? "" : "s"} to look at again.`;
  const keep = slipsCount ? `<button type="button" class="pill solid wide" data-action="memorise-keep" data-autofocus>` +
    `Keep ${slipsCount === 1 ? "this" : `these ${slipsCount}`} for revision</button><p class="small">They show on the page and ` +
    `among your revision's weak pages.</p>` : "";
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Memorise, page ${s.page}"><div class="sheet-inner">` +
    `<p class="eyebrow">PAGE ${s.page} · MEMORISE</p><p class="text">${esc(head)}</p>` +
    (rows.length ? `<ul class="plain wide">${rows.join("")}</ul>` : "") + keep +
    `<p class="small">It can mishear, most of all in a noisy room. Words are checked, not tajweed.</p>` +
    `<p class="sheet-error" data-sheet-error role="alert" hidden></p>` +
    `<div class="row-buttons center-row"><button type="button" class="pill" data-action="memorise-again">Recite again</button>` +
    `<button type="button" class="pill" data-action="memorise-end">${slipsCount ? "Close without keeping" : "Close"}</button>` +
    `</div></div></section>`;
}

const MARK_CLASS: Readonly<Record<WordMark, string>> = { said: "", different: "m-diff", skipped: "m-skip", peeked: "m-peek" };
const ALL_CLASSES = ["m-hid", "m-diff", "m-skip", "m-peek"];

/**
 * The page being memorised, painted in place over the words already drawn: a hidden word keeps its place on its line
 * (its ink is clear), so nothing moves as words fill in. Its label is hidden from screen readers too.
 */
export function paintMemorise(root: ParentNode, s: MemoriseSession | null): void {
  const reader = root.querySelector<HTMLElement>(".reader");
  reader?.classList.toggle("memorising", s !== null && s.phase !== "left");
  root.querySelectorAll<HTMLElement>(".w.m-hid, .w.m-diff, .w.m-skip, .w.m-peek").forEach((w) => {
    w.classList.remove(...ALL_CLASSES);
    if (w.dataset.label !== undefined) { w.setAttribute("aria-label", w.dataset.label); delete w.dataset.label; }
  });
  if (!s || s.phase === "left") return;
  const index = new Map(s.m.keys.map((key, i) => [key, i]));
  root.querySelectorAll<HTMLElement>(`[data-page="${s.page}"] .w[data-word]`).forEach((w) => {
    const i = index.get(w.dataset.word ?? "");
    if (i === undefined) return;
    const mark = s.m.marks[i];
    if (mark === null) {
      w.classList.add("m-hid");
      w.dataset.label = w.getAttribute("aria-label") ?? "";
      w.setAttribute("aria-label", "Hidden word");
    } else if (MARK_CLASS[mark]) w.classList.add(MARK_CLASS[mark]);
  });
}

/** The ayah just found by reciting, lit on its page. */
export function paintLit(root: ParentNode, ayah: string | null): void {
  root.querySelectorAll(".w.lit").forEach((w) => w.classList.remove("lit"));
  if (!ayah || !/^\d{1,3}:\d{1,3}$/.test(ayah)) return;
  root.querySelectorAll(`.w[data-word^="${ayah}:"]`).forEach((w) => w.classList.add("lit"));
}
