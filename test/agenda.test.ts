// The kept agenda: a good read replaces a calendar's week, a failed one keeps the last good week, a new week drops the
// old days, and a day is laid out with its prayers between the meetings.
import { describe, expect, it } from "vitest";
import {
  emptyAgenda, checkAgenda, eventsOn, needsRead, nextUp, timeline, updatedAt, withRead, withoutCalendar, FRESH_MS,
  type Agenda,
} from "../src/agenda/agenda.ts";
import type { Occurrence } from "../src/agenda/occurrence.ts";
import { dayTimes, formatTime } from "../src/prayer/times.ts";
import { DUBAI } from "./fixtures/places.ts";
import type { Row } from "../src/agenda/agenda.ts";

/** A row as a word: the prayer's name, the meeting's title, or "due:" and what is due. */
const rowName = (r: Row): string => (r.kind === "prayer" ? r.name : r.kind === "due" ? `due:${r.item.text}` : r.event.title);

const TZ = "Asia/Dubai";
const MON = "2026-10-26";
/** An instant on a day of that week, Dubai time. */
const at = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h - 4, m);
const meeting = (title: string, start: number, end: number, extra: Partial<Occurrence> = {}): Occurrence =>
  ({ start, end, allDay: false, title, location: "", ...extra });
const read = (events: Occurrence[]) => ({ events, truncated: false });
const NOW = at(26, 8);

