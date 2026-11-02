/**
 * What the calendar worker says besides its answers, shared by the worker (icalWorker.ts) and the app (parse.ts).
 * Kept apart from both so the worker never loads the code that starts it.
 */

/** Said once the worker has loaded, before it reads anything. */
export const WORKER_READY = "ready";
