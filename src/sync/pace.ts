/**
 * How often the app syncs. The Worker takes at most 900 syncs an hour from all the user's devices and both routes together
 * (books and records), so a sync that a change set off waits at least AUTO_GAP_MS after the last one, and after the
 * Worker answers "too many" (429) neither route syncs again until the time it gave. A tap on dhikr after dhikr then
 * costs one sync, not one each.
 */
export const AUTO_GAP_MS = 30_000;

let holdUntil = 0;

/** Whether the Worker asked for a pause that has not run out yet. */
export function held(now = Date.now()): boolean {
  return now < holdUntil;
}

/** The Worker asked to wait this many seconds; both routes hold until then. */
export function holdFor(seconds: number, now = Date.now()): Date {
  holdUntil = Math.max(holdUntil, now + seconds * 1000);
  return new Date(holdUntil);
}

export function holdEnds(): Date {
  return new Date(holdUntil);
}

/** How long a sync set off by a change waits: the pause for changes to settle, or longer to keep the gap. */
export function autoDelay(lastRun: number, settle: number, now = Date.now()): number {
  return Math.max(settle, lastRun + AUTO_GAP_MS - now, holdUntil - now);
}

/** For tests: forget any pause. */
export function resetPace(): void {
  holdUntil = 0;
}
