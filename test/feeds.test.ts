// External feeds: every row is checked again here, nothing is added to the user's money by itself, and a mail's words
// are only ever shown, escaped, never acted on.
import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  CapacitorHttp: { get: vi.fn() },
  registerPlugin: () => ({}),
}));

import {
  feedEntryId, getFeed, pendingMoney, readMailFeed, readMoneyFeed, readWorkFeed, typedAlready, type Get,
} from "../src/feeds/feeds.ts";
import { addIncome, checkMoney, emptyMoney, removeIncome, skipFeedItem } from "../src/money/money.ts";
import { moneyCollection } from "../src/sync/collections.ts";
import { inboxView, sentLine, workView } from "../src/ui/feedViews.ts";
import { moneyView } from "../src/ui/moneyView.ts";

const item = { id: "stripe-ch-1", source: "stripe", date: "2026-10-28", cents: 5000, currency: "USD", from: "Corner Bakery sale" };
const feed = (items: unknown[]) => readMoneyFeed({ v: 1, at: 1000, items, sources: [] });

describe("reading a money feed", () => {
  it("takes good rows and leaves out any it cannot read", () => {
    const f = feed([item, { ...item, id: "bad id" }, { ...item, id: "a", currency: "EUR" }, { ...item, id: "b", cents: -5 }, { ...item, id: "c", cents: 1.5 },
      { ...item, id: "d", date: "2026-02-31" }, { ...item, id: "e", from: "" }, "nonsense", null]);
    expect(f?.items.map((i) => i.id)).toEqual(["stripe-ch-1"]);
  });

  it("refuses a feed of another version or with no time", () => {
    expect(readMoneyFeed({ v: 2, at: 1, items: [] })).toBeNull();
    expect(readMoneyFeed({ v: 1, items: [] })).toBeNull();
    expect(readMoneyFeed({ v: 1, at: Number.NaN, items: [] })).toBeNull();
    expect(readMoneyFeed(null)).toBeNull();
    expect(readMoneyFeed([])).toBeNull();
  });

  it("holds at most 200 rows, whatever is sent", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...item, id: `x-${i}` }));
    expect(feed(many)?.items.length).toBe(200);
  });

  it("drops the characters that hide or reverse text", () => {
    const hidden = String.fromCodePoint(0x202e);
    expect(feed([{ ...item, from: `Kit${hidden} sale` }])?.items[0].from).toBe("Kit sale");
  });
});

