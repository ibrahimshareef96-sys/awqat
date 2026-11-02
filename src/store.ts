/** Key-value storage on the device (Capacitor Preferences; localStorage in a browser). */
import { Preferences } from "@capacitor/preferences";

export const KEYS = {
  log: "os.prayerLog.v1",
  settings: "os.settings.v1",
  place: "os.place.v1",
  quran: "os.quran.v1",
  library: "os.library.v1",
  bookSync: "os.bookSync.v1",
  friday: "os.friday.v1",
  adhkar: "os.adhkar.v1",
  mushaf: "os.mushaf.v1",
  murajaah: "os.murajaah.v1",
  calendars: "os.calendars.v1",
  agenda: "os.agenda.v1",
  body: "os.body.v1",
  learn: "os.learn.v1",
  modes: "os.modes.v1",
  money: "os.money.v1",
  recordsSync: "os.recordsSync.v1",
} as const;

/** `ok: false` means the store could not be read, which is not the same as nothing saved: the caller must not write
 * over a value it could not read. */
export interface ReadResult {
  ok: boolean;
  value: string | null;
}

export async function read(key: string): Promise<ReadResult> {
  try {
    return { ok: true, value: (await Preferences.get({ key })).value };
  } catch {
    return { ok: false, value: null };
  }
}

/** Saves; reports false rather than throwing, so a full or locked store never breaks a tap. */
export async function write(key: string, value: unknown): Promise<boolean> {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
    return true;
  } catch {
    return false;
  }
}

/** Copies kept per key; the oldest goes first. A value already kept is not kept again, so restarts do not pile up. */
const ASIDE_MAX = 5;

/**
 * Keeps a copy of a saved value that could not be read, under a key of its own, before anything replaces it. False
 * when no copy could be made: the caller must then leave the original alone for the session.
 */
export async function keepAside(key: string, raw: string): Promise<boolean> {
  const prefix = `${key}.unreadable.`;
  let kept: string[] = [];
  try {
    // The keys end in a 13-digit time, so they sort oldest first.
    kept = (await Preferences.keys()).keys.filter((k) => k.startsWith(prefix)).sort();
    const values = await Promise.all(kept.map((k) => Preferences.get({ key: k })));
    if (values.some((v) => v.value === raw)) return true;
  } catch {
    // Only the tidying is lost; the copy is still made below.
    kept = [];
  }
  try {
    await Preferences.set({ key: `${prefix}${Date.now()}`, value: raw });
  } catch {
    return false;
  }
  try {
    for (const old of kept.slice(0, Math.max(0, kept.length + 1 - ASIDE_MAX))) await Preferences.remove({ key: old });
  } catch {
    // An extra old copy stays; it is removed next time.
  }
  return true;
}
