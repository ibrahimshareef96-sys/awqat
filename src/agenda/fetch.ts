/**
 * A calendar's file fetched by the phone itself (native HTTP, so no browser cross-origin rules apply and the page's
 * policy can stay closed). The address is a secret: it is sent only to its own host over https and never written
 * to a log, a notice or an error.
 */
import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import type { ReadProblem } from "./agenda.ts";
import { cleanAddress } from "./calendars.ts";

/** A calendar file larger than this is not read: parsing takes many times its size in memory. */
export const CALENDAR_FILE_MAX = 5 * 1024 * 1024;
/** A fetch still going after this is given up, however slowly the server keeps sending. */
export const FETCH_DEADLINE_MS = 45000;

export type Fetched = { text: string } | { problem: ReadProblem };

type Get = (options: HttpOptions) => Promise<HttpResponse>;

const header = (response: HttpResponse, name: string): string | undefined => {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : undefined;
};

/** The answer, or null once the deadline passes (the native request is left to finish on its own). */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Redirects followed at most (iCloud sends a published calendar on to the server that holds it). */
export const REDIRECTS_MAX = 3;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * Asks for the file, following redirects by hand: each place it is sent on to must be an https address on the
 * internet, checked as a typed address is, so a calendar's server can never point the phone into its home network.
 */
async function getFollowing(url: string, get: Get): Promise<HttpResponse | { problem: ReadProblem }> {
  let at = url;
  for (let hop = 0; hop <= REDIRECTS_MAX; hop++) {
    const response = await get({ url: at, responseType: "text", connectTimeout: 10000, readTimeout: 30000,
      disableRedirects: true, headers: { Accept: "text/calendar, text/plain;q=0.5" } });
    if (!REDIRECT.has(response.status)) return response;
    const location = header(response, "location");
    if (!location) return { problem: "failed" };
    let next: string;
    try {
      next = new URL(location, at).toString();
    } catch {
      return { problem: "failed" };
    }
    const checked = cleanAddress(next);
    if ("error" in checked) return { problem: "failed" };
    at = checked.url;
  }
  return { problem: "failed" };
}

export async function fetchCalendar(url: string, get: Get = (o) => CapacitorHttp.get(o),
  deadlineMs = FETCH_DEADLINE_MS): Promise<Fetched> {
  if (!url.startsWith("https://")) return { problem: "failed" };
  let answer: HttpResponse | { problem: ReadProblem } | null;
  try {
    answer = await withDeadline(getFollowing(url, get), deadlineMs);
  } catch {
    return { problem: "offline" };
  }
  if (!answer) return { problem: "offline" };
  if ("problem" in answer) return answer;
  const response = answer;
  if (response.status === 401 || response.status === 403) return { problem: "refused" };
  if (response.status === 404 || response.status === 410) return { problem: "notFound" };
  if (response.status !== 200) return { problem: "failed" };
  const length = Number(header(response, "content-length") ?? 0);
  if (length > CALENDAR_FILE_MAX) return { problem: "tooBig" };
  const data: unknown = response.data;
  if (typeof data !== "string") return { problem: "notCalendar" };
  if (data.length > CALENDAR_FILE_MAX) return { problem: "tooBig" };
  if (!/^\s*BEGIN:VCALENDAR/i.test(data.slice(0, 512))) return { problem: "notCalendar" };
  return { text: data };
}
