// What Money draws, and how it travels between devices.
import { describe, expect, it } from "vitest";
import { addCommitment, addIncome, addOwed, checkMoney, emptyMoney, setGoal, type Money } from "../src/money/money.ts";
import { moneyCollection } from "../src/sync/collections.ts";
import { RECORD_ID, RECORD_KIND } from "../src/sync/records.ts";
import { amountText, moneySheet, moneyView, type MoneyModel } from "../src/ui/moneyView.ts";

const TODAY = "2026-10-30";
const model = (money: Money, armed: string | null = null): MoneyModel => ({ money, today: TODAY, armed });

function filled(): Money {
  let m = setGoal(emptyMoney(), 3_000_000, "AED");
  m = addIncome(m, { id: "a-1", date: "2026-10-05", cents: 1_200_000, currency: "AED", from: "Acme Studio" });
  m = addOwed(m, { id: "o-1", who: "Example Trading Co", cents: 300_000, currency: "AED", due: "2026-10-20" });
  return addCommitment(m, { id: "c-1", name: "Example subscription", cents: 240_000, currency: "AED" });
}

describe("the screen", () => {
  const draw = (m: MoneyModel) => moneyView(m, "", "", "");

  it("writes amounts as the user reads them", () => {
    expect(amountText(1_200_000, "AED")).toBe("AED 12,000");
    expect(amountText(240_050, "AED")).toBe("AED 2,400.50");
    expect(amountText(10_000, "USD")).toBe("USD 100");
  });

  it("starts with the two things the user can do, and no empty lists", () => {
    const html = draw(model(emptyMoney()));
    expect(html).toContain("AED 0");
    expect(html).toContain("No monthly goal yet");
    expect(html).toContain('data-value="in"');
    expect(html).toContain('data-value="owed"');
    expect(html).not.toContain("OWED TO YOU");
    expect(html).not.toContain("CAME IN");
  });

  it("shows the month against the goal, what is owed and what goes out", () => {
    const html = draw(model(filled()));
    expect(html).toContain("OCTOBER 2026");
    expect(html).toContain("AED 12,000");
    expect(html).toContain("AED 18,000 to go of AED 30,000");
    expect(html).toContain('data-w="40"');
    expect(html).toContain("Was due 20 Oct");
    expect(html).toContain("1 overdue");
    expect(html).toContain("AED 9,600 left this month after these");
  });

  it("says when commitments are more than came in", () => {
    const m = addCommitment(emptyMoney(), { id: "c-1", name: "Example subscription", cents: 240_000, currency: "AED" });
    expect(draw(model(m))).toContain("AED 2,400 short of these this month");
  });

  it("says when the goal is reached", () => {
    expect(draw(model(setGoal(filled(), 100_000, "AED")))).toContain("Goal of AED 1,000 reached");
  });

  it("escapes what the user typed", () => {
    const m = addOwed(emptyMoney(), { id: "o-1", who: "<img src=x>", cents: 100, currency: "AED", due: "" });
    expect(draw(model(m))).not.toContain("<img src=x>");
  });

  it("asks for a second tap before paid or remove", () => {
    expect(draw(model(filled(), "paid:o-1"))).toContain("Tap again: paid today");
    expect(draw(model(filled(), "owed:o-1"))).toContain("Tap again to remove");
  });

  it("has a labelled field for everything a sheet asks", () => {
    for (const kind of ["in", "owed", "out", "goal"] as const) {
      const html = moneySheet(kind, model(filled()));
      expect(html).toContain('data-form="money"');
      expect(html).toContain('for="ms-amount"');
      expect(html).toContain('for="ms-currency"');
      expect(html.match(/data-autofocus/g)).toHaveLength(1);
    }
    expect(moneySheet("in", model(filled()))).toContain(`value="${TODAY}"`);
    expect(moneySheet("goal", model(filled()))).toContain('value="30000"');
  });
});

describe("syncing", () => {
  it("sends each row under an id and kind the Worker takes", () => {
    const records = moneyCollection.toRecords(filled());
    expect(records.map((r) => r.kind).sort()).toEqual(["money.commitment", "money.entry", "money.goal", "money.owed"]);
    for (const r of records) {
      expect(RECORD_ID.test(r.id)).toBe(true);
      expect(RECORD_KIND.test(r.kind)).toBe(true);
    }
  });

  it("comes back the same on another device", () => {
    const m = filled();
    const back = moneyCollection.fromRecords(moneyCollection.toRecords(m).map((r) => ({ ...r, updated: 1 })) as never, emptyMoney());
    expect(back).toEqual(m);
  });

  it("checks what arrives, like what is read from the phone", () => {
    const bad = [{ kind: "money.entry", id: "a-1", data: { date: "soon", cents: "lots", currency: "AED", from: "x" }, updated: 1 }];
    expect(moneyCollection.fromRecords(bad as never, emptyMoney()).entries).toEqual([]);
    expect(checkMoney(JSON.stringify(emptyMoney())).damaged).toBe(false);
  });

  it("sends no goal when there is none", () => {
    expect(moneyCollection.toRecords(emptyMoney())).toEqual([]);
  });
});
