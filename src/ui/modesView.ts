/**
 * The modes: the prompt on Home and Faith for what is open now, the list of them all, one Islamic mode's steps, and one
 * study. Du'a words come from the generated data or from the user; Quran is only named, and opened in the mushaf.
 */
import { formatMinutes, nextItem, trackItems, weekMinutes, type Learn, type LearnTrack } from "../learn/learn.ts";
import { dueLessons } from "../learn/review.ts";
import {
  AFTER_CHOICES, OWN_NAME_MAX, OWN_TEXT_MAX, placeKey, placeOf, runningMinutes, studyAfter, type ModeId, type ModeLog,
  type ModeWindow, type StudyAfter,
} from "../modes/modes.ts";
import {
  ISLAMIC_MODES, defOf, nextStep, ownSteps, stepDone, stepProgress, suraPages, type ModeContext, type ModeDef, type Step,
} from "../modes/registry.ts";
import { WORKOUT_TIMER } from "../app/live.ts";
import { counterRow } from "./adhkarView.ts";
import type { AdhkarLog } from "../faith/adhkar.ts";
import { SESSION_NAME, type Session } from "../faith/adhkar.ts";
import type { FridayLog } from "../faith/friday.ts";
import { PRAYER_LABEL, formatTime, type DayTimes, type PrayerName } from "../prayer/times.ts";
import { esc, icon } from "./html.ts";

export interface ModesModel {
  log: ModeLog;
  friday: FridayLog;
  adhkar: AdhkarLog;
  learn: Learn;
  now: Date;
  tz: string;
  /** Today in the user's zone, YYYY-MM-DD. */
  today: string;
  /** What is open by itself now, whether or not the user put it off. */
  open: readonly ModeWindow[];
  /** What is open and still asks for the user. */
  waiting: readonly ModeWindow[];
  /** The prayer day on screen. */
  day: DayTimes;
  /** The id of the du'a whose Remove was tapped once. */
  removeArmed: string | null;
  /** This device can count on the lock screen, and the user has not turned that off. */
  live?: boolean;
  /** What is being counted there now (live.ts dhikrKey). */
  liveKey?: string | null;
}

const SESSION_AR: Readonly<Record<Session, string>> = { morning: "أذكار الصباح", evening: "أذكار المساء" };

const contextFor = (m: ModesModel, date: string | null): ModeContext => ({ log: m.log, friday: m.friday, adhkar: m.adhkar, date });

/** The window a mode is open in now, if it is. */
const windowOf = (m: ModesModel, mode: string): ModeWindow | undefined => m.open.find((w) => w.mode === mode);

/** The date a mode's counts go on: its open window's; Istikhara and the prayers' views count on the day on screen. */
export function occasionOf(m: Pick<ModesModel, "open" | "day">, mode: ModeId): string | null {
  const w = m.open.find((x) => x.mode === mode);
  if (w) return w.date;
  return mode === "jumuah" ? null : m.day.date;
}

/** "On p. 297, 8 pages to go", or the whole reading before it has begun. */
function readLine(step: Extract<Step, { kind: "read" }>, log: ModeLog, date: string | null): string {
  const pages = suraPages(step.sura);
  if (!pages) return "";
  const at = date ? placeOf(log, placeKey(step.sura, date)) : null;
  const total = pages.last - pages.first + 1;
  if (at === null) return `${total} pages, p. ${pages.first} to ${pages.last}`;
  const left = pages.last - at;
  return left > 0 ? `On p. ${at}, ${left} page${left === 1 ? "" : "s"} to go` : `On p. ${at}, the last page`;
}

/** What the prompt says to pick up, and what its button says. */
function promptFor(step: Step | null, c: ModeContext): { title: string; line: string; pick: string } {
  if (!step) return { title: "", line: "", pick: "Open" };
  if (step.kind === "read") return { title: step.name, line: readLine(step, c.log, c.date), pick: "Pick it up" };
  if (step.kind === "adhkar") return { title: SESSION_NAME[step.session], line: "", pick: "Open" };
  return { title: step.name, line: "", pick: "Open" };
}

