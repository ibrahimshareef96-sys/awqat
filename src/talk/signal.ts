/**
 * What the speaking orb hears (ui/orbMotion.ts): how loud each side of the talk is and where its voice sits, from the
 * voice library's live meters. The user's side is the microphone, the agent's side is what plays back; both read 0 to 1.
 */

/** Low, middle and high energy of one voice, each 0 to 1. */
export type Bands = readonly [number, number, number];

export interface VoiceSignal {
  /** The user's voice: the microphone's level (0 while muted). */
  readonly him: number;
  /** The assistant's voice: the playback level. */
  readonly agent: number;
  readonly himBands: Bands;
  readonly agentBands: Bands;
}

export const SILENT: Bands = [0, 0, 0];
export const QUIET: VoiceSignal = { him: 0, agent: 0, himBands: SILENT, agentBands: SILENT };

/**
 * Where each band ends, as a share of the bins. The voice library hands over 1024 bins spread evenly from 100 Hz to
 * 8 kHz (@elevenlabs/client resampleVoiceRange), so the three bands are the voice's body (100 to about 500 Hz), its
 * vowels (to about 2 kHz) and its edge, the s and sh sounds (to 8 kHz).
 */
const BAND_EDGES = [0, 0.05, 0.24, 1] as const;

/** Below this a level is the room, not a voice. */
const NOISE_FLOOR = 0.04;

/** A meter reading as 0 to 1: anything missing, not a number or out of range is clamped. */
export function levelOf(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * How loud a voice looks. The library's volume is the mean over every bin, so ordinary speech reads about 0.1 to 0.3:
 * the room's hum is gated off and the rest lifted on a square root, so a normal voice moves the orb plainly.
 */
export function loudness(value: number | undefined): number {
  const level = levelOf(value);
  return level <= NOISE_FLOOR ? 0 : Math.min(1, Math.sqrt((level - NOISE_FLOOR) / (1 - NOISE_FLOOR)) * 1.1);
}

function averageOf(data: Uint8Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] ?? 0;
  return to > from ? sum / ((to - from) * 255) : 0;
}

/** The three bands of one voice from the analyser's byte frequency data (0 to 255 per bin); silence when there is none. */
export function bandsOf(data: Uint8Array | null | undefined): Bands {
  if (!data || data.length === 0) return SILENT;
  const edge = (share: number): number => Math.min(data.length, Math.round(data.length * share));
  const bounds = BAND_EDGES.map(edge);
  const band = (i: number): number => {
    const from = bounds[i] ?? 0;
    // Every band holds at least one bin, so a short reading still shows all three.
    const to = Math.max(from + 1, bounds[i + 1] ?? from + 1);
    return levelOf(averageOf(data, Math.min(from, data.length - 1), Math.min(to, data.length)));
  };
  return [band(0), band(1), band(2)];
}
