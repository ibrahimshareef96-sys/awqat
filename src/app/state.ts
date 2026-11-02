/** The app's state while it runs, and the helpers every action uses to change and save it. */
import { DEFAULT_PLACE, type Place } from "../place.ts";
import { checkLog, type PrayerLog } from "../prayer/log.ts";
import { calendarDayIn, dayKey, type DayTimes } from "../prayer/times.ts";
import { parseSettings, type Settings } from "../settings.ts";
import { emptyQuranLog, type QuranLog } from "../quran/log.ts";
import { emptyFridayLog, type FridayItem, type FridayLog } from "../faith/friday.ts";
import { emptyAdhkarLog, type AdhkarLog, type Session } from "../faith/adhkar.ts";
import { emptyMarks, type MushafMarks } from "../quran/marks.ts";
import type { MurajaahPlan } from "../quran/murajaah.ts";
import { emptyLibrary, type Library, type Shelf } from "../books/library.ts";
import type { ShelfState } from "../books/shelf.ts";
import { emptySync, type BookSyncState, type SyncState } from "../books/sync.ts";
import { emptyRecordsSync, type RecordsNote, type RecordsSync } from "../sync/records.ts";
import type { NotifyState } from "../device.ts";
import type { NewBookDraft } from "../ui/booksView.ts";
import { emptyFeeds } from "../feeds/feeds.ts";
import { emptyCalendars, type CalendarList } from "../agenda/calendars.ts";
import { emptyAgenda, type Agenda } from "../agenda/agenda.ts";
import { emptyBody, type BodyLog } from "../body/body.ts";
import type { Availability } from "../body/health.ts";
import type { BodySummary, RawHealth } from "../body/summary.ts";
import { emptyLearn, type Learn } from "../learn/learn.ts";
import { emptyModeLog, type ModeLog } from "../modes/modes.ts";
import { emptyMoney, type Money } from "../money/money.ts";
import type { MoneySheetKind } from "../ui/moneyView.ts";
import { emptyReviewLog, type ReviewDraft, type ReviewLog } from "../review/muhasabah.ts";
import type { LearnSheet } from "../ui/learnView.ts";
import { write } from "../store.ts";
import type { TalkSession } from "../talk/session.ts";

/** signin: the passphrase form; signing: it is being checked; the rest follow a talk from tap to end. */
export type TalkPhase = "idle" | "signin" | "signing" | "connecting" | "listening" | "speaking" | "working" | "ending";

/** A reading from a mode: the pages it covers, where its place is kept, and the Friday item it ticks at its end. */
export interface GuestReading {
  label: string;
  first: number;
  last: number;
  /** Where the modes keep its place (modes/modes.ts); null for ayat that are only opened. */
  placeKey: string | null;
  tick: FridayItem | null;
}

export type Screen = "home" | "faith" | "settings" | "quran" | "mushaf" | "books" | "agenda" | "body" | "money" | "work" | "inbox" | "review" | `book:${string}` |
  `adhkar:${Session}` | "learn" | "learn-review" | `learn:${string}` | "modes" | `mode:${string}`;
export type Sheet = null | "talk" | "add-book" | "new-book" | "word" | "page-note" | "goto" | "murajaah" | "mode-dua" | "money" |
  "review-past" | LearnSheet;

export const MESSAGES = {
  unsaved: "That could not be saved. Try again.",
  failed: "That did not work. Try again.",
  unreadable: "Some saved data could not be read, so nothing is saved until the app restarts.",
  locationOff: "Location is off for this app. Turn it on in the phone's Settings, Apps, Awqat, Permissions.",
  locationFailed: "Your location could not be found just now. Try again in a moment.",
  placeInvalid: "That is not a place on Earth. Type latitude and longitude in degrees, such as 51.51 and -0.13.",
  notifyOff: "Notifications are off. Turn them on in the phone's Settings, Apps, Awqat, Notifications.",
};

export const emptyDraft = (): NewBookDraft => ({ title: "", author: "", pages: "", isbn: "", photo: null });

/** Books shown in the list at a time; "Show more" adds this many. */
export const LIST_PAGE = 200;