function islamicPrompt(def: ModeDef, w: ModeWindow, m: ModesModel, rest: string): string {
  const c = contextFor(m, w.date);
  const { title, line, pick } = promptFor(nextStep(def, c), c);
  const until = w.mode === "jumuah" ? `until Maghrib ${formatTime(w.end, m.tz)}`
    : w.mode === "fajr" ? `sunrise ${formatTime(m.day.sunrise, m.tz)}`
      : w.mode === "maghrib" ? `until Isha ${formatTime(w.end, m.tz)}` : `until ${formatTime(w.end, m.tz)}`;
  return `<section class="card mode-now mode-${esc(w.mode)}" aria-label="${esc(def.name)}"><div class="split">` +
    `<h2 class="label accent">${esc(def.name.toUpperCase())}</h2><span class="small">${esc(until)}</span></div>` +
    `<p class="display">${esc(title)}</p>${line ? `<p class="small">${esc(line)}</p>` : ""}<div class="row-buttons">` +
    `<button type="button" class="pill solid" data-action="mode-pick" data-value="${esc(w.mode)}">${esc(pick)}</button>` +
    `${pick === "Open" ? "" : `<button type="button" class="pill" data-go="mode:${esc(w.mode)}">See it all</button>`}` +
    `<button type="button" class="ghost-link" data-action="mode-not-now" data-value="${esc(w.mode)}">Not now</button></div>${rest}</section>`;
}

function studyPrompt(track: LearnTrack, w: ModeWindow, m: ModesModel, rest: string): string {
  const item = nextItem(m.learn, track.id);
  const week = weekMinutes(m.learn, m.today, track.id);
  return `<section class="card mode-now" aria-label="${esc(track.name)}"><div class="split"><h2 class="label">` +
    `${esc(track.name.toUpperCase())}</h2><span class="small">${esc(weekLine(week, track.weeklyMinutes))}</span></div>` +
    `<p class="display">${esc(item?.title ?? "Study time")}</p><div class="row-buttons"><button type="button" class="pill solid" ` +
    `data-go="mode:study:${esc(track.id)}">Open</button><button type="button" class="ghost-link" data-action="mode-not-now" ` +
    `data-value="${esc(w.mode)}">Not now</button></div>${rest}</section>`;
}

const weekLine = (minutes: number, target: number): string =>
  target > 0 ? `${formatMinutes(minutes)} of ${formatMinutes(target)} this week` : `${formatMinutes(minutes)} this week`;

const modeTitle = (w: ModeWindow, m: ModesModel): string =>
  defOf(w.mode)?.name ?? m.learn.tracks.find((t) => `study:${t.id}` === w.mode)?.name ?? "";

/** Home and Faith: the first thing waiting in full, and a line for anything else open with it. */
export function modePrompts(m: ModesModel): string {
  const [first, ...others] = m.waiting;
  if (!first) return "";
  const rest = others.length === 0 ? "" : `<div class="mode-also">${others.map((w) => `<button type="button" class="ghost-link" ` +
    `data-go="mode:${esc(w.mode)}">Also now: ${esc(modeTitle(w, m))}</button>`).join("")}</div>`;
  const def = defOf(first.mode);
  if (def) return islamicPrompt(def, first, m, rest);
  const track = m.learn.tracks.find((t) => `study:${t.id}` === first.mode);
  return track ? studyPrompt(track, first, m, rest) : "";
}

function listRow(mode: string, title: string, sub: string, open: boolean): string {
  return `<li><button type="button" class="row-item mode-row" data-go="mode:${esc(mode)}"><span class="col grow">` +
    `<span class="check-name">${esc(title)}</span><span class="small">${esc(sub)}</span></span>` +
    `${open ? `<span class="label accent">NOW</span>` : ""}</button></li>`;
}

function studyWhen(log: ModeLog, trackId: string): string {
  const after = studyAfter(log, trackId);
  return after === "off" ? "When you open it" : `By itself, after ${PRAYER_LABEL[after]}`;
}

function studyRows(m: ModesModel, kind: LearnTrack["kind"]): string {
  return m.learn.tracks.filter((t) => t.kind === kind && !t.archived).map((t) =>
    listRow(`study:${t.id}`, t.name, studyWhen(m.log, t.id), windowOf(m, `study:${t.id}`) !== undefined)).join("");
}

/** Every mode: some open by themselves, the rest when the user opens them. */
export function modesListView(m: ModesModel, head: string, notice: string, chrome: string): string {
  const worship = ISLAMIC_MODES.map((d) => listRow(d.id, d.name, d.when, windowOf(m, d.id) !== undefined)).join("");
  const section = (title: string, rows: string) => (rows ? `<section class="card" aria-label="${esc(title)}"><h2 class="label">` +
    `${esc(title.toUpperCase())}</h2><ul class="plain">${rows}</ul></section>` : "");
  const review = `<li><button type="button" class="row-item mode-row" data-go="review"><span class="col grow"><span class="check-name">Weekly Review</span>` +
    `<span class="small">When you open it</span></span></button></li>`;
  return `<main class="screen single">${head}${notice}${section("Worship", worship)}` +
    `<section class="card" aria-label="Your week"><ul class="plain">${review}</ul></section>` +
    `${section("Worldly knowledge", studyRows(m, "worldly"))}${section("Islamic knowledge", studyRows(m, "islamic"))}` +
    `<p class="foot">Add a subject in Learn and it gets a mode here. A reading in a mode never moves your place in the mushaf.</p>` +
    `</main>${chrome}`;
}

