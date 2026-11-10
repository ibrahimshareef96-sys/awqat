/** The screens, as HTML strings from the app's state. Taps are handled in main.ts through data-* attributes. */
import { METHODS, METHOD_LABEL, type MethodId } from "../prayer/method.ts";
import { PRAYERS, PRAYER_LABEL, formatTime, type DayTimes, type PrayerName } from "../prayer/times.ts";
import { currentPrayer, nextPrayer, untilPhrase } from "../prayer/window.ts";
import { IQAMA_MAX, IQAMA_MIN, iqamaAt, iqamaCountdown } from "../prayer/iqama.ts";
import { SUNNAH, weekDots, type PrayerLog, type Sunnah } from "../prayer/log.ts";
import { hijriDate } from "../prayer/hijri.ts";
import { greetingFor, type Settings } from "../settings.ts";
import { PLACE_LABEL_MAX, type Place } from "../place.ts";
import { ADHAN_BUNDLED, platform, type NotifyState } from "../device.ts";
import { PAGES } from "../quran/data.ts";
import { lastRevised, pageLabel, type QuranLog } from "../quran/log.ts";
import { revisionLine, type MurajaahPlan } from "../quran/murajaah.ts";
import { currentPage, inHand, type Library } from "../books/library.ts";
import { deviceWord } from "./deviceWord.ts";
import { esc, icon, orb } from "./html.ts";
import type { TurnStats } from "./pageTurn.ts";
import { quranSummary } from "./quranView.ts";
import { cover } from "./booksView.ts";
import { modePrompts, type ModesModel } from "./modesView.ts";
import { calendarsCard, homeAgendaCard, type AgendaModel } from "./agendaView.ts";
import { homeBodyCard, type BodyModel } from "./bodyView.ts";
import { prayerName } from "../faith/friday.ts";
import type { AdhkarLog, AdhkarWindow } from "../faith/adhkar.ts";
import { faithAdhkarCard, homeAdhkarCard } from "./adhkarView.ts";
import { homeLearnCard } from "./learnView.ts";
import type { Learn } from "../learn/learn.ts";
import type { Intention } from "../review/muhasabah.ts";
import { homeWeekCard, reviewReminderFields } from "./reviewView.ts";
import { BUILT_IN_WORKER } from "../voice.ts";
import { DOWNLOAD_BYTES } from "../recite/assets.ts";

export interface ViewModel {
  now: Date;
  /** The prayer day (Fajr to Fajr) and the one after it. */
  today: DayTimes;
  tomorrow: DayTimes;
  log: PrayerLog;
  settings: Settings;
  place: Place;
  method: MethodId;
  notify: NotifyState;
  exact: "granted" | "denied" | "unknown";
  pending: number | null;
  /** The phone's time zone now; differs from the place's when the place was pinned or set elsewhere. */
  deviceTz: string;
  notice: string;
  busy: boolean;
  quran: QuranLog;
  /** The mushaf's bookmark: the page the user stopped reading on, where Home's Quran card opens it. */
  bookmark: number;
  library: Library;
  /** What the user learns: Home's Learn card. */
  learn: Learn;
  /** Today's calendar date in the place's zone, YYYY-MM-DD (Quran and books are kept by calendar day). */
  date: string;
  /** The modes: what is open now and what waits, for the prompt on Home and Faith. */
  modes: ModesModel;
  adhkar: AdhkarLog;
  /** The adhkar set open now (morning from Fajr, evening from Asr), if any. */
  adhkarOpen: AdhkarWindow | null;
  murajaah: MurajaahPlan | null;
  agenda: AgendaModel;
  body: BodyModel;
  /** The Worker the voice page is on, or "" when none is set. */
  worker: string;
  /** This device holds a Talk session for that Worker. */
  talkSignedIn: boolean;
  /** How the sync of the user's records stands, in words (sync/records.ts recordsMessage), or "". */
  records: string;
  /** Why the coordinates typed in Settings were not taken, shown inside that form; "" when they were. */
  placeError: string;
  /** The intentions set in the last Weekly Review, for Home, while they are for this week (review/muhasabah.ts). */
  week: { week: string; intentions: readonly Intention[] } | null;
}

