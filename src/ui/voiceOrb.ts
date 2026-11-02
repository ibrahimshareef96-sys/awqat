/**
 * The speaking orb on the Talk sheet (ui/orbMotion.ts holds the maths, talk/signal.ts what it hears): a canvas redrawn
 * while a talk is on or anything is still moving, and left still once everything has settled, so nothing animates
 * with nothing to show. It appears when the sheet opens, from small and faint to full, and a sheet opened again starts
 * from hidden. A tab in the background gets no frames; the first frame back takes one short step.
 *
 * Cost per frame is kept low for a phone: the springs step every frame, but the canvas is painted at most every
 * 15 ms (a 120 Hz screen paints at 60), at no more than twice the CSS size, with a handful of colours made once per
 * sheet. The meters are read only while a talk is on.
 *
 * Under prefers-reduced-motion nothing moves: the orb is drawn once, still (dimmer while connecting), and the state
 * shows in words beside it.
 */
import type { TalkPhase } from "../app/state.ts";
import { QUIET, type VoiceSignal } from "../talk/signal.ts";
import {
  HIDDEN, SHOWN, advance, dotsFor, glowOf, hears, mixRgb, rgbOf, settled, spherePoints, targetsFor, type OrbState,
  type Rgb,
} from "./orbMotion.ts";

const POINTS = spherePoints(380);
const INK: Rgb = [245, 241, 232];
const GOLD: Rgb = [226, 204, 154];
/** The longest step one frame takes, so a stall (or a tab coming back) never throws the springs. */
const MAX_STEP_S = 0.05;
const PAINT_EVERY_MS = 15;
const MAX_PIXEL_RATIO = 2;
/** Steps between the user's colour and the assistant's: enough to look smooth, few enough to make once. */
const WARM_STEPS = 8;

interface Palette {
  readonly canvas: HTMLCanvasElement;
  readonly ink: Rgb;
  readonly gold: Rgb;
  /** "rgb(...)" from the user's colour (0) to the assistant's (WARM_STEPS). */
  readonly steps: readonly string[];
}

let orb: OrbState = HIDDEN;
let phase: TalkPhase = "idle";
let signalOf: () => VoiceSignal = () => QUIET;
let frame = 0;
let last = 0;
let lastPaint = 0;
let palette: Palette | null = null;
/** The canvas the orb last followed: a different one is a sheet opened again, which starts from hidden. */
let current: HTMLCanvasElement | null = null;
let motionQuery: { from: typeof matchMedia; list: MediaQueryList } | null = null;
let listeningForResize = false;
/** Frames in a row that failed to paint. */
let failures = 0;
const MAX_FAILURES = 5;

/** prefers-reduced-motion, asked once (a new query list per frame would be waste) and answered live. */
function reducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  if (motionQuery?.from !== matchMedia) {
    motionQuery = { from: matchMedia, list: matchMedia("(prefers-reduced-motion: reduce)") };
  }
  return motionQuery.list.matches;
}

/** The Talk sheet's canvas, or null when the sheet is closed. A new canvas (the sheet opened again) starts from hidden. */
function canvasNow(): HTMLCanvasElement | null {
  const canvas = document.querySelector<HTMLCanvasElement>("canvas.voice-orb");
  if (canvas !== current) {
    current = canvas;
    palette = null;
    orb = HIDDEN;
    lastPaint = 0;
  }
  return canvas;
}

/** The user's colour (the canvas's text colour) and the assistant's (the accent), and the steps between, once per canvas. */
function paletteOf(canvas: HTMLCanvasElement): Palette {
  if (palette?.canvas !== canvas) {
    const style = getComputedStyle(canvas);
    const ink = rgbOf(style.color, INK);
    const gold = rgbOf(style.getPropertyValue("--accent"), GOLD);
    const steps = Array.from({ length: WARM_STEPS + 1 }, (_, i) => {
      const [r, g, b] = mixRgb(ink, gold, i / WARM_STEPS);
      return `rgb(${r}, ${g}, ${b})`;
    });
    palette = { canvas, ink, gold, steps };
  }
  return palette;
}

const rgba = (rgb: Rgb, alpha: number): string => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;

function paintGlow(ctx: CanvasRenderingContext2D, size: number, state: OrbState, colours: Palette): void {
  const glow = glowOf(state);
  for (const [rgb, strength] of [[colours.ink, glow.him], [colours.gold, glow.agent]] as const) {
    if (!(strength >= 0.005)) continue;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, rgba(rgb, Math.min(1, strength)));
    gradient.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
}

