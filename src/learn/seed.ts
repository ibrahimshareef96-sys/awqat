/**
 * What Learn starts with on a device where it was never saved: three Islamic tracks (Tafsir, Hadith, Fiqh), empty.
 * Their teachers, courses and books, and any worldly track, are added in the app. The ids and dates are fixed, so
 * every device starts with the very same records.
 */
import { checkLearn, emptyLearn, type Learn, type LearnTrack } from "./learn.ts";

/** The day the tracks were set. */
export const SEED_DATE = "2026-10-28";

const track = (id: string, name: string): LearnTrack =>
  ({ id, name, kind: "islamic", weeklyMinutes: 0, archived: false, added: SEED_DATE });

export function seedLearn(): Learn {
  return {
    ...emptyLearn(),
    // The weekly targets are set in the app.
    tracks: [track("track-tafsir", "Tafsir"), track("track-hadith", "Hadith"), track("track-fiqh", "Fiqh")],
  };
}

/**
 * What Learn starts from at launch: the seed only when the store holds nothing at all (never written), so what was
 * deleted never comes back; nothing when the store could not be read (it is then never written this session); else
 * what was saved. The seed is not saved until the first change, which saves it with that change.
 */
export function startingLearn(read: { ok: boolean; value: string | null }): { learn: Learn; damaged: boolean } {
  if (!read.ok) return { learn: emptyLearn(), damaged: false };
  if (read.value === null) return { learn: seedLearn(), damaged: false };
  return checkLearn(read.value);
}