export const state = {
  log: checkLog(null).log as PrayerLog,
  settings: parseSettings(null) as Settings,
  place: DEFAULT_PLACE as Place,
  quran: emptyQuranLog() as QuranLog,
  friday: emptyFridayLog() as FridayLog,
  /** How many times each dhikr was said, by day and set. */
  adhkar: emptyAdhkarLog() as AdhkarLog,
  /** The screen an adhkar list was opened from, where Back returns. */
  adhkarFrom: "faith" as "home" | "faith" | `mode:${string}`,
  /** The modes: counts, places and the user's own du'as (modes/modes.ts). */
  modes: emptyModeLog() as ModeLog,
  /** The screen a mode was opened from, where Back returns. */
  modeFrom: "modes" as string,
  /** The screen the list of modes was opened from, where its Back returns. */
  modesFrom: "home" as "home" | "faith",
  /** The screen the Weekly Review was opened from, where its Back returns. */
  reviewFrom: "home" as "home" | "modes",
  /** The Weekly Reviews kept (review/muhasabah.ts); the past week open in its sheet; what was typed and not yet kept. */
  reviews: emptyReviewLog() as ReviewLog,
  reviewPast: null as string | null,
  /** Kept in memory only, so leaving the screen before saving loses nothing typed this run. */
  reviewDraft: null as (ReviewDraft & { week: string }) | null,
  /** The mode the add-a-du'a sheet is for; the du'a whose Remove was tapped once. */
  modeDuaFor: null as string | null,
  modeRemoveArmed: null as string | null,
  mushaf: emptyMarks() as MushafMarks,
  /** The muraja'ah plan, once the user has chosen one. */
  murajaah: null as MurajaahPlan | null,
  /** The mushaf page open in the reader. */
  mushafPage: 1,
  /** The reader was opened to read on (not from a revision link): the pages it shows move the bookmark. */
  mushafReading: false,
  /** A page has turned since the reader opened: a bookmark arriving from another device no longer moves it. */
  mushafTurned: false,
  /** The reader's top and bottom bars are hidden (a tap on the page shows or hides them; a page turning leaves them). */
  mushafBarsHidden: false,
  /** The screen is big and on its side: the reader shows two pages, as the printed mushaf lies open. */
  spread: false,
  /** The page the page-note sheet is for (with two pages open, either one). */
  notePage: null as number | null,
  /** The screen the reader was opened from, where Back and Close return. */
  mushafFrom: "quran" as string,
  /** A reading opened from a mode: it has its own place, so the bookmark and the log stay as they are. */
  mushafGuest: null as GuestReading | null,
  /** A page was chosen in the go-to sheet while reading on: the page the user came from, one tap back. */
  mushafJumpFrom: null as number | null,
  /** The word tapped in the mushaf ("sura:ayah:word"), while its sheet is open. */
  word: null as string | null,
  /** While the whole mushaf's script is being kept on the phone: how far along. */
  mushafDownload: null as { done: number; total: number } | null,
  library: emptyLibrary() as Library,
  /** How the TV's "reading now" shelf stands (books/shelf.ts). */
  tvShelf: { state: "idle" } as ShelfState,
  /** What this device has yet to swap with the Worker to keep the library the same everywhere, and how that stands. */
  bookSync: emptySync() as SyncState,
  bookSyncNote: { state: "idle" } as BookSyncState,
  /** The same for every other record (sync/records.ts): what this device has yet to swap, and how that stands. */
  recordsSync: emptyRecordsSync() as RecordsSync,
  recordsNote: { state: "idle" } as RecordsNote,
  /**
   * Learn shows its starting tracks without saving them until the user's first change. Until then they are not this device's
   * own: a sync takes the user's other devices' Learn in their place, so nothing the user removed elsewhere comes back.
   */
  learnSeedOnly: false,
  /** The calendars Agenda reads, and the week it last read from them. */
  calendars: emptyCalendars() as CalendarList,
  agenda: emptyAgenda() as Agenda,
  /** The day Agenda shows; null for today. */
  agendaDay: null as string | null,
  agendaReading: false,
  calendarRemoveArmed: null as string | null,
  /** Body's own log (typed weights, the weekly plan), and what the health store last gave. */
  body: emptyBody() as BodyLog,
  health: {
    available: null as Availability | null,
    denied: [] as string[],
    raw: null as RawHealth | null,
    summary: null as BodySummary | null,
    readAt: null as number | null,
    reading: false,
  },
  weightRemoveArmed: null as number | null,
  liftRemoveArmed: null as string | null,
  /** Money (money/money.ts); which sheet is open; the row one tap from going or being paid. */
  money: emptyMoney() as Money,
  /** The dhikr being counted on the lock screen and the island: its live.ts key. Kept in memory: it lasts this run. */
  liveDhikr: null as string | null,
  feeds: emptyFeeds(),
  /** The mail whose draft was last copied, so its button can say so. */
  mailCopied: null as string | null,
  moneySheet: null as MoneySheetKind | null,
  moneyArmed: null as string | null,
  /** What the user learns (learn/learn.ts); the track a Learn sheet is for; the item whose Remove was tapped once. */
  learn: emptyLearn() as Learn,
  learnSheetTrack: null as string | null,
  learnRemoveArmed: null as string | null,
  /** The log sheet was opened by stopping a timer: the minutes it holds. */
  learnSheetMinutes: null as number | null,
  /** Talk inside the app: where the talk stands, what the sheet says, and the session (in memory and its file only). */
  talk: {
    phase: "idle" as TalkPhase,
    message: "",
    caption: "",
    muted: false,
    /** The last thing the assistant logged in this talk, with an Undo on the sheet; "" for none. */
    logged: "",
    session: null as TalkSession | null,
    /** Whether the session's file has been read since the app started. */
    sessionRead: false,
  },
  screen: "home" as Screen,
  sheet: null as Sheet,
  draft: emptyDraft(),
  shelf: "all" as Shelf | "all",
  /** Words searched for in the library, and how many books the list shows. */
  search: "",
  showing: LIST_PAGE,
  /** The book whose Remove button was tapped once; a second tap removes it. */
  removeArmed: null as string | null,
  /** The Quran's Undo was tapped once; a second tap undoes the last reading. */
  undoArmed: false,
  /** While covers are being fetched from Open Library: how far along. */
  covers: null as { done: number; total: number } | null,
  notify: "unavailable" as NotifyState,
  exact: "unknown" as "granted" | "denied" | "unknown",
  pending: null as number | null,
  days: [] as DayTimes[],
  notice: "",
  /** Why the coordinates typed in Settings were not taken; cleared on success and on leaving the screen. */
  placeError: "",
  busy: false,
  /** Keys whose saved value could not be read: never written over this session. */
  blocked: new Set<string>(),
};

