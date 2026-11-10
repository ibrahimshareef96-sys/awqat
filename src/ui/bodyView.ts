/** Body: weight over 30 days, steps, sleep and this week's workouts, read from the phone's health store. */
import type { BodyLog, Lift } from "../body/body.ts";
import type { Availability } from "../body/health.ts";
import type { BodySummary, WeightPoint } from "../body/summary.ts";
import { dayDone, liftProgress, planFor, weekDoneDays, type LiftRow } from "../body/training.ts";
import { keyOf } from "../agenda/days.ts";
import { formatTime } from "../prayer/times.ts";
import { foodCard, foodFact, type FoodModel } from "./foodView.ts";
import { esc } from "./html.ts";

export interface BodyModel {
  log: BodyLog;
  /** When the workout timer started, while it runs. */
  workoutSince?: number | null;
  /** null until the health store has been asked whether it is there. */
  available: Availability | null;
  /** Kinds the health store says are not allowed (Android). */
  denied: readonly string[];
  summary: BodySummary | null;
  readAt: number | null;
  reading: boolean;
  /** "android" or "ios": what the health store is called. */
  platform: string;
  tz: string;
  today: string;
  now: number;
  busy: boolean;
  removeArmed: number | null;
  /** The lift one tap from going. */
  liftArmed: string | null;
  /** Food's card (ui/foodView.ts); left out where a caller draws none. */
  food?: FoodModel;
}

const LIFTS_SHOWN = 60;

/** How far along, whole percent: 100 only once it is reached. */
const percentOf = (n: number, goal: number): number => Math.min(100, Math.floor((n / goal) * 100));

const storeName = (m: Pick<BodyModel, "platform">): string => (m.platform === "ios" ? "Apple Health" : "Health Connect");

const weekday = (day: string, style: "short" | "long" = "short"): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: style, timeZone: "UTC" });

export function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}

const thousands = (n: number): string => n.toLocaleString("en-GB");

/** Seven bars, the last one today. */
function bars(items: { day: string; value: number; said: string }[]): string {
  const top = Math.max(1, ...items.map((i) => i.value));
  return `<div class="bars">${items.map((i) => `<div class="bar-col" role="img" aria-label="${esc(`${weekday(i.day, "long")}: ${i.said}`)}">` +
    `<div class="vbar"><div class="vfill" data-h="${Math.round((i.value / top) * 100)}"></div></div>` +
    `<span class="mono">${esc(weekday(i.day).slice(0, 2))}</span></div>`).join("")}</div>`;
}

function deniedNote(m: BodyModel, kind: string, what: string): string {
  if (!m.denied.includes(kind)) return "";
  // Health Connect's own screen can be opened from here; Apple Health's access is changed in the Health app.
  return m.platform === "ios"
    ? `<p class="small">Apple Health does not allow ${esc(what)} yet. Allow it in the Health app: your picture, Apps, ` +
      `Awqat.</p>`
    : `<p class="small">${esc(storeName(m))} does not allow ${esc(what)} yet. <button type="button" class="link-inline" ` +
      `data-action="health-settings">Allow it</button></p>`;
}

