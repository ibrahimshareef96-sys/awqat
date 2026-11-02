// Everything but books on every device: each saved value as records, a change stamped and marked, the Worker's
// answer merged record by record (newer wins; a day changed on two devices keeps both), and two devices end to end
// against a Worker kept in memory that follows POST /app/records' rules.
import { describe, expect, it, vi } from "vitest";
import { addOne, adhkarFor, emptyAdhkarLog } from "../src/faith/adhkar.ts";
import { emptyFridayLog, toggleFriday } from "../src/faith/friday.ts";
import { adjustOwed, cycleMark, emptyLog } from "../src/prayer/log.ts";
import { emptyQuranLog, logRead, logStudy } from "../src/quran/log.ts";
import { emptyMarks, markMistake, setAyahNote, setPageNote, setTheme } from "../src/quran/marks.ts";
import { makePlan } from "../src/quran/murajaah.ts";
import {
  adhkarCollection, fridayCollection, learnCollection, murajaahCollection, mushafCollection, prayerCollection,
  quranCollection,
} from "../src/sync/collections.ts";
import { emptyLearn } from "../src/learn/learn.ts";
import {
  applyReply, canonical, checkRecordsSync, emptyRecordsSync, hashOf, joinPages, keyOf, outgoing, postRecords, readReply,
  recordsOf, retryAfterOf, stampSaved, startFresh, type Collection, type Post, type Reply, type Stamped, type Wire,
} from "../src/sync/records.ts";

const TODAY = "2026-10-28";
const T0 = Date.UTC(2026, 9, 28, 8, 0);
const WORKER = "https://os.example.com";
const reply = (patch: Partial<Reply> = {}): Reply => ({ cursor: 1, more: false, records: [], removed: [], ...patch });
const noWire = (cursor = 0): Wire => ({ cursor, records: [], removed: [] });

