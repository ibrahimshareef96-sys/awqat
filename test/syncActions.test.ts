// @vitest-environment happy-dom
// The app's side of keeping books the same everywhere: only with a Talk session, a first sync that listens before it
// sends, what arrives saved and its covers found, a session the Worker no longer knows dropped, and a change made here
// sent a moment later.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/device.ts", () => ({ isNative: () => true, platform: () => "android" }));
vi.mock("../src/store.ts", () => ({
  KEYS: { settings: "settings", library: "library", bookSync: "bookSync" },
  write: vi.fn(async () => true), read: vi.fn(), keepAside: vi.fn(),
}));
vi.mock("../src/talk/session.ts", async (actual) => ({ ...(await actual<typeof import("../src/talk/session.ts")>()),
  clearSession: vi.fn(async () => true) }));
vi.mock("../src/books/media.ts", () => ({ removeCoverPhoto: vi.fn(async () => undefined), coverPhoto: vi.fn(),
  downloadCover: vi.fn(), scanIsbn: vi.fn(), saveCover: vi.fn(), removeUnusedCovers: vi.fn() }));

import { write } from "../src/store.ts";
import { clearSession } from "../src/talk/session.ts";
import { addBook, emptyLibrary, setShelf } from "../src/books/library.ts";
import { emptySync, type Post, type Wire } from "../src/books/sync.ts";
import { hooks, state } from "../src/app/state.ts";
import { setLibrary } from "../src/app/bookActions.ts";
import { SYNC_PAUSE_MS, resetBookSync, syncBooks } from "../src/app/syncActions.ts";

const WORKER = "https://os.example.com";
const SESSION = "s".repeat(43);
const TODAY = "2026-10-28";

const answer = (data: Record<string, unknown>, status = 200) => ({ status, headers: {}, url: "", data });
const empty = (cursor: number) => answer({ ok: true, cursor, more: false, books: [], removed: [], goal: null });

beforeEach(() => {
  vi.clearAllMocks();
  resetBookSync();
  state.settings = { ...state.settings, voiceUrl: WORKER };
  state.talk = { phase: "idle", message: "", caption: "", muted: false, logged: "", session: { worker: WORKER, token: SESSION },
    sessionRead: true };
  state.library = emptyLibrary();
  state.bookSync = emptySync();
  state.bookSyncNote = { state: "idle" };
  state.blocked.clear();
  hooks.softRender = vi.fn();
  hooks.render = vi.fn();
  hooks.findCovers = vi.fn(async () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  resetBookSync();
});

describe("syncing books from the app", () => {
  it("says nothing and sends nothing with no server set up: the library lives on this device", async () => {
    state.settings = { ...state.settings, voiceUrl: "" };
    const send = vi.fn<Post>();
    await syncBooks(send);
    expect(send).not.toHaveBeenCalled();
    expect(state.bookSyncNote).toEqual({ state: "idle" });
  });

  it("asks for a Talk sign-in when there is no session, and sends nothing", async () => {
    state.talk = { ...state.talk, session: null };
    const send = vi.fn<Post>();
    await syncBooks(send);
    expect(send).not.toHaveBeenCalled();
    expect(state.bookSyncNote).toEqual({ state: "signin" });
  });

  it("listens first on a first sync, then sends its own books, and keeps the cursor", async () => {
    state.library = addBook(emptyLibrary(), { title: "Dune", authors: [], isbn: null, pages: null, coverId: null,
      photo: null, source: "typed" }, TODAY).library;
    const wires: Wire[] = [];
    const send: Post = async (options) => {
      wires.push(options.data as Wire);
      return empty(wires.length === 1 ? 0 : 5);
    };
    await syncBooks(send);
    expect(wires).toHaveLength(2);
    expect(wires[0].books).toEqual([]);
    expect(wires[1].books.map((b) => b.title)).toEqual(["Dune"]);
    expect(state.bookSync).toMatchObject({ worker: WORKER, cursor: 5, dirty: [] });
    expect(state.bookSyncNote.state).toBe("synced");
    expect(write).toHaveBeenCalledWith("bookSync", expect.objectContaining({ cursor: 5 }));
  });

  it("listens again after a first sync cut off half way, sending nothing until it has heard everything", async () => {
    state.library = addBook(emptyLibrary(), { title: "Dune", authors: [], isbn: null, pages: null, coverId: null,
      photo: null, source: "typed" }, TODAY).library;
    const wires: Wire[] = [];
    let calls = 0;
    const cut: Post = async (options) => {
      wires.push(options.data as Wire);
      calls += 1;
      return calls === 1 ? answer({ ok: true, cursor: 3, more: true, books: [], removed: [], goal: null }) : answer({}, 503);
    };
    await syncBooks(cut);
    expect(state.bookSync).toMatchObject({ cursor: 3, listened: false });
    wires.length = 0;
    await syncBooks(async (options) => {
      wires.push(options.data as Wire);
      return empty(wires.length === 1 ? 6 : 7);
    });
    expect(wires[0]).toMatchObject({ cursor: 3, books: [] });
    expect(wires[1].books.map((b) => b.title)).toEqual(["Dune"]);
    expect(state.bookSync.listened).toBe(true);
  });

  it("saves the books that arrive and finds their covers", async () => {
    const theirs = { ...addBook(emptyLibrary(), { title: "Emma", authors: [], isbn: null, pages: null, coverId: 9,
      photo: null, source: "typed" }, TODAY).book, updated: 1_800_000_000_000 };
    const send: Post = async () => answer({ ok: true, cursor: 1, more: false, books: [theirs], removed: [], goal: null });
    await syncBooks(send);
    expect(state.library.books.map((b) => b.title)).toEqual(["Emma"]);
    expect(write).toHaveBeenCalledWith("library", expect.objectContaining({ books: [expect.objectContaining({ title: "Emma" })] }));
    expect(hooks.findCovers).toHaveBeenCalledWith(true);
    // What arrived is not marked to go back.
    expect(state.bookSync.dirty).toEqual([]);
  });

  it("drops a session the Worker no longer knows, and says to sign in", async () => {
    await syncBooks(async () => answer({}, 401));
    expect(state.talk.session).toBeNull();
    expect(clearSession).toHaveBeenCalled();
    expect(state.bookSyncNote).toEqual({ state: "signin" });
  });

  it("stops when the Worker says there is more without moving on, instead of asking again and again", async () => {
    const send = vi.fn<Post>(async () => answer({ ok: true, cursor: 0, more: true, books: [], removed: [], goal: null }));
    await syncBooks(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.bookSyncNote).toMatchObject({ state: "refused" });
  });

  it("does nothing with a library that could not be read", async () => {
    state.blocked.add("library");
    const send = vi.fn<Post>();
    await syncBooks(send);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a change made here a moment after it, marked and stamped", async () => {
    vi.useFakeTimers();
    const send = vi.fn<Post>(async () => empty(3));
    await syncBooks(send);
    send.mockClear();
    const added = addBook(state.library, { title: "Walden", authors: [], isbn: null, pages: null, coverId: null,
      photo: null, source: "typed" }, TODAY);
    await setLibrary(added.library);
    expect(state.bookSync.dirty).toEqual([added.book.id]);
    expect(state.library.books[0].updated).toBeGreaterThan(0);
    await setLibrary(setShelf(state.library, added.book.id, "reading", TODAY));
    // Nothing goes until the changes settle; then one sync carries them (it is the test's send only when asked with it).
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SYNC_PAUSE_MS - 1);
    expect(state.bookSync.dirty).toEqual([added.book.id]);
  });
});