function spark(points: WeightPoint[]): string {
  if (points.length < 2) return "";
  const kgs = points.map((p) => p.kg);
  const low = Math.min(...kgs) - 0.5;
  const high = Math.max(...kgs) + 0.5;
  return `<div class="spark" role="img" aria-label="${esc(`${points.length} weigh-ins in 30 days, from ${kgs[0]} to ` +
    `${kgs[kgs.length - 1]} kg`)}">${points.map((p) => `<span class="spark-bar"><span class="vfill" data-h="` +
    `${Math.round(((p.kg - low) / (high - low)) * 100)}"></span></span>`).join("")}</div>`;
}

function weightCard(m: BodyModel): string {
  const w = m.summary?.weight;
  const latest = w?.latest ?? null;
  const day = latest ? new Date(latest.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: m.tz }) : "";
  const change = w?.change;
  const changeLine = change === null || change === undefined ? "" : change === 0 ? "No change in 30 days"
    : `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)} kg in 30 days`;
  const typed = m.log.weights.slice(0, 3).map((t) => {
    const armed = m.removeArmed === t.at;
    const when = new Date(t.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23", timeZone: m.tz });
    return `<div class="row-item"><span class="small">${esc(when)} · ${t.kg.toFixed(1)} kg typed</span><button type="button" ` +
      `class="ghost-link" data-action="weight-remove" data-value="${t.at}">${armed ? "Tap again to remove" : "Remove"}</button></div>`;
  }).join("");
  return `<section class="card"><div class="split"><h2 class="label">WEIGHT</h2><span class="small">${esc(changeLine)}</span></div>` +
    (latest ? `<div class="big">${latest.kg.toFixed(1)} <span class="soft">kg</span></div><p class="small">` +
      `${esc(day)}${latest.typed ? ", typed" : ""}</p>` : `<p class="muted">No weight in the last 30 days.</p>`) +
    `${spark(w?.points ?? [])}${deniedNote(m, "weight", "your weight")}<form class="inline" data-form="weight-add">` +
    `<label class="sr-only" for="weight-kg">Weight in kilograms</label><input id="weight-kg" class="field small-field" ` +
    `name="kg" inputmode="decimal" autocomplete="off" placeholder="82.4" maxlength="8" required><span class="small">kg</span>` +
    `<button type="submit" class="pill">Add</button></form>${typed ? `<div class="stack">${typed}</div>` : ""}</section>`;
}

function stepGoalForm(m: BodyModel): string {
  return `<form class="inline" data-form="step-goal"><label class="small" for="step-goal">Your goal a day</label><input id="step-goal" ` +
    `class="field small-field" name="goal" inputmode="numeric" maxlength="7" autocomplete="off" value="${m.log.stepGoal ?? ""}">` +
    `<button type="submit" class="pill">Save</button></form>`;
}

function stepsCard(m: BodyModel): string {
  const s = m.summary?.steps;
  const goal = m.log.stepGoal;
  if (!s) return `<section class="card"><h2 class="label">STEPS</h2><p class="muted">No steps read.</p>` +
    `${deniedNote(m, "steps", "your steps")}${stepGoalForm(m)}</section>`;
  const reached = goal !== null && s.today >= goal;
  const line = goal === null ? `<p class="small">Choose a goal of your own, near your average. Studies see most of the benefit by about 7,000.</p>`
    : `<span class="bar"><span class="fill" data-w="${percentOf(s.today, goal)}"></span></span><p class="small">` +
      `${reached ? "Goal reached" : `${thousands(goal - s.today)} to go`} of ${thousands(goal)}</p>`;
  return `<section class="card"><div class="split"><h2 class="label">STEPS</h2><span class="small">Average ` +
    `${thousands(s.average)} a day</span></div><div class="big">${thousands(s.today)} <span class="soft">today</span></div>${line}` +
    `${bars(s.days.map((d) => ({ day: d.day, value: d.steps, said: `${thousands(d.steps)} steps` })))}${stepGoalForm(m)}</section>`;
}

/** Sessions the health store saw, and days ticked or lifted on with none in the store. */
export function workoutCount(m: Pick<BodyModel, "log" | "summary" | "today" | "tz">): number {
  const week = m.summary?.workouts?.week ?? [];
  const seen = new Set(week.map((w) => keyOf(w.at, m.tz)));
  return week.length + weekDoneDays(m.log, m.today).filter((d) => !seen.has(d)).length;
}

const loadText = (l: Lift): string => `${l.kg > 0 ? `${l.kg} kg × ` : ""}${l.reps} reps × ${l.sets} sets`;

function liftRow(row: LiftRow): string {
  const moved = row.changeKg === null || row.changeKg === 0 ? "" : ` · ${row.changeKg > 0 ? "up" : "down"} ${Math.abs(row.changeKg)} kg`;
  return `<li class="money-row"><span class="col"><span class="check-name">${esc(row.exercise)}</span><span class="small">` +
    `${esc(loadText(row))}${esc(moved)}</span><span class="small">Next: ${row.reps + 1} reps, or a little more weight</span></span></li>`;
}

function liftHistoryRow(lift: Lift, m: BodyModel): string {
  const armed = m.liftArmed === lift.id;
  const when = new Date(`${lift.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `<li class="money-row"><span class="col"><span class="check-name">${esc(lift.exercise)}</span><span class="small">${esc(loadText(lift))} · ${esc(when)}</span></span>` +
    `<span class="money-actions"><button type="button" class="ghost-link" data-action="lift-remove" data-value="${esc(lift.id)}" ` +
    `aria-label="${armed ? "Tap again to remove" : "Remove"}: ${esc(lift.exercise)}">${armed ? "Tap again to remove" : "Remove"}</button></span></li>`;
}

