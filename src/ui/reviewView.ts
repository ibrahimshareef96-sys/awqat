/**
 * The Weekly Review, which the user opens: four short steps on one screen (look back on the week's numbers, reflect on
 * three questions, set up to three intentions, look ahead at the next seven days), then the past weeks to read back.
 * Also the morning brief at the top of the Fajr view, Home's card for the week's intentions, and the reminder's fields
 * in Settings. Nothing here is a score.
 */
import { formatMinutes } from "../learn/learn.ts";
import {
  INTENTIONS_MAX, INTENTION_MAX, PROMPTS, PROMPT_KEYS, REFLECTION_MAX, type Intention, type ReviewDraft, type WeekReflection,
} from "../review/muhasabah.ts";
import { WEEKDAY_NAMES, WEEKDAY_ORDER, type ReviewReminder } from "../review/reminder.ts";
import type { WeekReview } from "../review/week.ts";
import { hoursMinutes } from "./bodyView.ts";
import { deviceWord } from "./deviceWord.ts";
import { esc, icon } from "./html.ts";
import { amountText } from "./moneyView.ts";

export interface ReviewScreen {
  /** The last seven days' numbers (review/week.ts). */
  numbers: WeekReview;
  /** What the form shows: what was typed and not kept yet, else this week's review, else nothing. */
  form: ReviewDraft;
  /** This week's review is kept. */
  kept: boolean;
  ahead: readonly string[];
  past: readonly { week: string; line: string }[];
  busy: boolean;
  /** The user's records sync to their other devices through their own server. */
  syncs: boolean;
  /** Talk is set up: the assistant is told the week's intentions when a talk starts (talk/life.ts). */
  talk: boolean;
}

const thousands = (n: number): string => n.toLocaleString("en-GB");
const of7 = (n: number): string => `${n} of 7 days`;

/** "Week of 26 October 2026", from its Monday. */
export const weekLabel = (week: string): string =>
  `Week of ${new Date(`${week}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;

function row(name: string, value: string): string {
  return `<li class="row-item"><span>${esc(name)}</span><span class="small">${esc(value)}</span></li>`;
}

function section(title: string, rows: readonly string[]): string {
  return rows.length === 0 ? "" : `<section class="card" aria-label="${esc(title)}"><h3 class="label group-title">${esc(title.toUpperCase())}</h3>` +
    `<ul class="plain">${rows.join("")}</ul></section>`;
}

function worship(r: WeekReview): string {
  return section("Worship, last 7 days", [
    row("Prayers on time", `${r.prayers.onTime} of ${r.prayers.due}`),
    ...(r.prayers.late ? [row("Prayed late", String(r.prayers.late))] : []),
    ...(r.prayers.unmarked ? [row("Not marked", String(r.prayers.unmarked))] : []),
    row("Quran", `${r.quran.pages} page${r.quran.pages === 1 ? "" : "s"} on ${of7(r.quran.days)}${r.quran.goal ? `, goal ${r.quran.goal} a day` : ""}`),
    row("Morning adhkar", of7(r.adhkar.morning)),
    row("Evening adhkar", of7(r.adhkar.evening)),
  ]);
}

function study(r: WeekReview): string {
  return section("Study, since Monday", [
    ...r.study.map((t) => row(t.name, `${t.minutes ? formatMinutes(t.minutes) : "None"}${t.target ? ` of ${formatMinutes(t.target)}` : ""}`)),
    ...(r.lessonsDue ? [row("Your notes due for review", String(r.lessonsDue))] : []),
  ]);
}

function liftChange(change: number | null): string {
  return change === null || change === 0 ? "" : `, ${change > 0 ? "up" : "down"} ${Math.abs(change)} kg`;
}

