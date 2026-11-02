// Books: ISBNs from a barcode, the Open Library lookup, the library itself, and the Goodreads import.
import { describe, expect, it } from "vitest";
import { cleanIsbn, toIsbn13 } from "../src/books/isbn.ts";
import { coverUrl, findIsbn, lookupIsbn, parseSearch } from "../src/books/openlibrary.ts";
import {
  addBook, addBooks, addLesson, checkLibrary, currentPage, deleteLesson, emptyLibrary, finishedIn, inHand, logPages,
  markCoverChecked, needsCover, photoInUse, searchBooks, setCommentary, setGoal, setShelf, shelfCounts, updateBook,
} from "../src/books/library.ts";
import { GOODREADS_MAX_ROWS, goodreadsDrafts, importDrafts, parseCsv } from "../src/books/goodreads.ts";

const TODAY = "2026-10-23";

describe("ISBNs", () => {
  it("accepts valid ISBN-13 and ISBN-10, with or without dashes, and refuses bad check digits", () => {
    expect(cleanIsbn("978-0-14-032872-1")).toBe("9780140328721");
    expect(cleanIsbn("0-14-032872-6")).toBe("0140328726");
    expect(cleanIsbn("080442957X")).toBe("080442957X");
    expect(cleanIsbn("9780140328722")).toBeNull();
    expect(cleanIsbn('="9780140328721"')).toBe("9780140328721");
    expect(cleanIsbn("")).toBeNull();
  });

  it("turns an ISBN-10 into its ISBN-13", () => {
    expect(toIsbn13("0140328726")).toBe("9780140328721");
    expect(toIsbn13("9780140328721")).toBe("9780140328721");
  });
});

describe("Open Library", () => {
  const found = { docs: [{ title: "Curious Ms Cat", author_name: ["Yusuf Example"], number_of_pages_median: 96, cover_i: 6498519 }] };

  it("reads a search result into a draft", () => {
    expect(parseSearch(found)).toEqual({ title: "Curious Ms Cat", authors: ["Yusuf Example"], pages: 96, coverId: 6498519 });
    expect(parseSearch({ docs: [] })).toBeNull();
    expect(parseSearch({ docs: [{ title: 5 }] })).toBeNull();
    expect(parseSearch(null)).toBeNull();
  });

  it("builds the medium cover address (a 404, not a blank image, when there is none), and none for a bad id", () => {
    expect(coverUrl(6498519)).toBe("https://covers.openlibrary.org/b/id/6498519-M.jpg?default=false");
    expect(coverUrl(-1)).toBeNull();
    expect(coverUrl(1e21)).toBeNull();
    expect(parseSearch({ docs: [{ title: "Big", cover_i: 1e21 }] })?.coverId).toBeNull();
  });

  it("asks Open Library by ISBN and gives null when it cannot", async () => {
    const asked: string[] = [];
    const ok = async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(found), { status: 200 });
    };
    expect(await lookupIsbn("9780140328721", ok)).toMatchObject({ title: "Curious Ms Cat" });
    expect(asked[0]).toMatch(/^https:\/\/openlibrary\.org\/search\.json\?isbn=9780140328721&/);
    expect(await lookupIsbn("9780140328721", async () => new Response("", { status: 500 }))).toBeNull();
    expect(await lookupIsbn("9780140328721", async () => { throw new Error("offline"); })).toBeNull();
    expect(await lookupIsbn("not-an-isbn", ok)).toBeNull();
  });

  it("tells a missing book apart from a failed or throttled request", async () => {
    const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });
    expect(await findIsbn("9780140328721", reply(200, found))).toMatchObject({ found: { coverId: 6498519 } });
    expect(await findIsbn("9780140328721", reply(200, { docs: [] }))).toEqual({ none: true });
    expect(await findIsbn("9780140328721", reply(500))).toEqual({ failed: true, slowDown: false });
    expect(await findIsbn("9780140328721", reply(429))).toEqual({ failed: true, slowDown: true });
    expect(await findIsbn("9780140328721", reply(503))).toEqual({ failed: true, slowDown: true });
    expect(await findIsbn("9780140328721", async () => { throw new Error("offline"); })).toEqual({ failed: true, slowDown: false });
    expect(await findIsbn("bad", reply(200, found))).toEqual({ none: true });
  });
});