describe("what waits for the user's confirm", () => {
  const f = feed([item, { ...item, id: "crm-inv-1", cents: 1200000, currency: "AED", from: "Acme Studio, INV-1" }]);

  it("is every item not in the user's money, and nothing is added by itself", () => {
    const m = emptyMoney();
    expect(pendingMoney(f, m).map((i) => i.id)).toEqual(["stripe-ch-1", "crm-inv-1"]);
    expect(m.entries).toEqual([]);
    expect(pendingMoney(null, m)).toEqual([]);
  });

  it("no longer holds what the user confirmed, however many devices tapped it: the id is the same", () => {
    const row = { id: feedEntryId(item.id), date: item.date, cents: item.cents, currency: "USD" as const, from: item.from };
    const once = addIncome(emptyMoney(), row);
    const twice = addIncome(once, row);
    expect(twice.entries.length).toBe(1);
    expect(pendingMoney(f, twice).map((i) => i.id)).toEqual(["crm-inv-1"]);
  });

  it("does not offer again what the user left out", () => {
    const m = skipFeedItem(emptyMoney(), item.id);
    expect(pendingMoney(f, m).map((i) => i.id)).toEqual(["crm-inv-1"]);
    expect(skipFeedItem(m, item.id)).toBe(m);
  });

  it("does not offer again a confirmed row the user then removed", () => {
    const row = { id: feedEntryId(item.id), date: item.date, cents: item.cents, currency: "USD" as const, from: item.from };
    const m = removeIncome(addIncome(emptyMoney(), row), row.id);
    expect(m.entries).toEqual([]);
    expect(pendingMoney(f, m).map((i) => i.id)).toEqual(["crm-inv-1"]);
  });

  it("leaves a typed row's removal alone", () => {
    const row = { id: "m1-2", date: item.date, cents: 100, currency: "AED" as const, from: "Someone" };
    expect(removeIncome(addIncome(emptyMoney(), row), row.id).skipped).toEqual([]);
  });

  it("says when the user seems to have typed this money already, and decides nothing", () => {
    const typed = addIncome(emptyMoney(), { id: "m1-2", date: "2026-10-25", cents: 5000, currency: "USD", from: "Kit sale" });
    const [first] = f?.items ?? [];
    expect(typedAlready(first, typed)).toEqual({ from: "Kit sale", date: "2026-10-25" });
    expect(typedAlready(first, addIncome(emptyMoney(), { id: "m1-3", date: "2026-08-01", cents: 5000, currency: "USD", from: "Old" }))).toBeNull();
    expect(typedAlready(first, addIncome(emptyMoney(), { id: "m1-4", date: "2026-10-25", cents: 5000, currency: "AED", from: "Other" }))).toBeNull();
    expect(pendingMoney(f, typed).length).toBe(2);
  });

  it("says so too when the same money was confirmed from another source", () => {
    const stripe = { ...item, id: "stripe-ch-2", cents: 9900, currency: "USD" as const };
    const crm = { ...stripe, id: "crm-2", source: "crm" };
    const m = addIncome(emptyMoney(), { id: feedEntryId(stripe.id), date: stripe.date, cents: 9900, currency: "USD", from: "Kit" });
    expect(typedAlready(crm as never, m)).toEqual({ from: "Kit", date: stripe.date });
  });

  it("keeps what the user left out across a save and across the user's devices", () => {
    const m = skipFeedItem(emptyMoney(), item.id);
    expect(checkMoney(JSON.stringify(m)).money.skipped).toEqual([item.id]);
    expect(checkMoney(JSON.stringify({ ...m, skipped: ["ok-1", "not ok", 5] })).money.skipped).toEqual(["ok-1"]);
    expect(checkMoney(JSON.stringify({ v: 1, entries: [], owed: [], commitments: [] })).money.skipped).toEqual([]);
    const records = moneyCollection.toRecords(m).map((r) => ({ ...r, at: 1, stamp: 1 }));
    expect(moneyCollection.fromRecords(records as never, emptyMoney()).skipped).toEqual([item.id]);
  });
});

describe("the Money screen", () => {
  const f = feed([item]);
  const html = (armed: string | null = null) => moneyView({ money: emptyMoney(), today: "2026-10-30", armed, feed: f }, "", "", "");

  it("shows what to confirm, with one tap to count it and two to leave it out", () => {
    expect(html()).toContain("TO CONFIRM");
    expect(html()).toContain('data-action="money-confirm" data-value="stripe-ch-1"');
    expect(html()).toContain("USD 50");
    expect(html("skip:stripe-ch-1")).toContain("Tap again to leave it out");
  });

  it("shows nothing extra with no feed, or a source that is simply not set up", () => {
    const none = moneyView({ money: emptyMoney(), today: "2026-10-30", armed: null }, "", "", "");
    expect(none).not.toContain("TO CONFIRM");
    const quiet = readMoneyFeed({ v: 1, at: 1, items: [], sources: [{ name: "crm", ok: false, why: "not set up" }] });
    expect(moneyView({ money: emptyMoney(), today: "2026-10-30", armed: null, feed: quiet }, "", "", "")).not.toContain("TO CONFIRM");
  });

  it("says when a source that is set up failed", () => {
    const failed = readMoneyFeed({ v: 1, at: 1, items: [], sources: [{ name: "stripe", ok: false, why: "could not be reached" }] });
    expect(moneyView({ money: emptyMoney(), today: "2026-10-30", armed: null, feed: failed }, "", "", "")).toContain("stripe: could not be reached");
  });
});

