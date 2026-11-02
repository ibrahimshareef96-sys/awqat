// The Weekly Review kept as a muhasabah: one a week, by the Monday it begins on, with up to three intentions that show
// on Home for the week after it and can be ticked; damaged data read back never breaks the app.
import { describe, expect, it } from "vitest";
import {
  INTENTION_MAX, REFLECTION_MAX, REVIEWS_MAX, REVIEW_ERRORS, checkReviewLog, emptyReviewLog, firstLine, homeIntentions,
  pastReviews, reviewOf, saveReview, toggleIntention, weekOf, type ReviewDraft, type ReviewLog,
} from "../src/review/muhasabah.ts";
import { shiftKey } from "../src/agenda/days.ts";

/** Monday 2 November 2026, and the days of that week. */
const MON = "2026-11-02";
const TUE = "2026-11-03";
const SUN = "2026-11-08";

const draft = (patch: Partial<ReviewDraft> = {}): ReviewDraft =>
  ({ well: "", short: "", change: "", intentions: [], ...patch });

function saved(log: ReviewLog, patch: Partial<ReviewDraft>, day: string): ReviewLog {
  const result = saveReview(log, draft(patch), day);
  if ("error" in result) throw new Error(result.error);
  return result.log;
}

describe("the week a review belongs to", () => {
  it("is the Monday it begins on, as study since Monday counts it", () => {
    expect(weekOf(MON)).toBe(MON);
    expect(weekOf(TUE)).toBe(MON);
    expect(weekOf(SUN)).toBe(MON);
    expect(weekOf("2026-11-09")).toBe("2026-11-09");
    // Across a month and a year.
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
  });
});

describe("saving a review", () => {
  it("keeps what was written, cleaned, under this week", () => {
    const log = saved(emptyReviewLog(), { well: "  Prayed Fajr at the mosque\n\nmost days  ", intentions: [" Call home ", ""] }, TUE);
    expect(log.reviews).toHaveLength(1);
    expect(log.reviews[0]).toEqual({ week: MON, day: TUE, well: "Prayed Fajr at the mosque\n\nmost days", short: "", change: "",
      intentions: [{ text: "Call home", done: false }] });
  });

  it("cuts each reflection and intention to its length, by whole characters, and keeps at most three intentions", () => {
    const log = saved(emptyReviewLog(), { well: "a".repeat(REFLECTION_MAX + 50), intentions: ["b".repeat(INTENTION_MAX + 9), "c", "d", "e"] }, TUE);
    const r = log.reviews[0];
    expect(Array.from(r.well)).toHaveLength(REFLECTION_MAX);
    expect(r.intentions.map((i) => i.text.length)).toEqual([INTENTION_MAX, 1, 1]);
  });

  it("makes an intention one line, drops hidden characters and keeps each once", () => {
    const hidden = String.fromCodePoint(0x202e);
    const log = saved(emptyReviewLog(), { intentions: ["Read\nafter Isha", `${hidden}Walk`, "Walk"] }, TUE);
    expect(log.reviews[0].intentions.map((i) => i.text)).toEqual(["Read after Isha", "Walk"]);
  });

  it("refuses a review with nothing written, and changes nothing", () => {
    const log = emptyReviewLog();
    expect(saveReview(log, draft({ well: "   ", intentions: [" ", ""] }), TUE)).toEqual({ error: REVIEW_ERRORS.empty });
    expect(log).toEqual(emptyReviewLog());
  });

  it("lets this week's review go when every field is cleared, and leaves other weeks", () => {
    let log = saved(emptyReviewLog(), { well: "Last week" }, "2026-10-27");
    log = saved(log, { well: "This week", intentions: ["Walk"] }, TUE);
    const cleared = saveReview(log, draft(), SUN);
    expect(cleared).toEqual({ log: { v: 1, reviews: [log.reviews[1]] }, review: null });
  });

  it("drops characters that hide or turn text from a reflection, as from any shown text, and keeps the marks scripts need", () => {
    const filler = String.fromCodePoint(0x3164);
    const lrm = String.fromCodePoint(0x200e);
    expect(saveReview(emptyReviewLog(), draft({ well: `${filler}${filler}` }), TUE)).toEqual({ error: REVIEW_ERRORS.empty });
    const log = saved(emptyReviewLog(), { well: `Line one${String.fromCodePoint(0x202e)}\n${lrm}Line two\tend` }, TUE);
    expect(log.reviews[0].well).toBe(`Line one\n${lrm}Line two end`);
  });

  it("replaces this week's review, keeping the ticks of intentions left as they were", () => {
    let log = saved(emptyReviewLog(), { intentions: ["Call home", "Walk"] }, MON);
    log = toggleIntention(log, MON, 0);
    log = saved(log, { well: "Better", intentions: ["Call home", "Sleep early"] }, SUN);
    expect(log.reviews).toHaveLength(1);
    expect(log.reviews[0]).toMatchObject({ week: MON, day: SUN, well: "Better",
      intentions: [{ text: "Call home", done: true }, { text: "Sleep early", done: false }] });
  });

  it("keeps the newest first, and only the newest weeks past the limit", () => {
    let log = emptyReviewLog();
    for (let i = 0; i < REVIEWS_MAX + 3; i += 1) log = saved(log, { well: `Week ${i}` }, shiftKey("2025-06-02", i * 7));
    expect(log.reviews).toHaveLength(REVIEWS_MAX);
    expect(log.reviews[0].well).toBe(`Week ${REVIEWS_MAX + 2}`);
    expect(log.reviews.at(-1)?.well).toBe("Week 3");
  });

  it("never changes the log it was given", () => {
    const before = saved(emptyReviewLog(), { intentions: ["Walk"] }, MON);
    const copy = JSON.parse(JSON.stringify(before));
    saved(before, { intentions: ["Run"] }, TUE);
    toggleIntention(before, MON, 0);
    expect(before).toEqual(copy);
  });
});

