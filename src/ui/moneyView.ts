/** Money: this month against the goal, who still owes the user, what came in, and what goes out each month. */
import { CURRENCIES, monthSummary, type Commitment, type Currency, type Income, type Money, type Owed } from "../money/money.ts";
import { pendingMoney, typedAlready, type MoneyFeed } from "../feeds/feeds.ts";
import { sentLine } from "./feedViews.ts";
import { esc } from "./html.ts";

export interface MoneyModel {
  money: Money;
  today: string;
  /** The row one tap from going: "income:id", "owed:id", "commitment:id", "paid:id" or "skip:id". */
  armed: string | null;
  /** What the feed source last found (Stripe, the CRM), if it has sent anything. */
  feed?: MoneyFeed | null;
  /** For how old that is. */
  now?: number;
}

export type MoneySheetKind = "in" | "owed" | "out" | "goal";

/** "AED 12,000", with fils or cents only when there are some. */
export function amountText(cents: number, currency: Currency): string {
  const whole = cents % 100 === 0;
  const n = (cents / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
}

const aed = (cents: number): string => amountText(cents, "AED");

const dayText = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const monthText = (month: string): string =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function removeButton(m: MoneyModel, kind: string, id: string, what: string): string {
  const armed = m.armed === `${kind}:${id}`;
  return `<button type="button" class="ghost-link" data-action="money-remove" data-value="${esc(`${kind}:${id}`)}" ` +
    `aria-label="${armed ? "Tap again to remove" : "Remove"}: ${esc(what)}">${armed ? "Tap again to remove" : "Remove"}</button>`;
}

function monthCard(m: MoneyModel): string {
  const s = monthSummary(m.money, m.today);
  const goal = s.goalAed === null ? `<p class="small">No monthly goal yet.</p>`
    : `<span class="bar"><span class="fill" data-w="${s.percent}"></span></span><p class="small">${s.toGoAed === 0
      ? `Goal of ${esc(aed(s.goalAed))} reached` : `${esc(aed(s.toGoAed ?? 0))} to go of ${esc(aed(s.goalAed))}`}</p>`;
  const last = s.lastMonthAed > 0 ? `<span class="small">Last month ${esc(aed(s.lastMonthAed))}</span>` : "";
  return `<section class="card" aria-label="This month"><div class="split"><h2 class="label">${esc(monthText(s.month).toUpperCase())}</h2>${last}</div>` +
    `<div class="big">${esc(aed(s.inAed))} <span class="soft">in</span></div>${goal}<div class="row-buttons">` +
    `<button type="button" class="pill solid" data-action="money-sheet" data-value="in">Money came in</button>` +
    `<button type="button" class="pill" data-action="money-sheet" data-value="owed">Someone owes me</button>` +
    `<button type="button" class="ghost-link" data-action="money-sheet" data-value="goal">${s.goalAed === null ? "Set a goal" : "Change the goal"}</button>` +
    `</div></section>`;
}

/** What the feed source found, one tap of confirm from counting. A row like one the user typed says so, and the user decides. */
function confirmCard(m: MoneyModel): string {
  const feed = m.feed ?? null;
  const items = pendingMoney(feed, m.money);
  const off = (feed?.sources ?? []).filter((s) => !s.ok && s.why !== "not set up");
  if (items.length === 0 && off.length === 0) return "";
  const rows = items.map((i) => {
    const like = typedAlready(i, m.money);
    const skipArmed = m.armed === `skip:${i.id}`;
    return `<li class="money-row"><span class="col"><span class="check-name">${esc(i.from)}</span><span class="small">${esc(amountText(i.cents, i.currency))} · ${esc(dayText(i.date))}</span>` +
      `${like ? `<span class="small">You may have this already: ${esc(like.from)}, ${esc(dayText(like.date))}</span>` : ""}</span><span class="money-actions">` +
      `<button type="button" class="pill solid" data-action="money-confirm" data-value="${esc(i.id)}" aria-label="It came in: ${esc(i.from)}">It came in</button>` +
      `<button type="button" class="ghost-link" data-action="money-skip" data-value="${esc(i.id)}" aria-label="${skipArmed ? "Tap again to leave it out" : "Leave it out"}: ${esc(i.from)}">` +
      `${skipArmed ? "Tap again to leave it out" : "Leave it out"}</button></span></li>`;
  }).join("");
  const failing = off.map((s) => `<p class="small">${esc(`${s.name}: ${s.why || "could not be read"}`)}</p>`).join("");
  return `<section class="card" aria-label="To confirm"><div class="split"><h2 class="label accent">TO CONFIRM</h2><span class="small">${items.length || ""}</span></div>` +
    `${rows ? `<ul class="plain">${rows}</ul>` : ""}${failing}${feed && m.now ? `<p class="small">${esc(sentLine(feed.at, m.now))}</p>` : ""}</section>`;
}

function owedRow(row: Owed, m: MoneyModel): string {
  const late = row.due !== "" && row.due < m.today;
  const when = row.due === "" ? "" : `${late ? "Was due" : "Due"} ${dayText(row.due)}`;
  const armed = m.armed === `paid:${row.id}`;
  return `<li class="money-row"><span class="col"><span class="check-name">${esc(row.who)}</span><span class="small">` +
    `${esc(amountText(row.cents, row.currency))}${when ? ` · ${esc(when)}` : ""}</span></span><span class="money-actions">` +
    `<button type="button" class="pill${armed ? " solid" : ""}" data-action="money-paid" data-value="${esc(row.id)}" ` +
    `aria-label="${armed ? "Tap again: paid today" : "Paid"}: ${esc(row.who)}">${armed ? "Tap again: paid today" : "Paid"}</button>` +
    `${removeButton(m, "owed", row.id, row.who)}</span></li>`;
}

function owedCard(m: MoneyModel): string {
  const s = monthSummary(m.money, m.today);
  if (s.owed.length === 0) return "";
  const late = s.overdue > 0 ? ` · ${s.overdue} overdue` : "";
  return `<section class="card" aria-label="Owed to you"><div class="split"><h2 class="label">OWED TO YOU</h2><span class="small">` +
    `${esc(aed(s.owedAed))}${esc(late)}</span></div><ul class="plain">${s.owed.map((o) => owedRow(o, m)).join("")}</ul></section>`;
}

function incomeRow(row: Income, m: MoneyModel): string {
  return `<li class="money-row"><span class="col"><span class="check-name">${esc(row.from)}</span><span class="small">` +
    `${esc(amountText(row.cents, row.currency))} · ${esc(row.date.slice(0, 7) === m.today.slice(0, 7) ? dayText(row.date) : `${dayText(row.date)} ${row.date.slice(0, 4)}`)}</span></span>` +
    `<span class="money-actions">${removeButton(m, "income", row.id, row.from)}</span></li>`;
}

function incomeCard(m: MoneyModel): string {
  const s = monthSummary(m.money, m.today);
  const earlier = s.earlier.length === 0 ? "" : `<h3 class="label money-earlier">EARLIER MONTHS</h3><ul class="plain">${s.earlier.map((e) =>
    `<li class="row-item"><span class="small">${esc(monthText(e.month))}</span><span class="small">${esc(aed(e.aed))}</span></li>`).join("")}</ul>`;
  if (s.entries.length === 0 && s.older.length === 0) return "";
  const rows = s.entries.length > 0 ? `<ul class="plain">${s.entries.map((e) => incomeRow(e, m)).join("")}</ul>`
    : `<p class="muted">Nothing in yet this month.</p>`;
  const older = s.older.length === 0 ? "" : `<details id="money-older" class="money-older"><summary class="small">Rows from other months</summary>` +
    `<ul class="plain">${s.older.map((e) => incomeRow(e, m)).join("")}</ul></details>`;
  return `<section class="card" aria-label="Came in"><h2 class="label">CAME IN</h2>${rows}${earlier}${older}</section>`;
}

function commitmentRow(row: Commitment, m: MoneyModel): string {
  return `<li class="money-row"><span class="col"><span class="check-name">${esc(row.name)}</span><span class="small">` +
    `${esc(amountText(row.cents, row.currency))} a month</span></span><span class="money-actions">` +
    `${removeButton(m, "commitment", row.id, row.name)}</span></li>`;
}

function commitmentsCard(m: MoneyModel): string {
  const s = monthSummary(m.money, m.today);
  const head = m.money.commitments.length === 0 ? "" : `<div class="big">${esc(aed(s.commitmentsAed))} <span class="soft">a month</span></div>` +
    `<p class="small">${s.afterAed >= 0 ? `${esc(aed(s.afterAed))} left this month after these` : `${esc(aed(-s.afterAed))} short of these this month`}</p>` +
    `<ul class="plain">${m.money.commitments.map((c) => commitmentRow(c, m)).join("")}</ul>`;
  return `<section class="card" aria-label="Goes out each month"><h2 class="label">GOES OUT EACH MONTH</h2>${head}<div class="row-buttons">` +
    `<button type="button" class="pill" data-action="money-sheet" data-value="out">Add a monthly payment</button></div></section>`;
}

export function moneyView(m: MoneyModel, head: string, notice: string, chrome: string): string {
  return `<main class="screen single">${head}${notice}${monthCard(m)}${confirmCard(m)}${owedCard(m)}${incomeCard(m)}${commitmentsCard(m)}` +
    `<p class="foot">Dollars count at the peg, 3.6725 dirhams.</p></main>${chrome}`;
}

function currencyField(selected: Currency): string {
  return `<label class="small" for="ms-currency">Currency</label><select id="ms-currency" class="field" name="currency">` +
    `${CURRENCIES.map((c) => `<option value="${c}"${c === selected ? " selected" : ""}>${c}</option>`).join("")}</select>`;
}

const amountField = (value = ""): string =>
  `<label class="small" for="ms-amount">Amount</label><input id="ms-amount" class="field" name="amount" inputmode="decimal" ` +
  `autocomplete="off" maxlength="16" value="${esc(value)}" data-autofocus>`;

const SHEET_TITLE: Readonly<Record<MoneySheetKind, string>> = {
  in: "Money came in", owed: "Someone owes me", out: "A monthly payment", goal: "Monthly goal",
};

function sheetFields(kind: MoneySheetKind, m: MoneyModel): string {
  if (kind === "goal") {
    const goal = m.money.goal;
    return `${amountField(goal ? String(goal.cents / 100) : "")}${currencyField(goal?.currency ?? "AED")}` +
      `<p class="small">Leave the amount empty for no goal.</p>`;
  }
  if (kind === "in") {
    return `${amountField()}${currencyField("AED")}<label class="small" for="ms-who">From</label><input id="ms-who" class="field" ` +
      `name="who" maxlength="80" autocomplete="off"><label class="small" for="ms-day">Day</label><input id="ms-day" class="field" ` +
      `name="day" type="date" value="${esc(m.today)}" max="${esc(m.today)}">`;
  }
  if (kind === "owed") {
    return `<label class="small" for="ms-who">Who</label><input id="ms-who" class="field" name="who" maxlength="80" autocomplete="off" ` +
      `data-autofocus>${amountField().replace(" data-autofocus", "")}${currencyField("AED")}<label class="small" for="ms-day">Due, if there is a day</label>` +
      `<input id="ms-day" class="field" name="day" type="date">`;
  }
  return `<label class="small" for="ms-who">What it is</label><input id="ms-who" class="field" name="who" maxlength="80" autocomplete="off" ` +
    `data-autofocus>${amountField().replace(" data-autofocus", "")}${currencyField("AED")}`;
}

export function moneySheet(kind: MoneySheetKind, m: MoneyModel): string {
  return `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(SHEET_TITLE[kind])}"><div class="sheet-inner">` +
    `<h2 class="title wide">${esc(SHEET_TITLE[kind])}</h2><p class="sheet-error" data-sheet-error role="alert" hidden></p>` +
    `<form class="stack wide" data-form="money" novalidate>${sheetFields(kind, m)}<button type="submit" class="pill solid wide">Save</button></form>` +
    `<button type="button" class="link-button" data-go="close">Close</button></div></section>`;
}
