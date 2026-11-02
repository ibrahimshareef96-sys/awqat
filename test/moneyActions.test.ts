// @vitest-environment happy-dom
// Money's actions: saving from the sheet, two taps to pay or remove, a failed save taken back.
import { beforeEach, describe, expect, it, vi } from "vitest";

const written = vi.hoisted(() => ({ ok: true }));
vi.mock("../src/store.ts", async (real) => ({
  ...(await real<typeof import("../src/store.ts")>()),
  write: async () => written.ok,
}));

import * as money from "../src/app/moneyActions.ts";
import { hooks, state } from "../src/app/state.ts";
import { addOwed, emptyMoney } from "../src/money/money.ts";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  written.ok = true;
  state.money = emptyMoney();
  state.moneySheet = "in";
  state.moneyArmed = null;
  state.blocked.clear();
  state.notice = "";
  hooks.render = () => {};
  hooks.renderOverlay = () => {};
  hooks.closeSheet = () => {};
  hooks.saved = () => {};
});

describe("the sheet", () => {
  it("adds money that came in, and closes", async () => {
    const close = vi.fn();
    hooks.closeSheet = close;
    await money.submit(form({ amount: "12,000", currency: "AED", who: "Acme Studio", day: "2026-10-05" }));
    expect(state.money.entries[0]).toMatchObject({ cents: 1_200_000, from: "Acme Studio", date: "2026-10-05" });
    expect(close).toHaveBeenCalled();
  });

  it("says what is missing, and keeps the sheet open", async () => {
    const close = vi.fn();
    hooks.closeSheet = close;
    await money.submit(form({ amount: "12,000", who: "" }));
    await money.submit(form({ amount: "lots", who: "x" }));
    expect(state.money.entries).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });

  it("does not add twice on a double tap", async () => {
    const f = form({ amount: "100", who: "x", day: "2026-10-05" });
    await Promise.all([money.submit(f, 1), money.submit(f, 2)]);
    expect(state.money.entries).toHaveLength(1);
  });

  it("takes the row back when the phone could not save it, and leaves the sheet open", async () => {
    written.ok = false;
    const close = vi.fn();
    hooks.closeSheet = close;
    await money.submit(form({ amount: "100", who: "x", day: "2026-10-05" }));
    expect(state.money.entries).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });

  it("refuses money dated in the future, and says where it belongs", async () => {
    const close = vi.fn();
    hooks.closeSheet = close;
    await money.submit(form({ amount: "100", who: "x", day: "2999-01-01" }));
    expect(state.money.entries).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });

  it("puts the goal back when the phone could not save the new one", async () => {
    state.moneySheet = "goal";
    await money.submit(form({ amount: "30000", currency: "AED" }));
    written.ok = false;
    await money.submit(form({ amount: "60000", currency: "AED" }));
    expect(state.money.goal?.cents).toBe(3_000_000);
    await money.submit(form({ amount: "", currency: "AED" }));
    expect(state.money.goal?.cents).toBe(3_000_000);
  });

  it("sets a goal, and an empty amount clears it", async () => {
    state.moneySheet = "goal";
    await money.submit(form({ amount: "30000", currency: "AED" }));
    expect(state.money.goal).toEqual({ cents: 3_000_000, currency: "AED" });
    await money.submit(form({ amount: "", currency: "AED" }));
    expect(state.money.goal).toBeNull();
  });

  it("adds a debt with no due date, and a monthly payment", async () => {
    state.moneySheet = "owed";
    await money.submit(form({ amount: "300", who: "Example Trading Co", day: "" }));
    expect(state.money.owed[0]).toMatchObject({ who: "Example Trading Co", due: "" });
    state.moneySheet = "out";
    await money.submit(form({ amount: "2,400.50", who: "Example subscription" }));
    expect(state.money.commitments[0]).toMatchObject({ name: "Example subscription", cents: 240_050 });
  });

  it("refuses a sheet it does not know", () => {
    state.sheet = null;
    money.openSheet("nonsense");
    expect(state.sheet).toBeNull();
  });
});

describe("two taps", () => {
  beforeEach(() => {
    state.money = addOwed(emptyMoney(), { id: "o-1", who: "Example Trading Co", cents: 100, currency: "AED", due: "" });
  });

  it("pays on the second tap only, and that money comes in", async () => {
    await money.paidTap("o-1", 10_000);
    expect(state.money.owed).toHaveLength(1);
    expect(state.moneyArmed).toBe("paid:o-1");
    await money.paidTap("o-1", 11_000);
    expect(state.money.owed).toEqual([]);
    expect(state.money.entries[0].from).toBe("Example Trading Co");
  });

  it("gives Paid the same entry on any device, so two taps before a sync are one amount", async () => {
    await money.paidTap("o-1", 10_000);
    await money.paidTap("o-1", 11_000);
    expect(state.money.entries[0].id).toBe("p-o-1");
  });

  it("still confirms when the clock moved back between taps", async () => {
    await money.paidTap("o-1", 10_000);
    await money.paidTap("o-1", 5_000);
    expect(state.money.owed).toEqual([]);
  });

  it("treats two taps at once as one", async () => {
    await money.paidTap("o-1", 10_000);
    await money.paidTap("o-1", 10_100);
    expect(state.money.owed).toHaveLength(1);
  });

  it("removes on the second tap, and a tap elsewhere starts again", async () => {
    await money.removeTap("owed:o-1", 10_000);
    await money.paidTap("o-1", 11_000);
    await money.removeTap("owed:o-1", 12_000);
    expect(state.money.owed).toHaveLength(1);
    await money.removeTap("owed:o-1", 13_000);
    expect(state.money.owed).toEqual([]);
  });

  it("ignores a remove it does not understand", async () => {
    const before = state.money;
    await money.removeTap("nonsense:o-1", 10_000);
    expect(state.money).toBe(before);
    await money.paidTap("not-there", 10_000);
    expect(state.moneyArmed).toBeNull();
  });
});
