/**
 * The mushaf as a book: the page curls round a fold that follows the finger, right to left, as the mushaf is read. A finger
 * moving right turns on, one moving left turns back.
 *
 * One number says where it all is: `pos`, 0 at rest, towards 1 turning to the next page or spread, towards -1 turning back
 * (curlMath.ts). Each frame takes the finger's latest place, moves `pos` a little towards it and draws, so the page runs
 * at the screen's own rate however the touches arrive, and goes on from exactly where it is if caught or reversed. When the
 * finger lifts, its speed goes into a spring, and the swipe's momentum decides where the page lands.
 *
 * The pages themselves never move or repaint: they lie stacked, each already drawn by the browser, and only their order
 * changes. What moves is the leaf on the canvas over them (curlDriver.ts), so a frame does no layout and no painting. With
 * reduced motion, with the setting off, or where the chip's drawing is not to be had, the reader keeps its plain sliding pages.
 *
 * The curl is for reading, with the bars hidden. With the bars up the same finger and the same spring slide the pages side
 * by side instead: each page's own layer moves, which again draws nothing, and at rest they all go back to their own place.
 */
import { PAGES } from "../quran/data.ts";
import { curlAvailable, curlDriver, type CurlDriver } from "./curlDriver.ts";
import { sceneAt, topPages, type TurnScene } from "./curlMath.ts";

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/** How far the swipe's speed carries it, in seconds of flight: a flick lands the page from anywhere. */
const PROJECT_S = 0.22;

const SAME_WAY = 0.03;

/** Where a released page lands: on, back, or where it was, with the swipe's momentum counted. */
export function landingOf(pos: number, velocity: number, canNext: boolean, canBack: boolean): -1 | 0 | 1 {
  const projected = pos + velocity * PROJECT_S;
  // A page lifted one way that is flicked the other falls back where it was: it never carries on to the page behind it.
  if (projected > 0.5 && canNext && pos > -SAME_WAY) return 1;
  if (projected < -0.5 && canBack && pos < SAME_WAY) return -1;
  return 0;
}

export interface Motion { pos: number; velocity: number }

const STIFFNESS = 200;
const DAMPING = 2 * Math.sqrt(STIFFNESS);
/** The page counts as down this near: the last of it is too small to see, and waiting for it only delays the next page. */
const STILL = 0.0008;

/** One step of a critically damped spring: it starts with the finger's speed and never overshoots far enough to show. */
export function springStep(m: Motion, target: number, dt: number): Motion {
  const velocity = m.velocity + (-STIFFNESS * (m.pos - target) - DAMPING * m.velocity) * dt;
  return { pos: clamp(m.pos + velocity * dt, -1, 1), velocity };
}

export const atRest = (m: Motion, target: number): boolean => Math.abs(m.pos - target) < STILL && Math.abs(m.velocity) < 0.08;

/** A turn with nowhere to go gives a little under the finger and no more. */
export function resisted(pos: number, canNext: boolean, canBack: boolean): number {
  if ((pos > 0 && canNext) || (pos < 0 && canBack)) return clamp(pos, -1, 1);
  return clamp(pos * 0.12, -0.05, 0.05);
}

/** The page a landing opens. */
export const landedPage = (open: number, landing: -1 | 1, spread: boolean): number =>
  clamp(open + landing * (spread ? 2 : 1), 1, PAGES);

/** How quickly the page closes on the finger: enough to smooth the touches' steps, too little to feel behind it. */
const FOLLOW_S = 0.014;
/** The same as a hold's (app/hold.ts): a finger that stays within it is holding a word, past it is turning the page. */
const SLOP_PX = 10;
/** Longer than a few frames means the app was away: the spring takes a small step, never a leap. */
const STEP_MAX_S = 1 / 20;
/** The finger's speed is read over its last moment. Stopped for longer than this, it has no speed left to give. */
const SPEED_WINDOW_MS = 80;
const SPEED_MAX = 6;
/** A page this near its landing counts as landed for the next touch, so quick swipes through the pages each turn one. */
const ALL_BUT_DOWN = 0.12;
/** A frame longer than this was visibly late. */
const SLOW_FRAME_MS = 25;

