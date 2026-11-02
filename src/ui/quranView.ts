/** The Quran tracker screen: your place in a full reading, today's pages, revision by juz, and study. */
import { PAGES } from "../quran/data.ts";
import { bookmarkPage } from "../quran/bookmark.ts";
import { DAILY_GOAL_MAX, finishDate, lastRevised, pageLabel, pagesOn, readingStreak, shiftDay, type QuranLog } from "../quran/log.ts";
import { notesList, type MushafMarks } from "../quran/marks.ts";
import type { MurajaahPlan } from "../quran/murajaah.ts";
import { deviceWord } from "./deviceWord.ts";
import { esc } from "./html.ts";
import { murajaahCard } from "./murajaahView.ts";

export interface QuranModel {
  quran: QuranLog;
  /** Today's calendar date, YYYY-MM-DD. */
  date: string;
  notice: string;
  /** Undo was tapped once and waits for the second tap. */
  undoArmed: boolean;
  marks: MushafMarks;
  /** While the whole mushaf's script is being kept on the phone. */
  download: { done: number; total: number } | null;
  plan: MurajaahPlan | null;
}


export function quranSummary(q: QuranLog, date: string): { page: number; label: string; today: number; streak: number } {
  const page = q.position;
  return { page, label: page > 0 ? pageLabel(page) : "Not started", today: pagesOn(q, date), streak: readingStreak(q, date) };
}

function readingCard(m: QuranModel): string {
  const s = quranSummary(m.quran, m.date);
  const percent = Math.round((s.page / PAGES) * 100);
  const next = Math.min(PAGES, s.page + 1);
  // The mushaf opens where the user stopped reading (its bookmark), which may be ahead of the place the user has logged.
  const open = bookmarkPage(m.marks, m.quran);
  const quick = [1, 2, 5, 10].map((n) => `<button type="button" class="chip" data-action="quran-plus" data-value="${n}" ` +
    `aria-label="Read ${n} more page${n > 1 ? "s" : ""}">+${n}</button>`).join("");
  return `<section class="card"><button type="button" class="pill solid wide" data-go="mushaf">Open the mushaf ` +
    `<span class="soft">· p. ${open}</span></button><div class="split"><h2 class="label">READING</h2><span class="small">` +
    `${m.quran.completed > 0 ? `${m.quran.completed} complete reading${m.quran.completed > 1 ? "s" : ""}` : `${percent}%`}` +
    `</span></div><div class="big">Page ${s.page} <span class="soft">of ${PAGES}</span></div>` +
    `<p class="muted">${esc(s.label)}</p><div class="bar"><div class="fill" data-w="${percent}"></div></div>` +
    `<div class="chips start">${quick}</div><form class="inline" data-form="quran-read"><label class="small" for="to-page">` +
    `I read up to page</label><input id="to-page" class="field small-field" name="page" type="number" inputmode="numeric" ` +
    `min="${next}" max="${PAGES}" value="${next}" required><button type="submit" class="pill solid">Save</button></form>` +
    undoButton(m) + placeForm(m) + `</section>`;
}

function undoButton(m: QuranModel): string {
  const reads = m.quran.entries.filter((e) => e.kind === "read");
  const last = reads[reads.length - 1];
  if (!last || last.kind !== "read") return "";
  const what = last.fromPage === last.toPage ? `page ${last.toPage}` : `pages ${last.fromPage} to ${last.toPage}`;
  return `<button type="button" class="link-button${m.undoArmed ? " armed" : ""}" data-action="quran-undo">` +
    `${m.undoArmed ? `Tap again to undo ${what}` : "Undo the last reading"}</button>`;
}

/** For a reading begun before the app: move your place without counting those pages as read today. */
function placeForm(m: QuranModel): string {
  return `<details class="more" id="set-place"><summary class="link-button">Already partway? Set your place</summary>` +
    `<form class="inline" data-form="quran-place"><label class="small" for="place-page">I'm on page</label>` +
    `<input id="place-page" class="field small-field" name="page" type="number" inputmode="numeric" min="0" ` +
    `max="${PAGES - 1}" value="${m.quran.position}" required><button type="submit" class="pill">Set</button></form>` +
    `<p class="small">Moves your place only. Today's pages and your streak stay as they are.</p></details>`;
}

