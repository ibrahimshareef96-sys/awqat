/** Work and Inbox: what the feed source last sent, read only. Inbox can copy a draft and nothing more: nothing is sent from here. */
import type { FeedSource, FeedStatus, MailFeed, MailThread, WorkFeed, WorkProject } from "../feeds/feeds.ts";
import { esc } from "./html.ts";

const MINUTE_MS = 60_000;
/** Older than this, it says so: the job on the feed source runs every half hour. */
const STALE_MS = 3 * 60 * MINUTE_MS;

const dayText = (day: string): string =>
  (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

/** A time this far ahead is the feed source's clock, or not the feed source: it cannot be read as fresh. */
const AHEAD_MS = 5 * MINUTE_MS;

/** "From the feed source, 12 min ago", in a few words. */
export function sentLine(at: number, now: number): string {
  if (at - now > AHEAD_MS) return "From the feed source, at a time that has not come yet. Check its clock.";
  const minutes = Math.max(0, Math.round((now - at) / MINUTE_MS));
  const ago = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago`
    : `${Math.round(minutes / 1440)} days ago`;
  return `From the feed source, ${ago}${now - at > STALE_MS ? ". It has not sent anything newer: is it awake?" : ""}`;
}

const STATUS_LINE: Readonly<Record<FeedStatus, string>> = {
  idle: "", ok: "", loading: "Reading what the feed source sent…",
  empty: "The feed source has not sent this yet.",
  signin: "Sign in to Talk in Settings to read this.",
  offline: "Could not reach your Worker. Check the connection.",
  missing: "Your Worker has not been updated for this yet.",
  refused: "Your Worker did not answer as expected.",
  "app-only": "This works in the installed app.",
};

function statusCard(status: FeedStatus, hasFeed: boolean, kind: string): string {
  // With nothing to show, the screen is never left blank with no way on.
  const line = STATUS_LINE[status] || (hasFeed ? "" : "Nothing to show yet.");
  // With a copy on screen a refresh going on is quiet; a failure still says so.
  if (!line || (hasFeed && status === "loading")) return "";
  return `<section class="card"><p class="text" role="status">${esc(line)}</p><div class="row-buttons"><button type="button" class="pill" ` +
    `data-action="feed-refresh" data-value="${esc(kind)}"${status === "loading" ? " disabled" : ""}>Try again</button></div></section>`;
}

const foot = (at: number, now: number, kind: string): string =>
  `<p class="foot">${esc(sentLine(at, now))} <button type="button" class="ghost-link" data-action="feed-refresh" data-value="${esc(kind)}">Refresh</button></p>`;

const sourceLine = (rows: readonly FeedSource[]): string => {
  const off = rows.filter((s) => !s.ok);
  return off.length === 0 ? "" : `<p class="small">${off.map((s) => esc(`${s.name}: ${s.why || "could not be read"}`)).join(" · ")}</p>`;
};

export interface WorkModel { feed: WorkFeed | null; status: FeedStatus; now: number }

function projectRow(p: WorkProject): string {
  const when = p.touched ? `Touched ${dayText(p.touched)}` : "";
  const sub = [p.status, when].filter(Boolean).join(" · ");
  return `<li class="money-row"><span class="col"><span class="check-name">${esc(p.name)}</span>` +
    `${sub ? `<span class="small">${esc(sub)}</span>` : ""}${p.note ? `<span class="small">${esc(p.note)}</span>` : ""}</span></li>`;
}

function projectGroups(projects: readonly WorkProject[]): string {
  const groups = [...new Set(projects.map((p) => p.group || "Projects"))];
  // Folded: there can be sixty of them, and what is due comes first.
  return groups.map((g, i) => {
    const these = projects.filter((p) => (p.group || "Projects") === g);
    return `<section class="card" aria-label="${esc(g)}"><details id="work-group-${i}"><summary class="label">${esc(g.toUpperCase())} · ${these.length}</summary>` +
      `<ul class="plain">${these.map(projectRow).join("")}</ul></details></section>`;
  }).join("");
}

export function workView(m: WorkModel, head: string, notice: string, chrome: string): string {
  const feed = m.feed;
  if (!feed) return `<main class="screen single">${head}${notice}${statusCard(m.status, false, "work")}</main>${chrome}`;
  const due = feed.due.length === 0 ? "" : `<section class="card" aria-label="Due"><h2 class="label">DUE</h2><ul class="plain">${feed.due.map((d) =>
    `<li class="money-row"><span class="col"><span class="check-name">${esc(d.text)}</span>${d.date ? `<span class="small">${d.late ? "Was due" : "Due"} ${esc(dayText(d.date))}</span>` : ""}</span>` +
    `${d.late ? `<span class="label accent">LATE</span>` : ""}</li>`).join("")}</ul></section>`;
  const waiting = feed.waiting.length === 0 ? "" : `<section class="card" aria-label="Waiting on others"><details id="work-waiting"><summary class="label">WAITING ON OTHERS · ${feed.waiting.length}</summary><ul class="plain">` +
    `${feed.waiting.map((w) => `<li class="money-row"><span class="col"><span class="check-name">${esc(w.text)}</span>` +
      `${w.date ? `<span class="small">Since ${esc(dayText(w.date))}</span>` : ""}</span></li>`).join("")}</ul></details></section>`;
  return `<main class="screen single">${head}${notice}${statusCard(m.status === "ok" ? "idle" : m.status, true, "work")}${due}${waiting}${projectGroups(feed.projects)}` +
    `${foot(feed.at, m.now, "work")}</main>${chrome}`;
}

export interface MailModel { feed: MailFeed | null; status: FeedStatus; now: number; tz: string; copied: string | null }

const PILE_TITLE = { reply: "NEEDS YOU", read: "WORTH A LOOK", skip: "SKIP" } as const;

function whenText(at: number, tz: string): string {
  return at > 0 ? new Date(at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }) : "";
}

function threadRow(t: MailThread, m: MailModel): string {
  const sub = [t.from, t.account, whenText(t.when, m.tz)].filter(Boolean).join(" · ");
  const copied = m.copied === t.id;
  const draft = t.draft ? `<details id="mail-draft-${esc(t.id)}" class="mail-draft"><summary class="small">A reply you could send</summary>` +
    `<p class="text mail-draft-text" dir="auto">${esc(t.draft)}</p><div class="row-buttons"><button type="button" class="pill" data-action="mail-copy" ` +
    `data-value="${esc(t.id)}">${copied ? "Copied" : "Copy it"}</button></div></details>` : "";
  return `<li class="money-row mail-row"><span class="col"><span class="check-name" dir="auto">${esc(t.subject)}</span><span class="small" dir="auto">${esc(sub)}</span>` +
    `${t.line ? `<span class="small" dir="auto">${esc(`The model's reading: ${t.line}`)}</span>` : ""}</span>${draft}</li>`;
}

function pileCard(pile: keyof typeof PILE_TITLE, m: MailModel, threads: readonly MailThread[]): string {
  const these = threads.filter((t) => t.pile === pile);
  if (these.length === 0) return "";
  const body = `<ul class="plain">${these.map((t) => threadRow(t, m)).join("")}</ul>`;
  // What can wait stays folded.
  return pile === "skip"
    ? `<section class="card"><details id="mail-skip"><summary class="label">${PILE_TITLE[pile]} · ${these.length}</summary>${body}</details></section>`
    : `<section class="card" aria-label="${PILE_TITLE[pile]}"><div class="split"><h2 class="label${pile === "reply" ? " accent" : ""}">${PILE_TITLE[pile]}</h2>` +
      `<span class="small">${these.length}</span></div>${body}</section>`;
}

export function inboxView(m: MailModel, head: string, notice: string, chrome: string): string {
  const feed = m.feed;
  if (!feed) return `<main class="screen single">${head}${notice}${statusCard(m.status, false, "mail")}</main>${chrome}`;
  const none = feed.threads.length === 0 ? `<section class="card"><p class="text">Nothing new in the last three days.</p></section>` : "";
  return `<main class="screen single">${head}${notice}${statusCard(m.status === "ok" ? "idle" : m.status, true, "mail")}${sourceLine(feed.accounts)}${none}` +
    `${pileCard("reply", m, feed.threads)}${pileCard("read", m, feed.threads)}${pileCard("skip", m, feed.threads)}` +
    `<p class="foot">Sorted on your Mac by your local model. A mail's own words can steer what the model says about it, so check the mail itself before you act on one. Nothing is sent from here.</p>${foot(feed.at, m.now, "mail")}</main>${chrome}`;
}
