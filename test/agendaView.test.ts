// @vitest-environment happy-dom
// Agenda's screens: the empty state with its steps and form, the week strip and a day with prayers and work due, the
// Settings card that never shows an address in full, and Home's next-meeting card or its quiet way in. Every title from
// a calendar or a feed is escaped.
import { describe, expect, it } from "vitest";
import { addCalendar, emptyCalendars, type Calendar } from "../src/agenda/calendars.ts";
import { emptyAgenda, withRead } from "../src/agenda/agenda.ts";
import { agendaView, calendarsCard, homeAgendaCard, type AgendaModel } from "../src/ui/agendaView.ts";
import { keep, restore } from "../src/ui/keep.ts";
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
    tz: TZ, now: at(26, 9, 45), reading: false, busy: false, removeArmed: null, due: [], ...extra };
}

/** The text a screen reads as, tags left out. */
const words = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the Agenda screen", () => {
  it("asks for a calendar when there is none, with the form and where to find the address", () => {
    const html = agendaView(model({ calendars: [] }), "<h1>Agenda</h1>", "", "");
    expect(html).toContain('data-form="calendar-add"');
    expect(html).toContain("Secret address in iCal format");
    expect(html).not.toContain("data-action=\"agenda-day\"");
  });

  it("shows numbered steps for finding the address, open, with the form after them", () => {
    const html = agendaView(model({ calendars: [] }), "", "", "");
    const text = words(html);
    expect(html).not.toContain("<details");
    expect(html.match(/<ol class="steps">/g)?.length).toBe(3);
    expect(html.indexOf('class="steps"')).toBeLessThan(html.indexOf('data-form="calendar-add"'));
    for (const step of ["calendar.google.com", "Settings for my calendars", "Integrate calendar", "Secret address in iCal format",
      "Desktop site", "Admin console", "External sharing options for primary calendars", "Share all information",
      "Public Calendar", "Publish a calendar", "ICS"]) {
      expect(text).toContain(step);
    }
    expect(text).toContain("works like a password");
    expect(text).toContain("kept on this");
    // En and em dashes, built from code points (typed escapes can turn into the characters they name), and "!".
    expect(html).not.toMatch(new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}!]`));
  });

  it("lays work due on its day as read-only rows, escaped, with its time when it has one", () => {
    const due = [{ text: "Send <b>the</b> draft", date: TODAY, time: "", late: false },
      { text: "Call back", date: TODAY, time: "11:00", late: false }, { text: "Tomorrow's", date: "2026-10-27", time: "", late: false }];
    const html = agendaView(model({ due }), "", "", "");
    expect(html).toContain("Send &lt;b&gt;the&lt;/b&gt; draft");
    expect(html).not.toContain("<b>the</b>");
    expect(html).not.toContain("Tomorrow's");
    expect(words(html)).toContain("DUE 11:00");
    expect(html.indexOf("Send &lt;b&gt;")).toBeLessThan(html.indexOf("Fajr"));
    expect(html.indexOf("Call back")).toBeGreaterThan(html.indexOf("Standup"));
    expect(html).toContain("2 due");
    // Read only: nothing in a due row can be tapped.
    const row = html.slice(html.indexOf("due-row"), html.indexOf("Call back"));
    expect(row).not.toContain("<button");
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

  it("keeps where to find the address folded, with the same steps", () => {
    const html = calendarsCard(model({ calendars: [] }));
    expect(html).toContain("<details");
    expect(words(html)).toContain("Integrate calendar");
  });

  it("keeps the help open across a redraw, as the app redraws a screen it is reading", () => {
    // A redraw replaces the screen's HTML; keep.ts opens again only the folded sections it can find by id. Without one,
    // the help snapped shut whenever the screen was drawn again (a reminder rescheduled, the app brought back).
    const root = document.createElement("div");
    root.innerHTML = calendarsCard(model({ calendars: [] }));
    const details = root.querySelector("details");
    expect(details?.id).toBeTruthy();
    details!.open = true;
    const kept = keep(root, null, "settings");
    root.innerHTML = calendarsCard(model({ calendars: [] }));
    restore(root, kept, "settings");
    expect(root.querySelector("details")?.open).toBe(true);
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
  });

  it("is one quiet line that opens Agenda while no calendar is connected", () => {
    const html = homeAgendaCard(model({ calendars: [] }));
    expect(html).toContain('data-go="agenda"');
    expect(html).toMatch(/^<button type="button"/);
    expect(words(html).trim()).toBe("AGENDA · Connect your calendar");
    expect(homeAgendaCard(model())).not.toContain("Connect your calendar");
  });
});
