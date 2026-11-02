// The owner's settings on the device, and the Hijri date line.
import { describe, expect, it } from "vitest";
import { defaultSettings, greetingFor, methodInUse, parseSettings } from "../src/settings.ts";
import { hijriDate } from "../src/prayer/hijri.ts";

describe("settings", () => {
  it("start with every reminder on, the method on auto and no name", () => {
    const s = defaultSettings();
    expect(s.name).toBe("");
    expect(s.method).toBe("auto");
    expect(Object.values(s.reminders).every(Boolean)).toBe(true);
  });

  it("read back only what is valid", () => {
    const s = parseSettings(JSON.stringify({
      name: "  Sam  ", method: "UmmAlQura", reminders: { fajr: false, isha: "yes" }, setupDone: true,
    }));
    expect(s.name).toBe("Sam");
    expect(s.method).toBe("UmmAlQura");
    expect(s.reminders.fajr).toBe(false);
    expect(s.reminders.isha).toBe(true);
    expect(s.setupDone).toBe(true);
    expect(parseSettings(JSON.stringify({ method: "Nowhere" })).method).toBe("auto");
    expect(parseSettings("{oops")).toEqual(defaultSettings());
  });

  it("keep Friday reminders on unless they were turned off", () => {
    expect(defaultSettings().fridayReminders).toBe(true);
    expect(parseSettings(JSON.stringify({ name: "Sam" })).fridayReminders).toBe(true);
    expect(parseSettings(JSON.stringify({ fridayReminders: false })).fridayReminders).toBe(false);
    expect(parseSettings(JSON.stringify({ fridayReminders: "no" })).fridayReminders).toBe(true);
  });

  it("keep the adhkar reminders on unless they were turned off", () => {
    expect(defaultSettings().adhkarReminders).toBe(true);
    expect(parseSettings(JSON.stringify({ name: "Sam" })).adhkarReminders).toBe(true);
    expect(parseSettings(JSON.stringify({ adhkarReminders: false })).adhkarReminders).toBe(false);
    expect(parseSettings(JSON.stringify({ adhkarReminders: 0 })).adhkarReminders).toBe(true);
  });

  it("show the adhkar's Arabic, sound and meaning unless each was turned off", () => {
    expect(defaultSettings().adhkarShow).toEqual({ arabic: true, sound: true, meaning: true });
    expect(parseSettings(JSON.stringify({ name: "Sam" })).adhkarShow).toEqual({ arabic: true, sound: true, meaning: true });
    expect(parseSettings(JSON.stringify({ adhkarShow: { sound: false } })).adhkarShow)
      .toEqual({ arabic: true, sound: false, meaning: true });
    expect(parseSettings(JSON.stringify({ adhkarShow: { arabic: false, meaning: false } })).adhkarShow)
      .toEqual({ arabic: false, sound: true, meaning: false });
    expect(parseSettings(JSON.stringify({ adhkarShow: { arabic: "no", sound: 0 } })).adhkarShow)
      .toEqual({ arabic: true, sound: true, meaning: true });
    expect(parseSettings(JSON.stringify({ adhkarShow: [false] })).adhkarShow).toEqual({ arabic: true, sound: true, meaning: true });
  });

  it("cap the name at 40 characters", () => {
    expect(parseSettings(JSON.stringify({ name: "x".repeat(90) })).name).toHaveLength(40);
  });

  it("use the pinned method, else the one for the time zone", () => {
    expect(methodInUse({ ...defaultSettings(), method: "Qatar" }, "Asia/Dubai")).toBe("Qatar");
    expect(methodInUse(defaultSettings(), "Asia/Dubai")).toBe("Dubai");
  });

  it("greet by the hour, with the name when there is one", () => {
    expect(greetingFor(new Date("2026-10-22T09:00:00+04:00"), "")).toBe("Good morning");
    expect(greetingFor(new Date("2026-10-22T12:15:00+04:00"), "Sam")).toBe("Good afternoon, Sam");
    expect(greetingFor(new Date("2026-10-22T21:00:00+04:00"), "Sam")).toBe("Good evening, Sam");
    expect(greetingFor(new Date("2026-10-22T02:00:00+04:00"), "")).toBe("Good night");
  });
});

describe("the Hijri date", () => {
  it("comes from the Umm al-Qura calendar", () => {
    const line = hijriDate(new Date("2026-10-22T12:00:00+04:00"));
    expect(line).toBe("11 Jumada al-Ula 1448");
  });
});
