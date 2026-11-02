// The reader as drawn: the heading is right before a page's words arrive, the pages either side are out of reach,
// nothing of the Quran is typed by hand, and the Al-Kahf tick waits for Al-Kahf's last page.
import { describe, expect, it } from "vitest";
import { emptyMarks, setPageNote } from "../src/quran/marks.ts";
import { mushafView, wordSheet, type ReaderModel, type ReaderPage } from "../src/ui/mushafView.ts";

const glyph = String.fromCodePoint(0xfb51);
const ready = (p: number): ReaderPage => ({ page: p, status: "ready", font: `qpc-p${p}`, data: { p, lines: [
  { n: 1, kind: "surah", sura: 18 }, { n: 2, kind: "bismillah" },
  { n: 3, kind: "words", words: [{ key: "18:1:1", glyph, text: "ٱلْحَمْدُ" }] }] } });
const waiting = (p: number, status: "loading" | "offline" | "failed"): ReaderPage => ({ page: p, status, data: null, font: null });

function model(over: Partial<ReaderModel> = {}): ReaderModel {
  return { current: 293, pages: [ready(292), ready(293), ready(294)], bismillah: { font: "qpc-p1", glyphs: glyph },
    marks: emptyMarks(), position: 290, revisedToday: false, kahfOpen: false, from: "quran", notice: "", spread: null,
    jumpFrom: null, guest: null, ...over };
}

/** The reader drawn with two pages open, 293 on the right and 294 on the left, and a spread ready either side. */
const spread = (over: Partial<ReaderModel> = {}): string =>
  mushafView(model({ spread: [293, 294], pages: [291, 292, 293, 294, 295, 296].map(ready), ...over }));

describe("the reader", () => {
  it("names the page's surah from the page map while the page is still opening", () => {
    const html = mushafView(model({ current: 400, pages: [waiting(399, "loading"), waiting(400, "loading"), waiting(401, "loading")] }));
    expect(html).toContain("Opening page 400");
    expect(html).not.toContain("Al-Faatiha");
  });

  it("offers Try again when a page is offline or failed", () => {
    const html = mushafView(model({ pages: [waiting(292, "offline"), waiting(293, "failed"), ready(294)] }));
    expect(html.match(/data-action="mushaf-retry"/g)).toHaveLength(2);
    expect(html).toContain("did not load");
  });

  it("keeps the pages either side out of reach, and the open one focusable", () => {
    const html = mushafView(model());
    expect(html).toMatch(/data-page="292"[^>]* inert/);
    expect(html).toMatch(/data-page="293"[^>]* tabindex="-1"/);
    expect(html).not.toMatch(/data-page="293"[^>]* inert/);
  });

  it("draws the bismillah only in the mushaf's script, keeping its line empty until then", () => {
    expect(mushafView(model())).toMatch(/class="line bism"[^>]*role="img"/);
    const without = mushafView(model({ bismillah: { font: null, glyphs: "" } }));
    expect(without).toContain(`<div class="line bism" data-line="2" aria-hidden="true"></div>`);
    expect(without).not.toContain("بسم");
  });

  it("offers the Al-Kahf tick on its last page only, and only while it is due", () => {
    expect(mushafView(model({ kahfOpen: true }))).not.toContain(`data-value="kahf"`);
    expect(mushafView(model({ kahfOpen: true, current: 304, pages: [ready(303), ready(304), ready(305)] })))
      .toContain(`data-value="kahf"`);
    expect(mushafView(model({ kahfOpen: false, current: 304 }))).not.toContain(`data-value="kahf"`);
  });

  it("closes back to where it was opened from, and says why something was not saved", () => {
    const html = mushafView(model({ from: "home", notice: "That could not be saved. Try again." }));
    expect(html).toContain(`data-go="home" aria-label="Close the mushaf"`);
    expect(html).toContain(`role="status">That could not be saved.`);
  });

  it("names the surah and page to a screen reader on the go-to button", () => {
    expect(mushafView(model())).toContain(`aria-label="Al-Israa, juz 15, page 293 of 604. Go to another page"`);
  });
});

