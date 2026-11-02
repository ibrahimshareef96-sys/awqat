/**
 * The calendars Agenda reads: each one's private iCal address (Google's "Secret address in iCal format", or the
 * published link iCloud and Outlook give). The address works like a password, so it is kept on this device only, is
 * never shown back in full, and only https is ever fetched (a webcal:// link is the same address over https).
 */
export const CALENDARS_MAX = 4;
export const ADDRESS_MAX = 2048;
export const CALENDAR_NAME_MAX = 60;

export interface Calendar {
  /** Random, for the buttons that point at it. */
  id: string;
  /** Always https. */
  url: string;
  /** The calendar's own name once its file is read, else the service it is on. */
  name: string;
  added: number;
}

export interface CalendarList {
  v: 1;
  calendars: Calendar[];
}

export type AddressCheck = { url: string } | { error: string };

export const ADDRESS_ERRORS = {
  notAddress: "That is not a calendar address. Copy the secret address in iCal format and paste it here.",
  notHttps: "Only https addresses can be read: a plain http one would send your calendar's secret in the open.",
  tooLong: "That address is too long to be a calendar's.",
  withPassword: "That address has a name and password in it. Use the calendar's own secret address instead.",
  duplicate: "That calendar is already here.",
  full: `Agenda reads up to ${CALENDARS_MAX} calendars. Remove one first.`,
};

export const emptyCalendars = (): CalendarList => ({ v: 1, calendars: [] });

/**
 * A host on the internet, named: not an address written as numbers (127.0.0.1, 169.254.169.254), and not a name only a
 * home network or this device answers to. A calendar is fetched from the place its owner named, never from inside.
 */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || host.startsWith("[")) return false;
  if (/^\d+(\.\d+){3}$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home\.arpa|intranet)$/.test(host);
}

/** The address as it will be fetched, or why it cannot be. Whitespace from a copy and paste is let go. */
export function cleanAddress(value: unknown): AddressCheck {
  if (typeof value !== "string") return { error: ADDRESS_ERRORS.notAddress };
  const typed = value.trim();
  if (!typed || /\s/.test(typed)) return { error: ADDRESS_ERRORS.notAddress };
  if (typed.length > ADDRESS_MAX) return { error: ADDRESS_ERRORS.tooLong };
  const swapped = /^webcals?:\/\//i.test(typed) ? typed.replace(/^webcals?:\/\//i, "https://") : typed;
  let url: URL;
  try {
    url = new URL(swapped);
  } catch {
    return { error: ADDRESS_ERRORS.notAddress };
  }
  if (url.protocol === "http:") return { error: ADDRESS_ERRORS.notHttps };
  if (url.protocol !== "https:" || !isPublicHost(url.hostname)) return { error: ADDRESS_ERRORS.notAddress };
  if (url.username || url.password) return { error: ADDRESS_ERRORS.withPassword };
  url.hash = "";
  return { url: url.toString() };
}

const SERVICES: readonly [RegExp, string][] = [
  [/(^|\.)google\.com$/i, "Google Calendar"],
  [/(^|\.)icloud\.com$/i, "iCloud Calendar"],
  [/(^|\.)(outlook\.(office365|live)\.com|office\.com)$/i, "Outlook"],
];

/** A name for a calendar not read yet: the service it is on, or its host. */
export function serviceName(url: string): string {
  const host = new URL(url).hostname;
  return SERVICES.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

/** How the address is shown: the host and its last two characters, enough to tell two apart, never the secret. */
export function maskAddress(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/basic\.ics$/i, "").replace(/\.ics$/i, "");
  const tail = Array.from(path.replace(/\/+$/, "")).slice(-2).join("");
  return tail ? `${parsed.hostname} · ending ${tail}` : parsed.hostname;
}

/** A calendar's name from its file, made safe to keep: one line, no more than CALENDAR_NAME_MAX characters. */
export function cleanCalendarName(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, CALENDAR_NAME_MAX).join("").trim();
}

export type AddResult = { list: CalendarList; calendar: Calendar } | { error: string };

export function addCalendar(list: CalendarList, address: unknown, id: string, now: number): AddResult {
  const checked = cleanAddress(address);
  if ("error" in checked) return checked;
  if (list.calendars.some((c) => c.url === checked.url)) return { error: ADDRESS_ERRORS.duplicate };
  if (list.calendars.length >= CALENDARS_MAX) return { error: ADDRESS_ERRORS.full };
  const calendar: Calendar = { id, url: checked.url, name: serviceName(checked.url), added: now };
  return { list: { v: 1, calendars: [...list.calendars, calendar] }, calendar };
}

export function removeCalendar(list: CalendarList, id: string): CalendarList {
  return { v: 1, calendars: list.calendars.filter((c) => c.id !== id) };
}

/** The name a calendar's file gives itself replaces the placeholder; an empty one changes nothing. */
export function nameCalendar(list: CalendarList, id: string, name: unknown): CalendarList {
  const clean = cleanCalendarName(name);
  if (!clean) return list;
  return { v: 1, calendars: list.calendars.map((c) => (c.id === id && c.name !== clean ? { ...c, name: clean } : c)) };
}

const ID = /^[A-Za-z0-9-]{1,64}$/;

function checkOne(raw: unknown): Calendar | null {
  const c = raw as Partial<Calendar> | null;
  if (!c || typeof c.id !== "string" || !ID.test(c.id) || typeof c.url !== "string") return null;
  const checked = cleanAddress(c.url);
  if ("error" in checked) return null;
  const added = typeof c.added === "number" && Number.isFinite(c.added) ? c.added : 0;
  // The address as it reads now: a browser that writes URLs a little differently never costs a calendar.
  return { id: c.id, url: checked.url, name: cleanCalendarName(c.name) || serviceName(checked.url), added };
}

/** The saved list read back; `damaged` when something was saved but is not a list of calendars. */
export function checkCalendars(json: string | null): { list: CalendarList; damaged: boolean } {
  if (json === null) return { list: emptyCalendars(), damaged: false };
  try {
    const raw = JSON.parse(json) as { v?: unknown; calendars?: unknown } | null;
    if (!raw || raw.v !== 1 || !Array.isArray(raw.calendars) || raw.calendars.length > CALENDARS_MAX) {
      return { list: emptyCalendars(), damaged: true };
    }
    const calendars = raw.calendars.map(checkOne);
    const kept = calendars.filter((c): c is Calendar => c !== null)
      .filter((c, i, all) => all.findIndex((o) => o.id === c.id || o.url === c.url) === i);
    return { list: { v: 1, calendars: kept }, damaged: kept.length !== raw.calendars.length };
  } catch {
    return { list: emptyCalendars(), damaged: true };
  }
}
