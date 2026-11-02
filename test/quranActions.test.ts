// @vitest-environment happy-dom
// The Quran screen's log and the mushaf's bookmark: logging moves the bookmark (quran/bookmark.ts), and both are saved.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../src/store.ts", () => ({
  KEYS: { quran: "quran", mushaf: "mushaf" }, write: store.write, read: vi.fn(), keepAside: vi.fn(),
}));

import { emptyQuranLog, setPosition } from "../src/quran/log.ts";
import { emptyMarks } from "../src/quran/marks.ts";
import { hooks, state } from "../src/app/state.ts";
import * as quran from "../src/app/quranActions.ts";

const AT = Date.UTC(2026, 9, 28, 12);
const saved = (key: string) => store.write.mock.calls.filter((c) => (c as unknown[])[0] === key).length;

beforeEach(() => {
  store.write.mockClear();
  state.blocked.clear();
  state.quran = setPosition(emptyQuranLog(), 3);
  state.mushaf = { ...emptyMarks(), lastPage: 411, lastPageAt: AT };
  state.undoArmed = false;
  hooks.render = vi.fn();
  document.body.innerHTML = `<div id="live"></div>`;
});

describe("logging on the Quran screen", () => {
  it("leaves the bookmark on Luqman when the user logs a few pages from Al-Baqara", async () => {
    quran.readMore(2);
    await Promise.resolve();
    expect(state.quran.position).toBe(5);
    expect(state.mushaf).toMatchObject({ lastPage: 411, lastPageAt: AT });
    expect(saved("mushaf")).toBe(0);
  });

  it("moves the bookmark to the page after the user's place when the user sets it", async () => {
    quran.setPlace(411);
    await vi.waitFor(() => expect(saved("mushaf")).toBe(1));
    expect(state.mushaf.lastPage).toBe(412);
    expect(state.mushaf.lastPageAt).toBeGreaterThan(AT);
    expect(saved("quran")).toBe(1);
  });

  it("takes the bookmark back to page 1 when a full reading is complete", async () => {
    state.quran = setPosition(emptyQuranLog(), 600);
    state.mushaf = { ...state.mushaf, lastPage: 604 };
    quran.readTo(604);
    await vi.waitFor(() => expect(saved("mushaf")).toBe(1));
    expect(state.quran.completed).toBe(1);
    expect(state.mushaf.lastPage).toBe(1);
  });

  it("starts from the page after the user's place when the bookmark was never set (marks from 0.12)", async () => {
    state.quran = setPosition(emptyQuranLog(), 300);
    state.mushaf = { ...emptyMarks(), lastPage: 82, lastPageAt: 0 };
    quran.readMore(2);
    await vi.waitFor(() => expect(saved("mushaf")).toBe(1));
    expect(state.mushaf.lastPage).toBe(303);
    expect(state.mushaf.lastPageAt).toBeGreaterThan(0);
  });

  it("brings the bookmark back with an undone reading it was following", async () => {
    state.quran = setPosition(emptyQuranLog(), 410);
    state.mushaf = { ...state.mushaf, lastPage: 411 };
    quran.readTo(420);
    await vi.waitFor(() => expect(state.mushaf.lastPage).toBe(421));
    quran.undoLastRead();
    quran.undoLastRead();
    await vi.waitFor(() => expect(state.mushaf.lastPage).toBe(411));
    expect(state.quran.position).toBe(410);
  });
});
