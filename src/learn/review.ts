/**
 * Spaced review of the user's own lessons. A lesson comes back the day after it is written, then 3, 7, 14, 30, 90 and 180
 * days after each time the user remembers it; "Again" brings it back tomorrow, from the start. Every change returns a new
 * Learn; a tap on a lesson that is not due (a second tap) changes nothing.
 */
import { shiftKey } from "../agenda/days.ts";
import type { Learn, Lesson } from "./learn.ts";

/** Days until a lesson comes back, by its step. */
export const INTERVALS: readonly number[] = [1, 3, 7, 14, 30, 90, 180];
export const STEP_MAX = INTERVALS.length - 1;

/** When a new lesson, or one the user did not remember, comes back. */
export const firstDue = (today: string): string => shiftKey(today, INTERVALS[0]);

/** Lessons due by today on tracks still studied (an archived track's lessons rest with it), longest waiting first. */
export function dueLessons(learn: Learn, today: string): Lesson[] {
  const active = new Set(learn.tracks.filter((t) => !t.archived).map((t) => t.id));
  return learn.lessons.filter((l) => l.due <= today && active.has(l.trackId))
    .sort((a, b) => (a.due === b.due ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : a.due < b.due ? -1 : 1));
}

/** Moves one lesson that is due today; the same Learn when there is none (gone, or already moved by an earlier tap). */
function moveDue(learn: Learn, id: string, today: string, change: (lesson: Lesson) => Lesson): Learn {
  const lesson = learn.lessons.find((l) => l.id === id);
  if (!lesson || lesson.due > today) return learn;
  return { ...learn, lessons: learn.lessons.map((l) => (l.id === id ? change(l) : l)) };
}

/** Remembered: the next step, and the longer wait that goes with it (180 days at most). */
export function remembered(learn: Learn, id: string, today: string): Learn {
  return moveDue(learn, id, today, (l) => {
    const step = Math.min(STEP_MAX, l.step + 1);
    return { ...l, step, due: shiftKey(today, INTERVALS[step]) };
  });
}

/** Not remembered: back to the first step, due tomorrow. */
export function again(learn: Learn, id: string, today: string): Learn {
  return moveDue(learn, id, today, (l) => ({ ...l, step: 0, due: firstDue(today) }));
}
