// Prayer times on the device: adhan-js with the method the phone's time zone points to.
// Run with TZ=Asia/Dubai (npm test sets it), so a calendar day means a Dubai day.
import { describe, expect, it } from "vitest";
import { dayTimes, formatTime } from "../src/prayer/times.ts";
import { methodForTimeZone } from "../src/prayer/method.ts";
import { nextPrayer, skyMoment, untilPhrase } from "../src/prayer/window.ts";
import { DUBAI } from "./fixtures/places.ts";

const OCT22 = { y: 2026, m: 10, d: 22 };
const OCT23 = { y: 2026, m: 10, d: 23 };
const at = (hhmm: string, day = "2026-10-22") => new Date(`${day}T${hhmm}:00+04:00`);
const hhmm = (d: Date) => formatTime(d, "Asia/Dubai");

describe("prayer times", () => {
  it("matches the Dubai times checked on 22 Oct 2026", () => {
    const t = dayTimes(DUBAI, OCT22, "Dubai");
    expect([t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha].map(hhmm))
      .toEqual(["05:03", "06:18", "12:06", "15:22", "17:49", "19:03"]);
    expect(t.method).toBe("Dubai");
    expect(t.date).toBe("2026-10-22");
  });

  it("uses a high-latitude rule far north and still gives five times in order", () => {
    const tromso = { lat: 69.6492, lng: 18.9553 };
    const t = dayTimes(tromso, { y: 2026, m: 12, d: 21 }, "MuslimWorldLeague");
    expect(t.adjusted).not.toBe("none");
    const order = [t.fajr, t.dhuhr, t.asr, t.maghrib, t.isha].map((d) => d.getTime());
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("refuses a place that is not on Earth", () => {
    expect(() => dayTimes({ ...DUBAI, lat: 123 }, OCT22, "Dubai")).toThrow();
  });
});

describe("the method follows the phone's time zone", () => {
  it.each([
    ["Asia/Dubai", "Dubai"],
    ["Asia/Muscat", "MuslimWorldLeague"],
    ["Asia/Riyadh", "UmmAlQura"],
    ["Asia/Kuwait", "Kuwait"],
    ["Asia/Qatar", "Qatar"],
    ["Asia/Karachi", "Karachi"],
    ["Africa/Cairo", "Egyptian"],
    ["Europe/Istanbul", "Turkey"],
    ["Asia/Singapore", "Singapore"],
    ["Asia/Kuala_Lumpur", "Singapore"],
    ["America/New_York", "NorthAmerica"],
    ["America/Toronto", "NorthAmerica"],
    ["Europe/London", "MuslimWorldLeague"],
    ["", "MuslimWorldLeague"],
  ])("%s gives %s", (tz, method) => {
    expect(methodForTimeZone(tz)).toBe(method);
  });
});

describe("the prayer window and the next prayer", () => {
  const today = dayTimes(DUBAI, OCT22, "Dubai");
  const tomorrow = dayTimes(DUBAI, OCT23, "Dubai");

  it.each([
    ["03:00", "isha"],
    ["05:10", "fajr"],
    ["09:00", "morning"],
    ["12:15", "dhuhr"],
    ["16:00", "asr"],
    ["18:00", "maghrib"],
    ["22:00", "isha"],
  ])("at %s the sky is %s", (time, moment) => {
    expect(skyMoment(today, at(time))).toBe(moment);
  });

  it("names the next prayer and rolls to tomorrow's Fajr after Isha", () => {
    expect(nextPrayer(today, tomorrow, at("12:15")).name).toBe("asr");
    expect(nextPrayer(today, tomorrow, at("06:30")).name).toBe("dhuhr");
    const late = nextPrayer(today, tomorrow, at("21:00"));
    expect(late.name).toBe("fajr");
    expect(late.at.getTime()).toBe(tomorrow.fajr.getTime());
  });

  it("says how long until it", () => {
    expect(untilPhrase(at("12:15"), at("15:22"))).toBe("in 3 h 07 min");
    expect(untilPhrase(at("15:10"), at("15:22"))).toBe("in 12 min");
    expect(untilPhrase(at("15:22"), at("15:22"))).toBe("now");
  });
});
