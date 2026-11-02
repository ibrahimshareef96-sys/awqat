/**
 * The Tanzil Project's Uthmani text, as the "sura|aya|text" file tanzil.net offers. It is downloaded once to the device
 * and kept there byte for byte with its copyright block (CC BY 3.0, no changes allowed); nothing of it is bundled in
 * the app. This reads it back, checking it is the whole Quran in order before anything is matched against it.
 */
import { SURA_AYAS } from "../quran/data.ts";

export interface Verse { sura: number; aya: number; text: string }

export type TanzilRead = { verses: Verse[] } | { error: "notTanzil" | "incomplete" | "tooBig" };

/** The file is about 1.4 MB; past this it is not the file. */
export const TANZIL_MAX = 3_000_000;
/** The longest ayah (2:282) is about 1,100 characters with its marks. */
const VERSE_MAX = 3000;
const ROW = /^(\d{1,3})\|(\d{1,3})\|(.+)$/;

/** Reads the downloaded text; `ayas` is how many ayahs each surah has (the real counts unless a test says otherwise). */
export function parseTanzil(text: string, ayas: readonly number[] = SURA_AYAS): TanzilRead {
  if (text.length > TANZIL_MAX) return { error: "tooBig" };
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => line.startsWith("#") && line.includes("Tanzil"))) return { error: "notTanzil" };
  const verses: Verse[] = [];
  let sura = 1;
  let aya = 1;
  for (const line of lines) {
    if (line === "" || line.startsWith("#")) continue;
    const row = ROW.exec(line);
    if (!row) return { error: "notTanzil" };
    const [s, a, verse] = [Number(row[1]), Number(row[2]), row[3]];
    if (s !== sura || a !== aya || verse.length > VERSE_MAX) return { error: "incomplete" };
    verses.push({ sura: s, aya: a, text: verse });
    if (aya < ayas[sura - 1]) aya += 1;
    else { sura += 1; aya = 1; }
  }
  return sura === ayas.length + 1 ? { verses } : { error: "incomplete" };
}