describe("ticking an intention", () => {
  const log = saved(emptyReviewLog(), { intentions: ["Call home", "Walk"] }, MON);

  it("ticks and unticks one intention of one week", () => {
    const ticked = toggleIntention(log, MON, 1);
    expect(ticked.reviews[0].intentions.map((i) => i.done)).toEqual([false, true]);
    expect(toggleIntention(ticked, MON, 1)).toEqual(log);
  });

  it("does nothing for a week or an intention that is not there", () => {
    expect(toggleIntention(log, "2026-10-26", 0)).toBe(log);
    expect(toggleIntention(log, MON, 2)).toBe(log);
    expect(toggleIntention(log, MON, -1)).toBe(log);
    expect(toggleIntention(log, MON, 0.5)).toBe(log);
  });
});

describe("the intentions on Home", () => {
  it("are the newest review's, for the seven days after it was written", () => {
    const log = saved(emptyReviewLog(), { intentions: ["Walk"] }, SUN);
    expect(homeIntentions(log, SUN)).toEqual({ week: MON, intentions: [{ text: "Walk", done: false }] });
    expect(homeIntentions(log, "2026-11-15")?.intentions).toHaveLength(1);
    expect(homeIntentions(log, "2026-11-16")).toBeNull();
  });

  it("are never a review dated ahead of the clock (a phone whose clock was wrong), a day's difference allowed", () => {
    let log = saved(emptyReviewLog(), { intentions: ["Far ahead"] }, "2099-01-06");
    log = saved(log, { intentions: ["Walk"] }, TUE);
    expect(homeIntentions(log, TUE)?.intentions.map((i) => i.text)).toEqual(["Walk"]);
    // Another device a time zone ahead has already reached Monday.
    const ahead = saved(log, { intentions: ["Next week's"] }, "2026-11-09");
    expect(homeIntentions(ahead, SUN)?.intentions.map((i) => i.text)).toEqual(["Next week's"]);
  });

  it("are replaced by a new review, even one that sets none", () => {
    let log = saved(emptyReviewLog(), { intentions: ["Walk"] }, SUN);
    log = saved(log, { well: "A good week" }, "2026-11-09");
    expect(homeIntentions(log, "2026-11-09")).toBeNull();
    expect(homeIntentions(emptyReviewLog(), MON)).toBeNull();
  });
});

describe("past reviews", () => {
  it("lists every week but this one, newest first, by its first line", () => {
    let log = saved(emptyReviewLog(), { short: "Missed the morning adhkar\non busy days" }, "2026-10-20");
    log = saved(log, { intentions: ["Walk after Asr"] }, "2026-10-27");
    log = saved(log, { well: "This week" }, TUE);
    expect(pastReviews(log, MON)).toEqual([
      { week: "2026-10-26", line: "Walk after Asr" },
      { week: "2026-10-19", line: "Missed the morning adhkar" },
    ]);
  });

  it("cuts a long first line", () => {
    const log = saved(emptyReviewLog(), { change: "x".repeat(200) }, TUE);
    expect(Array.from(firstLine(log.reviews[0])).length).toBeLessThanOrEqual(71);
    expect(firstLine(log.reviews[0]).endsWith("…")).toBe(true);
  });

  it("finds one week's review", () => {
    const log = saved(emptyReviewLog(), { well: "Yes" }, TUE);
    expect(reviewOf(log, MON)?.well).toBe("Yes");
    expect(reviewOf(log, "2026-10-26")).toBeNull();
  });
});

