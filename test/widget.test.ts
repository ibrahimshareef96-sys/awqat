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
import { emptyQuranLog, logRead, logRevision, setDailyGoal, setPosition } from "../src/quran/log.ts";
import { makePlan } from "../src/quran/murajaah.ts";
import { adhkarFor, emptyAdhkarLog, islamicMidnight, setDone } from "../src/faith/adhkar.ts";
import { adhkarScreen, linkTarget, syncWidget, widgetSnapshot } from "../src/app/widget.ts";
import { prayerDays, readLine } from "../src/app/widgetDays.ts";

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
      { date: "2026-10-23", quran: "Page 313 of 604", revise: "Revision done today", read: "0 pages today" },
      { date: "2026-10-24", quran: "Page 313 of 604", revise: "Revise Juz 2", read: "0 pages today" },
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
    expect(plain.days[0]).toEqual({ date: "2026-10-23", quran: "Page 1 of 604", revise: "", read: "0 pages today" });
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
    days: [{ date: "2026-10-23", quran: "Page 1 of 604", revise, read: "0 pages today" }] });

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

  it("open Talk, the adhkar and Agenda for the new widgets, shortcuts and Siri, and nothing near them", () => {
    expect(linkTarget("awqat://go/talk")).toBe("talk");
    expect(linkTarget("awqat://go/adhkar")).toBe("adhkar");
    expect(linkTarget("awqat://go/agenda")).toBe("agenda");
    for (const near of ["awqat://go/talk:start", "awqat://go/adhkar:morning", "awqat://go/agenda?day=1", "awqat://go/talk/",
      "awqat://go/Talk", "awqat://talk", "awqat://go/talk\n", "awqat://go/add-book", "awqat://go/close", "awqat://go/money"]) {
      expect(linkTarget(near)).toBeNull();
    }
  });
});

describe("the adhkar a link opens", () => {
  const at = (iso: string) => new Date(iso);
  // Dubai is UTC+4. Friday 23 Oct 2026: Fajr 05:04, Jumu'ah 12:06, Asr 15:22.
  it("is the set open now", () => {
    expect(adhkarScreen(days, at("2026-10-23T02:00:00Z"))).toBe("adhkar:morning");
    expect(adhkarScreen(days, at("2026-10-23T13:00:00Z"))).toBe("adhkar:evening");
  });

  it("or the one that opens next: the evening after Dhuhr, the morning after the middle of the night", () => {
    expect(adhkarScreen(days, NOW)).toBe("adhkar:evening");
    expect(adhkarScreen(days, at("2026-10-23T21:30:00Z"))).toBe("adhkar:morning");
    expect(adhkarScreen([], NOW)).toBe("adhkar:morning");
  });
});

