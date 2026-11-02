/** Awqat: boots the state from the device, draws the screens, and routes every tap, form and change. */
import { App } from "@capacitor/app";
import "./ui/app.css";
import "./ui/mushaf.css";
import { DEFAULT_PLACE, parsePlace, pinnedPlace, shouldMove, type Place } from "./place.ts";
import { adjustOwed, checkLog, cycleMark, toggleSunnah, type PrayerLog, type Sunnah } from "./prayer/log.ts";
import { deviceTimeZone, isMethod } from "./prayer/method.ts";
import { PRAYERS, PRAYER_LABEL, formatTime, type DayTimes, type PrayerName } from "./prayer/times.ts";
import { IQAMA_MAX, IQAMA_MIN, parseIqamaMinutes } from "./prayer/iqama.ts";
import { prayerDayIndex, skyMoment } from "./prayer/window.ts";
import { cleanName, parseSettings, type Settings } from "./settings.ts";
import { checkQuranLog } from "./quran/log.ts";
import { checkFridayLog } from "./faith/friday.ts";
import { LocalNotifications } from "@capacitor/local-notifications";
import { checkModeLog } from "./modes/modes.ts";
import { defOf } from "./modes/registry.ts";
import * as modes from "./app/modesActions.ts";
import { duaSheet, modeView, modesListView, studyView } from "./ui/modesView.ts";
import { reminderTarget } from "./reminders/plan.ts";
import { SESSION_NAME, adhkarWindow, checkAdhkarLog } from "./faith/adhkar.ts";
import { adhkarView } from "./ui/adhkarView.ts";
import * as adhkar from "./app/adhkarActions.ts";
import { shelfMessage } from "./books/shelf.ts";
import { syncShelf } from "./app/shelfActions.ts";
import { syncBooks, syncBooksSoon } from "./app/syncActions.ts";
import { recordSaved, syncRecords, syncRecordsSoon } from "./app/recordsActions.ts";
import { checkRecordsSync, recordsMessage } from "./sync/records.ts";
import { checkLibrary } from "./books/library.ts";
import { checkSync, syncMessage } from "./books/sync.ts";
import { prepareFolders } from "./books/media.ts";
import { KEYS, keepAside, read, type ReadResult } from "./store.ts";
import { isNative, locate, notifyPermission, openExactAlarmSettings } from "./device.ts";
import { setSky } from "./ui/sky.ts";
import { chrome, faithView, header, homeView, noticeLine, settingsView, type ViewModel } from "./ui/views.ts";
import { copyDraft, feedOfScreen, isFeedKind, keepFeedsToSession, refreshFeed } from "./app/feedActions.ts";
import { drainTaps, syncLive } from "./app/live.ts";
import { dayDone, planFor } from "./body/training.ts";
import { inboxView, workView } from "./ui/feedViews.ts";
import { paintTalk, talkSheet, type TalkModel } from "./ui/talkView.ts";
import { followTalk } from "./ui/voiceOrb.ts";
import { deviceWord } from "./ui/deviceWord.ts";
import * as talk from "./talk/talk.ts";
import { installAdhanSounds } from "./prayer/adhanSounds.ts";
import { quranView } from "./ui/quranView.ts";
import { addBookSheet, bookView, booksView, newBookSheet } from "./ui/booksView.ts";
import { isEditable, keep, restore } from "./ui/keep.ts";
import { gotoSheet, mushafView, pageNoteSheet, wordSheet } from "./ui/mushafView.ts";
import { layoutPatched, layoutReader } from "./ui/reader.ts";
import { carryMotion, readMotion } from "./ui/barsZoom.ts";
import { showsSpread } from "./quran/spread.ts";
import { checkMarks } from "./quran/marks.ts";
import { checkPlan } from "./quran/murajaah.ts";
import { murajaahSheet } from "./ui/murajaahView.ts";
import * as plan from "./app/murajaahActions.ts";
import { linkTarget, syncWidget, widgetSnapshot } from "./app/widget.ts";
import { pruneKeptPages } from "./quran/mushafFiles.ts";
import * as mushaf from "./app/mushafActions.ts";
import * as recite from "./app/reciteActions.ts";
import { memoriseDoneSheet, reciteSheet } from "./ui/reciteView.ts";
import { bookmarkPage } from "./quran/bookmark.ts";
import { bookMoving, handsMoving, listenForHands, pagerReplaced, resetHands } from "./app/hands.ts";
import { barsMoved, forgetBookPage, lastTurn, listenForBook, resetBook, turnBook } from "./ui/pageTurn.ts";
import { releasePictures } from "./ui/curlDriver.ts";
import { patchReader, rememberPages } from "./ui/readerPatch.ts";
import { takePaintedInPlace } from "./ui/counter.ts";
import { listenForHold, relight, release as releaseHeld, resetHold, tapOnPage } from "./app/hold.ts";
import { LIST_PAGE, MESSAGES, announce, busyWhile, hooks, save, setNotice, state, today, type Screen } from "./app/state.ts";
import * as quran from "./app/quranActions.ts";
import * as books from "./app/bookActions.ts";
import * as covers from "./app/coverActions.ts";
import * as friday from "./app/fridayActions.ts";
import * as agenda from "./app/agendaActions.ts";
import * as body from "./app/bodyActions.ts";
import * as money from "./app/moneyActions.ts";
import { canUndoLog, undoTalkLog } from "./app/talkLog.ts";
import * as voice from "./app/voiceActions.ts";
import { agendaView } from "./ui/agendaView.ts";
import { bodyView, stepsLine } from "./ui/bodyView.ts";
import { moneySheet, moneyView } from "./ui/moneyView.ts";
import { briefCard, weekReviewView } from "./ui/reviewView.ts";
import { morningBrief, weekReview, type ReviewInput } from "./review/week.ts";
import * as review from "./app/reviewActions.ts";
import { checkReviewLog } from "./review/muhasabah.ts";
import { REMINDER_FIELDS, withReminderField } from "./review/reminder.ts";
import { eventsOn } from "./agenda/agenda.ts";
import { cleanShown } from "./talk/text.ts";
import { checkMoney } from "./money/money.ts";
import { checkCalendars } from "./agenda/calendars.ts";
import { adoptOldCalendars, readCalendarsFile } from "./agenda/calendarStore.ts";
import { checkAgenda } from "./agenda/agenda.ts";
import { checkBody } from "./body/body.ts";
import { startingLearn } from "./learn/seed.ts";
import * as learn from "./app/learnActions.ts";
import { isLearnSheet, learnSheet, learnView, reviewView, trackSubtitle, trackView } from "./ui/learnView.ts";
import { workerUrl } from "./voice.ts";
import { freshDays, reschedule } from "./app/schedule.ts";

const TICK_MS = 30000;
/** Notes are saved this long after the last keystroke, and whenever the app is left. */
const NOTES_PAUSE_MS = 1500;

let lastHtml = "";
let lastScreen = "";
let lastSheet: string | null = null;
/** The form just sent: its fields are cleared by the redraw, not given back their typed text. */
let sentForm: string | null = null;
let softPending = false;
/** The reader's lines are fitted to the screen's width; a fold or turn of the phone while the pages move waits. */
let refitPending = false;
let notesTimer: ReturnType<typeof setTimeout> | undefined;
/** What opened the sheet (found again after a redraw), so focus goes back to it when the sheet closes. */
let opener: string[] = [];
/** The control a tap is being handled for, while it is handled. */
let tapped: HTMLElement | null = null;
/** A note typed in a sheet and not saved: the first close says so, the second lets it go. */
let discardArmed = false;
/** Where an adhkar list was scrolled to when a Quran item opened the mushaf. */
let adhkarScroll = 0;
let modeScroll = 0;
let modeScrollFor = "";

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

function talkModel(): TalkModel {
  const { phase, message, caption, muted, logged } = state.talk;
  return { worker: workerUrl(state.settings.voiceUrl), phase, message, caption, muted, logged, canUndo: canUndoLog(), device: deviceWord() };
}

