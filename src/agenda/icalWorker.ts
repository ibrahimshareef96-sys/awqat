/**
 * Reads a calendar file away from the screen: a file that takes long to read (or a rule that makes ical.js spin) holds
 * up this worker only, and the app ends it when it runs out of time (src/agenda/parse.ts).
 */
import { readCalendar, recentOnly, type Window } from "./ical.ts";
import { WORKER_READY } from "./workerMessages.ts";

interface Job {
  text: string;
  window: Window;
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<Job>) => void) | null; postMessage(data: unknown): void };

scope.onmessage = (event) => {
  const { text, window } = event.data;
  try {
    // In here the screen does not wait, so the read may take longer than on the screen's own thread.
    scope.postMessage(readCalendar(recentOnly(text, window.firstDay), window, 5000));
  } catch {
    scope.postMessage(null);
  }
};

// Loaded: from here on an error comes from reading a file, and the app does not read that file again itself.
scope.postMessage(WORKER_READY);
