/**
 * Talking to the OS: the voice page lives on the owner's own Worker (its /talk page, with its own sign-in and the
 * microphone), opened in the app's browser sheet. The Worker's address is typed in Settings; a build can bring a
 * default (VITE_WORKER_URL in a local .env file), so nothing personal is written into the code.
 */
import { isPublicHost } from "./agenda/calendars.ts";

export const WORKER_URL_MAX = 200;

/** The Worker's https origin from what was typed or built in, or "" when it is not one. */
export function cleanWorkerUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const typed = value.trim();
  if (!typed || typed.length > WORKER_URL_MAX || /\s/.test(typed)) return "";
  try {
    const url = new URL(typed.includes("://") ? typed : `https://${typed}`);
    if (url.protocol !== "https:" || url.username || url.password || !isPublicHost(url.hostname)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

/** The address built into this copy of the app, if any. */
export const BUILT_IN_WORKER = cleanWorkerUrl(import.meta.env.VITE_WORKER_URL);

/** The Worker to talk to: the one typed in Settings, else the one built in, else none. */
export function workerUrl(typed: string): string {
  return cleanWorkerUrl(typed) || BUILT_IN_WORKER;
}

export function talkPage(worker: string): string {
  return `${worker}/talk`;
}
