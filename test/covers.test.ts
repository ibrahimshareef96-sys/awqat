// @vitest-environment happy-dom
// Find covers: the race with the user's own photo, when it stops, and the start-up clean-up that must never empty the user's covers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/books/openlibrary.ts", () => ({ findIsbn: vi.fn(), findTitle: vi.fn(), lookupIsbn: vi.fn() }));
vi.mock("../src/books/media.ts", () => ({
  saveCover: vi.fn(), removeUnusedCovers: vi.fn(async () => 0), removeCoverPhoto: vi.fn(async () => undefined),
  coverPhoto: vi.fn(), downloadCover: vi.fn(), scanIsbn: vi.fn(),
}));
vi.mock("../src/store.ts", () => ({
  KEYS: { log: "log", settings: "settings", place: "place", quran: "quran", library: "library", bookSync: "bookSync" },
  write: vi.fn(async () => true), read: vi.fn(), keepAside: vi.fn(),
}));

import { findIsbn, findTitle } from "../src/books/openlibrary.ts";
import { removeCoverPhoto, removeUnusedCovers, saveCover } from "../src/books/media.ts";
import { write } from "../src/store.ts";
import { addBook, emptyLibrary, updateBook, type Library } from "../src/books/library.ts";
import { emptySync } from "../src/books/sync.ts";
import { MESSAGES, state } from "../src/app/state.ts";
import { findCovers, forgetSlowDown, tidyCovers } from "../src/app/coverActions.ts";

const TODAY = "2026-10-23";
const found = (coverId: number | null) => ({ found: { title: "T", authors: [], pages: 200, coverId } });

/** Books with real ISBNs and no cover yet; fresh ids every call, so one test's skipped books never touch another's. */
function libraryOf(count: number): { library: Library; ids: string[] } {
  const isbns = ["9780140328721", "9780735211292", "9780307465351", "9780062316097"];
  return isbns.slice(0, count).reduce(({ library, ids }, isbn, i) => {
    const result = addBook(library, { title: `Book ${i}`, authors: [], isbn, pages: null, coverId: null, photo: null,
      source: "typed" }, TODAY);
    return { library: result.library, ids: [...ids, result.book.id] };
  }, { library: emptyLibrary(), ids: [] as string[] });
}

async function run(): Promise<void> {
  const done = findCovers();
  await vi.runAllTimersAsync();
  await done;
}

