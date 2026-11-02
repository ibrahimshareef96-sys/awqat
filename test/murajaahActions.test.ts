// @vitest-environment happy-dom
// The plan's actions: a plan is shown only once it is saved, All and None tick the juz, and "Revise" (from Home's line
// or the widget) opens the juz left today at its weakest page.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../src/quran/mushafFiles.ts", () => ({
  cachedPage: vi.fn(), loadedFont: vi.fn(), loadPage: vi.fn(), pageFont: vi.fn(), downloadFont: vi.fn(),
  fontsOnPhone: vi.fn(async () => 0),
}));
vi.mock("../src/store.ts", () => ({
  KEYS: { quran: "quran", mushaf: "mushaf", murajaah: "murajaah" }, write: store.write, read: vi.fn(), keepAside: vi.fn(),
}));

import { emptyQuranLog, logRevision } from "../src/quran/log.ts";
import { emptyMarks, markMistake } from "../src/quran/marks.ts";
import { makePlan } from "../src/quran/murajaah.ts";
import { hooks, state, today } from "../src/app/state.ts";
import { chooseAll, reviseTarget, savePlan } from "../src/app/murajaahActions.ts";

beforeEach(() => {
  store.write.mockReset();
  store.write.mockResolvedValue(true);
  state.murajaah = null;
  state.quran = emptyQuranLog();
  state.mushaf = emptyMarks();
  state.blocked.clear();
  state.notice = "";
  hooks.render = vi.fn();
  hooks.closeSheet = vi.fn();
  document.body.innerHTML = `<div id="overlay"><input type="checkbox" name="juz" value="1">` +
    `<input type="checkbox" name="juz" value="2" checked><p data-sheet-error hidden></p></div><div id="live"></div>`;
});

describe("saving the plan", () => {
  it("shows the plan once it is saved, and closes the sheet", async () => {
    await savePlan(["30", "29"], "2");
    expect(state.murajaah).toEqual({ v: 1, perDay: 2, juz: [29, 30] });
    expect(hooks.closeSheet).toHaveBeenCalledWith(true);
  });

  it("refuses a plan with no juz, and keeps the sheet open saying why", async () => {
    await savePlan([], "1");
    expect(store.write).not.toHaveBeenCalled();
    expect(document.querySelector("[data-sheet-error]")?.textContent).toBe("Choose at least one juz.");
  });

  it("is not shown when it could not be saved", async () => {
    store.write.mockResolvedValue(false);
    await savePlan(["1"], "1");
    expect(state.murajaah).toBeNull();
    expect(hooks.closeSheet).not.toHaveBeenCalled();
    expect(document.querySelector("[data-sheet-error]")?.textContent).toMatch(/could not be saved/);
  });
});

describe("All and None", () => {
  it("tick and clear every juz in the sheet", () => {
    chooseAll(true);
    expect([...document.querySelectorAll<HTMLInputElement>('input[name="juz"]')].every((b) => b.checked)).toBe(true);
    chooseAll(false);
    expect([...document.querySelectorAll<HTMLInputElement>('input[name="juz"]')].some((b) => b.checked)).toBe(false);
  });
});

describe("where Revise opens", () => {
  it("is the Quran screen without a plan", () => {
    expect(reviseTarget()).toBe("quran");
  });

  it("is today's juz at its weakest page, or its first page", () => {
    state.murajaah = makePlan([15, 16], 1);
    expect(reviseTarget()).toBe("mushaf:282");
    state.mushaf = markMistake(emptyMarks(), "17:105:2", today());
    expect(reviseTarget()).toBe("mushaf:293");
  });

  it("is the next juz once today's is done", () => {
    state.murajaah = makePlan([15, 16], 1);
    state.quran = logRevision(emptyQuranLog(), today(), 15);
    expect(reviseTarget()).toBe("mushaf:302");
  });
});
