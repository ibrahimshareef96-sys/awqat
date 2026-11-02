// When a feed is read, and that what a session showed goes with the session.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
  CapacitorHttp: { get: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("../src/talk/session.ts", async (real) => ({ ...(await real<typeof import("../src/talk/session.ts")>()), clearSession: vi.fn(async () => undefined) }));

import { FEED_GAP_MS, feedOfScreen, forgetFeeds, keepFeedsToSession, refreshFeed } from "../src/app/feedActions.ts";
import { hooks, state } from "../src/app/state.ts";
import type { Get } from "../src/feeds/feeds.ts";

const WORKER = "https://worker.example";
const TOKEN = "t".repeat(43);
const mail = { v: 1, at: 1000, accounts: [], threads: [{ id: "a1", account: "x", from: "Name", subject: "Private", when: "", pile: "reply", line: "", draft: "Secret reply" }] };
const answer = (status: number, data: unknown): Get => vi.fn(async () => ({ status, data, headers: {}, url: "" }));
let session: typeof state.talk.session;

beforeEach(() => {
  hooks.softRender = vi.fn();
  forgetFeeds();
  state.settings = { ...state.settings, voiceUrl: WORKER };
  session = { token: TOKEN, worker: WORKER } as never;
  state.talk = { ...state.talk, sessionRead: true, session };
});

describe("the feed a screen reads", () => {
  it("is the Work feed for Work, and for Agenda and the Weekly Review, which show what is due", () => {
    expect(feedOfScreen("work")).toBe("work");
    expect(feedOfScreen("agenda")).toBe("work");
    expect(feedOfScreen("review")).toBe("work");
    expect(feedOfScreen("money")).toBe("money");
    expect(feedOfScreen("inbox")).toBe("mail");
    expect(feedOfScreen("home")).toBeNull();
  });
});

describe("reading a feed", () => {
  it("shows what the Worker sent, and at most once a minute unless the user asked", async () => {
    const send = answer(200, { ok: true, feed: mail });
    await refreshFeed("mail", false, 1_000_000, send);
    expect(state.feeds.mail.feed?.threads[0].subject).toBe("Private");
    await refreshFeed("mail", false, 1_000_000 + FEED_GAP_MS - 1, send);
    expect(send).toHaveBeenCalledTimes(1);
    await refreshFeed("mail", true, 1_000_000 + 1, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps what it has when a refresh cannot get through", async () => {
    await refreshFeed("mail", true, 1, answer(200, { ok: true, feed: mail }));
    await refreshFeed("mail", true, 2, answer(500, {}));
    expect(state.feeds.mail).toMatchObject({ status: "refused" });
    expect(state.feeds.mail.feed?.threads.length).toBe(1);
  });

  it("says when the feed source has not sent one yet", async () => {
    await refreshFeed("work", true, 1, answer(200, { ok: true, feed: null }));
    expect(state.feeds.work).toEqual({ feed: null, status: "empty" });
  });
});

describe("after the session has gone", () => {
  it("clears every feed the moment a screen opens with no session, however recently it read", async () => {
    await refreshFeed("mail", true, 1, answer(200, { ok: true, feed: mail }));
    state.mailCopied = "a1";
    state.talk = { ...state.talk, session: null };
    await refreshFeed("mail", false, 2);
    expect(state.feeds.mail).toEqual({ feed: null, status: "signin" });
    expect(state.mailCopied).toBeNull();
  });

  it("clears everything when the Worker no longer knows the session", async () => {
    await refreshFeed("mail", true, 1, answer(200, { ok: true, feed: mail }));
    await refreshFeed("work", true, 2, answer(401, {}));
    expect(state.feeds.mail.feed).toBeNull();
    expect(state.feeds.work).toEqual({ feed: null, status: "signin" });
    expect(state.talk.session).toBeNull();
  });

  it("drops an answer that arrives after a sign-out", async () => {
    let release: (v: Awaited<ReturnType<Get>>) => void = () => undefined;
    const send: Get = () => new Promise((resolve) => { release = resolve; });
    const going = refreshFeed("mail", true, 1, send);
    await Promise.resolve();
    state.talk = { ...state.talk, session: null };
    forgetFeeds();
    release({ status: 200, data: { ok: true, feed: mail }, headers: {}, url: "" });
    await going;
    expect(state.feeds.mail.feed).toBeNull();
  });

  it("says sign in, not a stuck reading, for an answer that came back to no session", async () => {
    let release: (v: Awaited<ReturnType<Get>>) => void = () => undefined;
    const send: Get = () => new Promise((resolve) => { release = resolve; });
    const going = refreshFeed("work", true, 1, send);
    await Promise.resolve();
    state.talk = { ...state.talk, session: null };
    release({ status: 200, data: { ok: true, feed: { v: 1, at: 1 } }, headers: {}, url: "" });
    await going;
    expect(state.feeds.work).toEqual({ feed: null, status: "signin" });
  });

  it("clears on the next redraw, whichever path ended the session", async () => {
    await refreshFeed("mail", true, 1, answer(200, { ok: true, feed: mail }));
    state.mailCopied = "a1";
    // A sync route dropping the session sets this and nothing else.
    state.talk = { ...state.talk, session: null };
    keepFeedsToSession();
    expect(state.feeds.mail.feed).toBeNull();
    expect(state.mailCopied).toBeNull();
  });

  it("clears when another session or another Worker takes over", async () => {
    await refreshFeed("mail", true, 1, answer(200, { ok: true, feed: mail }));
    state.talk = { ...state.talk, session: { token: "n".repeat(43), worker: WORKER } as never };
    keepFeedsToSession();
    expect(state.feeds.mail.feed).toBeNull();
    await refreshFeed("mail", true, 2, answer(200, { ok: true, feed: mail }));
    expect(state.feeds.mail.feed).not.toBeNull();
    state.settings = { ...state.settings, voiceUrl: "https://other.example" };
    keepFeedsToSession();
    expect(state.feeds.mail.feed).toBeNull();
  });

  it("leaves them alone on a redraw under the same session", async () => {
    await refreshFeed("mail", true, 1, answer(200, { ok: true, feed: mail }));
    keepFeedsToSession();
    expect(state.feeds.mail.feed).not.toBeNull();
  });

  it("forgets on request, so the next read goes at once", async () => {
    const send = answer(200, { ok: true, feed: mail });
    await refreshFeed("mail", false, 1_000_000, send);
    forgetFeeds();
    expect(state.feeds.mail.feed).toBeNull();
    await refreshFeed("mail", false, 1_000_001, send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
