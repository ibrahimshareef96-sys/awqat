/**
 * Holding a word in the mushaf picks its ayah, to mark a mistake or write a note; a tap anywhere on the page shows or
 * hides the bars (tapOnPage, used by main.ts). A hold is a finger kept still on a word for HOLD_MS, or the system's own
 * long press if that comes first (Android sends it as contextmenu, at the delay set on the phone). The ayah lights up
 * as it is held; its sheet opens when the finger lifts, so nothing changes under a finger still down (a system long
 * press landing on the new sheet started a text selection on Android and swallowed the next tap on iOS). Sliding the
 * finger away before lifting lets it go, and so does a swipe, a second finger or lifting sooner. A right click with a
 * mouse opens the ayah at once. The click that follows a long press, wherever it lands, is swallowed, so it never
 * closes the sheet or shows or hides the bars.
 */

/** A finger kept still this long on a word picks its ayah (about the system's own long press). */
export const HOLD_MS = 450;
/** A finger that moves further than this is turning the page (or letting the ayah go), not holding a word. */
export const SLOP_PX = 10;
/** The held ayah starts to light after this long: a swipe has moved off by then, so turning pages never flickers. */
export const HINT_MS = 150;
/** How long after a long press is lifted its own click may still arrive. */
export const CLICK_AFTER_HOLD_MS = 1000;

export interface HoldCallbacks {
  /** A word was held and let go on: open its ayah. */
  hold: (word: HTMLElement) => void;
  /** Whether a hold may pick an ayah now: the mushaf open with no sheet up. */
  ready: () => boolean;
}

interface Press {
  id: number;
  x: number;
  y: number;
  at: number;
  word: HTMLElement | null;
  /** Held long enough: lifting the finger now opens the ayah. */
  armed: boolean;
  /** The furthest the finger has moved from where it came down. */
  moved: number;
  /** The system's own long press came during this press (only then may its pointercancel open the ayah). */
  menu: boolean;
  timer?: ReturnType<typeof setTimeout>;
  hint?: ReturnType<typeof setTimeout>;
}

let press: Press | null = null;
/** The ayah lit ("2:255"): lit as it is held, and kept lit while its sheet is up, across redraws (relight). */
let litAyah: string | null = null;
/** The hold has taken: the ayah shows it a shade stronger, so it is plain when lifting will open it. */
let litArmed = false;
let swallowUntil = 0;
let callbacks: HoldCallbacks = { hold: () => undefined, ready: () => false };

const inPager = (target: EventTarget | null): target is Element =>
  target instanceof Element && target.closest("[data-pager]") !== null;

const wordAt = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>("[data-pager] [data-word]") : null;

const ayahOf = (word: HTMLElement): string | null => {
  const ayah = (word.dataset.word ?? "").split(":").slice(0, 2).join(":");
  return /^\d+:\d+$/.test(ayah) ? ayah : null;
};

/**
 * What a click on the mushaf's page does: "bars" (a tap, on its words too, shows or hides the bars), or "default"
 * (anything else: a button on the page such as Try again, a word reached by keyboard or a screen reader, which opens
 * its ayah as a button does, and every click off the page).
 */
export function tapOnPage(target: Element, detail: number, readerOpen: boolean): "bars" | "default" {
  if (!readerOpen || !inPager(target)) return "default";
  const el = target.closest<HTMLElement>("[data-go],[data-mark],[data-sunnah],[data-owed],[data-action],[data-word]");
  if (!el) return "bars";
  return el.dataset.word !== undefined && detail > 0 ? "bars" : "default";
}

/** The lit ayah's words on the pages drawn (an ayah can run on to the next page). */
function paintLight(doc: Document): void {
  doc.querySelectorAll<HTMLElement>("[data-pager] .w.held").forEach((w) => w.classList.remove("held", "armed"));
  if (!litAyah) return;
  doc.querySelectorAll<HTMLElement>(`[data-pager] [data-word^="${litAyah}:"]`).forEach((w) => {
    w.classList.add("held");
    w.classList.toggle("armed", litArmed);
  });
}

function light(word: HTMLElement, armed = false): void {
  litAyah = ayahOf(word);
  litArmed = armed;
  paintLight(word.ownerDocument);
}

function unlight(doc: Document): void {
  litAyah = null;
  litArmed = false;
  paintLight(doc);
}

/** The press ends with no ayah opened: its timers stop and its light eases back from where it had reached. */
function drop(doc: Document): void {
  if (!end()) return;
  unlight(doc);
}

/** Held long enough: the ayah is lit a shade stronger, and lifting the finger opens it. */
function arm(word: HTMLElement): void {
  if (!press || press.word !== word) return;
  clearTimeout(press.hint);
  press.armed = true;
  light(word, true);
}