export interface BookHandlers {
  /** The page came to rest on another page or spread. */
  landed: (page: number) => void;
  /** A page is moving or has stopped: redraws wait while it moves. */
  moving: (on: boolean) => void;
}

interface Drag {
  id: number; startX: number; startY: number; base: number; x: number; y: number; live: boolean;
  samples: { x: number; t: number }[];
}

/** How the last turn ran, so it can be read on the device itself. */
export interface TurnStats { frames: number; slow: number; longestMs: number }

let handlers: BookHandlers = { landed: () => undefined, moving: () => undefined };
let driver: CurlDriver = curlDriver;
let pager: HTMLElement | null = null;
let motion: Motion = { pos: 0, velocity: 0 };
let lean = 0;
let drag: Drag | null = null;
let frame = 0;
let flying: -1 | 0 | 1 | null = null;
let swallowClick = false;
let landing: (() => void) | null = null;
let stack = "";
let stats: TurnStats = { frames: 0, slow: 0, longestMs: 0 };
let drewAt = { pos: Number.NaN, lean: Number.NaN };
/** This turn slides rather than curls. Settled when it starts, so a bar changing mid-turn never swaps one for the other. */
let sliding = false;

export const lastTurn = (): TurnStats => stats;

/** Where a sliding page lies, in pager widths from its place: the open one with the finger, the rest strung out beside it. */
export function slideShare(page: number, open: number, pos: number, spread: boolean): number {
  return pos - (spread ? Math.floor((page - open) / 2) : page - open);
}

/** Only a reader showing its bars slides. A bar reached by keyboard shows even while hidden (mushaf.css). */
function barsUp(el: HTMLElement): boolean {
  const reader = el.closest(".reader");
  if (!reader) return false;
  return !reader.classList.contains("bars-hidden") || reader.querySelector(".reader-top :focus-visible, .reader-bottom :focus-visible") !== null;
}

const pagesIn = (el: HTMLElement): Map<number, HTMLElement> =>
  new Map((Array.from(el.children) as HTMLElement[]).filter((p) => p.dataset.page).map((p) => [Number(p.dataset.page), p]));

const openPageOf = (el: HTMLElement): number => Number(el.dataset.open);
const isSpread = (el: HTMLElement): boolean => el.classList.contains("spread");

/** The finger is kept to this pager; one the system has already taken cannot be, and then nothing needs keeping. */
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    // The pointer's end comes to the document's listeners whichever way it goes.
  }
}

/** The pages in the order they lie: only their order ever changes, so the browser has nothing to draw again. */
function stackPages(pages: ReadonlyMap<number, HTMLElement>, top: readonly number[], away: readonly number[]): void {
  const key = `${top.join()}/${away.join()}`;
  if (key === stack) return;
  stack = key;
  pages.forEach((page, number) => {
    page.style.zIndex = top.includes(number) ? "3" : away.includes(number) ? "0" : "1";
  });
}

function stackAtRest(el: HTMLElement, pages: ReadonlyMap<number, HTMLElement>): void {
  const open = openPageOf(el);
  stackPages(pages, isSpread(el) ? [open, open + 1] : [open], []);
}

function stackForTurn(el: HTMLElement, pages: ReadonlyMap<number, HTMLElement>, scene: TurnScene): void {
  stackPages(pages, topPages(scene, isSpread(el)), scene.back === null ? [scene.front] : [scene.front, scene.back]);
}

function slidePages(el: HTMLElement, pages: ReadonlyMap<number, HTMLElement>): void {
  const open = openPageOf(el);
  const spread = isSpread(el);
  const width = el.clientWidth;
  pages.forEach((page, number) => {
    page.style.transform = `translate3d(${slideShare(number, open, motion.pos, spread) * width}px,0,0)`;
  });
}