describe("the kept agenda", () => {
  it("takes a calendar's week, and keeps another calendar's alongside", () => {
    let agenda = withRead(emptyAgenda(), "a", read([meeting("Standup", at(26, 9, 30), at(26, 10))]), MON, TZ, NOW);
    agenda = withRead(agenda, "b", read([meeting("Lunch", at(26, 13), at(26, 14))]), MON, TZ, NOW + 1);
    expect(agenda.events.map((e) => [e.cal, e.title])).toEqual([["a", "Standup"], ["b", "Lunch"]]);
    expect(agenda.firstDay).toBe(MON);
    expect(agenda.endDay).toBe("2026-11-03");
    expect(agenda.reads).toEqual([
      { cal: "a", at: NOW, ok: NOW, problem: null, truncated: false, tz: TZ },
      { cal: "b", at: NOW + 1, ok: NOW + 1, problem: null, truncated: false, tz: TZ },
    ]);
  });

  it("replaces a calendar's week on a good read, and keeps it on a failed one", () => {
    let agenda = withRead(emptyAgenda(), "a", read([meeting("Old", at(26, 9), at(26, 10))]), MON, TZ, NOW);
    agenda = withRead(agenda, "a", read([meeting("New", at(26, 11), at(26, 12))]), MON, TZ, NOW + 5);
    expect(agenda.events.map((e) => e.title)).toEqual(["New"]);
    agenda = withRead(agenda, "a", { problem: "offline" }, MON, TZ, NOW + 9);
    expect(agenda.events.map((e) => e.title)).toEqual(["New"]);
    expect(agenda.reads[0]).toEqual({ cal: "a", at: NOW + 9, ok: NOW + 5, problem: "offline", truncated: false, tz: TZ });
  });

  it("drops the days before a new week, even on a failed read", () => {
    let agenda = withRead(emptyAgenda(), "a", read([meeting("Monday", at(26, 9), at(26, 10)),
      meeting("Tuesday", at(27, 9), at(27, 10))]), MON, TZ, NOW);
    agenda = withRead(agenda, "a", { problem: "offline" }, "2026-10-27", TZ, NOW + 86400000);
    expect(agenda.events.map((e) => e.title)).toEqual(["Tuesday"]);
    expect(agenda.firstDay).toBe("2026-10-27");
  });

  it("lets a removed calendar's events and read go", () => {
    let agenda = withRead(emptyAgenda(), "a", read([meeting("A", at(26, 9), at(26, 10))]), MON, TZ, NOW);
    agenda = withRead(agenda, "b", read([meeting("B", at(26, 9), at(26, 10))]), MON, TZ, NOW);
    expect(withoutCalendar(agenda, "a")).toMatchObject({ events: [{ title: "B" }], reads: [{ cal: "b" }] });
  });

  it("reads the kept copy back, keeping only listed calendars, and starts again from a broken one", () => {
    const agenda = withRead(emptyAgenda(), "a", read([meeting("A", at(26, 9), at(26, 10))]), MON, TZ, NOW);
    const json = JSON.stringify(agenda);
    expect(checkAgenda(json, ["a"])).toEqual(agenda);
    expect(checkAgenda(json, ["b"]).events).toEqual([]);
    expect(checkAgenda("{oops", ["a"])).toEqual(emptyAgenda());
    expect(checkAgenda(null, ["a"])).toEqual(emptyAgenda());
    const bad = { ...agenda, events: [{ ...agenda.events[0], end: 0 }, { ...agenda.events[0], title: "x".repeat(300) },
      { ...agenda.events[0], start: "soon" }] };
    expect(checkAgenda(JSON.stringify(bad), ["a"]).events).toEqual([]);
    expect(checkAgenda(JSON.stringify({ ...agenda, firstDay: "Monday" }), ["a"])).toEqual(emptyAgenda());
  });

  it("drops times no date can hold, and events far from the week they were read for", () => {
    const agenda = withRead(emptyAgenda(), "a", read([meeting("A", at(26, 9), at(26, 10))]), MON, TZ, NOW);
    const tampered = { ...agenda, events: [...agenda.events, { ...agenda.events[0], start: 1e300, end: 1e300 },
      { ...agenda.events[0], title: "Far", start: at(26, 9) + 400 * 86400000, end: at(26, 10) + 400 * 86400000 }],
      reads: [{ ...agenda.reads[0], at: 1e300 }] };
    const back = checkAgenda(JSON.stringify(tampered), ["a"]);
    expect(back.events.map((e) => e.title)).toEqual(["A"]);
    expect(back.reads).toEqual([]);
  });

  it("asks for a read when a calendar was never read, the copy is old, or the week has moved on", () => {
    const agenda = withRead(emptyAgenda(), "a", read([]), MON, TZ, NOW);
    expect(needsRead(agenda, [], MON, NOW, TZ)).toBe(false);
    expect(needsRead(agenda, ["a"], MON, NOW + 60000, TZ)).toBe(false);
    expect(needsRead(agenda, ["a"], MON, NOW + FRESH_MS, TZ)).toBe(false);
    expect(needsRead(agenda, ["a"], MON, NOW + FRESH_MS + 1, TZ)).toBe(true);
    expect(needsRead(agenda, ["a", "b"], MON, NOW, TZ)).toBe(true);
    expect(needsRead(agenda, ["a"], "2026-10-27", NOW, TZ)).toBe(true);
    // A clock set back past the last read.
    expect(needsRead(agenda, ["a"], MON, NOW - 1, TZ)).toBe(true);
  });

  it("reads again at once when the place's time zone has changed, however fresh the copy", () => {
    // All-day events begin at midnight in the zone they were read in: read in Dubai and shown on London's days, a one-day
    // holiday would stand on two days until the next read.
    const holiday = { start: at(27, 0), end: at(28, 0), allDay: true, title: "Holiday", location: "" };
    const agenda = withRead(emptyAgenda(), "a", read([holiday]), MON, TZ, NOW);
    expect(agenda.reads[0].tz).toBe(TZ);
    expect(needsRead(agenda, ["a"], MON, NOW + 60000, "Europe/London")).toBe(true);
    const again = withRead(agenda, "a", read([{ ...holiday, start: Date.UTC(2026, 9, 27), end: Date.UTC(2026, 9, 28) }]), MON,
      "Europe/London", NOW + 60000);
    expect(again.reads[0].tz).toBe("Europe/London");
    expect(needsRead(again, ["a"], MON, NOW + 120000, "Europe/London")).toBe(false);
    expect(eventsOn(again, "2026-10-26", "Europe/London")).toEqual([]);
    expect(eventsOn(again, "2026-10-27", "Europe/London").map((e) => e.title)).toEqual(["Holiday"]);
  });

  it("lets a calendar's all-day events go when its read fails in a new zone, and keeps its meetings", () => {
    const holiday = { start: at(27, 0), end: at(28, 0), allDay: true, title: "Holiday", location: "" };
    let agenda = withRead(emptyAgenda(), "a", read([holiday, meeting("Call", at(27, 9), at(27, 10))]), MON, TZ, NOW);
    agenda = withRead(agenda, "b", read([{ ...holiday, title: "Other" }]), MON, TZ, NOW);
    const failed = withRead(agenda, "a", { problem: "offline" }, MON, "Europe/London", NOW + 60000);
    expect(failed.events.map((e) => e.title).sort()).toEqual(["Call", "Other"]);
    // Calendar b has not been read in London yet: the next open reads it, however fresh its copy.
    expect(needsRead(failed, ["a", "b"], MON, NOW + 120000, "Europe/London")).toBe(true);
    // A failure in the same zone keeps everything, all-day events too.
    expect(withRead(agenda, "a", { problem: "offline" }, MON, TZ, NOW + 60000).events).toHaveLength(3);
  });

  it("reads a copy kept before it knew its time zone again, and keeps the zone each calendar was read in", () => {
    const agenda = withRead(emptyAgenda(), "a", read([]), MON, TZ, NOW);
    const old = { ...agenda, reads: agenda.reads.map(({ cal, at: when, ok, problem, truncated }) =>
      ({ cal, at: when, ok, problem, truncated })) };
    const back = checkAgenda(JSON.stringify(old), ["a"]);
    expect(back.reads[0].tz).toBe("");
    expect(needsRead(back, ["a"], MON, NOW, TZ)).toBe(true);
    const bad = { ...agenda, reads: agenda.reads.map((r) => ({ ...r, tz: "Not/AZone" })) };
    expect(checkAgenda(JSON.stringify(bad), ["a"]).reads[0].tz).toBe("");
    expect(checkAgenda(JSON.stringify(agenda), ["a"]).reads[0].tz).toBe(TZ);
  });

  it("says when every calendar last had a good copy", () => {
    let agenda: Agenda = withRead(emptyAgenda(), "a", read([]), MON, TZ, NOW);
    agenda = withRead(agenda, "b", read([]), MON, TZ, NOW + 10);
    expect(updatedAt(agenda, ["a", "b"])).toBe(NOW);
    expect(updatedAt(agenda, ["a", "c"])).toBe(0);
    expect(updatedAt(agenda, [])).toBe(0);
  });
});