const SUNNAH_LABEL: Readonly<Record<Sunnah, string>> = { duha: "Duha", witr: "Witr", night: "Night" };

const time = (v: ViewModel, d: Date): string => formatTime(d, v.place.tz);

function longDate(v: ViewModel): string {
  return v.now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: v.place.tz })
    .replace(",", "").toUpperCase();
}

export function header(title: string, sub: string, back = "home", backLabel = "Home"): string {
  return `<header class="head"><button type="button" class="round" data-go="${esc(back)}" aria-label="Back to ${esc(backLabel)}">` +
    `${icon("back")}</button><div><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div></header>`;
}

export function noticeLine(v: Pick<ViewModel, "notice">): string {
  return v.notice ? `<p class="notice" role="status">${esc(v.notice)}</p>` : "";
}

function busy(v: ViewModel): string {
  return v.busy ? " disabled" : "";
}

function prayerDots(v: ViewModel): string {
  const marks = v.log.days[v.today.date]?.prayers ?? {};
  return `<span class="dots" aria-hidden="true">${PRAYERS.map((p) =>
    `<span class="dot ${marks[p] ? (marks[p]!.status === "late" ? "late" : "on") : ""}"></span>`).join("")}</span>`;
}

function setupCard(v: ViewModel): string {
  if (v.settings.setupDone) return "";
  return `<section class="card"><h2 class="label">PRAYER TIMES WHERE YOU ARE</h2>` +
    `<p class="text">Allow your rough location and notifications: your prayer times then follow you to any city, and ` +
    `each prayer gets a reminder.${v.place.source === "default" ? ` Until then, the times shown are ${esc(v.place.label)}'s.` : ""}` +
    `</p><div class="row-buttons"><button type="button" class="pill solid" ` +
    `data-action="setup"${busy(v)}>Set up</button><button type="button" class="pill" data-action="skip-setup"${busy(v)}>` +
    `Not now</button></div></section>`;
}

/** Once setup is past and still no place is known: the times are Makkah's, and no reminder rings until one is set. */
export function placeCard(v: ViewModel): string {
  if (!v.settings.setupDone || v.place.source !== "default") return "";
  return `<section class="card"><h2 class="label">SET YOUR PLACE</h2><p class="text">These times are for ` +
    `${esc(v.place.label)} until the app knows where you are, and no reminder is scheduled until then. Use your rough ` +
    `location, or type your coordinates in Settings.</p><div class="row-buttons"><button type="button" class="pill solid" ` +
    `data-action="locate"${busy(v)}>Use where I am</button><button type="button" class="pill" data-go="settings">` +
    `Settings</button></div></section>`;
}

/** When the times are for a place in another time zone than the phone's, say so and offer to follow the phone. */
function travelCard(v: ViewModel): string {
  if (v.place.source !== "pinned" || !v.deviceTz || v.deviceTz === v.place.tz) return "";
  return `<section class="card"><h2 class="label">YOU MAY HAVE TRAVELLED</h2><p class="text">These times are for ` +
    `${esc(v.place.label)}, on its clock. Your ${deviceWord()} is on ${esc(v.deviceTz.replaceAll("_", " "))} time.</p>` +
    `<div class="row-buttons"><button type="button" class="pill solid" data-action="locate"${busy(v)}>Use where I am` +
    `</button></div></section>`;
}

export { prayerName };

/** The adhkar are kept by prayer day, the same day the prayers on screen belong to. */
function adhkarModel(v: ViewModel) {
  return { log: v.adhkar, open: v.adhkarOpen, date: v.today.date, now: v.now, tz: v.place.tz };
}

