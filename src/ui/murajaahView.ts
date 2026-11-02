/** The muraja'ah plan on the Quran screen: today's juz with its weak pages, and the sheet where the plan is chosen. */
import { lastRevised, type QuranLog } from "../quran/log.ts";
import type { MushafMarks } from "../quran/marks.ts";
import { PER_DAY_CHOICES, juzPages, todaysRevision, weakPages, type MurajaahPlan } from "../quran/murajaah.ts";
import { icon } from "./html.ts";

export interface MurajaahModel {
  plan: MurajaahPlan | null;
  quran: QuranLog;
  marks: MushafMarks;
  /** Today's calendar date, YYYY-MM-DD. */
  date: string;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** One juz of today's share: tick it when revised; its weak pages, most mistakes first, open the mushaf there. */
function juzRow(juz: number, done: boolean, marks: MushafMarks): string {
  const { first, last } = juzPages(juz);
  const weak = weakPages(marks, juz);
  const chips = weak.map((w) => `<button type="button" class="chip small-chip" data-go="mushaf:${w.page}" ` +
    `aria-label="Page ${w.page}, ${plural(w.mistakes, "mistake")}">p. ${w.page} · ${w.mistakes}</button>`).join("");
  return `<li class="plan-item"><div class="check-row"><button type="button" class="check" data-action="quran-juz" ` +
    `data-value="${juz}" aria-pressed="${done}"><span class="tick ${done ? "on" : ""}" aria-hidden="true">` +
    `${done ? icon("check", 14) : ""}</span><span class="col"><span class="check-name">Juz ${juz}</span>` +
    `<span class="source">p. ${first} to ${last}${weak.length ? " · weak pages first" : ""}</span></span></button>` +
    `<button type="button" class="ghost-link" data-go="mushaf:${weak[0]?.page ?? first}">Open</button></div>` +
    (chips ? `<div class="chips start weak">${chips}</div>` : "") + `</li>`;
}

export function murajaahCard(m: MurajaahModel): string {
  if (!m.plan) {
    return `<section class="card"><h2 class="label">MURAJA'AH</h2><p class="muted">Choose the juz you have memorised ` +
      `and how many to revise a day. Each day the plan gives you the juz you revised longest ago, with the pages where ` +
      `you slip most first.</p><button type="button" class="pill solid" data-action="murajaah-setup">Set up your plan` +
      `</button></section>`;
  }
  const t = todaysRevision(m.plan, lastRevised(m.quran), m.date);
  const rows = [...t.doneToday.map((j) => juzRow(j, true, m.marks)), ...t.todo.map((j) => juzRow(j, false, m.marks))];
  const status = t.done ? `<p class="small">Today's revision is done.${t.next ? ` Keep going with ` +
    `<button type="button" class="link-inline" data-go="mushaf:${juzPages(t.next).first}">Juz ${t.next}</button>.` : ""}</p>` : "";
  return `<section class="card plan"><div class="split"><h2 class="label">MURAJA'AH</h2><span class="small">` +
    `${t.fresh} of ${m.plan.juz.length} juz in the last ${plural(t.cycle, "day")}</span></div>` +
    `<ul class="plain checks">${rows.join("")}</ul>${status}<button type="button" class="link-button" ` +
    `data-action="murajaah-setup">${m.plan.perDay} juz a day · ${m.plan.juz.length} juz · Change` +
    `</button></section>`;
}

/** Which juz are memorised (all ticked to start with) and how many a day. */
export function murajaahSheet(plan: MurajaahPlan | null): string {
  const chosen = new Set(plan?.juz ?? Array.from({ length: 30 }, (_, i) => i + 1));
  const perDay = plan?.perDay ?? 1;
  const juz = Array.from({ length: 30 }, (_, i) => i + 1).map((j) => `<label class="juz pick"><input type="checkbox" ` +
    `name="juz" value="${j}" aria-label="Juz ${j}"${chosen.has(j) ? " checked" : ""}><span aria-hidden="true">${j}</span>` +
    `</label>`).join("");
  const days = PER_DAY_CHOICES.map((n) => `<label class="chip pick"><input type="radio" name="perDay" value="${n}" ` +
    `aria-label="${n} juz a day"${n === perDay ? " checked" : ""}><span aria-hidden="true">${n}</span></label>`).join("");
  // Focus starts on "All", at the top, so the sheet opens on the juz rather than scrolled down to Save.
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="Your muraja'ah plan"><div class="sheet-inner">` +
    `<form class="stack wide" data-form="murajaah"><fieldset class="stack"><legend class="label">THE JUZ YOU HAVE MEMORISED` +
    `</legend><div class="inline"><button type="button" class="link-inline" data-action="murajaah-all" data-value="on" ` +
    `aria-label="All, choose all 30 juz" data-autofocus>All</button><button type="button" class="link-inline" ` +
    `data-action="murajaah-all" data-value="off" aria-label="None, clear every juz">None</button></div>` +
    `<div class="juz-grid">${juz}</div></fieldset><fieldset class="stack"><legend class="label">JUZ A DAY</legend>` +
    `<div class="chips start">${days}</div></fieldset><button type="submit" class="pill solid wide">` +
    `Save the plan</button></form><p class="sheet-error" data-sheet-error role="alert" hidden></p>` +
    `<button type="button" class="link-button" data-go="close">Close</button></div></section>`;
}