/** The counter card, as the adhkar lists have it: a tap on the words counts, Done says it in full. */
function counted(step: Extract<Step, { kind: "dua" | "quran" | "page" }>, mode: ModeId, c: ModeContext, m: ModesModel): string {
  const { n, of } = stepProgress(mode, step, c);
  const done = n >= of;
  const off = c.date === null;
  const name = esc(step.name);
  const words = step.kind === "dua" ? `<span class="dhikr-ar" lang="ar" dir="rtl">${esc(step.text)}</span>`
    : step.kind === "page" ? `<img class="dhikr-page" src="${esc(step.picture)}" width="${step.width}" height="${step.height}" alt="${esc(step.alt)}" loading="lazy" draggable="false">`
      : "";
  const hint = step.kind === "dua" && step.hint ? `<span class="small">${esc(step.hint)}</span>` : "";
  const own = step.kind === "dua" && step.own;
  const armed = m.removeArmed === step.id;
  const remove = own ? `<button type="button" class="ghost-link" data-action="mode-dua-remove" data-value="${esc(step.id)}" ` +
    `aria-label="${armed ? "Tap again to remove" : "Remove"}: ${name}">${armed ? "Tap again to remove" : "Remove"}</button>` : "";
  // Quran is named and opened, never shown: what is on the card can never be taken for the words themselves.
  const top = step.kind === "quran" ? `<span class="label">QURAN</span><h3 class="dhikr-quran-name">${name}</h3><p class="dhikr-quran">` +
    `${esc(step.where)}. Read it from the mushaf, then count it here.</p><button type="button" class="pill solid wide dhikr-read" ` +
    `data-action="mode-quran" data-value="${esc(step.id)}" aria-label="Read ${name}, page ${step.page}">Read it on p. ${step.page}</button>`
    : `<button type="button" class="dhikr-tap" data-action="mode-count" data-value="${esc(step.id)}"${done || off ? ' aria-disabled="true"' : ""}>` +
      `<span class="dhikr-name">${name}</span>${words}${hint}<span class="sr-only">Tap to count</span></button>`;
  const foot = off ? "" : `<div class="dhikr-foot">${counterRow({ action: "mode-count", value: step.id, n, of, name: step.name }, "mode-back", "mode-done")}</div>`;
  // Only where there is a count to keep going: a step said once is done with one tap here.
  const counting = m.liveKey === `${mode}|${c.date}|${step.id}`;
  const live = m.live && !off && !done && of > 1 ? `<div class="dhikr-remove"><button type="button" class="ghost-link" data-action="mode-live" data-value="${esc(step.id)}" ` +
    `aria-pressed="${counting}" aria-label="${counting ? "Stop counting" : "Count"} on the lock screen: ${name}">${counting ? "Stop on the lock screen" : "Count on the lock screen"}</button></div>` : "";
  return `<li class="card dhikr${done ? " done" : ""}" data-step="${esc(step.id)}">${top}${foot}${live}` +
    `${remove ? `<div class="dhikr-remove">${remove}</div>` : ""}` +
    `<details class="dhikr-source" id="mode-source-${esc(step.id)}"><summary>Source<span class="sr-only"> of ${name}</span></summary>` +
    `<p class="source">${esc(step.source)}</p></details></li>`;
}

function tick(on: boolean): string {
  return `<span class="tick ${on ? "on" : ""}" aria-hidden="true">${on ? icon("check", 14) : ""}</span>`;
}

function fridayStep(step: Extract<Step, { kind: "read" | "friday" }>, c: ModeContext): string {
  const on = c.date !== null && c.friday.days[c.date]?.[step.id] === true;
  const off = c.date === null;
  const line = step.kind === "read" ? readLine(step, c.log, c.date) : "";
  const read = step.kind === "read" ? `<button type="button" class="pill${on ? "" : " solid"}" data-action="mode-read" ` +
    `data-value="${esc(step.id)}">${line.startsWith("On p.") ? "Pick it up" : "Read"}</button>` : "";
  return `<li class="check-row"><button type="button" class="check" data-action="friday" data-value="${esc(step.id)}" ` +
    `aria-pressed="${on}"${off ? ' aria-disabled="true"' : ""}>${tick(on)}<span class="col"><span class="check-name">${esc(step.name)}` +
    `</span>${line ? `<span class="small">${esc(line)}</span>` : ""}<span class="source">${esc(step.source)}</span></span></button>${read}</li>`;
}