export function homeView(v: ViewModel): string {
  const next = nextPrayer(v.today, v.tomorrow, v.now);
  const nextDate = next.at === v.tomorrow[next.name] ? v.tomorrow.date : v.today.date;
  const done = Object.keys(v.log.days[v.today.date]?.prayers ?? {}).length;
  const part = greetingFor(v.now, "");
  const name = v.settings.name ? `,<br>${esc(v.settings.name)}` : "";
  // Between an adhan and its iqama, the iqama is what is coming; otherwise the next prayer.
  const until = iqamaCountdown(v.today, v.now) || untilPhrase(v.now, next.at);
  return `<main class="screen"><header class="hello"><p class="eyebrow">${esc(longDate(v))}</p>` +
    `<h1 class="display">${esc(part)}${name}</h1></header>${noticeLine(v)}${setupCard(v)}${placeCard(v)}${travelCard(v)}` +
    modePrompts(v.modes) +
    `<button type="button" class="card link next" data-go="faith"><span class="col"><span class="label">NEXT PRAYER</span>` +
    `<span class="numeral">${esc(prayerName(next.name, nextDate))} <span class="soft">${time(v, next.at)}</span></span></span>` +
    `<span class="col end">${prayerDots(v)}<span class="small">${done} of 5 today${until ? ` · ${until}` : ""}</span>` +
    `</span></button>${homeAdhkarCard(adhkarModel(v))}${homeWeekCard(v.week)}${homeAgendaCard(v.agenda)}${homeQuranCard(v)}${readingCard(v)}` +
    homeLearnCard(v.learn, v.date) + homeBodyCard(v.body) +
    `<nav class="quiet-row" aria-label="More of your OS">${homeLinks(v.worker).map(([go, title]) =>
      `<button type="button" class="quiet" data-go="${go}">${title}</button>`).join("")}</nav></main>` +
    chrome();
}

const HOME_LINKS: readonly (readonly [string, string])[] = [["modes", "Modes"], ["review", "Review"], ["books", "Books"], ["learn", "Learn"], ["agenda", "Agenda"],
  ["body", "Body"], ["money", "Money"], ["work", "Work"], ["inbox", "Inbox"]];
/** Work and Inbox are read from the user's own server (docs/backend.md): without one they are not offered. */
const SERVER_SCREENS = new Set(["work", "inbox"]);

export const homeLinks = (worker: string): readonly (readonly [string, string])[] =>
  (worker ? HOME_LINKS : HOME_LINKS.filter(([go]) => !SERVER_SCREENS.has(go)));

/** Where the user stopped reading (the mushaf's bookmark, on every device), one tap from reading on. */
export function homeQuranCard(v: Pick<ViewModel, "quran" | "date" | "bookmark" | "murajaah">): string {
  const s = quranSummary(v.quran, v.date);
  const page = Math.min(PAGES, Math.max(1, v.bookmark));
  const started = page > 1 || s.page > 0;
  return `<button type="button" class="card link" data-go="mushaf"><span class="split"><span class="label">QURAN</span>` +
    `<span class="small">Today ${s.today} page${s.today === 1 ? "" : "s"}</span></span><span class="numeral">Page ${page} ` +
    `<span class="soft">of ${PAGES}</span></span><span class="muted">${started ? `${esc(pageLabel(page))} · read on` : "Open the mushaf"}` +
    `</span>${v.murajaah ? `<span class="small">${esc(revisionLine(v.murajaah, lastRevised(v.quran), v.date))}</span>` : ""}` +
    `</button>`;
}

/** The book in hand, or a way to the library when there is none. */
function readingCard(v: ViewModel): string {
  const book = inHand(v.library)[0];
  if (!book) {
    return `<button type="button" class="card link" data-go="books"><span class="col"><span class="label">READING</span>` +
      `<span class="muted">${v.library.books.length ? "Pick the book in your hand" : "Add your first book"}</span></span></button>`;
  }
  const page = currentPage(book);
  const pct = book.pages ? Math.min(100, Math.round((page / book.pages) * 100)) : 0;
  return `<button type="button" class="card link reading" data-go="book:${esc(book.id)}">${cover(book, "s")}<span class="col grow">` +
    `<span class="split"><span class="label">READING</span><span class="small">${book.pages ? `p. ${page} of ${book.pages}` : `p. ${page}`}</span></span>` +
    `<span class="title">${esc(book.title)}</span><span class="bar thin"><span class="fill" data-w="${pct}"></span></span></span></button>`;
}

