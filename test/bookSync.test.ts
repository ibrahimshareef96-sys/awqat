// The library on every device: changes stamped and marked here, swapped with the Worker, taken in there. The pure
// steps one by one, then two devices against a Worker kept in memory that follows POST /app/books' rules.
import { describe, expect, it } from "vitest";
import { addBook, emptyLibrary, logPages, setGoal, setShelf, updateBook, type Book, type Library } from "../src/books/library.ts";
import {
  BOOK_BYTES_MAX, PER_REQUEST, applyReply, checkSync, emptySync, outgoing, postBooks, readReply, startFresh, stampChanges,
  syncMessage, type Post, type Reply, type Wire,
} from "../src/books/sync.ts";

const TODAY = "2026-10-28";
const T0 = Date.UTC(2026, 9, 28, 8, 0);
const WORKER = "https://os.example.com";

function book(title: string, extra: Partial<Parameters<typeof addBook>[1]> = {}, library = emptyLibrary()) {
  return addBook(library, { title, authors: ["A. Writer"], isbn: null, pages: 300, coverId: null, photo: null,
    source: "typed", ...extra }, TODAY);
}

const reply = (patch: Partial<Reply> = {}): Reply => ({ cursor: 1, more: false, books: [], removed: [], goal: null, ...patch });
const noWire = (cursor = 0): Wire => ({ cursor, books: [], removed: [], goal: null });

describe("stamping a change made here", () => {
  it("stamps a new book and marks it, and leaves an unchanged library as it is", () => {
    const added = book("Dune");
    const { library, sync } = stampChanges(emptyLibrary(), added.library, T0, emptySync(WORKER));
    expect(library.books[0].updated).toBe(T0);
    expect(sync.dirty).toEqual([added.book.id]);
    const again = stampChanges(library, library, T0 + 5, sync);
    expect(again.library).toBe(library);
    expect(again.sync).toBe(sync);
  });

  it("stamps an edit later than the copy it changed, even when that copy came from a clock ahead of this one", () => {
    const added = book("Dune");
    const ahead = { ...added.library, books: [{ ...added.book, updated: T0 + 60_000 }] };
    const edited = setShelf(ahead, added.book.id, "reading", TODAY);
    const { library } = stampChanges(ahead, edited, T0, emptySync(WORKER));
    expect(library.books[0].updated).toBe(T0 + 60_001);
  });

  it("does not mark a cover file saved here: it never leaves the phone", () => {
    const added = book("Dune");
    const withPhoto = updateBook(added.library, added.book.id, { photo: "covers/ol-1.jpg" });
    const { library, sync } = stampChanges(added.library, withPhoto, T0, emptySync(WORKER));
    expect(library).toBe(withPhoto);
    expect(sync.dirty).toEqual([]);
  });

  it("notes a removal (not a mark), and marks a new goal", () => {
    const added = book("Dune");
    const marked = { ...emptySync(WORKER), dirty: [added.book.id] };
    const removed = stampChanges(added.library, emptyLibrary(), T0, marked);
    expect(removed.sync.dirty).toEqual([]);
    expect(removed.sync.removed).toEqual([{ id: added.book.id, at: T0 }]);
    const goal = stampChanges(emptyLibrary(), setGoal(emptyLibrary(), 24), T0, emptySync(WORKER));
    expect(goal.sync).toMatchObject({ goalDirty: true, goalAt: T0 });
  });
});

