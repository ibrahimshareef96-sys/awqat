/**
 * The Hijri date from the Umm al-Qura calendar built into the device; a calculation, so the screen says so. The month
 * is read as a number and named here: Android's WebView has no English Hijri month names and shows Gregorian ones.
 */
const MONTHS = [
  "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani", "Jumada al-Ula", "Jumada al-Akhirah",
  "Rajab", "Shaban", "Ramadan", "Shawwal", "Dhul Qadah", "Dhul Hijjah",
];

export interface HijriParts { day: number; month: string; year: number }

/**
 * One formatter per named zone, made once: the widgets ask for twelve days at every redraw. The device's own zone is
 * made afresh each time, since the phone can travel. Null where there is no Hijri calendar or the zone is unknown.
 */
const formats = new Map<string, Intl.DateTimeFormat | null>();

function makeFormat(timeZone: string | undefined): Intl.DateTimeFormat | null {
  try {
    const made = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric",
      year: "numeric", timeZone });
    return made.resolvedOptions().calendar.startsWith("islamic") ? made : null;
  } catch {
    return null;
  }
}

function formatIn(timeZone: string | undefined): Intl.DateTimeFormat | null {
  if (timeZone === undefined) return makeFormat(undefined);
  if (!formats.has(timeZone)) formats.set(timeZone, makeFormat(timeZone));
  return formats.get(timeZone) ?? null;
}

/** The day, the month's name and the year, on the device's clock or in `timeZone`; null when there is no Hijri calendar. */
export function hijriParts(date: Date, timeZone?: string): HijriParts | null {
  try {
    const format = formatIn(timeZone);
    if (!format) return null;
    const parts = format.formatToParts(date);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const [day, month, year] = [part("day"), part("month"), part("year")];
    if (!Number.isInteger(day) || !Number.isInteger(year) || month < 1 || month > 12) return null;
    return { day, month: MONTHS[month - 1], year };
  } catch {
    return null;
  }
}

/** "11 Jumada al-Ula 1448", or "" when the device has no Hijri calendar. */
export function hijriDate(date: Date, timeZone?: string): string {
  const parts = hijriParts(date, timeZone);
  return parts ? `${parts.day} ${parts.month} ${parts.year}` : "";
}