function model(now: Date): ViewModel {
  const days = freshDays(now);
  const i = prayerDayIndex(days, now);
  return {
    now, today: days[i], tomorrow: days[i + 1], log: state.log, settings: state.settings, place: state.place,
    method: days[i].method, notify: state.notify, exact: state.exact, pending: state.pending,
    deviceTz: deviceTimeZone(), notice: state.notice, busy: state.busy, quran: state.quran,
    bookmark: bookmarkPage(state.mushaf, state.quran), library: state.library,
    learn: state.learn, date: today(), modes: modes.modesModel(now, state.place.tz), adhkar: state.adhkar,
    adhkarOpen: adhkarWindow(days, now), murajaah: state.murajaah,
    body: body.bodyModel(now), agenda: agenda.agendaModel(now), worker: workerUrl(state.settings.voiceUrl), talkSignedIn: talk.signedInToTalk(),
    records: recordsMessage(state.recordsNote, state.place.tz), placeError: state.placeError, week: review.weekCard(),
  };
}

/** What a Back button says when it returns to a screen. */
function screenBackLabel(screen: string): string {
  if (screen === "home") return "Home";
  if (screen === "faith") return "Faith";
  if (screen === "modes") return "Modes";
  return defOf(screen.slice(5))?.name ?? "Back";
}

function reviewInput(now: Date, prayerDay: DayTimes): ReviewInput {
  return { today: today(), prayerDay: prayerDay.date, prayersDueToday: PRAYERS.filter((p) => prayerDay[p].getTime() <= now.getTime()).length,
    prayers: state.log, quran: state.quran, adhkar: state.adhkar, learn: state.learn, body: state.body, health: body.healthNow(), money: state.money };
}

/** Today's meetings still to come, for the morning brief. */
function meetingsLeft(now: Date): string[] {
  return eventsOn(state.agenda, today(), state.place.tz).filter((e) => !e.allDay && e.end > now.getTime())
    .map((e) => `${formatTime(new Date(e.start), state.place.tz)} ${cleanShown(e.title, 60)}`);
}

function screenHtml(v: ViewModel): string {
  const s = state.screen;
  const booksModel = {
    library: state.library, date: v.date, shelf: state.shelf, busy: state.busy, removeArmed: state.removeArmed,
    search: state.search, showing: state.showing, covers: state.covers, tv: shelfMessage(state.tvShelf, v.place.tz),
    sync: syncMessage(state.bookSyncNote, v.place.tz),
  };
  if (s === "mushaf") return mushafView(mushaf.readerModel(v.now));
  if (s === "faith") return faithView(v);
  if (s === "settings") return settingsView(v, lastTurn());
  if (s === "quran") return quranView({ quran: state.quran, date: v.date, notice: v.notice, undoArmed: state.undoArmed,
    marks: state.mushaf, download: state.mushafDownload, plan: state.murajaah },
    header("Quran", "Reading, revision and study", "faith", "Faith"), noticeLine(v), chrome());
  if (s === "books") return booksView(booksModel, header("Books", "Everything you read and study"), noticeLine(v), chrome());
  if (s === "agenda") return agendaView(v.agenda, header("Agenda", "Your days, with the prayers between"), noticeLine(v), chrome());
  if (s === "review") {
    return weekReviewView(review.reviewModel(v.now, weekReview(reviewInput(v.now, v.today))),
      header("Weekly Review", "Look back, reflect, look ahead", state.reviewFrom, screenBackLabel(state.reviewFrom)), noticeLine(v), chrome());
  }
  if (s === "money") return moneyView(money.moneyModel(), header("Money", "What came in, what is owed, what goes out"), noticeLine(v), chrome());
  if (s === "body") {
    const m = body.bodyModel(v.now);
    return bodyView(m, header("Body", m.platform === "ios" ? "Read from Apple Health" : "Read from Health Connect"),
      noticeLine(v), chrome());
  }
  if (s.startsWith("book:")) {
    const book = state.library.books.find((b) => b.id === s.slice(5));
    if (book) return bookView(book, booksModel, header("Book", book.authors[0] ?? "", "books", "Books"), noticeLine(v), chrome());
  }
  if (s === "learn") {
    return learnView(learn.learnModel(), header("Learn", "What you study, Islamic and worldly"), noticeLine(v), chrome());
  }
  if (s === "learn-review") {
    return reviewView(learn.learnModel(), header("Review", "Your own lessons, back when due", "learn", "Learn"),
      noticeLine(v), chrome());
  }
  if (s.startsWith("learn:")) {
    const track = state.learn.tracks.find((t) => t.id === s.slice(6));
    if (track) {
      return trackView(track, learn.learnModel(), header(track.name, trackSubtitle(track), "learn", "Learn"),
        noticeLine(v), chrome());
    }
  }
  if (s === "work") return workView({ ...state.feeds.work, now: v.now.getTime() }, header("Work", "Your projects and what waits, from your feed"), noticeLine(v), chrome());
  if (s === "inbox") {
    return inboxView({ ...state.feeds.mail, now: v.now.getTime(), tz: v.place.tz, copied: state.mailCopied },
      header("Inbox", "What came in, sorted by your feed"), noticeLine(v), chrome());
  }
  if (s === "modes") {
    return modesListView(v.modes, header("Modes", "A view for the moment you are in", state.modesFrom, screenBackLabel(state.modesFrom)),
      noticeLine(v), chrome());
  }
  if (s.startsWith("mode:")) {
    const def = defOf(s.slice(5));
    const back = state.modeFrom;
    if (def) {
      return modeView(def, v.modes, header(def.name, def.when, back, screenBackLabel(back)), noticeLine(v), chrome(),
        def.id === "fajr" ? briefCard(morningBrief({ ...reviewInput(v.now, v.today), bookmark: v.bookmark, meetings: meetingsLeft(v.now) })) : "");
    }
    const track = state.learn.tracks.find((t) => `study:${t.id}` === s.slice(5));
    if (track) return studyView(track, v.modes, header(track.name, "Study", back, screenBackLabel(back)), noticeLine(v), chrome());
  }
  const session = adhkar.openSession();
  if (session) {
    const m = { log: v.adhkar, open: v.adhkarOpen, date: v.today.date, now: v.now, tz: v.place.tz, session,
      maghrib: v.today.maghrib };
    const back = screenBackLabel(state.adhkarFrom);
    return adhkarView(m, header(SESSION_NAME[session], session === "morning" ? "The morning remembrance"
      : "The evening remembrance", state.adhkarFrom, back), noticeLine(v), chrome());
  }
  return homeView(v);
}

/** Bar widths and heights come from data attributes: the page's policy allows no inline style attributes. */
function applySizes(root: ParentNode): void {
  const pct = (value: string | undefined) => `${Math.min(100, Math.max(0, Number(value) || 0))}%`;
  root.querySelectorAll<HTMLElement>("[data-w]").forEach((el) => { el.style.width = pct(el.dataset.w); });
  root.querySelectorAll<HTMLElement>("[data-h]").forEach((el) => { el.style.height = pct(el.dataset.h); });
}

/** What was saved has been read. Before that, state is only its empty defaults, and nothing may act on it. */
let loaded = false;

/**
 * The widgets and what is live on the lock screen hear of every change; each is only sent what differs. Also called for
 * a count painted in place, which draws nothing else, so the lock screen moves with the ring.
 */
function syncSurfaces(now = new Date()): void {
  if (!loaded) return;
  const date = today();
  const live = modes.liveItems(now, planFor(state.body, date));
  // A guessed place's times are Makkah's: no prayer goes on the home screen or the lock screen until a place is set.
  // The widgets wait for it (until then they say "Open Awqat once"); a timer or a dhikr being counted stays live.
  if (state.place.source === "default") return syncLive(live.filter((item) => item.id !== "next"));
  syncWidget(widgetSnapshot({ days: state.days, now, tz: state.place.tz, today: date, quran: state.quran,
    page: bookmarkPage(state.mushaf, state.quran), plan: state.murajaah, dhikr: modes.openCount(now), steps: stepsLine(body.bodyModel(now)), live: state.settings.live }));
  syncLive(live);
}

