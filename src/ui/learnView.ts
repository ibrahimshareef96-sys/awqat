/**
 * The Learn screens: every track this week, one track, the review of the user's own lessons, Home's card, and the sheets
 * for adding. Everything the user typed goes through esc(); no Quran or hadith text is ever shown but what the user wrote.
 */
import {
  ITEM_KINDS, ITEM_KIND_LABEL, LESSON_MAX, MINUTES_MAX, MINUTES_MIN, NAME_MAX, NOTE_MAX, SOURCE_MAX, STATUS_LABEL,
  TRACK_KINDS, TRACK_KIND_LABEL, URL_MAX, WEEKLY_MAX, activeTracks, archivedTracks, formatMinutes, itemOf, nextItem,
  trackItems, trackLessons, trackOf, weekMinutes, weekSessions, weekTarget, type Learn, type LearnItem, type LearnTrack,
} from "../learn/learn.ts";
import { dueLessons } from "../learn/review.ts";
import { esc } from "./html.ts";

export interface LearnModel {
  learn: Learn;
  /** Today in the user's zone, YYYY-MM-DD. */
  today: string;
  /** The item whose Remove was tapped once; a second tap removes it. */
  removeArmed: string | null;
}

export type LearnSheet = "learn-session" | "learn-item" | "learn-lesson" | "learn-track";
const SHEETS: readonly string[] = ["learn-session", "learn-item", "learn-lesson", "learn-track"];
export const isLearnSheet = (sheet: string | null): sheet is LearnSheet => sheet !== null && SHEETS.includes(sheet);

/** A track's lessons shown on its screen; the rest wait for review all the same. */
const LESSONS_SHOWN = 50;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const dateOf = (key: string, options: Intl.DateTimeFormatOptions): string =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
const shortDate = (key: string): string => dateOf(key, { day: "numeric", month: "short" });
const host = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** "1 h 30 min of 4 h", or the minutes alone when there is no target. */
function againstTarget(done: number, target: number): string {
  return `${esc(formatMinutes(done))} <span class="soft">${target ? `of ${esc(formatMinutes(target))}` : "this week"}</span>`;
}

const bar = (done: number, target: number): string => (target
  ? `<span class="bar"><span class="fill" data-w="${Math.min(100, Math.round((done / target) * 100))}"></span></span>` : "");

/** Home's card: the week's study against the targets, and the lessons waiting for review. */
export function homeLearnCard(learn: Learn, today: string): string {
  if (!activeTracks(learn).length) {
    return `<button type="button" class="card link" data-go="learn"><span class="col"><span class="label">LEARN</span>` +
      `<span class="muted">Add what you are learning</span></span></button>`;
  }
  const done = weekMinutes(learn, today);
  const target = weekTarget(learn);
  const due = dueLessons(learn, today).length;
  return `<button type="button" class="card link" data-go="learn"><span class="split"><span class="label">LEARN</span>` +
    `<span class="small">This week</span></span><span class="numeral">${againstTarget(done, target)}</span>` +
    `${bar(done, target)}${due ? `<span class="small">${plural(due, "note")} to review</span>` : ""}</button>`;
}

function nextLine(learn: Learn, t: LearnTrack): string {
  const next = nextItem(learn, t.id);
  if (next) return `Next: ${esc(next.title)}`;
  return trackItems(learn, t.id).length ? "Every item is done" : "No items yet";
}

/** The buttons every track carries, named with the track for a screen reader. */
function trackButtons(t: LearnTrack, withItem: boolean): string {
  const id = esc(t.id);
  const name = esc(t.name);
  return `<div class="row-buttons"><button type="button" class="pill solid" data-action="learn-log" data-value="${id}" ` +
    `aria-label="Log study time for ${name}">Log study time</button>` +
    (withItem ? `<button type="button" class="pill" data-action="learn-add-item" data-value="${id}" ` +
      `aria-label="Add an item to ${name}">Add item</button>` : "") +
    `<button type="button" class="pill" data-action="learn-add-lesson" data-value="${id}" ` +
    `aria-label="Add a lesson to ${name}">Add a lesson</button></div>`;
}

