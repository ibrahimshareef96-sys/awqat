// The edges the reviews found: polar days, a place in another time zone, Isha after midnight, damaged saves.
import { describe, expect, it } from "vitest";
import { calendarDayIn, dayTimes, formatTime } from "../src/prayer/times.ts";
import { prayerDayIndex } from "../src/prayer/window.ts";
import { planReminders } from "../src/reminders/plan.ts";
import { methodForTimeZone } from "../src/prayer/method.ts";
import { DEFAULT_PLACE, PLACE_LABEL_MAX, parsePlace, pinnedPlace, roughPlace } from "../src/place.ts";
import { DUBAI } from "./fixtures/places.ts";
import { checkLog } from "../src/prayer/log.ts";
import { cleanName } from "../src/settings.ts";

const finite = (d: Date) => Number.isFinite(d.getTime());
const fields = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;

describe("far north and south", () => {
  it.each([
    ["Tromsø in June", 69.6492, 18.9553, { y: 2026, m: 6, d: 21 }],
    ["Tromsø in December", 69.6492, 18.9553, { y: 2026, m: 12, d: 21 }],
    ["Longyearbyen in June", 78.2232, 15.6267, { y: 2026, m: 6, d: 21 }],
    ["the North Pole", 90, 0, { y: 2026, m: 6, d: 21 }],
    ["the South Pole", -90, 0, { y: 2026, m: 6, d: 21 }],
  ])("%s still gives six real times, in order, and says it adjusted", (_, lat, lng, day) => {
    const t = dayTimes({ lat, lng }, day, "MuslimWorldLeague");
    for (const f of fields) expect(finite(t[f]), f).toBe(true);
    const order = [t.fajr, t.dhuhr, t.asr, t.maghrib, t.isha].map((d) => d.getTime());
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t.adjusted).not.toBe("none");
  });

  it("leaves ordinary places alone", () => {
    expect(dayTimes(DUBAI, { y: 2026, m: 10, d: 22 }, "Dubai").adjusted).toBe("none");
  });

  it("never plans a reminder for a time that is not a real date", () => {
    const t = dayTimes(DUBAI, { y: 2026, m: 10, d: 22 }, "Dubai");
    const broken = { ...t, asr: new Date(Number.NaN) };
    const plan = planReminders([broken], new Date("2026-10-22T00:00:00+04:00"),
      { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true });
    expect(plan.map((r) => r.title)).toEqual(["Fajr", "Dhuhr", "Maghrib", "Isha"]);
  });
});

describe("a place keeps its own time zone", () => {
  it("shows Dubai's times on Dubai's clock even when the phone is in New York", () => {
    const t = dayTimes(DUBAI, { y: 2026, m: 10, d: 22 }, "Dubai");
    expect(formatTime(t.fajr, DUBAI.tz)).toBe("05:03");
    expect(formatTime(t.fajr, "America/New_York")).not.toBe("05:03");
  });

  it("works out the calendar day in the place's zone", () => {
    const lateInNewYork = new Date("2026-10-22T23:30:00-04:00");
    expect(calendarDayIn(lateInNewYork, "Asia/Dubai")).toEqual({ y: 2026, m: 10, d: 23 });
    expect(calendarDayIn(lateInNewYork, "America/New_York")).toEqual({ y: 2026, m: 10, d: 22 });
  });

  it("stores the zone with a reading and drops an unknown zone", () => {
    expect(roughPlace(40.71, -74.0, 1, "America/New_York").tz).toBe("America/New_York");
    const saved = parsePlace(JSON.stringify({ lat: 1, lng: 2, label: "x", source: "gps", at: 1, tz: "Mars/Olympus" }));
    expect(saved?.tz).toBe("UTC");
  });
});