describe("a first sync, and what each request sends", () => {
  it("marks every book (stamping any never stamped) and the goal", () => {
    const one = book("Dune");
    const two = book("Emma", {}, one.library);
    const library = setGoal(two.library, 12);
    const fresh = startFresh(library, WORKER, T0);
    expect(fresh.sync).toMatchObject({ worker: WORKER, cursor: 0, goalDirty: true, removed: [] });
    expect(fresh.sync.dirty).toEqual([one.book.id, two.book.id]);
    expect(fresh.library.books.every((b) => b.updated === T0)).toBe(true);
  });

  it("sends the marked books without their cover file, and nothing at all while it only listens", () => {
    const added = book("Dune");
    const library = { ...added.library, books: [{ ...added.book, photo: "covers/ol-1.jpg", updated: T0 }] };
    const sync = { ...emptySync(WORKER), dirty: [added.book.id], cursor: 7 };
    const { wire } = outgoing(library, sync);
    expect(wire.cursor).toBe(7);
    expect(wire.books).toHaveLength(1);
    expect(wire.books[0].photo).toBeNull();
    expect(outgoing(library, sync, true).wire).toEqual(noWire(7));
  });

  it("sends at most one request's worth, and leaves out a book too big for the Worker", () => {
    let library = emptyLibrary();
    const ids: string[] = [];
    for (let i = 0; i < PER_REQUEST + 5; i += 1) {
      const added = book(`Book ${i}`, {}, library);
      library = added.library;
      ids.push(added.book.id);
    }
    library = { ...library, books: library.books.map((b) => ({ ...b, updated: T0 })) };
    const huge = { ...library.books[0], lessons: Array.from({ length: 200 }, (_, i) => ({ id: `l${i}`, date: TODAY,
      text: "x".repeat(500) })) };
    library = { ...library, books: [huge, ...library.books.slice(1)] };
    expect(JSON.stringify(huge).length).toBeGreaterThan(BOOK_BYTES_MAX);
    const { wire, tooBig } = outgoing(library, { ...emptySync(WORKER), dirty: ids });
    expect(wire.books).toHaveLength(PER_REQUEST);
    expect(tooBig).toEqual([huge.id]);
  });
});

