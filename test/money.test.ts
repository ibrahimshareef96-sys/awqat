// Money: what came in, who owes the user, what goes out each month, against a goal. Every change returns a new value.
import { describe, expect, it } from "vitest";
import {
  addCommitment, addIncome, addOwed, checkMoney, emptyMoney, markPaid, monthSummary, parseAmount, removeCommitment, removeIncome,
  removeOwed, setGoal, toAed, USD_TO_AED, type Money,
} from "../src/money/money.ts";

const TODAY = "2026-10-30";

function filled(): Money {
  let m = emptyMoney();
  m = setGoal(m, 3_000_000, "AED");
  m = addIncome(m, { id: "a-1", date: "2026-10-05", cents: 1_200_000, currency: "AED", from: "Acme Studio" });
  m = addIncome(m, { id: "a-2", date: "2026-10-12", cents: 10_000, currency: "USD", from: "Corner Bakery" });
  m = addIncome(m, { id: "a-3", date: "2026-09-20", cents: 900_000, currency: "AED", from: "September client" });
  m = addOwed(m, { id: "o-1", who: "Example Trading Co", cents: 300_000, currency: "AED", due: "2026-10-20" });
  m = addOwed(m, { id: "o-2", who: "Later", cents: 100_000, currency: "USD", due: "2026-11-20" });
  return addCommitment(m, { id: "c-1", name: "Example subscription", cents: 240_000, currency: "AED" });
}