describe("the work feed", () => {
  const raw = { v: 1, at: 1000, projects: [{ name: "Example Planner", group: "Internal", status: "Active", touched: "2026-10-31", note: "Note" },
    { name: "" }, { name: "Client A", group: "Clients", status: "Paused", touched: "bad", note: "" }],
    due: [{ text: "Send it", date: "2026-11-01", late: false }, { text: "Old one", date: "2026-10-01", late: true }, { text: "" }],
    waiting: [{ text: "Y to reply", date: "2026-10-20", who: "Y" }] };

  it("is read row by row, and groups the projects", () => {
    const f = readWorkFeed(raw);
    expect(f?.projects.map((p) => p.name)).toEqual(["Example Planner", "Client A"]);
    expect(f?.projects[1].touched).toBe("");
    expect(f?.due.length).toBe(2);
    const html = workView({ feed: f, status: "ok", now: 1000 + 12 * 60_000 }, "", "", "");
    expect(html).toContain("INTERNAL");
    expect(html).toContain("CLIENTS");
    expect(html).toContain("LATE");
    expect(html).toContain("WAITING ON OTHERS");
    expect(html).toContain("From the feed source, 12 min ago");
  });

  it("reads a due item's time when it is one, on the day's own clock, and shows it", () => {
    const f = readWorkFeed({ ...raw, due: [{ text: "Call", date: "2026-11-04", time: "14:30", late: false },
      { text: "Bad time", date: "2026-11-04", time: "2:30pm" }, { text: "Time, no day", date: "", time: "09:00" },
      { text: "No time", date: "2026-11-04" }] });
    expect(f?.due.map((d) => d.time)).toEqual(["14:30", "", "", ""]);
    expect(workView({ feed: f, status: "ok", now: 1000 }, "", "", "")).toContain("Due 4 Nov, 14:30");
  });

  it("says what is wrong when there is nothing to show", () => {
    const empty = (status: "signin" | "missing" | "offline" | "empty" | "app-only") => workView({ feed: null, status, now: 0 }, "", "", "");
    expect(empty("signin")).toContain("Sign in to Talk");
    expect(empty("missing")).toContain("has not been updated");
    expect(empty("offline")).toContain("Could not reach");
    expect(empty("empty")).toContain("has not sent this yet");
    expect(empty("app-only")).toContain("installed app");
  });

  it("keeps what it has on screen when a refresh fails, and says so", () => {
    const html = workView({ feed: readWorkFeed(raw), status: "offline", now: 2000 }, "", "", "");
    expect(html).toContain("Could not reach");
    expect(html).toContain("Example Planner");
  });

  it("says when the feed source has gone quiet", () => {
    expect(sentLine(0, 4 * 60 * 60_000)).toContain("is it awake");
    expect(sentLine(0, 60_000)).not.toContain("is it awake");
  });

  it("does not take a time still to come for a fresh one", () => {
    expect(sentLine(10 * 60_000, 0)).toContain("Check its clock");
    expect(sentLine(60_000, 0)).toContain("just now");
  });
});