/** The ayah opens: it stays lit while its sheet is up (until release()), and the click after it is swallowed. */
function open(word: HTMLElement, now = Date.now()): void {
  swallowUntil = now + CLICK_AFTER_HOLD_MS;
  if (!word.isConnected || !callbacks.ready()) return unlight(word.ownerDocument);
  light(word, true);
  callbacks.hold(word);
}

function onPointerDown(event: PointerEvent): void {
  const doc = (event.currentTarget as Document | null) ?? document;
  // A second finger is a pinch or a mistake, never a hold.
  if (!event.isPrimary) return drop(doc);
  drop(doc);
  swallowUntil = 0;
  if (event.button !== 0 || !inPager(event.target) || !callbacks.ready()) return;
  const word = wordAt(event.target);
  press = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now(), word, armed: false, moved: 0,
    menu: false };
  if (!word) return;
  press.hint = setTimeout(() => { if (press?.word === word) light(word); }, HINT_MS);
  press.timer = setTimeout(() => arm(word), HOLD_MS);
}

function onPointerMove(event: PointerEvent): void {
  if (!press || event.pointerId !== press.id) return;
  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  press.moved = Math.max(press.moved, moved);
  if (moved > SLOP_PX) drop((event.currentTarget as Document | null) ?? document);
}

/** The press is over: its timers stop. What it was is returned, for the caller to finish. */
function end(): Press | null {
  const was = press;
  if (was) {
    clearTimeout(was.timer);
    clearTimeout(was.hint);
  }
  press = null;
  return was;
}

function onPointerUp(event: PointerEvent): void {
  if (!press || event.pointerId !== press.id) return;
  const now = Date.now();
  const { word, armed, at } = end() as Press;
  if (armed && word) return open(word, now);
  // A long press away from the words picks nothing, and its click does not show or hide the bars either.
  if (now - at >= HOLD_MS) swallowUntil = now + CLICK_AFTER_HOLD_MS;
  unlight((event.currentTarget as Document | null) ?? document);
}

/**
 * The browser took the finger for a swipe, the pages started moving, or a system gesture (the back swipe, the
 * notification shade) took the touch: no hold. Only a finger held still that the system takes after its own long press
 * (Android may cancel the touch after its contextmenu) has done its part: the ayah opens.
 */
function onCancel(event: Event): void {
  if (!press) return;
  const doc = (event.currentTarget as Document | null) ?? document;
  if (event.type === "scroll") {
    if (inPager(event.target)) drop(doc);
    return;
  }
  if ((event as PointerEvent).pointerId !== press.id) return;
  if (press.armed && press.menu && press.word && press.moved <= SLOP_PX / 2) {
    return open((end() as Press).word as HTMLElement);
  }
  drop(doc);
}

/**
 * The system's long press (Android, at the phone's own delay) or a right click. On a word being held it arms the
 * hold (the ayah opens on lifting); a right click with no finger down opens the ayah at once. On the page, no menu
 * either way. While a hold is armed, no menu anywhere.
 */
function onContextMenu(event: MouseEvent): void {
  if (press) press.menu = true;
  if (press?.armed) return event.preventDefault();
  if (!inPager(event.target)) return;
  event.preventDefault();
  const word = wordAt(event.target);
  if (!word || !callbacks.ready()) return;
  if (press?.word === word) return arm(word);
  if (!press) open(word);
}

/** No selection starts under a hold (Safari can start one without a contextmenu). */
function onSelectStart(event: Event): void {
  if (press?.armed) event.preventDefault();
}

/** The click a long press leaves behind. A click from the keyboard or a screen reader (no taps counted) is never it. */
function onClick(event: MouseEvent): void {
  if (Date.now() >= swallowUntil || event.detail === 0) return;
  swallowUntil = 0;
  event.preventDefault();
  event.stopPropagation();
}

/** The ayah's sheet closed: its words go back to the page. */
export function release(doc: Document = document): void {
  unlight(doc);
}

/** The reader was drawn anew while the ayah's sheet is up: its words light again. */
export function relight(doc: Document = document): void {
  if (litAyah) paintLight(doc);
}

/** The app was left or came back: no finger is holding anything. */
export function resetHold(doc: Document = document): void {
  if (press) drop(doc);
  swallowUntil = 0;
}

export function listenForHold(handlers: HoldCallbacks, target: Document = document): void {
  callbacks = handlers;
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove, { passive: true });
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onCancel);
  target.addEventListener("scroll", onCancel, { capture: true, passive: true });
  target.addEventListener("contextmenu", onContextMenu);
  target.addEventListener("selectstart", onSelectStart);
  // Before the app's own click handler (on the document, bubbling), so a swallowed click never reaches it.
  target.addEventListener("click", onClick, { capture: true });
}