/**
 * Draws one frame, sharp on the screen's pixels. A canvas with no 2D context (a test page) or no size on the page yet
 * (not laid out, or hidden) is left alone: its pixel size comes only from its laid-out size, never from itself.
 */
function paint(canvas: HTMLCanvasElement, state: OrbState): void {
  const size = canvas.clientWidth;
  if (!(size > 0)) return;
  const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (ctx === null) return;
  const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, globalThis.devicePixelRatio || 1));
  const pixels = Math.round(size * ratio);
  if (canvas.width !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, size, size);
  const colours = paletteOf(canvas);
  paintGlow(ctx, size, state, colours);
  let lastWarm = -1;
  for (const dot of dotsFor(POINTS, state, size)) {
    if (dot.alpha <= 0) continue;
    const warm = Math.round(dot.warm * WARM_STEPS);
    if (warm !== lastWarm) {
      lastWarm = warm;
      ctx.fillStyle = colours.steps[warm] ?? colours.steps[0] ?? "rgb(245, 241, 232)";
    }
    ctx.globalAlpha = dot.alpha;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * A frame that fails (a canvas whose context was lost, say) is reported once and tried again on the next frame; after
 * a few in a row the orb gives up until the talk next changes. The orb is decoration: it never throws into the talk.
 */
function failed(error: unknown): void {
  failures += 1;
  if (failures === 1) globalThis.reportError?.(error);
}

/** Paints, and keeps any failure inside the orb. Returns whether it painted without one. */
function safePaint(canvas: HTMLCanvasElement, state: OrbState): boolean {
  try {
    paint(canvas, state);
    return true;
  } catch (error) {
    failed(error);
    return false;
  }
}

function stop(): void {
  if (frame !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
  frame = 0;
  last = 0;
}

/** The still frame for reduced motion: shown, at rest, dimmed as the phase says. */
const stillFor = (now: TalkPhase): OrbState => ({ ...SHOWN, dim: { value: targetsFor(now, QUIET).dim, velocity: 0 } });

/** One frame: the springs step, the canvas is painted when it is due. Returns whether to ask for another. */
function frameAt(canvas: HTMLCanvasElement, time: number): boolean {
  const dt = last === 0 ? 1 / 60 : Math.min(MAX_STEP_S, Math.max(0, (time - last) / 1000));
  last = time;
  const targets = targetsFor(phase, hears(phase) ? signalOf() : QUIET);
  orb = advance(orb, targets, dt);
  const more = targets.life > 0 || !settled(orb, targets);
  // The last frame is always painted, so the orb rests exactly where it settled.
  if (!more || lastPaint === 0 || time - lastPaint >= PAINT_EVERY_MS) {
    lastPaint = time;
    if (!safePaint(canvas, orb)) return failures < MAX_FAILURES;
    failures = 0;
  }
  return more;
}

function step(time: number): void {
  frame = 0;
  const canvas = canvasNow();
  // The sheet closed: the next one opens from hidden.
  if (canvas === null) {
    last = 0;
    return;
  }
  // The user asked for less motion mid-talk: the orb stops where it is meant to rest.
  if (reducedMotion()) {
    orb = stillFor(phase);
    safePaint(canvas, orb);
    last = 0;
    return;
  }
  if (frameAt(canvas, time)) frame = requestAnimationFrame(step);
  else last = 0;
}

/** A still orb is redrawn when the screen changes size (a foldable opening, a tablet turning), so it stays sharp. */
function repaintStill(): void {
  if (frame !== 0) return;
  const canvas = canvasNow();
  if (canvas !== null) safePaint(canvas, orb);
}

/**
 * Points the orb at the talk's phase and what it hears, and runs it while there is anything to show. Called when the
 * sheet opens, whenever the talk changes and after the sheet closes; safe to call as often as wanted.
 */
export function followTalk(next: TalkPhase, signal: () => VoiceSignal): void {
  phase = next;
  signalOf = signal;
  if (!listeningForResize && typeof addEventListener === "function") {
    listeningForResize = true;
    addEventListener("resize", repaintStill);
  }
  failures = 0;
  const canvas = canvasNow();
  if (canvas === null) {
    stop();
    return;
  }
  if (reducedMotion()) {
    stop();
    orb = stillFor(next);
    safePaint(canvas, orb);
    return;
  }
  if (frame === 0) frame = requestAnimationFrame(step);
}

/** Where the orb is now (for tests). */
export function orbNow(): OrbState {
  return orb;
}

/** Whether a frame is waiting to be drawn (for tests). */
export function orbRunning(): boolean {
  return frame !== 0;
}
