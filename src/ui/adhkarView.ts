/**
 * The adhkar: a card on Home while a set is open and not yet said, a card on Faith for both sets, and each set's list.
 * A dhikr counts with a tap on its words; Done says it in full at once (and again clears it). The Quran items show no
 * Quran: they name the surah and ayahs and open the mushaf at that page.
 */
import {
  SESSIONS, SESSION_NAME, adhkarFor, adhkarStreak, adhkarWeek, countOf, isComplete, progress, type AdhkarLog,
  type AdhkarWindow, type Dhikr, type Session,
} from "../faith/adhkar.ts";
import { SURA_AYAS, SURA_NAMES } from "../quran/data.ts";
import { pageOfAyah } from "../quran/pages.ts";
import { formatTime } from "../prayer/times.ts";
import { counterHtml, paintCounter, type CounterInput } from "./counter.ts";
import { esc, icon } from "./html.ts";

/** The sets' names as the book gives them. */
const SESSION_AR: Readonly<Record<Session, string>> = { morning: "أذكار الصباح", evening: "أذكار المساء" };

export interface AdhkarCardModel {
  log: AdhkarLog;
  /** The set open now, if any. */
  open: AdhkarWindow | null;
  /** The prayer day (Fajr to Fajr) the counts are kept for. */
  date: string;
  now: Date;
  tz: string;
}

export interface AdhkarScreenModel extends AdhkarCardModel {
  session: Session;
  /** Maghrib of the prayer day, when the end of Al-Baqarah opens; null when the day is not known. */
  maghrib: Date | null;
}

/** When the set is open: its best time while that lasts, then how long it stays open; or when it opens. */
function whenLine(session: Session, open: AdhkarWindow | null, now: Date, tz: string): string {
  const best = session === "morning" ? "sunrise" : "Maghrib";
  const until = session === "morning" ? "Dhuhr" : "midnight";
  if (open?.session === session) {
    const end = `open until ${until}, ${formatTime(open.end, tz)}`;
    return now.getTime() < open.bestBefore.getTime() ? `Best before ${best}, ${formatTime(open.bestBefore, tz)} · ${end}`
      : end.charAt(0).toUpperCase() + end.slice(1);
  }
  return session === "morning" ? "From Fajr until Dhuhr, best before sunrise"
    : "From Asr until the middle of the night, best before Maghrib";
}

/**
 * On Home, only while a set is open and what can be said now is not all said. The evening's end of Al-Baqarah opens at
 * Maghrib (its best-before time), so the card can go before Maghrib and come back then for it.
 */
export function homeAdhkarCard(m: AdhkarCardModel): string {
  const open = m.open;
  const withNight = open?.session === "morning" || (open !== null && m.now.getTime() >= open.bestBefore.getTime());
  if (!open || isComplete(m.log, open.date, open.session, withNight)) return "";
  const { done, total } = progress(m.log, open.date, open.session);
  return `<button type="button" class="card link adhkar" data-go="adhkar:${open.session}"><span class="split">` +
    `<span class="label">${esc(SESSION_NAME[open.session].toUpperCase())}</span><span class="small">${done} of ${total}` +
    `</span></span><span class="adhkar-title" lang="ar" dir="rtl">${SESSION_AR[open.session]}</span>` +
    `<span class="bar thin"><span class="fill" data-w="${Math.round((done / total) * 100)}"></span></span>` +
    `<span class="small">${esc(whenLine(open.session, open, m.now, m.tz))}</span></button>`;
}

/** On Faith: both sets, today's count of each, which is open now, each set's streak, and the last seven days. */
export function faithAdhkarCard(m: AdhkarCardModel): string {
  const rows = SESSIONS.map((session) => {
    const { done, total } = progress(m.log, m.date, session);
    const complete = done === total;
    const now = m.open?.session === session && !complete ? " · now" : "";
    const streak = adhkarStreak(m.log, m.date, session);
    const run = streak > 1 ? ` · ${streak} days in a row` : "";
    return `<button type="button" class="adhkar-row" data-go="adhkar:${session}"><span class="tick ${complete ? "on" : ""}" ` +
      `aria-hidden="true">${complete ? icon("check", 14) : ""}</span><span class="col grow"><span class="check-name">` +
      `${esc(SESSION_NAME[session])}</span><span class="small">${done} of ${total}${now}${run}</span></span>` +
      `<span class="adhkar-row-ar" lang="ar" dir="rtl">${SESSION_AR[session]}</span></button>`;
  }).join("");
  return `<section class="card" aria-label="Adhkar"><h2 class="label">ADHKAR</h2><div class="plain checks">${rows}</div>` +
    `${weekStrip(m)}</section>`;
}