function adhkarStep(step: Extract<Step, { kind: "adhkar" }>, mode: ModeId, c: ModeContext): string {
  const { n, of } = stepProgress(mode, step, c);
  return `<li><button type="button" class="card link adhkar" data-go="adhkar:${step.session}"><span class="split"><span class="label">` +
    `${esc(SESSION_NAME[step.session].toUpperCase())}</span><span class="small">${n} of ${of}</span></span>` +
    `<span class="adhkar-title" lang="ar" dir="rtl">${SESSION_AR[step.session]}</span></button></li>`;
}

/** "In 34 min", or nothing once the sun is up. */
function sunriseLine(m: ModesModel): string {
  const left = Math.round((m.day.sunrise.getTime() - m.now.getTime()) / 60000);
  const at = `Sunrise ${formatTime(m.day.sunrise, m.tz)}`;
  if (left <= 0) return `${at}. The sun is up: time for the two rak'ahs once it has risen a little.`;
  return left < 60 ? `${at}, in ${left} min` : at;
}

function sunnahStep(step: Extract<Step, { kind: "sunnah" }>, mode: ModeId, c: ModeContext, m: ModesModel): string {
  const on = stepDone(mode, step, c);
  const off = c.date === null;
  return `<li class="check-row"><button type="button" class="check" data-action="mode-done" data-value="${esc(step.id)}" ` +
    `aria-pressed="${on}"${off ? ' aria-disabled="true"' : ""}>${tick(on)}<span class="col"><span class="check-name">${esc(step.name)}` +
    `</span><span class="small">${esc(step.sunrise ? sunriseLine(m) : step.detail)}</span><span class="source">${esc(step.source)}` +
    `</span></span></button></li>`;
}

function stepHtml(step: Step, mode: ModeId, c: ModeContext, m: ModesModel): string {
  if (step.kind === "read" || step.kind === "friday") return fridayStep(step, c);
  if (step.kind === "adhkar") return adhkarStep(step, mode, c);
  if (step.kind === "sunnah") return sunnahStep(step, mode, c, m);
  return counted(step, mode, c, m);
}

const listClass = (steps: readonly Step[]): string =>
  steps.every((s) => s.kind === "read" || s.kind === "friday" || s.kind === "sunnah") ? "plain checks card" : "plain dhikr-list";

function groupHtml(title: string, steps: readonly Step[], mode: ModeId, c: ModeContext, m: ModesModel): string {
  return `<h2 class="label mode-group">${esc(title.toUpperCase())}</h2><ol class="${listClass(steps)}">` +
    `${steps.map((s) => stepHtml(s, mode, c, m)).join("")}</ol>`;
}

export function modeView(def: ModeDef, m: ModesModel, head: string, notice: string, chrome: string, top = ""): string {
  const date = occasionOf(m, def.id);
  const c = contextFor(m, date);
  const closed = date === null ? `<p class="small">This opens at Maghrib on Thursday. You can read it now; ticks start then.</p>` : "";
  const own = ownSteps(def, m.log);
  return `<main class="screen single mode-screen mode-${esc(def.id)}">${head}${notice}${closed}${top}` +
    def.groups.map((g) => groupHtml(g.title, g.steps, def.id, c, m)).join("") +
    (own.length > 0 ? groupHtml("Your du'as", own, def.id, c, m) : "") +
    `<button type="button" class="pill mode-add" data-action="mode-dua-add" data-value="${esc(def.id)}">Add a du'a</button>` +
    `</main>${chrome}`;
}

function nextCard(t: LearnTrack, m: ModesModel): string {
  const item = nextItem(m.learn, t.id);
  if (!item) {
    return `<section class="card"><h2 class="label">NEXT</h2><p class="text">${trackItems(m.learn, t.id).length > 0
      ? "Everything on this list is done." : "Nothing on this list yet."}</p><div class="row-buttons"><button type="button" ` +
      `class="pill" data-action="learn-add-item" data-value="${esc(t.id)}">Add an item</button></div></section>`;
  }
  const open = item.url ? `<button type="button" class="pill solid" data-action="learn-open" data-value="${esc(item.id)}">Open it</button>` : "";
  const status = item.status === "doing" ? "Mark it done" : "Start it";
  return `<section class="card"><h2 class="label">NEXT</h2><p class="title">${esc(item.title)}</p><div class="row-buttons">${open}` +
    `<button type="button" class="pill" data-action="learn-item" data-value="${esc(item.id)}">${status}</button></div></section>`;
}

