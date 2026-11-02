// The weather for the assistant: Open-Meteo's answer checked field by field and said in plain words; one read per spot
// every 20 minutes; a slow, failed or odd answer leaves the weather out and never throws.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "../src/place.ts";
import { DUBAI } from "./fixtures/places.ts";
import { WEATHER_FRESH_MS, forgetWeather, parseWeather, weatherFor, weatherText, weatherUrl } from "../src/talk/weather.ts";

const ANSWER = {
  current: { temperature_2m: 30.5, apparent_temperature: 34.6, relative_humidity_2m: 70, weather_code: 0,
    wind_speed_10m: 14.7 },
  daily: { time: ["2026-10-28", "2026-10-29"], weather_code: [0, 61], temperature_2m_max: [31.6, 34.4],
    temperature_2m_min: [26.2, 26.9], precipitation_probability_max: [0, 40] },
};
const NOW = Date.UTC(2026, 9, 28, 12, 0);

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => forgetWeather());

describe("the weather address", () => {
  it("sends only a rough position (two decimals) and asks for two days in the place's own zone", () => {
    const url = weatherUrl({ lat: 25.204849, lng: 55.270783 });
    expect(url).toContain("latitude=25.20&longitude=55.27");
    expect(url).toContain("timezone=auto&forecast_days=2");
    expect(url.startsWith("https://api.open-meteo.com/v1/forecast?")).toBe(true);
  });
});

describe("reading Open-Meteo's answer", () => {
  it("keeps now and two days, and says them in degrees Celsius", () => {
    const weather = parseWeather(ANSWER, "Dubai", NOW);
    expect(weather?.days).toHaveLength(2);
    expect(weatherText(weather!)).toBe("Weather for Dubai: now 31 degrees, feels like 35, clear, humidity 70 percent, " +
      "wind 15 km/h. Today 32 high, 26 low, clear, 0 percent chance of rain. Tomorrow 34 high, 27 low, light rain, " +
      "40 percent chance of rain.");
  });

  it("refuses an answer with a missing or impossible reading", () => {
    expect(parseWeather(null, "Dubai", NOW)).toBeNull();
    expect(parseWeather({ daily: ANSWER.daily }, "Dubai", NOW)).toBeNull();
    expect(parseWeather({ ...ANSWER, current: { ...ANSWER.current, temperature_2m: 999 } }, "Dubai", NOW)).toBeNull();
    expect(parseWeather({ ...ANSWER, current: { ...ANSWER.current, weather_code: "0" } }, "Dubai", NOW)).toBeNull();
  });

  it("keeps only the days that read cleanly, and takes a missing rain chance as none", () => {
    const daily = { ...ANSWER.daily, temperature_2m_max: [31.6, Number.NaN], precipitation_probability_max: [null] };
    const weather = parseWeather({ ...ANSWER, daily }, "Dubai", NOW);
    expect(weather?.days).toEqual([{ high: 31.6, low: 26.2, rain: 0, code: 0 }]);
  });

  it("names an unknown weather code plainly", () => {
    const weather = parseWeather({ ...ANSWER, current: { ...ANSWER.current, weather_code: 42 } }, "Dubai", NOW);
    expect(weatherText(weather!)).toContain("mixed weather");
  });
});

describe("asking for the weather", () => {
  it("asks once, then reuses the answer for the same spot for 20 minutes", async () => {
    const fetcher = ok(ANSWER);
    expect(await weatherFor(DUBAI, NOW, fetcher)).not.toBeNull();
    expect(await weatherFor(DUBAI, NOW + WEATHER_FRESH_MS - 1, fetcher)).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await weatherFor(DUBAI, NOW + WEATHER_FRESH_MS, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("asks again for a different spot, and calls a phone position where the user is", async () => {
    const fetcher = ok(ANSWER);
    await weatherFor(DUBAI, NOW, fetcher);
    const gps: Place = { lat: 24.45, lng: 54.38, label: "Where you are", source: "gps", at: NOW, tz: "Asia/Dubai" };
    const weather = await weatherFor(gps, NOW, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(weather?.place).toBe("where the user is");
  });

  it("gives null for a refusal, a network error, an odd body or a slow answer, and never throws", async () => {
    expect(await weatherFor(DUBAI, NOW, vi.fn(async () => new Response("", { status: 429 })))).toBeNull();
    expect(await weatherFor(DUBAI, NOW, vi.fn(async () => { throw new Error("offline"); }))).toBeNull();
    expect(await weatherFor(DUBAI, NOW, vi.fn(async () => new Response("not json", { status: 200 })))).toBeNull();
    const slow = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, fail) => {
      init?.signal?.addEventListener("abort", () => fail(new Error("aborted")));
    }));
    expect(await weatherFor(DUBAI, NOW, slow, 10)).toBeNull();
  });
});
