// @vitest-environment happy-dom
// The app's side of syncing the user's records: a save stamps and marks, a sync goes once changes settle (and keeps its gap),
// a first sync listens first, Learn's unsaved starting tracks give way to the user's other devices' Learn, and a "too many"
// from the Worker pauses both routes until the time it gave.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/device.ts", () => ({ isNative: () => true, platform: () => "android" }));
vi.mock("../src/store.ts", async (actual) => ({ ...(await actual<typeof import("../src/store.ts")>()),
  write: vi.fn(async () => true), read: vi.fn(), keepAside: vi.fn() }));
vi.mock("../src/talk/session.ts", async (actual) => ({ ...(await actual<typeof import("../src/talk/session.ts")>()),
  clearSession: vi.fn(async () => true) }));

import { KEYS, write } from "../src/store.ts";
import { cycleMark, emptyLog } from "../src/prayer/log.ts";
import { emptyLearn } from "../src/learn/learn.ts";
import { seedLearn } from "../src/learn/seed.ts";
import { emptyMarks } from "../src/quran/marks.ts";
import { addIncome, emptyMoney } from "../src/money/money.ts";
import { moneyCollection } from "../src/sync/collections.ts";
import { emptyRecordsSync, stampSaved, type Post, type Wire } from "../src/sync/records.ts";
import { held, resetPace } from "../src/sync/pace.ts";
import { hooks, state } from "../src/app/state.ts";
import { RECORDS_PAUSE_MS, recordSaved, resetRecordsSync, syncRecords } from "../src/app/recordsActions.ts";

const WORKER = "https://os.example.com";
const SESSION = "s".repeat(43);
const TODAY = "2026-10-28";
const answer = (data: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) =>
  ({ status, headers, url: "", data });
const empty = (cursor: number) => answer({ ok: true, cursor, more: false, records: [], removed: [] });