describe("reading an amount", () => {
  it("takes what the user would type", () => {
    expect(parseAmount("12000")).toBe(1_200_000);
    expect(parseAmount("12,000")).toBe(1_200_000);
    expect(parseAmount(" 2,400.50 ")).toBe(240_050);
    expect(parseAmount("0.5")).toBe(50);
  });

  it("refuses what is not an amount", () => {
    for (const bad of ["", "abc", "-5", "0", "1.234", "12,34", "1e5", "99999999999", null, 5]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("the month", () => {
  it("adds what came in this month, with dollars at the peg", () => {
    const s = monthSummary(filled(), TODAY);
    expect(s.inAed).toBe(1_200_000 + 36_725);
    expect(s.lastMonthAed).toBe(900_000);
    expect(s.goalAed).toBe(3_000_000);
    expect(s.toGoAed).toBe(3_000_000 - 1_236_725);
    expect(s.percent).toBe(41);
    expect(s.entries.map((e) => e.id)).toEqual(["a-2", "a-1"]);
  });

  it("counts owed money and what is overdue", () => {
    const s = monthSummary(filled(), TODAY);
    expect(s.owedAed).toBe(300_000 + toAed(100_000, "USD"));
    expect(s.overdue).toBe(1);
    expect(s.owed.map((o) => o.id)).toEqual(["o-1", "o-2"]);
  });

  it("says what is left after the month's commitments", () => {
    const s = monthSummary(filled(), TODAY);
    expect(s.commitmentsAed).toBe(240_000);
    expect(s.afterAed).toBe(1_236_725 - 240_000);
  });

  it("has no goal line without a goal, and never goes below nothing to go", () => {
    const none = monthSummary(emptyMoney(), TODAY);
    expect(none.goalAed).toBeNull();
    expect(none.percent).toBeNull();
    const over = monthSummary(setGoal(filled(), 100, "AED"), TODAY);
    expect(over.toGoAed).toBe(0);
    expect(over.percent).toBe(100);
  });

  it("says 100 percent only once the goal is reached", () => {
    const m = addIncome(setGoal(emptyMoney(), 1_000_000, "AED"), { id: "a-1", date: TODAY, cents: 995_000, currency: "AED", from: "x" });
    expect(monthSummary(m, TODAY).percent).toBe(99);
  });

  it("keeps rows from other months and any future date where they can be found", () => {
    const m = addIncome(filled(), { id: "f-1", date: "2062-10-30", cents: 100, currency: "AED", from: "wrong year" });
    expect(monthSummary(m, TODAY).older.map((e) => e.id)).toEqual(["f-1", "a-3"]);
  });

  it("lists earlier months, newest first, six at most", () => {
    let m = emptyMoney();
    for (let i = 1; i <= 9; i += 1) {
      m = addIncome(m, { id: `m-${i}`, date: `2026-0${i}-10`, cents: i * 100, currency: "AED", from: "x" });
    }
    const s = monthSummary(m, TODAY);
    expect(s.earlier.map((e) => e.month)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04"]);
    expect(s.earlier[0].aed).toBe(900);
  });

  it("carries the year across January", () => {
    const m = addIncome(emptyMoney(), { id: "d-1", date: "2026-12-31", cents: 700, currency: "AED", from: "x" });
    expect(monthSummary(m, "2027-01-02").lastMonthAed).toBe(700);
  });

  it("turns dollars to dirhams at the peg, to the fil", () => {
    expect(USD_TO_AED).toBe(3.6725);
    expect(toAed(100, "USD")).toBe(367);
    expect(toAed(100, "AED")).toBe(100);
  });
});

describe("changes", () => {
  it("never changes the value it was given", () => {
    const before = filled();
    const copy = JSON.stringify(before);
    markPaid(before, "o-1", TODAY, "p-1");
    removeIncome(before, "a-1");
    removeOwed(before, "o-1");
    removeCommitment(before, "c-1");
    setGoal(before, null, "AED");
    expect(JSON.stringify(before)).toBe(copy);
  });

  it("turns money owed into money that came in when paid", () => {
    const m = markPaid(filled(), "o-1", TODAY, "p-1");
    expect(m.owed.map((o) => o.id)).toEqual(["o-2"]);
    expect(m.entries.find((e) => e.id === "p-1")).toEqual({ id: "p-1", date: TODAY, cents: 300_000, currency: "AED", from: "Example Trading Co" });
  });

  it("leaves everything alone when paying what is not owed", () => {
    const m = filled();
    expect(markPaid(m, "nope", TODAY, "p-1")).toBe(m);
  });

  it("leaves a full list as it was, so the sheet can say so", () => {
    let m = emptyMoney();
    for (let i = 0; i < 200; i += 1) m = addCommitment(m, { id: `c-${i}`, name: "x", cents: 1, currency: "AED" });
    expect(addCommitment(m, { id: "c-new", name: "x", cents: 1, currency: "AED" })).toBe(m);
    expect(addCommitment(m, { id: "c-0", name: "edited", cents: 1, currency: "AED" }).commitments).toHaveLength(200);
  });

  it("drops characters that hide or reorder a name", () => {
    const m = addOwed(emptyMoney(), { id: "o-1", who: `a${String.fromCodePoint(0x202e)}b`, cents: 1, currency: "AED", due: "" });
    expect(m.owed[0].who).toBe("ab");
    expect(addOwed(emptyMoney(), { id: "o-1", who: String.fromCodePoint(0x202e), cents: 1, currency: "AED", due: "" }).owed).toEqual([]);
  });

  it("does not add the same entry twice", () => {
    const entry = { id: "a-1", date: TODAY, cents: 100, currency: "AED", from: "x" } as const;
    const m = addIncome(addIncome(emptyMoney(), entry), entry);
    expect(m.entries).toHaveLength(1);
  });

  it("refuses an entry that does not check", () => {
    const m = emptyMoney();
    expect(addIncome(m, { id: "a-1", date: "soon", cents: 100, currency: "AED", from: "x" })).toBe(m);
    expect(addIncome(m, { id: "a-1", date: TODAY, cents: -1, currency: "AED", from: "x" })).toBe(m);
    expect(addOwed(m, { id: "bad id!", who: "x", cents: 1, currency: "AED", due: "" })).toBe(m);
    expect(addCommitment(m, { id: "c-1", name: "", cents: 1, currency: "AED" })).toBe(m);
  });
});

describe("what was saved", () => {
  it("reads back what it wrote", () => {
    const m = filled();
    const back = checkMoney(JSON.stringify(m));
    expect(back.damaged).toBe(false);
    expect(back.money).toEqual(m);
  });

  it("starts empty when nothing was saved", () => {
    expect(checkMoney(null)).toEqual({ money: emptyMoney(), damaged: false });
  });

  it("says when what was saved is not money", () => {
    expect(checkMoney("{").damaged).toBe(true);
    expect(checkMoney('{"v":2}').damaged).toBe(true);
    expect(checkMoney("[]").damaged).toBe(true);
  });

  it("drops a bad row and says so, keeping the rest", () => {
    const m = filled();
    const raw = { ...m, entries: [...m.entries, { id: "x-1", date: "nope", cents: 1, currency: "AED", from: "x" },
      { id: "x-2", date: TODAY, cents: 1, currency: "GBP", from: "x" }] };
    const back = checkMoney(JSON.stringify(raw));
    expect(back.damaged).toBe(true);
    expect(back.money.entries).toHaveLength(m.entries.length);
  });

  it("keeps a limit on names and on rows from another device", () => {
    const long = "x".repeat(500);
    const raw = { v: 1, goal: null, owed: [], commitments: [],
      entries: Array.from({ length: 30_000 }, (_, i) => ({ id: `e-${i}`, date: TODAY, cents: 1, currency: "AED", from: long })) };
    const back = checkMoney(JSON.stringify(raw));
    expect(back.money.entries.length).toBeLessThanOrEqual(20_000);
    expect(back.money.entries[0].from.length).toBeLessThanOrEqual(80);
  });
});