function render(): void {
  const now = new Date();
  keepFeedsToSession();
  const v = model(now);
  syncSurfaces(now);
  const html = screenHtml(v);
  setSky(skyMoment(v.today, now));
  const painted = takePaintedInPlace();
  if (html === lastHtml && !painted) {
    paintReaderBars();
    // A page being memorised changes word by word, often without the reader's own HTML changing.
    if (state.screen === "mushaf") recite.afterReaderDraw(byId("app"));
    return;
  }
  const root = byId("app");
  const kept = keep(root, sentForm, lastScreen);
  const stayingInReader = lastScreen === "mushaf" && state.screen === "mushaf";
  // The reader drawn again (a page turned or arrived) goes on from how it was on screen: zoom and bars mid-glide too.
  const motion = stayingInReader ? readMotion(root) : null;
  // A book's reader is brought up to date in place: its pages stay as the browser has drawn them.
  const patch = stayingInReader ? patchReader(root, html) : null;
  if (!patch) {
    if (lastScreen === "mushaf" && state.screen !== "mushaf") {
      releasePictures();
      recite.leaveReader();
    }
    root.innerHTML = html;
    rememberPages(root);
  }
  // Before anything reads the layout: the bars as they are now (a reader opened afresh never flashes or fades them).
  paintReaderBars();
  applySizes(root);
  lastHtml = html;
  lastScreen = state.screen;
  restore(root, kept, state.screen);
  if (!patch) pagerReplaced();
  if (state.screen === "mushaf") {
    refitPending = false;
    if (patch) {
      patch.removed.forEach(forgetBookPage);
      layoutPatched(root, patch.added, state.mushafPage);
      // The pages' own transition carries their zoom on; only the bars were drawn anew.
      carryMotion(root, motion && { zoom: null, bars: motion.bars });
    } else {
      layoutReader(root, state.mushafPage);
      carryMotion(root, motion);
    }
    // The ayah held open in its sheet stays lit on the pages drawn anew.
    if (state.sheet === "word") relight();
    // A page being memorised, and an ayah just found by reciting, painted over the words drawn.
    recite.afterReaderDraw(root);
  }
}

/**
 * The reader's bars, hidden or shown from state on the reader as drawn. They are kept out of the reader's HTML, so a
 * tap that shows or hides them changes no HTML and the page under them is never redrawn for it: they fade from where
 * they are.
 */
function paintReaderBars(): void {
  const reader = document.querySelector<HTMLElement>(".reader");
  if (!reader) return;
  const hidden = mushaf.barsHidden();
  if (reader.classList.contains("bars-hidden") === hidden) return;
  reader.classList.toggle("bars-hidden", hidden);
  barsMoved();
}

const typing = (): boolean => isEditable(document.activeElement);

/** Hands busy: typing, a finger down, the pages moving, or a picker open. A redraw now would get in their way. */
const handsBusy = (): boolean => typing() || handsMoving() || document.activeElement?.tagName === "SELECT";

/** A redraw for work finishing in the background: it waits while someone types or has a finger down. */
function softRender(): void {
  if (handsBusy()) {
    softPending = true;
    return;
  }
  softPending = false;
  render();
}

/**
 * The reader's lines fitted again to a new size (the phone folded, unfolded or turned). Not while a sheet is up: its
 * keyboard would shrink the page behind it and then grow it back.
 */
function refit(): void {
  // Turned or resized: a big screen on its side opens the mushaf as a spread (redrawn once hands are free).
  const spread = showsSpread(window.innerWidth, window.innerHeight);
  if (spread !== state.spread) {
    mushaf.setSpread(spread);
    if (state.screen === "mushaf") return softRender();
  }
  if (state.screen !== "mushaf") return;
  if (handsMoving() || state.sheet) {
    refitPending = true;
    return;
  }
  refitPending = false;
  layoutReader(byId("app"), state.mushafPage);
}

/**
 * The pager came to rest: if it rests on another page (another spread), that page becomes the open one. Resting on
 * the spread already open is no turn, so what waited for the pages to stop still runs.
 */
function onSettled(page: number | null): void {
  if (page !== null && page !== state.mushafPage && state.screen === "mushaf" && mushaf.turnTo(page)) return;
  bookmarkAfterHands();
  if (refitPending) refit();
  if (softPending) softRender();
}

function onHandsFree(): void {
  bookmarkAfterHands();
  if (refitPending) refit();
  if (softPending) softRender();
}

/**
 * A bookmark from another device that arrived while a finger was on the pages waits until they settle: moving the
 * reader under a drag would make a drag that snaps back look like a turn, and stamp this page over theirs.
 */
let bookmarkWaiting = false;

function onBookmarkArrived(): void {
  if (handsMoving()) {
    bookmarkWaiting = true;
    return;
  }
  mushaf.bookmarkArrived();
}

function bookmarkAfterHands(): void {
  if (!bookmarkWaiting) return;
  bookmarkWaiting = false;
  mushaf.bookmarkArrived();
  softPending = true;
}

/**
 * Where a control can be found again after a redraw, closest match first. Buttons sharing an action (the two
 * page-note buttons of a spread) are told apart by their value; if the screen turned meanwhile, the action alone.
 */
function selectorsFor(el: Element | null): string[] {
  const d = el instanceof HTMLElement ? el.dataset : null;
  if (d?.word) return [`[data-word="${CSS.escape(d.word)}"]`];
  if (d?.action) {
    const action = `[data-action="${CSS.escape(d.action)}"]`;
    return d.value ? [`${action}[data-value="${CSS.escape(d.value)}"]`, action] : [action];
  }
  if (d?.go) return [`[data-go="${CSS.escape(d.go)}"]`];
  return [];
}

/** The sheet over the screen. Only busy changed: buttons are switched in place, so typed text is kept. */
function duaSheetFor(mode: string | null): string {
  const def = defOf(mode ?? "");
  return def ? duaSheet(def) : "";
}

function reciteSheetHtml(kind: "recite" | "memorise-done"): string {
  if (kind === "recite") return reciteSheet(state.recite);
  const session = state.memorise;
  return session ? memoriseDoneSheet(session, mushaf.pageWords(session.page)?.at ?? new Map()) : "";
}

/** A recitation sheet drawn again in place, its focus kept on the same control where it is still there. */
function redrawReciteSheet(overlay: HTMLElement, kind: "recite" | "memorise-done"): void {
  const html = reciteSheetHtml(kind);
  if (!html) return closeSheet(true);
  if (overlay.dataset.drawn === html) return;
  const focused = document.activeElement instanceof HTMLElement && overlay.contains(document.activeElement)
    ? selectorsFor(document.activeElement) : [];
  overlay.innerHTML = html;
  overlay.dataset.drawn = html;
  applySizes(overlay);
  const back = focused.map((s) => overlay.querySelector<HTMLElement>(s)).find(Boolean)
    ?? overlay.querySelector<HTMLElement>("[data-autofocus]") ?? overlay.querySelector<HTMLElement>("button");
  back?.focus({ preventScroll: true });
}

