/**
 * The Weekly Review's actions: this week's review kept from its form (review/muhasabah.ts), an intention ticked from
 * Home, a past week opened in its sheet, and what was typed kept in memory when the screen is left before saving. A
 * saved review plans the reminders again, since a week reviewed needs no reminder.
 */
import { lookAhead } from "../review/ahead.ts";
import {
  PROMPT_KEYS, cleanIntention, cleanReflection, homeIntentions, pastReviews, reviewOf, saveReview, toggleIntention, weekOf,
  type Intention, type ReviewDraft, type WeekReflection,
} from "../review/muhasabah.ts";
import type { WeekReview } from "../review/week.ts";
import { KEYS } from "../store.ts";
import { sessionToken } from "../talk/session.ts";
import { pastReviewSheet, type ReviewScreen } from "../ui/reviewView.ts";
import { workerUrl } from "../voice.ts";
import { announce, hooks, save, setNotice, state, today } from "./state.ts";

export const REVIEW_MESSAGES = {
  kept: "This week's review is kept. Your intentions are on Home for the week.",
  cleared: "This week's review is cleared.",
};

const EMPTY: ReviewDraft = { well: "", short: "", change: "", intentions: [] };

const draftOf = (r: WeekReflection): ReviewDraft =>
  ({ well: r.well, short: r.short, change: r.change, intentions: r.intentions.map((i) => i.text) });

const text = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

/** The form as typed. */
function draftFrom(data: FormData): ReviewDraft {
  return { well: text(data.get("well")), short: text(data.get("short")), change: text(data.get("change")),
    intentions: data.getAll("intention").map(text) };
}

/** The form holds just what is kept (or nothing, with nothing kept), once cleaned as a save would: no draft to hold on to. */
function sameAsKept(draft: ReviewDraft, kept: WeekReflection | null): boolean {
  const base = kept ? draftOf(kept) : EMPTY;
  const typed = draft.intentions.map(cleanIntention).filter(Boolean);
  return PROMPT_KEYS.every((k) => cleanReflection(draft[k]) === base[k]) && typed.length === base.intentions.length &&
    typed.every((t, n) => t === base.intentions[n]);
}

export function reviewModel(now: Date, numbers: WeekReview): ReviewScreen {
  const date = today();
  const week = weekOf(date);
  const kept = reviewOf(state.reviews, week);
  const draft = state.reviewDraft?.week === week ? state.reviewDraft : null;
  const worker = workerUrl(state.settings.voiceUrl);
  const work = worker ? state.feeds.work.feed : null;
  return {
    numbers, kept: kept !== null, busy: state.busy, talk: worker !== "",
    form: draft ? { well: draft.well, short: draft.short, change: draft.change, intentions: draft.intentions } : kept ? draftOf(kept) : EMPTY,
    ahead: lookAhead({ today: date, tz: state.place.tz, now: now.getTime(), calendars: state.calendars.calendars.length,
      agenda: state.agenda, murajaah: state.murajaah, body: state.body, due: work ? work.due : null }),
    past: pastReviews(state.reviews, week),
    syncs: sessionToken(state.talk.session, worker) !== null,
  };
}

/**
 * Keeps this week's review from its form; one with nothing written is refused, by the button, and a kept one cleared
 * of everything goes. The reminders are planned again once it is on disk: a week reviewed needs none.
 */
export async function submitReview(data: FormData): Promise<void> {
  const result = saveReview(state.reviews, draftFrom(data), today());
  if ("error" in result) {
    setNotice(result.error);
    return hooks.render();
  }
  state.reviews = result.log;
  state.reviewDraft = null;
  setNotice(result.review ? REVIEW_MESSAGES.kept : REVIEW_MESSAGES.cleared);
  hooks.render();
  // A save that fails redraws once more, so its "could not be saved" shows.
  if (!(await save(KEYS.reviews, result.log))) return hooks.softRender();
  await hooks.reschedule();
}

/** Home's card: the intentions set for the week, or null. */
export function weekCard(): { week: string; intentions: Intention[] } | null {
  return homeIntentions(state.reviews, today());
}

/** One intention ticked or unticked from Home ("week:index", as the card wrote it); anything else does nothing. */
export async function tickIntention(value: string): Promise<void> {
  const match = /^(\d{4}-\d{2}-\d{2}):(\d)$/.exec(value);
  if (!match) return;
  const [, week, index] = match;
  const next = toggleIntention(state.reviews, week, Number(index));
  if (next === state.reviews) return;
  state.reviews = next;
  hooks.render();
  const intention = reviewOf(next, week)?.intentions[Number(index)];
  if (intention) announce(`${intention.text}, ${intention.done ? "done" : "not ticked"}.`);
  if (!(await save(KEYS.reviews, next))) hooks.softRender();
}

/** A past week's review, read back in its sheet. */
export function openPastReview(week: string): void {
  if (!reviewOf(state.reviews, week)) return;
  state.reviewPast = week;
  state.sheet = "review-past";
  hooks.renderOverlay();
}

export function pastSheet(): string {
  const review = state.reviewPast ? reviewOf(state.reviews, state.reviewPast) : null;
  return review ? pastReviewSheet(review) : "";
}

/**
 * The review screen is being left (or the app put away, or this week's review is arriving from another device) with its
 * form typed in and not kept: what was typed is held in memory for this week, so the form shows it again. Nothing
 * typed, or just what was kept, holds nothing.
 */
export function keepReviewDraft(): void {
  if (typeof document === "undefined") return;
  const form = document.querySelector<HTMLFormElement>('form[data-form="review"]');
  if (!form) return;
  const draft = draftFrom(new FormData(form));
  const week = weekOf(today());
  state.reviewDraft = sameAsKept(draft, reviewOf(state.reviews, week)) ? null : { ...draft, week };
}