function body(r: WeekReview): string {
  return section("Body", [
    ...(r.steps ? [row("Steps a day, last 6 full days", `${thousands(r.steps.average)}${r.steps.goal ? `, ${r.steps.daysAtGoal} of 6 at your ${thousands(r.steps.goal)}` : ""}`)] : []),
    ...(r.sleepAverage ? [row("Sleep a night", hoursMinutes(r.sleepAverage))] : []),
    row("Training days since Monday", `${r.workouts.days}${r.workouts.target ? ` of ${r.workouts.target}` : ""}`),
    ...r.lifts.slice(0, 8).map((l) => row(l.exercise, `${l.kg > 0 ? `${l.kg} kg × ` : ""}${l.reps} × ${l.sets}${liftChange(l.changeKg)}`)),
  ]);
}

function money(r: WeekReview): string {
  const m = r.money;
  return section("Money, this month", [
    row("Came in", amountText(m.inAed, "AED")),
    ...(m.goalAed ? [row("To your goal", m.toGoAed ? `${amountText(m.toGoAed, "AED")} to go` : "Reached")] : []),
    ...(m.commitmentsAed ? [row("After monthly payments", amountText(Math.abs(m.afterAed), "AED") + (m.afterAed < 0 ? " short" : " left"))] : []),
    ...(m.owedAed ? [row("Owed to you", `${amountText(m.owedAed, "AED")}${m.overdue ? `, ${m.overdue} overdue` : ""}`)] : []),
  ]);
}

/** Each step is named over its cards, on the sky, as a screen's own headings are. */
const stepTitle = (n: number, name: string): string => `<h2 class="label step-title">${n} · ${esc(name.toUpperCase())}</h2>`;

/** Step 2: the three questions, each optional. */
function reflect(m: ReviewScreen): string {
  const where = m.syncs ? `stays on this ${deviceWord()}, and on your other devices through your own server`
    : `stays on this ${deviceWord()}`;
  return `${stepTitle(2, "Reflect")}<section class="card stack"><p class="small">Each is optional. What you write ${esc(where)}.</p>` +
    PROMPT_KEYS.map((k) => `<label class="prompt" for="rv-${k}">${esc(PROMPTS[k])}</label><textarea id="rv-${k}" class="field area" ` +
      `name="${k}" rows="3" maxlength="${REFLECTION_MAX}">${esc(m.form[k])}</textarea>`).join("") + `</section>`;
}

/** Step 3: up to three intentions for the week ahead. */
function intentions(m: ReviewScreen): string {
  const fields = Array.from({ length: INTENTIONS_MAX }, (_, i) => `<label class="small" for="rv-i${i + 1}">Intention ${i + 1}</label>` +
    `<input id="rv-i${i + 1}" class="field" name="intention" maxlength="${INTENTION_MAX}" autocomplete="off" ` +
    `value="${esc(m.form.intentions[i] ?? "")}">`).join("");
  return `${stepTitle(3, "Intentions")}<section class="card stack"><p class="small">Up to three, short, for the week ahead. ` +
    `They stay on Home, where you can tick each one.${m.talk ? " When you talk to the assistant, it hears them too." : ""}` +
    `</p>${fields}</section>`;
}

/** Step 4: the next seven days in a few lines. */
function ahead(m: ReviewScreen): string {
  return `${stepTitle(4, "Look ahead")}<section class="card" aria-label="The next 7 days"><ul class="plain">${m.ahead.map((line) =>
    `<li class="row-item"><span class="small">${esc(line)}</span></li>`).join("")}</ul></section>`;
}

function history(m: ReviewScreen): string {
  if (m.past.length === 0) return "";
  return `<section class="card" aria-label="Past reviews"><h2 class="label">PAST REVIEWS</h2><ul class="plain past-list">${m.past.map((p) =>
    `<li><button type="button" class="note-row row-item" data-action="review-past" data-value="${esc(p.week)}"><span class="col">` +
    `<span class="title">${esc(weekLabel(p.week))}</span><span class="small">${esc(p.line)}</span></span></button></li>`).join("")}` +
    `</ul></section>`;
}

