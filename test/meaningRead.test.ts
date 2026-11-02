// What comes from hisnmuslim.com and Quran.com, and the phone's own copy of it, read defensively: wrong types, huge
// strings, missing or doubled ids, a byte order mark, another dhikr's words, all come to nothing rather than a crash.
// The Arabic, transliterations and English here are made up for the tests.
import { describe, expect, it } from "vitest";
import {
  ARABIC_MAX, CHAPTER_CHARS_MAX, TEXT_MAX, keptText, readHisnChapter, readKept, readQuranRange,
} from "../src/faith/meaningRead.ts";

const BOM = String.fromCodePoint(0xfeff);
const OURS = "ذَهَبَ الْوَلَدُ إِلَى الْمَدْرَسَةِ ثُمَّ رَجَعَ إِلَى الْبَيْتِ";
const OTHER = "جَلَسَتِ الْبِنْتُ فِي الْحَدِيقَةِ تَقْرَأُ كِتَاباً جَدِيداً";

function item(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ID: id, ARABIC_TEXT: `((${OURS})) (مرة)`, LANGUAGE_ARABIC_TRANSLATED_TEXT: `(Dhahaba AAl-walad ${id}.)`,
    TRANSLATED_TEXT: `(The boy went, ${id}.)`, REPEAT: 1, AUDIO: "http://www.example.com/a.mp3", ...over };
}

const chapter = (...items: unknown[]): Record<string, unknown> => ({ "A made-up chapter": items });
const wanted = new Map([[40, [OURS]], [41, [OURS]]]);

describe("a hisnmuslim.com chapter", () => {
  it("keeps the items asked for, with their transliteration and English", () => {
    const read = readHisnChapter(chapter(item(40), item(41), item(42)), wanted);
    expect(read?.get(40)).toEqual({ transliteration: "(Dhahaba AAl-walad 40.)", translation: "(The boy went, 40.)" });
    expect(read?.has(42)).toBe(false);
    expect(read?.size).toBe(2);
  });

  it("drops invisible marks that could reorder the text on screen", () => {
    const rlo = String.fromCodePoint(0x202e);
    const read = readHisnChapter(chapter(item(40, { TRANSLATED_TEXT: `The boy${rlo} went.` })), wanted);
    expect(read?.get(40)?.translation).toBe("The boy went.");
    expect(readHisnChapter(chapter(item(40, { TRANSLATED_TEXT: `${rlo}${BOM}` })), wanted)?.has(40) ?? false).toBe(false);
  });

  it("holds an answer the phone parsed itself to the same size as text", () => {
    const big = chapter(item(40), { ID: 99, padding: "x".repeat(CHAPTER_CHARS_MAX) });
    expect(readHisnChapter(big, wanted)).toBeNull();
    const looped: Record<string, unknown> = { items: [item(40)] };
    looped.self = looped;
    expect(readHisnChapter(looped, wanted)).toBeNull();
  });

  it("reads the file as text too, with or without a byte order mark", () => {
    const text = JSON.stringify(chapter(item(40)));
    expect(readHisnChapter(`${BOM}${text}`, wanted)?.has(40)).toBe(true);
    expect(readHisnChapter(text, wanted)?.has(40)).toBe(true);
    expect(readHisnChapter(`${BOM}{oops`, wanted)).toBeNull();
  });

  it("refuses what is not a chapter", () => {
    for (const raw of [null, 7, "", [], { a: 1 }, { a: "x" }, { a: [1, 2] }, chapter()]) {
      const read = readHisnChapter(raw, wanted);
      expect(read === null || read.size === 0).toBe(true);
    }
  });

  it("refuses a file far bigger than a chapter before reading it", () => {
    const huge = JSON.stringify(chapter(item(40))) + " ".repeat(CHAPTER_CHARS_MAX);
    expect(readHisnChapter(huge, wanted)).toBeNull();
  });

  it("leaves out an item whose fields are the wrong type, empty or huge", () => {
    const read = readHisnChapter(chapter(
      item(40, { TRANSLATED_TEXT: 12 }),
      item(41, { LANGUAGE_ARABIC_TRANSLATED_TEXT: "x".repeat(TEXT_MAX + 1) }),
    ), wanted);
    expect(read?.size ?? 0).toBe(0);
    expect(readHisnChapter(chapter(item(40, { TRANSLATED_TEXT: "   " })), wanted)?.has(40) ?? false).toBe(false);
    expect(readHisnChapter(chapter(item(40, { ARABIC_TEXT: "ذ".repeat(ARABIC_MAX + 1) })), wanted)?.has(40) ?? false).toBe(false);
    expect(readHisnChapter(chapter(item(40, { ID: "40" })), wanted)?.has(40) ?? false).toBe(false);
  });

  it("leaves out an id that is there twice", () => {
    expect(readHisnChapter(chapter(item(40), item(40)), wanted)?.has(40) ?? false).toBe(false);
  });

  it("leaves out an item whose Arabic is another dhikr's (the site renumbered)", () => {
    const read = readHisnChapter(chapter(item(40, { ARABIC_TEXT: OTHER }), item(41)), wanted);
    expect(read?.has(40)).toBe(false);
    expect(read?.has(41)).toBe(true);
  });

  it("checks an item used twice against both of our texts", () => {
    const two = new Map([[40, [OURS, OTHER]]]);
    expect(readHisnChapter(chapter(item(40)), two)?.has(40) ?? false).toBe(false);
  });

  it("caps how many items it looks at", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ ID: 1000 + i }));
    expect(readHisnChapter(chapter(...many, item(40)), wanted)).toBeNull();
    const titles = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`t${i}`, [item(40)]]));
    expect(readHisnChapter(titles, wanted)).toBeNull();
  });
});

