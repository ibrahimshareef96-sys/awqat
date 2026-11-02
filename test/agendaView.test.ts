// Agenda's screens: the empty state with its form, the week strip and a day with prayers, the Settings card that never
// shows an address in full, and Home's next-meeting card. Every title from a calendar is escaped.
import { describe, expect, it } from "vitest";
import { addCalendar, emptyCalendars, type Calendar } from "../src/agenda/calendars.ts";
import { emptyAgenda, withRead } from "../src/agenda/agenda.ts";
import { agendaView, calendarsCard, homeAgendaCard, type AgendaModel } from "../src/ui/agendaView.ts";
import { dayTimes } from "../src/prayer/times.ts";
import { DUBAI } from "./fixtures/places.ts";

const TZ = "Asia/Dubai";
const TODAY = "2026-10-26";
const at = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h - 4, m);
const SECRET = "https://example.com/calendar/ical/me/private-0123456789secretx7Kq/basic.ics";

function calendar(): Calendar {
  const added = addCalendar(emptyCalendars(), SECRET, "cal-1", 1);
  if ("error" in added) throw new Error(added.error);
  return { ...added.calendar, name: "Work" };
}

function model(extra: Partial<AgendaModel> = {}): AgendaModel {
  const agenda = withRead(emptyAgenda(), "cal-1", { events: [
    { start: at(26, 9, 30), end: at(26, 10), allDay: false, title: "Standup <img src=x onerror=alert(1)>", location: "Room 4" },
    { start: at(27, 9), end: at(27, 10), allDay: false, title: "Tuesday call", location: "" },
  ], truncated: false }, TODAY, TZ, at(26, 8));
  return { calendars: [calendar()], agenda, day: TODAY, today: TODAY, days: [dayTimes(DUBAI, { y: 2026, m: 10, d: 26 }, "Dubai")],
    tz: TZ, now: at(26, 9, 45), reading: false, busy: false, removeArmed: null, ...extra };
}

describe("the Agenda screen", () => {
  it("asks for a calendar when there is none, with the form and where to find the address", () => {
    const html = agendaView(model({ calendars: [] }), "<h1>Agenda</h1>", "", "");
    expect(html).toContain('data-form="calendar-add"');
    expect(html).toContain("Secret address in iCal format");
    expect(html).not.toContain("data-action=\"agenda-day\"");
  });

  it("shows the week strip, today's meetings between the prayers, and escapes what a calendar says", () => {
    const html = agendaView(model(), "", "", "");
    expect(html.match(/data-action="agenda-day"/g)).toHaveLength(8);
    expect(html).toContain("Standup &lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("Fajr");
    expect(html).toContain("09:30 to 10:00");
    expect(html).toContain("Room 4");
    expect(html).toContain("event-row now");
    expect(html.indexOf("Fajr")).toBeLessThan(html.indexOf("Standup"));
    expect(html.indexOf("Standup")).toBeLessThan(html.indexOf("Dhuhr"));
  });

  it("shows another day when it is picked, and says when a calendar could not be read", () => {
    const m = model({ day: "2026-10-27" });
    m.agenda = withRead(m.agenda, "cal-1", { problem: "refused" }, TODAY, TZ, at(26, 11));
    const html = agendaView(m, "", "", "");
    expect(html).toContain("Tuesday call");
    expect(html).not.toContain("Standup");
    expect(html).toContain("Work refused the address");
    // The last good copy was read at 08:00; the refused read came later.
    expect(html).toContain("the copy from 08:00 is shown");
  });
});

describe("the calendars in Settings", () => {
  it("shows each by name and the end of its address, never the secret", () => {
    const html = calendarsCard(model());
    expect(html).toContain("Work");
    expect(html).toContain("example.com · ending Kq");
    expect(html).not.toContain("0123456789secret");
    expect(html).toContain(">Remove<");
    expect(calendarsCard(model({ removeArmed: "cal-1" }))).toContain("Tap again to remove");
  });
});

describe("Home's agenda card", () => {
  it("names the meeting on now, the next one with how long until it, or says the week is clear", () => {
    expect(homeAgendaCard(model())).toContain("NOW");
    const next = homeAgendaCard(model({ now: at(26, 8) }));
    expect(next).toContain("NEXT MEETING");
    expect(next).toContain("09:30 · in 1 h 30 min");
    expect(homeAgendaCard(model({ now: at(26, 12) }))).toContain("Tue 27 09:00");
    expect(homeAgendaCard(model({ now: at(28, 12) }))).toContain("Nothing more on your calendar this week");
    expect(homeAgendaCard(model({ calendars: [] }))).toBe("");
  });
});
