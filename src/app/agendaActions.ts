/**
 * Agenda's actions: adding and removing calendars, reading them for the week, and choosing the day shown. A read
 * happens when Agenda opens (or the app comes back to it) and the copy is old, and when Refresh is tapped. The
 * calendar reader (and ical.js with it) is loaded only for a read. The state changes before it is saved, as every
 * other action does, so a read finishing meanwhile works from the list as it now is.
 */
import { addCalendar, nameCalendar, removeCalendar } from "../agenda/calendars.ts";
import { AGENDA_DAYS, needsRead, withRead, withoutCalendar, type ReadOutcome } from "../agenda/agenda.ts";
import { shiftKey } from "../agenda/days.ts";
import { fetchCalendar } from "../agenda/fetch.ts";
import { parseCalendar } from "../agenda/parse.ts";
import { isNative } from "../device.ts";
import { KEYS } from "../store.ts";
import type { AgendaModel } from "../ui/agendaView.ts";
import { freshDays } from "./schedule.ts";
import { writeCalendarsFile } from "../agenda/calendarStore.ts";
import { MESSAGES, busyWhile, hooks, save, setNotice, state, today } from "./state.ts";

export const AGENDA_MESSAGES = {
  webOnly: "Agenda reads calendars in the installed app.",
  added: "Calendar added.",
};

const ids = (): string[] => state.calendars.calendars.map((c) => c.id);

export function agendaModel(now: Date): AgendaModel {
  const date = today();
  const day = state.agendaDay && state.agendaDay >= date && state.agendaDay < shiftKey(date, AGENDA_DAYS)
    ? state.agendaDay : date;
  return {
    calendars: state.calendars.calendars, agenda: state.agenda, day, today: date, days: freshDays(now),
    tz: state.place.tz, now: now.getTime(), reading: state.agendaReading, busy: state.busy,
    removeArmed: state.calendarRemoveArmed,
  };
}

/** What one calendar gave: its week, or why not. */
async function readOne(url: string, firstDay: string): Promise<{ outcome: ReadOutcome; name: string }> {
  const fetched = await fetchCalendar(url);
  if ("problem" in fetched) return { outcome: fetched, name: "" };
  let read: Awaited<ReturnType<typeof parseCalendar>>;
  try {
    read = await parseCalendar(fetched.text, { firstDay, endDay: shiftKey(firstDay, AGENDA_DAYS),
      timeZone: state.place.tz });
  } catch {
    // Whatever went wrong reading one calendar, the others are still read.
    return { outcome: { problem: "failed" }, name: "" };
  }
  if (read === "slow") return { outcome: { problem: "tooBig" }, name: "" };
  return read ? { outcome: { events: read.events, truncated: read.truncated }, name: read.name }
    : { outcome: { problem: "notCalendar" }, name: "" };
}

/** The first calendar on the list as it is now that is not among those given. */
const nextCalendar = (read: readonly string[]) => state.calendars.calendars.find((c) => !read.includes(c.id));

/**
 * One pass over the calendars, one after another, each taken from the list as it is at that step: one removed meanwhile
 * is passed over, one added meanwhile is read, and none is read twice. The pass remembers which it has read by id, not
 * by when they were read, so a clock that stood still or went back cannot make it skip one.
 */
async function readAll(firstDay: string): Promise<void> {
  let read: readonly string[] = [];
  for (let calendar = nextCalendar(read); calendar; calendar = nextCalendar(read)) {
    const { id, url } = calendar;
    read = [...read, id];
    const { outcome, name } = await readOne(url, firstDay);
    // Removed while it was being read: what it gave is let go.
    if (!state.calendars.calendars.some((c) => c.id === id)) continue;
    state.agenda = withRead(state.agenda, id, outcome, firstDay, state.place.tz, Date.now());
    const named = nameCalendar(state.calendars, id, name);
    if (named !== state.calendars) {
      state.calendars = named;
      await saveCalendars();
    }
    // Let the screen breathe between calendars: each read can hold the page for a moment.
    await new Promise((done) => setTimeout(done, 0));
  }
}

/**
 * Reads every calendar; `force` reads even a fresh copy. Never two reads at once: a calendar added during a read is
 * read by that same read, once the others are done. One added in the last moment, as the copy is saved, has no read
 * yet, so it is read when Agenda next opens.
 */
export async function refreshAgenda(force = false): Promise<void> {
  if (state.agendaReading || ids().length === 0) return;
  const firstDay = today();
  if (!force && !needsRead(state.agenda, ids(), firstDay, Date.now())) return;
  if (!isNative()) {
    setNotice(AGENDA_MESSAGES.webOnly);
    return hooks.softRender();
  }
  state.agendaReading = true;
  hooks.softRender();
  try {
    await readAll(firstDay);
    await save(KEYS.agenda, state.agenda);
  } finally {
    state.agendaReading = false;
    hooks.softRender();
  }
}

/** Adds a calendar from its typed address; the form clears as it is sent, so the address is not left on screen. */
export async function addCalendarAddress(address: string): Promise<void> {
  let added = false;
  await busyWhile(async () => {
    const result = addCalendar(state.calendars, address, crypto.randomUUID(), Date.now());
    if ("error" in result) return setNotice(result.error);
    state.calendars = result.list;
    added = await saveCalendars();
    if (added) setNotice(isNative() ? AGENDA_MESSAGES.added : AGENDA_MESSAGES.webOnly);
  });
  if (added) await refreshAgenda(true);
}

/** Remove is tapped twice: the first tap asks, the second lets the calendar and its week go. */
export async function removeCalendarTap(id: string): Promise<void> {
  if (state.calendarRemoveArmed !== id) {
    state.calendarRemoveArmed = id;
    return hooks.render();
  }
  state.calendarRemoveArmed = null;
  state.calendars = removeCalendar(state.calendars, id);
  state.agenda = withoutCalendar(state.agenda, id);
  hooks.render();
  await saveCalendars();
  await save(KEYS.agenda, state.agenda);
  // Again once saved, so a save that failed says so now, not at the next tap.
  hooks.render();
}

/** The calendars go to their own file, never backed up (calendarStore.ts); a failure says so, as save() does. */
async function saveCalendars(): Promise<boolean> {
  if (state.blocked.has(KEYS.calendars)) {
    setNotice(MESSAGES.unreadable);
    return false;
  }
  if (await writeCalendarsFile(state.calendars)) {
    if (state.notice === MESSAGES.unsaved) state.notice = "";
    return true;
  }
  setNotice(MESSAGES.unsaved);
  return false;
}

export function pickDay(day: string): void {
  state.agendaDay = day;
  hooks.render();
}