beforeEach(() => {
  vi.useFakeTimers();
  // The app's "today" comes from the clock: pin it to TODAY (midday in Dubai) so the test holds on any day.
  vi.setSystemTime(new Date(`${TODAY}T08:00:00Z`));
  vi.mocked(findIsbn).mockReset();
  vi.mocked(findTitle).mockReset();
  vi.mocked(findTitle).mockResolvedValue({ none: true });
  vi.mocked(saveCover).mockReset();
  state.bookSync = emptySync();
  forgetSlowDown();
  vi.mocked(removeCoverPhoto).mockClear();
  vi.mocked(removeUnusedCovers).mockClear();
  vi.mocked(write).mockImplementation(async () => true);
  state.blocked.clear();
  state.covers = null;
  state.notice = "";
  state.draft = { title: "", author: "", pages: "", isbn: "", photo: null };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("finding covers", () => {
  it("saves the cover and pages it finds", async () => {
    const { library, ids } = libraryOf(1);
    state.library = library;
    vi.mocked(findIsbn).mockResolvedValue(found(7));
    vi.mocked(saveCover).mockResolvedValue({ photo: "covers/ol-7.jpg" });
    await run();
    expect(state.library.books[0]).toMatchObject({ id: ids[0], coverId: 7, photo: "covers/ol-7.jpg", pages: 200 });
    expect(state.notice).toMatch(/Found 1 cover/);
  });

  it("keeps the user's own photo when it arrives while Open Library is answering, and drops the downloaded one", async () => {
    const { library, ids } = libraryOf(1);
    state.library = library;
    vi.mocked(findIsbn).mockResolvedValue(found(7));
    vi.mocked(saveCover).mockImplementation(async () => {
      state.library = updateBook(state.library, ids[0], { photo: "covers/mine.jpg" });
      return { photo: "covers/ol-7.jpg" };
    });
    await run();
    expect(state.library.books[0].photo).toBe("covers/mine.jpg");
    expect(removeCoverPhoto).toHaveBeenCalledWith("covers/ol-7.jpg");
  });

  it("marks a book checked when Open Library has no cover, so it is not asked again", async () => {
    const { library } = libraryOf(1);
    state.library = library;
    vi.mocked(findIsbn).mockResolvedValue(found(7));
    vi.mocked(saveCover).mockResolvedValue({ missing: true });
    await run();
    expect(state.library.books[0]).toMatchObject({ coverId: null, coverChecked: TODAY, photo: null });
  });

  it("finds a cover by title and author for a book with no ISBN, as many Goodreads rows are", async () => {
    const added = addBook(emptyLibrary(), { title: "The Name of the Wind (The Kingkiller Chronicle, #1)",
      authors: ["Yusuf Example"], isbn: null, pages: null, coverId: null, photo: null, source: "goodreads" }, TODAY);
    state.library = added.library;
    vi.mocked(findTitle).mockResolvedValue(found(11480483));
    vi.mocked(saveCover).mockResolvedValue({ photo: "covers/ol-11480483.jpg" });
    await run();
    expect(findIsbn).not.toHaveBeenCalled();
    expect(findTitle).toHaveBeenCalledWith("The Name of the Wind (The Kingkiller Chronicle, #1)", "Yusuf Example");
    expect(state.library.books[0]).toMatchObject({ coverId: 11480483, photo: "covers/ol-11480483.jpg" });
  });

  it("asks by title when the ISBN's record has no cover, and marks the book checked when neither has one", async () => {
    const { library } = libraryOf(2);
    state.library = { ...library, books: library.books.map((b) => ({ ...b, authors: ["A. Writer"] })) };
    vi.mocked(findIsbn).mockResolvedValue(found(null));
    vi.mocked(findTitle).mockResolvedValueOnce(found(9)).mockResolvedValueOnce({ none: true });
    vi.mocked(saveCover).mockResolvedValue({ photo: "covers/ol-9.jpg" });
    await run();
    expect(findTitle).toHaveBeenCalledTimes(2);
    expect(state.library.books[0]).toMatchObject({ coverId: 9, photo: "covers/ol-9.jpg" });
    expect(state.library.books[1]).toMatchObject({ coverId: null, coverChecked: TODAY });
  });

  it("marks what it found for the user's other devices (the cover's id, the check), but not the cover file alone", async () => {
    const { library, ids } = libraryOf(2);
    state.library = updateBook(library, ids[1], { coverId: 5 });
    vi.mocked(findIsbn).mockResolvedValue(found(7));
    vi.mocked(saveCover).mockImplementation(async (id: number) => ({ photo: `covers/ol-${id}.jpg` }));
    await run();
    expect(state.bookSync.dirty).toEqual([ids[0]]);
    expect(state.library.books[0].updated).toBeGreaterThan(0);
    expect(state.library.books[1]).toMatchObject({ photo: "covers/ol-5.jpg", updated: 0 });
  });

  it("stamps a find just after the copy it changed, not with the clock, so it never outranks an edit elsewhere", async () => {
    const { library, ids } = libraryOf(1);
    state.library = { ...library, books: [{ ...library.books[0], updated: 1000 }] };
    vi.mocked(findIsbn).mockResolvedValue(found(7));
    vi.mocked(saveCover).mockResolvedValue({ photo: "covers/ol-7.jpg" });
    await run();
    expect(state.library.books[0]).toMatchObject({ id: ids[0], coverId: 7, updated: 1001 });
  });

  it("never asks by title alone: a book with no author and no ISBN cover is marked checked", async () => {
    const added = addBook(emptyLibrary(), { title: "Poems", authors: [], isbn: null, pages: null, coverId: null,
      photo: null, source: "goodreads" }, TODAY);
    state.library = added.library;
    await run();
    expect(findTitle).not.toHaveBeenCalled();
    expect(state.library.books[0].coverChecked).toBe(TODAY);
  });

  it("after Open Library asks to slow down, waits ten minutes before a run of its own (a tap still asks)", async () => {
    const { library } = libraryOf(2);
    state.library = library;
    vi.mocked(findIsbn).mockResolvedValue({ failed: true, slowDown: true });
    await run();
    vi.mocked(findIsbn).mockClear();
    await findCovers(true);
    expect(findIsbn).not.toHaveBeenCalled();
    await run();
    expect(findIsbn).toHaveBeenCalledTimes(1);
    vi.mocked(findIsbn).mockClear();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    vi.mocked(findIsbn).mockResolvedValue({ none: true });
    const done = findCovers(true);
    await vi.runAllTimersAsync();
    await done;
    expect(findIsbn).toHaveBeenCalled();
  });

  it("says nothing on a run of its own that found none, and takes the next batch by itself", async () => {
    const { library } = libraryOf(1);
    state.library = library;
    vi.mocked(findIsbn).mockResolvedValue({ none: true });
    const done = findCovers(true);
    await vi.runAllTimersAsync();
    await done;
    expect(state.notice).toBe("");
    expect(state.library.books[0].coverChecked).toBe(TODAY);
  });

  it("stops at once when Open Library asks it to slow down", async () => {
    const { library } = libraryOf(3);
    state.library = library;
    vi.mocked(findIsbn).mockResolvedValue({ failed: true, slowDown: true });
    await run();
    expect(findIsbn).toHaveBeenCalledTimes(1);
    expect(state.notice).toMatch(/slow down/);
    expect(state.covers).toBeNull();
  });

  it("stops after three failures in a row, and skips those books on the next tap this session", async () => {
    const { library } = libraryOf(4);
    state.library = library;
    vi.mocked(findIsbn).mockResolvedValue({ failed: true, slowDown: false });
    await run();
    expect(findIsbn).toHaveBeenCalledTimes(3);
    expect(state.notice).toMatch(/not answering/);
    vi.mocked(findIsbn).mockClear();
    vi.mocked(findIsbn).mockResolvedValue({ none: true });
    await run();
    expect(findIsbn).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the library could not be read", async () => {
    state.library = libraryOf(1).library;
    state.blocked.add("library");
    await run();
    expect(findIsbn).not.toHaveBeenCalled();
    expect(state.notice).toBe(MESSAGES.unreadable);
  });

  it("says so when the save failed, instead of reporting success", async () => {
    state.library = libraryOf(1).library;
    vi.mocked(findIsbn).mockResolvedValue(found(7));
    vi.mocked(saveCover).mockResolvedValue({ photo: "covers/ol-7.jpg" });
    vi.mocked(write).mockImplementation(async () => false);
    await run();
    expect(state.notice).toBe(MESSAGES.unsaved);
  });
});

describe("the start-up clean-up", () => {
  it("never runs when the library was not read cleanly", async () => {
    state.library = emptyLibrary();
    await tidyCovers(false);
    expect(removeUnusedCovers).not.toHaveBeenCalled();
  });

  it("keeps every cover a book uses, and the photo of a book being added", async () => {
    const { library, ids } = libraryOf(1);
    state.library = updateBook(library, ids[0], { photo: "covers/a.jpg" });
    state.draft = { ...state.draft, photo: "covers/draft.jpg" };
    await tidyCovers(true);
    expect(removeUnusedCovers).toHaveBeenCalledWith(new Set(["covers/a.jpg", "covers/draft.jpg"]));
  });
});