function weekCard(m: QuranModel): string {
  const s = quranSummary(m.quran, m.date);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(m.date, i - 6));
  const counts = days.map((d) => pagesOn(m.quran, d));
  const top = Math.max(5, ...counts);
  const weekday = (d: string, style: "short" | "long") =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: style, timeZone: "UTC" });
  const letter = (d: string) => weekday(d, "short").slice(0, 2);
  const bars = days.map((d, i) => `<div class="bar-col" role="img" aria-label="${esc(weekday(d, "long"))}: ` +
    `${counts[i]} page${counts[i] === 1 ? "" : "s"}">` +
    `<div class="vbar"><div class="vfill" data-h="${Math.round((counts[i] / top) * 100)}"></div></div>` +
    `<span class="mono">${esc(letter(d))}</span></div>`).join("");
  const goal = m.quran.dailyGoal;
  return `<section class="card"><div class="split"><h2 class="label">TODAY</h2><span class="small">` +
    `${s.streak > 0 ? `${s.streak} day${s.streak > 1 ? "s" : ""} in a row` : "Start a streak today"}</span></div>` +
    `<div class="big">${s.today} <span class="soft">${goal > 0 ? `of ${goal} ` : ""}page${(goal || s.today) === 1 ? "" : "s"}` +
    `</span></div>${goal > 0 ? `<div class="bar"><div class="fill" data-w="${Math.min(100, Math.round((s.today / goal) * 100))}">` +
    `</div></div>` : ""}<div class="bars">${bars}</div>${finishLine(m)}${goalForm(m)}</section>`;
}