export function chrome(): string {
  return `<button type="button" class="round corner" data-go="settings" aria-label="Settings">${icon("gear")}</button>` +
    `<button type="button" class="orb" data-go="talk" aria-label="Talk to your OS">${orb()}</button>`;
}

function prayerNote(v: ViewModel, p: PrayerName, isNext: boolean): string {
  const mark = v.log.days[v.today.date]?.prayers[p];
  if (mark) return mark.status === "late" ? "Late" : mark.mosque ? "On time · mosque" : "On time";
  if (isNext) return "Next";
  return currentPrayer(v.today, v.now) === p ? "Now" : "";
}

function prayerRows(v: ViewModel): string {
  const next = nextPrayer(v.today, v.tomorrow, v.now);
  return PRAYERS.map((p) => {
    const mark = v.log.days[v.today.date]?.prayers[p];
    const state = mark ? (mark.status === "late" ? "late" : "on") : "";
    const note = prayerNote(v, p, next.name === p && next.at === v.today[p]);
    const label = esc(prayerName(p, v.today.date));
    const iqama = iqamaAt(v.today, p);
    const iqamaText = iqama ? `Iqama ${time(v, iqama)}` : "";
    return `<button type="button" class="prayer" data-mark="${p}" aria-label="${label}, ${time(v, v.today[p])}` +
      `${iqamaText ? `, ${iqamaText}` : ""}, ${note ? esc(note) : "not marked"}. Tap to change."><span class="mark ` +
      `${state}">${mark ? icon("check", 14) : ""}</span><span class="name">${label}</span><span class="time">` +
      `${time(v, v.today[p])}${iqamaText ? `<span class="iqama">${iqamaText}</span>` : ""}</span>` +
      `<span class="note">${esc(note)}</span></button>`;
  }).join("");
}

function sunnahRow(v: ViewModel): string {
  const sunnah = v.log.days[v.today.date]?.sunnah;
  return `<div class="sunnah"><span class="small">Sunnah</span>${SUNNAH.map((s) =>
    `<button type="button" class="pill ${sunnah?.[s] ? "solid" : ""}" data-sunnah="${s}" aria-pressed="${sunnah?.[s] ? "true" : "false"}">` +
    `${SUNNAH_LABEL[s]}</button>`).join("")}</div>`;
}

function dayLabel(date: string, dots: string[]): string {
  const name = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const on = dots.filter((d) => d === "ontime").length;
  const late = dots.filter((d) => d === "late").length;
  return `${name}: ${on} on time${late ? `, ${late} late` : ""}`;
}

function weekCard(v: ViewModel): string {
  const week = weekDots(v.log, v.today.date);
  const letter = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }).slice(0, 2);
  return `<section class="card"><div class="split"><h2 class="label">LAST 7 DAYS</h2><span class="small">To make up</span>` +
    `</div><div class="split"><div class="week">${week.map((w) => `<div class="day" role="img" aria-label="` +
      `${esc(dayLabel(w.date, w.dots))}">${w.dots.map((d) =>
      `<span class="dot ${d === "ontime" ? "on" : d === "late" ? "late" : ""}"></span>`).join("")}` +
      `<span class="mono">${esc(letter(w.date))}</span></div>`).join("")}</div><div class="owed">` +
    `<button type="button" class="round small-round" data-owed="-1" aria-label="One fewer to make up">${icon("minus", 16)}</button>` +
    `<span class="count">${v.log.owed}</span>` +
    `<button type="button" class="round small-round" data-owed="1" aria-label="One more to make up">${icon("plus", 16)}</button>` +
    `</div></div></section>`;
}

function adjustedNote(v: ViewModel): string {
  if (v.today.adjusted === "clamped") return " · the sun does not rise or set here today: times from 60° latitude";
  return v.today.adjusted === "rule" ? " · high-latitude rule" : "";
}

export function faithView(v: ViewModel): string {
  const where = `Calculated for ${v.place.label === "Where you are" ? "where you are" : v.place.label} · ` +
    `${METHOD_LABEL[v.method]} method${adjustedNote(v)}`;
  return `<main class="screen">${header("Faith", hijriDate(v.now))}${noticeLine(v)}${modePrompts(v.modes)}` +
    `<button type="button" class="card link" data-go="modes"><span class="label">MODES</span><span class="muted">Jumu'ah, Fajr, ` +
    `Maghrib, Istikhara and your study</span></button>` +
    `<section class="card"><div class="split"><h2 class="label">TODAY</h2><span class="small">Calculated times</span></div>` +
    `${prayerRows(v)}${sunnahRow(v)}</section>${faithAdhkarCard(adhkarModel(v))}${weekCard(v)}${quranCard(v)}` +
    `${v.records ? `<p class="small" aria-live="polite">${esc(v.records)}</p>` : ""}` +
    `<p class="foot">${esc(where)}</p></main>${chrome()}`;
}