function timerCard(t: LearnTrack, m: ModesModel): string {
  const running = m.log.timer?.trackId === t.id;
  const other = m.log.timer && !running
    ? (m.log.timer.trackId === WORKOUT_TIMER ? { name: "Your workout" } : m.learn.tracks.find((x) => x.id === m.log.timer?.trackId)) : undefined;
  const week = weekLine(weekMinutes(m.learn, m.today, t.id), t.weeklyMinutes);
  if (running) {
    return `<section class="card" aria-label="Study time"><div class="split"><h2 class="label accent">STUDYING</h2>` +
      `<span class="small">${esc(week)}</span></div><p class="numeral" role="timer">${esc(formatMinutes(runningMinutes(m.log, m.now.getTime())))}</p>` +
      `<div class="row-buttons"><button type="button" class="pill solid" data-action="mode-timer-stop" data-value="${esc(t.id)}">Stop and log</button>` +
      `<button type="button" class="ghost-link" data-action="mode-timer-drop">${m.removeArmed === "timer" ? "Tap again to let it go" : "Let it go"}` +
      `</button></div></section>`;
  }
  return `<section class="card" aria-label="Study time"><div class="split"><h2 class="label">STUDY TIME</h2>` +
    `<span class="small">${esc(week)}</span></div>${other ? `<p class="small">${esc(other.name)} is being timed. Starting here stops it without logging.</p>` : ""}` +
    `<div class="row-buttons"><button type="button" class="pill solid" data-action="mode-timer-start" data-value="${esc(t.id)}">Start</button>` +
    `<button type="button" class="pill" data-action="learn-log" data-value="${esc(t.id)}">Log time</button></div></section>`;
}

function keepCard(t: LearnTrack, m: ModesModel): string {
  const due = dueLessons(m.learn, m.today).filter((l) => l.trackId === t.id).length;
  return `<section class="card"><h2 class="label">KEEP IT</h2><div class="row-buttons"><button type="button" class="pill" ` +
    `data-action="learn-add-lesson" data-value="${esc(t.id)}">Write what you learned</button>` +
    `${due > 0 ? `<button type="button" class="pill solid" data-go="learn-review">Review ${due} due</button>` : ""}</div>` +
    `<button type="button" class="ghost-link" data-go="learn:${esc(t.id)}">The whole list</button></section>`;
}

function whenCard(t: LearnTrack, m: ModesModel): string {
  const after = studyAfter(m.log, t.id);
  const label = (choice: StudyAfter) => (choice === "off" ? "Only when I open it" : `After ${PRAYER_LABEL[choice as PrayerName]}`);
  return `<section class="card"><label class="label" for="mode-after">COMES UP BY ITSELF</label><select id="mode-after" class="field" ` +
    `data-field="mode-study-after" data-track="${esc(t.id)}">${AFTER_CHOICES.map((c) => `<option value="${c}"${c === after ? " selected" : ""}>` +
    `${esc(label(c))}</option>`).join("")}</select></section>`;
}

/** One subject's study: what is next, the time, what to keep, and when it comes up. */
export function studyView(t: LearnTrack, m: ModesModel, head: string, notice: string, chrome: string): string {
  return `<main class="screen single mode-screen">${head}${notice}${timerCard(t, m)}${nextCard(t, m)}${keepCard(t, m)}${whenCard(t, m)}` +
    `</main>${chrome}`;
}

/** The sheet for adding a du'a in the user's own words. */
export function duaSheet(def: ModeDef): string {
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Add a du'a"><div class="sheet-inner"><h2 class="title wide">Add a du'a</h2>` +
    `<p class="small">${esc(def.name)}. Paste it as you read it: the app shows your words exactly.</p>` +
    `<p class="sheet-error" data-sheet-error role="alert" hidden></p><form class="stack wide" data-form="mode-dua" novalidate>` +
    `<label class="small" for="md-name">Name</label><input id="md-name" class="field" name="name" maxlength="${OWN_NAME_MAX}" data-autofocus>` +
    `<label class="small" for="md-text">The du'a</label><textarea id="md-text" class="field area dua-field" name="text" lang="ar" dir="auto" ` +
    `maxlength="${OWN_TEXT_MAX}" rows="7" required></textarea><button type="submit" class="pill solid wide">Save</button></form>` +
    `<button type="button" class="link-button" data-go="close">Close</button></div></section>`;
}
