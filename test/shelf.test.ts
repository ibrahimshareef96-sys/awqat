// The TV's "reading now" shelf: built from the books in hand (at most twelve, with progress and an Open Library cover
// address), and sent to the Worker with native HTTP, the Talk session as the bearer, never following a redirect.
import { describe, expect, it, vi } from "vitest";
import { addBook, emptyLibrary, logPages, setShelf, type Library } from "../src/books/library.ts";
import { SHELF_MAX, sendShelf, shelfBooks, shelfMessage, type ShelfBook } from "../src/books/shelf.ts";

const TODAY = "2026-10-28";

function withBook(library: Library, title: string, extra: Partial<{ isbn: string; pages: number; coverId: number;
  authors: string[] }> = {}): Library {
  const draft = { title, authors: extra.authors ?? ["An Author"], isbn: extra.isbn ?? null, pages: extra.pages ?? null,
    coverId: extra.coverId ?? null, photo: null, source: "typed" as const, shelf: "reading" as const };
  return addBook(library, draft, TODAY).library;
}

describe("the shelf", () => {
  it("is the books in hand, with progress and a cover address from Open Library", () => {
    let library = withBook(emptyLibrary(), "With a cover id", { coverId: 12345, pages: 200 });
    library = withBook(library, "With an ISBN", { isbn: "9780141036144", pages: 0 });
    library = withBook(library, "With neither", { authors: ["One", "Two"] });
    const first = library.books.find((b) => b.title === "With a cover id");
    library = logPages(library, first?.id ?? "", 50, "", TODAY);
    const shelf = shelfBooks(library);
    expect(shelf).toHaveLength(3);
    expect(shelf.find((b) => b.title === "With a cover id")).toEqual({ title: "With a cover id", author: "An Author",
      progress: 25, cover: "https://covers.openlibrary.org/b/id/12345-M.jpg" });
    expect(shelf.find((b) => b.title === "With an ISBN")).toEqual({ title: "With an ISBN", author: "An Author",
      progress: 0, cover: "https://covers.openlibrary.org/b/isbn/9780141036144-M.jpg" });
    expect(shelf.find((b) => b.title === "With neither")).toEqual({ title: "With neither", author: "One, Two",
      progress: 0, cover: null });
  });

  it("leaves out books not being read, and keeps at most twelve, the most recently read first", () => {
    let library = emptyLibrary();
    for (let i = 0; i < 15; i += 1) library = withBook(library, `Book ${i}`);
    const done = library.books[0].id;
    library = setShelf(library, done, "read", TODAY);
    const shelf = shelfBooks(library);
    expect(shelf).toHaveLength(SHELF_MAX);
    expect(shelf.map((b) => b.title)).not.toContain("Book 0");
  });

  it("cuts long titles and authors to what the Worker takes, on whole characters, and drops invisible ones", () => {
    const long = "📚".repeat(100);
    const hidden = `${String.fromCodePoint(0x200b)}Quiet${String.fromCodePoint(0x2066)} title`;
    let library = withBook(emptyLibrary(), long, { authors: ["x".repeat(300)] });
    library = withBook(library, hidden);
    const shelf = shelfBooks(library);
    const cut = shelf.find((b) => b.title.startsWith("📚")) as ShelfBook;
    expect(cut.title.length).toBeLessThanOrEqual(160);
    expect(Array.from(cut.title).every((c) => c === "📚")).toBe(true);
    expect(cut.author.length).toBe(120);
    expect(shelf.some((b) => b.title === "Quiet title")).toBe(true);
  });

  it("leaves out a title the Worker would find blank, rather than have the whole shelf refused", () => {
    const blank = [0x3164, 0x2800, 0xffa0].map((c) => String.fromCodePoint(c)).join("");
    let library = withBook(emptyLibrary(), `x${blank}`, { authors: [blank] });
    library = { ...library, books: library.books.map((b) => ({ ...b, title: blank })) };
    library = withBook(library, "Real", { authors: [blank] });
    expect(shelfBooks(library)).toEqual([{ title: "Real", author: "", progress: 0, cover: null }]);
  });

  it("never sends more than the Worker's 32 KB", () => {
    let library = emptyLibrary();
    for (let i = 0; i < 12; i += 1) library = withBook(library, `${"ع".repeat(158)}${i}`, { authors: ["ب".repeat(120)] });
    expect(new TextEncoder().encode(JSON.stringify({ reading: shelfBooks(library) })).length).toBeLessThan(32 * 1024);
  });
});