function paint(el: HTMLElement): void {
  if (motion.pos === drewAt.pos && lean === drewAt.lean) return;
  const pages = pagesIn(el);
  if (sliding) {
    slidePages(el, pages);
    drewAt = { pos: motion.pos, lean };
    return;
  }
  const scene = sceneAt(motion.pos, openPageOf(el), isSpread(el), (p) => pages.has(p));
  if (!scene) return;
  // Drawn first: the leaf is on the canvas over the page before the page itself goes under.
  if (driver.draw(el, pages, scene, lean)) stackForTurn(el, pages, scene);
  drewAt = { pos: motion.pos, lean };
}

function canTurn(el: HTMLElement): { next: boolean; back: boolean } {
  const pages = pagesIn(el);
  const open = openPageOf(el);
  const step = isSpread(el) ? 2 : 1;
  return { next: pages.has(open + step), back: pages.has(open - step) };
}

function stop(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  flying = null;
}

function rest(el: HTMLElement): void {
  stop();
  el.classList.remove("turning");
  if (sliding) pagesIn(el).forEach((page) => { page.style.transform = ""; });
  sliding = false;
  motion = { pos: 0, velocity: 0 };
  drewAt = { pos: Number.NaN, lean: Number.NaN };
  handlers.moving(false);
}

/** The redraw a landing leads to waits a frame or two, out of the way of the page settling. A touch before that brings it on. */
function flushLanding(): void {
  const run = landing;
  landing = null;
  run?.();
}