function quranCard(v: ViewModel): string {
  const s = quranSummary(v.quran, v.date);
  return `<button type="button" class="card link" data-go="quran"><span class="split"><span class="label">QURAN</span>` +
    `<span class="small">Page ${s.page} of ${PAGES}</span></span><span class="bar"><span class="fill" ` +
    `data-w="${Math.round((s.page / PAGES) * 100)}"></span></span><span class="muted">${esc(s.label)}</span>` +
    `<span class="small">Today ${s.today} page${s.today === 1 ? "" : "s"}${s.streak > 1 ? ` · ${s.streak} days in a row` : ""}` +
    ` · revision and tafsir</span></button>`;
}

/**
 * Coordinates typed by hand, for a phone whose location is off or a place other than where it is. A text keyboard, as
 * a decimal keypad has no minus on some phones; both values pasted from a map app into the first box work too.
 */
export function placeForm(v: ViewModel): string {
  const input = (id: string, name: string, label: string, hint: string, max: number, required: boolean) =>
    `<label class="small" for="${id}">${label}</label><input id="${id}" class="field" name="${name}" ` +
    `autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${hint}" maxlength="${max}"` +
    `${required ? " required" : ""}>`;
  const error = v.placeError ? `<p class="small" role="alert">${esc(v.placeError)}</p>` : "";
  return `<form class="row-form" data-form="place-pin"><p class="small">Or pin a place by its coordinates, in degrees. ` +
    `Its times show on this phone's clock.</p>` +
    input("place-lat", "lat", "Latitude", "51.51, or both from a map", 40, true) +
    input("place-lng", "lng", "Longitude", "-0.13", 24, false) +
    input("place-label", "label", "Name", "London", PLACE_LABEL_MAX, false) +
    `${error}<div class="row-buttons"><button type="submit" class="pill"${busy(v)}>Pin this place</button></div></form>`;
}

/** Each prayer's iqama, in minutes after its adhan, as the user's mosque keeps it. */
export function iqamaFields(v: ViewModel): string {
  const fields = PRAYERS.map((p) => `<label class="iqama-field"><span>${PRAYER_LABEL[p]}</span>` +
    `<input class="field" type="number" inputmode="numeric" min="${IQAMA_MIN}" max="${IQAMA_MAX}" step="1" ` +
    `data-iqama="${p}" value="${v.settings.iqama[p]}" aria-label="${PRAYER_LABEL[p]} iqama, minutes after the adhan">` +
    `</label>`).join("");
  return `<fieldset class="iqama-row"><legend class="small">Iqama, minutes after the adhan (Jumu'ah has none here)` +
    `</legend>${fields}</fieldset>`;
}

/** iOS plays at most 30 seconds of a reminder's sound; Android the whole adhan. */
const adhanNote = (): string => (platform() === "ios" ? ". iOS plays its first 30 seconds." : ".");

