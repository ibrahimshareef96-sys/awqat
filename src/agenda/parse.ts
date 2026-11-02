/**
 * Reading a calendar file, in a worker so the screen never waits on it, ended when it runs out of time. Where there is
 * no worker (tests, or a web view that refuses one), the file is read here with ical.ts's own time budget.
 */
import type { ReadCalendar, Window } from "./ical.ts";
import { WORKER_READY } from "./workerMessages.ts";

/** A read still going after this is ended, and the calendar is called too big to read. Longer than the worker's own
 * 5 s budget for parsing and reading, so a read that stops itself in time still gives what it found. */
export const PARSE_TIMEOUT_MS = 8000;

export type Parsed = ReadCalendar | null | "slow";

async function readHere(text: string, window: Window): Promise<Parsed> {
  const { readCalendar, recentOnly } = await import("./ical.ts");
  return readCalendar(recentOnly(text, window.firstDay), window);
}

function startWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./icalWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

export function parseCalendar(text: string, window: Window, timeoutMs = PARSE_TIMEOUT_MS): Promise<Parsed> {
  const worker = startWorker();
  if (!worker) return readHere(text, window);
  return new Promise((resolve) => {
    const finish = (result: Parsed | Promise<Parsed>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish("slow"), timeoutMs);
    let started = false;
    worker.onmessage = (event: MessageEvent<Parsed | typeof WORKER_READY>) => {
      if (event.data === WORKER_READY) started = true;
      else finish(event.data);
    };
    // An error before the worker said it was running means it could not start (a web view that will not load it):
    // the file is read here instead, with the reader's own time budget. An error after that came from reading this
    // file (a worker that ran out of memory on it), so it is never read again on the screen's thread.
    worker.onerror = () => finish(started ? "slow" : readHere(text, window));
    worker.postMessage({ text, window });
  });
}