function finish(el: HTMLElement, landed: -1 | 0 | 1): void {
  rest(el);
  const before = openPageOf(el);
  if (landed !== 0) el.dataset.open = String(landedPage(before, landed, isSpread(el)));
  const pages = pagesIn(el);
  // The next page comes up under the leaf before the leaf goes: there is no frame with neither.
  stackAtRest(el, pages);
  driver.hide();
  if (landed === 0) {
    // The turn stopped any pictures still being made, and with no landing no redraw starts them again.
    preparePictures(el);
    return;
  }
  const page = openPageOf(el);
  landing = () => {
    handlers.landed(page);
    // The reader refused the turn and nothing redrew: the page goes back to the one still open.
    if (el.isConnected && el.dataset.laidOut !== String(page)) {
      el.dataset.open = String(before);
      stackAtRest(el, pagesIn(el));
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(flushLanding));
}

function fingerSpeed(el: HTMLElement, d: Drag, now: number): number {
  const samples = d.samples;
  const last = samples[samples.length - 1];
  if (!last || now - last.t > SPEED_WINDOW_MS) return 0;
  const first = samples.find((s) => last.t - s.t <= SPEED_WINDOW_MS) ?? last;
  const span = (last.t - first.t) / 1000;
  if (span <= 0) return 0;
  return clamp((last.x - first.x) / (el.clientWidth || 1) / span, -SPEED_MAX, SPEED_MAX);
}

function leanOf(el: HTMLElement, y: number): number {
  const box = el.getBoundingClientRect();
  return box.height > 0 ? clamp(((box.top + box.height / 2 - y) / box.height) * 2, -1, 1) : 0;
}

/** One frame: the page moves towards the finger, or on the spring towards its landing. */
function step(el: HTMLElement, now: number, last: number): void {
  const dt = Math.min(STEP_MAX_S, Math.max(0, (now - last) / 1000));
  if (drag?.live) {
    const can = canTurn(el);
    const target = resisted(drag.base + (drag.x - drag.startX) / (el.clientWidth || 1), can.next, can.back);
    const share = 1 - Math.exp(-dt / FOLLOW_S);
    motion = { ...motion, pos: motion.pos + (target - motion.pos) * share };
    lean += (leanOf(el, drag.y) - lean) * share;
  } else if (flying !== null) {
    // Two small steps a frame keep the spring steady at any refresh rate.
    motion = springStep(springStep(motion, flying, dt / 2), flying, dt / 2);
  }
}

function run(el: HTMLElement): void {
  if (frame !== 0) return;
  handlers.moving(true);
  el.classList.add("turning");
  sliding = barsUp(el);
  // The numbers in Settings are the curl's: a slide leaves them as they are.
  if (!sliding) {
    driver.attach(el);
    driver.begin();
    stats = { frames: 0, slow: 0, longestMs: 0 };
  }
  let last = performance.now();
  const tick = (now: number): void => {
    if (!el.isConnected) {
      drag = null;
      return finish(el, 0);
    }
    const ms = now - last;
    if (!sliding) stats = { frames: stats.frames + 1, slow: stats.slow + (ms > SLOW_FRAME_MS ? 1 : 0), longestMs: Math.max(stats.longestMs, Math.round(ms)) };
    step(el, now, last);
    last = now;
    if (flying !== null && !drag?.live && atRest(motion, flying)) return finish(el, flying);
    paint(el);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

function fly(el: HTMLElement, to: -1 | 0 | 1): void {
  flying = to;
  run(el);
}

/** Turns on or back by itself, from wherever it is (the arrow keys, a screen reader's buttons). */
export function turnBook(direction: -1 | 1): void {
  flushLanding();
  if (!pager?.isConnected || drag) return;
  const can = canTurn(pager);
  if (direction === 1 ? can.next : can.back) {
    lean = 0;
    fly(pager, direction);
  }
}

function onPointerDown(event: PointerEvent): void {
  const el = (event.target as Element | null)?.closest?.<HTMLElement>("[data-pager].book");
  if (!el || !event.isPrimary || event.button !== 0) return;
  pager = el;
  const inFlight = frame !== 0 && flying !== null;
  if (inFlight && Math.abs(motion.pos - (flying as number)) < ALL_BUT_DOWN) finish(el, flying as -1 | 0 | 1);
  // What the last landing left to do: the next pages are in place before this finger needs them.
  flushLanding();
  const caught = frame !== 0;
  const current = pager;
  // A page caught in the air stops under the finger, and goes on from there.
  if (caught) flying = null;
  drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, base: motion.pos, x: event.clientX, y: event.clientY, live: caught,
    samples: [{ x: event.clientX, t: event.timeStamp }] };
  if (caught) motion = { pos: motion.pos, velocity: 0 };
  // Held on the page now in place: the one this finger came down on may be gone.
  if (caught || current !== el) capture(current, event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id || !pager) return;
  if (!drag.live) {
    const moved = event.clientX - drag.startX;
    if (Math.abs(moved) < SLOP_PX || Math.abs(moved) < Math.abs(event.clientY - drag.startY)) return;
    drag.live = true;
    // The page starts from where it lies, not with a jump the size of the slop.
    drag.startX = event.clientX;
    lean = leanOf(pager, event.clientY);
    capture(pager, event.pointerId);
    run(pager);
  }
  drag.x = event.clientX;
  drag.y = event.clientY;
  drag.samples.push({ x: event.clientX, t: event.timeStamp });
  if (drag.samples.length > 16) drag.samples.shift();
}

function onPointerEnd(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  const was = drag;
  drag = null;
  if (!was.live || !pager) return;
  // A touch the system took sends no click.
  if (event.type === "pointercancel") return fly(pager, 0);
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 300);
  const can = canTurn(pager);
  const velocity = fingerSpeed(pager, was, event.timeStamp);
  motion = { ...motion, velocity };
  fly(pager, landingOf(motion.pos, velocity, can.next, can.back));
}

/** The app was left: a finger that was turning a page is gone, and may never send its lift. The page goes back. */
export function resetBook(): void {
  // The app's leaving told the rest of it that nothing is moving: a page still in flight is.
  if (frame !== 0) handlers.moving(true);
  if (!drag) return;
  const { live } = drag;
  drag = null;
  if (live && pager?.isConnected) fly(pager, 0);
}

/** The click a swipe ends in is not a tap: it never shows or hides the bars. One from the keyboard or a screen reader is no swipe's. */
function onClickCapture(event: MouseEvent): void {
  if (!swallowClick || event.detail === 0) return;
  swallowClick = false;
  event.stopPropagation();
  event.preventDefault();
}

/** A page is no longer in the reader. */
export const forgetBookPage = (page: HTMLElement): void => driver.forget(page);

/** How long the lines' zoom takes to settle when the bars come or go (mushaf.css). */
const ZOOM_GLIDE_MS = 350;
let pictureRound = 0;

/**
 * The pictures of the pages, made while nothing else is going on, so a turn finds them ready. While the lines are still
 * gliding to a new zoom a picture would be out of date at once, so it waits for that.
 */
function preparePictures(el: HTMLElement): void {
  pictureRound += 1;
  // Nothing curls with the bars up: the pictures wait until they go, and are then drawn at the page's full size.
  if (barsUp(el)) return;
  const round = pictureRound;
  const later = globalThis.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 60));
  const queue = Array.from(pagesIn(el).values());
  const next = (): void => {
    const page = queue.shift();
    if (!page || round !== pictureRound || !el.isConnected || el !== pager || frame !== 0) return;
    driver.prepare(page);
    later(next);
  };
  const gliding = queue.some((page) => page.querySelector<HTMLElement>(".page-lines")?.getAnimations?.().length);
  if (gliding) setTimeout(() => later(next), ZOOM_GLIDE_MS);
  else later(next);
}

