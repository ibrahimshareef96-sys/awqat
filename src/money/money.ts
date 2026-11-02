/**
 * Money: what came in, who still owes the user, what goes out each month, against a monthly goal. Amounts are whole fils or
 * cents, so nothing drifts in the adding. Dollars count in dirhams at the peg. Every change returns a new value.
 */
import { cleanShown } from "../talk/text.ts";

export const CURRENCIES = ["AED", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** The dirham's peg to the dollar, set by the UAE's central bank. */
export const USD_TO_AED = 3.6725;

const AMOUNT_MAX = 100_000_000_00;
const NAME_MAX = 80;
const ROWS_MAX = 20_000;
const OWED_MAX = 2_000;
const COMMITMENTS_MAX = 200;
const EARLIER_MONTHS = 6;
const OLDER_SHOWN = 50;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface Income {
  id: string;
  date: string;
  cents: number;
  currency: Currency;
  from: string;
}

export interface Owed {
  id: string;
  who: string;
  cents: number;
  currency: Currency;
  /** The day it is due, or "" for none. */
  due: string;
}

export interface Commitment {
  id: string;
  name: string;
  cents: number;
  currency: Currency;
}

export interface Money {
  v: 1;
  goal: { cents: number; currency: Currency } | null;
  /** Newest first. */
  entries: Income[];
  owed: Owed[];
  commitments: Commitment[];
  /** Feed items (feeds/feeds.ts) the user said are not the user's money, or took back: they do not come up again. */
  skipped: string[];
}

export const emptyMoney = (): Money => ({ v: 1, goal: null, entries: [], owed: [], commitments: [], skipped: [] });

const validCents = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= AMOUNT_MAX;
const validCurrency = (c: unknown): c is Currency => CURRENCIES.includes(c as Currency);
const name = (s: unknown): string => cleanShown(s, NAME_MAX);
const validName = (s: unknown): s is string => name(s) !== "";
const validId = (s: unknown): s is string => typeof s === "string" && ID.test(s);

export function validDay(s: unknown): s is string {
  if (typeof s !== "string" || !DAY.test(s)) return false;
  return new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
}

/** An amount as typed ("12,000", "4,250.75") in whole fils or cents, or null when it is not one. */
export function parseAmount(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(t)) return null;
  const [whole, part = ""] = t.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  return validCents(cents) ? cents : null;
}

export function toAed(cents: number, currency: Currency): number {
  return currency === "USD" ? Math.round(cents * USD_TO_AED) : cents;
}

const newestFirst = (a: Income, b: Income): number => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1);

export function setGoal(money: Money, cents: number | null, currency: Currency): Money {
  if (cents === null) return { ...money, goal: null };
  return validCents(cents) && validCurrency(currency) ? { ...money, goal: { cents, currency } } : money;
}

export function addIncome(money: Money, entry: Income): Money {
  const ok = validId(entry.id) && validDay(entry.date) && validCents(entry.cents) && validCurrency(entry.currency) && validName(entry.from);
  if (!ok) return money;
  const kept = money.entries.filter((e) => e.id !== entry.id);
  return { ...money, entries: [...kept, { ...entry, from: name(entry.from) }].sort(newestFirst).slice(0, ROWS_MAX) };
}

export function removeIncome(money: Money, id: string): Money {
  const entries = money.entries.filter((e) => e.id !== id);
  // A row that came from a feed stays gone: the feed would otherwise offer it again on its next run.
  return id.startsWith("f-") ? skipFeedItem({ ...money, entries }, id.slice(2)) : { ...money, entries };
}

/** The newest ones, far past the 90 days a feed looks back. */
const SKIPPED_MAX = 1000;

export function skipFeedItem(money: Money, id: string): Money {
  if (!validId(id) || money.skipped.includes(id)) return money;
  return { ...money, skipped: [...money.skipped, id].slice(-SKIPPED_MAX) };
}

export function addOwed(money: Money, row: Owed): Money {
  const ok = validId(row.id) && validName(row.who) && validCents(row.cents) && validCurrency(row.currency) &&
    (row.due === "" || validDay(row.due));
  const kept = money.owed.filter((o) => o.id !== row.id);
  if (!ok || kept.length >= OWED_MAX) return money;
  return { ...money, owed: [...kept, { ...row, who: name(row.who) }] };
}

export function removeOwed(money: Money, id: string): Money {
  return { ...money, owed: money.owed.filter((o) => o.id !== id) };
}

/** Paid: what was owed becomes money that came in today. */
export function markPaid(money: Money, id: string, date: string, entryId: string): Money {
  const row = money.owed.find((o) => o.id === id);
  if (!row) return money;
  const next = addIncome(money, { id: entryId, date, cents: row.cents, currency: row.currency, from: row.who });
  return next === money ? money : removeOwed(next, id);
}

export function addCommitment(money: Money, row: Commitment): Money {
  const ok = validId(row.id) && validName(row.name) && validCents(row.cents) && validCurrency(row.currency);
  const kept = money.commitments.filter((c) => c.id !== row.id);
  if (!ok || kept.length >= COMMITMENTS_MAX) return money;
  return { ...money, commitments: [...kept, { ...row, name: name(row.name) }] };
}