function trackCard(t: LearnTrack, m: LearnModel): string {
  const done = weekMinutes(m.learn, m.today, t.id);
  return `<section class="card"><button type="button" class="track-open" data-go="learn:${esc(t.id)}"><span class="split">` +
    `<span class="label">${esc(t.name)}</span><span class="small">${TRACK_KIND_LABEL[t.kind]}</span></span>` +
    `<span class="numeral">${againstTarget(done, t.weeklyMinutes)}</span>${bar(done, t.weeklyMinutes)}` +
    `<span class="muted">${nextLine(m.learn, t)}</span></button>${trackButtons(t, true)}` +
    `<button type="button" class="link-button" data-action="learn-archive" data-value="${esc(t.id)}" ` +
    `aria-label="Archive ${esc(t.name)}">Archive</button></section>`;
}

function archivedCard(m: LearnModel): string {
  const rows = archivedTracks(m.learn).map((t) => `<li class="row-item"><button type="button" class="link-inline" ` +
    `data-go="learn:${esc(t.id)}">${esc(t.name)}</button><button type="button" class="pill" data-action="learn-archive" ` +
    `data-value="${esc(t.id)}" aria-label="Bring back ${esc(t.name)}">Bring back</button></li>`).join("");
  return rows ? `<section class="card span"><h2 class="label">ARCHIVED</h2><ul class="plain">${rows}</ul></section>` : "";
}

export function learnView(m: LearnModel, header: string, notice: string, chrome: string): string {
  const due = dueLessons(m.learn, m.today).length;
  const review = due ? `<button type="button" class="pill solid wide span" data-go="learn-review">Review ` +
    `${plural(due, "note")}</button>` : "";
  const cards = activeTracks(m.learn).map((t) => trackCard(t, m)).join("") ||
    `<section class="card span"><p class="muted">No tracks yet. Add what you are learning, Islamic or worldly.</p></section>`;
  return `<main class="screen">${header}${notice}${review}${cards}<button type="button" class="pill wide span" ` +
    `data-action="learn-add-track">Add a track</button>${archivedCard(m)}</main>${chrome}`;
}

/** A Delete that asks twice; its name says what it deletes, as every row's button reads the same. */
function deleteButton(action: string, id: string, armed: boolean, what: string): string {
  const word = armed ? "Tap again to delete" : "Delete";
  return `<button type="button" class="link-inline${armed ? " armed" : ""}" data-action="${action}" data-value="${esc(id)}" ` +
    `aria-label="${esc(`${word} ${what}`)}">${word}</button>`;
}

/** The start of a lesson, to name it by. */
const excerpt = (text: string): string => {
  const chars = Array.from(text.replace(/\s+/g, " "));
  return chars.length > 40 ? `${chars.slice(0, 40).join("").trimEnd()}…` : chars.join("");
};

function weekCard(t: LearnTrack, m: LearnModel): string {
  const done = weekMinutes(m.learn, m.today, t.id);
  const rows = weekSessions(m.learn, t.id, m.today).map((s) => {
    const item = itemOf(m.learn, s.itemId);
    const when = `${dateOf(s.date, { weekday: "long" })} · ${formatMinutes(s.minutes)}`;
    return `<li class="row-item"><span class="col grow"><span>${esc(when)}</span>` +
      `${item ? `<span class="small">${esc(item.title)}</span>` : ""}${s.note ? `<span class="small">${esc(s.note)}</span>` : ""}` +
      `</span>${deleteButton("learn-session-remove", s.id, m.removeArmed === s.id, `the study time ${when}`)}</li>`;
  }).join("");
  return `<section class="card"><div class="split"><h2 class="label">THIS WEEK</h2><span class="small">From Monday</span>` +
    `</div><span class="numeral">${againstTarget(done, t.weeklyMinutes)}</span>${bar(done, t.weeklyMinutes)}` +
    `${rows ? `<ul class="plain">${rows}</ul>` : `<p class="small">Nothing logged yet this week.</p>`}` +
    `${trackButtons(t, false)}</section>`;
}