/** `notice` goes by the Save button: on a long screen, that is where the hand and the eye are when it changes. */
export function weekReviewView(m: ReviewScreen, head: string, notice: string, chrome: string): string {
  const r = m.numbers;
  return `<main class="screen single">${head}${stepTitle(1, "Look back")}${worship(r)}${study(r)}${body(r)}${money(r)}` +
    `<form class="review-form" data-form="review" autocomplete="off">${reflect(m)}${intentions(m)}${ahead(m)}${notice}` +
    `<div class="row-buttons center"><button type="submit" id="rv-save" class="pill solid"${m.busy ? " disabled" : ""}>` +
    `${m.kept ? "Save changes" : "Keep this review"}</button></div></form>${history(m)}` +
    `<p class="foot">Your own records, added up. Nothing here is a score.</p></main>${chrome}`;
}

/** A past week's review, read back in a sheet: what was written, and the intentions with the ones ticked done. */
export function pastReviewSheet(review: WeekReflection): string {
  const label = weekLabel(review.week);
  const written = PROMPT_KEYS.filter((k) => review[k]).map((k) => `<h3 class="prompt group-title">${esc(PROMPTS[k])}</h3>` +
    `<p class="text lesson-text">${esc(review[k])}</p>`).join("");
  const set = review.intentions.length === 0 ? "" : `<h3 class="label group-title">INTENTIONS</h3><ul class="plain">${review.intentions.map((i) =>
    `<li class="row-item"><span>${esc(i.text)}${i.done ? ", done" : ""}</span></li>`).join("")}</ul>`;
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(`Review, ${label}`)}"><div class="sheet-inner">` +
    `<p class="eyebrow">${esc(label)}</p><div class="stack wide">${written}${set}</div>` +
    `<button type="button" class="link-button" data-go="close">Close</button></div></section>`;
}

function tick(on: boolean): string {
  return `<span class="tick ${on ? "on" : ""}" aria-hidden="true">${on ? icon("check", 14) : ""}</span>`;
}

/** Home: the intentions set for the week, each one tap from done, or back. */
export function homeWeekCard(week: { week: string; intentions: readonly Intention[] } | null): string {
  if (!week) return "";
  return `<section class="card" aria-label="This week"><h2 class="label">THIS WEEK</h2><ul class="plain">${week.intentions.map((i, n) =>
    `<li class="check-row"><button type="button" class="check" data-action="intention-tick" data-value="${esc(week.week)}:${n}" ` +
    `aria-pressed="${i.done}">${tick(i.done)}<span class="check-name">${esc(i.text)}</span></button></li>`).join("")}</ul></section>`;
}

/** Settings: the reminder's switch, and its day and time once it is on. */
export function reviewReminderFields(r: ReviewReminder): string {
  const toggle = `<label class="toggle"><span class="col"><span>Weekly review reminder</span><span class="small">A quiet reminder ` +
    `to look back on your week and set your intentions</span></span><input type="checkbox" data-field="review-reminder"` +
    `${r.on ? " checked" : ""}></label>`;
  if (!r.on) return toggle;
  const days = WEEKDAY_ORDER.map((d) => `<option value="${d}"${d === r.weekday ? " selected" : ""}>${WEEKDAY_NAMES[d]}</option>`).join("");
  return `${toggle}<div class="row-buttons review-when"><span class="col grow"><label class="small" for="review-day">Day</label>` +
    `<select id="review-day" class="field" data-field="review-day">${days}</select></span><span class="col grow">` +
    `<label class="small" for="review-time">Time</label><input id="review-time" class="field" type="time" data-field="review-time" ` +
    `value="${esc(r.time)}"></span></div>`;
}

/** The morning's facts, at the top of the Fajr view. */
export function briefCard(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `<section class="card" aria-label="Today"><h2 class="label">TODAY</h2><ul class="plain">` +
    `${lines.map((line) => `<li class="row-item"><span class="small">${esc(line)}</span></li>`).join("")}</ul></section>`;
}