/** When this reading ends, at the goal or at the last two weeks' pace. */
function finishLine(m: QuranModel): string {
  const finish = finishDate(m.quran, m.date);
  if (!finish) return "";
  const day = new Date(`${finish.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long",
    year: "numeric", timeZone: "UTC" });
  return `<p class="small">${finish.basis === "goal" ? "At your goal" : "At your pace of the last two weeks"}, this ` +
    `reading ends on ${esc(day)}.</p>`;
}

function goalForm(m: QuranModel): string {
  return `<details class="more" id="quran-goal"><summary class="link-button">${m.quran.dailyGoal > 0 ? "Change your daily goal"
    : "Set a daily goal"}</summary><form class="inline" data-form="quran-goal"><label class="small" for="goal-pages">` +
    `Pages a day</label><input id="goal-pages" class="field small-field" name="pages" type="number" inputmode="numeric" ` +
    `min="0" max="${DAILY_GOAL_MAX}" value="${m.quran.dailyGoal || ""}" placeholder="4"><button type="submit" class="pill">` +
    `Set</button></form><p class="small">0 clears it. Four pages a day finishes the Quran in about five months.</p></details>`;
}

function revisionCard(m: QuranModel): string {
  const last = lastRevised(m.quran);
  const weekAgo = shiftDay(m.date, -7);
  const cells = Array.from({ length: 30 }, (_, i) => {
    const juz = i + 1;
    const when = last[juz];
    const state = !when ? "" : when === m.date ? "today" : when >= weekAgo ? "week" : "older";
    const said = !when ? "not revised yet" : when === m.date ? "revised today" : `last revised ${when}`;
    return `<button type="button" class="juz ${state}" data-action="quran-juz" data-value="${juz}" ` +
      `aria-label="Juz ${juz}, ${esc(said)}" aria-pressed="${state === "today"}">${juz}</button>`;
  }).join("");
  return `<section class="card"><div class="split"><h2 class="label">REVISION</h2><span class="small">Tap what you ` +
    `revised today</span></div><div class="juz-grid">${cells}</div><p class="small">Brighter means more recent.</p></section>`;
}

function studyCard(m: QuranModel): string {
  const studies = m.quran.entries.filter((e) => e.kind === "study").slice(-5).reverse();
  const list = studies.map((e) => e.kind !== "study" ? "" : `<li class="row-item"><div class="col"><span>${esc(e.text)}</span>` +
    `<span class="small">${esc(e.date)}${e.minutes ? ` · ${e.minutes} min` : ""}</span></div><button type="button" ` +
    `class="round small-round" data-action="study-delete" data-value="${esc(e.id)}" aria-label="Delete this study session">` +
    `×</button></li>`).join("");
  return `<section class="card"><h2 class="label">TAFSIR AND STUDY</h2><form class="stack" data-form="quran-study">` +
    `<label class="small" for="study-text">What did you study?</label><input id="study-text" class="field" name="text" ` +
    `maxlength="160" placeholder="Tafsir of Surah Al-Kahf, ayat 1 to 10" required><div class="inline"><label class="small" ` +
    `for="study-minutes">Minutes</label><input id="study-minutes" class="field small-field" name="minutes" type="number" ` +
    `inputmode="numeric" min="0" max="600" value="20"><button type="submit" class="pill solid">Save</button></div></form>` +
    (list ? `<ul class="plain">${list}</ul>` : "") + `</section>`;
}

const KIND_LABEL = { page: "Page note", ayah: "Ayah", mistake: "Mistake" } as const;

/** Rows shown before "Show all": the rest stay one tap away, never dropped. */
const NOTES_FIRST = 40;

function noteRows(entries: ReturnType<typeof notesList>): string {
  return entries.map((e) => `<li><button type="button" class="row-item note-row" data-go="mushaf:${e.page}">` +
    `<span class="col grow"><span class="small">p. ${e.page} · ${esc(KIND_LABEL[e.kind])}${e.kind === "page" ? "" : ` ${esc(e.key)}`}` +
    `</span><span>${esc(e.text)}</span></span></button></li>`).join("");
}

/** Every mistake and note from the mushaf, page by page; each opens its page. */
function notesCard(m: QuranModel): string {
  const entries = notesList(m.marks);
  const rest = entries.slice(NOTES_FIRST);
  return `<section class="card"><div class="split"><h2 class="label">REVISION NOTES</h2><span class="small">` +
    `${entries.length ? `${entries.length}` : ""}</span></div>` +
    (entries.length ? `<ul class="plain">${noteRows(entries.slice(0, NOTES_FIRST))}</ul>` : `<p class="muted">In the ` +
      `mushaf, tap any word to mark a mistake or write a note on its ayah. They gather here, page by page.</p>`) +
    (rest.length ? `<details class="more" id="notes-more"><summary class="link-button">Show all ${entries.length}` +
      `</summary><ul class="plain">${noteRows(rest)}</ul></details>` : "") + `</section>`;
}

function offlineCard(m: QuranModel): string {
  if (m.download) {
    const pct = Math.round((m.download.done / Math.max(1, m.download.total)) * 100);
    return `<section class="card" aria-live="polite"><p class="small">Keeping the mushaf on this ${deviceWord()}: ${m.download.done} ` +
      `of ${m.download.total} pages</p><div class="bar"><div class="fill" data-w="${pct}"></div></div></section>`;
  }
  return `<button type="button" class="link-button" data-action="mushaf-download">Ready the whole mushaf for offline ` +
    `(about 95 MB)</button>`;
}

export function quranView(m: QuranModel, header: string, notice: string, chrome: string): string {
  const plan = murajaahCard({ plan: m.plan, quran: m.quran, marks: m.marks, date: m.date });
  return `<main class="screen">${header}${notice}${readingCard(m)}${plan}${notesCard(m)}${weekCard(m)}${revisionCard(m)}` +
    `${studyCard(m)}${offlineCard(m)}<p class="foot">Mushaf: the King Fahd Complex 1421 print (QPC V2), with fonts, ` +
    `words and page map from Quran Foundation (Quran.com) · surah names and juz: Tanzil (CC BY)</p></main>${chrome}`;
}
