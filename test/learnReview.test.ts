// The review of the user's own lessons: due the next day, then 3, 7, 14, 30, 90 and 180 days after each "Remembered";
// "Again" starts over from tomorrow; a second tap moves nothing; an archived track's lessons rest.
import { describe, expect, it } from "vitest";
import { addLesson, addTrack, emptyLearn, setArchived, type Learn } from "../src/learn/learn.ts";
import { INTERVALS, again, dueLessons, firstDue, remembered } from "../src/learn/review.ts";
import { shiftKey } from "../src/agenda/days.ts";

const DAY = "2026-10-28";

function oneLesson(date = DAY): { learn: Learn; trackId: string; id: string } {
  const track = addTrack(emptyLearn(), { name: "Hadith", kind: "islamic", weeklyMinutes: 0 }, date);
  const lesson = addLesson(track.learn, { trackId: track.id!, itemId: null, text: "In my words", source: "Muslim 1" }, date);
  return { learn: lesson.learn, trackId: track.id!, id: lesson.id! };
}

const lessonOf = (learn: Learn, id: string) => learn.lessons.find((l) => l.id === id)!;

describe("when a lesson comes back", () => {
  it("is due the day after it is written, not the same day", () => {
    const { learn } = oneLesson();
    expect(firstDue(DAY)).toBe("2026-10-29");
    expect(dueLessons(learn, DAY)).toEqual([]);
    expect(dueLessons(learn, "2026-10-29")).toHaveLength(1);
    expect(dueLessons(learn, "2026-11-30")).toHaveLength(1);
  });

  it("steps through 3, 7, 14, 30, 90 and 180 days, and stays at 180", () => {
    const start = oneLesson();
    const id = start.id;
    let learn = start.learn;
    let day = "2026-10-29";
    const waits: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      learn = remembered(learn, id, day);
      const next = lessonOf(learn, id);
      waits.push(INTERVALS[next.step]);
      expect(next.due).toBe(shiftKey(day, INTERVALS[next.step]));
      day = next.due;
    }
    expect(waits).toEqual([3, 7, 14, 30, 90, 180, 180, 180]);
  });

  it("starts over on Again, due tomorrow from the day it was reviewed", () => {
    const { learn, id } = oneLesson();
    const later = remembered(remembered(learn, id, "2026-10-29"), id, "2026-11-01");
    expect(lessonOf(later, id).step).toBe(2);
    const reset = again(later, id, "2026-11-08");
    expect(lessonOf(reset, id)).toMatchObject({ step: 0, due: "2026-11-09" });
  });

  it("moves nothing for a lesson not due (a second tap), or one that is gone", () => {
    const { learn, id } = oneLesson();
    expect(remembered(learn, id, DAY)).toBe(learn);
    const once = remembered(learn, id, "2026-10-29");
    expect(remembered(once, id, "2026-10-29")).toBe(once);
    expect(again(once, id, "2026-10-29")).toBe(once);
    expect(again(learn, "gone", "2026-10-29")).toBe(learn);
  });

  it("leaves the Learn it was given as it was", () => {
    const { learn, id } = oneLesson();
    remembered(learn, id, "2026-10-29");
    expect(lessonOf(learn, id)).toMatchObject({ step: 0, due: "2026-10-29" });
  });
});

describe("what is due", () => {
  it("puts the longest waiting first, and rests an archived track's lessons", () => {
    const first = oneLesson("2026-10-20");
    const second = addLesson(first.learn, { trackId: first.trackId, itemId: null, text: "Later", source: "" }, "2026-10-25");
    const other = addTrack(second.learn, { name: "Tafsir", kind: "islamic", weeklyMinutes: 0 }, DAY);
    const third = addLesson(other.learn, { trackId: other.id!, itemId: null, text: "Other", source: "" }, "2026-10-22");
    expect(dueLessons(third.learn, DAY).map((l) => l.text)).toEqual(["In my words", "Other", "Later"]);
    const rested = setArchived(third.learn, other.id!, true);
    expect(dueLessons(rested, DAY).map((l) => l.text)).toEqual(["In my words", "Later"]);
  });
});
