/**
 * Fingers on the screen and the mushaf's pages in motion. While either is going on a redraw would swallow a tap or
 * jolt the pages, so background redraws wait. A swipe has settled when the pager reports scrollend or, on a WebView
 * without it, once the pager has been still for a moment with no finger on the screen.
 */
import { settledPage } from "../ui/reader.ts";

/** Still this long, with no finger down, is a swipe at rest. */
export const SETTLE_MS = 200;
/** A finger lifted on a part of the screen that was redrawn sends its touchend nowhere; past this, it is taken as up. */
export const TOUCH_STALE_MS = 8000;

export interface HandsCallbacks {
  /** The pager came to rest on this page (null: that pager was replaced meanwhile). */
  settled: (page: number | null) => void;
  /** Hands are free again: a redraw that waited can run now. */
  free: () => void;
}

let pressing = false;
let touching = false;
let touchedAt = 0;
let gliding = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let callbacks: HandsCallbacks = { settled: () => undefined, free: () => undefined };

const isPager = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && target.dataset.pager !== undefined;

const fingerDown = (now = Date.now()): boolean => touching && now - touchedAt < TOUCH_STALE_MS;

/** A finger is down or the pages are moving. */
export function handsMoving(now = Date.now()): boolean {
  return pressing || gliding || fingerDown(now);
}

function settle(pager: HTMLElement): void {
  clearTimeout(settleTimer);
  if (fingerDown()) {
    // Held still mid-swipe: it settles once the finger lifts and the pages stop.
    settleTimer = setTimeout(() => settle(pager), SETTLE_MS);
    return;
  }
  gliding = false;
  callbacks.settled(pager.isConnected ? settledPage(pager) : null);
}

function onScroll(event: Event): void {
  if (!isPager(event.target)) return;
  const pager = event.target;
  gliding = true;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => settle(pager), SETTLE_MS);
}

function onScrollEnd(event: Event): void {
  if (isPager(event.target)) settle(event.target);
}

/** Hands free again, after the tap's own click has run (a tap sends pointerup, then touchend, then click). */
const freeAfterClick = (): void => {
  setTimeout(() => { if (!handsMoving()) callbacks.free(); }, 0);
};

function onTouch(event: TouchEvent): void {
  touching = event.touches.length > 0;
  touchedAt = Date.now();
  if (!touching) freeAfterClick();
}

function onPointerDown(): void {
  pressing = true;
}

function onPointerUp(): void {
  pressing = false;
  freeAfterClick();
}

/** A book page is moving, or has stopped (ui/pageTurn.ts): it has no scrolling to report that. */
export function bookMoving(on: boolean): void {
  gliding = on;
  if (!on) freeAfterClick();
}

/** The pager was drawn anew: whatever glide was under way belonged to the old one. */
export function pagerReplaced(): void {
  gliding = false;
  clearTimeout(settleTimer);
}

/** The app was left or came back: no finger is down any more, and nothing is moving. */
export function resetHands(): void {
  pressing = false;
  touching = false;
  pagerReplaced();
}

export function listenForHands(handlers: HandsCallbacks, target: Document = document): void {
  callbacks = handlers;
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointerup", onPointerUp);
  // Scrolling takes over the touch with a pointercancel; the touch events below still see the finger.
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("touchstart", onTouch, { passive: true });
  target.addEventListener("touchmove", onTouch, { passive: true });
  target.addEventListener("touchend", onTouch, { passive: true });
  target.addEventListener("touchcancel", onTouch, { passive: true });
  target.addEventListener("scroll", onScroll, { capture: true, passive: true });
  target.addEventListener("scrollend", onScrollEnd, { capture: true });
}
