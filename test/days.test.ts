// Day keys in the place's time zone and the instants they begin, through clock changes too.
import { describe, expect, it } from "vitest";
import { daysFrom, keyOf, parseDayKey, shiftKey, startOfDay } from "../src/agenda/days.ts";

describe("days", () => {
  it("reads a day key, and refuses one that is not a real day", () => {
    expect(parseDayKey("2026-10-26")).toEqual({ y: 2026, m: 10, d: 26 });
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("26-10-2026")).toBeNull();
  });

  it("finds where a day begins in a zone", () => {
    expect(startOfDay("2026-10-26", "Asia/Dubai")).toBe(Date.UTC(2026, 9, 25, 20));
    expect(startOfDay("2026-10-26", "UTC")).toBe(Date.UTC(2026, 9, 26));
    // London: still summer time at the start of 25 Oct, winter time at the start of 26 Oct.
    expect(startOfDay("2026-10-25", "Europe/London")).toBe(Date.UTC(2026, 9, 24, 23));
    expect(startOfDay("2026-10-26", "Europe/London")).toBe(Date.UTC(2026, 9, 26));
    expect(startOfDay("2026-03-29", "Europe/London")).toBe(Date.UTC(2026, 2, 29));
    expect(startOfDay("2026-03-09", "America/New_York")).toBe(Date.UTC(2026, 2, 9, 4));
    expect(Number.isNaN(startOfDay("nope", "UTC"))).toBe(true);
  });

  it("moves between days and finds the day of an instant", () => {
    expect(shiftKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysFrom("2026-10-30", 4)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(keyOf(Date.UTC(2026, 9, 25, 20, 30), "Asia/Dubai")).toBe("2026-10-26");
    expect(keyOf(Date.UTC(2026, 9, 25, 20, 30), "UTC")).toBe("2026-10-25");
  });
});