/** Filled in by main.ts, so actions can redraw without importing it. */
export const hooks = {
  render: (): void => undefined,
  /** The widgets and the lock screen, after a change painted in place that draws nothing else. */
  syncSurfaces: (): void => undefined,
  /** Redraws unless someone is typing; for work that finishes in the background. */
  softRender: (): void => undefined,
  renderOverlay: (): void => undefined,
  /** `force` once what the sheet held is saved: an unsaved note otherwise asks for a second close. */
  closeSheet: (_force?: boolean): void => undefined,
  go: (_target: string): void => undefined,
  /** The reader, opened as state says (a mode's reading). */
  showReader: (): void => undefined,
  /** Updates the Talk sheet in place (its words, its orb, its buttons), so a talk never redraws the screen. */
  paintTalk: (): void => undefined,
  /** Plans the reminders again (after a change that alters what they say). */
  reschedule: (): Promise<void> => Promise.resolve(),
  /** Finds covers for books without one; `auto` when the app starts it by itself (app/coverActions.ts). */
  findCovers: (_auto?: boolean): Promise<void> => Promise.resolve(),
  /** A value was saved: one that syncs is stamped and marked (app/recordsActions.ts recordSaved). */
  saved: (_key: string, _value: unknown): void => undefined,
  /** The mushaf's bookmark arrived from another device and is in state (app/recordsActions.ts), before a redraw. */
  bookmarkArrived: (): void => undefined,
};

export function today(): string {
  return dayKey(calendarDayIn(new Date(), state.place.tz));
}

export function announce(text: string): void {
  const live = document.getElementById("live");
  if (live) live.textContent = text;
}

export function setNotice(text: string): void {
  state.notice = text;
  if (text) announce(text);
}

/**
 * Saves, and says whether it worked: files are only deleted once the change that lets go of them is saved. A save that
 * works takes down an earlier "could not be saved", which is no longer true.
 */
export async function save(key: string, value: unknown): Promise<boolean> {
  if (state.blocked.has(key)) {
    setNotice(MESSAGES.unreadable);
    return false;
  }
  if (await write(key, value)) {
    if (state.notice === MESSAGES.unsaved) state.notice = "";
    // A record that syncs is stamped and marked for the user's other devices once it is on disk (app/recordsActions.ts).
    hooks.saved(key, value);
    return true;
  }
  setNotice(MESSAGES.unsaved);
  return false;
}

/** Runs an action that waits on the phone (camera, scanner, network), with its buttons off until it is done. */
export async function busyWhile(work: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  hooks.render();
  hooks.renderOverlay();
  try {
    await work();
  } catch {
    setNotice(MESSAGES.failed);
  } finally {
    state.busy = false;
    hooks.render();
    hooks.renderOverlay();
  }
}
