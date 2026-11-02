// What Learn starts with: three empty Islamic tracks with fixed ids, only where Learn was never saved; nothing when the
// store could not be read; what was saved otherwise (so a deleted track never returns).
import { describe, expect, it } from "vitest";
import { checkLearn, emptyLearn, isId, removeItem } from "../src/learn/learn.ts";
import { SEED_DATE, seedLearn, startingLearn } from "../src/learn/seed.ts";
import { sampleLearn } from "./fixtures/learn.ts";

describe("the seed", () => {
  it("has three Islamic tracks with fixed ids, empty and untargeted, and nothing personal", () => {
    const learn = seedLearn();
    expect(learn.tracks.map((t) => [t.id, t.name, t.kind, t.weeklyMinutes])).toEqual([
      ["track-tafsir", "Tafsir", "islamic", 0], ["track-hadith", "Hadith", "islamic", 0], ["track-fiqh", "Fiqh", "islamic", 0],
    ]);
    expect(learn.items).toEqual([]);
    expect(learn.sessions).toEqual([]);
    expect(learn.lessons).toEqual([]);
  });

  it("keeps every record to the rules: ids, fixed dates", () => {
    const learn = seedLearn();
    expect(learn.tracks.every((r) => isId(r.id) && r.added === SEED_DATE && !r.archived)).toBe(true);
    expect(checkLearn(JSON.stringify(learn))).toEqual({ learn, damaged: false });
  });

  it("is the same on every device", () => {
    expect(seedLearn()).toEqual(seedLearn());
  });
});

describe("where Learn starts", () => {
  it("seeds only when nothing was ever saved", () => {
    expect(startingLearn({ ok: true, value: null })).toEqual({ learn: seedLearn(), damaged: false });
  });

  it("never seeds again once something was changed, even after deleting every item", () => {
    const emptied = sampleLearn().items.reduce((l, i) => removeItem(l, i.id), sampleLearn());
    expect(startingLearn({ ok: true, value: JSON.stringify(emptied) }).learn.items).toEqual([]);
    expect(startingLearn({ ok: true, value: JSON.stringify(emptyLearn()) }).learn).toEqual(emptyLearn());
  });

  it("starts empty, and not seeded, when the store could not be read", () => {
    expect(startingLearn({ ok: false, value: null })).toEqual({ learn: emptyLearn(), damaged: false });
  });

  it("calls an unreadable saved value damaged, so a copy is kept aside", () => {
    expect(startingLearn({ ok: true, value: "{oops" })).toEqual({ learn: emptyLearn(), damaged: true });
  });
});