function voiceCard(v: ViewModel): string {
  const typed = v.settings.voiceUrl;
  const note = typed ? "" : BUILT_IN_WORKER ? `Built in: ${BUILT_IN_WORKER}` : "Not set yet.";
  const talk = v.talkSignedIn
    ? `<p class="small">Talk is signed in on this ${deviceWord()}.</p><div class="row-buttons"><button type="button" ` +
      `class="pill" data-action="talk-signout"${busy(v)}>Sign out of Talk</button></div>`
    : `<p class="small">Talk asks for your passphrase the first time.</p>`;
  // What leaves the phone when a talk starts, said where the user signs in (talk/life.ts, talk/weather.ts).
  const shared = `<p class="small">When a talk starts, the assistant is told your day from this app: prayers, adhkar, ` +
    `calendar, the books in your hands and the intentions you set for the week. The weather comes from Open-Meteo, ` +
    `which is sent your rough location ` +
    `(about 1 km). Signed in, your books also stay the same on every device through your Worker.</p>`;
  return `<section class="card"><label class="label" for="voice-url">VOICE</label><p class="small">Your Worker's address, ` +
    `where Talk connects.</p><input id="voice-url" class="field" data-field="voice-url" type="url" inputmode="url" ` +
    `autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="200" placeholder="${esc(BUILT_IN_WORKER ||
      "https://your-worker.workers.dev")}" value="${esc(typed)}">${note ? `<p class="small">${esc(note)}</p>` : ""}` +
    `${talk}${shared}</section>`;
}

/** Recitation's one-time download, and how to take it off the device again. Only the installed app downloads it. */
function reciteCard(): string {
  if (platform() === "web") return "";
  return `<section class="card"><h2 class="label">RECITATION</h2><p class="small">Recite to find and Memorise use a ` +
    `speech model and the Quran text from the Tanzil Project, about ${Math.round(DOWNLOAD_BYTES / 1_000_000)} MB, ` +
    `downloaded the first time you recite. What you recite is heard on this ${deviceWord()} and never sent anywhere.</p>` +
    `<div class="row-buttons"><button type="button" class="pill" data-action="recite-remove">Remove the download</button>` +
    `</div></section>`;
}

function statusLine(v: ViewModel): string {
  if (v.notify === "unavailable") return "Reminders work in the installed app.";
  if (v.place.source === "default") return "Reminders start once your place is set.";
  if (v.notify !== "granted") return "Notifications are off for this app.";
  if (v.pending === null) return "Reminders could not be scheduled just now; they are tried again when you open the app.";
  const exact = v.exact === "granted" ? "on time to the minute" : "may arrive a few minutes late";
  return `${v.pending} reminders scheduled, ${exact}.`;
}

/** How the last page turn ran, on this device: the one measure of whether it is smooth that can be read here. */
const turnLine = (turn?: TurnStats): string => (turn && turn.frames > 0
  ? ` Last turn: ${turn.frames} frames, ${turn.slow} late, longest ${turn.longestMs} ms` : "");

