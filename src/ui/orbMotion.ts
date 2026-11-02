/**
 * The speaking orb's motion, kept free of the page so it can be tested (ui/voiceOrb.ts draws it): a sphere of dots in
 * the app's dotted style. The user's voice ripples the dots across its surface; the assistant's voice blooms them outward
 * and warms them to the gold accent. Each band of a voice drives its own latitude (the body at the equator, the edge
 * at the poles), so the orb moves with the sound itself, not with a canned loop.
 *
 * Every driver is a spring whose position and speed carry over from frame to frame and from one target to the next:
 * when a voice starts, stops or hands over, the orb moves on from where it is, never jumps. The spin eases between
 * states the same way, and once the talk ends every driver settles to rest so the loop can stop.
 */
import type { TalkPhase } from "../app/state.ts";
import type { Bands, VoiceSignal } from "../talk/signal.ts";

export interface Spring {
  readonly value: number;
  readonly velocity: number;
}

export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
}

/** The voices: quick to follow a syllable, damped so they never ring. */
export const VOICE_SPRING: SpringConfig = { stiffness: 220, damping: 26 };
/** The orb's own pace (spin, dimming, coming alive, appearing): slower and softer. */
export const SLOW_SPRING: SpringConfig = { stiffness: 40, damping: 13 };

const rest = (value: number): Spring => ({ value, velocity: 0 });

/**
 * One step of a spring towards its target (semi-implicit Euler). Returns a new spring; the old one is untouched. A
 * target that is not a number counts as 0, and a spring knocked off the numbers starts again at rest, so one bad
 * reading can never stick.
 */
export function springStep(spring: Spring, target: number, dt: number, config: SpringConfig): Spring {
  const goal = Number.isFinite(target) ? target : 0;
  const force = config.stiffness * (goal - spring.value) - config.damping * spring.velocity;
  const velocity = spring.velocity + force * dt;
  const value = spring.value + velocity * dt;
  return Number.isFinite(value) && Number.isFinite(velocity) ? { value, velocity } : rest(goal);
}

export interface OrbTargets {
  readonly him: number;
  readonly agent: number;
  readonly himBands: Bands;
  readonly agentBands: Bands;
  /** Turns a second. */
  readonly spin: number;
  /** How bright the dots are: lower while connecting or ending. */
  readonly dim: number;
  /** 1 while a talk is on (breathing, spinning), 0 at rest. */
  readonly life: number;
}

const LIVE: ReadonlySet<TalkPhase> = new Set(["listening", "speaking", "working"]);

/** Whether the voices move the orb in this phase (a talk is on); otherwise there is nothing to listen to. */
export const hears = (phase: TalkPhase): boolean => LIVE.has(phase);
const SPIN: Readonly<Record<TalkPhase, number>> = {
  idle: 0, signin: 0, signing: 0, connecting: 0.12, listening: 0.05, speaking: 0.07, working: 0.22, ending: 0,
};

/** Where each driver heads in this phase with these voices; only a live talk lets the voices through. */
export function targetsFor(phase: TalkPhase, signal: VoiceSignal): OrbTargets {
  const live = LIVE.has(phase);
  const quiet: Bands = [0, 0, 0];
  return {
    him: live ? signal.him : 0,
    agent: live ? signal.agent : 0,
    himBands: live ? signal.himBands : quiet,
    agentBands: live ? signal.agentBands : quiet,
    spin: SPIN[phase],
    dim: phase === "connecting" || phase === "ending" || phase === "signing" ? 0.55 : 1,
    life: live || phase === "connecting" ? 1 : 0,
  };
}

export interface OrbState {
  readonly him: Spring;
  readonly agent: Spring;
  readonly himBands: readonly [Spring, Spring, Spring];
  readonly agentBands: readonly [Spring, Spring, Spring];
  readonly spin: Spring;
  readonly dim: Spring;
  readonly life: Spring;
  /** 0 to 1 as the orb appears when the sheet opens. */
  readonly appear: Spring;
  /** Where the sphere has turned to, in turns. */
  readonly turn: number;
  /** Seconds of motion so far, for the ripples and the breath. */
  readonly time: number;
}

const restBands = (): readonly [Spring, Spring, Spring] => [rest(0), rest(0), rest(0)];

/** The orb before it appears: everything at rest, not yet shown. */
export const HIDDEN: OrbState = {
  him: rest(0), agent: rest(0), himBands: restBands(), agentBands: restBands(), spin: rest(0), dim: rest(1),
  life: rest(0), appear: rest(0), turn: 0, time: 0,
};

/** The orb fully shown and at rest: the still frame drawn under reduced motion. */
export const SHOWN: OrbState = { ...HIDDEN, appear: rest(1) };

const stepBands = (springs: OrbState["himBands"], targets: Bands, dt: number): OrbState["himBands"] =>
  [0, 1, 2].map((i) => springStep(springs[i] as Spring, targets[i] ?? 0, dt, VOICE_SPRING)) as unknown as OrbState["himBands"];

/** The orb one frame on. Returns a new state. */
export function advance(state: OrbState, targets: OrbTargets, dt: number): OrbState {
  const spin = springStep(state.spin, targets.spin, dt, SLOW_SPRING);
  return {
    him: springStep(state.him, targets.him, dt, VOICE_SPRING),
    agent: springStep(state.agent, targets.agent, dt, VOICE_SPRING),
    himBands: stepBands(state.himBands, targets.himBands, dt),
    agentBands: stepBands(state.agentBands, targets.agentBands, dt),
    spin,
    dim: springStep(state.dim, targets.dim, dt, SLOW_SPRING),
    life: springStep(state.life, targets.life, dt, SLOW_SPRING),
    appear: springStep(state.appear, 1, dt, SLOW_SPRING),
    turn: (state.turn + spin.value * dt) % 1,
    time: state.time + dt,
  };
}