function renderOverlay(): void {
  const overlay = byId("overlay");
  const kind = state.sheet;
  if (kind === lastSheet && kind !== null) {
    // The Talk sheet's buttons follow its own phase (talkView.paintTalk), never the app's busy flag.
    if (kind === "talk") return hooks.paintTalk();
    // Recitation's sheets follow their own flow: drawn again when what they say has changed.
    if (kind === "recite" || kind === "memorise-done") return redrawReciteSheet(overlay, kind);
    overlay.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input[type=file]").forEach((el) => {
      if (!el.dataset.go) el.disabled = state.busy;
    });
    return;
  }
  // iOS gives a tapped button no focus, so the control just tapped counts as the one that opened the sheet.
  if (lastSheet === null && kind !== null) opener = selectorsFor(tapped ?? document.activeElement);
  lastSheet = kind;
  discardArmed = false;
  overlay.innerHTML = kind === "talk" ? talkSheet(talkModel())
    : kind === "add-book" ? addBookSheet(state.busy)
    : kind === "new-book" ? newBookSheet(state.draft, state.busy)
    : kind === "word" && state.word ? wordSheet(state.word, mushaf.ayahWords(state.word), state.mushaf)
    : kind === "page-note" ? pageNoteSheet(state.notePage ?? state.mushafPage, state.mushaf)
    : kind === "goto" ? gotoSheet(state.mushafPage)
    : kind === "murajaah" ? murajaahSheet(state.murajaah)
    : kind === "mode-dua" ? duaSheetFor(state.modeDuaFor)
    : kind === "recite" || kind === "memorise-done" ? reciteSheetHtml(kind)
    : kind === "money" && state.moneySheet ? moneySheet(state.moneySheet, money.moneyModel())
    : kind === "review-past" ? review.pastSheet()
    : isLearnSheet(kind) ? learnSheet(kind, learn.sheetModel()) : "";
  // What a recitation sheet was drawn from, so it is drawn again only when that changes (redrawReciteSheet).
  overlay.dataset.drawn = kind === "recite" || kind === "memorise-done" ? overlay.innerHTML && reciteSheetHtml(kind) : "";
  byId("app").inert = kind !== null;
  if (kind) {
    applySizes(overlay);
    // A sheet can name where focus starts, so a keyboard does not jump up over a list or a page. (One selector list
    // would take whichever comes first on the page, not the one named.)
    const start = overlay.querySelector<HTMLElement>("[data-autofocus]") ??
      overlay.querySelector<HTMLElement>("input:not([type=file]), button");
    start?.focus();
  }
  // The speaking orb appears with the Talk sheet (and starts from hidden the next time it opens).
  if (kind === "talk") followTalk(state.talk.phase, talk.talkSignal);
}

/** The clock tick redraws times and sky, but never under a field someone is typing in or a finger mid-tap. */
function tick(): void {
  if (handsBusy()) return;
  const before = state.days[1]?.date;
  softRender();
  if (state.days[1]?.date !== before) void reschedule();
}

/** One reschedule at a time, each planned from the state as it is when its turn comes; unchanged plans are skipped. */
async function savePlace(place: Place): Promise<void> {
  state.place = place;
  state.days = [];
  await save(KEYS.place, place);
  await reschedule();
}

/** A fresh rough position replaces the place when it is new or far enough; a pinned place stays unless asked. */
async function refreshPlace(ask: boolean): Promise<void> {
  if (state.place.source === "pinned" && !ask) return;
  const result = await locate(ask, deviceTimeZone());
  if ("place" in result) {
    if (ask || state.place.source !== "gps" || shouldMove(state.place, result.place)) await savePlace(result.place);
  } else if (ask) {
    setNotice("refused" in result ? MESSAGES.locationOff : MESSAGES.locationFailed);
  }
}

/**
 * Settings' typed coordinates: pinned on the phone's clock, or why not, said inside the form. A refusal keeps what was
 * typed (the form is not the one just sent any more, so the redraw keeps its fields), to be put right there.
 */
async function pinTypedPlace(lat: string, lng: string, label: string): Promise<void> {
  const place = pinnedPlace(lat, lng, label, deviceTimeZone(), Date.now());
  if (!place) {
    // Said once, by the form's own alert line.
    state.placeError = MESSAGES.placeInvalid;
    sentForm = null;
    render();
    return;
  }
  state.placeError = "";
  await savePlace(place);
  setNotice(`Prayer times are now for ${place.label}.`);
  render();
}

async function setLog(log: PrayerLog, said: string): Promise<void> {
  state.log = log;
  render();
  announce(said);
  await save(KEYS.log, log);
}

/** `soft` for leaving the name field, which is often a tap on something else: the redraw waits for that tap. */
async function setSettings(settings: Settings, resched = false, soft = false): Promise<void> {
  state.settings = settings;
  await save(KEYS.settings, settings);
  if (resched) await reschedule();
  if (soft) softRender();
  else render();
}

/** Typed and not yet committed (Back pressed, or the app left while typing): kept, not lost. */
function flushFields(): void {
  clearTimeout(notesTimer);
  const name = document.getElementById("name") as HTMLInputElement | null;
  if (name && cleanName(name.value) !== state.settings.name) void setSettings({ ...state.settings, name: cleanName(name.value) });
  const worker = document.getElementById("voice-url") as HTMLInputElement | null;
  if (worker && worker.value.trim() !== state.settings.voiceUrl) void voice.setWorker(worker.value).then(() => syncShelf());
  const notes = document.getElementById("commentary") as HTMLTextAreaElement | null;
  if (notes) books.saveCommentary(notes.value);
  review.keepReviewDraft();
}

/** `force` once what the sheet held is saved. Otherwise a typed note is never lost to one stray tap or Back. */
function closeSheet(force = false): void {
  // A new book being looked up or saved keeps its sheet (and its photo) until that finishes.
  if (state.busy && state.sheet === "new-book") return;
  if (!force && !discardArmed && (mushaf.noteTyped() || learn.lessonTyped() || modes.duaTyped() || money.moneyTyped())) {
    discardArmed = true;
    mushaf.sheetError("This note is not saved yet. Save it, or close again to let it go.");
    return;
  }
  if (state.sheet === "new-book") books.cancelNewBook();
  // Closing Talk ends the talk going; the orb stops once its sheet is gone (and lets go of its canvas).
  const closingTalk = state.sheet === "talk";
  if (closingTalk) void talk.stopTalk();
  // Closing recite to find stops its microphone.
  if (state.sheet === "recite") recite.sheetClosed();
  state.sheet = null;
  state.word = null;
  releaseHeld();
  renderOverlay();
  if (closingTalk) followTalk("idle", talk.talkSignal);
  const app = byId("app");
  const back = opener.map((selector) => app.querySelector(selector)).find(Boolean)
    ?? app.querySelector('[data-go="talk"], [data-go="add-book"]');
  (back as HTMLElement | null)?.focus({ preventScroll: true });
  opener = [];
  // A size change while the sheet was up (its keyboard, a fold, a turn) is fitted and drawn now.
  if (refitPending) refit();
  if (softPending) softRender();
}

function go(target: string): void {
  if (target === "talk" || target === "add-book") {
    if (state.sheet === target) return;
    state.sheet = target;
    renderOverlay();
    // The Talk sheet starts a talk at once (or asks for the passphrase first).
    if (target === "talk") void talk.openTalk();
    return;
  }
  if (target === "close") return closeSheet();
  // A screen opened from a sheet (the Talk sheet's Settings): the sheet goes first, unless it holds a note not saved.
  if (state.sheet && state.sheet !== "goto") {
    closeSheet();
    if (state.sheet) return;
  }
  flushFields();
  if (target === "mushaf" || target.startsWith("mushaf:")) {
    // Reading on: "mushaf" (Home, the Quran screen, the widget) opens at the bookmark, and a page chosen in the go-to
    // sheet while reading on is where the user reads on from. A page opened from anywhere else is revision, and the go-to
    // sheet inside a revision stays revision: the bookmark stays.
    const mode = mushaf.openModeFor(target, state.sheet, state.mushafReading);
    // From the go-to sheet: the sheet closes as the page opens.
    if (state.sheet === "goto") closeSheet(true);
    const from = state.screen;
    if (from === "home" || from === "faith" || from === "quran" || from === "adhkar:morning" || from === "adhkar:evening") {
      state.mushafFrom = from;
    } else if (from !== "mushaf") state.mushafFrom = "quran";
    // Back from the mushaf, an adhkar list opens where it was left, at the dhikr just read.
    if (from === "adhkar:morning" || from === "adhkar:evening") adhkarScroll = window.scrollY;
    mushaf.openFrom(target === "mushaf" ? bookmarkPage(state.mushaf, state.quran) : Number(target.slice(7)), mode);
    show("mushaf");
    // The user's other devices may have read on since the last sync: a bookmark that arrives while this page waits opens.
    if (mode !== "revise") syncRecordsSoon();
    return;
  }
  // An adhkar list goes back where it was opened from; back from the mushaf it keeps that.
  if ((target === "adhkar:morning" || target === "adhkar:evening") &&
    (state.screen === "home" || state.screen === "faith" || state.screen.startsWith("mode:"))) {
    state.adhkarFrom = state.screen as typeof state.adhkarFrom;
  }
  if (target === "modes" && (state.screen === "home" || state.screen === "faith")) state.modesFrom = state.screen;
  if (target === "review" && (state.screen === "home" || state.screen === "modes")) state.reviewFrom = state.screen;
  // A mode goes back where it was opened from; back from its reading or its adhkar it keeps that.
  if (target.startsWith("mode:") && (state.screen === "home" || state.screen === "faith" || state.screen === "modes" ||
    state.screen.startsWith("learn:"))) {
    state.modeFrom = state.screen;
  }
  show(target);
}

