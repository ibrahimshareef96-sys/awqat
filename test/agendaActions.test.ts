// @vitest-environment happy-dom
// Agenda's actions: an added calendar is read at once and never added twice, a calendar added while the others are
// read is read in that same read, one removed while it is read stays removed, and a clock that stands still or goes
// back makes a read skip none.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(async () => true),
  writeCalendars: vi.fn(async () => true),
  fetch: vi.fn(),
}));
vi.mock("../src/store.ts", () => ({
  KEYS: { agenda: "agenda", calendars: "calendars", settings: "settings" }, write: mocks.write, read: vi.fn(),
  keepAside: vi.fn(),
}));
vi.mock("../src/agenda/calendarStore.ts", () => ({ writeCalendarsFile: mocks.writeCalendars, readCalendarsFile: vi.fn() }));
vi.mock("../src/agenda/fetch.ts", () => ({ fetchCalendar: mocks.fetch }));
vi.mock("../src/device.ts", () => ({ isNative: () => true }));
vi.mock("../src/app/schedule.ts", () => ({ freshDays: () => [] }));

import { emptyCalendars } from "../src/agenda/calendars.ts";
import { emptyAgenda } from "../src/agenda/agenda.ts";
import { hooks, state } from "../src/app/state.ts";
import { addCalendarAddress, refreshAgenda, removeCalendarTap } from "../src/app/agendaActions.ts";
import { ADDRESS_ERRORS } from "../src/agenda/calendars.ts";

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Team\r\nEND:VCALENDAR";
const A = "https://example.com/calendar/ical/a/private-1/basic.ics";
const B = "https://example.com/calendar/ical/b/private-2/basic.ics";
const C = "https://example.com/calendar/ical/c/private-3/basic.ics";
const NOW = new Date("2026-10-30T08:00:00Z").getTime();

/** A promise to settle by hand, for a fetch still on its way. */
function pending<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((done) => { settle = done; });
  return { promise, settle };
}

/** The addresses fetched so far, in order. */
const fetched = (): unknown[] => mocks.fetch.mock.calls.map(([url]) => url);

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ text: ICS });
  state.calendars = emptyCalendars();
  state.agenda = emptyAgenda();
  state.agendaReading = false;
  state.busy = false;
  state.notice = "";
  state.blocked.clear();
  state.calendarRemoveArmed = null;
  hooks.render = vi.fn();
  hooks.softRender = vi.fn();
  hooks.renderOverlay = vi.fn();
  document.body.innerHTML = `<div id="live"></div>`;
});

describe("adding a calendar", () => {
  it("says why an address is refused, and keeps nothing", async () => {
    await addCalendarAddress("http://example.com/x.ics");
    expect(state.notice).toBe(ADDRESS_ERRORS.notHttps);
    expect(state.calendars.calendars).toEqual([]);
    expect(mocks.writeCalendars).not.toHaveBeenCalled();
  });

  it("keeps the calendar in its own file, reads it at once, and takes the name the file gives", async () => {
    await addCalendarAddress(A);
    expect(mocks.writeCalendars).toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(A);
    expect(state.calendars.calendars[0].name).toBe("Team");
    expect(state.agenda.reads).toHaveLength(1);
    expect(state.busy).toBe(false);
  });

  it("is drawn busy while it saves, so the form clears and a second tap does nothing", async () => {
    const first = addCalendarAddress(A);
    const second = addCalendarAddress(A);
    await Promise.all([first, second]);
    expect(state.calendars.calendars).toHaveLength(1);
    expect(hooks.render).toHaveBeenCalled();
  });
});

describe("opening Agenda", () => {
  // Opening the screen (or the app coming back) calls refreshAgenda() with no force: a read only when it is due.
  it("reads nothing while the copy is 15 minutes old or less, and reads once it is older", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    state.place = { ...state.place, tz: "Asia/Dubai" };
    await addCalendarAddress(A);
    mocks.fetch.mockClear();
    vi.setSystemTime(NOW + 15 * 60 * 1000);
    await refreshAgenda();
    expect(fetched()).toEqual([]);
    vi.setSystemTime(NOW + 15 * 60 * 1000 + 1);
    await refreshAgenda();
    expect(fetched()).toEqual([A]);
  });

  it("never reads twice at once: an open while a read runs waits for it", async () => {
    await addCalendarAddress(A);
    mocks.fetch.mockClear();
    const slow = pending<{ text: string }>();
    mocks.fetch.mockReturnValueOnce(slow.promise);
    const first = refreshAgenda(true);
    await refreshAgenda();
    await refreshAgenda(true);
    slow.settle({ text: ICS });
    await first;
    expect(fetched()).toEqual([A]);
    expect(state.agendaReading).toBe(false);
  });

  it("reads a fresh copy again once the place's time zone has changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    state.place = { ...state.place, tz: "Asia/Dubai" };
    await addCalendarAddress(A);
    mocks.fetch.mockClear();
    state.place = { ...state.place, tz: "Europe/London" };
    vi.setSystemTime(NOW + 60 * 1000);
    await refreshAgenda();
    expect(fetched()).toEqual([A]);
    expect(state.agenda.reads[0].tz).toBe("Europe/London");
  });

  it("reads the whole pass in the zone it began in, though the place changes during it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    state.place = { ...state.place, tz: "Asia/Dubai" };
    await addCalendarAddress(A);
    await addCalendarAddress(B);
    const slow = pending<{ text: string }>();
    mocks.fetch.mockReturnValueOnce(slow.promise);
    const reading = refreshAgenda(true);
    state.place = { ...state.place, tz: "Europe/London" };
    slow.settle({ text: ICS });
    await reading;
    expect(state.agenda.reads.map((r) => r.tz)).toEqual(["Asia/Dubai", "Asia/Dubai"]);
    mocks.fetch.mockClear();
    await refreshAgenda();
    expect(fetched()).toEqual([A, B]);
  });
});