describe("the widgets' days", () => {
  const base = { days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran: emptyQuranLog(), page: 1, plan: null };

  it("gives each prayer day left its five prayers, the iqama after each but Jumu'ah, and its Hijri date", () => {
    const s = widgetSnapshot(base);
    const today = s.prayerDays?.[0];
    expect(today?.date).toBe("2026-10-23");
    expect(today?.prayers.map((p) => p.name)).toEqual(["Fajr", "Jumu'ah", "Asr", "Maghrib", "Isha"]);
    // Past prayers stay on today's list, so the widget can mark the one under way.
    expect(today?.prayers[0]).toMatchObject({ time: "05:04" });
    expect(today?.prayers[2]).toMatchObject({ name: "Asr", time: "15:22", iqamaTime: "15:42" });
    expect(today?.prayers[2].iqama).toBe((today?.prayers[2].at ?? 0) + 20 * 60_000);
    expect(today?.prayers[1].iqama).toBeUndefined();
    expect(today?.prayers[1].iqamaTime).toBeUndefined();
    // A day after the Faith screen's own test date (22 Oct, 11 Jumada al-Ula), read for the day itself in any zone.
    expect(today?.hijri).toEqual({ text: "12 Jumada al-Ula 1448", day: 12, month: "Jumada al-Ula" });
    expect(s.prayerDays?.length).toBeLessThanOrEqual(12);
  });

  it("says when each prayer's time is over: Fajr at sunrise, Isha at the next Fajr, each other at the next adhan", () => {
    const s = widgetSnapshot(base);
    const [day, next] = [days.find((d) => d.date === "2026-10-23"), days.find((d) => d.date === "2026-10-24")];
    const today = s.prayerDays?.[0].prayers ?? [];
    expect(today.map((p) => p.until)).toEqual([day?.sunrise.getTime(), day?.asr.getTime(), day?.maghrib.getTime(),
      day?.isha.getTime(), next?.fajr.getTime()]);
    // The last day in the list has no next Fajr: its Isha has no end the widget could be told.
    expect(s.prayerDays?.at(-1)?.prayers.at(-1)?.until).toBeUndefined();
  });

  it("writes the days out once while the day under way stays the same, and again when it moves on", () => {
    const once = prayerDays(days, NOW, "Asia/Dubai");
    expect(prayerDays(days, new Date(NOW.getTime() + 60_000), "Asia/Dubai")).toBe(once);
    expect(prayerDays(days, NOW, "UTC")).not.toBe(once);
    expect(prayerDays([...days], NOW, "Asia/Dubai")).toEqual(once);
    expect(prayerDays(days, new Date("2026-10-24T02:00:00Z"), "Asia/Dubai")[0].date).toBe("2026-10-24");
  });

  it("keeps yesterday's prayer day until Fajr, so Isha after midnight is still marked", () => {
    const early = widgetSnapshot({ ...base, now: new Date("2026-10-23T00:30:00Z") });
    expect(early.prayerDays?.[0].date).toBe("2026-10-22");
    expect(early.prayerDays?.[1].date).toBe("2026-10-23");
  });

  it("says when each adhkar set is open and whether it is said in full", () => {
    const morningSaid = adhkarFor("morning").reduce((log, item) => setDone(log, "2026-10-23", "morning", item.id, true),
      emptyAdhkarLog());
    const s = widgetSnapshot({ ...base, adhkar: morningSaid });
    const today = s.adhkar?.[0];
    const day = days.find((d) => d.date === "2026-10-23");
    const next = days.find((d) => d.date === "2026-10-24");
    expect(today?.date).toBe("2026-10-23");
    expect(today?.morning).toEqual({ from: day?.fajr.getTime(), to: day?.dhuhr.getTime(), said: true });
    expect(today?.evening.from).toBe(day?.asr.getTime());
    expect(today?.evening.to).toBe(day && next ? islamicMidnight(day, next).getTime() : 0);
    expect(today?.evening.said).toBe(false);
    // The last day has no next Fajr to end its evening: it is left out.
    expect(s.adhkar?.some((a) => a.date === "2026-11-01")).toBe(false);
    expect("adhkar" in widgetSnapshot(base)).toBe(false);
  });

  it("gives today's reading against the daily goal, or the pages alone without one", () => {
    const read = logRead(setPosition(emptyQuranLog(), 10), "2026-10-23", 13);
    expect(widgetSnapshot({ ...base, quran: read }).days.map((d) => d.read)).toEqual(["3 pages today", "0 pages today"]);
    expect(widgetSnapshot({ ...base, quran: setDailyGoal(read, 5) }).days[0].read).toBe("3 of 5 pages today");
    expect(readLine(logRead(emptyQuranLog(), "2026-10-23", 1), "2026-10-23")).toBe("1 page today");
    // A goal of one page reads as one page.
    expect(readLine(setDailyGoal(emptyQuranLog(), 1), "2026-10-23")).toBe("0 of 1 page today");
  });
});