/**
 * A tap on the home-screen widget (awqat://go/<screen>). Only the screens the widget opens are followed, and a
 * sheet holding typing (a mushaf note, a new book) is never closed under it, however many links arrive.
 */
function openLink(url: string): void {
  const target = linkTarget(url);
  if (!target || state.sheet === "new-book" || mushaf.noteTyped() || learn.lessonTyped() || modes.duaTyped() || money.moneyTyped()) return;
  // A link to a mode that is not there does nothing at all, a Talk under way included.
  if (target.startsWith("mode:") && !hasMode(target.slice(5))) return;
  if (state.sheet) closeSheet();
  if (state.sheet) return;
  // The page line opens the page it shows: the bookmark, where the user stopped reading.
  go(target === "revise" ? plan.reviseTarget() : target);
}

/** A mode the app has: one of the fixed ones, or a study of a subject the user has. */
const hasMode = (mode: string): boolean => defOf(mode) !== null || state.learn.tracks.some((t) => `study:${t.id}` === mode);

/** Shows a screen by name, if it is one the app has. */
function show(target: string): void {
  const known = ["home", "faith", "settings", "quran", "mushaf", "books", "agenda", "body", "money", "work", "inbox", "review", "adhkar:morning",
    "adhkar:evening", "learn", "learn-review"].includes(target) ||
    (target.startsWith("book:") && state.library.books.some((b) => b.id === target.slice(5))) ||
    (target.startsWith("learn:") && state.learn.tracks.some((t) => t.id === target.slice(6))) ||
    target === "modes" || (target.startsWith("mode:") && hasMode(target.slice(5)));
  // Work and Inbox come from the user's own server: without one there is nothing to show there.
  const serverOnly = (target === "work" || target === "inbox") && !workerUrl(state.settings.voiceUrl);
  if (!known || serverOnly) return;
  const backToList = target === "books" && state.screen.startsWith("book:");
  const backToAdhkar = target.startsWith("adhkar:") && state.screen === "mushaf" && state.mushafFrom === target;
  // A mode's list, too, opens where it was left after its reading or its adhkar.
  const leavingMode = state.screen.startsWith("mode:") && (target === "mushaf" || target.startsWith("adhkar:"));
  if (leavingMode) {
    modeScroll = window.scrollY;
    modeScrollFor = state.screen;
  }
  const backToMode = target === modeScrollFor && (state.screen === "mushaf" || state.screen.startsWith("adhkar:"));
  if (!target.startsWith("book")) {
    state.search = "";
    state.showing = LIST_PAGE;
  }
  state.screen = target as Screen;
  state.notice = "";
  state.placeError = "";
  state.removeArmed = null;
  state.undoArmed = false;
  state.calendarRemoveArmed = null;
  state.weightRemoveArmed = null;
  state.learnRemoveArmed = null;
  state.modeRemoveArmed = null;
  state.moneyArmed = null;
  state.liftRemoveArmed = null;
  if (target !== "agenda") state.agendaDay = null;
  render();
  if (backToAdhkar) window.scrollTo(0, adhkarScroll);
  else if (backToMode) window.scrollTo(0, modeScroll);
  else if (!backToList) window.scrollTo(0, 0);
  // Opening a screen reads what it shows when the copy is old: the calendars (the Weekly Review looks ahead at them too),
  // or the health store.
  if (target === "agenda" || target === "review") void agenda.refreshAgenda();
  if (target === "body") void body.openBody();
  const feed = feedOfScreen(target);
  if (feed) void refreshFeed(feed);
  // Books opened: the library syncs, and the TV's shelf is sent if it changed or an earlier send did not get through.
  if (target === "books") {
    syncBooksSoon();
    void syncShelf();
  }
  // Faith, Quran and Learn opened: the user's records sync (at most every half minute), so they show the user's other devices' work.
  if (target === "faith" || target === "quran" || target === "learn" || target === "modes" || target === "money" || target === "body" ||
    target === "review" || target.startsWith("mode:")) {
    syncRecordsSoon();
  }
}

/** A workout's timer: Start, or Stop, which also marks today's training done. */
async function workoutTimer(): Promise<void> {
  if (!modes.toggleWorkout()) return;
  if (!dayDone(state.body, today())) await body.toggleTodayDone();
}

/**
 * What was tapped on a widget or the island while the app was away goes on the counts. They stay queued natively until
 * the log can really take them: not before it is loaded (a resume can come first, and would save over it), nor when
 * its saved copy could not be read.
 */
async function takeTaps(): Promise<void> {
  if (!loaded || state.blocked.has(KEYS.modes)) return;
  const taps = await drainTaps();
  if (taps.length > 0) modes.addTaps(taps);
}

async function runPrayerAction(action: string): Promise<void> {
  if (action === "setup") {
    await refreshPlace(true);
    state.notify = await notifyPermission(true);
    if (state.notify === "denied") setNotice(MESSAGES.notifyOff);
    await setSettings({ ...state.settings, setupDone: true }, true);
  } else if (action === "skip-setup") {
    await setSettings({ ...state.settings, setupDone: true });
  } else if (action === "locate") {
    await refreshPlace(true);
  } else if (action === "notify") {
    state.notify = await notifyPermission(true);
    if (state.notify === "denied") setNotice(MESSAGES.notifyOff);
    await reschedule();
  } else if (action === "exact") {
    await openExactAlarmSettings();
  }
}

/** Book actions that open the camera or scanner close the sheet first, so their result shows on the screen. */
function leaveSheetFor(work: () => Promise<void>): void {
  state.sheet = null;
  renderOverlay();
  void work();
}

