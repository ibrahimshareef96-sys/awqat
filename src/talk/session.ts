/**
 * The app's Talk session: the bearer token its Worker gave when the user signed in with the passphrase (the passphrase itself
 * is never kept). It is kept with the Worker's address in a file the system never backs up (Library/NoCloud on iOS;
 * the app's own data on Android, which backs nothing up), and handed only to that Worker: if the address in Settings
 * changes, the app asks for the passphrase again rather than send the token somewhere new.
 */
import { Capacitor } from "@capacitor/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { markNoBackup, secretsDirectory as directory } from "../noBackup.ts";
import { cleanWorkerUrl } from "../voice.ts";

export interface TalkSession {
  worker: string;
  token: string;
}

/** The Worker's session tokens: 32 random bytes in base64url. */
export const SESSION_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const PATH = "voice/session.json";

function checked(worker: unknown, token: unknown): TalkSession | null {
  if (typeof worker !== "string" || typeof token !== "string" || !SESSION_SHAPE.test(token)) return null;
  return cleanWorkerUrl(worker) === worker ? { worker, token } : null;
}

/** A kept session from the file's text, or null for anything else. */
export function parseSession(text: string | null): TalkSession | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as { v?: unknown; worker?: unknown; token?: unknown } | null;
    return value?.v === 1 ? checked(value.worker, value.token) : null;
  } catch {
    return null;
  }
}

/** The token, only for the Worker it came from. */
export function sessionToken(session: TalkSession | null, worker: string): string | null {
  return session !== null && worker !== "" && session.worker === worker ? session.token : null;
}

/** The kept session, or null: none, one that cannot be read, or not in the installed app. */
export async function readSession(): Promise<TalkSession | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    await Filesystem.stat({ path: PATH, directory: directory() });
    const file = await Filesystem.readFile({ path: PATH, directory: directory(), encoding: Encoding.UTF8 });
    return parseSession(typeof file.data === "string" ? file.data : null);
  } catch {
    return null;
  }
}

/** Keeps the session; false rather than throwing, so a full or locked disk only means asking again next time. */
export async function writeSession(session: TalkSession): Promise<boolean> {
  const kept = checked(session.worker, session.token);
  if (kept === null || !Capacitor.isNativePlatform()) return false;
  try {
    await Filesystem.writeFile({ path: PATH, directory: directory(), encoding: Encoding.UTF8, recursive: true,
      data: JSON.stringify({ v: 1, ...kept }) });
  } catch {
    return false;
  }
  await markNoBackup(PATH);
  return true;
}

/** Removes the kept session: true once it is gone (or never was), false when it is there and could not be removed. */
export async function clearSession(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    await Filesystem.deleteFile({ path: PATH, directory: directory() });
    return true;
  } catch {
    try {
      await Filesystem.stat({ path: PATH, directory: directory() });
      return false;
    } catch {
      return true;
    }
  }
}
