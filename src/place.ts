/**
 * Where prayer times are worked out for: the phone's rough location, or a place pinned by its coordinates. Until either
 * is known the times are Makkah's, said plainly on Home, and no prayer reminder is scheduled (app/schedule.ts).
 * A place keeps its own time zone, so its times show on its own clock even when the phone has travelled.
 */
export interface Place {
  lat: number;
  lng: number;
  label: string;
  source: "gps" | "pinned" | "default";
  /** When this place was read, in ms since the epoch (0 for the default). */
  at: number;
  /** The IANA time zone the place keeps (the phone's zone when it was read). */
  tz: string;
}

/** Al-Masjid al-Haram: what the times are for before a place is known. */
export const DEFAULT_PLACE: Place = { lat: 21.4225, lng: 39.8262, label: "Makkah", source: "default", at: 0, tz: "Asia/Riyadh" };

/** The zone a place keeps when the one it came with is not a real one. */
const FALLBACK_TZ = "UTC";
export const PLACE_LABEL_MAX = 40;

/** A new reading only replaces the place once you have moved this far: city-level prayer times barely change within it. */
export const MOVE_KM = 25;

const EARTH_KM = 6371.0088;
const rad = (deg: number): number => (deg * Math.PI) / 180;

export function isOnEarth(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Great-circle distance in km (haversine). */
export function distanceKm(a: Pick<Place, "lat" | "lng">, b: Pick<Place, "lat" | "lng">): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function shouldMove(current: Place, fresh: Place): boolean {
  return distanceKm(current, fresh) > MOVE_KM;
}

/** Two decimals is about 1 km: enough for prayer times, and the phone never keeps a precise position. */
export function roughPlace(lat: number, lng: number, now: number, tz: string): Place {
  const round = (n: number) => Math.round(n * 100) / 100;
  return { lat: round(lat), lng: round(lng), label: "Where you are", source: "gps", at: now,
    tz: isTimeZone(tz) ? tz : FALLBACK_TZ };
}

/** Arabic-Indic digits, the minus sign and the Arabic decimal separator as ASCII; commas are left for the caller. */
function asciiDegrees(text: string): string {
  return text.trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/−/g, "-")
    .replace(/٫/g, ".");
}

const DEGREES = /^[+-]?\d{1,3}(?:\.\d+)?$/;
/**
 * Two values in one box, as a map app copies them: "37.7749, -122.4194". A comma splits them only with a space after
 * it, or right after a decimal point's digits ("37.77,-122.42"), so "51,51" stays one number with a decimal comma.
 */
const PAIR = /^([+-]?\d{1,3}(?:\.\d+)?)\s*(?:,\s+|;\s*|\s+)([+-]?\d{1,3}(?:\.\d+)?)$/;
const PAIR_DOTTED = /^([+-]?\d{1,3}\.\d+),([+-]?\d{1,3}(?:\.\d+)?)$/;

/** Plain decimal degrees, a lone decimal comma read as a point; NaN for anything else (hex, exponents, words). */
function degrees(text: string): number {
  const ascii = asciiDegrees(text);
  const dotted = /^[+-]?\d{1,3},\d+$/.test(ascii) ? ascii.replace(",", ".") : ascii;
  return DEGREES.test(dotted) ? Number(dotted) : NaN;
}

/**
 * A place typed in Settings: latitude and longitude in decimal degrees (as a map app shows them, or both pasted into
 * the first box), an optional name, and the phone's time zone. Null for anything that is not a point on Earth. Kept to
 * two decimals, like a reading.
 */
export function pinnedPlace(lat: unknown, lng: unknown, label: unknown, tz: string, now: number): Place | null {
  const latText = typeof lat === "string" ? lat : "";
  const lngText = typeof lng === "string" ? lng : "";
  const ascii = asciiDegrees(latText);
  const pair = lngText.trim() === "" ? PAIR.exec(ascii) ?? PAIR_DOTTED.exec(ascii) : null;
  const la = degrees(pair ? pair[1] : latText);
  const ln = degrees(pair ? pair[2] : lngText);
  if (!isOnEarth(la, ln)) return null;
  const name = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, PLACE_LABEL_MAX) : "";
  const round = (n: number) => Math.round(n * 100) / 100;
  return { lat: round(la), lng: round(ln), label: name || "Pinned place", source: "pinned", at: now,
    tz: isTimeZone(tz) ? tz : FALLBACK_TZ };
}

export function parsePlace(json: string | null): Place | null {
  if (json === null) return null;
  try {
    const p = JSON.parse(json) as Partial<Place>;
    if (typeof p.lat !== "number" || typeof p.lng !== "number" || !isOnEarth(p.lat, p.lng)) return null;
    const source = p.source === "gps" || p.source === "pinned" ? p.source : "default";
    const label = typeof p.label === "string" ? p.label.slice(0, 60) : "Saved place";
    return { lat: p.lat, lng: p.lng, label, source, at: typeof p.at === "number" ? p.at : 0,
      tz: isTimeZone(p.tz) ? p.tz : FALLBACK_TZ };
  } catch {
    return null;
  }
}