describe("taking in the Worker's answer", () => {
  it("clears the marks of what the Worker took, unless the book changed again meanwhile", () => {
    const one = book("Dune");
    const two = book("Emma", {}, one.library);
    const stamped = { ...two.library, books: two.library.books.map((b) => ({ ...b, updated: T0 })) };
    const sync = { ...emptySync(WORKER), dirty: [one.book.id, two.book.id] };
    const { wire } = outgoing(stamped, sync);
    const meanwhile = stampChanges(stamped, setShelf(stamped, two.book.id, "read", TODAY), T0 + 10, sync);
    const applied = applyReply(meanwhile.library, meanwhile.sync, wire, reply({ cursor: 2 }), T0 + 20);
    expect(applied.sync.dirty).toEqual([two.book.id]);
    expect(applied.sync.cursor).toBe(2);
  });

  it("adds a book from another device without a cover file, and counts it", () => {
    const theirs = { ...book("Dune").book, coverId: 42, updated: T0, photo: "covers/theirs.jpg" };
    const applied = applyReply(emptyLibrary(), emptySync(WORKER), noWire(), reply({ books: [theirs] }), T0);
    expect(applied.library.books).toEqual([{ ...theirs, photo: null }]);
    expect(applied.arrived).toBe(1);
  });

  it("takes a newer copy, keeping the cover file when the cover is the same and freeing it when it changed", () => {
    const added = book("Dune", { coverId: 42 });
    const mine = { ...added.book, photo: "covers/ol-42.jpg", updated: T0 };
    const library = { ...added.library, books: [mine] };
    const same = applyReply(library, emptySync(WORKER), noWire(),
      reply({ books: [{ ...mine, shelf: "read", updated: T0 + 5, photo: null }] }), T0 + 9);
    expect(same.library.books[0]).toMatchObject({ shelf: "read", photo: "covers/ol-42.jpg" });
    expect(same.freed).toEqual([]);
    const other = applyReply(library, emptySync(WORKER), noWire(),
      reply({ books: [{ ...mine, coverId: 77, updated: T0 + 5, photo: null }] }), T0 + 9);
    expect(other.library.books[0]).toMatchObject({ coverId: 77, photo: null });
    expect(other.freed).toEqual(["covers/ol-42.jpg"]);
  });

  it("never lets go of a cover the user photographed personally, even when another device found an Open Library one", () => {
    const added = book("Dune");
    const mine = { ...added.book, photo: "covers/3f2a9c1e-0000-4000-8000-000000000000.jpg", updated: T0 };
    const applied = applyReply({ ...added.library, books: [mine] }, emptySync(WORKER), noWire(),
      reply({ books: [{ ...mine, coverId: 111, updated: T0 + 5, photo: null }] }), T0 + 9);
    expect(applied.library.books[0]).toMatchObject({ coverId: 111, photo: mine.photo });
    expect(applied.freed).toEqual([]);
  });

  it("does not bring back a book removed here while the exchange was on its way", () => {
    const theirs = { ...book("Dune").book, updated: T0 };
    const sync = { ...emptySync(WORKER), removed: [{ id: theirs.id, at: T0 + 1 }] };
    const applied = applyReply(emptyLibrary(), sync, noWire(), reply({ books: [theirs] }), T0 + 2);
    expect(applied.library.books).toEqual([]);
    expect(applied.sync.removed).toEqual([{ id: theirs.id, at: T0 + 1 }]);
  });

  it("remembers that a first sync heard everything only once the last page came", () => {
    const page = applyReply(emptyLibrary(), emptySync(WORKER), noWire(), reply({ cursor: 4, more: true }), T0, true);
    expect(page.sync.listened).toBe(false);
    const last = applyReply(emptyLibrary(), page.sync, noWire(4), reply({ cursor: 9 }), T0, true);
    expect(last.sync.listened).toBe(true);
  });

  it("keeps a request under its size, sending the rest next time", () => {
    let library = emptyLibrary();
    const ids: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      const added = book(`Big ${i}`, { commentary: "x".repeat(4000) }, library);
      library = added.library;
      ids.push(added.book.id);
    }
    const lessons = Array.from({ length: 100 }, (_, i) => ({ id: `l${i}`, date: TODAY, text: "y".repeat(500) }));
    library = { ...library, books: library.books.map((b) => ({ ...b, updated: T0, lessons })) };
    const { wire } = outgoing(library, { ...emptySync(WORKER), dirty: ids });
    const size = new TextEncoder().encode(JSON.stringify(wire.books)).length;
    expect(wire.books.length).toBeGreaterThan(0);
    expect(wire.books.length).toBeLessThan(120);
    expect(size).toBeLessThanOrEqual(4 * 1024 * 1024 + 1024);
  });

  it("keeps a change made here that is newer than the copy arriving, and refuses odd books", () => {
    const added = book("Dune");
    const mine = { ...added.book, shelf: "reading" as const, updated: T0 + 100 };
    const sync = { ...emptySync(WORKER), dirty: [mine.id] };
    const applied = applyReply({ ...added.library, books: [mine] }, sync, noWire(),
      reply({ books: [{ ...mine, shelf: "read", updated: T0 }, { id: "bad id!", title: "X", updated: T0 }, { title: "No id" }] }),
      T0 + 200);
    expect(applied.library.books).toEqual([mine]);
    expect(applied.sync.dirty).toEqual([mine.id]);
  });

  it("removes a book removed elsewhere, unless it changed here after that", () => {
    const added = book("Dune");
    const mine = { ...added.book, photo: "covers/ol-1.jpg", updated: T0 };
    const gone = applyReply({ ...added.library, books: [mine] }, emptySync(WORKER), noWire(),
      reply({ removed: [{ id: mine.id, at: T0 + 1 }] }), T0 + 2);
    expect(gone.library.books).toEqual([]);
    expect(gone.freed).toEqual(["covers/ol-1.jpg"]);
    const edited = { ...mine, updated: T0 + 5 };
    const kept = applyReply({ ...added.library, books: [edited] }, { ...emptySync(WORKER), dirty: [mine.id] }, noWire(),
      reply({ removed: [{ id: mine.id, at: T0 + 1 }] }), T0 + 6);
    expect(kept.library.books).toEqual([edited]);
  });

  it("takes a newer goal, and clears its own once taken", () => {
    const applied = applyReply(emptyLibrary(), { ...emptySync(WORKER), goalAt: T0 }, noWire(),
      reply({ goal: { value: 30, updated: T0 + 1 } }), T0 + 2);
    expect(applied.library.goal).toBe(30);
    const mine = { ...emptySync(WORKER), goalAt: T0 + 9, goalDirty: true };
    const sent = applyReply(setGoal(emptyLibrary(), 5), mine, { ...noWire(), goal: { value: 5, updated: T0 + 9 } },
      reply({ goal: { value: 30, updated: T0 + 1 } }), T0 + 10);
    expect(sent.library.goal).toBe(5);
    expect(sent.sync.goalDirty).toBe(false);
  });

  it("on a first sync, folds a book added here before into the same book from another device", () => {
    const added = book("Everyday Wonders", { isbn: "9780735211292" });
    const mine = { ...logPages(added.library, added.book.id, 40, "", TODAY).books[0], updated: T0, photo: "covers/m.jpg" };
    const theirs: Book = { ...added.book, id: "aaaaaaaa-1111-2222-3333-444444444444", updated: T0 - 5, progress: [] };
    const sync = { ...emptySync(WORKER), dirty: [mine.id] };
    const applied = applyReply({ ...added.library, books: [mine] }, sync, noWire(), reply({ books: [theirs] }), T0 + 1, true);
    expect(applied.library.books).toHaveLength(1);
    expect(applied.library.books[0]).toMatchObject({ id: theirs.id, photo: "covers/m.jpg", updated: T0 + 1 });
    expect(applied.library.books[0].progress).toHaveLength(1);
    expect(applied.sync.dirty).toEqual([theirs.id]);
    expect(applied.arrived).toBe(0);
  });
});