function itemRow(item: LearnItem, m: LearnModel): string {
  const id = esc(item.id);
  const armed = m.removeArmed === item.id;
  const where = item.url ? host(item.url) : "";
  return `<li class="row-item item-row ${esc(item.status)}"><button type="button" class="chip status-chip ${esc(item.status)}` +
    `${item.status === "done" ? " on" : ""}" data-action="learn-item" data-value="${id}" aria-label="${esc(item.title)}: ` +
    `${STATUS_LABEL[item.status].toLowerCase()}. Tap to change.">${STATUS_LABEL[item.status]}</button>` +
    `<span class="col grow"><span class="title">${esc(item.title)}</span><span class="small">` +
    `${ITEM_KIND_LABEL[item.kind]}${where ? ` · ${esc(where)}` : ""}</span><span class="inline">` +
    (item.url ? `<button type="button" class="link-inline" data-action="learn-open" data-value="${id}" ` +
      `aria-label="Open ${esc(item.title)}">Open</button>` : "") +
    `<button type="button" class="link-inline${armed ? " armed" : ""}" data-action="learn-item-remove" data-value="${id}" ` +
    `aria-label="${armed ? "Tap again to remove" : "Remove"} ${esc(item.title)}">${armed ? "Tap again to remove" : "Remove"}` +
    `</button></span></span></li>`;
}

function itemsCard(t: LearnTrack, m: LearnModel): string {
  const items = trackItems(m.learn, t.id);
  const done = items.filter((i) => i.status === "done").length;
  return `<section class="card"><div class="split"><h2 class="label">ITEMS</h2><span class="small">` +
    `${items.length ? `${done} of ${items.length} done` : "None yet"}</span></div>` +
    `${items.length ? `<ul class="plain">${items.map((i) => itemRow(i, m)).join("")}</ul>` : ""}` +
    `<div class="row-buttons"><button type="button" class="pill" data-action="learn-add-item" data-value="${esc(t.id)}" ` +
    `aria-label="Add an item to ${esc(t.name)}">Add item</button></div></section>`;
}

function lessonsCard(t: LearnTrack, m: LearnModel): string {
  const lessons = trackLessons(m.learn, t.id);
  const rows = lessons.slice(0, LESSONS_SHOWN).map((l) => {
    const item = itemOf(m.learn, l.itemId);
    const about = [l.source, item?.title ?? "", `noted ${shortDate(l.date)}`, `review ${shortDate(l.due)}`]
      .filter(Boolean).map(esc).join(" · ");
    return `<li class="row-item"><span class="col grow"><span class="lesson-text">${esc(l.text)}</span>` +
      `<span class="small">${about}</span></span>` +
      `${deleteButton("learn-lesson-remove", l.id, m.removeArmed === l.id, `the lesson ${excerpt(l.text)}`)}</li>`;
  }).join("");
  const more = lessons.length - LESSONS_SHOWN;
  // An archived track's lessons rest with it (learn/review.ts), so the screen does not promise a review.
  const review = t.archived ? "They rest while this track is archived." : "Each comes back for review.";
  const foot = more > 0 ? `And ${more} older. ${review}` : !rows ? `In your own words, one thing at a time. ${review}`
    : t.archived ? review : "";
  return `<section class="card"><h2 class="label">LESSONS</h2>${rows ? `<ul class="plain">${rows}</ul>` : ""}` +
    `${foot ? `<p class="small">${foot}</p>` : ""}` +
    `<div class="row-buttons"><button type="button" class="pill" data-action="learn-add-lesson" data-value="${esc(t.id)}" ` +
    `aria-label="Add a lesson to ${esc(t.name)}">Add a lesson</button></div></section>`;
}

function targetCard(t: LearnTrack): string {
  return `<section class="card"><h2 class="label">WEEKLY TARGET</h2><form class="inline" data-form="learn-target" novalidate>` +
    `<label class="small" for="learn-target">Minutes a week</label><input id="learn-target" class="field small-field" ` +
    `name="minutes" type="number" inputmode="numeric" min="0" max="${WEEKLY_MAX}" step="1" value="${esc(t.weeklyMinutes || "")}">` +
    `<button type="submit" class="pill">Set</button></form><p class="small">${t.weeklyMinutes
      ? `${esc(formatMinutes(t.weeklyMinutes))} a week` : "No weekly target"}</p></section>`;
}