describe("a day of the agenda", () => {
  const prayers = dayTimes(DUBAI, { y: 2026, m: 10, d: 26 }, "Dubai");
  const agenda = withRead(emptyAgenda(), "a", read([
    meeting("Standup", at(26, 9, 30), at(26, 10)),
    meeting("Overnight", at(25, 22), at(26, 7)),
    { start: at(26, 0), end: at(28, 0), allDay: true, title: "Offsite", location: "" },
    meeting("Lunch", prayers.dhuhr.getTime(), prayers.dhuhr.getTime() + 3600000),
    meeting("Tuesday", at(27, 9), at(27, 10)),
  ]), MON, TZ, NOW);

  it("holds what touches the day: all-day first, one carried over from the night before", () => {
    expect(eventsOn(agenda, MON, TZ).map((e) => e.title)).toEqual(["Offsite", "Overnight", "Standup", "Lunch"]);
    expect(eventsOn(agenda, "2026-10-27", TZ).map((e) => e.title)).toEqual(["Offsite", "Tuesday"]);
  });

  it("lays the five prayers between the meetings, a prayer before a meeting at the same minute", () => {
    const rows = timeline(agenda, MON, prayers, TZ, at(26, 9, 45));
    expect(rows.map(rowName)).toEqual(
      ["Offsite", "Overnight", "fajr", "Standup", "dhuhr", "Lunch", "asr", "maghrib", "isha"]);
    const standup = rows.find((r) => r.kind === "event" && r.event.title === "Standup");
    expect(standup).toMatchObject({ now: true, past: false });
    expect(rows.find((r) => r.kind === "event" && r.event.title === "Overnight")).toMatchObject({ past: true, now: false });
    expect(rows.find((r) => r.kind === "prayer" && r.name === "fajr")).toMatchObject({ past: true });
    expect(rows.find((r) => r.kind === "prayer" && r.name === "asr")).toMatchObject({ past: false });
  });

  it("lays work due on its day, read only: with no time at the top, with one among the prayers and meetings", () => {
    const dhuhr = formatTime(prayers.dhuhr, TZ);
    const due = [
      { text: "Untimed", date: MON, time: "", late: false },
      { text: "At ten", date: MON, time: "10:00", late: false },
      { text: "At Dhuhr", date: MON, time: dhuhr, late: false },
      { text: "Before fajr", date: MON, time: "03:00", late: true },
      { text: "Tuesday's", date: "2026-10-27", time: "", late: false },
      { text: "No day", date: "", time: "09:00", late: false },
    ];
    const rows = timeline(agenda, MON, prayers, TZ, at(26, 9, 45), due);
    expect(rows.map(rowName)).toEqual(["due:Untimed", "Offsite", "Overnight", "due:Before fajr", "fajr", "Standup", "due:At ten",
      "dhuhr", "due:At Dhuhr", "Lunch", "asr", "maghrib", "isha"]);
    expect(rows.find((r) => r.kind === "due" && r.item.text === "Before fajr")).toMatchObject({ past: true, at: at(26, 3) });
    expect(rows.find((r) => r.kind === "due" && r.item.text === "Untimed")).toMatchObject({ past: false, at: null });
    expect(timeline(agenda, "2026-10-27", undefined, TZ, NOW, due).map(rowName)).toEqual(["due:Tuesday's", "Offsite", "Tuesday"]);
    expect(timeline(agenda, MON, prayers, TZ, NOW)).toEqual(timeline(agenda, MON, prayers, TZ, NOW, []));
  });

  it("shows a day without prayer times as its meetings alone", () => {
    expect(timeline(agenda, "2026-10-27", undefined, TZ, NOW).map((r) => r.kind)).toEqual(["event", "event"]);
  });

  it("names the meeting on now, else the next one, and never an all-day event", () => {
    expect(nextUp(agenda, at(26, 9, 40))).toMatchObject({ now: true, event: { title: "Standup" } });
    expect(nextUp(agenda, at(26, 8))).toMatchObject({ now: false, event: { title: "Standup" } });
    expect(nextUp(agenda, at(27, 11))).toBeNull();
  });
});