describe("reading what comes back", () => {
  it("checks the Worker's answer and the saved sync state, starting afresh from anything odd", () => {
    expect(readReply({ ok: true, cursor: 3, more: false, books: [], removed: [{ id: "a-1", at: T0 }, { id: "x y", at: 1 }],
      goal: { value: 2000, updated: T0 } })).toEqual({ cursor: 3, more: false, books: [], removed: [{ id: "a-1", at: T0 }],
      goal: null });
    expect(readReply({ ok: true, cursor: -1, more: false, books: [], removed: [] })).toBeNull();
    expect(readReply({ ok: true, cursor: 1, more: false, books: new Array(PER_REQUEST + 1).fill({}), removed: [] }))
      .toBeNull();
    expect(readReply({ ok: false })).toBeNull();
    expect(checkSync("{nope")).toEqual(emptySync());
    const saved = { ...emptySync(WORKER), cursor: 4, dirty: ["a-1", "a-1", "bad id"], removed: [{ id: "b-2", at: T0 }] };
    expect(checkSync(JSON.stringify(saved))).toEqual({ ...saved, dirty: ["a-1"] });
  });

  it("says how the sync stands in one line", () => {
    expect(syncMessage({ state: "synced", at: new Date(T0) }, "Asia/Dubai")).toBe("In step with your other devices, 12:00.");
    expect(syncMessage({ state: "signin" })).toMatch(/Sign in to Talk/);
    expect(syncMessage({ state: "idle" })).toBe("");
  });
});

describe("one exchange with the Worker", () => {
  const ok = (data: unknown, status = 200): Post => async () => ({ status, data, headers: {}, url: "" });

  it("posts natively to /app/books with the session and no redirects", async () => {
    let seen: Record<string, unknown> = {};
    const send: Post = async (options) => {
      seen = options as unknown as Record<string, unknown>;
      return { status: 200, data: { ok: true, cursor: 1, more: false, books: [], removed: [], goal: null }, headers: {}, url: "" };
    };
    const sent = await postBooks(WORKER, "s".repeat(43), noWire(), send);
    expect(sent.ok).toBe(true);
    expect(seen).toMatchObject({ url: `${WORKER}/app/books`, disableRedirects: true,
      headers: { Authorization: `Bearer ${"s".repeat(43)}` } });
  });

  it("says why it did not work, and never throws", async () => {
    expect(await postBooks(WORKER, "t", noWire(), ok({}, 401))).toEqual({ ok: false, why: "signin" });
    expect(await postBooks(WORKER, "t", noWire(), ok({}, 404))).toEqual({ ok: false, why: "missing" });
    expect(await postBooks(WORKER, "t", noWire(), ok({}, 302))).toEqual({ ok: false, why: "moved" });
    expect(await postBooks(WORKER, "t", noWire(), ok({ error: "Too many books." }, 400)))
      .toEqual({ ok: false, why: "refused", error: "Too many books." });
    expect(await postBooks(WORKER, "t", noWire(), ok({ ok: true }))).toMatchObject({ ok: false, why: "refused" });
    expect(await postBooks(WORKER, "t", noWire(), async () => { throw new Error("offline"); }))
      .toEqual({ ok: false, why: "offline" });
    expect(await postBooks(WORKER, "t", noWire(), () => new Promise(() => undefined), 10)).toEqual({ ok: false, why: "offline" });
  });
});

