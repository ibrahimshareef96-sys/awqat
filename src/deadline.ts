/** A wait with an end: the answer, or null once the deadline passes (the work itself is left to finish on its own). */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