export function settingsView(v: ViewModel, turn?: TurnStats): string {
  const methods = [`<option value="auto"${v.settings.method === "auto" ? " selected" : ""}>Automatic (now ` +
    `${esc(METHOD_LABEL[v.method])})</option>`].concat(METHODS.map((m) =>
    `<option value="${m}"${v.settings.method === m ? " selected" : ""}>${esc(METHOD_LABEL[m])}</option>`)).join("");
  // One column on a wide screen: in two, WebKit on iPadOS painted the calendars card as a blank pane of glass.
  return `<main class="screen single">${header("Settings", `Everything is kept on this ${deviceWord()}`)}${noticeLine(v)}` +
    `<section class="card"><label class="label" for="name">YOUR NAME</label><input id="name" class="field" ` +
    `data-field="name" maxlength="40" autocomplete="given-name" value="${esc(v.settings.name)}"></section>` +
    `<section class="card"><h2 class="label">PRAYER TIMES</h2><label class="small" for="method">Method</label>` +
    `<select id="method" class="field" data-field="method">${methods}</select><p class="small">Place: ` +
    `${esc(v.place.label)}${v.place.source === "default" ? " (not set yet)" : ""}</p><div class="row-buttons">` +
    `<button type="button" class="pill" data-action="locate"${busy(v)}>Use where I am</button></div>${placeForm(v)}` +
    `${iqamaFields(v)}</section><section class="card"><h2 class="label">REMINDERS</h2>${PRAYERS.map((p) => `<label class="toggle"><span>` +
    `${PRAYER_LABEL[p]}</span><input type="checkbox" data-remind="${p}"${v.settings.reminders[p] ? " checked" : ""}>` +
    `</label>`).join("")}<label class="toggle"><span class="col"><span>Friday</span><span class="small">Al-Kahf in the ` +
    `morning, and the last hour before Maghrib</span></span><input type="checkbox" data-field="friday-reminders"` +
    `${v.settings.fridayReminders ? " checked" : ""}></label><label class="toggle"><span class="col"><span>Adhkar</span>` +
    `<span class="small">Al-Sabah after Fajr, Al-Masa after Asr, until each is said</span></span><input type="checkbox" ` +
    `data-field="adhkar-reminders"${v.settings.adhkarReminders ? " checked" : ""}></label>` +
    reviewReminderFields(v.settings.reviewReminder) +
    (ADHAN_BUNDLED ? `<label class="toggle"><span class="col"><span>Adhan</span>` +
      `<span class="small">The adhan at each reminder, Fajr its own${adhanNote()}</span></span>` +
      `<input type="checkbox" data-field="adhan"${v.settings.adhan ? " checked" : ""}></label>` : "") +
    `<label class="toggle"><span class="col"><span>Book pages</span><span class="small">With the bars hidden, the mushaf's pages curl like a book's. Off, they always slide.${turnLine(turn)}</span></span>` +
    `<input type="checkbox" data-field="book-pages"${v.settings.bookPages ? " checked" : ""}></label>` +
    `<label class="toggle"><span class="col"><span>Live on the lock screen</span><span class="small">The next prayer, a dhikr you are counting, or a timer you started, on the lock screen and the Dynamic Island</span></span>` +
    `<input type="checkbox" data-field="live"${v.settings.live ? " checked" : ""}></label>` +
    `<label class="toggle"><span class="col"><span>Money in talks</span><span class="small">The assistant can hear your month's money ` +
    `and log what you tell it. Amounts pass through the voice service</span></span><input type="checkbox" data-field="assistant-money"` +
    `${v.settings.assistantMoney ? " checked" : ""}></label>` +
    `<label class="toggle"><span class="col"><span>Health in talks</span><span class="small">The assistant can hear your steps and last night's sleep. ` +
    `They pass through the voice service</span></span><input type="checkbox" data-field="assistant-health"` +
    `${v.settings.assistantHealth ? " checked" : ""}></label>` +
    `<p class="small">${esc(statusLine(v))}</p><div class="row-buttons">` +
    (v.notify === "prompt" || v.notify === "denied" ? `<button type="button" class="pill" data-action="notify"${busy(v)}>Allow notifications</button>` : "") +
    (v.exact === "denied" ? `<button type="button" class="pill" data-action="exact"${busy(v)}>Exact times</button>` : "") +
    `</div></section>${calendarsCard(v.agenda)}${voiceCard(v)}${reciteCard()}<p class="foot">Awqat 0.19, open source (MIT) · ` +
    `prayer times by adhan-js (MIT) · Hijri date: Umm al-Qura · adhkar: Hisn al-Muslim, from Seen Arabic's set (MIT) · ` +
    `du'a after the salam: Hisn al-Muslim, from hisnmuslim.com · the adhkar's translation and transliteration: Hisn ` +
    `al-Muslim, fetched from hisnmuslim.com, and for the Quran items Saheeh International and the transliteration, ` +
    `fetched from Quran.com · Quran fonts provided by Quran Foundation, King Fahd ` +
    `Complex script · Quran metadata: Tanzil Project (tanzil.net) · type: Instrument Serif (OFL) · weather: Open-Meteo ` +
    `(CC BY 4.0) · covers and book data: Open Library · packet nutrition: Open Food Facts (ODbL) ·calendars read with ical.js (MPL-2.0) · health data through ` +
    `Capgo's Capacitor Health (MPL-2.0) · voice through ElevenLabs' client (MIT) and LiveKit (Apache-2.0) · recitation ` +
    `heard by Tarteel AI's whisper-tiny-ar-quran (Apache-2.0) through transformers.js (Apache-2.0) and ONNX Runtime ` +
    `(MIT), placed on the Quran text of the Tanzil Project (<button type="button" class="link-inline" ` +
    `data-action="tanzil-open">tanzil.net</button>)</p>` +
    `</main>`;
}
