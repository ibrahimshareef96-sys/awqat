// The iqama: the minutes after each adhan, as set in Settings or where they start, none on Friday's Dhuhr (the app
// cannot know when Jumu'ah is held), and the prayer whose iqama is coming, for Home's countdown.
import { describe, expect, it } from "vitest";
import {
  IQAMA_MAX, IQAMA_MINUTES, awaitingIqama, cleanIqama, cleanIqamaMinutes, iqamaAt, iqamaCountdown, parseIqamaMinutes,
} from "../src/prayer/iqama.ts";
import { defaultSettings, parseSettings } from "../src/settings.ts";
import type { DayTimes } from "../src/prayer/times.ts";

const at = (time: string, date = "2026-10-27"): Date => new Date(`${date}T${time}:00+04:00`);

function day(date: string): DayTimes {
  return { date, fajr: at("05:06", date), sunrise: at("06:20", date), dhuhr: at("12:06", date), asr: at("15:20", date),
    maghrib: at("17:46", date), isha: at("19:00", date), method: "dubai", adjusted: {} } as unknown as DayTimes;
}

describe("the iqama", () => {
  it("comes the given minutes after each adhan", () => {
    expect(IQAMA_MINUTES).toEqual({ fajr: 25, dhuhr: 20, asr: 20, maghrib: 7, isha: 20 });
    const today = day("2026-10-27");
    expect(iqamaAt(today, "fajr")?.toISOString()).toBe(at("05:31").toISOString());
    expect(iqamaAt(today, "maghrib")?.toISOString()).toBe(at("17:53").toISOString());
  });

  it("is not counted on Friday's Dhuhr, which is Jumu'ah", () => {
    const friday = day("2026-10-30");
    expect(iqamaAt(friday, "dhuhr")).toBeNull();
    expect(iqamaAt(friday, "asr")).not.toBeNull();
  });

  it("names the prayer whose adhan has sounded and whose iqama has not come yet", () => {
    const today = day("2026-10-27");
    expect(awaitingIqama(today, at("05:10"))).toEqual({ prayer: "fajr", at: at("05:31") });
    expect(awaitingIqama(today, at("05:31"))).toBeNull();
    expect(awaitingIqama(today, at("05:00"))).toBeNull();
    expect(awaitingIqama(today, at("17:50"))?.prayer).toBe("maghrib");
    expect(awaitingIqama(day("2026-10-30"), at("12:10", "2026-10-30"))).toBeNull();
  });

  it("says on Home how long until the iqama, and nothing when none is coming", () => {
    const today = day("2026-10-27");
    expect(iqamaCountdown(today, at("05:13"))).toBe("Fajr iqama in 18 min");
    expect(iqamaCountdown(today, at("05:40"))).toBe("");
  });
});

describe("the iqama as the user's mosque keeps it", () => {
  it("follows the minutes set for each prayer, the rest where they start", () => {
    const today = { ...day("2026-10-27"), iqama: { ...IQAMA_MINUTES, fajr: 10, maghrib: 12 } };
    expect(iqamaAt(today, "fajr")?.toISOString()).toBe(at("05:16").toISOString());
    expect(iqamaAt(today, "maghrib")?.toISOString()).toBe(at("17:58").toISOString());
    expect(iqamaAt(today, "isha")?.toISOString()).toBe(at("19:20").toISOString());
    expect(awaitingIqama(today, at("05:20"))).toBeNull();
    // Friday's Dhuhr still has none, whatever is set.
    expect(iqamaAt({ ...day("2026-10-30"), iqama: { ...IQAMA_MINUTES, dhuhr: 5 } }, "dhuhr")).toBeNull();
  });

  it("takes only whole minutes in range, typed or saved, and keeps the starting value otherwise", () => {
    expect(cleanIqamaMinutes("15", "fajr")).toBe(15);
    expect(cleanIqamaMinutes(" 30 ", "isha")).toBe(30);
    expect(cleanIqamaMinutes(IQAMA_MAX, "asr")).toBe(IQAMA_MAX);
    for (const bad of ["0", "-5", String(IQAMA_MAX + 1), "12.5", "abc", "", "0x1F", "1e1", "0b11", " ", null, undefined,
      true, 7.5, Number.NaN]) {
      expect(cleanIqamaMinutes(bad, "maghrib")).toBe(IQAMA_MINUTES.maghrib);
      // Typed in Settings, nothing is taken, so the value already set is kept rather than reset.
      expect(parseIqamaMinutes(bad)).toBeNull();
    }
    expect(parseIqamaMinutes("33")).toBe(33);
  });

  it("is read back from saved settings, a damaged value starting afresh", () => {
    expect(defaultSettings().iqama).toEqual(IQAMA_MINUTES);
    expect(cleanIqama({ fajr: 30, dhuhr: "x", extra: 9 })).toEqual({ ...IQAMA_MINUTES, fajr: 30 });
    expect(cleanIqama("nope")).toEqual(IQAMA_MINUTES);
    expect(parseSettings(JSON.stringify({ iqama: { isha: 25 } })).iqama).toEqual({ ...IQAMA_MINUTES, isha: 25 });
    expect(parseSettings(JSON.stringify({ iqama: [1, 2, 3] })).iqama).toEqual(IQAMA_MINUTES);
  });
});