beforeEach(() => {
  vi.clearAllMocks();
  resetRecordsSync();
  resetPace();
  state.settings = { ...state.settings, voiceUrl: WORKER };
  state.talk = { phase: "idle", message: "", caption: "", muted: false, logged: "", session: { worker: WORKER, token: SESSION },
    sessionRead: true };
  state.log = emptyLog();
  state.learn = emptyLearn();
  state.learnSeedOnly = false;
  state.recordsSync = emptyRecordsSync();
  state.recordsNote = { state: "idle" };
  state.blocked.clear();
  hooks.softRender = vi.fn();
  hooks.reschedule = vi.fn(async () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  resetRecordsSync();
  resetPace();
});

describe("syncing the user's records", () => {
  it("listens first, then sends what is here, and saves its notes after the values", async () => {
    state.log = cycleMark(emptyLog(), TODAY, "fajr");
    const wires: Wire[] = [];
    await syncRecords(async (options) => {
      wires.push(options.data as Wire);
      return empty(wires.length === 1 ? 0 : 4);
    });
    expect(wires[0].records).toEqual([]);
    expect(wires[1].records.map((r) => r.kind).sort()).toEqual(expect.arrayContaining(["prayer.day", "prayer.owed"]));
    expect(state.recordsSync).toMatchObject({ worker: WORKER, cursor: 4, listened: true, dirty: [] });
    expect(state.recordsNote.state).toBe("synced");
  });

  it("puts a day marked on another device in place, saves it, and plans the reminders again", async () => {
    const theirs = cycleMark(emptyLog(), TODAY, "isha").days[TODAY];
    await syncRecords(async () => answer({ ok: true, cursor: 2, more: false, removed: [],
      records: [{ kind: "prayer.day", id: TODAY, updated: 1_800_000_000_000, data: theirs }] }));
    expect(state.log.days[TODAY].prayers.isha).toBeDefined();
    expect(write).toHaveBeenCalledWith(KEYS.log, state.log);
    expect(hooks.reschedule).toHaveBeenCalled();
  });

  it("tells the reader only when the bookmark itself arrived, not a mark or note beside it", async () => {
    const arrived = vi.fn();
    hooks.bookmarkArrived = arrived;
    state.mushaf = { ...emptyMarks(), lastPage: 411, lastPageAt: Date.UTC(2026, 9, 28, 12) };
    await syncRecords(async () => answer({ ok: true, cursor: 2, more: false, removed: [],
      records: [{ kind: "mushaf.pagenote", id: "411", updated: 1_800_000_000_000, data: { text: "Slow", updated: TODAY } }] }));
    expect(state.mushaf.pageNotes["411"]?.text).toBe("Slow");
    expect(arrived).not.toHaveBeenCalled();
    resetRecordsSync();
    await syncRecords(async () => answer({ ok: true, cursor: 3, more: false, removed: [],
      records: [{ kind: "mushaf.place", id: "place", updated: 1_800_000_000_001,
        data: { page: 412, at: Date.UTC(2026, 9, 28, 13) } }] }));
    expect(state.mushaf.lastPage).toBe(412);
    expect(arrived).toHaveBeenCalledTimes(1);
  });

  it("gives way to the user's other devices' Learn while this one only shows the starting tracks", async () => {
    state.learn = seedLearn();
    state.learnSeedOnly = true;
    const wires: Wire[] = [];
    const theirs = { id: "track-trading", name: "Trading", kind: "worldly", weeklyMinutes: 120, archived: false, added: TODAY };
    await syncRecords(async (options) => {
      wires.push(options.data as Wire);
      return answer({ ok: true, cursor: 3, more: false, removed: [],
        records: wires.length === 1 ? [{ kind: "learn.track", id: "track-trading", updated: 1_800_000_000_000, data: theirs }] : [] });
    });
    expect(wires.every((w) => w.records.every((r) => !r.kind.startsWith("learn.")))).toBe(true);
    expect(state.learn.tracks).toHaveLength(1);
    expect(state.learn.tracks[0].weeklyMinutes).toBe(120);
    expect(state.learn.items).toHaveLength(0);
    expect(state.learnSeedOnly).toBe(false);
  });

  it("keeps the starting tracks when no other device has Learn, and sends them once the user changes something", async () => {
    state.learn = seedLearn();
    state.learnSeedOnly = true;
    await syncRecords(async () => empty(0));
    expect(state.learn.tracks.length).toBeGreaterThan(0);
    expect(state.learnSeedOnly).toBe(true);
    recordSaved(KEYS.learn, state.learn);
    expect(state.learnSeedOnly).toBe(false);
    expect(state.recordsSync.dirty.some((key) => key.startsWith("learn.track/"))).toBe(true);
  });

  it("pauses both routes after a 'too many', until the time the Worker gave", async () => {
    const send = vi.fn<Post>(async () => answer({ error: "Too many syncs this hour." }, 429, { "Retry-After": "300" }));
    await syncRecords(send);
    expect(state.recordsNote.state).toBe("busy");
    expect(held()).toBe(true);
    send.mockClear();
    await syncRecords(send);
    expect(send).not.toHaveBeenCalled();
  });

  it("syncs a save once changes settle, and keeps the gap after the last sync", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T08:00:00Z"));
    const send = vi.fn<Post>(async () => empty(1));
    await syncRecords(send);
    const calls = send.mock.calls.length;
    state.log = cycleMark(state.log, TODAY, "dhuhr");
    recordSaved(KEYS.log, state.log);
    expect(state.recordsSync.dirty).toContain(`prayer.day/${TODAY}`);
    await vi.advanceTimersByTimeAsync(RECORDS_PAUSE_MS + 1);
    // The last sync was under 30 seconds ago: nothing yet.
    expect(send.mock.calls.length).toBe(calls);
  });

  it("takes in a paged run once it ends, so Learn items meet their track, and keeps the run's cursor out until then", async () => {
    state.recordsSync = { ...emptyRecordsSync(WORKER), listened: true };
    const track = { id: "track-x", name: "Usul", kind: "islamic", weeklyMinutes: 60, archived: false, added: TODAY };
    const item = { id: "item-x", trackId: "track-x", title: "Lecture 1", kind: "lecture", url: null, status: "todo",
      order: 0, added: TODAY, done: null };
    const cursors: number[] = [];
    await syncRecords(async (options) => {
      cursors.push((options.data as Wire).cursor);
      return cursors.length === 1
        ? answer({ ok: true, cursor: 5, more: true, removed: [], records: [{ kind: "learn.item", id: "item-x", updated: 1, data: item }] })
        : answer({ ok: true, cursor: 9, more: false, removed: [], records: [{ kind: "learn.track", id: "track-x", updated: 1, data: track }] });
    });
    expect(cursors).toEqual([0, 5]);
    expect(state.learn.items.map((i) => i.id)).toEqual(["item-x"]);
    expect(state.recordsSync.cursor).toBe(9);
  });

  it("hears first when it has changes, then stops after a round that could send nothing", async () => {
    // A mark for a Learn record that is not this device's own yet (the unsaved starting tracks): nothing to send.
    state.learn = seedLearn();
    state.learnSeedOnly = true;
    state.recordsSync = { ...emptyRecordsSync(WORKER), listened: true, kinds: "x",
      known: { "learn.track/track-trading": { u: 1, h: "x" } }, dirty: ["learn.track/track-trading"] };
    const wires: Wire[] = [];
    const send = vi.fn<Post>(async (options) => {
      wires.push(options.data as Wire);
      return empty(1);
    });
    await syncRecords(send);
    expect(wires).toHaveLength(2);
    expect(wires[0].records).toEqual([]);
    expect(state.recordsNote.state).toBe("synced");
  });

  it("waits with every record while one could not be read, so nothing arriving is passed over", async () => {
    state.blocked.add(KEYS.log);
    const send = vi.fn<Post>(async () => empty(1));
    await syncRecords(send);
    expect(send).not.toHaveBeenCalled();
    expect(state.recordsNote).toMatchObject({ state: "refused" });
  });

  it("asks for everything once more when this version syncs kinds the last did not", async () => {
    state.recordsSync = { ...emptyRecordsSync(WORKER), listened: true, kinds: "prayer.day", cursor: 40 };
    const wires: Wire[] = [];
    await syncRecords(async (options) => {
      wires.push(options.data as Wire);
      return empty(41);
    });
    expect(wires[0].cursor).toBe(0);
    expect(state.recordsSync.kinds).toContain("learn.track");
  });

  it("does not mark a row as removed when a sync landed during a Money save", () => {
    const arrived = addIncome(emptyMoney(), { id: "their-1", date: "2026-10-05", cents: 100, currency: "AED", from: "x" });
    const mine = addIncome(emptyMoney(), { id: "mine-1", date: "2026-10-06", cents: 200, currency: "AED", from: "y" });
    // What arrived is known from the Worker; the value being saved was made before it came.
    state.recordsSync = stampSaved(moneyCollection, arrived, { ...emptyRecordsSync(WORKER), listened: true }, 5);
    state.money = addIncome(arrived, mine.entries[0]);
    recordSaved(KEYS.money, mine);
    expect(state.recordsSync.removed).toEqual([]);
    expect(state.recordsSync.dirty.some((k) => k.includes("mine-1"))).toBe(true);
    state.money = emptyMoney();
  });

  it("sends the Body log already on a device the first time this version syncs it", async () => {
    state.recordsSync = { ...emptyRecordsSync(WORKER), listened: true, kinds: "prayer.day", cursor: 40 };
    state.body = { ...state.body, connected: true, weights: [{ at: 1000, kg: 82.4 }] };
    const wires: Wire[] = [];
    await syncRecords(async (options) => {
      wires.push(options.data as Wire);
      return empty(41);
    });
    const sent = wires.flatMap((w) => w.records);
    expect(sent.find((r) => r.kind === "body.weight")).toMatchObject({ id: "w1000", updated: 1, data: { kg: 82.4 } });
    expect(JSON.stringify(sent)).not.toContain("connected");
  });

  it("joins a day marked on two devices while they were apart, and sends the joined day", async () => {
    state.recordsSync = { ...emptyRecordsSync(WORKER), listened: true };
    state.log = cycleMark(emptyLog(), TODAY, "fajr");
    recordSaved(KEYS.log, state.log);
    const theirs = cycleMark(emptyLog(), TODAY, "dhuhr").days[TODAY];
    const wires: Wire[] = [];
    await syncRecords(async (options) => {
      wires.push(options.data as Wire);
      return wires.length === 1
        ? answer({ ok: true, cursor: 3, more: false, removed: [], records: [{ kind: "prayer.day", id: TODAY, updated: 1, data: theirs }] })
        : empty(4);
    });
    expect(wires[0].records).toEqual([]);
    const sentDay = wires[1].records.find((r) => r.kind === "prayer.day");
    expect(Object.keys((sentDay?.data as { prayers: object }).prayers).sort()).toEqual(["dhuhr", "fajr"]);
    expect(Object.keys(state.log.days[TODAY].prayers).sort()).toEqual(["dhuhr", "fajr"]);
  });

  it("lets the starting tracks the user never changed lose to another device's edits (they go in at the oldest stamp)", () => {
    state.recordsSync = { ...emptyRecordsSync(WORKER), listened: true };
    state.learn = seedLearn();
    state.learnSeedOnly = true;
    const changed = { ...state.learn, tracks: state.learn.tracks.map((t) => (t.id === "track-fiqh" ? { ...t, weeklyMinutes: 90 } : t)) };
    recordSaved(KEYS.learn, changed);
    expect(state.recordsSync.known["learn.track/track-tafsir"].u).toBe(1);
    expect(state.recordsSync.known["learn.track/track-fiqh"].u).toBeGreaterThan(1);
  });

  it("says nothing and sends nothing with no server set up: the records live on this device", async () => {
    state.settings = { ...state.settings, voiceUrl: "" };
    const send = vi.fn<Post>();
    await syncRecords(send);
    expect(send).not.toHaveBeenCalled();
    expect(state.recordsNote).toEqual({ state: "idle" });
  });

  it("asks for a Talk sign-in when there is no session, and sends nothing", async () => {
    state.talk = { ...state.talk, session: null };
    const send = vi.fn<Post>();
    await syncRecords(send);
    expect(send).not.toHaveBeenCalled();
    expect(state.recordsNote).toEqual({ state: "signin" });
  });

  it("leaves out a record that could not be read, and stamps nothing for it", () => {
    state.blocked.add(KEYS.log);
    recordSaved(KEYS.log, cycleMark(emptyLog(), TODAY, "fajr"));
    expect(state.recordsSync.dirty).toEqual([]);
  });
});
