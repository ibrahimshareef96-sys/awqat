// The calendars Agenda reads: only https addresses, never shown back in full, up to four, read back safely.
import { describe, expect, it } from "vitest";
import {
  ADDRESS_ERRORS, CALENDARS_MAX, addCalendar, checkCalendars, cleanAddress, cleanCalendarName, emptyCalendars,
  isPublicHost, maskAddress, nameCalendar, removeCalendar, serviceName,
} from "../src/agenda/calendars.ts";

const GOOGLE = "https://calendar.google.com/calendar/ical/me%40example.com/private-0123456789abcdefx7Kq/basic.ics";

describe("a calendar address", () => {
  it("keeps an https address as it is, without its fragment", () => {
    expect(cleanAddress(` ${GOOGLE}\n`)).toEqual({ url: GOOGLE });
    expect(cleanAddress(`${GOOGLE}#top`)).toEqual({ url: GOOGLE });
  });

  it("reads a webcal link as the same address over https", () => {
    expect(cleanAddress("webcal://example.com/published/2/abc")).toEqual({
      url: "https://example.com/published/2/abc" });
    expect(cleanAddress("WEBCALS://example.com/cal.ics")).toEqual({ url: "https://example.com/cal.ics" });
  });

  it("refuses plain http, which would send the secret in the open", () => {
    expect(cleanAddress("http://example.com/x.ics")).toEqual({ error: ADDRESS_ERRORS.notHttps });
  });

  it("refuses what is not an address", () => {
    for (const bad of ["", "   ", "calendar", "ftp://example.com/a.ics", "https://localhost/a.ics", "https://a b.example.com/x",
      "javascript:alert(1)", "file:///etc/passwd", 42, null]) {
      expect(cleanAddress(bad)).toEqual({ error: ADDRESS_ERRORS.notAddress });
    }
  });

  it("refuses a host written as numbers, or one only a home network or this device answers to", () => {
    for (const inside of ["https://127.0.0.1/a.ics", "https://169.254.169.254/latest", "https://2130706433/a.ics",
      "https://192.168.1.10/cal.ics", "https://calendar.local/a.ics", "https://box.internal/a.ics",
      "https://localhost./a.ics", "https://cal.example.com./a.ics", "https://nas.lan/a.ics", "https://[::1]/a.ics"]) {
      expect(cleanAddress(inside)).toEqual({ error: ADDRESS_ERRORS.notAddress });
    }
    expect(isPublicHost("example.com")).toBe(true);
  });

  it("refuses an address with a name and password in it, and one too long", () => {
    expect(cleanAddress("https://me:secret@example.com/a.ics")).toEqual({ error: ADDRESS_ERRORS.withPassword });
    expect(cleanAddress(`https://example.com/${"a".repeat(2100)}`)).toEqual({ error: ADDRESS_ERRORS.tooLong });
  });

  it("is shown as its host and last two characters, never the secret", () => {
    expect(maskAddress(GOOGLE)).toBe("calendar.google.com · ending Kq");
    expect(maskAddress("https://example.com/")).toBe("example.com");
    expect(maskAddress(GOOGLE)).not.toContain("0123456789");
  });

  it("is named after its service until its file names it", () => {
    expect(serviceName(GOOGLE)).toBe("Google Calendar");
    expect(serviceName("https://p01-caldav.icloud.com/x")).toBe("iCloud Calendar");
    expect(serviceName("https://outlook.office365.com/owa/calendar/x/reachcalendar.ics")).toBe("Outlook");
    expect(serviceName("https://cal.example.com/a.ics")).toBe("cal.example.com");
  });

  it("cleans a name from a file to one short line", () => {
    expect(cleanCalendarName("  Work\n\u0007 diary  ")).toBe("Work diary");
    expect(cleanCalendarName("x".repeat(100))).toHaveLength(60);
    expect(cleanCalendarName(7)).toBe("");
  });
});

describe("the list of calendars", () => {
  it("adds, refuses the same one twice, and stops at four", () => {
    let list = emptyCalendars();
    for (let i = 0; i < CALENDARS_MAX; i++) {
      const result = addCalendar(list, `https://example.com/${i}.ics`, `id-${i}`, 1000 + i);
      if ("error" in result) throw new Error(result.error);
      list = result.list;
    }
    expect(list.calendars).toHaveLength(CALENDARS_MAX);
    expect(list.calendars[0]).toEqual({ id: "id-0", url: "https://example.com/0.ics", name: "example.com", added: 1000 });
    expect(addCalendar(list, "https://example.com/9.ics", "id-9", 1)).toEqual({ error: ADDRESS_ERRORS.full });
    const one = removeCalendar(list, "id-3");
    expect(addCalendar(one, "https://example.com/0.ics", "x", 1)).toEqual({ error: ADDRESS_ERRORS.duplicate });
    expect(addCalendar(one, "http://example.com/0.ics", "x", 1)).toEqual({ error: ADDRESS_ERRORS.notHttps });
  });

  it("takes the name a file gives, and leaves the list alone for an empty one", () => {
    const added = addCalendar(emptyCalendars(), GOOGLE, "g", 1);
    if ("error" in added) throw new Error(added.error);
    expect(nameCalendar(added.list, "g", "Work").calendars[0].name).toBe("Work");
    expect(nameCalendar(added.list, "g", "  ")).toBe(added.list);
  });

  it("reads a saved list back, dropping what is not a calendar, and says it was damaged", () => {
    const good = { id: "a1", url: GOOGLE, name: "Work", added: 5 };
    expect(checkCalendars(null)).toEqual({ list: emptyCalendars(), damaged: false });
    expect(checkCalendars(JSON.stringify({ v: 1, calendars: [good] }))).toEqual({
      list: { v: 1, calendars: [good] }, damaged: false });
    const mixed = checkCalendars(JSON.stringify({ v: 1, calendars: [good, { id: "b", url: "http://example.com/a.ics" },
      { ...good, id: "c" }, { id: "../x", url: GOOGLE }] }));
    expect(mixed).toEqual({ list: { v: 1, calendars: [good] }, damaged: true });
    expect(checkCalendars("{nope").damaged).toBe(true);
    expect(checkCalendars(JSON.stringify({ v: 2, calendars: [] })).damaged).toBe(true);
    expect(checkCalendars(JSON.stringify({ v: 1, calendars: Array(5).fill(good) })).damaged).toBe(true);
  });

  it("keeps a saved address as it reads now, even when it was written a little differently", () => {
    const read = checkCalendars(JSON.stringify({ v: 1, calendars: [{ id: "a", url: `${GOOGLE}#x`, name: "W", added: 1 }] }));
    expect(read).toEqual({ list: { v: 1, calendars: [{ id: "a", url: GOOGLE, name: "W", added: 1 }] }, damaged: false });
  });

  it("gives a calendar saved with no name its service's name", () => {
    const read = checkCalendars(JSON.stringify({ v: 1, calendars: [{ id: "a", url: GOOGLE, added: "x" }] }));
    expect(read.list.calendars[0]).toEqual({ id: "a", url: GOOGLE, name: "Google Calendar", added: 0 });
  });
});