/** Under a track's name: Islamic or worldly, and whether it is archived. */
export function trackSubtitle(t: LearnTrack): string {
  return `${TRACK_KIND_LABEL[t.kind]}${t.archived ? " · archived" : ""}`;
}

export function trackView(t: LearnTrack, m: LearnModel, header: string, notice: string, chrome: string): string {
  return `<main class="screen single">${header}${notice}<button type="button" class="pill solid wide" ` +
    `data-go="mode:study:${esc(t.id)}">Study mode</button>${weekCard(t, m)}${itemsCard(t, m)}${lessonsCard(t, m)}` +
    `${targetCard(t)}</main>${chrome}`;
}

/** One due lesson at a time: where it is from first, the lesson itself folded until the user asks for it. */
export function reviewView(m: LearnModel, header: string, notice: string, chrome: string): string {
  const due = dueLessons(m.learn, m.today);
  const lesson = due[0];
  if (!lesson) {
    return `<main class="screen single">${header}${notice}<section class="card"><p class="text">Nothing to review today.` +
      `</p><p class="small">A lesson comes back the day after you write it, then after 3, 7, 14, 30, 90 and 180 days ` +
      `each time you remember it.</p></section><button type="button" class="pill wide" data-go="learn">Back to Learn` +
      `</button></main>${chrome}`;
  }
  const item = itemOf(m.learn, lesson.itemId);
  const prompt = lesson.source || item?.title || "";
  const about = [lesson.source && item ? item.title : "", `Noted ${shortDate(lesson.date)}`].filter(Boolean).map(esc).join(" · ");
  const id = esc(lesson.id);
  return `<main class="screen single">${header}${notice}<section class="card"><div class="split"><h2 class="label">` +
    `${esc(trackOf(m.learn, lesson.trackId)?.name ?? "")}</h2><span class="small">${due.length} left today</span></div>` +
    `${prompt ? `<p class="review-prompt">${esc(prompt)}</p>` : ""}<p class="small">${about}</p>` +
    `<details class="more" id="reveal-${id}"><summary class="link-button">Show the lesson</summary>` +
    `<p class="text lesson-text">${esc(lesson.text)}</p></details><div class="row-buttons"><button type="button" ` +
    `class="pill solid" data-action="learn-remembered" data-value="${id}">Remembered</button><button type="button" ` +
    `class="pill" data-action="learn-again" data-value="${id}">Again</button></div></section></main>${chrome}`;
}

export interface SheetModel {
  learn: Learn;
  track: LearnTrack | null;
  /** The log sheet came from stopping a timer: the minutes it ran, to correct or keep. */
  minutes: number | null;
}

const SHEET_ERROR = `<p class="sheet-error" data-sheet-error role="alert" hidden></p>`;
const TITLES: Readonly<Record<LearnSheet, string>> = {
  "learn-session": "Log study time", "learn-item": "Add item", "learn-lesson": "Add a lesson", "learn-track": "Add a track",
};

