/**
 * The weather where the user is, for the assistant. Open-
 * Meteo: free, no key, cross-origin allowed; only the place's rough position (two decimals, about 1 km) leaves the
 * phone. Asked once per talk at most every 20 minutes, with a short deadline: a slow answer never holds a talk up, it
 * just leaves the weather out.
 */
import type { Place } from "../place.ts";
import { cleanShown } from "./text.ts";

export interface Weather {
  /** When it was read, ms since the epoch. */
  at: number;
  place: string;
  now: { temp: number; feels: number; humidity: number; wind: number; code: number };
  days: { high: number; low: number; rain: number; code: number }[];
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const WEATHER_FRESH_MS = 20 * 60 * 1000;
export const WEATHER_DEADLINE_MS = 2500;

/** WMO weather codes, as Open-Meteo gives them, in words. */
const WORDS: Readonly<Record<number, string>> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "foggy", 48: "foggy",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow", 80: "rain showers", 81: "rain showers",
  82: "heavy rain showers", 85: "snow showers", 86: "snow showers", 95: "thunderstorms", 96: "thunderstorms with hail",
  99: "thunderstorms with hail",
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const within = (n: unknown, low: number, high: number): n is number => finite(n) && n >= low && n <= high;

export function weatherUrl(place: Pick<Place, "lat" | "lng">): string {
  const round = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  return `https://api.open-meteo.com/v1/forecast?latitude=${round(place.lat)}&longitude=${round(place.lng)}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=auto&forecast_days=2";
}

/** Open-Meteo's answer, checked field by field; null when anything it needs is missing or out of range. */
export function parseWeather(json: unknown, place: string, at: number): Weather | null {
  const body = json as { current?: Record<string, unknown>; daily?: Record<string, unknown> } | null;
  const c = body?.current;
  const d = body?.daily;
  if (!c || !d) return null;
  const temp = c.temperature_2m, feels = c.apparent_temperature, humidity = c.relative_humidity_2m;
  const wind = c.wind_speed_10m, code = c.weather_code;
  if (!within(temp, -90, 60) || !within(feels, -100, 80) || !within(humidity, 0, 100) || !within(wind, 0, 500) ||
    !within(code, 0, 99)) return null;
  const column = (name: string): unknown[] => (Array.isArray(d[name]) ? d[name] as unknown[] : []);
  const highs = column("temperature_2m_max"), lows = column("temperature_2m_min");
  const rains = column("precipitation_probability_max"), codes = column("weather_code");
  const days: Weather["days"] = [];
  for (let i = 0; i < Math.min(2, highs.length); i += 1) {
    const high = highs[i], low = lows[i], dayCode = codes[i];
    const rain = within(rains[i], 0, 100) ? rains[i] as number : 0;
    if (!within(high, -90, 60) || !within(low, -90, 60) || !within(dayCode, 0, 99)) break;
    days.push({ high, low, rain, code: dayCode });
  }
  return { at, place, now: { temp, feels, humidity, wind, code }, days };
}

const words = (code: number): string => WORDS[code] ?? "mixed weather";
const deg = (n: number): string => `${Math.round(n)}`;

/** The weather as the assistant reads it: plain words, degrees Celsius. */
export function weatherText(weather: Weather): string {
  const n = weather.now;
  const parts = [`Weather for ${weather.place}: now ${deg(n.temp)} degrees, feels like ${deg(n.feels)}, ${words(n.code)}, ` +
    `humidity ${Math.round(n.humidity)} percent, wind ${Math.round(n.wind)} km/h.`];
  const named = ["Today", "Tomorrow"];
  weather.days.forEach((day, i) => {
    parts.push(`${named[i]} ${deg(day.high)} high, ${deg(day.low)} low, ${words(day.code)}, ` +
      `${Math.round(day.rain)} percent chance of rain.`);
  });
  return parts.join(" ");
}

let last: { key: string; weather: Weather } | null = null;

/** For tests: forget the weather read before. */
export function forgetWeather(): void {
  last = null;
}

/**
 * The weather for this place: the one read in the last 20 minutes for the same spot, or a fresh read within the
 * deadline. Null when it cannot be had in time. Never throws.
 */
export async function weatherFor(place: Place, now = Date.now(), fetcher: Fetcher = fetch,
  deadline = WEATHER_DEADLINE_MS): Promise<Weather | null> {
  const url = weatherUrl(place);
  if (last !== null && last.key === url && now - last.weather.at >= 0 && now - last.weather.at < WEATHER_FRESH_MS) {
    return last.weather;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadline);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const label = place.source === "gps" ? "where the user is" : place.label;
    const weather = parseWeather(await response.json(), cleanShown(label, 60), now);
    if (weather !== null) last = { key: url, weather };
    return weather;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