/** Seven days, a dot for each set said in full (the same dots as the prayers' week). */
function weekStrip(m: AdhkarCardModel): string {
  const letter = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short",
    timeZone: "UTC" }).slice(0, 2);
  const said = (on: boolean) => `<span class="dot ${on ? "on" : ""}"></span>`;
  const label = (w: { date: string; morning: boolean; evening: boolean }) => {
    const name = new Date(`${w.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    return `${name}: morning ${w.morning ? "said" : "not said"}, evening ${w.evening ? "said" : "not said"}`;
  };
  return `<div class="week">${adhkarWeek(m.log, m.date).map((w) => `<div class="day" role="img" ` +
    `aria-label="${esc(label(w))}">${said(w.morning)}${said(w.evening)}<span class="mono">${esc(letter(w.date))}</span>` +
    `</div>`).join("")}</div><p class="small">Last 7 days: morning, then evening.</p>`;
}

/**
 * "Al-Baqara 255", "Al-Baqara 285 to 286", "At-Tawba 129, its closing words, ...", or, when the item is a whole surah
 * (already its name), "The whole surah".
 */
function quranPlace(q: NonNullable<Dhikr["quran"]>): string {
  if (q.from === 1 && q.to === SURA_AYAS[q.sura - 1]) return "The whole surah";
  const name = SURA_NAMES[q.sura - 1] ?? "";
  const place = q.from === q.to ? `${name} ${q.from}` : `${name} ${q.from} to ${q.to}`;
  return q.words ? `${place}, ${q.words}` : place;
}

/**
 * What to read, unmistakably: this is Quran, by name and place, with a plain button to it. What is said before it (the
 * refuge in Allah) is small and labelled as that, so it is never taken for the thing itself.
 */
function quranBlock(item: Dhikr, page: number | null): string {
  const q = item.quran as NonNullable<Dhikr["quran"]>;
  const name = esc(item.name);
  const before = item.text ? `<p class="dhikr-before"><span class="small">Begin with</span><span class="dhikr-before-ar" lang="ar" dir="rtl">` +
    `${esc(item.text)}</span></p>` : "";
  // The spoken name starts with the words on the button, so Voice Control's "tap Read" finds it.
  const read = page ? `<button type="button" class="pill solid wide dhikr-read" data-go="mushaf:${page}" aria-label="Read ${name}, page ${page}">` +
    `Read it on p. ${page}</button>` : "";
  return `<span class="label">QURAN</span><h3 class="dhikr-quran-name">${name}</h3><p class="dhikr-quran">${esc(quranPlace(q))}. ` +
    `Read it from the mushaf, then count it here.</p>${before}${read}`;
}

function dhikrItem(item: Dhikr, m: AdhkarScreenModel): string {
  const n = countOf(m.log, m.date, m.session, item.id);
  const done = n >= item.count;
  const locked = item.night === true && m.maghrib !== null && m.now.getTime() < m.maghrib.getTime();
  const page = item.quran ? pageOfAyah(item.quran.sura, item.quran.from) : null;
  const name = esc(item.name);
  const words = item.text ? `<span class="dhikr-ar" lang="ar" dir="rtl">${esc(item.text)}</span>` : "";
  // aria-disabled, not disabled: a finished dhikr keeps its focus after the tap that finished it (keep.ts finds it
  // again), and the action already ignores taps past the count or before Maghrib.
  const top = item.quran ? quranBlock(item, page)
    : `<button type="button" class="dhikr-tap" data-action="dhikr" data-value="${item.id}"${done || locked ? ' aria-disabled="true"' : ""}>` +
      `<span class="dhikr-name">${name}</span>${words}<span class="sr-only">Tap to count</span></button>`;
  const wait = locked ? `<p class="small dhikr-wait">After Maghrib, ${esc(formatTime(m.maghrib as Date, m.tz))}</p>` : "";
  return `<li class="card dhikr${done ? " done" : ""}" data-dhikr="${item.id}">${top}` +
    `<span class="dhikr-times" lang="ar" dir="rtl">${esc(item.times)}</span>` +
    `<div class="dhikr-foot">${counterRow({ action: "dhikr", value: String(item.id), n, of: item.count, name: item.name, locked },
      "dhikr-back", "dhikr-done")}</div>${wait}` +
    `<details class="dhikr-source" id="dhikr-source-${item.id}"><summary>Source<span ` +
    `class="sr-only"> of ${name}</span></summary><p class="source" lang="ar" dir="rtl">${esc(item.source)}</p></details></li>`;
}

/**
 * The ring in the middle: back one for a slip on one side, once there is a count; said all at once on the other, for
 * what was said from memory or on beads, once a count has more than one. Said in full, that one starts it again, so a
 * thumb that slipped onto it on a 100 is not 100 taps from putting it right.
 */
export function counterRow(c: CounterInput, backAction: string, allAction: string): string {
  const name = esc(c.name);
  const back = `<button type="button" class="ghost-link counter-side" data-action="${backAction}" data-value="${esc(c.value)}" ` +
    `aria-label="Back one: ${name}"${c.n > 0 ? "" : " hidden"}>Back one</button>`;
  const label = allLabel(c.n, c.of);
  const all = `<button type="button" class="ghost-link counter-side" data-action="${allAction}" data-value="${esc(c.value)}" ` +
    `aria-label="${label}: ${name}"${c.of > 1 && !c.locked ? "" : " hidden"}>${label}</button>`;
  return `<span class="counter-slot">${back}</span>${counterHtml(c)}<span class="counter-slot">${all}</span>`;
}

const allLabel = (n: number, of: number): string => (n >= of ? "Reset" : "All said");

/** Shows or hides a button beside the ring; the focus goes to the ring rather than being lost with it. */
function showSide(side: HTMLElement | undefined, show: boolean, counter: HTMLElement): void {
  if (!side) return;
  if (!show && side.ownerDocument.activeElement === side) counter.focus({ preventScroll: true });
  side.toggleAttribute("hidden", !show);
}

/**
 * A count changed, on the card itself, with no redraw: the ring runs on from where it is on screen. False when the card
 * is not on screen, for the caller to redraw instead.
 */
export function paintDhikrCard(root: ParentNode, selector: string, n: number, of: number, moved: boolean): boolean {
  const card = root.querySelector<HTMLElement>(selector);
  const counter = card?.querySelector<HTMLElement>("[data-counter]");
  if (!card || !counter) return false;
  paintCounter(counter, n, moved);
  card.classList.toggle("done", n >= of);
  card.querySelector(".dhikr-tap")?.toggleAttribute("aria-disabled", n >= of);
  if (n >= of) card.querySelector(".dhikr-tap")?.setAttribute("aria-disabled", "true");
  const sides = card.querySelectorAll<HTMLElement>(".counter-side");
  showSide(sides[0], n > 0, counter);
  showSide(sides[1], of > 1, counter);
  if (sides[1]) {
    const label = allLabel(n, of);
    sides[1].textContent = label;
    sides[1].setAttribute("aria-label", `${label}: ${counter.dataset.name ?? ""}`);
  }
  // A count only lands once its time is open.
  card.querySelector(".dhikr-wait")?.remove();
  return true;
}

/** The set's own count at the top of its list, in place. */
export function paintAdhkarTotal(root: ParentNode, done: number, total: number): void {
  const number = root.querySelector("[data-adhkar-done]");
  if (number) number.textContent = String(done);
  const fill = root.querySelector<HTMLElement>("[data-adhkar-fill]");
  if (fill) fill.style.width = `${Math.round((done / total) * 100)}%`;
}

export function adhkarView(m: AdhkarScreenModel, head: string, notice: string, chrome: string): string {
  const { done, total } = progress(m.log, m.date, m.session);
  return `<main class="screen single">${head}${notice}<section class="card"><div class="split"><span class="numeral">` +
    `<span data-adhkar-done>${done}</span> <span class="soft">of ${total}</span></span><span class="adhkar-title" lang="ar" dir="rtl">` +
    `${SESSION_AR[m.session]}</span></div><span class="bar"><span class="fill" data-adhkar-fill data-w="${Math.round((done / total) * 100)}">` +
    `</span></span><p class="small">${esc(whenLine(m.session, m.open, m.now, m.tz))}</p></section>` +
    `<ol class="plain dhikr-list">${adhkarFor(m.session).map((item) => dhikrItem(item, m)).join("")}</ol>` +
    `<p class="foot">Hisn al-Muslim, from Seen Arabic's morning and evening set (MIT)</p></main>${chrome}`;
}