function act(action: string, value: string): void {
  switch (action) {
    case "quran-plus": return quran.readMore(Number(value));
    case "quran-undo": return quran.undoLastRead();
    case "quran-juz": return quran.toggleJuz(Number(value));
    case "study-delete": return quran.deleteStudy(value);
    case "book-scan": return leaveSheetFor(books.scan);
    case "book-camera": return leaveSheetFor(() => books.photograph("camera"));
    case "book-gallery": return leaveSheetFor(() => books.photograph("gallery"));
    case "book-type": return books.typeIn();
    case "book-photo": return void books.changeCover();
    case "book-remove": return books.removeBook();
    case "lesson-delete": return books.removeLesson(value);
    case "shelf-filter": return books.filterShelf(value);
    case "friday": return void friday.toggleItem(value);
    case "mode-pick": return modes.pick(value);
    case "mode-not-now": return modes.notNow(value);
    case "mode-count": return modes.count(value);
    case "mode-done": return modes.toggleDone(value);
    case "mode-back": return modes.takeBack(value);
    case "mode-read": return modes.read(value);
    case "mode-quran": return modes.readAyat(value);
    case "money-sheet": return money.openSheet(value);
    case "money-paid": return void money.paidTap(value);
    case "money-remove": return void money.removeTap(value);
    case "money-confirm": return void money.confirmFeedItem(value);
    case "money-skip": return void money.skipFeedTap(value);
    case "feed-refresh": return void (isFeedKind(value) ? refreshFeed(value, true) : undefined);
    case "mail-copy": return void copyDraft(value).then((copied) => {
      state.mailCopied = copied ? value : null;
      if (!copied) setNotice("That could not be copied.");
      render();
    });
    case "mode-dua-add": return modes.openDuaSheet(value);
    case "mode-dua-remove": return modes.removeDuaTap(value);
    case "mode-timer-start": return modes.startStudy(value);
    case "mode-timer-stop": return modes.stopStudy(value);
    case "mode-timer-drop": return modes.dropStudy();
    case "mushaf-jump-back": return mushaf.jumpBack();
    case "dhikr": return adhkar.count(value);
    case "dhikr-done": return adhkar.toggleDone(value);
    case "dhikr-back": return adhkar.takeBack(value);
    case "book-next": return turnBook(1);
    case "book-back": return turnBook(-1);
    case "mushaf-theme": return mushaf.toggleTheme();
    case "mushaf-read": return mushaf.readHere();
    case "mushaf-revise": return mushaf.reviseJuz();
    case "mushaf-page-note": return mushaf.openPageNote(value);
    case "mushaf-goto": return mushaf.openGoto();
    case "mushaf-mistake": return mushaf.markWord();
    case "mushaf-clear": return mushaf.clearWord();
    case "mushaf-retry": return mushaf.retry();
    case "mushaf-download": return void mushaf.downloadAll();
    // Recitation: the header's microphone opens the sheet; a found ayah's button carries its "sura:ayah".
    case "recite-open": return void (value ? recite.openFound(value) : recite.openFind());
    case "recite-download": return void recite.download();
    case "recite-stop": return recite.stopFind();
    case "recite-again": return recite.again();
    case "memorise-start": return void recite.startMemorising();
    case "memorise-toggle": return recite.toggleListening();
    case "memorise-peek": return recite.peekWord();
    case "memorise-done": return recite.finishMemorising();
    case "memorise-clear": return recite.clearWordSlip(value);
    case "memorise-keep": return void recite.keepSlips();
    case "memorise-again": return recite.memoriseAgain();
    case "memorise-end": return recite.endMemorising();
    case "memorise-back": return recite.backToPage();
    case "murajaah-setup": return plan.openSetup();
    case "murajaah-all": return plan.chooseAll(value === "on");
    case "copy-goodreads": return void books.copyGoodreadsAddress();
    case "books-more": return books.showMore();
    case "book-search-clear": return books.searchLibrary("");
    case "books-covers": return void covers.findCovers();
    case "intention-tick": return void review.tickIntention(value);
    case "review-past": return review.openPastReview(value);
    case "agenda-day": return agenda.pickDay(value);
    case "agenda-refresh": return void agenda.refreshAgenda(true);
    case "calendar-remove": return void agenda.removeCalendarTap(value);
    case "workout-done": return void body.toggleTodayDone();
    case "workout-timer": return void workoutTimer();
    case "mode-live": return modes.toggleLive(value);
    case "lift-remove": return void body.removeLiftTap(value);
    case "health-connect": return void body.connect();
    case "health-refresh": return void body.readBody();
    case "health-settings": return body.healthSettings();
    case "weight-remove": return void body.removeTypedWeightTap(Number(value));
    case "learn-log": return learn.openLogSheet(value);
    case "learn-add-item": return learn.openItemSheet(value);
    case "learn-add-lesson": return learn.openLessonSheet(value);
    case "learn-add-track": return learn.openTrackSheet();
    case "learn-archive": return void learn.toggleArchive(value);
    case "learn-item": return void learn.cycleStatus(value);
    case "learn-item-remove": return void learn.removeItemTap(value);
    case "learn-open": return void learn.openItem(value);
    case "learn-session-remove": return void learn.removeSessionTap(value);
    case "learn-lesson-remove": return void learn.removeLessonTap(value);
    case "learn-remembered": return void learn.reviewLesson(value, true);
    case "learn-again": return void learn.reviewLesson(value, false);
    case "talk-open": return void voice.openTalk();
    case "talk-start": return void talk.startAgain();
    case "talk-end": return void talk.endTalk();
    case "talk-mute": return talk.toggleMute();
    case "talk-undo": return void undoTalkLog().then(announce);
    case "talk-signout": return void busyWhile(() => talk.signOutOfTalk()).then(() => syncShelf());
    default: void busyWhile(() => runPrayerAction(action));
  }
}

function markSaid(log: PrayerLog, date: string, p: PrayerName): string {
  const mark = log.days[date]?.prayers[p];
  const what = !mark ? "not marked" : mark.status === "late" ? "prayed late" : mark.mosque ? "on time at the mosque" : "on time";
  return `${PRAYER_LABEL[p]}: ${what}.`;
}

/** The reader's bars shown or hidden in place (the page under them is not redrawn). */
function toggleReaderBars(): void {
  mushaf.toggleBars();
  paintReaderBars();
}

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  // A tap beside the sheet closes it, except a new book's, which holds typing and maybe a photo: that needs Cancel.
  if (state.sheet && target.classList.contains("sheet")) return state.sheet === "new-book" ? undefined : closeSheet();
  const el = target.closest<HTMLElement>("[data-go],[data-mark],[data-sunnah],[data-owed],[data-action],[data-word]");
  // A tap on the mushaf's page, on its words too, shows or hides the bars laid over it; holding a word picks its ayah
  // (hold.ts). A word reached by keyboard still opens its ayah with Enter or Space (a click with no taps counted).
  if (tapOnPage(target, event.detail, state.screen === "mushaf" && !state.sheet) === "bars") return toggleReaderBars();
  if (!el || (el as HTMLButtonElement).disabled) return;
  tapped = el;
  try {
    handleTap(el);
  } finally {
    tapped = null;
  }
}

/** A word held in the mushaf: its ayah's sheet opens, and closing it brings focus back to the word. */
function holdWord(el: HTMLElement): void {
  tapped = el;
  try {
    handleTap(el);
  } finally {
    tapped = null;
  }
}

function handleTap(el: HTMLElement): void {
  const d = el.dataset;
  // While a page is memorised, holding a word does not open its ayah: that would show the hidden words.
  if (d.word) return state.memorise && state.memorise.phase !== "left" ? undefined : mushaf.openWord(d.word);
  const day = model(new Date()).today.date;
  if (d.go) go(d.go);
  else if (d.mark && (PRAYERS as readonly string[]).includes(d.mark)) {
    const prayer = d.mark as PrayerName;
    const log = cycleMark(state.log, day, prayer);
    void setLog(log, markSaid(log, day, prayer));
  } else if (d.sunnah === "duha" || d.sunnah === "witr" || d.sunnah === "night") {
    const log = toggleSunnah(state.log, day, d.sunnah as Sunnah);
    void setLog(log, `${d.sunnah}: ${log.days[day].sunnah[d.sunnah as Sunnah] ? "prayed" : "not marked"}.`);
  } else if (d.owed === "1" || d.owed === "-1") {
    const log = adjustOwed(state.log, Number(d.owed));
    void setLog(log, `${log.owed} to make up.`);
  } else if (d.action) act(d.action, d.value ?? "");
}