/** Every lift logged lately, each with its own Remove: the list above shows only each exercise's best last day. */
function liftHistory(m: BodyModel): string {
  if (m.log.lifts.length === 0) return "";
  return `<details id="lift-history" class="money-older"><summary class="small">Everything logged</summary><ul class="plain">` +
    `${m.log.lifts.slice(0, LIFTS_SHOWN).map((l) => liftHistoryRow(l, m)).join("")}</ul></details>`;
}

const FIELD = (id: string, label: string, name: string, extra: string): string =>
  `<span class="lift-field"><label class="small" for="${id}">${label}</label><input id="${id}" class="field" name="${name}" autocomplete="off" ${extra}></span>`;

/** The workout's timer: it shows live on the lock screen too, and Stop marks today done. */
function timerRow(m: BodyModel): string {
  const since = m.workoutSince ?? null;
  const minutes = since === null ? 0 : Math.max(0, Math.round((m.now - since) / 60000));
  return `<div class="row-buttons">${since === null ? "" : `<span class="small" role="timer">Training, ${minutes} min</span>`}` +
    `<button type="button" class="pill${since === null ? "" : " solid"}" data-action="workout-timer">${since === null ? "Start the timer" : "Stop"}</button></div>`;
}

/** Today's plan and the lifts: what is on today, tick it, log a lift and see the last time. */
function trainingCard(m: BodyModel): string {
  const today = planFor(m.log, m.today);
  const done = dayDone(m.log, m.today);
  const rows = liftProgress(m.log).slice(0, 12);
  return `<section class="card" aria-label="Today's training"><div class="split"><h2 class="label">TODAY</h2>` +
    `<button type="button" class="pill${done ? " solid" : ""}" data-action="workout-done" aria-pressed="${done}">${done ? "Done" : "Mark done"}</button></div>` +
    `<div class="big">${today ? esc(today) : `<span class="soft">Nothing planned</span>`}</div>${timerRow(m)}` +
    `<form class="lift-form" data-form="lift-add">${FIELD("lift-name", "Exercise", "exercise", 'maxlength="40"')}` +
    `${FIELD("lift-kg", "Kg", "kg", 'inputmode="decimal" maxlength="6"')}${FIELD("lift-reps", "Reps", "reps", 'inputmode="numeric" maxlength="4"')}` +
    `${FIELD("lift-sets", "Sets", "sets", 'inputmode="numeric" maxlength="2"')}<button type="submit" class="pill">Log it</button></form>` +
    `${rows.length > 0 ? `<ul class="plain">${rows.map((r) => liftRow(r)).join("")}</ul>` : ""}${liftHistory(m)}</section>`;
}

const WEEKDAY_ORDER: readonly (readonly [number, string])[] = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"],
  [5, "Friday"], [6, "Saturday"], [0, "Sunday"]];

