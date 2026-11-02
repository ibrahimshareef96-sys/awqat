/**
 * The calculation method for prayer times. The phone's time zone stands in for the country, so the method changes by
 * itself when you land somewhere new, with no network. The owner can pin one in Settings.
 */
export type MethodId =
  | "Dubai"
  | "UmmAlQura"
  | "Kuwait"
  | "Qatar"
  | "Karachi"
  | "Egyptian"
  | "Turkey"
  | "Singapore"
  | "NorthAmerica"
  | "Tehran"
  | "MoonsightingCommittee"
  | "MuslimWorldLeague";

export const METHOD_LABEL: Readonly<Record<MethodId, string>> = {
  Dubai: "Dubai",
  UmmAlQura: "Umm al-Qura, Makkah",
  Kuwait: "Kuwait",
  Qatar: "Qatar",
  Karachi: "University of Islamic Sciences, Karachi",
  Egyptian: "Egyptian General Authority",
  Turkey: "Diyanet, Turkey",
  Singapore: "Singapore, Malaysia, Indonesia",
  NorthAmerica: "ISNA, North America",
  Tehran: "Institute of Geophysics, Tehran",
  MoonsightingCommittee: "Moonsighting Committee",
  MuslimWorldLeague: "Muslim World League",
};

export const METHODS = Object.keys(METHOD_LABEL) as MethodId[];

const BY_ZONE: Readonly<Record<string, MethodId>> = {
  "Asia/Dubai": "Dubai",
  "Asia/Riyadh": "UmmAlQura",
  "Asia/Kuwait": "Kuwait",
  "Asia/Qatar": "Qatar",
  "Asia/Karachi": "Karachi",
  "Africa/Cairo": "Egyptian",
  "Europe/Istanbul": "Turkey",
  "Asia/Singapore": "Singapore",
  "Asia/Kuala_Lumpur": "Singapore",
  "Asia/Kuching": "Singapore",
  "Asia/Jakarta": "Singapore",
  "Asia/Makassar": "Singapore",
  "Asia/Jayapura": "Singapore",
  "Asia/Brunei": "Singapore",
  "Asia/Tehran": "Tehran",
  // The University of Islamic Sciences, Karachi, is the common method across South Asia and Afghanistan.
  "Asia/Kolkata": "Karachi",
  "Asia/Calcutta": "Karachi",
  "Asia/Dhaka": "Karachi",
  "Asia/Dacca": "Karachi",
  "Asia/Kabul": "Karachi",
  "Pacific/Honolulu": "NorthAmerica",
};

const NORTH_AMERICA = new RegExp("^America/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Juneau|Sitka|Nome|" +
  "Adak|Metlakatla|Yakutat|Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Halifax|Moncton|Glace_Bay|Goose_Bay|Regina|" +
  "Swift_Current|Whitehorse|Dawson|Dawson_Creek|Iqaluit|Rankin_Inlet|Cambridge_Bay|Inuvik|Detroit|Boise|Menominee|" +
  "St_Johns|Indiana/.+|Kentucky/.+|North_Dakota/.+)$");

export function methodForTimeZone(tz: string): MethodId {
  if (tz in BY_ZONE) return BY_ZONE[tz];
  if (NORTH_AMERICA.test(tz)) return "NorthAmerica";
  return "MuslimWorldLeague";
}

export function isMethod(value: unknown): value is MethodId {
  return typeof value === "string" && value in METHOD_LABEL;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}
