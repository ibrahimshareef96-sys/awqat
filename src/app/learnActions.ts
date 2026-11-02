/** What the Learn screens do: tracks and their items, study time, the user's lessons, and their review. */
import { Browser } from "@capacitor/browser";
import { isNative } from "../device.ts";
import {
  ITEM_KINDS, MINUTES_MAX, MINUTES_MIN, STATUS_LABEL, TRACKS_MAX, TRACK_KINDS, URL_MAX, WEEKLY_MAX, addItem, addLesson,
  addTrack, cleanUrl, cycleItem, formatMinutes, itemOf, logSession, parseMinutes, removeItem, removeLesson,
  removeSession, setArchived, setWeeklyMinutes, trackOf, type Added, type ItemKind, type Learn, type Refusal,
  type TrackKind,
} from "../learn/learn.ts";
import { INTERVALS, again, remembered } from "../learn/review.ts";
import { KEYS } from "../store.ts";
import type { LearnModel, LearnSheet, SheetModel } from "../ui/learnView.ts";
import { MESSAGES, announce, hooks, save, setNotice, state, today } from "./state.ts";

export const LEARN_MESSAGES = {
  noName: "A track needs a name.",
  noTitle: "An item needs a title.",
  noText: "Write the lesson first, in a few words.",
  minutes: `Study time is ${MINUTES_MIN} to ${MINUTES_MAX} minutes, in whole minutes.`,
  weekly: `A weekly target is 0 to ${WEEKLY_MAX} minutes, in whole minutes.`,
  url: `A link is a web address (https) of at most ${URL_MAX} characters.`,
  full: "Learn is full here. Remove some to add more.",
  tracksFull: `Learn keeps at most ${TRACKS_MAX} tracks, archived ones included.`,
  gone: "That track is no longer here.",
  openFailed: "That link could not be opened just now.",
};

interface SetOptions {
  said?: string;
}

/**
 * Shows and saves a new Learn; true once it is on disk. Every change to Learn comes through here. A save that fails
 * redraws once more, so its "could not be saved" shows (it is set after the first redraw).
 */
export async function setLearn(next: Learn, options: SetOptions = {}): Promise<boolean> {
  state.learn = next;
  hooks.render();
  if (options.said) announce(options.said);
  const saved = await save(KEYS.learn, next);
  if (!saved) hooks.softRender();
  return saved;
}

export function learnModel(): LearnModel {
  return { learn: state.learn, today: today(), removeArmed: state.learnRemoveArmed };
}

export function sheetModel(): SheetModel {
  return { learn: state.learn, track: trackOf(state.learn, state.learnSheetTrack) ?? null, minutes: state.learnSheetMinutes };
}

/**
 * Taps that move what is under the finger (a row removed, a card archived, a Remove armed, the next lesson shown)
 * wait this long after one another, so a double tap does one thing, not two.
 */
const TAP_PAUSE_MS = 500;
let lastShift = Number.NEGATIVE_INFINITY;

/** True when the last such tap is far enough back (or the clock was set back since). */
function settled(): boolean {
  const now = Date.now();
  return now < lastShift || now - lastShift >= TAP_PAUSE_MS;
}

const shifted = (): void => { lastShift = Date.now(); };

/** The track whose screen is open, if one is. */
function currentTrackId(): string | null {
  return state.screen.startsWith("learn:") ? state.screen.slice(6) : null;
}

function openSheet(sheet: LearnSheet, trackId: string | null): void {
  if (trackId !== null && !trackOf(state.learn, trackId)) return;
  state.learnSheetMinutes = null;
  state.learnSheetTrack = trackId;
  state.sheet = sheet;
  hooks.renderOverlay();
}

export const openLogSheet = (trackId: string): void => openSheet("learn-session", trackId);
export const openItemSheet = (trackId: string): void => openSheet("learn-item", trackId);
export const openLessonSheet = (trackId: string): void => openSheet("learn-lesson", trackId);
export const openTrackSheet = (): void => openSheet("learn-track", null);