function onSubmit(event: SubmitEvent): void {
  const form = event.target as HTMLFormElement;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? "");
  sentForm = kind;
  setTimeout(() => { sentForm = null; }, 0);
  if (kind === "quran-read") quran.readTo(Number(text("page")));
  else if (kind === "quran-place") quran.setPlace(Number(text("page")));
  else if (kind === "quran-goal") quran.setGoal(Number(text("pages") || "0"));
  else if (kind === "quran-study") quran.addStudy(text("text"), Number(text("minutes")));
  else if (kind === "book-search") books.searchLibrary(text("q"));
  else if (kind === "ayah-note") mushaf.saveAyahNote(text("text"));
  else if (kind === "page-note") mushaf.savePageNote(text("text"));
  else if (kind === "mushaf-goto") go(`mushaf:${Number(text("page"))}`);
  else if (kind === "murajaah") void plan.savePlan(data.getAll("juz"), data.get("perDay"));
  else if (kind === "place-pin") void pinTypedPlace(text("lat"), text("lng"), text("label"));
  else if (kind === "goal") books.setYearGoal(Number(text("goal")));
  else if (kind === "book-new") void books.submitNewBook(data);
  else if (kind === "book-page") books.logPage(Number(text("page")), text("note"));
  else if (kind === "book-lesson") books.addLessonNow(text("text"));
  else if (kind === "calendar-add") void agenda.addCalendarAddress(text("ical-url"));
  else if (kind === "review") void review.submitReview(data);
  else if (kind === "weight-add") void body.addTypedWeight(text("kg"));
  else if (kind === "workout-target") void body.setWeeklyTarget(text("target"));
  else if (kind === "step-goal") void body.setStepGoalText(text("goal"));
  else if (kind === "workout-plan") void body.savePlan(data);
  else if (kind === "lift-add") void body.logLift(data);
  else if (kind === "learn-session") void learn.logStudy(data).then(modes.studyLogged);
  else if (kind === "mode-dua") void modes.submitDua(data);
  else if (kind === "money") void money.submit(data);
  else if (kind === "learn-item") void learn.submitItem(data);
  else if (kind === "learn-lesson") void learn.submitLesson(data);
  else if (kind === "learn-track") void learn.submitTrack(data);
  else if (kind === "learn-target") void learn.setTarget(text("minutes"));
  else if (kind === "talk-signin") {
    // The passphrase leaves the page's field at once: it is sent once and never kept.
    const field = form.elements.namedItem("passphrase");
    if (field instanceof HTMLInputElement) field.value = "";
    // Signed in: the library can sync and the TV's shelf can go now (both wait for a session).
    void talk.talkSignIn(text("passphrase")).then(() => Promise.all([syncBooks(), syncRecords(), syncShelf()]));
  }
}

function onChange(event: Event): void {
  const el = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const field = el.dataset.field;
  if (field === "name") void setSettings({ ...state.settings, name: cleanName(el.value) }, false, true);
  else if (field === "method") {
    state.days = [];
    void setSettings({ ...state.settings, method: isMethod(el.value) ? el.value : "auto" }, true);
  } else if (el.dataset.iqama && (PRAYERS as readonly string[]).includes(el.dataset.iqama)) {
    const prayer = el.dataset.iqama as PrayerName;
    const typed = parseIqamaMinutes(el.value);
    const minutes = typed ?? state.settings.iqama[prayer];
    // What was typed out of range is put back to the value kept, so the field never shows what is not in use.
    el.value = String(minutes);
    if (typed === null) announce(`The iqama is ${IQAMA_MIN} to ${IQAMA_MAX} minutes after the adhan.`);
    if (minutes === state.settings.iqama[prayer]) return;
    state.days = [];
    void setSettings({ ...state.settings, iqama: { ...state.settings.iqama, [prayer]: minutes } }, true);
  } else if (el.dataset.remind && (PRAYERS as readonly string[]).includes(el.dataset.remind)) {
    const reminders = { ...state.settings.reminders, [el.dataset.remind]: (el as HTMLInputElement).checked };
    void setSettings({ ...state.settings, reminders }, true);
  } else if (field === "friday-reminders") {
    void setSettings({ ...state.settings, fridayReminders: (el as HTMLInputElement).checked }, true);
  } else if (field === "adhkar-reminders") {
    void setSettings({ ...state.settings, adhkarReminders: (el as HTMLInputElement).checked }, true);
  } else if (field && REMINDER_FIELDS.has(field)) {
    const reviewReminder = withReminderField(state.settings.reviewReminder, field, el.value, (el as HTMLInputElement).checked);
    if (reviewReminder !== state.settings.reviewReminder) void setSettings({ ...state.settings, reviewReminder }, true);
  } else if (field === "adhan") {
    void setSettings({ ...state.settings, adhan: (el as HTMLInputElement).checked }, true);
  } else if (field === "book-pages") {
    void setSettings({ ...state.settings, bookPages: (el as HTMLInputElement).checked }, false);
  } else if (field === "live") {
    void setSettings({ ...state.settings, live: (el as HTMLInputElement).checked }, false);
  } else if (field === "assistant-money") {
    void setSettings({ ...state.settings, assistantMoney: (el as HTMLInputElement).checked }, false);
  } else if (field === "assistant-health") {
    void setSettings({ ...state.settings, assistantHealth: (el as HTMLInputElement).checked }, false);
  } else if (field === "voice-url") {
    // A new Worker address: the shelf's line says at once whether this one has a sign-in.
    void voice.setWorker(el.value).then(() => syncShelf());
  }
  else if (field === "mode-study-after") modes.setAfter(el.dataset.track ?? "", el.value);
  else if (field === "book-shelf") books.moveShelf(el.value);
  else if (field === "commentary") {
    clearTimeout(notesTimer);
    books.saveCommentary(el.value);
  } else if (el.dataset.file === "goodreads") {
    const input = el as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared, so choosing the same file again after an error still counts as a change.
    input.value = "";
    if (file) void books.importGoodreads(file);
  }
}

/** Notes save themselves a moment after typing stops, for the book they were typed into. */
function onInput(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  // Typing more after "not saved yet" means the next close asks again.
  if (byId("overlay").contains(el)) discardArmed = false;
  if (el.dataset?.field !== "commentary") return;
  const id = state.screen.startsWith("book:") ? state.screen.slice(5) : null;
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => books.saveCommentary(el.value, true, id), NOTES_PAUSE_MS);
}

/** A cover file that cannot be read shows the book's letter instead of a broken image. */
function onImageError(event: Event): void {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("cover")) return;
  const blank = document.createElement("span");
  blank.className = `${img.className} blank`;
  blank.setAttribute("aria-hidden", "true");
  blank.textContent = img.dataset.letter ?? "?";
  img.replaceWith(blank);
}

function onBack(): void {
  if (state.sheet) closeSheet();
  else if (state.screen.startsWith("book:")) go("books");
  else if (state.screen === "quran") go("faith");
  else if (state.screen === "mushaf") go(state.mushafFrom);
  else if (state.screen.startsWith("learn:") || state.screen === "learn-review") go("learn");
  else if (state.screen.startsWith("mode:")) go(state.modeFrom);
  else if (state.screen === "modes") go(state.modesFrom);
  else if (state.screen === "review") go(state.reviewFrom);
  else if (adhkar.openSession()) go(state.adhkarFrom);
  else if (state.screen !== "home") go("home");
  else void App.exitApp();
}

function onResume(): void {
  // A finger lifted while the app was away never sent its pointerup.
  resetHands();
  resetHold();
  // A page that needed the internet may find it now; words kept past their 7 days go.
  if (state.screen === "mushaf") mushaf.retry();
  else render();
  void pruneKeptPages();
  // The calendars are read again when the copy is old (Home's next meeting needs them too), and Body reads again.
  void agenda.refreshAgenda();
  if (state.screen === "body") void body.openBody();
  else body.readForHome();
  const feed = feedOfScreen(state.screen);
  if (feed) void refreshFeed(feed);
  void takeTaps();
  void (async () => {
    state.notify = await notifyPermission(false);
    await refreshPlace(false);
    await reschedule();
    softRender();
  })();
  // Back with a connection, perhaps: the library and the user's records sync, and a shelf that did not get through goes now.
  syncBooksSoon();
  syncRecordsSoon();
  void syncShelf();
}

