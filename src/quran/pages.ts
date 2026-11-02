/** Where an ayah or a surah sits in the 604-page Madinah mushaf, from the Tanzil page map in data.ts. */
import { PAGES, PAGE_START, SURA_AYAS } from "./data.ts";

const before = (a: readonly [number, number], b: readonly [number, number]): boolean =>
  a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);

/** The page an ayah is on, or null for an ayah that does not exist. */
export function pageOfAyah(sura: number, aya: number): number | null {
  if (!Number.isInteger(sura) || sura < 1 || sura > SURA_AYAS.length) return null;
  if (!Number.isInteger(aya) || aya < 1 || aya > SURA_AYAS[sura - 1]) return null;
  let low = 0;
  let high = PAGES - 1;
  // The last page that starts at or before this ayah.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (before(PAGE_START[mid], [sura, aya])) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** The first and last page of a surah, or null for a surah that does not exist. */
export function surahPages(sura: number): { first: number; last: number } | null {
  const first = pageOfAyah(sura, 1);
  const last = pageOfAyah(sura, SURA_AYAS[sura - 1] ?? 0);
  return first !== null && last !== null ? { first, last } : null;
}