function planCard(m: BodyModel): string {
  return `<details id="plan-card" class="card plan-card"><summary class="label">THE WEEK'S PLAN</summary><form class="stack" data-form="workout-plan">` +
    WEEKDAY_ORDER.map(([day, name]) => `<label class="small" for="plan-${day}">${name}</label><input id="plan-${day}" class="field" name="day${day}" ` +
      `maxlength="40" autocomplete="off" placeholder="Rest" value="${esc(m.log.plan[day] ?? "")}">`).join("") +
    `<button type="submit" class="pill solid">Save the plan</button></form></details>`;
}

/** The steps as a line for the home-screen widget, or "" with none read. */
export function stepsLine(m: Pick<BodyModel, "summary" | "log">): string {
  const s = m.summary?.steps;
  if (!s) return "";
  return `${thousands(s.today)}${m.log.stepGoal !== null ? ` of ${thousands(m.log.stepGoal)}` : ""} steps`;
}

/** Home's line for the body: the steps against the user's goal, last night's sleep, the week's workouts and what is on today. */
export function homeBodyCard(m: BodyModel): string {
  const today = planFor(m.log, m.today);
  const food = m.food ? foodFact(m.food.log, m.today) : "";
  if (!m.log.connected && !today && m.log.stepGoal === null) {
    // Someone who only logs food sees that, not an empty count of steps.
    return food ? `<button type="button" class="card link" data-go="body"><span class="split"><span class="label">BODY</span></span>` +
      `<span class="small">${esc(food)}</span></button>` : "";
  }
  const s = m.summary?.steps ?? null;
  const goal = m.log.stepGoal;
  const sleep = m.summary?.sleep?.last ?? null;
  const target = m.log.weeklyTarget;
  const count = workoutCount(m);
  const facts = [sleep ? `Sleep ${hoursMinutes(sleep.minutes)}` : "", target || count ? `Workouts ${count}${target ? ` of ${target}` : ""}` : "", food].filter(Boolean);
  return `<button type="button" class="card link" data-go="body"><span class="split"><span class="label">BODY</span>` +
    `<span class="small">${today ? `Today: ${esc(today)}` : ""}</span></span><span class="numeral">${s ? thousands(s.today) : "–"} ` +
    `<span class="soft">${goal !== null ? `of ${thousands(goal)} steps` : "steps"}</span></span>` +
    (goal !== null && s ? `<span class="bar"><span class="fill" data-w="${percentOf(s.today, goal)}"></span></span>` : "") +
    `${facts.length > 0 ? `<span class="small">${esc(facts.join(" · "))}</span>` : ""}</button>`;
}

function sleepCard(m: BodyModel): string {
  const s = m.summary?.sleep;
  if (!s) return `<section class="card"><h2 class="label">SLEEP</h2><p class="muted">No sleep read.</p>` +
    `${deniedNote(m, "sleep", "your sleep")}</section>`;
  return `<section class="card"><div class="split"><h2 class="label">SLEEP</h2><span class="small">` +
    `${s.average ? `Average ${hoursMinutes(s.average)}` : ""}</span></div>` +
    (s.last ? `<div class="big">${hoursMinutes(s.last.minutes)} <span class="soft">last night</span></div>`
      : `<p class="muted">No sleep recorded last night.</p>`) +
    `${bars(s.nights.map((n) => ({ day: n.day, value: n.minutes, said: n.minutes ? hoursMinutes(n.minutes) : "none" })))}</section>`;
}

