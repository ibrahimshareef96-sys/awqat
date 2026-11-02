/**
 * What the feed source tells the app through the Worker (the Worker's FEEDS.md): money waiting for a confirm, the user's projects and
 * Queue, and a digest of the user's inboxes. A feed is only ever read: nothing here writes back, and no mail can be sent from
 * here. The Worker checks a feed's shape and no more, so every row is checked again before it is shown, and a row that
 * cannot be read is left out. A feed is kept in memory only, so mail never reaches the phone's backups. A money row the user
 * confirms becomes one of the user's own rows, name and all, and is kept and synced as any other.
 */
import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import { CURRENCIES, validDay, type Currency, type Money } from "../money/money.ts";
import { cleanShown } from "../talk/text.ts";

export const FEED_KINDS = ["money", "work", "mail"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

export interface MoneyItem { id: string; source: string; date: string; cents: number; currency: Currency; from: string }
export interface FeedSource { name: string; ok: boolean; why: string }
export interface MoneyFeed { at: number; items: MoneyItem[]; sources: FeedSource[] }

export interface WorkProject { name: string; group: string; status: string; touched: string; note: string }
export interface WorkDue { text: string; date: string; late: boolean }
export interface WorkWaiting { text: string; date: string; who: string }
export interface WorkFeed { at: number; projects: WorkProject[]; due: WorkDue[]; waiting: WorkWaiting[] }

export const PILES = ["reply", "read", "skip"] as const;
export type Pile = (typeof PILES)[number];
export interface MailThread { id: string; account: string; from: string; subject: string; when: number; pile: Pile; line: string; draft: string }
export interface MailFeed { at: number; accounts: FeedSource[]; threads: MailThread[] }

const ITEMS_MAX = 200;
const WORK_MAX = 60;
const THREADS_MAX = 40;
const TEXT_MAX = 160;
const NAME_MAX = 80;
const WHY_MAX = 60;
const DRAFT_MAX = 1200;
const AMOUNT_MAX = 100_000_000_00;
const ITEM_ID = /^[A-Za-z0-9-]{1,56}$/;
const THREAD_ID = /^[A-Za-z0-9-]{1,64}$/;

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const rows = <T>(raw: unknown, max: number, read: (row: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(raw) ? raw.slice(0, max).flatMap((row) => {
    const out = plain(row) ? read(row) : null;
    return out === null ? [] : [out];
  }) : []);
const madeAt = (raw: Record<string, unknown>): number | null =>
  (raw.v === 1 && typeof raw.at === "number" && Number.isFinite(raw.at) && raw.at >= 0 ? raw.at : null);
const dayOrEmpty = (v: unknown): string => (validDay(v) ? v : "");

const readSource = (r: Record<string, unknown>): FeedSource | null => {
  const name = cleanShown(r.name, NAME_MAX);
  return name ? { name, ok: r.ok === true, why: cleanShown(r.why, WHY_MAX) } : null;
};

const readItem = (r: Record<string, unknown>): MoneyItem | null => {
  const from = cleanShown(r.from, NAME_MAX);
  const good = typeof r.id === "string" && ITEM_ID.test(r.id) && validDay(r.date) && Number.isSafeInteger(r.cents) &&
    (r.cents as number) > 0 && (r.cents as number) <= AMOUNT_MAX && CURRENCIES.includes(r.currency as Currency) && from !== "";
  return good ? { id: r.id as string, source: cleanShown(r.source, NAME_MAX), date: r.date as string, cents: r.cents as number,
    currency: r.currency as Currency, from } : null;
};

export function readMoneyFeed(raw: unknown): MoneyFeed | null {
  if (!plain(raw)) return null;
  const at = madeAt(raw);
  return at === null ? null : { at, items: rows(raw.items, ITEMS_MAX, readItem), sources: rows(raw.sources, 8, readSource) };
}

const readProject = (r: Record<string, unknown>): WorkProject | null => {
  const name = cleanShown(r.name, TEXT_MAX);
  return name ? { name, group: cleanShown(r.group, NAME_MAX), status: cleanShown(r.status, NAME_MAX), touched: dayOrEmpty(r.touched),
    note: cleanShown(r.note, TEXT_MAX) } : null;
};

const readDue = (r: Record<string, unknown>): WorkDue | null => {
  const text = cleanShown(r.text, TEXT_MAX);
  return text ? { text, date: dayOrEmpty(r.date), late: r.late === true } : null;
};

const readWaiting = (r: Record<string, unknown>): WorkWaiting | null => {
  const text = cleanShown(r.text, TEXT_MAX);
  return text ? { text, date: dayOrEmpty(r.date), who: cleanShown(r.who, NAME_MAX) } : null;
};

export function readWorkFeed(raw: unknown): WorkFeed | null {
  if (!plain(raw)) return null;
  const at = madeAt(raw);
  return at === null ? null : { at, projects: rows(raw.projects, WORK_MAX, readProject), due: rows(raw.due, WORK_MAX, readDue),
    waiting: rows(raw.waiting, WORK_MAX, readWaiting) };
}

const readThread = (r: Record<string, unknown>): MailThread | null => {
  const subject = cleanShown(r.subject, TEXT_MAX) || "(no subject)";
  if (typeof r.id !== "string" || !THREAD_ID.test(r.id) || !PILES.includes(r.pile as Pile)) return null;
  const when = typeof r.when === "string" ? Date.parse(r.when) : Number.NaN;
  // A draft is kept with its line breaks, which are the reply's own, and otherwise cleaned as any other outside text.
  const draft = r.pile === "reply" && typeof r.draft === "string"
    ? r.draft.split("\n").map((line) => cleanShown(line, DRAFT_MAX)).join("\n").trim().slice(0, DRAFT_MAX) : "";
  return { id: r.id, account: cleanShown(r.account, NAME_MAX), from: cleanShown(r.from, TEXT_MAX), subject,
    when: Number.isFinite(when) ? when : 0, pile: r.pile as Pile, line: cleanShown(r.line, TEXT_MAX), draft };
};

export function readMailFeed(raw: unknown): MailFeed | null {
  if (!plain(raw)) return null;
  const at = madeAt(raw);
  return at === null ? null : { at, accounts: rows(raw.accounts, 8, readSource), threads: rows(raw.threads, THREADS_MAX, readThread) };
}

/** The income row a feed's item becomes: the same id from any device, so confirming twice is one amount in. */
export const feedEntryId = (id: string): string => `f-${id}`;

/** What still waits for the user's confirm: not yet in the user's money, and not one the user said is not the user's. */
export function pendingMoney(feed: MoneyFeed | null, money: Money): MoneyItem[] {
  if (!feed) return [];
  const have = new Set(money.entries.map((e) => e.id));
  const skipped = new Set(money.skipped);
  return feed.items.filter((i) => !have.has(feedEntryId(i.id)) && !skipped.has(i.id));
}

const LIKELY_DAYS = 10;
const DAY_MS = 86_400_000;

/**
 * A row already in the user's money that looks like this same money: the same amount within a few days, typed by the user or
 * confirmed from another source (a payment can show in both Stripe and the CRM). Never decided for the user.
 */
export function typedAlready(item: MoneyItem, money: Money): { from: string; date: string } | null {
  const at = Date.parse(`${item.date}T12:00:00Z`);
  const same = money.entries.find((e) => e.cents === item.cents && e.currency === item.currency && e.id !== feedEntryId(item.id) &&
    Math.abs(Date.parse(`${e.date}T12:00:00Z`) - at) <= LIKELY_DAYS * DAY_MS);
  return same ? { from: same.from, date: same.date } : null;
}

export type FeedStatus = "idle" | "loading" | "ok" | "empty" | "signin" | "offline" | "missing" | "refused" | "app-only";

export interface Feeds {
  money: { feed: MoneyFeed | null; status: FeedStatus };
  work: { feed: WorkFeed | null; status: FeedStatus };
  mail: { feed: MailFeed | null; status: FeedStatus };
}

export const emptyFeeds = (): Feeds => ({
  money: { feed: null, status: "idle" }, work: { feed: null, status: "idle" }, mail: { feed: null, status: "idle" },
});

export type FeedReply = { ok: true; feed: unknown } | { ok: false; why: "offline" | "signin" | "missing" | "refused" };
export type Get = (options: HttpOptions) => Promise<HttpResponse>;

export const FEED_DEADLINE_MS = 20000;

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Reads one feed with native HTTP, the session as the bearer; a redirect is never followed, so it never travels on. Never throws. */
export async function getFeed(worker: string, session: string, kind: FeedKind, send: Get = (o) => CapacitorHttp.get(o),
  deadline = FEED_DEADLINE_MS): Promise<FeedReply> {
  let response: HttpResponse | null;
  try {
    response = await withDeadline(send({ url: `${worker}/app/feed/${kind}`, responseType: "json", disableRedirects: true,
      connectTimeout: 10000, readTimeout: 15000, headers: { Accept: "application/json", Authorization: `Bearer ${session}` } }), deadline);
  } catch {
    response = null;
  }
  if (response === null) return { ok: false, why: "offline" };
  if (response.status === 401) return { ok: false, why: "signin" };
  if (response.status === 404) return { ok: false, why: "missing" };
  const body: unknown = response.data;
  if (response.status !== 200 || !plain(body) || body.ok !== true) return { ok: false, why: "refused" };
  return { ok: true, feed: body.feed ?? null };
}
