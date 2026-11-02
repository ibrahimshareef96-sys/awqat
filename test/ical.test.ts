// A calendar file read into the week ahead: repeats, dates left out, moved and cancelled meetings, all-day events,
// other time zones, and files that are broken or far too busy.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OCCURRENCES_MAX, readCalendar, recentOnly, type Window } from "../src/agenda/ical.ts";
import { parseCalendar } from "../src/agenda/parse.ts";

const WEEK: Window = { firstDay: "2026-10-26", endDay: "2026-11-03", timeZone: "Asia/Dubai" };
const work = readFileSync(new URL("./fixtures/work.ics", import.meta.url), "utf8");

/** A calendar file around the given lines, with Dubai's zone. */
const ics = (...lines: string[]): string => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN",
  "BEGIN:VTIMEZONE", "TZID:Asia/Dubai", "BEGIN:STANDARD", "TZOFFSETFROM:+0400", "TZOFFSETTO:+0400", "TZNAME:+04",
  "DTSTART:19700101T000000", "END:STANDARD", "END:VTIMEZONE", ...lines, "END:VCALENDAR"].join("\r\n");

const event = (uid: string, ...lines: string[]): string[] =>
  ["BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20261020T000000Z", ...lines, "END:VEVENT"];

/** "26 06:00 Gym": the day of the month and the time in Dubai, so a list of events reads at a glance. */
const brief = (e: { start: number; allDay: boolean; title: string }): string => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(e.start));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("day")} ${e.allDay ? "all day" : `${get("hour")}:${get("minute")}`} ${e.title}`;
};

describe("reading a calendar file", () => {
  it("gives the week's meetings in order: repeats, a date left out, one moved, one cancelled, another zone", () => {
    const read = readCalendar(work, WEEK);
    expect(read?.name).toBe("Work");
    expect(read?.truncated).toBe(false);
    expect(read?.events.map(brief)).toEqual([
      "26 06:00 Gym",
      "26 09:30 Team standup",
      // 09:00 in London, the day after its clocks went back: 13:00 in Dubai.
      "26 13:00 London sync",
      "27 06:00 Gym",
      "27 12:00 Client call",
      "28 06:00 Gym",
      "29 all day Offsite",
      "30 11:00 Team standup (moved)",
      "02 09:30 Team standup",
    ]);
  });

  it("keeps an all-day event's days and a meeting's place", () => {
    const read = readCalendar(work, WEEK);
    const offsite = read?.events.find((e) => e.title === "Offsite");
    expect(offsite).toMatchObject({ allDay: true, start: Date.UTC(2026, 9, 28, 20), end: Date.UTC(2026, 9, 30, 20) });
    expect(read?.events.find((e) => e.title === "Client call")?.location).toBe("Video call");
  });

  it("reaches today from a series begun long ago", () => {
    const read = readCalendar(ics(...event("old-daily", "SUMMARY:Walk", "DTSTART;TZID=Asia/Dubai:20000101T070000",
      "DTEND;TZID=Asia/Dubai:20000101T073000", "RRULE:FREQ=DAILY")), WEEK);
    expect(read?.events).toHaveLength(8);
    expect(brief(read!.events[0])).toBe("26 07:00 Walk");
  });

  it("counts a meeting that began before the window and runs into it", () => {
    const read = readCalendar(ics(...event("long", "SUMMARY:Retreat", "DTSTART:20261025T080000Z",
      "DTEND:20261026T080000Z")), WEEK);
    expect(read?.events.map((e) => e.title)).toEqual(["Retreat"]);
  });

  it("makes an all-day event with no end one day long", () => {
    const read = readCalendar(ics(...event("d", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261101")), WEEK);
    expect(read?.events[0]).toMatchObject({ allDay: true, start: Date.UTC(2026, 9, 31, 20), end: Date.UTC(2026, 10, 1, 20) });
  });

  it("names an untitled event, and cleans titles and places to one line", () => {
    const read = readCalendar(ics(...event("a", "DTSTART:20261026T100000Z", "DTEND:20261026T110000Z"),
      ...event("b", "SUMMARY:Plan\\nreview \u0007 now", "LOCATION:Room\\n4", "DTSTART:20261026T120000Z",
        "DTEND:20261026T130000Z")), WEEK);
    expect(read?.events.map((e) => [e.title, e.location])).toEqual([["Untitled", ""], ["Plan review now", "Room 4"]]);
  });

  it("keeps a moved meeting whose series is not in the file", () => {
    const read = readCalendar(ics(...event("lone", "RECURRENCE-ID:20261027T090000Z", "SUMMARY:Moved alone",
      "DTSTART:20261027T100000Z", "DTEND:20261027T110000Z")), WEEK);
    expect(read?.events.map((e) => e.title)).toEqual(["Moved alone"]);
  });

  it("does not tie one series' moved meeting to another series", () => {
    const read = readCalendar(ics(
      ...event("a", "SUMMARY:A", "DTSTART:20261026T050000Z", "DTEND:20261026T060000Z", "RRULE:FREQ=DAILY;COUNT=2"),
      ...event("b", "SUMMARY:B", "DTSTART:20261026T050000Z", "DTEND:20261026T060000Z", "RRULE:FREQ=DAILY;COUNT=2"),
      ...event("b", "RECURRENCE-ID:20261027T050000Z", "SUMMARY:B moved", "DTSTART:20261027T090000Z",
        "DTEND:20261027T100000Z")), WEEK);
    expect(read?.events.map(brief)).toEqual(["26 09:00 A", "26 09:00 B", "27 09:00 A", "27 13:00 B moved"]);
  });

  it("drops a cancelled occurrence of a series", () => {
    const read = readCalendar(ics(
      ...event("s", "SUMMARY:Sync", "DTSTART:20261026T050000Z", "DTEND:20261026T060000Z", "RRULE:FREQ=DAILY;COUNT=3"),
      ...event("s", "RECURRENCE-ID:20261027T050000Z", "SUMMARY:Sync", "STATUS:CANCELLED", "DTSTART:20261027T050000Z",
        "DTEND:20261027T060000Z")), WEEK);
    expect(read?.events.map(brief)).toEqual(["26 09:00 Sync", "28 09:00 Sync"]);
  });

  it("leaves out rules that repeat every minute, and keeps at most 300 occurrences", () => {
    const minutely = readCalendar(ics(...event("m", "SUMMARY:Tick", "DTSTART:20261026T050000Z",
      "RRULE:FREQ=MINUTELY")), WEEK);
    expect(minutely?.events).toEqual([]);
    // Two series on the hour: 188 each in the week, 376 in all.
    const busy = readCalendar(ics(
      ...event("h1", "SUMMARY:Hourly", "DTSTART:20261026T000000Z", "DTEND:20261026T003000Z", "RRULE:FREQ=HOURLY"),
      ...event("h2", "SUMMARY:Also hourly", "DTSTART:20261026T000000Z", "DTEND:20261026T003000Z", "RRULE:FREQ=HOURLY")),
    WEEK);
    expect(busy?.events).toHaveLength(OCCURRENCES_MAX);
    expect(busy?.truncated).toBe(true);
  });

  it("says a broken file or something else is not a calendar", () => {
    expect(readCalendar("<html>Sign in</html>", WEEK)).toBeNull();
    expect(readCalendar("BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD", WEEK)).toBeNull();
    expect(readCalendar("", WEEK)).toBeNull();
  });

  it("gives an empty week, with no name, for a calendar with nothing in it", () => {
    expect(readCalendar(ics(), WEEK)).toEqual({ name: "", events: [], truncated: false });
  });

  it("reads a zone the file names but does not define in that zone, and an unknown one in the place's", () => {
    const bare = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");
    const london = readCalendar(bare(...event("l", "SUMMARY:London", "DTSTART;TZID=Europe/London:20261027T090000",
      "DTEND;TZID=Europe/London:20261027T093000")), WEEK);
    expect(london?.events.map(brief)).toEqual(["27 13:00 London"]);
    const windows = readCalendar(bare(...event("w", "SUMMARY:Windows zone",
      "DTSTART;TZID=Arabian Standard Time:20261027T090000", "DTEND;TZID=Arabian Standard Time:20261027T100000")), WEEK);
    expect(windows?.events.map(brief)).toEqual(["27 09:00 Windows zone"]);
    const floating = readCalendar(bare(...event("f", "SUMMARY:Floating", "DTSTART:20261027T070000",
      "DTEND:20261027T080000")), WEEK);
    expect(floating?.events.map(brief)).toEqual(["27 07:00 Floating"]);
    // A series in a named zone with no definition repeats in that zone too.
    const series = readCalendar(bare(...event("s", "SUMMARY:Weekly", "DTSTART;TZID=Europe/London:20261012T090000",
      "DTEND;TZID=Europe/London:20261012T100000", "RRULE:FREQ=WEEKLY")), WEEK);
    expect(series?.events.map(brief)).toEqual(["26 13:00 Weekly", "02 13:00 Weekly"]);
  });

  it("finds a moved meeting written in UTC for a series in a named zone, moved from long before the week", () => {
    const read = readCalendar(ics(
      ...event("m", "SUMMARY:Monthly", "DTSTART;TZID=Asia/Dubai:20260801T090000", "DTEND;TZID=Asia/Dubai:20260801T100000",
        "RRULE:FREQ=MONTHLY;COUNT=2"),
      ...event("m", "RECURRENCE-ID:20260801T050000Z", "SUMMARY:Monthly (moved)", "DTSTART:20261028T050000Z",
        "DTEND:20261028T060000Z")), WEEK);
    expect(read?.events.map(brief)).toEqual(["28 09:00 Monthly (moved)"]);
  });

  it("finds a meeting brought forward to this week from months after it", () => {
    const read = readCalendar(ics(
      ...event("w", "SUMMARY:Weekly", "DTSTART:20260105T050000Z", "DTEND:20260105T060000Z", "RRULE:FREQ=WEEKLY"),
      ...event("w", "RECURRENCE-ID:20261221T050000Z", "SUMMARY:Weekly (brought forward)", "DTSTART:20261028T050000Z",
        "DTEND:20261028T060000Z")), WEEK);
    expect(read?.events.map(brief)).toEqual(["26 09:00 Weekly", "28 09:00 Weekly (brought forward)", "02 09:00 Weekly"]);
  });

  it("reads a meeting's end in the zone its end names", () => {
    const bare = ["BEGIN:VCALENDAR", "VERSION:2.0", ...event("z", "SUMMARY:Flight",
      "DTSTART;TZID=Europe/London:20261027T090000", "DTEND;TZID=Asia/Dubai:20261027T200000"), "END:VCALENDAR"].join("\r\n");
    const flight = readCalendar(bare, WEEK)?.events[0];
    expect(flight).toMatchObject({ start: Date.UTC(2026, 9, 27, 9), end: Date.UTC(2026, 9, 27, 16) });
  });

  it("keeps old events that last a stated time or move a series, and survives one enormous event", () => {
    const text = ics(
      ...event("long", "SUMMARY:Long contract", "DTSTART;VALUE=DATE:20260301", "DURATION:P300D"),
      ...event("s", "RECURRENCE-ID;RANGE=THISANDFUTURE:20200105T100000Z", "SUMMARY:Moved forever",
        "DTSTART:20200105T110000Z", "DTEND:20200105T120000Z"));
    const kept = recentOnly(text, "2026-10-26");
    expect(kept).toContain("Long contract");
    expect(kept).toContain("Moved forever");
    expect(readCalendar(kept, WEEK)?.events.map((e) => e.title)).toContain("Long contract");
    const huge = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", ...Array(300000).fill("X-PAD:x"), "END:VEVENT", "END:VCALENDAR"]
      .join("\r\n");
    expect(() => recentOnly(huge, "2026-10-26")).not.toThrow();
  });

  it("reads a file that begins with a byte-order mark", () => {
    const withMark = String.fromCharCode(0xfeff) + ics(...event("b", "SUMMARY:Marked", "DTSTART:20261026T100000Z",
      "DTEND:20261026T110000Z"));
    expect(readCalendar(withMark, WEEK)?.events.map((e) => e.title)).toEqual(["Marked"]);
  });

  it("stops a read that runs out of time, and says not everything was kept", () => {
    const read = readCalendar(ics(...event("d", "SUMMARY:Daily", "DTSTART:20000101T050000Z", "DTEND:20000101T060000Z",
      "RRULE:FREQ=DAILY")), WEEK, -1);
    expect(read?.truncated).toBe(true);
  });

  it("leaves out a rule that repeats only every few million periods, at once", () => {
    const started = Date.now();
    const read = readCalendar(ics(...event("i", "SUMMARY:Never", "DTSTART:20261026T050000Z", "DTEND:20261026T060000Z",
      "RRULE:FREQ=WEEKLY;INTERVAL=50000000"), ...event("ok", "SUMMARY:Kept", "DTSTART:20261026T050000Z",
      "DTEND:20261026T060000Z")), WEEK);
    expect(read?.events.map((e) => e.title)).toEqual(["Kept"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("takes old one-off events out before parsing, and keeps repeating and recent ones", () => {
    const text = ics(
      ...event("old", "SUMMARY:Old", "DTSTART:20200101T100000Z", "DTEND:20200101T110000Z"),
      ...event("series", "SUMMARY:Series", "DTSTART:20200101T100000Z", "DTEND:20200101T110000Z", "RRULE:FREQ=YEARLY"),
      ...event("recent", "SUMMARY:Recent", "DTSTART:20261020T100000Z", "DTEND:20261020T110000Z"),
      ...event("folded", "SUMMARY:Folded", "DTSTART;TZID=Asia/Dubai:", " 20261027T100000", "DTEND:20261027T060000Z"));
    const kept = recentOnly(text, "2026-10-26");
    expect(kept).not.toContain("SUMMARY:Old");
    expect(kept).toContain("SUMMARY:Series");
    expect(kept).toContain("SUMMARY:Recent");
    expect(kept).toContain("SUMMARY:Folded");
    expect(kept).toContain("BEGIN:VTIMEZONE");
  });

  it("reads a file with no worker to hand, as in tests, and gives the same week", async () => {
    expect((await parseCalendar(work, WEEK))).toMatchObject({ name: "Work", truncated: false });
  });

  it("keeps no zone from one file for the next", () => {
    const london = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VTIMEZONE", "TZID:Office", "BEGIN:STANDARD",
      "TZOFFSETFROM:+0000", "TZOFFSETTO:+0000", "DTSTART:19700101T000000", "END:STANDARD", "END:VTIMEZONE",
      ...event("z", "SUMMARY:First", "DTSTART;TZID=Office:20261026T090000", "DTEND;TZID=Office:20261026T100000"),
      "END:VCALENDAR"].join("\r\n");
    expect(readCalendar(london, WEEK)?.events.map(brief)).toEqual(["26 13:00 First"]);
    expect(readCalendar(ics(), WEEK)?.events).toEqual([]);
  });
});