describe("the library", () => {
  const draft = { title: "Curious Ms Cat", authors: ["Yusuf Example"], isbn: "9780140328721", pages: 96, coverId: 6498519,
    photo: null, source: "scan" as const };

  it("adds a book once and spots the same book again", () => {
    const first = addBook(emptyLibrary(), draft, TODAY);
    expect(first.duplicate).toBe(false);
    expect(first.library.books).toHaveLength(1);
    expect(first.book.shelf).toBe("want");
    const again = addBook(first.library, { ...draft, isbn: "0140328726" }, TODAY);
    expect(again.duplicate).toBe(true);
    expect(again.library.books).toHaveLength(1);
    const byTitle = addBook(first.library, { ...draft, isbn: null, title: "curious ms. cat" }, TODAY);
    expect(byTitle.duplicate).toBe(true);
  });

  it("refuses a book without a title", () => {
    expect(() => addBook(emptyLibrary(), { ...draft, title: "   " }, TODAY)).toThrow();
  });

  it("logs pages, starts the book, and finishes it at the last page", () => {
    const { library, book } = addBook(emptyLibrary(), draft, TODAY);
    let lib = logPages(library, book.id, 40, "Chapter 4, the digging", TODAY);
    let b = lib.books[0];
    expect(b.shelf).toBe("reading");
    expect(b.started).toBe(TODAY);
    expect(currentPage(b)).toBe(40);
    lib = logPages(lib, book.id, 200, "", "2026-10-25");
    b = lib.books[0];
    expect(currentPage(b)).toBe(96);
    expect(b.shelf).toBe("read");
    expect(b.finished).toBe("2026-10-25");
    expect(finishedIn(lib, 2026)).toBe(1);
  });

  it("keeps lessons and commentary, trimmed and capped", () => {
    const { library, book } = addBook(emptyLibrary(), draft, TODAY);
    let lib = addLesson(library, book.id, "  Plans fail; foxes adapt.  ", TODAY);
    expect(lib.books[0].lessons[0].text).toBe("Plans fail; foxes adapt.");
    expect(addLesson(lib, book.id, "   ", TODAY)).toBe(lib);
    lib = deleteLesson(lib, book.id, lib.books[0].lessons[0].id);
    expect(lib.books[0].lessons).toHaveLength(0);
    lib = setCommentary(lib, book.id, "x".repeat(9000));
    expect(lib.books[0].commentary.length).toBe(4000);
  });

  it("moves between shelves, counts them, and lists what is in hand", () => {
    const one = addBook(emptyLibrary(), draft, TODAY);
    const two = addBook(one.library, { ...draft, isbn: null, title: "Everyday Wonders", authors: ["Sara Example"] }, TODAY);
    let lib = setShelf(two.library, two.book.id, "reading", TODAY);
    lib = setShelf(lib, one.book.id, "owned", TODAY);
    expect(shelfCounts(lib)).toMatchObject({ reading: 1, owned: 1, want: 0, read: 0 });
    expect(inHand(lib).map((b) => b.title)).toEqual(["Everyday Wonders"]);
  });

  it("marks a book read today when it is moved there by hand", () => {
    const { library, book } = addBook(emptyLibrary(), draft, TODAY);
    expect(setShelf(library, book.id, "read", TODAY).books[0].finished).toBe(TODAY);
    expect(addBook(emptyLibrary(), { ...draft, shelf: "read" }, TODAY).book.finished).toBe(TODAY);
  });

  it("remembers when a cover was looked for and not found", () => {
    const { library, book } = addBook(emptyLibrary(), draft, TODAY);
    const checked = markCoverChecked(library, book.id, TODAY);
    expect(checked.books[0].coverChecked).toBe(TODAY);
    expect(checkLibrary(JSON.stringify(checked)).library.books[0].coverChecked).toBe(TODAY);
  });

  it("lists the books a cover can still come for, and keeps a shared cover file while a book uses it", () => {
    const one = addBook(emptyLibrary(), draft, TODAY);
    const two = addBook(one.library, { ...draft, isbn: "9780735211292", title: "Everyday Wonders", coverId: null }, TODAY);
    const three = addBook(two.library, { ...draft, isbn: null, title: "Typed", coverId: null }, TODAY);
    // A book with no ISBN is asked about by its title and author (many Goodreads rows have none).
    expect(needsCover(three.library).map((b) => b.title)).toEqual(["Curious Ms Cat", "Everyday Wonders", "Typed"]);
    let lib = updateBook(three.library, one.book.id, { photo: "covers/ol-6498519.jpg" });
    lib = markCoverChecked(lib, two.book.id, TODAY);
    lib = markCoverChecked(lib, three.book.id, TODAY);
    expect(needsCover(lib)).toEqual([]);
    expect(photoInUse(lib, "covers/ol-6498519.jpg")).toBe(true);
    expect(photoInUse(lib, "covers/other.jpg")).toBe(false);
    expect(photoInUse(lib, null)).toBe(false);
  });

  it("rejects bad cover ids and page counts, and strips hidden direction marks from titles", () => {
    const flip = String.fromCodePoint(0x202e);
    const { book } = addBook(emptyLibrary(), { ...draft, title: `Evil${flip}gpj.exe\nTitle`, coverId: -3, pages: 1e300 }, TODAY);
    expect(book.title).toBe("Evilgpj.exe Title");
    expect(book.coverId).toBeNull();
    expect(book.pages).toBeNull();
    const lib = updateBook(emptyLibrary(), "x", { coverId: 1.5 });
    expect(lib.books).toEqual([]);
  });

  it("strips zero-width and tag characters but keeps the joiners that emoji and Persian need", () => {
    const [zws, bom, tag, zwj] = [0x200b, 0xfeff, 0xe0041, 0x200d].map((c) => String.fromCodePoint(c));
    const { book } = addBook(emptyLibrary(), { ...draft, title: `Hid${zws}den${bom} Ti${tag}tle ok${zwj}` }, TODAY);
    expect(book.title).toBe(`Hidden Title ok${zwj}`);
    expect(() => addBook(emptyLibrary(), { ...draft, title: `${zws}${bom}` }, TODAY)).toThrow(RangeError);
  });

  it("cleans notes, lessons and pages when reading a saved library back", () => {
    const { library } = addBook(emptyLibrary(), draft, TODAY);
    const bell = String.fromCodePoint(7);
    const raw = JSON.parse(JSON.stringify(library));
    raw.books[0].commentary = `Note${bell}`;
    raw.books[0].lessons = [{ id: "l", date: TODAY, text: `Lesson${bell}` }];
    raw.books[0].progress = [{ id: "p", date: TODAY, page: 1e9, note: `Line${bell}` }];
    const back = checkLibrary(JSON.stringify(raw)).library.books[0];
    expect(back.commentary).toBe("Note");
    expect(back.lessons[0].text).toBe("Lesson");
    expect(back.progress[0]).toMatchObject({ page: 20000, note: "Line" });
  });

  it("keeps line breaks in notes but not other control characters", () => {
    const { library, book } = addBook(emptyLibrary(), draft, TODAY);
    const bell = String.fromCodePoint(7);
    const lib = setCommentary(library, book.id, `First line\r\nSecond${bell} line`);
    expect(lib.books[0].commentary).toBe("First line\nSecond line");
  });

  it("adds many books at once, deciding duplicates the same way as one at a time", () => {
    const one = addBook(emptyLibrary(), draft, TODAY).library;
    const drafts = [
      { ...draft, isbn: "0140328726" },
      { ...draft, isbn: null, title: "CURIOUS MS CAT!" },
      { ...draft, isbn: "9780735211292", title: "Curious Ms Cat" },
      { ...draft, isbn: null, title: "New One", authors: ["Someone"] },
      { ...draft, isbn: null, title: "new one", authors: ["someone"] },
      { ...draft, isbn: null, title: "   " },
    ];
    const result = addBooks(one, drafts, TODAY);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(4);
    expect(result.library.books.map((b) => b.title)).toEqual(["Curious Ms Cat", "Curious Ms Cat", "New One"]);
    expect(addBooks(one, [], TODAY).library).toBe(one);
  });

  it("finds books by words of the title or an author", () => {
    const one = addBook(emptyLibrary(), draft, TODAY);
    const two = addBook(one.library, { ...draft, isbn: null, title: "Everyday Wonders", authors: ["Sara Example"] }, TODAY);
    const books = two.library.books;
    expect(searchBooks(books, "yusuf").map((b) => b.title)).toEqual(["Curious Ms Cat"]);
    expect(searchBooks(books, "  everyday   SARA ").map((b) => b.title)).toEqual(["Everyday Wonders"]);
    expect(searchBooks(books, "wond").map((b) => b.title)).toEqual(["Everyday Wonders"]);
    expect(searchBooks(books, "onders")).toEqual([]);
    expect(searchBooks(books, "")).toHaveLength(2);
  });

  it("keeps a yearly goal between 0 and 1000", () => {
    expect(setGoal(emptyLibrary(), 24).goal).toBe(24);
    expect(setGoal(emptyLibrary(), -5).goal).toBe(0);
    expect(setGoal(emptyLibrary(), 1e6).goal).toBe(1000);
  });

  it("reads back a saved library field by field", () => {
    const { library } = addBook(emptyLibrary(), draft, TODAY);
    expect(checkLibrary(JSON.stringify(library))).toEqual({ library, damaged: false });
    expect(checkLibrary("nope").damaged).toBe(true);
    const tampered = JSON.parse(JSON.stringify(library));
    tampered.books.push({ id: "x", title: "" }, { id: "y", title: "Ok", shelf: "nowhere", authors: "Sara Example" });
    const back = checkLibrary(JSON.stringify(tampered)).library;
    expect(back.books.map((b) => b.title)).toEqual(["Curious Ms Cat", "Ok"]);
    expect(back.books[1].shelf).toBe("want");
    expect(back.books[1].authors).toEqual([]);
  });
});

