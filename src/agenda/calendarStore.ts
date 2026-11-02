/**
 * Where the calendars' secret addresses are kept: a file the system never backs up (Library/NoCloud on iOS, whose
 * settings store goes into iCloud and computer backups; the app's own data on Android, which backs nothing up), not
 * the settings store the rest of the app uses. A file that cannot be read is never copied aside, since a copy would
 * keep a secret its owner has since removed; it is left alone for the session instead, and the addresses can always
 * be pasted again.
 */
import { Capacitor } from "@capacitor/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { markNoBackup, secretsDirectory as directory } from "../noBackup.ts";
import { Preferences } from "@capacitor/preferences";
import { KEYS, read, write, type ReadResult } from "../store.ts";
import type { CalendarList } from "./calendars.ts";

const PATH = "agenda/calendars.json";

/** The file is simply not there (first run), as against there and failing. */
const missing = (error: unknown): boolean => /not exist|no such file|does not exist|ENOENT|not found/i
  .test(String((error as { message?: unknown })?.message ?? error));

/** The saved list as text; `ok: false` when it is there but cannot be read. In a browser, the settings store. */
export async function readCalendarsFile(): Promise<ReadResult> {
  if (!Capacitor.isNativePlatform()) return read(KEYS.calendars);
  try {
    await Filesystem.stat({ path: PATH, directory: directory() });
  } catch (error) {
    return missing(error) ? { ok: true, value: null } : { ok: false, value: null };
  }
  try {
    const file = await Filesystem.readFile({ path: PATH, directory: directory(), encoding: Encoding.UTF8 });
    return { ok: true, value: typeof file.data === "string" ? file.data : null };
  } catch {
    return { ok: false, value: null };
  }
}

/** Saves the list; false rather than throwing, so a full or locked disk never breaks a tap. */
export async function writeCalendarsFile(list: CalendarList): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return write(KEYS.calendars, list);
  try {
    await Filesystem.writeFile({ path: PATH, directory: directory(), encoding: Encoding.UTF8, recursive: true,
      data: JSON.stringify(list) });
  } catch {
    return false;
  }
  await markNoBackup(PATH);
  return true;
}

/**
 * A test build of 0.7 kept the addresses in the settings store. On a device that ran it, the list is moved into the
 * file (when the file has none yet), and the settings store's copy, and any copy kept aside of it, are removed.
 * Returns the list's text when it was moved, for the caller to read.
 */
export async function adoptOldCalendars(fileHasNone: boolean): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const old = (await Preferences.get({ key: KEYS.calendars })).value;
    const moved = old !== null && fileHasNone && (await writeCalendarsFileText(old)) ? old : null;
    const keys = (await Preferences.keys()).keys.filter((k) => k === KEYS.calendars ||
      k.startsWith(`${KEYS.calendars}.unreadable.`));
    // The old copy goes once the file holds the list (or held one already); never before.
    if (old === null || moved !== null || !fileHasNone) for (const key of keys) await Preferences.remove({ key });
    return moved;
  } catch {
    return null;
  }
}

async function writeCalendarsFileText(text: string): Promise<boolean> {
  try {
    await Filesystem.writeFile({ path: PATH, directory: directory(), encoding: Encoding.UTF8, recursive: true, data: text });
  } catch {
    return false;
  }
  await markNoBackup(PATH);
  return true;
}
