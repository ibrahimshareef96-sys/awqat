// Folding Arabic for matching. The sentences here are ordinary Arabic, written for the tests: no Quran text.
import { describe, expect, it } from "vitest";
import { editDistance, fold, foldCompact, foldWords, wordSimilarity } from "../src/recite/fold.ts";

describe("fold", () => {
  it("drops vowel marks, shadda, sukun and tanwin", () => {
    expect(fold("ذَهَبَ الوَلَدُ إِلَى المَدْرَسَةِ مُبَكِّرًا")).toBe("ذهب الولد الي المدرسه مبكرا");
  });

  it("makes every alef form a plain alef, and the wasla alef too", () => {
    expect(fold("أحمد إبراهيم آمن ٱلبيت")).toBe("احمد ابراهيم امن البيت");
  });

  it("folds ta marbuta, alef maqsura and the hamza seats", () => {
    expect(fold("مدرسة مستشفى مسئول مؤمن")).toBe("مدرسه مستشفي مسيول مومن");
  });

  it("drops the dagger alef and the small Quranic signs, keeping the letters around them", () => {
    expect(fold("هَٰذَا كِتَٰبٌ ۝ جَدِيدٌ ۛ")).toBe("هذا كتب جديد");
  });

  it("drops tatweel, digits, punctuation and Latin letters", () => {
    expect(fold("كتـــاب، (١٢) جديد! abc 34")).toBe("كتاب جديد");
  });

  it("gives an empty string for nothing Arabic", () => {
    expect(fold("  ... 12 abc ")).toBe("");
    expect(foldWords("  ")).toEqual([]);
  });

  it("splits into words and joins without spaces", () => {
    expect(foldWords("ذَهَبَ  الوَلَدُ")).toEqual(["ذهب", "الولد"]);
    expect(foldCompact("ذَهَبَ  الوَلَدُ")).toBe("ذهبالولد");
  });

  it("treats a decomposed letter the same as a composed one", () => {
    expect(fold("أحمد")).toBe(fold("أحمد"));
  });
});

describe("edit distance and word similarity", () => {
  it("counts single-letter edits", () => {
    expect(editDistance("كتاب", "كتاب")).toBe(0);
    expect(editDistance("كتاب", "كتب")).toBe(1);
    expect(editDistance("", "كتب")).toBe(3);
    expect(editDistance("مدرسه", "")).toBe(5);
  });

  it("scores words from 0 to 1", () => {
    expect(wordSimilarity("كتاب", "كتاب")).toBe(1);
    expect(wordSimilarity("العلمين", "العالمين")).toBeCloseTo(1 - 1 / 8);
    expect(wordSimilarity("بيت", "قلم")).toBe(0);
    expect(wordSimilarity("", "")).toBe(1);
  });
});
