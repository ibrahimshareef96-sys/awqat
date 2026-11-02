// Memorise: lining recited words up against a page. The "page" is everyday Arabic written for the tests, not Quran.
import { describe, expect, it } from "vitest";
import { clearSlip, hearChunk, peek, slips, startMemorise, summarise, type Memorise } from "../src/recite/align.ts";

const TEXT = "ذَهَبَ الرَّجُلُ إِلَى السُّوقِ فِي الصَّبَاحِ وَاشْتَرَى خُبْزًا وَحَلِيبًا ثُمَّ رَجَعَ إِلَى بَيْتِهِ مَسْرُورًا";
const words = TEXT.split(" ").map((text, i) => ({ key: `1:1:${i + 1}`, text }));
const page = (): Memorise => startMemorise(words);
const LETTER = { said: "s", different: "d", skipped: "k", peeked: "p" } as const;
const marks = (m: Memorise): string => m.marks.map((x) => (x === null ? "." : LETTER[x])).join("");

describe("memorise", () => {
  it("starts with every word hidden, and leaves out ayah numbers and marks with no letters", () => {
    const m = startMemorise([...words, { key: "1:1:15", text: "١٢" }]);
    expect(m.keys.length).toBe(14);
    expect(marks(m)).toBe(".".repeat(14));
    expect(m.next).toBe(0);
  });

  it("shows each word as it is said, and only those", () => {
    const m = hearChunk(page(), "ذهب الرجل الى السوق");
    expect(marks(m)).toBe("ssss" + ".".repeat(10));
    expect(m.next).toBe(4);
  });

  it("goes on from where the last stretch ended", () => {
    const m = hearChunk(hearChunk(page(), "ذهب الرجل الى السوق"), "في الصباح واشترى خبزا");
    expect(marks(m)).toBe("ssssssss" + ".".repeat(6));
  });

  it("takes a word heard through a phone's microphone, a letter off, as said", () => {
    const m = hearChunk(page(), "ذهب الرجول الي السوك");
    expect(marks(m)).toBe("ssss" + ".".repeat(10));
  });

  it("marks a different word in a word's place, and keeps what was heard", () => {
    const m = hearChunk(page(), "ذهب الولد الى السوق");
    expect(marks(m)).toBe("sdss" + ".".repeat(10));
    expect(m.heard[1]).toBe("الولد");
  });

  it("marks a word passed over as skipped", () => {
    const m = hearChunk(page(), "ذهب الرجل السوق في");
    expect(marks(m)).toBe("sskss" + ".".repeat(9));
  });

  it("does not mark words after the last one heard", () => {
    const m = hearChunk(page(), "ذهب الرجل");
    expect(m.marks.slice(2).every((x) => x === null)).toBe(true);
  });

  it("lets go of noise and talk that fits nowhere on the page", () => {
    const start = hearChunk(page(), "ذهب الرجل");
    expect(hearChunk(start, "القطة نائمة تحت الشجرة")).toEqual(start);
    expect(hearChunk(start, "")).toEqual(start);
  });

  it("picks up further on when the reciter starts mid-page, without calling the words before skipped", () => {
    const m = hearChunk(page(), "ثم رجع الى بيته مسرورا");
    expect(marks(m)).toBe(".".repeat(9) + "sssss");
  });

  it("keeps a word said when the reciter goes back over it", () => {
    const first = hearChunk(page(), "ذهب الرجل الى السوق في الصباح");
    const again = hearChunk(first, "الى السوق في الصباح واشترى");
    expect(marks(again)).toBe("sssssss" + ".".repeat(7));
  });

  it("peeks the next word, and counts it", () => {
    const m = peek(hearChunk(page(), "ذهب الرجل"));
    expect(marks(m)).toBe("ssp" + ".".repeat(11));
    expect(m.next).toBe(3);
    expect(summarise(m).peeked).toBe(1);
  });

  it("clears a slip the reciter says was misheard", () => {
    const m = clearSlip(hearChunk(page(), "ذهب الولد الى السوق"), "1:1:2");
    expect(marks(m)).toBe("ssss" + ".".repeat(10));
    expect(m.heard[1]).toBeNull();
    expect(clearSlip(m, "1:1:9")).toEqual(m);
  });

  it("sums up, and lists the slips and peeks as revision mistakes", () => {
    let m = hearChunk(page(), "ذهب الولد السوق في الصباح واشترى خبزا وحليبا ثم رجع");
    m = peek(m);
    m = hearChunk(m, "بيته مسرورا");
    const sum = summarise(m);
    // 14 words: الولد heard for the 2nd, the 3rd passed over, the 12th peeked, the rest said.
    expect(sum).toEqual({ said: 11, different: 1, skipped: 1, peeked: 1, hidden: 0, done: true });
    expect(slips(m)).toEqual(["1:1:2", "1:1:3", "1:1:12"]);
  });

  it("is done when nothing is hidden", () => {
    const m = hearChunk(page(), TEXT);
    expect(summarise(m).done).toBe(true);
    expect(hearChunk(m, "ذهب")).toEqual(m);
  });
});