const EPSILON = 0.002;
const near = (spring: Spring, target: number): boolean =>
  Math.abs(spring.value - target) < EPSILON && Math.abs(spring.velocity) < EPSILON;

/** Whether every driver has reached its target and stopped: nothing left to draw until something changes. */
export function settled(state: OrbState, targets: OrbTargets): boolean {
  const bands = (springs: OrbState["himBands"], to: Bands): boolean => springs.every((s, i) => near(s, to[i] ?? 0));
  return near(state.him, targets.him) && near(state.agent, targets.agent) && bands(state.himBands, targets.himBands) &&
    bands(state.agentBands, targets.agentBands) && near(state.spin, targets.spin) && near(state.dim, targets.dim) &&
    near(state.life, targets.life) && near(state.appear, 1);
}

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lat: number;
  readonly lon: number;
}

/** Points spread evenly over a unit sphere (the Fibonacci lattice), so no two dots crowd. */
export function spherePoints(count: number): readonly Point[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(1 - y * y);
    const lon = golden * i;
    return { x: Math.cos(lon) * ring, y, z: Math.sin(lon) * ring, lat: Math.asin(y), lon };
  });
}

/** A voice's band energy at a latitude: the body at the equator, the vowels between, the edge at the poles. */
export function bandAt(lat: number, bands: readonly [Spring, Spring, Spring]): number {
  const along = Math.min(1, Math.abs(lat) / (Math.PI / 2)) * 2;
  const low = Math.floor(along);
  const share = along - low;
  const from = bands[Math.min(2, low)]?.value ?? 0;
  const to = bands[Math.min(2, low + 1)]?.value ?? 0;
  return Math.max(0, from + (to - from) * share);
}

export interface Dot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly alpha: number;
  /** 0 is the user's warm white, 1 the assistant's gold. */
  readonly warm: number;
  readonly depth: number;
}

const TILT = 0.38;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** One dot: turned and tilted, pushed along its own direction by the voices, lit by how near it faces. */
function dotOf(p: Point, state: OrbState, size: number, turn: { cos: number; sin: number }): Dot {
  const x1 = p.x * turn.cos + p.z * turn.sin;
  const z1 = -p.x * turn.sin + p.z * turn.cos;
  const y2 = p.y * Math.cos(TILT) - z1 * Math.sin(TILT);
  const z2 = p.y * Math.sin(TILT) + z1 * Math.cos(TILT);
  const appear = clamp01(state.appear.value);
  const t = state.time;
  const himEnergy = clamp01(state.him.value) * (0.35 + 0.65 * bandAt(p.lat, state.himBands));
  const agentEnergy = clamp01(state.agent.value) * (0.4 + 0.6 * bandAt(p.lat, state.agentBands));
  const breath = 0.018 * clamp01(state.life.value) * Math.sin(t * 1.7);
  const ripple = 0.15 * himEnergy * Math.sin(p.lon * 6 + p.lat * 3 + t * 7);
  const bloom = 0.17 * agentEnergy * (0.6 + 0.4 * Math.sin(p.lat * 5 - t * 5));
  const reach = size * 0.34 * (0.72 + 0.28 * appear) * (1 + breath + ripple + bloom);
  const depth = (z2 + 1) / 2;
  return {
    x: size / 2 + x1 * reach,
    y: size / 2 + y2 * reach,
    r: (size / 150) * (0.55 + 0.75 * depth) * (1 + 0.5 * Math.max(himEnergy, agentEnergy)),
    alpha: clamp01(appear * clamp01(state.dim.value) * (0.16 + 0.84 * depth)),
    warm: clamp01(agentEnergy * 2.2),
    depth,
  };
}

/** The dots of one frame for a square canvas `size` CSS pixels wide, back to front so the near ones are drawn last. */
export function dotsFor(points: readonly Point[], state: OrbState, size: number): readonly Dot[] {
  const angle = state.turn * Math.PI * 2;
  const turn = { cos: Math.cos(angle), sin: Math.sin(angle) };
  return points.map((p) => dotOf(p, state, size, turn)).sort((a, b) => a.depth - b.depth);
}

/** How strong the soft glow behind the orb is for each voice, 0 to 1: the assistant's is the stronger. */
export function glowOf(state: OrbState): { him: number; agent: number } {
  const appear = clamp01(state.appear.value);
  return { him: 0.22 * clamp01(state.him.value) * appear, agent: 0.5 * clamp01(state.agent.value) * appear };
}

export type Rgb = readonly [number, number, number];

/** A CSS colour as red, green, blue: "#rrggbb", "#rgb" or "rgb(r, g, b)"; anything else is the fallback. */
export function rgbOf(color: string, fallback: Rgb): Rgb {
  const text = color.trim();
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (long) return [parseInt(long[1] ?? "0", 16), parseInt(long[2] ?? "0", 16), parseInt(long[3] ?? "0", 16)];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) return [1, 2, 3].map((i) => parseInt(`${short[i]}${short[i]}`, 16)) as unknown as Rgb;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(text);
  if (rgb) return [1, 2, 3].map((i) => Math.min(255, Number(rgb[i]))) as unknown as Rgb;
  return fallback;
}

/** The colour `share` of the way from `from` to `to`, as whole numbers. */
export function mixRgb(from: Rgb, to: Rgb, share: number): Rgb {
  const t = clamp01(share);
  return [0, 1, 2].map((i) => {
    const a = from[i] ?? 0;
    return Math.round(a + ((to[i] ?? 0) - a) * t);
  }) as unknown as Rgb;
}