describe("reading the reviews back", () => {
  const good = saved(saved(emptyReviewLog(), { well: "One", intentions: ["Walk"] }, "2026-10-27"), { change: "Two" }, TUE);

  it("reads back what was saved, unchanged and not damaged", () => {
    expect(checkReviewLog(JSON.stringify(good))).toEqual({ log: good, damaged: false });
    expect(checkReviewLog(null)).toEqual({ log: emptyReviewLog(), damaged: false });
  });

  it("starts empty from anything that is not a review log, and says it was damaged", () => {
    for (const bad of ["{oops", "null", "[]", "42", '"text"', JSON.stringify({ v: 2, reviews: [] }), JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 1, reviews: {} })]) {
      expect(checkReviewLog(bad)).toEqual({ log: emptyReviewLog(), damaged: true });
    }
    const tooMany = { v: 1, reviews: Array.from({ length: REVIEWS_MAX + 1 }, () => good.reviews[0]) };
    expect(checkReviewLog(JSON.stringify(tooMany))).toEqual({ log: emptyReviewLog(), damaged: true });
  });

  it("drops a review whose week or day cannot be one, and keeps the rest", () => {
    const [a, b] = good.reviews;
    const reviews = [a, { ...b, week: "2026-10-28" }, { ...b, day: "2026-02-30" }, { ...b, day: "2026-11-10" }, null, "x",
      { ...b, week: 20261026 }];
    const back = checkReviewLog(JSON.stringify({ v: 1, reviews }));
    expect(back.log.reviews).toEqual([a]);
    expect(back.damaged).toBe(true);
  });

  it("cuts text past its length, drops intentions that are not, and keeps one review a week", () => {
    const [a, b] = good.reviews;
    const reviews = [
      { ...a, well: "w".repeat(REFLECTION_MAX + 1), intentions: [{ text: "Walk", done: "yes" }, { text: "", done: false },
        { text: 7, done: true }, { text: "Run", done: true }, { text: "Fast Monday", done: false }, { text: "Five", done: false }] },
      { ...a, well: "Second copy of the same week" },
      b,
    ];
    const back = checkReviewLog(JSON.stringify({ v: 1, reviews }));
    expect(back.damaged).toBe(true);
    expect(back.log.reviews.map((r) => r.week)).toEqual([MON, "2026-10-26"]);
    const kept = back.log.reviews[0];
    expect(Array.from(kept.well)).toHaveLength(REFLECTION_MAX);
    expect(kept.intentions).toEqual([{ text: "Walk", done: false }, { text: "Run", done: true }, { text: "Fast Monday", done: false }]);
  });

  it("drops a review with nothing in it, and treats text that is not text as none", () => {
    const [a] = good.reviews;
    const reviews = [{ ...a, well: 5, short: null, change: ["x"], intentions: "Walk" }];
    expect(checkReviewLog(JSON.stringify({ v: 1, reviews }))).toEqual({ log: emptyReviewLog(), damaged: true });
  });

  it("reads a hostile review in bounded time: a huge list of intentions or a huge text costs no more than a long one", () => {
    const [a] = good.reviews;
    const intentions = Array.from({ length: 300_000 }, (_, i) => ({ text: `Item ${i}`, done: false }));
    const started = Date.now();
    const back = checkReviewLog(JSON.stringify({ v: 1, reviews: [{ ...a, intentions, well: "w".repeat(5_000_000) }] }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(back.damaged).toBe(true);
    expect(back.log.reviews[0].intentions).toHaveLength(3);
    expect(Array.from(back.log.reviews[0].well)).toHaveLength(REFLECTION_MAX);
  });

  it("puts reviews read out of order newest first", () => {
    const back = checkReviewLog(JSON.stringify({ v: 1, reviews: [...good.reviews].reverse() }));
    expect(back.log.reviews.map((r) => r.week)).toEqual([MON, "2026-10-26"]);
    expect(back.damaged).toBe(false);
  });
});
