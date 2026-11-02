// The Hijri date the Faith screen and the widgets show: the device's Umm al-Qura calendar, read for a day in a zone.
import { describe, expect, it } from "vitest";
import { hijriDate, hijriParts } from "../src/prayer/hijri.ts";

describe("the Hijri date in parts", () => {
  it("gives the day, the month's name and the year", () => {
    expect(hijriParts(new Date("2026-10-22T12:00:00+04:00"))).toEqual({ day: 11, month: "Jumada al-Ula", year: 1448 });
  });

  it("reads the day in the zone it is asked for, not the device's", () => {
    // 23:30 on 22 Oct in UTC is already 23 Oct in Dubai.
    const late = new Date("2026-10-22T23:30:00Z");
    expect(hijriParts(late, "UTC")?.day).toBe(11);
    expect(hijriParts(late, "Asia/Dubai")?.day).toBe(12);
    expect(hijriDate(late, "Asia/Dubai")).toBe("12 Jumada al-Ula 1448");
  });

  it("gives nothing for a zone the device does not know, and the same answer when asked again", () => {
    expect(hijriParts(new Date("2026-10-22T12:00:00Z"), "Not/AZone")).toBeNull();
    expect(hijriDate(new Date("2026-10-22T12:00:00Z"), "Not/AZone")).toBe("");
    const first = hijriParts(new Date("2026-10-22T12:00:00Z"), "UTC");
    expect(hijriParts(new Date("2026-10-22T12:00:00Z"), "UTC")).toEqual(first);
  });
});
