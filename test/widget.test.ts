// The home-screen widget's side in the app: what it is given to show (it runs with the app closed, so it gets the
// coming prayers and two days of lines), when it is told, and which links from it the app will follow.
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ update: vi.fn(async (_o: { snapshot: string }) => undefined), platform: "android" }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.platform !== "web", getPlatform: () => native.platform },
  registerPlugin: () => ({ update: native.update }),
}));

import { DUBAI } from "./fixtures/places.ts";
import { addDays, dayTimes, type DayTimes } from "../src/prayer/times.ts";
import { emptyQuranLog, logRevision, setPosition } from "../src/quran/log.ts";
import { makePlan } from "../src/quran/murajaah.ts";
import { linkTarget, syncWidget, widgetSnapshot } from "../src/app/widget.ts";

/** Thursday 22 Oct 2026 to Sunday 1 Nov, Dubai method. */
const days: DayTimes[] = Array.from({ length: 11 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 22 }, i), "Dubai"));
const NOW = new Date("2026-10-23T10:00:00Z"); // Friday, 14:00 in Dubai: after Jumu'ah, before Asr.

describe("what the widget is given", () => {
  const quran = logRevision(setPosition(emptyQuranLog(), 312), "2026-10-23", 1);
  const snapshot = widgetSnapshot({ days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran, page: 313,
    plan: makePlan([1, 2, 3], 1) });

  it("lists the coming prayers only, with their time in Dubai, and Dhuhr named Jumu'ah on a Friday", () => {
    expect(snapshot.prayers[0]).toMatchObject({ name: "Asr", time: "15:22" });
    expect(snapshot.prayers.every((p) => p.at > NOW.getTime())).toBe(true);
    expect(snapshot.prayers.length).toBeLessThanOrEqual(60);
    // Today's Jumu'ah (12:06) has passed; the first one listed is next Friday's, 30 Oct.
    const jumuah = snapshot.prayers.find((p) => p.name === "Jumu'ah");
    expect(jumuah && new Date(jumuah.at).toISOString()).toBe("2026-10-30T08:06:00.000Z");
    expect(snapshot.prayers.filter((p) => p.name === "Dhuhr").every((p) => new Date(p.at).getUTCDay() !== 5)).toBe(true);
  });

  it("gives today's and tomorrow's lines: the page the user stopped reading on, and the revision left", () => {
    expect(snapshot.days).toEqual([
      { date: "2026-10-23", quran: "Page 313 of 604", revise: "Revision done today" },
      { date: "2026-10-24", quran: "Page 313 of 604", revise: "Revise Juz 2" },
    ]);
    expect(snapshot.tz).toBe("Asia/Dubai");
  });

  it("keeps at most 60 prayers, the soonest first", () => {
    const many = Array.from({ length: 15 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 22 }, i), "Dubai"));
    const big = widgetSnapshot({ days: many, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran, page: 1, plan: null });
    expect(big.prayers).toHaveLength(60);
    expect(big.prayers.every((p, i) => i === 0 || p.at > big.prayers[i - 1].at)).toBe(true);
  });

  it("writes times in the place's own zone, across a clock change", () => {
    const ny = { ...DUBAI, lat: 40.71, lng: -74.01, tz: "America/New_York", label: "New York" };
    const nyDays = Array.from({ length: 4 }, (_, i) => dayTimes(ny, addDays({ y: 2026, m: 10, d: 31 }, i),
      "MuslimWorldLeague"));
    const snap = widgetSnapshot({ days: nyDays, now: new Date("2026-10-31T12:00:00Z"), tz: "America/New_York",
      today: "2026-10-31", quran, page: 1, plan: null });
    // New York leaves daylight time on 1 Nov 2026: each time is printed as the clock there reads it.
    for (const p of snap.prayers) {
      const there = new Date(p.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: "America/New_York" });
      expect(p.time).toBe(there);
    }
    expect(snap.tz).toBe("America/New_York");
  });

  it("leaves the revision line empty with no plan", () => {
    const plain = widgetSnapshot({ days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran: emptyQuranLog(), page: 1,
      plan: null });
    expect(plain.days[0]).toEqual({ date: "2026-10-23", quran: "Page 1 of 604", revise: "" });
    // A page out of the mushaf is never shown.
    const odd = (page: number) => widgetSnapshot({ days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23",
      quran: emptyQuranLog(), page, plan: null }).days[0].quran;
    expect([odd(0), odd(999), odd(Number.NaN)]).toEqual(["Page 1 of 604", "Page 604 of 604", "Page 1 of 604"]);
  });
});