describe("the Goodreads export", () => {
  const csv = [
    "Book Id,Title,Author,Additional Authors,ISBN,ISBN13,My Rating,Number of Pages,Date Read,Date Added,Bookshelves,Exclusive Shelf,My Review",
    '1,"Everyday Wonders: An Easy, Proven Way",Sara Example,,"=""0735211299""","=""9780735211292""",5,320,2025/03/10,2025/01/02,,read,"Tiny changes, ""remarkable"" results"',
    '2,The Sealed Nectar,Yusuf Example,,"=""""","=""""",0,,,2026/05/01,,currently-reading,',
    '3,Deep Work,Sara Example,,,,0,296,,2026/06/01,,to-read,"line one\nline two"',
  ].join("\n");

  it("parses quoted fields, doubled quotes and line breaks inside a field", () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[1][1]).toBe("Everyday Wonders: An Easy, Proven Way");
    expect(rows[1][12]).toBe('Tiny changes, "remarkable" results');
    expect(rows[3][12]).toBe("line one\nline two");
  });

  it("maps shelves, ISBNs, pages, dates, ratings and reviews", () => {
    const drafts = goodreadsDrafts(parseCsv(csv));
    expect(drafts.map((d) => d.shelf)).toEqual(["read", "reading", "want"]);
    expect(drafts[0]).toMatchObject({ isbn: "9780735211292", pages: 320, finished: "2025-03-10", rating: 5,
      commentary: 'Tiny changes, "remarkable" results', source: "goodreads" });
    expect(drafts[1].isbn).toBeNull();
  });

  it("imports into the library once: a second import adds nothing", () => {
    const drafts = goodreadsDrafts(parseCsv(csv));
    const first = importDrafts(emptyLibrary(), drafts, TODAY);
    expect(first.added).toBe(3);
    const again = importDrafts(first.library, drafts, TODAY);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(3);
    expect(finishedIn(first.library, 2025)).toBe(1);
  });

  it("leaves a read book without a date read undated, so it never counts toward this year", () => {
    const undated = [
      "Book Id,Title,Author,ISBN13,Date Read,Date Added,Exclusive Shelf,My Review",
      "1,Old Book,Some Author,,,2015/01/01,read,Good<br/>really good",
    ].join("\n");
    const drafts = goodreadsDrafts(parseCsv(undated));
    const { library } = importDrafts(emptyLibrary(), drafts, TODAY);
    expect(library.books[0].finished).toBeNull();
    expect(finishedIn(library, 2026)).toBe(0);
    expect(library.books[0].commentary).toBe("Good\nreally good");
  });

  it("imports thousands quickly and counts duplicates inside one file once", () => {
    const rows = ["Book Id,Title,Author,ISBN13,Exclusive Shelf"];
    for (let i = 0; i < 3000; i += 1) rows.push(`${i},Book ${i},Author ${i % 50},,to-read`);
    rows.push("3001,Book 7,Author 7,,to-read");
    const started = performance.now();
    const result = importDrafts(emptyLibrary(), goodreadsDrafts(parseCsv(rows.join("\n"))), TODAY);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(result.added).toBe(3000);
    expect(result.skipped).toBe(1);
  });

  it("refuses a file that is not a Goodreads export", () => {
    expect(() => goodreadsDrafts(parseCsv("a,b\n1,2"))).toThrow(/Goodreads/);
    const wide = `Title,Exclusive Shelf,${Array.from({ length: 300 }, (_, i) => `c${i}`).join(",")}\nA,read`;
    expect(() => goodreadsDrafts(parseCsv(wide))).toThrow(/Goodreads/);
  });

  it("stops parsing once it has enough rows, skipping blank lines cheaply", () => {
    const started = performance.now();
    expect(parseCsv("a\n".repeat(2_500_000), 5)).toHaveLength(5);
    expect(parseCsv("\n".repeat(5_000_000), 5)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("refuses a field far longer than any real review", () => {
    expect(() => parseCsv(`Title\n"${"x".repeat(300_000)}"`)).toThrow(/Goodreads/);
  });

  it("strips review tags in linear time, even with no closing bracket", () => {
    const rows = [["Title", "Exclusive Shelf", "My Review"], ["A", "read", "<".repeat(200_000)]];
    const started = performance.now();
    goodreadsDrafts(rows);
    expect(performance.now() - started).toBeLessThan(300);
    expect(goodreadsDrafts([["Title", "Exclusive Shelf", "My Review"], ["A", "read", "<b>Bold</b> and <i>more</i>"]])[0].commentary)
      .toBe("Bold and more");
    expect(goodreadsDrafts([["Title", "Exclusive Shelf", "My Review"], ["A", "read", "Tom &amp; Jerry &quot;x&quot; &amp;lt;"]])[0]
      .commentary).toBe('Tom & Jerry "x" &lt;');
  });

  it("reads only the first 10,000 books, and treats an odd shelf name as want to read", () => {
    const rows = ["Title,Exclusive Shelf"];
    for (let i = 0; i < 10005; i += 1) rows.push(`Book ${i},${i === 0 ? "constructor" : "to-read"}`);
    const drafts = goodreadsDrafts(parseCsv(rows.join("\n")));
    expect(drafts).toHaveLength(GOODREADS_MAX_ROWS);
    expect(drafts[0].shelf).toBe("want");
  });
});