describe("the reader with two pages open", () => {
  it("lays the odd page on the right with its pair, both in reach, the spreads either side out of reach", () => {
    const html = spread();
    expect(html).toContain(`class="pager spread"`);
    expect(html).toMatch(/class="page spread-start" data-page="293"[^>]* tabindex="-1"/);
    expect(html).toMatch(/class="page" data-page="294" aria-label="Page 294">/);
    expect(html).toMatch(/data-page="292"[^>]* inert/);
    expect(html).toMatch(/data-page="295"[^>]* inert/);
  });

  it("names both pages, and reads to the left-hand one", () => {
    const html = spread();
    expect(html).toContain("Juz 15 · pages 293 and 294 of 604");
    expect(html).toContain("Read to p. 294");
  });

  it("offers a note for each page, and shows each page's note with its number", () => {
    const html = spread({ marks: setPageNote(emptyMarks(), 294, "Slipped at the start", "2026-10-24") });
    expect(html).toContain(`data-action="mushaf-page-note" data-value="293" aria-label="A note on page 293"`);
    expect(html).toContain(`data-action="mushaf-page-note" data-value="294" aria-label="A note on page 294"`);
    expect(html).toContain(`<p class="page-note-line">p. 294: Slipped at the start</p>`);
  });

  it("names the spread's juz from its left-hand page (where a juz begins), whichever page it was opened at", () => {
    for (const current of [21, 22]) {
      const html = spread({ current, spread: [21, 22], pages: [19, 20, 21, 22, 23, 24].map(ready) });
      expect(html).toContain("Juz 2 · pages 21 and 22 of 604");
      expect(html).toContain("Juz 2 revised");
    }
  });

  it("offers the Al-Kahf tick when its last page is either page in view", () => {
    expect(spread({ kahfOpen: true, current: 303, spread: [303, 304], pages: [301, 302, 303, 304, 305, 306].map(ready) }))
      .toContain(`data-value="kahf"`);
  });
});

describe("the word sheet", () => {
  it("shows the ayah's words without its number, the tapped word marked, and a place for errors", () => {
    const html = wordSheet("18:1:2", [{ key: "18:1:1", glyph, text: "ٱلْحَمْدُ" }, { key: "18:1:2", glyph, text: "لِلَّهِ" },
      { key: "18:1:3", glyph, text: "١" }], emptyMarks());
    expect(html).toContain("ٱلْحَمْدُ <mark>لِلَّهِ</mark></p>");
    expect(html).toContain("data-sheet-error");
  });
});

describe("the pages as a book", () => {
  it("can be turned by a screen reader or a switch, which cannot drag a page", () => {
    const book = mushafView(model({ book: true }));
    expect(book).toContain(`class="pager book"`);
    expect(book).toContain(`data-action="book-next">Next page</button>`);
    expect(book).toContain(`data-action="book-back">Previous page</button>`);
  });

  it("keeps the sliding pages free of those buttons, which scroll by themselves", () => {
    const sliding = mushafView(model());
    expect(sliding).not.toContain("book-next");
    expect(sliding).not.toContain(" book");
  });
});

describe("the bars laid over the page", () => {
  it("are never hidden in the HTML (so showing or hiding them redraws nothing), and carry the notice", () => {
    expect(mushafView(model())).toContain(`<main class="reader theme-paper">`);
    const notice = mushafView(model({ notice: "Not saved." }));
    expect(notice).not.toContain("bars-hidden");
    expect(notice).toMatch(/<footer class="reader-bottom">.*Not saved\..*<\/footer>/s);
  });

  it("carry the page notes in the bottom bar, under no page", () => {
    const marks = setPageNote(emptyMarks(), 293, "Slow down on line 4", "2026-10-28");
    const html = mushafView(model({ marks }));
    expect(html).toMatch(/<footer class="reader-bottom"><p class="page-note-line">Slow down on line 4<\/p>/);
  });
});