describe("Work due on the Agenda", () => {
  it("comes from the Work feed only with a backend set, and only items with a day", async () => {
    const { agendaModel, workDue } = await import("../src/app/agendaActions.ts");
    const due = [{ text: "A", date: "2026-10-30", time: "", late: false }, { text: "B", date: "", time: "", late: false }];
    state.feeds = { ...state.feeds, work: { feed: { at: 1, projects: [], due, waiting: [] }, status: "ok" } };
    state.settings = { ...state.settings, voiceUrl: "" };
    expect(workDue()).toEqual([]);
    state.settings = { ...state.settings, voiceUrl: "https://worker.example" };
    expect(workDue().map((d) => d.text)).toEqual(["A"]);
    expect(agendaModel(new Date(NOW)).due.map((d) => d.text)).toEqual(["A"]);
    state.settings = { ...state.settings, voiceUrl: "" };
  });
});

describe("reading and removing", () => {
  it("reads a calendar added while the others were being read, in that same read", async () => {
    await addCalendarAddress(A);
    const slow = pending<{ text: string }>();
    mocks.fetch.mockReturnValueOnce(slow.promise);
    const reading = refreshAgenda(true);
    // While A is still on its way, B is added: the read that is running reads it too.
    const added = addCalendarAddress(B);
    slow.settle({ text: ICS });
    await Promise.all([reading, added]);
    const ids = state.calendars.calendars.map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => state.agenda.reads.some((r) => r.cal === id))).toBe(true);
    // Each once: A when it was added and by the read, B by the read, and neither again.
    expect(fetched()).toEqual([A, A, B]);
  });

  it("reads one added while the one added before it is being read, in that same read", async () => {
    await addCalendarAddress(A);
    mocks.fetch.mockClear();
    const slowA = pending<{ text: string }>();
    const slowB = pending<{ text: string }>();
    const readingB = pending<void>();
    mocks.fetch.mockReturnValueOnce(slowA.promise).mockImplementationOnce(() => {
      readingB.settle();
      return slowB.promise;
    });
    const reading = refreshAgenda(true);
    await addCalendarAddress(B);
    slowA.settle({ text: ICS });
    await readingB.promise;
    await addCalendarAddress(C);
    slowB.settle({ text: ICS });
    await reading;
    expect(fetched()).toEqual([A, B, C]);
    expect(state.agenda.reads).toHaveLength(3);
  });

  it("reads every calendar again though the last read ended in the same millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await addCalendarAddress(A);
    await addCalendarAddress(B);
    mocks.fetch.mockClear();
    await refreshAgenda(true);
    expect(fetched()).toEqual([A, B]);
  });

  it("reads a copy stamped later than the clock now says, once the clock has gone back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + 60 * 60 * 1000);
    await addCalendarAddress(A);
    await addCalendarAddress(B);
    mocks.fetch.mockClear();
    vi.setSystemTime(NOW);
    await refreshAgenda();
    expect(fetched()).toEqual([A, B]);
    expect(state.agenda.reads.map((r) => r.at)).toEqual([NOW, NOW]);
  });

  it("passes over one removed before its turn came", async () => {
    await addCalendarAddress(A);
    await addCalendarAddress(B);
    const b = state.calendars.calendars[1].id;
    mocks.fetch.mockClear();
    const slow = pending<{ text: string }>();
    mocks.fetch.mockReturnValueOnce(slow.promise);
    const reading = refreshAgenda(true);
    await removeCalendarTap(b);
    await removeCalendarTap(b);
    slow.settle({ text: ICS });
    await reading;
    expect(fetched()).toEqual([A]);
    expect(state.agenda.reads).toHaveLength(1);
  });

  it("still reads every other calendar when one is removed while it is being read", async () => {
    await addCalendarAddress(A);
    await addCalendarAddress(B);
    await addCalendarAddress(C);
    const [a, b, c] = state.calendars.calendars.map((cal) => cal.id);
    const slow = pending<{ text: string }>();
    mocks.fetch.mockReset();
    mocks.fetch.mockReturnValueOnce(slow.promise).mockResolvedValue({ text: ICS });
    const before = state.agenda.reads.find((r) => r.cal === b)!.at;
    const reading = refreshAgenda(true);
    await removeCalendarTap(a);
    await removeCalendarTap(a);
    slow.settle({ text: ICS });
    await reading;
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(state.agenda.reads.find((r) => r.cal === b)!.at).toBeGreaterThanOrEqual(before);
    expect(state.agenda.reads.map((r) => r.cal).sort()).toEqual([b, c].sort());
  });

  it("saves nothing over a calendars file that could not be read", async () => {
    state.blocked.add("calendars");
    await addCalendarAddress(A);
    expect(mocks.writeCalendars).not.toHaveBeenCalled();
    state.blocked.delete("calendars");
  });

  it("lets go of what a calendar gave when it was removed while being read", async () => {
    await addCalendarAddress(A);
    const id = state.calendars.calendars[0].id;
    const slow = pending<{ text: string }>();
    mocks.fetch.mockReturnValueOnce(slow.promise);
    const reading = refreshAgenda(true);
    await removeCalendarTap(id);
    await removeCalendarTap(id);
    slow.settle({ text: ICS });
    await reading;
    expect(state.calendars.calendars).toEqual([]);
    expect(state.agenda.reads).toEqual([]);
    // The list was saved without it.
    expect(mocks.writeCalendars).toHaveBeenLastCalledWith({ v: 1, calendars: [] });
  });
});