function workoutsCard(m: BodyModel): string {
  const w = m.summary?.workouts;
  const target = m.log.weeklyTarget;
  const count = workoutCount(m);
  const head = w || count > 0 ? (target ? `${count} of ${target} this week` : `${count} this week`) : "No workouts read";
  const rows = (w?.week ?? []).map((x) => {
    const day = new Date(x.at).toLocaleDateString("en-GB", { weekday: "short", timeZone: m.tz });
    return `<div class="row-item"><span class="title">${esc(x.label)}</span><span class="small">${esc(day)} ` +
      `${formatTime(new Date(x.at), m.tz)} · ${x.minutes} min</span></div>`;
  }).join("");
  return `<section class="card"><div class="split"><h2 class="label">WORKOUTS</h2><span class="small">From Monday</span></div>` +
    `<div class="big">${esc(head)}</div>${rows ? `<div class="stack">${rows}</div>` : ""}` +
    `${deniedNote(m, "workouts", "your workouts")}<form class="inline" data-form="workout-target"><label class="small" ` +
    `for="workout-target">Planned a week</label><input id="workout-target" class="field small-field" name="target" ` +
    `inputmode="numeric" maxlength="2" placeholder="4" value="${target ?? ""}"><button type="submit" class="pill">Save</button>` +
    `</form></section>`;
}

function connectCard(m: BodyModel): string {
  const store = storeName(m);
  const android = m.platform !== "ios";
  return `<section class="card"><h2 class="label">YOUR BODY, READ ONLY</h2><p class="text">Body reads your weight, steps, ` +
    `sleep and workouts from ${esc(store)}. It only reads, and nothing leaves this ${m.platform === "ios" ? "device" : "phone"}.` +
    `</p><div class="row-buttons"><button type="button" class="pill solid" data-action="health-connect"` +
    `${m.busy ? " disabled" : ""}>Use ${esc(store)}</button></div>` +
    (android ? `<details class="small"><summary>Samsung Health and your scale</summary><p class="small">Samsung Health: ` +
      `open it, then Settings, Health Connect, and allow it to share weight, steps, sleep and exercise. A Xiaomi scale ` +
      `in Zepp Life: share Zepp Life with Google Fit, and in Google Fit turn on "Sync Fit with Health Connect". Or type ` +
      `your weight on this screen after each weigh-in.</p></details>` : "") + `</section>`;
}

function unavailableCard(m: BodyModel): string {
  if (m.platform === "web") {
    return `<section class="card"><p class="text">Body reads your health data in the installed app.</p></section>`;
  }
  if (m.platform === "ios") {
    return `<section class="card"><h2 class="label">APPLE HEALTH IS NOT HERE</h2><p class="text">Apple Health is not ` +
      `available on this device, so Body shows only the weights you type.</p></section>`;
  }
  return `<section class="card"><h2 class="label">HEALTH CONNECT IS NOT READY</h2><p class="text">Body reads Health ` +
    `Connect, which is missing or needs an update on this phone.</p><div class="row-buttons"><button type="button" ` +
    `class="pill" data-action="health-settings">Open Health Connect</button></div></section>`;
}

function readLine(m: BodyModel): string {
  if (m.reading) return `Reading ${storeName(m)}…`;
  return m.readAt ? `Read from ${storeName(m)} at ${formatTime(new Date(m.readAt), m.tz)}.` : "";
}

export function bodyView(m: BodyModel, header: string, notice: string, chrome: string): string {
  let content: string;
  // Training, the plan and food are the user's own records: they show whatever the health store says.
  const own = trainingCard(m) + planCard(m) + (m.food ? foodCard(m.food) : "");
  if (m.available === null) content = `<section class="card"><p class="muted">Looking for ${esc(storeName(m))}…</p></section>${own}`;
  else if (!m.available.available) content = unavailableCard(m) + own + weightCard(m);
  else if (!m.log.connected) content = connectCard(m) + own + weightCard(m);
  else {
    content = `${stepsCard(m)}${own}${weightCard(m)}${sleepCard(m)}${workoutsCard(m)}<section class="card"><div class="split">` +
      `<p class="small">${esc(readLine(m))}</p><button type="button" class="ghost-link" data-action="health-refresh"` +
      `${m.reading || m.busy ? " disabled" : ""}>Refresh</button></div></section>`;
  }
  // One column on a wide screen too: in two, WebKit on iPadOS painted the sleep card as a blank pane of glass.
  return `<main class="screen single">${header}${notice}${content}</main>${chrome}`;
}
