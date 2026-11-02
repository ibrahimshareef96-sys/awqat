/**
 * Money's actions: the sheet that adds a row or sets the goal, Paid, and Remove. A change is on screen at once and goes
 * under anything that arrives while it saves; one the phone could not keep is taken back and the sheet says so.
 */
import { feedEntryId, pendingMoney } from "../feeds/feeds.ts";
import {
  addCommitment, addIncome, addOwed, CURRENCIES, markPaid, parseAmount, removeCommitment, removeIncome, removeOwed, setGoal, skipFeedItem,
  type Currency, type Money,
} from "../money/money.ts";
import { KEYS } from "../store.ts";
import type { MoneyModel, MoneySheetKind } from "../ui/moneyView.ts";
import { hooks, save, setNotice, state, today } from "./state.ts";

export const MONEY_MESSAGES = {
  badAmount: "Type the amount in numbers, like 12,000 or 4,250.75.",
  noName: { in: "Say who it came from.", owed: "Say who owes it.", out: "Say what the payment is." },
  notAdded: "That could not be added. Check the day, or this list may be full.",
  futureDay: "Money that has not come in yet goes under Someone owes me.",
  unsaved: "This phone could not save that. Try again.",
};

const KINDS: readonly MoneySheetKind[] = ["in", "owed", "out", "goal"];
/** A second tap this soon is one double tap, on a button that has just changed under the finger. */
const CONFIRM_PAUSE_MS = 500;

let armedAt = Number.NEGATIVE_INFINITY;
let saving = false;

export function moneyModel(): MoneyModel {
  return { money: state.money, today: today(), armed: state.moneyArmed, feed: state.feeds.money.feed, now: Date.now() };
}

/** One tap: what the feed source found counts as money that came in, on the day it arrived. */
export async function confirmFeedItem(id: string): Promise<void> {
  const item = pendingMoney(state.feeds.money.feed, state.money).find((i) => i.id === id);
  if (!item) return;
  const next = addIncome(state.money, { id: feedEntryId(item.id), date: item.date, cents: item.cents, currency: item.currency, from: item.from });
  if (next === state.money) return setNotice(MONEY_MESSAGES.notAdded);
  await change(next);
}

/** Two taps: it is not the user's money, and it does not come up again. */
export async function skipFeedTap(id: string, now = Date.now()): Promise<void> {
  if (!confirmed(`skip:${id}`, now)) return hooks.render();
  await change(skipFeedItem(state.money, id));
}

export function openSheet(value: string): void {
  if (!KINDS.includes(value as MoneySheetKind)) return;
  state.moneySheet = value as MoneySheetKind;
  state.moneyArmed = null;
  state.sheet = "money";
  hooks.renderOverlay();
}

/** Something typed in the sheet and not saved: the first close says so. */
export function moneyTyped(): boolean {
  if (state.sheet !== "money" || state.moneySheet === "goal") return false;
  return [...document.querySelectorAll<HTMLInputElement>("#overlay input:not([type=date])")].some((el) => el.value.trim() !== "");
}

function sheetError(text: string): void {
  const el = document.querySelector<HTMLElement>("#overlay [data-sheet-error]");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

const newId = (at: number): string => `m${at.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const text = (form: FormData, name: string): string => String(form.get(name) ?? "");
const currencyOf = (form: FormData): Currency => (CURRENCIES.includes(text(form, "currency") as Currency) ? text(form, "currency") as Currency : "AED");

/** The change the sheet asks for and how to take it back, or the reason it cannot be made. */
function planned(kind: MoneySheetKind, form: FormData, at: number): { apply: (m: Money) => Money; undo: (m: Money) => Money } | string {
  const typed = text(form, "amount").trim();
  const cents = parseAmount(typed);
  const currency = currencyOf(form);
  if (kind === "goal") {
    if (typed !== "" && cents === null) return MONEY_MESSAGES.badAmount;
    const goal = state.money.goal;
    return { apply: (m) => setGoal(m, typed === "" ? null : cents, currency), undo: (m) => ({ ...m, goal }) };
  }
  const who = text(form, "who").trim();
  if (!who) return MONEY_MESSAGES.noName[kind];
  if (cents === null) return MONEY_MESSAGES.badAmount;
  const id = newId(at);
  if (kind === "out") {
    return { apply: (m) => addCommitment(m, { id, name: who, cents, currency }), undo: (m) => removeCommitment(m, id) };
  }
  const day = text(form, "day");
  if (kind === "owed") {
    return { apply: (m) => addOwed(m, { id, who, cents, currency, due: day }), undo: (m) => removeOwed(m, id) };
  }
  if (day > today()) return MONEY_MESSAGES.futureDay;
  return { apply: (m) => addIncome(m, { id, date: day || today(), cents, currency, from: who }), undo: (m) => removeIncome(m, id) };
}

export async function submit(form: FormData, at = Date.now()): Promise<void> {
  if (saving || state.moneySheet === null) return;
  const plan = planned(state.moneySheet, form, at);
  if (typeof plan === "string") return sheetError(plan);
  const before = state.money;
  const next = plan.apply(before);
  // A row that changed nothing did not pass its checks: a day that could not be read, or a list that is full.
  if (next === before) return sheetError(MONEY_MESSAGES.notAdded);
  saving = true;
  try {
    state.money = next;
    if (!(await save(KEYS.money, next))) {
      state.money = plan.undo(state.money);
      hooks.render();
      return sheetError(state.notice || MONEY_MESSAGES.unsaved);
    }
    hooks.render();
    hooks.closeSheet(true);
  } finally {
    saving = false;
  }
}

/** Two taps with a moment between them: the first arms, the second confirms. */
function confirmed(key: string, now: number): boolean {
  if (state.moneyArmed !== key) {
    state.moneyArmed = key;
    armedAt = now;
    return false;
  }
  // A clock moved back counts as past the pause, so a confirm is never refused for it.
  if (now >= armedAt && now - armedAt < CONFIRM_PAUSE_MS) return false;
  state.moneyArmed = null;
  return true;
}

async function change(next: Money): Promise<void> {
  state.money = next;
  const saving_ = save(KEYS.money, next);
  hooks.render();
  await saving_;
  // Again once saved, so a save that failed says so now.
  hooks.render();
}

/** Paid is tapped twice: the first says what the second does. */
export async function paidTap(id: string, now = Date.now()): Promise<void> {
  if (!state.money.owed.some((o) => o.id === id)) return;
  if (!confirmed(`paid:${id}`, now)) return hooks.render();
  // The same id from any device, so Paid tapped on two before they sync is one amount in.
  const next = markPaid(state.money, id, today(), `p-${id}`.slice(0, 64));
  if (next === state.money) return setNotice(MONEY_MESSAGES.unsaved);
  await change(next);
}

export async function removeTap(value: string, now = Date.now()): Promise<void> {
  const [kind, id = ""] = value.split(":");
  const remove = kind === "income" ? removeIncome : kind === "owed" ? removeOwed : kind === "commitment" ? removeCommitment : null;
  if (!remove) return;
  if (!confirmed(value, now)) return hooks.render();
  await change(remove(state.money, id));
}