describe("a place typed in Settings", () => {
  it("pins a point on Earth by its degrees, rounded like a reading, on the phone's clock", () => {
    expect(pinnedPlace("51.5072", "-0.1276", "  London  ", "Europe/London", 5)).toEqual(
      { lat: 51.51, lng: -0.13, label: "London", source: "pinned", at: 5, tz: "Europe/London" });
    expect(pinnedPlace("-33.87", "151.21", "", "Australia/Sydney", 1)?.label).toBe("Pinned place");
    expect(pinnedPlace("0", "0", "x".repeat(99), "Mars/Olympus", 1)).toMatchObject(
      { label: "x".repeat(PLACE_LABEL_MAX), tz: "UTC" });
  });

  it("is nothing for what is not a point on Earth", () => {
    for (const [lat, lng] of [["91", "0"], ["0", "181"], ["", "10"], ["abc", "10"], ["1e400", "0"], [null, "1"],
      ["0x1F", "0"], ["1e1", "0"], ["12.", "0"], ["--1", "0"], ["1,2,3", "0"]]) {
      expect(pinnedPlace(lat, lng, "", "UTC", 1)).toBeNull();
    }
  });

  it("reads a decimal comma as a point, as some keyboards type it", () => {
    expect(pinnedPlace("51,5072", "-0,1276", "London", "Europe/London", 1)).toMatchObject({ lat: 51.51, lng: -0.13 });
  });

  it("reads Arabic-Indic digits, the minus sign and the Arabic decimal separator", () => {
    expect(pinnedPlace("٢١٫٤٢", "٣٩٫٨٣", "", "Asia/Riyadh", 1)).toMatchObject({ lat: 21.42, lng: 39.83 });
    expect(pinnedPlace("−33.87", "151.21", "", "Australia/Sydney", 1)).toMatchObject({ lat: -33.87, lng: 151.21 });
    expect(pinnedPlace("+51.5", "-0.1", "", "Europe/London", 1)).toMatchObject({ lat: 51.5, lng: -0.1 });
  });

  it("takes both values pasted from a map app into the first box", () => {
    expect(pinnedPlace("37.774929, -122.419416", "", "", "America/Los_Angeles", 1)).toMatchObject({ lat: 37.77, lng: -122.42 });
    expect(pinnedPlace("37.77,-122.42", " ", "", "UTC", 1)).toMatchObject({ lat: 37.77, lng: -122.42 });
    expect(pinnedPlace("37.77 -122.42", "", "", "UTC", 1)).toMatchObject({ lat: 37.77, lng: -122.42 });
    // With a longitude typed too, the first box is one value, and two in it are not one.
    expect(pinnedPlace("37.77, -122.42", "10", "", "UTC", 1)).toBeNull();
    expect(pinnedPlace("37.77", "", "", "UTC", 1)).toBeNull();
  });

  it("never reads one number with a decimal comma as a pair, so a missing longitude is said, not guessed", () => {
    expect(pinnedPlace("51,51", "", "", "UTC", 1)).toBeNull();
    expect(pinnedPlace("24,46", "", "", "UTC", 1)).toBeNull();
    expect(pinnedPlace("51,51", "-0,13", "", "UTC", 1)).toMatchObject({ lat: 51.51, lng: -0.13 });
  });

  it("starts unset: Makkah's times, said to be a guess", () => {
    expect(DEFAULT_PLACE).toMatchObject({ label: "Makkah", source: "default", tz: "Asia/Riyadh" });
  });
});

describe("Isha after midnight belongs to the night before", () => {
  const yesterday = dayTimes(DUBAI, { y: 2026, m: 10, d: 21 }, "Dubai");
  const today = dayTimes(DUBAI, { y: 2026, m: 10, d: 22 }, "Dubai");

  it("keeps yesterday's prayer day until today's Fajr", () => {
    expect(prayerDayIndex([yesterday, today], new Date("2026-10-22T00:30:00+04:00"))).toBe(0);
    expect(prayerDayIndex([yesterday, today], new Date("2026-10-22T05:10:00+04:00"))).toBe(1);
  });
});

describe("more time zones", () => {
  it.each([
    ["Asia/Kolkata", "Karachi"], ["Asia/Calcutta", "Karachi"], ["Asia/Dhaka", "Karachi"], ["Asia/Kabul", "Karachi"],
    ["America/North_Dakota/Center", "NorthAmerica"], ["America/Juneau", "NorthAmerica"], ["Pacific/Honolulu", "NorthAmerica"],
    ["America/Montreal", "NorthAmerica"],
  ])("%s gives %s", (tz, method) => expect(methodForTimeZone(tz)).toBe(method));
});

describe("a damaged save is kept, never overwritten", () => {
  it("reports damage only for something saved that cannot be read", () => {
    expect(checkLog(null).damaged).toBe(false);
    expect(checkLog(JSON.stringify({ v: 1, days: {}, owed: 0 })).damaged).toBe(false);
    expect(checkLog("{broken").damaged).toBe(true);
    expect(checkLog(JSON.stringify({ v: 2 })).damaged).toBe(true);
  });
});

describe("names", () => {
  it("never cut an emoji in half", () => {
    expect(cleanName("👍".repeat(45))).toBe("👍".repeat(40));
  });
});