export function removeCommitment(money: Money, id: string): Money {
  return { ...money, commitments: money.commitments.filter((c) => c.id !== id) };
}

export interface MoneySummary {
  month: string;
  inAed: number;
  lastMonthAed: number;
  goalAed: number | null;
  toGoAed: number | null;
  percent: number | null;
  /** This month's, newest first. */
  entries: Income[];
  /** From other months, newest first, so a wrong day can still be found and removed. */
  older: Income[];
  /** Soonest due first; those with no date last. */
  owed: Owed[];
  owedAed: number;
  overdue: number;
  commitmentsAed: number;
  afterAed: number;
  /** The months before this one that had money in, newest first. */
  earlier: { month: string; aed: number }[];
}

function monthBefore(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const sumAed = (rows: readonly { cents: number; currency: Currency }[]): number =>
  rows.reduce((total, r) => total + toAed(r.cents, r.currency), 0);

const byDue = (a: Owed, b: Owed): number => {
  if (a.due === b.due) return a.id < b.id ? -1 : 1;
  if (a.due === "") return 1;
  if (b.due === "") return -1;
  return a.due < b.due ? -1 : 1;
};

export function monthSummary(money: Money, today: string): MoneySummary {
  const month = today.slice(0, 7);
  const entries = money.entries.filter((e) => e.date.startsWith(month));
  const inAed = sumAed(entries);
  const totals = new Map<string, number>();
  for (const e of money.entries) {
    const m = e.date.slice(0, 7);
    if (m < month) totals.set(m, (totals.get(m) ?? 0) + toAed(e.cents, e.currency));
  }
  const goalAed = money.goal ? toAed(money.goal.cents, money.goal.currency) : null;
  const commitmentsAed = sumAed(money.commitments);
  return {
    month,
    inAed,
    lastMonthAed: totals.get(monthBefore(month)) ?? 0,
    goalAed,
    toGoAed: goalAed === null ? null : Math.max(0, goalAed - inAed),
    percent: goalAed === null ? null : Math.min(100, Math.floor((inAed / goalAed) * 100)),
    entries,
    older: money.entries.filter((e) => !e.date.startsWith(month)).slice(0, OLDER_SHOWN),
    owed: [...money.owed].sort(byDue),
    owedAed: sumAed(money.owed),
    overdue: money.owed.filter((o) => o.due !== "" && o.due < today).length,
    commitmentsAed,
    afterAed: inAed - commitmentsAed,
    earlier: [...totals.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, EARLIER_MONTHS)
      .map(([m, aed]) => ({ month: m, aed })),
  };
}

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkRows<T>(raw: unknown, max: number, read: (row: Record<string, unknown>) => T | null): { rows: T[]; bad: boolean } {
  if (!Array.isArray(raw)) return { rows: [], bad: raw !== undefined };
  const rows = raw.slice(0, max).flatMap((row) => {
    const out = plain(row) ? read(row) : null;
    return out === null ? [] : [out];
  });
  return { rows, bad: rows.length !== raw.length };
}

const readIncome = (r: Record<string, unknown>): Income | null =>
  (validId(r.id) && validDay(r.date) && validCents(r.cents) && validCurrency(r.currency) && validName(r.from)
    ? { id: r.id, date: r.date, cents: r.cents, currency: r.currency, from: name(r.from) } : null);

const readOwed = (r: Record<string, unknown>): Owed | null =>
  (validId(r.id) && validName(r.who) && validCents(r.cents) && validCurrency(r.currency) && (r.due === "" || validDay(r.due))
    ? { id: r.id, who: name(r.who), cents: r.cents, currency: r.currency, due: r.due as string } : null);

const readCommitment = (r: Record<string, unknown>): Commitment | null =>
  (validId(r.id) && validName(r.name) && validCents(r.cents) && validCurrency(r.currency)
    ? { id: r.id, name: name(r.name), cents: r.cents, currency: r.currency } : null);

/** What was saved, or came from another device, read back row by row; `damaged` when something had to be left out. */
export function checkMoney(json: string | null): { money: Money; damaged: boolean } {
  if (json === null) return { money: emptyMoney(), damaged: false };
  try {
    const raw: unknown = JSON.parse(json);
    if (!plain(raw) || raw.v !== 1) return { money: emptyMoney(), damaged: true };
    const entries = checkRows(raw.entries, ROWS_MAX, readIncome);
    const owed = checkRows(raw.owed, OWED_MAX, readOwed);
    const commitments = checkRows(raw.commitments, COMMITMENTS_MAX, readCommitment);
    const g = raw.goal;
    const goal = plain(g) && validCents(g.cents) && validCurrency(g.currency) ? { cents: g.cents, currency: g.currency } : null;
    const badGoal = g !== null && g !== undefined && goal === null;
    const skipped = Array.isArray(raw.skipped) ? raw.skipped.filter(validId).slice(-SKIPPED_MAX) : [];
    return {
      money: { v: 1, goal, entries: [...entries.rows].sort(newestFirst), owed: owed.rows, commitments: commitments.rows, skipped },
      damaged: entries.bad || owed.bad || commitments.bad || badGoal,
    };
  } catch {
    return { money: emptyMoney(), damaged: true };
  }
}