describe("sending it", () => {
  const books: ShelfBook[] = [{ title: "A", author: "", progress: 10, cover: null }];

  it("PUTs the shelf to /app/library with the session, and never follows a redirect", async () => {
    const send = vi.fn(async () => ({ status: 200, data: { ok: true }, headers: {}, url: "" }));
    expect(await sendShelf("https://w.example.com", "t".repeat(43), books, send)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://w.example.com/app/library", data: { reading: books }, disableRedirects: true,
      headers: expect.objectContaining({ Authorization: `Bearer ${"t".repeat(43)}`, "Content-Type": "application/json" }),
    }));
  });

  it("says why it was not taken: signed out, not on the Worker yet, offline, or the Worker's own words", async () => {
    const reply = (status: number, data: unknown) => vi.fn(async () => ({ status, data, headers: {}, url: "" }));
    expect(await sendShelf("https://w.example.com", "t", books, reply(401, { error: "Sign in on the app first." })))
      .toEqual({ ok: false, why: "signin" });
    expect(await sendShelf("https://w.example.com", "t", books, reply(404, { error: "Not found." })))
      .toEqual({ ok: false, why: "missing" });
    expect(await sendShelf("https://w.example.com", "t", books, reply(302, null))).toEqual({ ok: false, why: "moved" });
    expect(await sendShelf("https://w.example.com", "t", books, vi.fn(async () => { throw new Error("offline"); })))
      .toEqual({ ok: false, why: "offline" });
    expect(await sendShelf("https://w.example.com", "t", books, reply(400, { error: "A book needs a title." })))
      .toEqual({ ok: false, why: "refused", error: "A book needs a title." });
    expect(await sendShelf("https://w.example.com", "t", books, reply(200, { ok: false }))).toEqual({ ok: false,
      why: "refused", error: "The Worker did not take the shelf." });
  });

  it("gives up on a request that never answers", async () => {
    const never = vi.fn(() => new Promise<never>(() => undefined));
    expect(await sendShelf("https://w.example.com", "t", books, never, 5)).toEqual({ ok: false, why: "offline" });
  });
});

describe("what Books says about the reading-now shelf", () => {
  it("names how the shelf stands", () => {
    const at = new Date("2026-10-28T08:05:00+04:00");
    expect(shelfMessage({ state: "sent", count: 3, at }, "Asia/Dubai")).toBe("On your reading-now shelf: 3 books, sent 08:05.");
    expect(shelfMessage({ state: "sent", count: 1, at }, "Asia/Dubai")).toBe("On your reading-now shelf: 1 book, sent 08:05.");
    expect(shelfMessage({ state: "sent", count: 0, at }, "Asia/Dubai")).toBe(
      "Your reading-now shelf has no book in hand, sent 08:05.");
    expect(shelfMessage({ state: "signin" }, "Asia/Dubai")).toBe(
      "Sign in once with Talk (the orb) and the books in hand go to your reading-now shelf.");
    expect(shelfMessage({ state: "moved" }, "Asia/Dubai")).toBe(
      "Your Worker's address sent the shelf somewhere else. Check the Voice address in Settings.");
    expect(shelfMessage({ state: "offline" }, "Asia/Dubai")).toBe("The reading-now shelf is sent when there is a connection.");
    expect(shelfMessage({ state: "refused", error: "Too long." }, "Asia/Dubai")).toBe("The reading-now shelf was refused: Too long.");
    expect(shelfMessage({ state: "idle" }, "Asia/Dubai")).toBe("");
  });

  it("says nothing when the server does not take a shelf: it is optional", () => {
    expect(shelfMessage({ state: "missing" }, "Asia/Dubai")).toBe("");
  });
});
