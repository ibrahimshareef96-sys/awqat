/**
 * External feeds (feeds/feeds.ts): read when their screen opens or the app comes back, at most once a minute
 * each, and kept in memory. What Money does with one is one tap of confirm: nothing is added by itself.
 */
import { isNative } from "../device.ts";
import { FEED_KINDS, emptyFeeds, getFeed, readMailFeed, readMoneyFeed, readWorkFeed, type FeedKind, type FeedStatus, type Get } from "../feeds/feeds.ts";
import { clearSession, sessionToken } from "../talk/session.ts";
import { workerUrl } from "../voice.ts";
import { hooks, state } from "./state.ts";

export const FEED_GAP_MS = 60_000;

const lastRead: Partial<Record<FeedKind, number>> = {};
const reading = new Set<FeedKind>();

function show(kind: FeedKind, raw: unknown, status: FeedStatus): void {
  if (kind === "money") state.feeds = { ...state.feeds, money: { feed: raw === undefined ? state.feeds.money.feed : readMoneyFeed(raw), status } };
  if (kind === "work") state.feeds = { ...state.feeds, work: { feed: raw === undefined ? state.feeds.work.feed : readWorkFeed(raw), status } };
  if (kind === "mail") state.feeds = { ...state.feeds, mail: { feed: raw === undefined ? state.feeds.mail.feed : readMailFeed(raw), status } };
}

/** Everything read from the feeds, gone: what a signed-in session showed is not for whoever holds the phone after it. */
export function forgetFeeds(): void {
  state.feeds = emptyFeeds();
  state.mailCopied = null;
  for (const kind of FEED_KINDS) delete lastRead[kind];
}

/** The session the feeds were read under. */
let owner: string | null = null;

const currentToken = (): string | null => sessionToken(state.talk.session, workerUrl(state.settings.voiceUrl));

/**
 * The feeds belong to the session that read them. Checked on every redraw, so however a session ends (a sign-out, a
 * refusal from any of the sync routes, another Worker, a new sign-in) nothing it showed is drawn again.
 */
export function keepFeedsToSession(): void {
  const token = currentToken();
  if (token === owner) return;
  if (owner !== null) forgetFeeds();
  owner = token;
}

/** Reads one feed if it is due, or at once when the user asked. What was last read stays on screen if this one fails. Never rejects. */
export async function refreshFeed(kind: FeedKind, asked = false, now = Date.now(), send?: Get): Promise<void> {
  if (!isNative()) {
    show(kind, undefined, "app-only");
    return hooks.softRender();
  }
  if (!state.talk.sessionRead) return;
  keepFeedsToSession();
  const worker = workerUrl(state.settings.voiceUrl);
  const token = currentToken();
  // Before anything that could put this off, so a screen with no session says so at once.
  if (!worker || token === null) {
    show(kind, undefined, "signin");
    return hooks.softRender();
  }
  if (reading.has(kind)) return;
  if (!asked && now - (lastRead[kind] ?? Number.NEGATIVE_INFINITY) < FEED_GAP_MS) return;
  reading.add(kind);
  try {
    show(kind, undefined, "loading");
    hooks.softRender();
    lastRead[kind] = now;
    const reply = await getFeed(worker, token, kind, send);
    // Signed out, or another session, while this was on its way: this answer belongs to no one on screen.
    if (currentToken() !== token) {
      keepFeedsToSession();
      show(kind, undefined, currentToken() === null ? "signin" : "idle");
      return;
    }
    if (reply.ok) {
      show(kind, reply.feed, reply.feed === null ? "empty" : "ok");
    } else if (reply.why === "signin") {
      // The Worker no longer knows this session: it is dropped, as Talk and the shelf drop it.
      forgetFeeds();
      show(kind, undefined, "signin");
      state.talk = { ...state.talk, session: null };
      await clearSession();
    } else {
      show(kind, undefined, reply.why);
    }
  } finally {
    reading.delete(kind);
    hooks.softRender();
  }
}

/** The feed a screen shows, if it shows one: Agenda and the Weekly Review show what the Work feed has due. */
export const feedOfScreen = (screen: string): FeedKind | null =>
  (screen === "money" ? "money" : screen === "work" || screen === "agenda" || screen === "review" ? "work"
    : screen === "inbox" ? "mail" : null);

export const isFeedKind = (value: string): value is FeedKind => (FEED_KINDS as readonly string[]).includes(value);

/** Puts a mail's draft on the clipboard: the only thing the app can do with one. Nothing is ever sent from here. */
export async function copyDraft(id: string): Promise<boolean> {
  const draft = state.feeds.mail.feed?.threads.find((t) => t.id === id)?.draft ?? "";
  if (!draft) return false;
  try {
    await navigator.clipboard.writeText(draft);
    return true;
  } catch {
    return false;
  }
}