/** Says inside the open sheet why it is still open; what was typed stays. */
function sheetError(text: string): void {
  const el = document.querySelector<HTMLElement>("#overlay [data-sheet-error]");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

/** A lesson half written in its sheet: the first close says so, so the user's words are not lost to a stray tap. */
export function lessonTyped(): boolean {
  if (state.sheet !== "learn-lesson") return false;
  const area = document.querySelector<HTMLTextAreaElement>("#overlay textarea");
  return area !== null && area.value.trim() !== "";
}

const field = (form: FormData, name: string): string => String(form.get(name) ?? "");

function refusalText(refused: Refusal, empty: string, full = LEARN_MESSAGES.full): string {
  if (refused === "empty") return empty;
  if (refused === "minutes") return LEARN_MESSAGES.minutes;
  if (refused === "track") return LEARN_MESSAGES.gone;
  return full;
}

/** A sheet's change being saved: its button does nothing meanwhile, so nothing is added twice. */
let committing = false;

/**
 * Saves a sheet's change, then closes the sheet. A change that could not be kept is taken back and the sheet stays,
 * with what the user typed and why, so trying again adds it once.
 */
async function commitFromSheet(result: Added, empty: string, said: string, full?: string): Promise<void> {
  if (result.refused) return sheetError(refusalText(result.refused, empty, full));
  const before = state.learn;
  committing = true;
  try {
    if (await setLearn(result.learn)) {
      hooks.closeSheet(true);
      announce(said);
      return;
    }
    if (state.learn === result.learn) {
      state.learn = before;
      hooks.render();
    }
    sheetError(state.notice || MESSAGES.unsaved);
  } finally {
    committing = false;
  }
}

export async function submitTrack(form: FormData): Promise<void> {
  if (committing) return;
  const name = field(form, "name");
  const kindValue = field(form, "kind");
  const kind = TRACK_KINDS.includes(kindValue as TrackKind) ? (kindValue as TrackKind) : "worldly";
  const minutes = parseMinutes(field(form, "minutes").trim() || "0", 0, WEEKLY_MAX);
  if (minutes === null) return sheetError(LEARN_MESSAGES.weekly);
  const result = addTrack(state.learn, { name, kind, weeklyMinutes: minutes }, today());
  if (result.refused === "exists") {
    const there = trackOf(state.learn, result.id);
    return sheetError(`You have a track called "${there?.name ?? name}" already` +
      `${there?.archived ? ", archived. Bring it back from the list below." : "."}`);
  }
  const added = trackOf(result.learn, result.id);
  await commitFromSheet(result, LEARN_MESSAGES.noName, `Added the ${added?.name ?? ""} track.`, LEARN_MESSAGES.tracksFull);
}

/** A link typed without its https:// is given one; one written with any other scheme is refused. */
function typedUrl(text: string): { url: string | null; bad: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { url: null, bad: false };
  const url = cleanUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  return { url, bad: url === null };
}

export async function submitItem(form: FormData): Promise<void> {
  if (committing) return;
  const trackId = state.learnSheetTrack ?? "";
  const kindValue = field(form, "kind");
  const kind = ITEM_KINDS.includes(kindValue as ItemKind) ? (kindValue as ItemKind) : "other";
  const link = typedUrl(field(form, "url"));
  if (link.bad) return sheetError(LEARN_MESSAGES.url);
  const result = addItem(state.learn, trackId, { title: field(form, "title"), kind, url: link.url }, today());
  const added = itemOf(result.learn, result.id);
  await commitFromSheet(result, LEARN_MESSAGES.noTitle, `Added "${added?.title ?? ""}".`);
}

export async function logStudy(form: FormData): Promise<void> {
  if (committing) return;
  const trackId = state.learnSheetTrack ?? "";
  const minutes = parseMinutes(field(form, "minutes"), MINUTES_MIN, MINUTES_MAX);
  if (minutes === null) return sheetError(LEARN_MESSAGES.minutes);
  const result = logSession(state.learn, { trackId, itemId: field(form, "item") || null, minutes,
    note: field(form, "note") }, today());
  const name = trackOf(state.learn, trackId)?.name ?? "";
  await commitFromSheet(result, LEARN_MESSAGES.minutes, `${formatMinutes(minutes)} of ${name} logged.`);
}

export async function submitLesson(form: FormData): Promise<void> {
  if (committing) return;
  const trackId = state.learnSheetTrack ?? "";
  const result = addLesson(state.learn, { trackId, itemId: field(form, "item") || null, text: field(form, "text"),
    source: field(form, "source") }, today());
  // An archived track's lessons rest with it (learn/review.ts).
  const when = trackOf(state.learn, trackId)?.archived ? "once the track is back" : "tomorrow";
  await commitFromSheet(result, LEARN_MESSAGES.noText, `Lesson saved. It comes back for review ${when}.`);
}

/** The weekly target set on a track's screen; empty means none. */
export async function setTarget(value: string): Promise<void> {
  const track = trackOf(state.learn, currentTrackId());
  if (!track) return;
  const minutes = parseMinutes(value.trim() || "0", 0, WEEKLY_MAX);
  if (minutes === null) {
    setNotice(LEARN_MESSAGES.weekly);
    return hooks.render();
  }
  await setLearn(setWeeklyMinutes(state.learn, track.id, minutes),
    { said: minutes ? `Target: ${formatMinutes(minutes)} a week.` : "Weekly target cleared." });
}

/** Archives a track still studied, or brings an archived one back. */
export async function toggleArchive(trackId: string): Promise<void> {
  const track = trackOf(state.learn, trackId);
  if (!track || !settled()) return;
  shifted();
  await setLearn(setArchived(state.learn, trackId, !track.archived),
    { said: track.archived ? `${track.name} is back.` : `${track.name} archived.` });
}

/** To do, doing, done, and round again. */
export async function cycleStatus(itemId: string): Promise<void> {
  const item = itemOf(state.learn, itemId);
  if (!item) return;
  const next = cycleItem(state.learn, itemId, today());
  const status = itemOf(next, itemId)?.status ?? "todo";
  await setLearn(next, { said: `${item.title}: ${STATUS_LABEL[status].toLowerCase()}.` });
}

/**
 * The first tap arms a Remove or Delete (an item, a lesson or a study time: their ids never clash); the second, not
 * straight after the first, does it. True when this tap did it.
 */
function confirmed(id: string): boolean {
  if (!settled()) return false;
  shifted();
  if (state.learnRemoveArmed !== id) {
    state.learnRemoveArmed = id;
    hooks.render();
    return false;
  }
  state.learnRemoveArmed = null;
  return true;
}

export async function removeItemTap(itemId: string): Promise<void> {
  const item = itemOf(state.learn, itemId);
  if (!item || !confirmed(itemId)) return;
  await setLearn(removeItem(state.learn, itemId), { said: `Removed "${item.title}".` });
}

export async function removeSessionTap(sessionId: string): Promise<void> {
  if (!state.learn.sessions.some((s) => s.id === sessionId) || !confirmed(sessionId)) return;
  await setLearn(removeSession(state.learn, sessionId), { said: "Study time deleted." });
}

export async function removeLessonTap(lessonId: string): Promise<void> {
  if (!state.learn.lessons.some((l) => l.id === lessonId) || !confirmed(lessonId)) return;
  await setLearn(removeLesson(state.learn, lessonId), { said: "Lesson deleted." });
}

/**
 * Remembered moves a lesson a step on; Again brings it back tomorrow. A second tap on the same lesson does nothing,
 * and neither does a tap straight after another (it would land on the next lesson, not yet seen). Focus goes to the
 * next lesson, or to the way back once none is left.
 */
export async function reviewLesson(lessonId: string, wasRemembered: boolean): Promise<void> {
  if (!settled()) return;
  const day = today();
  const next = wasRemembered ? remembered(state.learn, lessonId, day) : again(state.learn, lessonId, day);
  if (next === state.learn) return;
  shifted();
  const step = next.lessons.find((l) => l.id === lessonId)?.step ?? 0;
  const done = setLearn(next, { said: wasRemembered ? `Next review in ${INTERVALS[step]} days.` : "It comes back tomorrow." });
  document.querySelector<HTMLElement>('#app details summary, #app .pill[data-go="learn"]')?.focus({ preventScroll: true });
  await done;
}

/** Opens an item's link in the system's browser, only when the user taps for it; only a link that is https goes. */
export async function openItem(itemId: string): Promise<void> {
  const url = cleanUrl(itemOf(state.learn, itemId)?.url ?? null);
  if (!url) return;
  try {
    if (isNative()) await Browser.open({ url, presentationStyle: "popover", toolbarColor: "#121219" });
    else window.open(url, "_blank", "noopener");
  } catch {
    setNotice(LEARN_MESSAGES.openFailed);
    hooks.render();
  }
}