function verse(key: string, words: unknown[], text: unknown = "A made-up sentence.", resource = 20): Record<string, unknown> {
  return { verse_key: key, words, translations: [{ resource_id: resource, text }] };
}
const word = (position: number, text: unknown, type = "word") =>
  ({ position, char_type_name: type, transliteration: { text, language_name: "english" } });
const range = { sura: 120, from: 1, to: 2 };

describe("a range of ayat from Quran.com", () => {
  it("keeps each ayah's words' transliterations by position, and the chosen translation", () => {
    const read = readQuranRange({ verses: [
      verse("120:1", [word(1, "kalimatun"), word(2, "ukhra"), word(3, null, "end")]),
      verse("120:2", [word(1, "thalithatun")], "Another made-up sentence.<sup foot_note=9>1</sup>"),
    ] }, range, 20);
    expect(read).toEqual([
      { words: [[1, "kalimatun"], [2, "ukhra"]], translation: "A made-up sentence." },
      { words: [[1, "thalithatun"]], translation: "Another made-up sentence." },
    ]);
  });

  it("reads it as text too", () => {
    const text = JSON.stringify({ verses: [verse("120:1", [word(1, "a")]), verse("120:2", [word(1, "b")])] });
    expect(readQuranRange(`${BOM}${text}`, range, 20)).toHaveLength(2);
  });

  it("refuses ayat that are not the ones asked for, missing or extra", () => {
    const one = verse("120:1", [word(1, "a")]);
    expect(readQuranRange({ verses: [one] }, range, 20)).toBeNull();
    expect(readQuranRange({ verses: [one, verse("120:3", [word(1, "b")])] }, range, 20)).toBeNull();
    expect(readQuranRange({ verses: [one, verse("120:2", [word(1, "b")]), verse("120:3", [word(1, "c")])] }, range, 20)).toBeNull();
    expect(readQuranRange({ verses: "no" }, range, 20)).toBeNull();
    expect(readQuranRange(null, range, 20)).toBeNull();
  });

  it("refuses another translation, or none", () => {
    const pair = (resource: number) => ({ verses: [verse("120:1", [word(1, "a")], "x", resource), verse("120:2", [word(1, "b")], "y", resource)] });
    expect(readQuranRange(pair(85), range, 20)).toBeNull();
    expect(readQuranRange({ verses: [verse("120:1", [word(1, "a")], 5), verse("120:2", [word(1, "b")])] }, range, 20)).toBeNull();
  });

  it("refuses a word that is not text, an empty ayah, or one far too long", () => {
    const one = { sura: 120, from: 1, to: 1 };
    expect(readQuranRange({ verses: [verse("120:1", [word(1, 42)])] }, one, 20)).toBeNull();
    expect(readQuranRange({ verses: [verse("120:1", [word(1, null, "end")])] }, one, 20)).toBeNull();
    expect(readQuranRange({ verses: [verse("120:1", [word(1, "x".repeat(200))])] }, one, 20)).toBeNull();
    expect(readQuranRange({ verses: [verse("120:1", [word(1, "a")], "y".repeat(TEXT_MAX + 1))] }, one, 20)).toBeNull();
    expect(readQuranRange({ verses: [verse("120:1", [word(0, "a")])] }, one, 20)).toBeNull();
  });
});

describe("the phone's own copy", () => {
  const good = {
    v: 1,
    hisn: { 27: { fetched: 1000, stamp: "s1", items: { 40: { transliteration: "Dhahaba", translation: "He went" } } } },
    quran: { "120:1-1": { fetched: 2000, verses: [{ words: [[1, "kalimatun"]], translation: "A made-up sentence." }] } },
  };

  it("reads back what was kept, the same as it was written", () => {
    const kept = readKept(JSON.stringify(good));
    expect(kept.hisn.get(27)?.items.get(40)?.translation).toBe("He went");
    expect(kept.hisn.get(27)?.fetched).toBe(1000);
    expect(kept.hisn.get(27)?.stamp).toBe("s1");
    expect(kept.quran.get("120:1-1")?.verses[0].words).toEqual([[1, "kalimatun"]]);
    expect(JSON.parse(keptText(kept))).toEqual(good);
  });

  it("leaves out a chapter with no stamp of what it was checked against", () => {
    const { stamp: _stamp, ...unstamped } = good.hisn[27];
    expect(readKept(JSON.stringify({ ...good, hisn: { 27: unstamped } })).hisn.size).toBe(0);
  });

  it("starts afresh from a copy that is missing, damaged or another version", () => {
    for (const text of [null, "", "{oops", "[]", JSON.stringify({ ...good, v: 2 }), "x".repeat(CHAPTER_CHARS_MAX + 1)]) {
      const kept = readKept(text);
      expect(kept.hisn.size + kept.quran.size).toBe(0);
    }
  });

  it("leaves out what does not hold up, keeping the rest", () => {
    const kept = readKept(JSON.stringify({
      v: 1,
      hisn: {
        27: { fetched: 1000, stamp: "s1", items: { 40: { transliteration: "<b>ok</b>", translation: "fine" }, 41: { transliteration: 5 }, x: {} } },
        nope: { fetched: 1, items: {} },
        25: { fetched: "soon", items: {} },
      },
      quran: { "120:1-1": { fetched: 2000, verses: [{ words: [[1, 5]], translation: "x" }] }, "bad key": good.quran["120:1-1"] },
    }));
    expect([...(kept.hisn.get(27)?.items.keys() ?? [])]).toEqual([40]);
    expect(kept.hisn.get(27)?.items.get(40)?.transliteration).toBe("<b>ok</b>");
    expect(kept.hisn.has(25)).toBe(false);
    expect(kept.quran.size).toBe(0);
  });
});