function sheet(kind: LearnSheet, body: string): string {
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="${TITLES[kind]}"><div class="sheet-inner">` +
    `<h2 class="sheet-title">${TITLES[kind]}</h2>${body}${SHEET_ERROR}<button type="button" class="link-button" ` +
    `data-go="close">Cancel</button></div></section>`;
}

/** The track's items to pick from, the one the user is on chosen; `all` includes those already done. */
function itemOptions(m: SheetModel, t: LearnTrack, all: boolean, none: string): string {
  const next = nextItem(m.learn, t.id);
  const items = trackItems(m.learn, t.id).filter((i) => all || i.status !== "done");
  return `<option value="">${esc(none)}</option>` + items.map((i) =>
    `<option value="${esc(i.id)}"${i.id === next?.id ? " selected" : ""}>${esc(i.title)}</option>`).join("");
}

function sessionBody(m: SheetModel, t: LearnTrack): string {
  return `<p class="small">${esc(t.name)} · today</p><form class="stack wide" data-form="learn-session" novalidate>` +
    `<label class="small" for="ls-minutes">Minutes</label><input id="ls-minutes" class="field" name="minutes" ` +
    `type="number" inputmode="numeric" min="${MINUTES_MIN}" max="${MINUTES_MAX}" step="1"` +
    `${m.minutes === null ? "" : ` value="${m.minutes}"`} required data-autofocus>` +
    `<label class="small" for="ls-item">What you studied</label><select id="ls-item" class="field" name="item">` +
    `${itemOptions(m, t, false, "Nothing in particular")}</select><label class="small" for="ls-note">A line about it ` +
    `(optional)</label><input id="ls-note" class="field" name="note" maxlength="${NOTE_MAX}">` +
    `<button type="submit" class="pill solid wide">Save</button></form>`;
}

function itemBody(t: LearnTrack): string {
  return `<p class="small">${esc(t.name)}</p><form class="stack wide" data-form="learn-item" novalidate><label class="small" ` +
    `for="li-title">Title</label><input id="li-title" class="field" name="title" maxlength="${NAME_MAX}" required ` +
    `data-autofocus><label class="small" for="li-kind">Kind</label><select id="li-kind" class="field" name="kind">` +
    ITEM_KINDS.map((k) => `<option value="${k}"${k === "book" ? " selected" : ""}>${ITEM_KIND_LABEL[k]}</option>`).join("") +
    `</select><label class="small" for="li-url">Link (optional, https)</label><input id="li-url" class="field" name="url" ` +
    `type="url" inputmode="url" maxlength="${URL_MAX}" autocapitalize="off" autocorrect="off" spellcheck="false" ` +
    `placeholder="https://"><button type="submit" class="pill solid wide">Add to ${esc(t.name)}</button></form>`;
}

function lessonBody(m: SheetModel, t: LearnTrack): string {
  const example = t.kind === "islamic" ? "For example Al-Baqarah 255, or your teacher's lesson" : "For example a page or a lecture";
  return `<p class="small">${esc(t.name)}</p><form class="stack wide" data-form="learn-lesson" novalidate><label class="small" ` +
    `for="ll-text">What you learned, in your own words</label><textarea id="ll-text" class="field area" name="text" ` +
    `maxlength="${LESSON_MAX}" rows="5" required data-autofocus></textarea><label class="small" for="ll-source">Where it ` +
    `is from (optional)</label><input id="ll-source" class="field" name="source" maxlength="${SOURCE_MAX}" ` +
    `placeholder="${esc(example)}"><label class="small" for="ll-item">From</label><select id="ll-item" class="field" ` +
    `name="item">${itemOptions(m, t, true, "No particular item")}</select><button type="submit" class="pill solid wide">` +
    `Save the lesson</button></form>`;
}

function trackBody(): string {
  return `<form class="stack wide" data-form="learn-track" novalidate><label class="small" for="lt-name">Name</label><input ` +
    `id="lt-name" class="field" name="name" maxlength="${NAME_MAX}" required data-autofocus><label class="small" ` +
    `for="lt-kind">Kind</label><select id="lt-kind" class="field" name="kind">` +
    TRACK_KINDS.map((k) => `<option value="${k}">${TRACK_KIND_LABEL[k]}</option>`).join("") +
    `</select><label class="small" for="lt-minutes">Minutes a week (optional)</label><input id="lt-minutes" class="field" ` +
    `name="minutes" type="number" inputmode="numeric" min="0" max="${WEEKLY_MAX}" step="1"><button type="submit" ` +
    `class="pill solid wide">Add the track</button></form>`;
}

/** The sheet for adding to Learn; a track that has gone meanwhile (another device) says so instead. */
export function learnSheet(kind: LearnSheet, m: SheetModel): string {
  if (kind === "learn-track") return sheet(kind, trackBody());
  const t = m.track;
  if (!t) return sheet(kind, `<p class="text">That track is no longer here.</p>`);
  if (kind === "learn-session") return sheet(kind, sessionBody(m, t));
  if (kind === "learn-item") return sheet(kind, itemBody(t));
  return sheet(kind, lessonBody(m, t));
}