/** The bars came or went: the pages' zoom changes, and their pictures with it. */
export function barsMoved(): void {
  if (pager?.isConnected && frame === 0) setTimeout(() => { if (pager?.isConnected) preparePictures(pager); }, ZOOM_GLIDE_MS);
}

/** A redraw of the reader: this pager is the one, at rest on its open page. A page in flight on this same open page flies on. */
export function layOutBook(el: HTMLElement, open: number): void {
  // A redraw of how things were, in the moment before a landing has told the reader: the page has already moved on. Any
  // page it drew anew has no place in the stack yet.
  if (landing !== null && pager === el && openPageOf(el) !== open) {
    stack = "";
    stackAtRest(el, pagesIn(el));
    return;
  }
  const same = pager === el && openPageOf(el) === open && (frame !== 0 || drag !== null);
  pager = el;
  el.dataset.laidOut = String(open);
  driver.attach(el);
  if (same) {
    // Sizing the canvas clears it, and a page drawn anew needs its place: the next frame draws and stacks it all again.
    stack = "";
    drewAt = { pos: Number.NaN, lean: Number.NaN };
    return;
  }
  el.dataset.open = String(open);
  if (landing === null) {
    stop();
    drag = null;
    if (el.classList.contains("turning") || motion.pos !== 0) {
      rest(el);
      driver.hide();
    }
  }
  stack = "";
  stackAtRest(el, pagesIn(el));
  preparePictures(el);
}

export function listenForBook(given: BookHandlers, target: Document = document, curl: CurlDriver = curlDriver): void {
  handlers = given;
  driver = curl;
  target.addEventListener("pointerdown", onPointerDown, true);
  target.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  target.addEventListener("pointerup", onPointerEnd, true);
  target.addEventListener("pointercancel", onPointerEnd, true);
  target.addEventListener("click", onClickCapture, true);
}

/** Whether the book can run here: never with reduced motion, nor without the chip's drawing; both keep the plain sliding pages. */
export function bookAllowed(wanted: boolean, canDraw: () => boolean = curlAvailable): boolean {
  if (!wanted) return false;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return canDraw();
}
