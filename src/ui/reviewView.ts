/** The Weekly Review, which the user opens, and the morning brief at the top of the Fajr view. */
import { formatMinutes } from "../learn/learn.ts";
import type { WeekReview } from "../review/week.ts";
import { hoursMinutes } from "./bodyView.ts";
import { esc } from "./html.ts";
import { amountText } from "./moneyView.ts";

const thousands = (n: number): string => n.toLocaleString("en-GB");
const of7 = (n: number): string => `${n} of 7 days`;

function row(name: string, value: string): string {
  return `<li class="row-item"><span>${esc(name)}</span><span class="small">${esc(value)}</span></li>`;
}

function section(title: string, rows: readonly string[]): string {
  return rows.length === 0 ? "" : `<section class="card" aria-label="${esc(title)}"><h2 class="label">${esc(title.toUpperCase())}</h2>` +
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

export function weekReviewView(r: WeekReview, head: string, notice: string, chrome: string): string {
  return `<main class="screen single">${head}${notice}${worship(r)}${study(r)}${body(r)}${money(r)}` +
    `<p class="foot">Your own records, added up. Nothing here is a score.</p></main>${chrome}`;
}

/** The morning's facts, at the top of the Fajr view. */
export function briefCard(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `<section class="card" aria-label="Today"><h2 class="label">TODAY</h2><ul class="plain">` +
    `${lines.map((line) => `<li class="row-item"><span class="small">${esc(line)}</span></li>`).join("")}</ul></section>`;
}
