// Saved data that could not be read is kept aside, once per value, and only the latest few copies.
import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    keys: async () => ({ keys: [...prefs.keys()] }),
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefs.set(key, value); },
    remove: async ({ key }: { key: string }) => { prefs.delete(key); },
  },
}));

import { Preferences } from "@capacitor/preferences";
import { keepAside } from "../src/store.ts";

const copies = (key: string): string[] => [...prefs.keys()].filter((k) => k.startsWith(`${key}.unreadable.`)).sort();

beforeEach(() => {
  prefs.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
});

describe("keeping unreadable data aside", () => {
  it("keeps a value once, however many restarts find it", async () => {
    await keepAside("os.mushaf.v1", "{broken");
    vi.advanceTimersByTime(1000);
    await keepAside("os.mushaf.v1", "{broken");
    expect(copies("os.mushaf.v1")).toHaveLength(1);
  });

  it("keeps the five latest different values, and leaves other keys alone", async () => {
    prefs.set("os.quran.v1.unreadable.1700000000000", "other");
    for (let i = 0; i < 7; i += 1) {
      vi.advanceTimersByTime(1000);
      await keepAside("os.mushaf.v1", `{broken ${i}`);
    }
    const kept = copies("os.mushaf.v1").map((k) => prefs.get(k));
    expect(kept).toEqual(["{broken 2", "{broken 3", "{broken 4", "{broken 5", "{broken 6"]);
    expect(prefs.get("os.quran.v1.unreadable.1700000000000")).toBe("other");
  });

  it("still makes the copy when the existing copies cannot be listed", async () => {
    const keys = vi.spyOn(Preferences, "keys").mockRejectedValueOnce(new Error("busy"));
    expect(await keepAside("os.mushaf.v1", "{broken")).toBe(true);
    expect(copies("os.mushaf.v1")).toHaveLength(1);
    keys.mockRestore();
  });

  it("says when no copy could be made, so the original is left alone", async () => {
    const set = vi.spyOn(Preferences, "set").mockRejectedValueOnce(new Error("full"));
    expect(await keepAside("os.mushaf.v1", "{broken")).toBe(false);
    set.mockRestore();
  });
});