describe("the mail feed", () => {
  const thread = { id: "a1b2", account: "example.com", from: "Name", subject: "Hello", when: "2026-10-31T09:12:00+04:00", pile: "reply", line: "Wants a call", draft: "Yes,\nthank you." };
  const read = (threads: unknown[]) => readMailFeed({ v: 1, at: 1000, accounts: [{ name: "gmail", ok: false, why: "not set up" }], threads });

  it("leaves out a row with an unknown pile or a bad id, and a draft on anything but a reply", () => {
    const f = read([thread, { ...thread, id: "b", pile: "delete" }, { ...thread, id: "bad id" }, { ...thread, id: "c", pile: "read" }]);
    expect(f?.threads.map((t) => t.id)).toEqual(["a1b2", "c"]);
    expect(f?.threads[1].draft).toBe("");
  });

  it("keeps a draft's own line breaks and holds it to its limit", () => {
    const f = read([thread, { ...thread, id: "long", draft: "x".repeat(5000) }]);
    expect(f?.threads[0].draft).toBe("Yes,\nthank you.");
    expect(f?.threads[1].draft.length).toBe(1200);
  });

  it("shows a mail's words as text only: nothing in one can become markup", () => {
    const attack = "<img src=x onerror=alert(1)>";
    const f = read([{ ...thread, subject: attack, from: attack, line: attack, draft: attack }]);
    const html = inboxView({ feed: f, status: "ok", now: 2000, tz: "Asia/Dubai", copied: null }, "", "", "");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("has no way to send: copying a draft is all it can do", () => {
    const html = inboxView({ feed: read([thread]), status: "ok", now: 2000, tz: "Asia/Dubai", copied: null }, "", "", "");
    expect(html).toContain('data-action="mail-copy"');
    expect(html).not.toMatch(/data-action="[^"]*send[^"]*"/);
    expect(html).toContain("Nothing is sent from here");
  });

  it("sorts into piles, folds what can wait, and says an account is not set up", () => {
    const f = read([thread, { ...thread, id: "r", pile: "read" }, { ...thread, id: "s", pile: "skip" }]);
    const html = inboxView({ feed: f, status: "ok", now: 2000, tz: "Asia/Dubai", copied: "a1b2" }, "", "", "");
    expect(html).toContain("NEEDS YOU");
    expect(html).toContain("WORTH A LOOK");
    expect(html).toContain('<details id="mail-skip">');
    expect(html).toContain("gmail: not set up");
    expect(html).toContain("Copied");
  });

  it("marks a mail's line as the model's reading, so it is never taken for the app's own words", () => {
    const html = inboxView({ feed: read([thread]), status: "ok", now: 2000, tz: "Asia/Dubai", copied: null }, "", "", "");
    expect(html).toContain("The model&#39;s reading: Wants a call");
    expect(html).toContain("check the mail itself");
  });

  it("says so when there is nothing new", () => {
    expect(inboxView({ feed: read([]), status: "ok", now: 2000, tz: "Asia/Dubai", copied: null }, "", "", "")).toContain("Nothing new");
  });
});

describe("asking the Worker", () => {
  const reply = (status: number, data: unknown): Get => async () => ({ status, data, headers: {}, url: "" });

  it("sends the session as the bearer, to that kind's address, following no redirect", async () => {
    const send = vi.fn(reply(200, { ok: true, feed: { v: 1 } }));
    await getFeed("https://w.example", "tok", "mail", send);
    const options = send.mock.calls[0][0];
    expect(options.url).toBe("https://w.example/app/feed/mail");
    expect(options.headers?.Authorization).toBe("Bearer tok");
    expect(options.disableRedirects).toBe(true);
  });

  it("says why when it did not work", async () => {
    expect(await getFeed("w", "t", "work", reply(200, { ok: true, feed: { v: 1 } }))).toEqual({ ok: true, feed: { v: 1 } });
    expect(await getFeed("w", "t", "work", reply(200, { ok: true, feed: null }))).toEqual({ ok: true, feed: null });
    expect(await getFeed("w", "t", "work", reply(401, {}))).toEqual({ ok: false, why: "signin" });
    expect(await getFeed("w", "t", "work", reply(404, {}))).toEqual({ ok: false, why: "missing" });
    expect(await getFeed("w", "t", "work", reply(500, {}))).toEqual({ ok: false, why: "refused" });
    expect(await getFeed("w", "t", "work", reply(200, "<html>"))).toEqual({ ok: false, why: "refused" });
    expect(await getFeed("w", "t", "work", async () => { throw new Error("no net"); })).toEqual({ ok: false, why: "offline" });
  });

  it("gives up after its deadline", async () => {
    const never: Get = () => new Promise(() => undefined);
    expect(await getFeed("w", "t", "work", never, 5)).toEqual({ ok: false, why: "offline" });
  });
});
