/**
 * Food on the Body screen: today's energy and protein against the user's own goals, the meal on the form (typed, with
 * a photo, or from a packet's barcode), today's meals and the last seven days. Numbers only: nothing here grades a day.
 */
import { dayTotal, lastDays, mealsOn, portion, type FoodLog, type Meal } from "../food/food.ts";
import type { FoodDraft } from "../food/draft.ts";
import { parseGrams } from "../food/food.ts";
import { formatTime } from "../prayer/times.ts";
import { esc } from "./html.ts";

export interface FoodModel {
  log: FoodLog;
  today: string;
  tz: string;
  draft: FoodDraft | null;
  /** The meal one tap from going. */
  armed: string | null;
  busy: boolean;
  /** The installed app: the camera and the scanner are there. */
  native: boolean;
  /** A server of the user's own is set, so a photo can be sent to it for an estimate. */
  server: boolean;
  photoSrc: (name: string | null) => string | null;
}

const thousands = (n: number): string => n.toLocaleString("en-GB");
const grams = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)} g`;
const percentOf = (n: number, goal: number): number => Math.min(100, Math.floor((n / goal) * 100));
const weekday = (day: string, style: "short" | "long" = "short"): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: style, timeZone: "UTC" });

/** A meal's numbers in one line: "450 kcal · 32 g protein · 40 g carbs · 12 g fat", with only what was given. */
export function mealLine(m: Pick<Meal, "kcal" | "protein" | "carbs" | "fat">): string {
  return [`${thousands(m.kcal)} kcal`, m.protein === null ? "" : `${grams(m.protein)} protein`, m.carbs === null ? "" : `${grams(m.carbs)} carbs`,
    m.fat === null ? "" : `${grams(m.fat)} fat`].filter(Boolean).join(" · ");
}

function goalLine(label: string, have: number, goal: number, unit: string): string {
  const left = Math.round((goal - have) * 10) / 10;
  const said = left > 0 ? `${thousands(left)} ${unit} to your goal of ${thousands(goal)}` : `Your goal of ${thousands(goal)} ${unit} is met`;
  return `<span class="bar" role="img" aria-label="${esc(`${label}: ${said}`)}"><span class="fill" data-w="${percentOf(have, goal)}"></span></span>` +
    `<p class="small">${esc(`${label}: ${said}`)}</p>`;
}

const FIELD = (id: string, label: string, name: string, value: string, extra: string): string =>
  `<span class="lift-field"><label class="small" for="${id}">${label}</label><input id="${id}" class="field" name="${name}" ` +
  `autocomplete="off" value="${esc(value)}" ${extra}></span>`;

/** What a scanned packet comes to for the grams typed so far, or "" while that is not an amount. */
function packetLine(d: FoodDraft): string {
  if (!d.packet) return "";
  const per = `Per 100 g: ${mealLine(d.packet.per100)}`;
  const typed = parseGrams(d.grams);
  const eaten = typeof typed === "number" && typed > 0 ? portion(d.packet.per100, typed) : null;
  return `<p class="small">${esc(per)}${d.packet.serving ? esc(` · one serving is ${grams(d.packet.serving)}`) : ""}</p>` +
    (eaten ? `<p class="small">${esc(`${grams(typed as number)} comes to ${mealLine(eaten)}`)}</p>` : "") +
    `<p class="small">From Open Food Facts, by its barcode.</p>`;
}

function mealForm(m: FoodModel): string {
  const d = m.draft;
  const off = m.busy ? " disabled" : "";
  const src = d?.photo ? m.photoSrc(d.photo) : null;
  const photo = d?.photo ? `<div class="meal-draft">${src ? `<img class="meal-photo" src="${esc(src)}" alt="The photo for this meal">` : ""}` +
    `<span class="small">This photo stays on your ${m.native ? "phone" : "device"}.</span></div>` : "";
  const numbers = d?.packet
    ? FIELD("meal-grams", "Grams eaten", "grams", d.grams, 'inputmode="decimal" maxlength="6" required')
    : FIELD("meal-kcal", "Kcal", "kcal", d?.kcal ?? "", 'inputmode="numeric" maxlength="6" required') +
      FIELD("meal-protein", "Protein g", "protein", d?.protein ?? "", 'inputmode="decimal" maxlength="6"') +
      FIELD("meal-carbs", "Carbs g", "carbs", d?.carbs ?? "", 'inputmode="decimal" maxlength="6"') +
      FIELD("meal-fat", "Fat g", "fat", d?.fat ?? "", 'inputmode="decimal" maxlength="6"');
  const estimate = d?.photo && !d.packet && m.server
    ? `<button type="button" class="pill" data-action="meal-estimate"${off}>Estimate from the photo</button>` : "";
  const tools = m.native ? `<div class="row-buttons"><button type="button" class="pill" data-action="meal-photo"${off}>` +
    `${d?.photo ? "Retake the photo" : "Take a photo"}</button><button type="button" class="pill" data-action="meal-scan"${off}>Scan a packet</button>` +
    `${estimate}</div>` : "";
  return `${photo}${tools}<form class="lift-form meal-form" data-form="meal-add">` +
    `${FIELD("meal-name", "What you ate", "name", d?.name ?? "", 'maxlength="60" required')}${numbers}` +
    `<button type="submit" class="pill solid"${off}>Log it</button></form>` +
    (d ? `${packetLine(d)}${d.estimated ? `<p class="small">An estimate from the photo by your own server. Check it before you log it.</p>` : ""}` +
      `<div class="row-buttons"><button type="button" class="ghost-link meal-clear" data-action="meal-cancel"${off}>Clear the form</button></div>` : "");
}

function mealRow(meal: Meal, m: FoodModel): string {
  const armed = m.armed === meal.id;
  const src = m.photoSrc(meal.photo);
  const how = meal.source === "barcode" ? " · scanned" : "";
  return `<li class="money-row meal-row">${src ? `<img class="meal-thumb" src="${esc(src)}" alt="" loading="lazy">` : ""}` +
    `<span class="col"><span class="check-name">${esc(meal.name)}</span><span class="small">${esc(mealLine(meal))}</span>` +
    `<span class="small">${esc(formatTime(new Date(meal.at), m.tz))}${how}</span></span><span class="money-actions">` +
    `<button type="button" class="ghost-link" data-action="meal-remove" data-value="${esc(meal.id)}" aria-label="` +
    `${armed ? "Tap again to remove" : "Remove"}: ${esc(meal.name)}">${armed ? "Tap again to remove" : "Remove"}</button></span></li>`;
}

