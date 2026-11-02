// The Weekly Reviews on every device: one record a week, read back through the same checks as the store, ticks made on
// two devices both kept, and otherwise the newer review wins.
import { describe, expect, it } from "vitest";
import { emptyReviewLog, saveReview, toggleIntention, type ReviewDraft, type ReviewLog } from "../src/review/muhasabah.ts";
import { reviewsCollection } from "../src/sync/collections.ts";
import { applyReply, emptyRecordsSync, keyOf, recordsOf, stampSaved, type Reply, type Wire } from "../src/sync/records.ts";

const T0 = Date.UTC(2026, 10, 3, 8, 0);
const WORKER = "https://os.example.com";
const MON = "2026-11-02";
const reply = (patch: Partial<Reply> = {}): Reply => ({ cursor: 1, more: false, records: [], removed: [], ...patch });
const noWire: Wire = { cursor: 0, records: [], removed: [] };

function saved(log: ReviewLog, patch: Partial<ReviewDraft>, day: string): ReviewLog {
  const result = saveReview(log, { well: "", short: "", change: "", intentions: [], ...patch }, day);
  if ("error" in result) throw new Error(result.error);
  return result.log;
}

describe("the reviews as records", () => {
  const log = saved(saved(emptyReviewLog(), { well: "Last week", intentions: ["Walk"] }, "2026-10-28"),
    { short: "This week", intentions: ["Call home", "Read"] }, "2026-11-03");

  it("are one record a week, by its Monday, and come back the same", () => {
    const recs = reviewsCollection.toRecords(log);
    expect(recs.map((r) => [r.kind, r.id])).toEqual([["review.week", MON], ["review.week", "2026-10-26"]]);
    expect([...recordsOf(reviewsCollection, log).keys()]).toEqual([keyOf("review.week", MON), keyOf("review.week", "2026-10-26")]);
    expect(reviewsCollection.fromRecords([...recs].reverse(), emptyReviewLog())).toEqual(log);
  });

  it("go through the store's own checks: a record that is not a review is left out", () => {
    const recs = [...reviewsCollection.toRecords(log), { kind: "review.week", id: "2026-11-04", data: { well: "Not a Monday" } },
      { kind: "review.week", id: "2026-10-19", data: { day: "2026-10-30", well: "Wrong week" } }];
    expect(reviewsCollection.fromRecords(recs, emptyReviewLog())).toEqual(log);
  });

  it("never lets records that are not weeks push real reviews out of the newest 52", () => {
    // Ids that pass the Worker's rule sort above a date ("zz0" > "2026-..."): they are set aside before the newest are taken.
    const junk = Array.from({ length: 60 }, (_, i) => ({ kind: "review.week", id: `zz${i}`, data: { well: "x" } }));
    expect(reviewsCollection.fromRecords([...junk, ...reviewsCollection.toRecords(log)], emptyReviewLog())).toEqual(log);
  });

  it("leaves out a record bigger than one the Worker takes, whatever is in it", () => {
    const huge = { kind: "review.week", id: "2026-10-19", data: { day: "2026-10-20", well: "x".repeat(70 * 1024) } };
    expect(reviewsCollection.fromRecords([...reviewsCollection.toRecords(log), huge], emptyReviewLog())).toEqual(log);
  });
});

describe("a review changed on two devices", () => {
  const base = saved(emptyReviewLog(), { well: "Alhamdulillah", intentions: ["Call home", "Walk"] }, "2026-11-03");
  const record = (value: ReviewLog) => reviewsCollection.toRecords(value)[0];

  it("keeps the ticks of both when only ticks differ", () => {
    const mine = toggleIntention(base, MON, 0);
    const theirs = toggleIntention(base, MON, 1);
    const sync = stampSaved(reviewsCollection, mine, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 50);
    const applied = applyReply([[reviewsCollection, mine]], sync, noWire,
      reply({ records: [{ ...record(theirs), updated: T0 }] }), T0 + 60);
    const joined = applied.values.get(reviewsCollection.key) as ReviewLog;
    expect(joined.reviews[0].intentions.map((i) => i.done)).toEqual([true, true]);
    expect(applied.sync.dirty).toContain(keyOf("review.week", MON));
  });

  it("takes the newer review when the words differ", () => {
    const mine = toggleIntention(base, MON, 0);
    const theirs = saved(base, { well: "Rewritten on the tablet", intentions: ["Sleep early"] }, "2026-11-04");
    const sync = stampSaved(reviewsCollection, mine, { ...emptyRecordsSync(WORKER), listened: true }, T0);
    const applied = applyReply([[reviewsCollection, mine]], sync, noWire,
      reply({ records: [{ ...record(theirs), updated: T0 + 500 }] }), T0 + 600);
    expect((applied.values.get(reviewsCollection.key) as ReviewLog).reviews[0]).toEqual(theirs.reviews[0]);
  });
});