describe("each saved value as records, and back", () => {
  it("keeps every log the same through records (the mushaf's theme and last page stay on the device)", () => {
    const prayer = adjustOwed(cycleMark(cycleMark(emptyLog(), TODAY, "fajr"), "2026-10-27", "isha"), 3);
    expect(prayerCollection.fromRecords(prayerCollection.toRecords(prayer), emptyLog())).toEqual(prayer);
    const quran = { ...logStudy(logRead(emptyQuranLog(), TODAY, 12), TODAY, "Tafsir of Al-Fatiha", 30), dailyGoal: 4 };
    expect(quranCollection.fromRecords(quranCollection.toRecords(quran), emptyQuranLog())).toEqual(quran);
    const adhkar = addOne(addOne(emptyAdhkarLog(), TODAY, "morning", adhkarFor("morning")[0].id), TODAY, "evening",
      adhkarFor("evening")[1].id);
    expect(Object.keys(adhkar.days)).toEqual([TODAY]);
    expect(adhkarCollection.fromRecords(adhkarCollection.toRecords(adhkar), emptyAdhkarLog())).toEqual(adhkar);
    const friday = toggleFriday(emptyFridayLog(), "2026-10-30", "kahf");
    expect(fridayCollection.fromRecords(fridayCollection.toRecords(friday), emptyFridayLog())).toEqual(friday);
    const marks = setPageNote(setAyahNote(markMistake(emptyMarks(), "2:255:3", TODAY), "2:255", "Ayat al-Kursi", TODAY),
      42, "review", TODAY);
    const mine = setTheme(emptyMarks(), "night");
    expect(mushafCollection.fromRecords(mushafCollection.toRecords(marks), mine))
      .toEqual({ ...marks, theme: "night", lastPage: mine.lastPage });
    expect(mushafCollection.toRecords(marks).map((r) => r.id).sort()).toEqual(["2-255", "2-255-3", "42"]);
    const plan = makePlan([1, 2, 30], 1);
    expect(murajaahCollection.fromRecords(murajaahCollection.toRecords(plan), null)).toEqual(plan);
    expect(murajaahCollection.toRecords(null)).toEqual([]);
  });

  it("reads the same data the same way whichever order its keys were built in", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
    expect(hashOf({ b: 1, a: 2 })).toBe(hashOf({ a: 2, b: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});

describe("stamping a save", () => {
  it("stamps and marks what is new or changed, and leaves an unchanged save as it is", () => {
    const log = cycleMark(emptyLog(), TODAY, "fajr");
    const first = stampSaved(prayerCollection, log, emptyRecordsSync(WORKER), T0);
    expect(first.dirty.sort()).toEqual([keyOf("prayer.day", TODAY), keyOf("prayer.owed", "owed")].sort());
    expect(first.known[keyOf("prayer.day", TODAY)].u).toBe(T0);
    expect(stampSaved(prayerCollection, log, first, T0 + 5)).toBe(first);
    const next = stampSaved(prayerCollection, cycleMark(log, TODAY, "dhuhr"), { ...first, dirty: [] }, T0 + 5);
    expect(next.dirty).toEqual([keyOf("prayer.day", TODAY)]);
    expect(next.known[keyOf("prayer.day", TODAY)].u).toBe(T0 + 5);
  });

  it("notes a record gone as removed, and stamps just after the last stamp when told to (now 0)", () => {
    const quran = logRead(emptyQuranLog(), TODAY, 5);
    const sync = stampSaved(quranCollection, quran, emptyRecordsSync(WORKER), T0);
    const id = quran.entries[0].id;
    const gone = stampSaved(quranCollection, { ...quran, entries: [] }, sync, T0 + 9);
    expect(gone.removed).toEqual([{ kind: "quran.entry", id, at: T0 + 9 }]);
    expect(gone.known[keyOf("quran.entry", id)]).toBeUndefined();
    const nudged = stampSaved(quranCollection, { ...quran, dailyGoal: 2 }, { ...sync, known: { ...sync.known,
      [keyOf("quran.place", "place")]: { u: T0 + 100, h: "x" } } }, 0);
    expect(nudged.known[keyOf("quran.place", "place")].u).toBe(T0 + 101);
  });

  it("marks every record on a first sync, and sends nothing while it only listens", () => {
    const values: [Collection, unknown][] = [[prayerCollection, cycleMark(emptyLog(), TODAY, "fajr")],
      [murajaahCollection, makePlan([1], 1)]];
    const sync = startFresh(values, WORKER, T0);
    expect(sync.dirty).toHaveLength(3);
    expect(outgoing(values, sync, true)).toEqual(noWire(0));
    const wire = outgoing(values, sync);
    expect(wire.records.map((r) => r.kind).sort()).toEqual(["murajaah.plan", "prayer.day", "prayer.owed"]);
    expect(wire.records.every((r) => r.updated === T0)).toBe(true);
  });
});

describe("taking in the Worker's answer", () => {
  const values = (log = emptyLog()): [Collection, unknown][] => [[prayerCollection, log]];

  it("clears the marks of what the Worker took, unless it changed again meanwhile", () => {
    const log = cycleMark(emptyLog(), TODAY, "fajr");
    const sync = stampSaved(prayerCollection, log, emptyRecordsSync(WORKER), T0);
    const wire = outgoing(values(log), sync);
    const changed = cycleMark(log, TODAY, "asr");
    const later = stampSaved(prayerCollection, changed, sync, T0 + 10);
    const applied = applyReply(values(changed), later, wire, reply({ cursor: 4 }), T0 + 20);
    expect(applied.sync.dirty).toEqual([keyOf("prayer.day", TODAY)]);
    expect(applied.sync.cursor).toBe(4);
  });

  it("adds a day from another device and makes the log again from its records", () => {
    const theirs = cycleMark(emptyLog(), "2026-10-27", "maghrib").days["2026-10-27"];
    const applied = applyReply(values(), emptyRecordsSync(WORKER), noWire(),
      reply({ records: [{ kind: "prayer.day", id: "2026-10-27", updated: T0, data: theirs as never }] }), T0 + 1);
    expect((applied.values.get(prayerCollection.key) as ReturnType<typeof emptyLog>).days["2026-10-27"]).toEqual(theirs);
    expect(applied.sync.known[keyOf("prayer.day", "2026-10-27")].u).toBe(T0);
  });

  it("keeps the marks of both devices for one day, and sends the joined day back", () => {
    const mine = cycleMark(emptyLog(), TODAY, "fajr");
    const sync = stampSaved(prayerCollection, mine, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 50);
    const theirs = cycleMark(emptyLog(), TODAY, "dhuhr").days[TODAY];
    const applied = applyReply(values(mine), sync, noWire(),
      reply({ records: [{ kind: "prayer.day", id: TODAY, updated: T0, data: theirs as never }] }), T0 + 60);
    const day = (applied.values.get(prayerCollection.key) as ReturnType<typeof emptyLog>).days[TODAY];
    expect(Object.keys(day.prayers).sort()).toEqual(["dhuhr", "fajr"]);
    expect(applied.sync.dirty).toContain(keyOf("prayer.day", TODAY));
    expect(applied.sync.known[keyOf("prayer.day", TODAY)].u).toBeGreaterThan(T0);
  });

  it("keeps the higher count of each dhikr from two devices", () => {
    const many = adhkarFor("morning").find((d) => d.count >= 3)!.id;
    const once = adhkarFor("morning").find((d) => d.id !== many)!.id;
    const mine = addOne(addOne(emptyAdhkarLog(), TODAY, "morning", many), TODAY, "morning", many);
    const sync = stampSaved(adhkarCollection, mine, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 50);
    const theirs = addOne(addOne(emptyAdhkarLog(), TODAY, "morning", once), TODAY, "morning", many).days[TODAY];
    const applied = applyReply([[adhkarCollection, mine]], sync, noWire(),
      reply({ records: [{ kind: "adhkar.day", id: TODAY, updated: T0, data: theirs as never }] }), T0 + 60);
    const day = (applied.values.get(adhkarCollection.key) as ReturnType<typeof emptyAdhkarLog>).days[TODAY];
    expect(day.morning).toEqual({ [many]: 2, [once]: 1 });
  });

  it("on a first sync, gives way to the others' copy where nothing can join them (the muraja'ah plan)", () => {
    const mine = makePlan([1, 2], 1);
    const sync = stampSaved(murajaahCollection, mine, emptyRecordsSync(WORKER), T0 + 999);
    const theirs = makePlan([5, 6, 7], 2);
    const applied = applyReply([[murajaahCollection, mine]], sync, noWire(),
      reply({ records: [{ kind: "murajaah.plan", id: "plan", updated: T0, data: theirs as never }] }), T0 + 1000, true);
    expect(applied.values.get(murajaahCollection.key)).toEqual(theirs);
    expect(applied.sync.dirty).toEqual([]);
    expect(applied.sync.listened).toBe(true);
  });

  it("keeps a newer change here where a join would only take theirs (the prayers owed)", () => {
    const mine = adjustOwed(emptyLog(), 4);
    const sync = stampSaved(prayerCollection, mine, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 5000);
    const applied = applyReply(values(mine), sync, noWire(),
      reply({ records: [{ kind: "prayer.owed", id: "owed", updated: T0 + 1000, data: { owed: 9 } }] }), T0 + 6000);
    expect(applied.values.size).toBe(0);
    expect(applied.sync.dirty).toContain(keyOf("prayer.owed", "owed"));
  });

  it("takes theirs when a newer change here is already inside it, so nothing the other device holds is lost", () => {
    const many = adhkarFor("morning").find((d) => d.count >= 3)!.id;
    const once = addOne(emptyAdhkarLog(), TODAY, "morning", many);
    const mineSync = stampSaved(adhkarCollection, once, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 5000);
    const thrice = [1, 2, 3].reduce((log) => addOne(log, TODAY, "morning", many), emptyAdhkarLog()).days[TODAY];
    const adhkar = applyReply([[adhkarCollection, once]], mineSync, noWire(),
      reply({ records: [{ kind: "adhkar.day", id: TODAY, updated: T0 + 1000, data: thrice as never }] }), T0 + 6000);
    expect((adhkar.values.get(adhkarCollection.key) as ReturnType<typeof emptyAdhkarLog>).days[TODAY].morning)
      .toEqual({ [many]: 3 });
    expect(adhkar.sync.dirty).not.toContain(keyOf("adhkar.day", TODAY));

    const fajr = cycleMark(emptyLog(), TODAY, "fajr");
    const prayerSync = stampSaved(prayerCollection, fajr, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 5000);
    const both = cycleMark(fajr, TODAY, "dhuhr").days[TODAY];
    const prayer = applyReply(values(fajr), prayerSync, noWire(),
      reply({ records: [{ kind: "prayer.day", id: TODAY, updated: T0 + 1000, data: both as never }] }), T0 + 6000);
    expect(Object.keys((prayer.values.get(prayerCollection.key) as ReturnType<typeof emptyLog>).days[TODAY].prayers).sort())
      .toEqual(["dhuhr", "fajr"]);

    const behind = { ...emptyQuranLog(), position: 100 };
    const placeSync = stampSaved(quranCollection, behind, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 5000);
    const quran = applyReply([[quranCollection, behind]], placeSync, noWire(), reply({ records: [{ kind: "quran.place",
      id: "place", updated: T0 + 1000, data: { position: 300, completed: 0 } }] }), T0 + 6000);
    expect((quran.values.get(quranCollection.key) as ReturnType<typeof emptyQuranLog>).position).toBe(300);
  });

  it("does not take a change made here as known when its save is still being written", () => {
    const day = cycleMark(emptyLog(), "2026-10-27", "fajr");
    const sync = stampSaved(prayerCollection, day, { ...emptyRecordsSync(WORKER), listened: true }, T0);
    const acked = { ...sync, dirty: [] };
    // A mark made here, set in state, its save not yet stamped; meanwhile another day arrives.
    const marked = cycleMark(day, "2026-10-27", "dhuhr");
    const theirs = cycleMark(emptyLog(), TODAY, "asr").days[TODAY];
    const applied = applyReply(values(marked), acked, noWire(),
      reply({ records: [{ kind: "prayer.day", id: TODAY, updated: T0, data: theirs as never }] }), T0 + 10);
    const later = stampSaved(prayerCollection, applied.values.get(prayerCollection.key), applied.sync, T0 + 20);
    expect(later.dirty).toContain(keyOf("prayer.day", "2026-10-27"));
  });

  it("orders Quran entries the same way whatever order they arrive in", () => {
    let log = logRead(emptyQuranLog(), TODAY, 10);
    log = logStudy(log, TODAY, "Tafsir", 20);
    log = logRead(log, TODAY, 20);
    const recs = quranCollection.toRecords(log);
    const a = quranCollection.fromRecords(recs, emptyQuranLog()).entries.map((e) => e.id);
    const b = quranCollection.fromRecords([...recs].reverse(), emptyQuranLog()).entries.map((e) => e.id);
    expect(a).toEqual(b);
    const kinds = quranCollection.fromRecords([...recs].reverse(), emptyQuranLog()).entries.map((e) => e.kind);
    expect(kinds).toEqual(["read", "read", "study"]);
  });

  it("after the first sync, keeps a newer change made here and refuses odd records", () => {
    const mine = makePlan([1, 2], 1);
    const sync = stampSaved(murajaahCollection, mine, { ...emptyRecordsSync(WORKER), listened: true }, T0 + 999);
    const applied = applyReply([[murajaahCollection, mine]], sync, noWire(), reply({ records: [
      { kind: "murajaah.plan", id: "plan", updated: T0, data: makePlan([9], 1) as never },
      { kind: "nope.kind", id: "x", updated: T0, data: {} },
      { kind: "murajaah.plan", id: "bad id", updated: T0, data: {} },
    ] }), T0 + 1000);
    expect(applied.values.size).toBe(0);
    expect(applied.sync.dirty).toEqual([keyOf("murajaah.plan", "plan")]);
  });

  it("takes the same data with their stamp and marks nothing", () => {
    const log = cycleMark(emptyLog(), TODAY, "fajr");
    const sync = stampSaved(prayerCollection, log, emptyRecordsSync(WORKER), T0 + 5);
    const applied = applyReply(values(log), sync, noWire(),
      reply({ records: [{ kind: "prayer.day", id: TODAY, updated: T0, data: log.days[TODAY] as never }] }), T0 + 6, true);
    expect(applied.sync.known[keyOf("prayer.day", TODAY)].u).toBe(T0);
    expect(applied.sync.dirty).not.toContain(keyOf("prayer.day", TODAY));
    expect(applied.values.size).toBe(0);
  });

  it("removes a record removed elsewhere, unless it changed here after; and never brings back one removed here", () => {
    const quran = logRead(emptyQuranLog(), TODAY, 5);
    const id = quran.entries[0].id;
    const sync = stampSaved(quranCollection, quran, emptyRecordsSync(WORKER), T0);
    const gone = applyReply([[quranCollection, quran]], { ...sync, dirty: [] }, noWire(),
      reply({ removed: [{ kind: "quran.entry", id, at: T0 + 1 }] }), T0 + 2);
    expect((gone.values.get(quranCollection.key) as ReturnType<typeof emptyQuranLog>).entries).toEqual([]);
    const kept = applyReply([[quranCollection, quran]], sync, noWire(),
      reply({ removed: [{ kind: "quran.entry", id, at: T0 - 1 }] }), T0 + 2);
    expect(kept.values.size).toBe(0);
    const removedHere = { ...emptyRecordsSync(WORKER), removed: [{ kind: "quran.entry", id, at: T0 + 5 }] };
    const back = applyReply([[quranCollection, emptyQuranLog()]], removedHere, noWire(),
      reply({ records: [{ kind: "quran.entry", id, updated: T0, data: quran.entries[0] as never }] }), T0 + 6);
    expect(back.values.size).toBe(0);
  });
});

describe("a paged run, and records a reader refuses", () => {
  const T1 = T0 + 1;
  it("keeps each record's last word across pages, in page order", () => {
    const rec = (id: string, updated: number) => ({ kind: "prayer.day", id, updated, data: {} });
    const joined = joinPages([
      reply({ cursor: 2, more: true, records: [rec("2026-10-01", T0), rec("2026-10-02", T0)] }),
      reply({ cursor: 4, more: true, records: [rec("2026-10-03", T0)], removed: [{ kind: "prayer.day", id: "2026-10-01", at: T1 }] }),
      reply({ cursor: 6, records: [rec("2026-10-01", T1 + 1)], removed: [{ kind: "prayer.day", id: "2026-10-02", at: T1 }] }),
    ]);
    expect(joined.cursor).toBe(6);
    expect(joined.more).toBe(false);
    expect(joined.records.map((r) => r.id).sort()).toEqual(["2026-10-01", "2026-10-03"]);
    expect(joined.removed.map((r) => r.id)).toEqual(["2026-10-02"]);
  });

  it("forgets a record its reader refuses, so the next save never turns it into a removal", () => {
    const item = { id: "orphan-1", trackId: "track-gone", title: "Lecture", kind: "lecture", url: null, status: "todo",
      order: 0, added: TODAY, done: null };
    const values: [Collection, unknown][] = [[learnCollection, emptyLearn()]];
    const applied = applyReply(values, { ...emptyRecordsSync(WORKER), listened: true }, noWire(),
      reply({ records: [{ kind: "learn.item", id: "orphan-1", updated: T0, data: item }] }), T1);
    expect(applied.sync.known["learn.item/orphan-1"]).toBeUndefined();
    const next = stampSaved(learnCollection, applied.values.get(learnCollection.key), applied.sync, T1 + 5);
    expect(next.removed).toEqual([]);
  });

  it("reads an item and its track together when they came on different pages", () => {
    const track = { id: "track-x", name: "Usul", kind: "islamic", weeklyMinutes: 60, archived: false, added: TODAY };
    const item = { id: "item-x", trackId: "track-x", title: "Lecture 1", kind: "lecture", url: null, status: "todo",
      order: 0, added: TODAY, done: null };
    const joined = joinPages([
      reply({ cursor: 1, more: true, records: [{ kind: "learn.item", id: "item-x", updated: T0, data: item }] }),
      reply({ cursor: 2, records: [{ kind: "learn.track", id: "track-x", updated: T0, data: track }] }),
    ]);
    const applied = applyReply([[learnCollection, emptyLearn()]], emptyRecordsSync(WORKER), noWire(), joined, T1, true);
    const learn = applied.values.get(learnCollection.key) as ReturnType<typeof emptyLearn>;
    expect(learn.items.map((i) => i.id)).toEqual(["item-x"]);
    expect(applied.sync.known["learn.item/item-x"].u).toBe(T0);
  });

  it("leaves out a mushaf id with a leading zero, and keeps what a reader tidied without marking it", () => {
    const records = [
      { kind: "mushaf.note", id: "02-255", data: { text: "x", updated: TODAY } },
      { kind: "mushaf.note", id: "2-255", data: { text: "y", updated: TODAY } },
    ];
    const marks = mushafCollection.fromRecords(records, emptyMarks());
    expect(Object.keys(marks.notes)).toEqual(["2:255"]);
  });
});

describe("reading what comes back", () => {
  it("checks the Worker's answer and the saved state, starting afresh from anything odd", () => {
    expect(readReply({ ok: true, cursor: 2, more: false, records: [{ kind: "prayer.day", id: TODAY, updated: T0, data: {} },
      { kind: "Bad", id: "x", updated: T0, data: {} }], removed: [] })?.records).toHaveLength(1);
    expect(readReply({ ok: true, cursor: 1, more: false, records: new Array(2001).fill({}), removed: [] })).toBeNull();
    expect(readReply({ ok: false })).toBeNull();
    expect(checkRecordsSync("{nope")).toEqual(emptyRecordsSync());
    const saved = { ...emptyRecordsSync(WORKER), cursor: 3, listened: true,
      known: { "prayer.day/2026-10-28": { u: T0, h: "abc" }, "bad/../x": { u: T0, h: "abc" } },
      dirty: ["prayer.day/2026-10-28", "ghost/1"], removed: [{ kind: "quran.entry", id: "a-1", at: T0 }] };
    expect(checkRecordsSync(JSON.stringify(saved))).toEqual({ ...saved, known: { "prayer.day/2026-10-28": { u: T0, h: "abc" } },
      dirty: ["prayer.day/2026-10-28"] });
  });

  it("posts natively to /app/records with the session, and says why it did not work", async () => {
    let seen: Record<string, unknown> = {};
    const ok: Post = async (options) => {
      seen = options as unknown as Record<string, unknown>;
      return { status: 200, headers: {}, url: "", data: { ok: true, cursor: 0, more: false, records: [], removed: [] } };
    };
    expect((await postRecords(WORKER, "t", noWire(), ok)).ok).toBe(true);
    expect(seen).toMatchObject({ url: `${WORKER}/app/records`, disableRedirects: true, headers: { Authorization: "Bearer t" } });
    const status = (s: number, data: unknown = {}): Post => async () => ({ status: s, headers: {}, url: "", data });
    expect(await postRecords(WORKER, "t", noWire(), status(401))).toEqual({ ok: false, why: "signin" });
    expect(await postRecords(WORKER, "t", noWire(), status(404))).toEqual({ ok: false, why: "missing" });
    expect(await postRecords(WORKER, "t", noWire(), status(429, { error: "Too many syncs this hour. Try again later." })))
      .toEqual({ ok: false, why: "busy", retryAfter: 600 });
    const later: Post = async () => ({ status: 429, headers: { "Retry-After": "120" }, url: "", data: {} });
    expect(await postRecords(WORKER, "t", noWire(), later)).toEqual({ ok: false, why: "busy", retryAfter: 120 });
    expect(retryAfterOf({ "retry-after": "5" })).toBe(60);
    expect(retryAfterOf({ "retry-after": "99999" })).toBe(3600);
    expect(await postRecords(WORKER, "t", noWire(), async () => { throw new Error("x"); })).toEqual({ ok: false, why: "offline" });
  });
});

/** A Worker in memory with POST /app/records' merge rules (newest wins, removals, cursor, no echo). */
function memoryWorker() {
  let seq = 0;
  const rows = new Map<string, { rec: Stamped; seq: number }>();
  const tombs = new Map<string, { kind: string; id: string; at: number; seq: number }>();
  const post: Post = async (options) => {
    const wire = options.data as Wire;
    const wrote = new Set<string>();
    for (const r of wire.records) {
      const key = keyOf(r.kind, r.id);
      const tomb = tombs.get(key);
      const old = rows.get(key);
      if (tomb && tomb.at >= r.updated) continue;
      if (!old || r.updated > old.rec.updated) {
        rows.set(key, { rec: r, seq: ++seq });
        tombs.delete(key);
        wrote.add(`${key}@${r.updated}`);
      }
    }
    for (const r of wire.removed) {
      const key = keyOf(r.kind, r.id);
      const old = rows.get(key);
      if (old && old.rec.updated > r.at) continue;
      rows.delete(key);
      tombs.set(key, { ...r, seq: ++seq });
    }
    const after = (s: number) => s > wire.cursor;
    return { status: 200, headers: {}, url: "", data: { ok: true, cursor: seq, more: false,
      records: [...rows.entries()].filter(([key, r]) => after(r.seq) && !wrote.has(`${key}@${r.rec.updated}`)).map(([, r]) => r.rec),
      removed: [...tombs.values()].filter((t) => after(t.seq)).map(({ kind, id, at }) => ({ kind, id, at })) } };
  };
  return { post };
}

interface Device { values: [Collection, unknown][]; sync: ReturnType<typeof emptyRecordsSync> }

async function syncDevice(device: Device, post: Post, now: number): Promise<void> {
  if (device.sync.worker !== WORKER) device.sync = startFresh(device.values, WORKER, now);
  let first = !device.sync.listened;
  for (let round = 0; round < 10; round += 1) {
    const wire = outgoing(device.values, device.sync, first);
    const sent = await postRecords(WORKER, "t", wire, post);
    if (!sent.ok) throw new Error(sent.why);
    const applied = applyReply(device.values, device.sync, wire, sent.reply, now, first);
    device.sync = applied.sync;
    device.values = device.values.map(([c, v]) => [c, applied.values.has(c.key) ? applied.values.get(c.key) : v]);
    if (!sent.reply.more) first = false;
    if (!sent.reply.more && device.sync.dirty.length === 0 && device.sync.removed.length === 0) break;
  }
}

const prayerOf = (d: Device) => d.values[0][1] as ReturnType<typeof emptyLog>;
const quranOf = (d: Device) => d.values[1][1] as ReturnType<typeof emptyQuranLog>;

describe("two devices and the user's Worker", () => {
  it("brings one device's prayers and Quran to another, joins a day marked on both, and carries removals", async () => {
    const worker = memoryWorker();
    const fold: Device = { values: [[prayerCollection, cycleMark(emptyLog(), TODAY, "fajr")],
      [quranCollection, logRead(emptyQuranLog(), TODAY, 20)]], sync: emptyRecordsSync() };
    const phone: Device = { values: [[prayerCollection, cycleMark(emptyLog(), TODAY, "dhuhr")],
      [quranCollection, emptyQuranLog()]], sync: emptyRecordsSync() };
    await syncDevice(fold, worker.post, T0);
    await syncDevice(phone, worker.post, T0 + 1000);
    await syncDevice(fold, worker.post, T0 + 2000);
    expect(Object.keys(prayerOf(phone).days[TODAY].prayers).sort()).toEqual(["dhuhr", "fajr"]);
    expect(Object.keys(prayerOf(fold).days[TODAY].prayers).sort()).toEqual(["dhuhr", "fajr"]);
    expect(quranOf(phone).entries).toEqual(quranOf(fold).entries);
    expect(quranOf(phone).position).toBe(20);

    const id = quranOf(phone).entries[0].id;
    const removed = { ...quranOf(phone), entries: [] };
    phone.sync = stampSaved(quranCollection, removed, phone.sync, T0 + 3000);
    phone.values = [phone.values[0], [quranCollection, removed]];
    await syncDevice(phone, worker.post, T0 + 3000);
    await syncDevice(fold, worker.post, T0 + 4000);
    expect(quranOf(fold).entries.some((e) => e.id === id)).toBe(false);
    expect(fold.sync.dirty).toEqual([]);
    expect(phone.sync.dirty).toEqual([]);
  });

  it("brings the mushaf's bookmark to every device, the one set last winning", async () => {
    const worker = memoryWorker();
    const marksOf = (d: Device) => d.values[0][1] as ReturnType<typeof emptyMarks>;
    const reading = (page: number, at: number) => ({ ...emptyMarks(), lastPage: page, lastPageAt: at });
    // One device is on Luqman; a tablet is on Al-Baqara with an older timestamp; a third device has no bookmark.
    const fold: Device = { values: [[mushafCollection, reading(411, T0 + 500)]], sync: emptyRecordsSync() };
    const ipad: Device = { values: [[mushafCollection, reading(3, T0)]], sync: emptyRecordsSync() };
    const phone: Device = { values: [[mushafCollection, emptyMarks()]], sync: emptyRecordsSync() };
    expect(mushafCollection.toRecords(emptyMarks()).some((r) => r.kind === "mushaf.place")).toBe(false);
    await syncDevice(fold, worker.post, T0 + 1000);
    await syncDevice(ipad, worker.post, T0 + 2000);
    await syncDevice(phone, worker.post, T0 + 3000);
    await syncDevice(fold, worker.post, T0 + 4000);
    expect([fold, ipad, phone].map((d) => marksOf(d).lastPage)).toEqual([411, 411, 411]);

    // Reading on to 412 on the third device updates the first device's bookmark.
    const on = { ...marksOf(phone), lastPage: 412, lastPageAt: T0 + 5000 };
    phone.sync = stampSaved(mushafCollection, on, phone.sync, T0 + 5000);
    phone.values = [[mushafCollection, on]];
    await syncDevice(phone, worker.post, T0 + 5000);
    await syncDevice(fold, worker.post, T0 + 6000);
    expect(marksOf(fold)).toMatchObject({ lastPage: 412, lastPageAt: T0 + 5000 });
    expect(fold.sync.dirty).toEqual([]);
  });

  it("keeps the bookmark here when what arrives is not a page or a time it can trust", () => {
    const mine = { ...emptyMarks(), lastPage: 411, lastPageAt: T0 };
    const odd = (data: Record<string, unknown>) =>
      mushafCollection.fromRecords([{ kind: "mushaf.place", id: "place", data }], mine);
    expect(odd({ page: 999, at: T0 + 1 })).toMatchObject({ lastPage: 411, lastPageAt: T0 });
    expect(odd({ page: 412, at: "soon" })).toMatchObject({ lastPage: 411, lastPageAt: T0 });
    expect(odd({ page: 412.5, at: T0 + 1 })).toMatchObject({ lastPage: 411, lastPageAt: T0 });
    expect(odd({ page: 412, at: T0 + 1 })).toMatchObject({ lastPage: 412, lastPageAt: T0 + 1 });
    expect(mushafCollection.merge?.("mushaf.place", { page: 5, at: T0 + 9 }, { page: 6, at: T0 })).toEqual({ page: 5, at: T0 + 9 });
    expect(mushafCollection.merge?.("mushaf.place", { page: 5, at: T0 }, { page: 6, at: T0 + 9 })).toEqual({ page: 6, at: T0 + 9 });
    // A time out of range never wins a join, so the change made here is kept and still sent.
    expect(mushafCollection.merge?.("mushaf.place", { page: 5, at: T0 }, { page: 6, at: 1e300 })).toEqual({ page: 5, at: T0 });
    expect(mushafCollection.merge?.("mushaf.place", { page: 5, at: "x" }, { page: 6, at: T0 })).toEqual({ page: 6, at: T0 });
  });

  it("takes a bookmark from a clock running ahead as set now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const ahead = mushafCollection.fromRecords([{ kind: "mushaf.place", id: "place", data: { page: 412, at: T0 + 3_600_000 } }],
        { ...emptyMarks(), lastPage: 411, lastPageAt: T0 - 1000 });
      expect(ahead).toMatchObject({ lastPage: 412, lastPageAt: T0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("each value made again matches what is saved, so a sync never marks what it just took", () => {
    const quran = logRead(emptyQuranLog(), TODAY, 7);
    const records = recordsOf(quranCollection, quran);
    expect([...records.keys()].every((k) => k.startsWith("quran."))).toBe(true);
  });
});
