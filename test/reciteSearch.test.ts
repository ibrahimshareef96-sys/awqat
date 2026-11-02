// Recite to find, on a made-up text shaped like Tanzil's file: everyday Arabic sentences written for the tests, so no
// Quran text is ever typed here. Three "surahs" of 3, 4 and 2 lines.
import { describe, expect, it } from "vitest";
import { buildIndex, infixDistance, searchRecitation } from "../src/recite/search.ts";
import { parseTanzil, TANZIL_MAX } from "../src/recite/tanzil.ts";

const AYAS = [3, 4, 2];
const ROWS: [number, number, string][] = [
  [1, 1, "ذَهَبَ الرَّجُلُ إِلَى السُّوقِ فِي الصَّبَاحِ البَاكِرِ"],
  [1, 2, "وَاشْتَرَى خُبْزًا وَحَلِيبًا وَتَمْرًا لِأَهْلِهِ"],
  [1, 3, "ثُمَّ رَجَعَ إِلَى بَيْتِهِ مَسْرُورًا"],
  [2, 1, "الطَّالِبُ يَقْرَأُ الكِتَابَ فِي المَكْتَبَةِ"],
  [2, 2, "وَالمُعَلِّمُ يَكْتُبُ الدَّرْسَ عَلَى السَّبُّورَةِ"],
  [2, 3, "فِي الصَّبَاحِ البَاكِرِ"],
  [2, 4, "وَالطُّلَّابُ يَسْمَعُونَ بِانْتِبَاهٍ شَدِيدٍ"],
  [3, 1, "سَلَامٌ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ"],
  [3, 2, "سَلَامٌ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ"],
];
const HEADER = "#  A test text in the Tanzil Project's file shape\n#  License: none, written for the tests\n";
const file = (rows = ROWS, header = HEADER): string => rows.map(([s, a, t]) => `${s}|${a}|${t}`).join("\n") + "\n\n" + header;

describe("reading the Tanzil file", () => {
  it("reads every ayah in order, with the copyright block kept out of the verses", () => {
    const read = parseTanzil(file(), AYAS);
    expect("verses" in read && read.verses.length).toBe(9);
    expect("verses" in read && read.verses[3]).toEqual({ sura: 2, aya: 1, text: ROWS[3][2] });
  });

  it("refuses a file with no Tanzil block, or with a line that is not a row", () => {
    expect(parseTanzil(file(ROWS, "# something else\n"), AYAS)).toEqual({ error: "notTanzil" });
    expect(parseTanzil(file() + "<html>\n", AYAS)).toEqual({ error: "notTanzil" });
  });

  it("refuses a file missing an ayah, out of order, or cut short", () => {
    expect(parseTanzil(file(ROWS.filter((_, i) => i !== 4)), AYAS)).toEqual({ error: "incomplete" });
    expect(parseTanzil(file([ROWS[1], ROWS[0], ...ROWS.slice(2)]), AYAS)).toEqual({ error: "incomplete" });
    expect(parseTanzil(file(ROWS.slice(0, 8)), AYAS)).toEqual({ error: "incomplete" });
  });

  it("refuses something far too big to be the file", () => {
    expect(parseTanzil("#Tanzil\n" + "x".repeat(TANZIL_MAX), AYAS)).toEqual({ error: "tooBig" });
  });

  it("reads Windows line ends", () => {
    const read = parseTanzil(file().replace(/\n/g, "\r\n"), AYAS);
    expect("verses" in read && read.verses.length).toBe(9);
  });
});

describe("finding the ayah", () => {
  const read = parseTanzil(file(), AYAS);
  if (!("verses" in read)) throw new Error("test text did not read");
  const index = buildIndex(read.verses);

  it("finds an ayah from a few of its words, with no vowels", () => {
    const result = searchRecitation(index, "اشترى خبزا وحليبا");
    expect(result.kind).toBe("found");
    expect(result.kind === "found" && [result.best.sura, result.best.aya]).toEqual([1, 2]);
  });

  it("finds it through the slips a speech model makes: a wrong letter, a dropped ending", () => {
    const result = searchRecitation(index, "واشتري خبزن وحليب وتمر");
    expect(result.kind === "found" && [result.best.sura, result.best.aya]).toEqual([1, 2]);
  });

  it("follows a recitation that runs from one ayah into the next", () => {
    const result = searchRecitation(index, "وتمرا لاهله ثم رجع الي بيته");
    expect(result.kind === "found" && [result.best.sura, result.best.aya, result.best.lastAya]).toEqual([1, 2, 3]);
  });

  it("names every place the same words stand when an ayah is said twice", () => {
    const result = searchRecitation(index, "سلام عليكم ورحمة الله");
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect([result.best.sura, result.best.aya]).toEqual([3, 1]);
    expect(result.same.map((m) => [m.sura, m.aya])).toEqual([[3, 2]]);
  });

  it("is unsure when the words stand inside two different ayahs", () => {
    const result = searchRecitation(index, "في الصباح الباكر");
    expect(result.kind).toBe("unsure");
    expect(result.kind === "unsure" && result.matches.map((m) => `${m.sura}:${m.aya}`).sort()).toEqual(["1:1", "2:3"]);
  });

  it("asks for more when too little was heard", () => {
    expect(searchRecitation(index, "ذهب").kind).toBe("short");
    expect(searchRecitation(index, "").kind).toBe("short");
  });

  it("finds nothing for words that are not in the text", () => {
    expect(searchRecitation(index, "القطة نائمة تحت الشجرة الكبيرة جدا").kind).toBe("none");
  });
});

describe("infix distance", () => {
  it("lets the query sit anywhere inside the text", () => {
    expect(infixDistance("بيت", "ذهبالىبيتهمسرورا")).toBe(0);
    expect(infixDistance("بيط", "ذهبالىبيتهمسرورا")).toBe(1);
    expect(infixDistance("", "نص")).toBe(0);
    expect(infixDistance("نص", "")).toBe(2);
  });
});
