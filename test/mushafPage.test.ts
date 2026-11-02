// Mushaf page files: read defensively, since they come from an outside source at build time.
import { describe, expect, it } from "vitest";
import { ayahOfWord, pageFromApi, pageWordKeys, parseMushafPage } from "../src/quran/mushafPage.ts";

/** An API page: each [verse_key, [line, ...] per word], with ayah 1's first word starting a surah. */
function apiPage(page: number, verses: [string, number[]][]) {
  return { verses: verses.map(([key, lines]) => ({ verse_key: key, words: lines.map((line, i) => ({
    location: `${key}:${i + 1}`, code_v2: String.fromCodePoint(0xfc41 + i), line_number: line, page_number: page,
    text_uthmani: "كلمة", char_type_name: i === lines.length - 1 ? "end" : "word" })) })) };
}

describe("a page from the Quran.com API", () => {
  it("puts a surah's name and bismillah on the empty lines before its first ayah", () => {
    const json = apiPage(293, [["17:111", [1, 1, 2, 3, 4, 5, 6, 7, 8, 9]], ["18:1", [12, 12, 13]], ["18:2", [13, 14, 15]]]);
    const page = pageFromApi(json, 293);
    expect(page?.lines.map((l) => [l.n, l.kind])).toEqual([[1, "words"], [2, "words"], [3, "words"], [4, "words"],
      [5, "words"], [6, "words"], [7, "words"], [8, "words"], [9, "words"], [10, "surah"], [11, "bismillah"], [12, "words"],
      [13, "words"], [14, "words"], [15, "words"]]);
    expect(page?.lines[9]).toEqual({ n: 10, kind: "surah", sura: 18 });
  });

  it("has no bismillah line for At-Tawbah (page 187: its name on line 1, ayah 1 from line 2)", () => {
    const json = apiPage(187, [["9:1", [2, 3]], ["9:2", [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]]);
    const page = pageFromApi(json, 187);
    expect(page?.lines[0]).toEqual({ n: 1, kind: "surah", sura: 9 });
    expect(page?.lines.some((l) => l.kind === "bismillah")).toBe(false);
  });

  it("puts the next surah's name at the foot of a page when the next page starts it (page 50 starts Aal-Imran)", () => {
    const json = apiPage(49, [["2:286", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]]]);
    const page = pageFromApi(json, 49);
    expect(page?.lines.slice(-2)).toEqual([{ n: 14, kind: "surah", sura: 3 }, { n: 15, kind: "bismillah" }]);
    expect(pageFromApi(apiPage(120, [["5:71", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]]]), 120)).toBeNull();
  });

  it("splits a header across pages: An-Nisa's name ends page 76, its bismillah opens page 77", () => {
    const end = pageFromApi(apiPage(76, [["3:200", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]]]), 76);
    expect(end?.lines.at(-1)).toEqual({ n: 15, kind: "surah", sura: 4 });
    const start = pageFromApi(apiPage(77, [["4:1", [2, 3]], ["4:2", [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]]), 77);
    expect(start?.lines[0]).toEqual({ n: 1, kind: "bismillah" });
  });

  it("refuses glyphs outside the font's range, and ayat that cannot be on the page", () => {
    const latin = apiPage(293, [["17:111", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["18:1", [12, 13]], ["18:2", [14, 15]]]);
    latin.verses[0].words[0].code_v2 = "abc";
    expect(pageFromApi(latin, 293)).toBeNull();
    const elsewhere = apiPage(293, [["2:255", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["18:1", [12, 13]], ["18:2", [14, 15]]]);
    expect(pageFromApi(elsewhere, 293)).toBeNull();
    const withSpace = apiPage(443, [["36:52", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]]);
    withSpace.verses[0].words[0].code_v2 = `${String.fromCodePoint(0xfbed, 0xfbee)} ${String.fromCodePoint(0xfbef)}`;
    expect(pageFromApi(withSpace, 443)).not.toBeNull();
    // A page from the 1405 print's field (code_v1) has no 1421 glyphs: it is not drawn.
    const oldPrint = apiPage(443, [["36:52", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]]);
    const asOldPrint = { verses: oldPrint.verses.map((v) => ({ ...v,
      words: v.words.map(({ code_v2: glyph, ...w }) => ({ ...w, code_v1: glyph })) })) };
    expect(pageFromApi(asOldPrint, 443)).toBeNull();
  });

  it("refuses a page with too many words for a mushaf page", () => {
    const crowded = apiPage(293, [["17:111", Array.from({ length: 60 }, () => 1)]]);
    expect(pageFromApi(crowded, 293)).toBeNull();
  });

  it("refuses a page with a line it cannot explain, or words from another page", () => {
    expect(pageFromApi(apiPage(120, [["5:71", [1, 2, 4]]]), 120)).toBeNull();
    const stray = apiPage(120, [["5:71", [1, 2]]]);
    stray.verses[0].words[0].page_number = 121;
    expect(pageFromApi(stray, 120)).toBeNull();
    expect(pageFromApi({ verses: "no" }, 120)).toBeNull();
  });
});

const glyph = String.fromCodePoint(0xfb51);
const good = {
  p: 293,
  lines: [
    { n: 1, w: [["17:105:1", glyph, "وَبِٱلْحَقِّ"], ["17:105:2", glyph, "أَنزَلْنَٰهُ"]] },
    { n: 10, s: 18 },
    { n: 11, b: 1 },
    { n: 12, w: [["18:1:1", glyph, "ٱلْحَمْدُ"]] },
  ],
};

describe("reading a page file", () => {
  it("reads a well-formed page", () => {
    const page = parseMushafPage(good, 293);
    expect(page?.lines).toHaveLength(4);
    expect(page?.lines[0]).toEqual({ n: 1, kind: "words", words: [
      { key: "17:105:1", glyph, text: "وَبِٱلْحَقِّ" }, { key: "17:105:2", glyph, text: "أَنزَلْنَٰهُ" }] });
    expect(page?.lines[1]).toEqual({ n: 10, kind: "surah", sura: 18 });
    expect(page?.lines[2]).toEqual({ n: 11, kind: "bismillah" });
  });

  it("refuses a file for another page, bad keys, long glyphs or odd lines", () => {
    expect(parseMushafPage(good, 294)).toBeNull();
    expect(parseMushafPage({ ...good, lines: [{ n: 1, w: [["nope", glyph, "x"]] }] }, 293)).toBeNull();
    expect(parseMushafPage({ ...good, lines: [{ n: 1, w: [["18:1:1", "abcdefg", "x"]] }] }, 293)).toBeNull();
    expect(parseMushafPage({ ...good, lines: [{ n: 1, w: [["18:1:1", "abc", "x"]] }] }, 293)).toBeNull();
    expect(parseMushafPage({ ...good, lines: [{ n: 1, w: [["2:255:1", glyph, "x"]] }] }, 293)).toBeNull();
    expect(parseMushafPage({ ...good, lines: [{ n: 99, s: 18 }] }, 293)).toBeNull();
    expect(parseMushafPage({ ...good, lines: [{ n: 1, s: 115 }] }, 293)).toBeNull();
    expect(parseMushafPage(null, 293)).toBeNull();
    expect(parseMushafPage({ p: 293, lines: [] }, 293)).toBeNull();
  });

  it("lists the page's word keys and finds a word's ayah", () => {
    const page = parseMushafPage(good, 293);
    expect(page && pageWordKeys(page)).toEqual(["17:105:1", "17:105:2", "18:1:1"]);
    expect(ayahOfWord("18:10:3")).toBe("18:10");
  });
});
