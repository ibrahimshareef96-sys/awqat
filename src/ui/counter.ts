/**
 * The tap counter on a dhikr: a big ring with the count inside, for the thumb to come back to without looking. A tap
 * changes it in place, never by redrawing the screen, so the ring's CSS transition always starts from where the ring is
 * on screen, however fast the taps come, and a finger counting fast never loses its place. The pulse starts from the
 * number's size at that instant, for the same reason. With reduced motion the numbers simply change.
 */
import { esc, icon } from "./html.ts";

export interface CounterInput {
  /** What a tap does: its data-action and data-value. */
  action: string;
  value: string;
  n: number;
  of: number;
  name: string;
  /** Not open yet (the end of Al-Baqarah before Maghrib): the ring shows, and a tap does nothing. */
  locked?: boolean;
}

const ofText = (of: number): string => (of > 1 ? `of ${of}` : "once");
const ariaOf = (name: string, n: number, of: number, locked: boolean): string =>
  `${name}: ${n} of ${of}${n >= of ? ", done" : locked ? ", after Maghrib" : ". Tap to count"}`;

/** Past the start of the ring by more than its round cap, so an empty ring shows no dot. */
const EMPTY = 102;

/** How far round the ring is, as its dash offset: EMPTY at none and 0 when full. */
export function ringOffset(n: number, of: number): number {
  if (of <= 0 || n <= 0) return EMPTY;
  return Math.round((100 - Math.min(100, (n / of) * 100)) * 100) / 100;
}

function countInside(n: number, of: number): string {
  return n >= of ? `<span class="counter-num counter-check">${icon("check", 30)}</span>`
    : `<span class="counter-num">${n}</span><span class="counter-of">${ofText(of)}</span>`;
}

export function counterHtml(c: CounterInput): string {
  const done = c.n >= c.of;
  const off = done || c.locked === true;
  return `<button type="button" class="counter${done ? " done" : ""}" data-counter data-action="${esc(c.action)}" data-value="${esc(c.value)}" ` +
    `data-name="${esc(c.name)}" data-of="${c.of}" aria-label="${esc(ariaOf(c.name, c.n, c.of, c.locked === true))}"${off ? ' aria-disabled="true"' : ""}>` +
    `<span class="counter-ripple" aria-hidden="true"></span><svg class="counter-ring" viewBox="0 0 100 100" aria-hidden="true">` +
    `<circle class="counter-track" cx="50" cy="50" r="46" pathLength="100"></circle><circle class="counter-arc" cx="50" cy="50" r="46" ` +
    `pathLength="100" stroke-dashoffset="${ringOffset(c.n, c.of)}"></circle></svg><span class="counter-inside" aria-hidden="true">` +
    `${countInside(c.n, c.of)}</span></button>`;
}

const calm = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A settle with a little life in it, the same curve as the press's release in app.css. */
const SPRING = "linear(0, 0.33 8%, 0.66 16%, 0.92 26%, 1.06 36%, 1.09 44%, 1.06 56%, 1.01 72%, 1)";

/** The count pulses from the size it is now, so a tap during the last pulse carries on from where it had got to. */
function pulse(el: HTMLElement, big: number): void {
  const from = getComputedStyle(el).transform;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ transform: from === "none" ? "scale(1)" : from }, { transform: `scale(${big})`, offset: 0.25 }, { transform: "scale(1)" }],
    { duration: 340, easing: SPRING });
}

function ripple(button: HTMLElement, done: boolean): void {
  const ring = button.querySelector<HTMLElement>(".counter-ripple");
  ring?.animate([{ opacity: done ? 0.5 : 0.28, transform: "scale(1)" }, { opacity: 0, transform: `scale(${done ? 1.5 : 1.28})` }],
    { duration: done ? 720 : 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
}

let paintedInPlace = false;

/**
 * Whether a counter changed in place since this was last asked. The screen on show then differs from the HTML last drawn,
 * so a redraw must not take "the same HTML" to mean nothing changed (a sync or a new day putting a count back).
 */
export function takePaintedInPlace(): boolean {
  const was = paintedInPlace;
  paintedInPlace = false;
  return was;
}

/** Sets the counter to `n`, in place; `moved` is false when nothing was tapped (a sync, a redraw of the same count). */
export function paintCounter(button: HTMLElement, n: number, moved = true): void {
  paintedInPlace = true;
  const of = Number(button.dataset.of);
  const done = n >= of;
  button.querySelector(".counter-arc")?.setAttribute("stroke-dashoffset", String(ringOffset(n, of)));
  button.classList.toggle("done", done);
  if (done) button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
  button.setAttribute("aria-label", ariaOf(button.dataset.name ?? "", n, of, false));
  const inside = button.querySelector<HTMLElement>(".counter-inside");
  const number = inside?.querySelector<HTMLElement>(".counter-num");
  if (inside && number && !number.classList.contains("counter-check") && !done) number.textContent = String(n);
  else if (inside) inside.innerHTML = countInside(n, of);
  if (!moved || calm() || !inside) return;
  const shown = inside.querySelector<HTMLElement>(".counter-num");
  if (shown) pulse(shown, done ? 1.26 : 1.14);
  ripple(button, done);
}