describe("telling the widget", () => {
  beforeEach(() => {
    native.update.mockReset();
    native.update.mockResolvedValue(undefined);
    native.platform = "android";
  });

  const snap = (revise: string) => ({ v: 1 as const, tz: "Asia/Dubai", prayers: [],
    days: [{ date: "2026-10-23", quran: "Page 1 of 604", revise }] });

  it("only when what it shows has changed", async () => {
    syncWidget(snap("Revise Juz 1"));
    syncWidget(snap("Revise Juz 1"));
    expect(native.update).toHaveBeenCalledTimes(1);
    syncWidget(snap("Revision done today"));
    expect(native.update).toHaveBeenCalledTimes(2);
  });

  it("again after a failed try, on iOS as on Android, and never in a browser", async () => {
    native.update.mockRejectedValueOnce(new Error("no widget"));
    syncWidget(snap("Revise Juz 9"));
    await Promise.resolve();
    await Promise.resolve();
    syncWidget(snap("Revise Juz 9"));
    expect(native.update).toHaveBeenCalledTimes(2);
    native.platform = "web";
    syncWidget(snap("Revise Juz 10"));
    expect(native.update).toHaveBeenCalledTimes(2);
    native.platform = "ios";
    syncWidget(snap("Revise Juz 11"));
    expect(native.update).toHaveBeenCalledTimes(3);
    native.platform = "android";
  });
});

describe("what else the widgets are given", () => {
  const base = { days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran: emptyQuranLog(), page: 1, plan: null };

  it("the iqama with each prayer, and none on a Friday's Dhuhr", () => {
    const s = widgetSnapshot(base);
    const asr = s.prayers[0];
    expect(asr.iqama).toBe(asr.at + 20 * 60_000);
    expect(s.prayers.find((p) => p.name === "Jumu'ah")?.iqama).toBeUndefined();
  });

  it("the dhikr open now and the steps, only when there are any", () => {
    const dhikr = { key: "dhuhr|2026-10-23|tasbih", name: "Tasbih", n: 2, of: 100 };
    expect(widgetSnapshot({ ...base, dhikr, steps: "6,200 steps" })).toMatchObject({ dhikr, steps: "6,200 steps" });
    const plain = widgetSnapshot({ ...base, dhikr: null, steps: "" });
    expect("dhikr" in plain || "steps" in plain).toBe(false);
  });

  it("says live surfaces are off only when the user turned them off", () => {
    expect(widgetSnapshot({ ...base, live: false }).live).toBe(false);
    expect("live" in widgetSnapshot({ ...base, live: true })).toBe(false);
    expect("live" in widgetSnapshot(base)).toBe(false);
  });
});

describe("links from the widget", () => {
  it("open a mode, a study or the modes list, and nothing that merely looks like one", () => {
    expect(linkTarget("awqat://go/modes")).toBe("modes");
    expect(linkTarget("awqat://go/mode:dhuhr")).toBe("mode:dhuhr");
    expect(linkTarget("awqat://go/mode:study:t-1")).toBe("mode:study:t-1");
    expect(linkTarget("awqat://go/mode:")).toBeNull();
    expect(linkTarget("awqat://go/mode:a/b")).toBeNull();
    expect(linkTarget("awqat://go/settings")).toBeNull();
  });

  it("are followed only to the screens the widget opens", () => {
    expect(linkTarget("awqat://go/faith")).toBe("faith");
    expect(linkTarget("awqat://go/mushaf")).toBe("mushaf");
    expect(linkTarget("awqat://go/revise")).toBe("revise");
    expect(linkTarget("awqat://go/settings")).toBeNull();
    expect(linkTarget("awqat://go/faith?x=1")).toBeNull();
    expect(linkTarget("https://evil.example/go/faith")).toBeNull();
    expect(linkTarget("awqat://go/book:abc")).toBeNull();
  });
});