describe("the meetings the agenda widget is given", () => {
  const base = { days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran: emptyQuranLog(), page: 1, plan: null };
  const meeting = (iso: string, minutes: number, title: string, allDay = false) => {
    const start = Date.parse(iso);
    return { start, end: start + minutes * 60_000, allDay, title };
  };
  const events = [
    meeting("2026-10-25T05:00:00Z", 30, "Three days out"),
    meeting("2026-10-24T05:00:00Z", 60, "Tomorrow at nine"),
    meeting("2026-10-23T11:00:00Z", 60, "Study circle"),
    meeting("2026-10-23T06:00:00Z", 30, "Over already"),
    meeting("2026-10-23T09:30:00Z", 60, "Under way now"),
    meeting("2026-10-23T00:00:00Z", 1440, "A whole day", true),
  ];

  it("lists today's and tomorrow's still to end, soonest first, with the prayers around each", () => {
    const s = widgetSnapshot({ ...base, agenda: { calendar: true, events } });
    expect(s.calendar).toBe(true);
    expect(s.meetings?.map((m) => m.title)).toEqual(["Under way now", "Study circle", "Tomorrow at nine"]);
    expect(s.meetings?.[1]).toMatchObject({ date: "2026-10-23", time: "15:00", before: "Jumu'ah 12:06", after: "Asr 15:22" });
    expect(s.meetings?.[2]).toMatchObject({ date: "2026-10-24", time: "09:00", before: "Fajr 05:04", after: "Dhuhr 12:06" });
  });

  it("cleans and cuts what a calendar sent, and keeps at most eight", () => {
    const many = Array.from({ length: 12 }, (_, i) => meeting(`2026-10-23T1${i % 10}:00:00Z`, 30 + i, `M${i}`));
    expect(widgetSnapshot({ ...base, agenda: { calendar: true, events: many } }).meetings).toHaveLength(8);
    // A right-to-left override (built from its code point: typed as an escape it could turn into the character itself).
    const override = String.fromCodePoint(0x202e);
    const odd = [meeting("2026-10-23T12:00:00Z", 30, `${override}Line one\nline two${"x".repeat(100)}`), meeting("2026-10-23T13:00:00Z", 30, " ")];
    const [first, second] = widgetSnapshot({ ...base, agenda: { calendar: true, events: odd } }).meetings ?? [];
    expect(first.title.startsWith("Line one line two")).toBe(true);
    expect(Array.from(first.title).length).toBeLessThanOrEqual(60);
    expect(second.title).toBe("Untitled");
  });

  it("says when no calendar is connected, and sends no agenda when none was given", () => {
    expect(widgetSnapshot({ ...base, agenda: { calendar: false, events: [] } })).toMatchObject({ calendar: false, meetings: [] });
    expect("meetings" in widgetSnapshot(base) || "calendar" in widgetSnapshot(base)).toBe(false);
  });
});

describe("a place the app only guessed", () => {
  const guessed = widgetSnapshot({ days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran: emptyQuranLog(), page: 5,
    plan: null, placeSet: false, adhkar: emptyAdhkarLog(), dhikr: { key: "dhuhr|2026-10-23|tasbih", name: "Tasbih", n: 1, of: 100 },
    agenda: { calendar: true, events: [{ start: Date.parse("2026-10-23T11:00:00Z"), end: Date.parse("2026-10-23T12:00:00Z"), allDay: false, title: "Circle" }] } });

  it("gives the widgets no prayer, no adhkar and no dhikr, and says the place is not set", () => {
    expect(guessed.place).toBe("unset");
    expect(guessed.prayers).toEqual([]);
    expect("prayerDays" in guessed || "adhkar" in guessed || "dhikr" in guessed).toBe(false);
  });

  it("keeps what does not come from the prayer times: the Quran lines and the meetings, without prayers around them", () => {
    expect(guessed.days[0]).toMatchObject({ quran: "Page 5 of 604", read: "0 pages today" });
    expect(guessed.meetings).toEqual([{ title: "Circle", date: "2026-10-23", time: "15:00", start: Date.parse("2026-10-23T11:00:00Z"),
      end: Date.parse("2026-10-23T12:00:00Z") }]);
  });

  it("never marks a place that is set", () => {
    expect("place" in widgetSnapshot({ days, now: NOW, tz: "Asia/Dubai", today: "2026-10-23", quran: emptyQuranLog(), page: 1,
      plan: null, placeSet: true })).toBe(false);
  });
});
