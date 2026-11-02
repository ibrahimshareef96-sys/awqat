// @vitest-environment happy-dom
// The adhkar lists' taps: a count shows at once and is saved in order behind it, Done says a dhikr in full or clears
// it, the end of Al-Baqarah waits for Maghrib, and a set finished or opened again plans the reminders again.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../src/store.ts", () => ({ KEYS: { adhkar: "adhkar" }, write: store.write, read: vi.fn(), keepAside: vi.fn() }));

import { adhkarFor, countOf, emptyAdhkarLog, setDone } from "../src/faith/adhkar.ts";
import type { DayTimes } from "../src/prayer/times.ts";
import { MESSAGES, hooks, state } from "../src/app/state.ts";
import { adhkarDate, count, lockedUntil, openSession, saved, toggleDone } from "../src/app/adhkarActions.ts";

const at = (time: string, date = "2026-10-27"): Date => new Date(`${date}T${time}:00+04:00`);
function day(date: string): DayTimes {
  return { date, fajr: at("05:06", date), sunrise: at("06:20", date), dhuhr: at("12:06", date), asr: at("15:20", date),
    maghrib: at("17:46", date), isha: at("19:00", date), method: "Dubai", adjusted: "none" };
}

const MORNING = at("06:00");
const EVENING = at("16:00");

beforeEach(() => {
  store.write.mockReset();
  store.write.mockResolvedValue(true);
  state.days = ["2026-10-26", "2026-10-27", "2026-10-28"].map(day);
  state.adhkar = emptyAdhkarLog();
  state.screen = "adhkar:morning";
  state.blocked.clear();
  state.notice = "";
  hooks.render = vi.fn();
  hooks.reschedule = vi.fn(async () => undefined);
  document.body.innerHTML = `<div id="live"></div>`;
});

describe("which set and day", () => {
  it("knows the set on screen, and keeps an evening said after midnight on its own day", () => {
    expect(openSession()).toBe("morning");
    state.screen = "adhkar:evening";
    expect(openSession()).toBe("evening");
    state.screen = "faith";
    expect(openSession()).toBeNull();
    expect(adhkarDate(at("00:30", "2026-10-28"))).toBe("2026-10-27");
    expect(adhkarDate(MORNING)).toBe("2026-10-27");
    state.days = [];
    expect(adhkarDate(MORNING)).toBeNull();
  });
});

describe("counting", () => {
  it("adds one per tap, shows it at once, and says it", async () => {
    count("17", MORNING);
    count("17", MORNING);
    expect(countOf(state.adhkar, "2026-10-27", "morning", 17)).toBe(2);
    expect(hooks.render).toHaveBeenCalledTimes(2);
    expect(document.getElementById("live")?.textContent).toBe("Allah is enough for me: 2 of 7.");
    await saved();
    expect(store.write).toHaveBeenLastCalledWith("adhkar", state.adhkar);
  });

  it("saves one at a time, the last save holding every tap", async () => {
    let release: () => void = () => undefined;
    store.write.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = () => resolve(true); }));
    count("34", MORNING);
    await Promise.resolve();
    for (let i = 0; i < 20; i += 1) count("34", MORNING);
    release();
    await saved();
    // The first save, then one more covering the twenty taps that came while it was going.
    expect(store.write).toHaveBeenCalledTimes(2);
    expect(store.write).toHaveBeenLastCalledWith("adhkar", state.adhkar);
    expect(countOf(state.adhkar, "2026-10-27", "morning", 34)).toBe(21);
  });

  it("does nothing for an item not in the set on screen, or off an adhkar screen", () => {
    count("8", MORNING);
    state.screen = "home";
    count("17", MORNING);
    expect(state.adhkar).toEqual(emptyAdhkarLog());
    expect(hooks.render).not.toHaveBeenCalled();
  });

  it("refuses to count when the saved counts could not be read, and says so", () => {
    state.blocked.add("adhkar");
    count("17", MORNING);
    expect(state.adhkar).toEqual(emptyAdhkarLog());
    expect(state.notice).toBe(MESSAGES.unreadable);
  });

  it("shows a save that failed, keeping the count on screen", async () => {
    store.write.mockResolvedValue(false);
    count("17", MORNING);
    await saved();
    expect(state.notice).toBe(MESSAGES.unsaved);
    expect(countOf(state.adhkar, "2026-10-27", "morning", 17)).toBe(1);
    expect(hooks.render).toHaveBeenCalledTimes(2);
  });
});

describe("Done", () => {
  it("says a dhikr in full, and a second Done clears it", () => {
    toggleDone("34", MORNING);
    expect(countOf(state.adhkar, "2026-10-27", "morning", 34)).toBe(100);
    toggleDone("34", MORNING);
    expect(countOf(state.adhkar, "2026-10-27", "morning", 34)).toBe(0);
  });

  it("plans the reminders again when the set is finished, and again when it is opened up", () => {
    const list = adhkarFor("morning");
    state.adhkar = list.slice(1).reduce((log, item) => setDone(log, "2026-10-27", "morning", item.id, true), emptyAdhkarLog());
    toggleDone(String(list[0].id), MORNING);
    expect(hooks.reschedule).toHaveBeenCalledTimes(1);
    expect(document.getElementById("live")?.textContent).toBe("Adhkar al-Sabah complete.");
    toggleDone(String(list[0].id), MORNING);
    expect(hooks.reschedule).toHaveBeenCalledTimes(2);
  });
});

describe("keeping the reminder in step", () => {
  it("plans again once all but the end of Al-Baqarah is said, the point the evening's reminder goes", () => {
    state.screen = "adhkar:evening";
    const dayItems = adhkarFor("evening").filter((i) => !i.night);
    state.adhkar = dayItems.slice(1).reduce((log, item) => setDone(log, "2026-10-27", "evening", item.id, true),
      emptyAdhkarLog());
    toggleDone(String(dayItems[0].id), EVENING);
    expect(hooks.reschedule).toHaveBeenCalledTimes(1);
  });

  it("keeps saving after a redraw that failed", async () => {
    store.write.mockResolvedValueOnce(false);
    hooks.render = vi.fn(() => { throw new Error("redraw"); });
    try {
      count("17", MORNING);
    } catch {
      // The tap's own redraw throws here too; the save chain is what this test is about.
    }
    await saved();
    hooks.render = vi.fn();
    count("17", MORNING);
    await saved();
    expect(store.write).toHaveBeenCalledTimes(2);
  });
});

describe("the end of Al-Baqarah", () => {
  it("waits for Maghrib of the day it is counted for", () => {
    state.screen = "adhkar:evening";
    expect(lockedUntil("evening", 3, "2026-10-27", EVENING)).toEqual(at("17:46"));
    count("3", EVENING);
    toggleDone("3", EVENING);
    expect(state.adhkar).toEqual(emptyAdhkarLog());
    count("3", at("18:00"));
    expect(countOf(state.adhkar, "2026-10-27", "evening", 3)).toBe(1);
    expect(lockedUntil("evening", 2, "2026-10-27", EVENING)).toBeNull();
  });
});