/** A Worker in memory with POST /app/books' merge rules (newest wins, removals, cursor, no echo, paging). */
function memoryWorker(page = PER_REQUEST) {
  let seq = 0;
  const books = new Map<string, { book: Book; seq: number }>();
  const removed = new Map<string, { at: number; seq: number }>();
  let goal: { value: number; updated: number; seq: number } | null = null;
  const post: Post = async (options) => {
    const wire = options.data as Wire;
    const wrote = new Set<string>();
    for (const b of wire.books) {
      const old = books.get(b.id);
      const tomb = removed.get(b.id);
      if (tomb && tomb.at >= b.updated) continue;
      if (!old || b.updated > old.book.updated) {
        books.set(b.id, { book: b, seq: ++seq });
        removed.delete(b.id);
        wrote.add(`${b.id}@${b.updated}`);
      }
    }
    for (const r of wire.removed) {
      const old = books.get(r.id);
      if (old && old.book.updated > r.at) continue;
      books.delete(r.id);
      removed.set(r.id, { at: r.at, seq: ++seq });
    }
    if (wire.goal && (!goal || wire.goal.updated > goal.updated)) goal = { ...wire.goal, seq: ++seq };
    const rows = [
      ...[...books.values()].filter((r) => r.seq > wire.cursor).map((r) => ({ seq: r.seq, book: r.book })),
      ...[...removed.entries()].filter(([, r]) => r.seq > wire.cursor).map(([id, r]) => ({ seq: r.seq, gone: { id, at: r.at } })),
    ].sort((a, b) => a.seq - b.seq);
    const shown = rows.slice(0, page);
    const more = rows.length > page;
    const cursor = more ? shown[shown.length - 1].seq : seq;
    return { status: 200, headers: {}, url: "", data: {
      ok: true, cursor, more,
      books: shown.flatMap((r) => ("book" in r && r.book && !wrote.has(`${r.book.id}@${r.book.updated}`) ? [r.book] : [])),
      removed: shown.flatMap((r) => ("gone" in r && r.gone ? [r.gone] : [])),
      goal: goal ? { value: goal.value, updated: goal.updated } : null,
    } };
  };
  return { post, size: () => books.size };
}

/** One device's sync as the app runs it (app/syncActions.ts), without the app around it. */
async function syncDevice(device: { library: Library; sync: ReturnType<typeof emptySync> }, post: Post, now: number) {
  if (device.sync.worker !== WORKER) Object.assign(device, startFresh(device.library, WORKER, now));
  let first = !device.sync.listened;
  for (let round = 0; round < 30; round += 1) {
    const listen = first;
    const { wire } = outgoing(device.library, device.sync, listen);
    const sent = await postBooks(WORKER, "t", wire, post);
    if (!sent.ok) throw new Error(sent.why);
    const applied = applyReply(device.library, device.sync, wire, sent.reply, now, first);
    device.library = applied.library;
    device.sync = applied.sync;
    if (!sent.reply.more) first = false;
    const pending = device.sync.dirty.length || device.sync.removed.length || device.sync.goalDirty;
    if (!sent.reply.more && !pending) break;
  }
}

describe("two devices and the user's Worker", () => {
  it("brings an Android import to the iPhone, folds the iPhone's own copy in, and carries edits and removals back", async () => {
    const worker = memoryWorker(3);
    let android = emptyLibrary();
    for (const title of ["Dune", "Emma", "Middlemarch", "Everyday Wonders", "Walden"]) android = book(title, {}, android).library;
    const phone = { library: book("Everyday Wonders").library, sync: emptySync() };
    const tablet = { library: android, sync: emptySync() };

    await syncDevice(tablet, worker.post, T0);
    expect(worker.size()).toBe(5);
    await syncDevice(phone, worker.post, T0 + 1000);
    expect(phone.library.books.map((b) => b.title).sort()).toEqual(["Dune", "Emma", "Everyday Wonders", "Middlemarch", "Walden"]);
    expect(worker.size()).toBe(5);

    const dune = phone.library.books.find((b) => b.title === "Dune")!;
    const edited = stampChanges(phone.library, setShelf(phone.library, dune.id, "reading", TODAY), T0 + 2000, phone.sync);
    const walden = edited.library.books.find((b) => b.title === "Walden")!;
    const removed = stampChanges(edited.library, { ...edited.library, books: edited.library.books.filter((b) => b !== walden) },
      T0 + 2001, edited.sync);
    Object.assign(phone, removed);
    await syncDevice(phone, worker.post, T0 + 3000);
    await syncDevice(tablet, worker.post, T0 + 4000);
    expect(tablet.library.books.find((b) => b.id === dune.id)?.shelf).toBe("reading");
    expect(tablet.library.books.some((b) => b.title === "Walden")).toBe(false);
    expect(tablet.sync.dirty).toEqual([]);
    expect(phone.sync.dirty).toEqual([]);
  });
});