function weekBars(m: FoodModel): string {
  const days = lastDays(m.log, m.today);
  if (!days.some((d) => d.meals > 0)) return "";
  const top = Math.max(1, ...days.map((d) => d.kcal));
  return `<div class="bars">${days.map((d) => `<div class="bar-col" role="img" aria-label="${esc(`${weekday(d.day, "long")}: ` +
    `${d.meals ? `${thousands(d.kcal)} kcal` : "nothing logged"}`)}"><div class="vbar"><div class="vfill" data-h="` +
    `${Math.round((d.kcal / top) * 100)}"></div></div><span class="mono">${esc(weekday(d.day).slice(0, 2))}</span></div>`).join("")}</div>`;
}

function goalForm(m: FoodModel): string {
  const g = m.log.goal;
  return `<details id="food-goal" class="money-older"><summary class="small">Your goals for a day</summary><form class="lift-form" data-form="food-goal">` +
    `${FIELD("food-goal-kcal", "Energy, kcal", "kcal", g.kcal === null ? "" : String(g.kcal), 'inputmode="numeric" maxlength="6"')}` +
    `${FIELD("food-goal-protein", "Protein, g", "protein", g.protein === null ? "" : String(g.protein), 'inputmode="numeric" maxlength="3"')}` +
    `<button type="submit" class="pill">Save</button></form><p class="small">Your own numbers, or a dietitian's. Awqat suggests none.</p></details>`;
}

/** Food's card on Body. */
export function foodCard(m: FoodModel): string {
  const total = dayTotal(m.log, m.today);
  const goal = m.log.goal;
  const meals = mealsOn(m.log, m.today);
  const macros = [total.protein ? `${grams(total.protein)} protein` : "", total.carbs ? `${grams(total.carbs)} carbs` : "",
    total.fat ? `${grams(total.fat)} fat` : ""].filter(Boolean).join(" · ");
  return `<section class="card" aria-label="Food today"><div class="split"><h2 class="label">FOOD</h2><span class="small">` +
    `${meals.length === 0 ? "" : `${meals.length} ${meals.length === 1 ? "meal" : "meals"} today`}</span></div>` +
    `<div class="big">${thousands(total.kcal)} <span class="soft">kcal today</span></div>` +
    `${macros ? `<p class="small">${esc(macros)}</p>` : ""}` +
    `${goal.kcal !== null ? goalLine("Energy", total.kcal, goal.kcal, "kcal") : ""}` +
    `${goal.protein !== null ? goalLine("Protein", total.protein, goal.protein, "g") : ""}` +
    `${mealForm(m)}${meals.length > 0 ? `<ul class="plain">${meals.map((meal) => mealRow(meal, m)).join("")}</ul>` : ""}` +
    `${weekBars(m)}${goalForm(m)}</section>`;
}

/** Home's fact for food: "Food 1,450 of 2,200 kcal", or "" with nothing logged today. */
export function foodFact(log: FoodLog, today: string): string {
  const total = dayTotal(log, today);
  if (total.meals === 0) return "";
  return `Food ${thousands(total.kcal)}${log.goal.kcal !== null ? ` of ${thousands(log.goal.kcal)}` : ""} kcal`;
}
