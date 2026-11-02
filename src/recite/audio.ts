/**
 * The microphone's sound made ready for the speech model: brought down to 16 kHz, one channel, and cut into stretches
 * of speech at the reciter's pauses. Pure: frames in, a new state and any finished stretch out.
 */

/** The speech model hears 16,000 samples a second. */
export const MODEL_RATE = 16_000;
/** One frame is a tenth of a second. */
export const FRAME = MODEL_RATE / 10;
/** Quieter than this is never speech, whatever the room. */
const MIN_LEVEL = 0.008;
/** Speech is this many times louder than the room's own hum. */
const OVER_FLOOR = 3;
/** The hum is the quietest frame of the last three seconds... */
const FLOOR_WINDOW = 30;
/** ...taken as a quiet room's for the first second, before there is a window to learn from... */
const QUIET_ROOM = 0.003;
const LEARNING = 10;
/** ...and never above this, so a voice that never pauses is not taken for the room. */
const FLOOR_MAX = 0.03;

/** The sound at 16 kHz: each new sample the average of the samples it stands for, which keeps out high hiss. */
export function resample(input: Float32Array, fromRate: number, toRate = MODEL_RATE): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0) || input.length === 0) return new Float32Array(0);
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = i * ratio;
    const end = Math.min(input.length, start + Math.max(1, ratio));
    let sum = 0;
    let n = 0;
    for (let j = Math.floor(start); j < end; j++) { sum += input[j]; n += 1; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** How loud a frame is (root mean square), 0 to 1. */
export function level(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export interface Listening {
  /** How loud the last few seconds' frames were, newest last: the room's hum is learnt from them. */
  recent: readonly number[];
  /** Frames of the stretch being heard, speech and the pauses inside it. */
  frames: readonly Float32Array[];
  /** Speech frames in it. */
  spoken: number;
  /** Frames since the last speech. */
  quiet: number;
  /** Frames since listening began, and whether any speech came at all. */
  total: number;
  heardAny: boolean;
}

export interface Cut {
  /** A pause this long (tenths of a second) after speech ends a stretch. */
  pause: number;
  /** A stretch is cut here even without a pause (tenths). */
  longest: number;
  /** Less speech than this (tenths) in a stretch is a cough or a click, and is dropped. */
  shortest: number;
}

/** Memorise: a few seconds at a time, so words fill in as the reciter goes. */
export const MEMORISE_CUT: Cut = { pause: 6, longest: 60, shortest: 4 };
/** Recite to find: one stretch, ended by a longer pause. */
export const FIND_CUT: Cut = { pause: 12, longest: 80, shortest: 6 };

export const startListening = (): Listening => ({ recent: [], frames: [], spoken: 0, quiet: 0, total: 0, heardAny: false });

/** The room's hum, from the frames heard so far. */
export function floorOf(recent: readonly number[], total: number): number {
  const quietest = recent.length ? Math.min(...recent) : QUIET_ROOM;
  return Math.min(FLOOR_MAX, total < LEARNING ? Math.min(QUIET_ROOM, quietest) : quietest);
}

const isSpeech = (loudness: number, floor: number): boolean => loudness > Math.max(MIN_LEVEL, floor * OVER_FLOOR);

function join(frames: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) { out.set(f, at); at += f.length; }
  return out;
}

/** One more frame (16 kHz); returns the new state and, when a stretch of speech has ended, that stretch. */
export function hearFrame(s: Listening, frame: Float32Array, cut: Cut): { state: Listening; stretch: Float32Array | null } {
  const loudness = level(frame);
  const speech = isSpeech(loudness, floorOf(s.recent, s.total));
  const recent = [...s.recent, loudness].slice(-FLOOR_WINDOW);
  const total = s.total + 1;
  if (!speech && s.spoken === 0) return { state: { ...s, recent, total }, stretch: null };
  const frames = [...s.frames, frame];
  const spoken = s.spoken + (speech ? 1 : 0);
  const quiet = speech ? 0 : s.quiet + 1;
  const ended = quiet >= cut.pause || frames.length >= cut.longest;
  if (!ended) return { state: { recent, frames, spoken, quiet, total, heardAny: s.heardAny || speech }, stretch: null };
  const next: Listening = { recent, frames: [], spoken: 0, quiet: 0, total, heardAny: true };
  // The trailing pause is not sent: the model only needs the speech and a little after it.
  const kept = frames.slice(0, frames.length - Math.max(0, quiet - 2));
  return { state: next, stretch: spoken >= cut.shortest ? join(kept) : null };
}

/** Whatever is still being heard when the reciter stops: sent if it holds enough speech. */
export function flush(s: Listening, cut: Cut): Float32Array | null {
  return s.spoken >= cut.shortest ? join(s.frames) : null;
}
