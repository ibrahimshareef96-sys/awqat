/**
 * The Hijri date from the Umm al-Qura calendar built into the device; a calculation, so the screen says so. The month
 * is read as a number and named here: Android's WebView has no English Hijri month names and shows Gregorian ones.
 */
const MONTHS = [
  "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani", "Jumada al-Ula", "Jumada al-Akhirah",
  "Rajab", "Shaban", "Ramadan", "Shawwal", "Dhul Qadah", "Dhul Hijjah",
];

/** "11 Jumada al-Ula 1448", or "" when the device has no Hijri calendar. */
export function hijriDate(date: Date): string {
  try {
    const format = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric" });
    if (!format.resolvedOptions().calendar.startsWith("islamic")) return "";
    const parts = format.formatToParts(date);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const [day, month, year] = [part("day"), part("month"), part("year")];
    if (!Number.isInteger(day) || !Number.isInteger(year) || month < 1 || month > 12) return "";
    return `${day} ${MONTHS[month - 1]} ${year}`;
  } catch {
    return "";
  }
}