/** Reads everything saved. True when the library was read whole and has books, the only case its files can be tidied. */
async function load(): Promise<boolean> {
  const keys = [KEYS.log, KEYS.settings, KEYS.place, KEYS.quran, KEYS.library, KEYS.friday, KEYS.adhkar, KEYS.mushaf,
    KEYS.murajaah, KEYS.agenda, KEYS.body, KEYS.bookSync, KEYS.learn, KEYS.modes, KEYS.money,
    KEYS.recordsSync, KEYS.reviews] as const;
  const [reads, calendarsRead] = await Promise.all([Promise.all(keys.map((k) => read(k))), readCalendarsFile()]);
  const raw = Object.fromEntries(keys.map((k, i) => [k, reads[i]])) as Record<(typeof keys)[number], ReadResult>;
  keys.forEach((key) => { if (!raw[key].ok) state.blocked.add(key); });
  const log = checkLog(raw[KEYS.log].value);
  const quranLog = checkQuranLog(raw[KEYS.quran].value);
  const library = checkLibrary(raw[KEYS.library].value);
  const fridayLog = checkFridayLog(raw[KEYS.friday].value);
  const modeLog = checkModeLog(raw[KEYS.modes].value);
  const moneyLog = checkMoney(raw[KEYS.money].value);
  const adhkarLog = checkAdhkarLog(raw[KEYS.adhkar].value);
  const marks = checkMarks(raw[KEYS.mushaf].value);
  const murajaah = checkPlan(raw[KEYS.murajaah].value);
  const reviews = checkReviewLog(raw[KEYS.reviews].value);
  // The calendars' addresses are secrets: never copied aside (calendarStore.ts). A file that is there but cannot be read
  // is left alone for the session, as other records are; one from a test build's settings store is moved in.
  let calendarsText = calendarsRead.ok ? calendarsRead.value : null;
  if (calendarsRead.ok) calendarsText = (await adoptOldCalendars(calendarsText === null)) ?? calendarsText;
  else state.blocked.add(KEYS.calendars);
  const calendars = checkCalendars(calendarsText);
  const bodyLog = checkBody(raw[KEYS.body].value);
  // Learn starts from the default empty Islamic tracks only where it was never saved (learn/seed.ts).
  const learnLog = startingLearn(raw[KEYS.learn]);
  const damaged = [[KEYS.log, log.damaged], [KEYS.quran, quranLog.damaged], [KEYS.library, library.damaged],
    [KEYS.friday, fridayLog.damaged], [KEYS.modes, modeLog.damaged], [KEYS.money, moneyLog.damaged], [KEYS.adhkar, adhkarLog.damaged],
    [KEYS.mushaf, marks.damaged],
    [KEYS.murajaah, murajaah.damaged],
    [KEYS.body, bodyLog.damaged], [KEYS.learn, learnLog.damaged], [KEYS.reviews, reviews.damaged]] as const;
  for (const [key, isDamaged] of damaged) {
    const value = raw[key].value;
    // A damaged value with no copy kept aside is never written over this session.
    if (isDamaged && value !== null && !(await keepAside(key, value))) state.blocked.add(key);
  }
  state.log = log.log;
  state.quran = quranLog.log;
  state.library = library.library;
  state.friday = fridayLog.log;
  state.modes = modeLog.log;
  state.money = moneyLog.money;
  state.adhkar = adhkarLog.log;
  state.mushaf = marks.marks;
  state.murajaah = murajaah.plan;
  state.reviews = reviews.log;
  state.calendars = calendars.list;
  state.body = bodyLog.log;
  state.learn = learnLog.learn;
  // The agenda is a copy of the calendars, read again whenever it is old: one that cannot be read starts afresh.
  state.agenda = checkAgenda(raw[KEYS.agenda].value, calendars.list.calendars.map((c) => c.id));
  state.blocked.delete(KEYS.agenda);
  // What is left to sync can always be had again (a fresh sync sends every book once more): one that cannot be read
  // starts afresh, and is never held read-only like the user's records.
  state.bookSync = checkSync(raw[KEYS.bookSync].value);
  state.blocked.delete(KEYS.bookSync);
  state.recordsSync = checkRecordsSync(raw[KEYS.recordsSync].value);
  state.blocked.delete(KEYS.recordsSync);
  // Learn's starting tracks are shown but not saved until the user's first change (learn/seed.ts).
  state.learnSeedOnly = raw[KEYS.learn].ok && raw[KEYS.learn].value === null;
  state.mushafPage = marks.marks.lastPage;
  state.settings = parseSettings(raw[KEYS.settings].value);
  state.place = parsePlace(raw[KEYS.place].value) ?? DEFAULT_PLACE;
  if (state.blocked.size > 0) setNotice(MESSAGES.unreadable);
  const libraryRaw = raw[KEYS.library];
  return libraryRaw.ok && libraryRaw.value !== null && !library.damaged && state.library.books.length > 0;
}

async function boot(): Promise<void> {
  hooks.render = render;
  hooks.syncSurfaces = () => syncSurfaces();
  hooks.softRender = softRender;
  hooks.renderOverlay = renderOverlay;
  hooks.closeSheet = closeSheet;
  hooks.go = go;
  hooks.showReader = () => show("mushaf");
  hooks.paintTalk = () => {
    if (state.sheet !== "talk") return;
    paintTalk(talkModel());
    followTalk(state.talk.phase, talk.talkSignal);
  };
  hooks.reschedule = reschedule;
  hooks.findCovers = covers.findCovers;
  hooks.saved = recordSaved;
  hooks.bookmarkArrived = onBookmarkArrived;
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onInput);
  document.addEventListener("error", onImageError, true);
  listenForHands({ settled: onSettled, free: onHandsFree });
  listenForBook({ landed: (page) => onSettled(page), moving: bookMoving });
  listenForHold({ hold: holdWord, ready: () => state.screen === "mushaf" && !state.sheet });
  window.addEventListener("resize", () => requestAnimationFrame(refit));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.sheet) closeSheet();
    // Right to left, as the pages are: the left arrow reads on.
    if (state.screen === "mushaf" && !state.sheet && (e.key === "ArrowLeft" || e.key === "ArrowRight")) turnBook(e.key === "ArrowLeft" ? 1 : -1);
  });
  document.addEventListener("visibilitychange", () => {
    resetHands();
    resetHold();
    resetBook();
    if (document.hidden) flushFields();
  });
  setInterval(tick, TICK_MS);
  if (isNative()) {
    void App.addListener("resume", onResume);
    void App.addListener("pause", () => {
      flushFields();
      // A talk does not go on with the app out of sight (the system would cut its microphone anyway), except through
      // Android's microphone prompt, which pauses the app itself.
      void talk.pauseTalk();
    });
    void App.addListener("backButton", onBack);
  }
  await prepareFolders();
  const libraryReadCleanly = await load();
  loaded = true;
  mushaf.setSpread(showsSpread(window.innerWidth, window.innerHeight));
  render();
  body.readForHome();
  // Widget taps, only once what was saved is loaded: a tap that started the app is held by Capacitor until now, so
  // nothing is drawn (or sent to the widget) from empty state.
  if (isNative()) void App.addListener("appUrlOpen", (event) => openLink(event.url));
  // A tapped reminder opens its mode, by the same rule: never over a sheet holding typing.
  if (isNative()) {
    void LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
      // Another app can send this intent with no notification in it: nothing happens then.
      const id: unknown = event.notification?.id;
      const target = typeof id === "number" ? reminderTarget(id) : null;
      if (!target || state.sheet === "new-book" || mushaf.noteTyped() || learn.lessonTyped() || modes.duaTyped() || money.moneyTyped()) return;
      if (state.sheet) closeSheet();
      if (!state.sheet) go(target);
    });
  }
  // Old cover files are cleared first. Books still without a cover get theirs once the library has synced (below), so a
  // lookup never works on a copy another device has already changed.
  const tidied = covers.tidyCovers(libraryReadCleanly).catch(() => undefined);
  void pruneKeptPages();
  state.notify = await notifyPermission(false);
  await refreshPlace(false);
  // The iPhone's adhan copies go where iOS looks for a reminder's sound, before any reminder names them.
  await installAdhanSounds();
  await reschedule();
  softRender();
  void agenda.refreshAgenda();
  void takeTaps();
  // Whether this device is signed in to Talk, for Settings; nothing is started. With the session read, the library
  // syncs and the TV's shelf is sent once (what the TV shows may be from another device or an older library).
  void talk.loadTalkSession().then(async () => {
    softRender();
    // A feed's screen opened before the session was read could not read it.
    const feed = feedOfScreen(state.screen);
    if (feed) void refreshFeed(feed);
    await Promise.all([syncBooks(), syncRecords(), syncShelf()]);
    await tidied;
    await covers.findCovers(true);
  });
}

boot().catch(() => {
  byId("app").textContent = "Awqat could not start. Close it and open it again.";
});
