// @vitest-environment happy-dom
// Recitation on screen: the recite-to-find sheet in each of its phases, the memorise bar and its summary, and the
// painting of a memorised page. Words in the tests are made up; nothing the model writes is ever shown.
import { describe, expect, it } from "vitest";
import { hearChunk, peek, startMemorise } from "../src/recite/align.ts";
import { closedFind, type FindFlow, type MemoriseSession } from "../src/recite/session.ts";
import { pageOfAyah } from "../src/quran/pages.ts";
import { memoriseBar, memoriseDoneSheet, paintLit, paintMemorise, placeName, reciteSheet } from "../src/ui/reciteView.ts";

const flow = (change: Partial<FindFlow>): FindFlow => ({ ...closedFind(), ...change });
const WORDS = ["ذهب", "الرجل", "الى", "السوق"].map((text, i) => ({ key: `18:10:${i + 1}`, text }));
const session = (change: Partial<MemoriseSession> = {}): MemoriseSession =>
  ({ page: 294, m: startMemorise(WORDS), phase: "listening", working: 0, problem: null, ...change });

describe("the recite-to-find sheet", () => {
  it("offers the one-time download, saying how big it is and that nothing is sent", () => {
    const html = reciteSheet(flow({ phase: "intro" }));
    expect(html).toContain('data-action="recite-download"');
    expect(html).toMatch(/about \d+ MB/);
    expect(html).toContain("never sent anywhere");
    expect(html).toContain("RECITE TO FIND");
  });

  it("says Memorise when it was opened to memorise", () => {
    expect(reciteSheet(flow({ phase: "intro", then: "memorise" }))).toContain("MEMORISE");
  });

  it("shows how far the download is", () => {
    const html = reciteSheet(flow({ phase: "downloading", progress: 0.42 }));
    expect(html).toContain("42% of");
    expect(html).toContain('data-w="42"');
  });

  it("listens with a meter and a Stop button", () => {
    const html = reciteSheet(flow({ phase: "listening" }));
    expect(html).toContain("recite-meter");
    expect(html).toContain('data-action="recite-stop"');
  });

  it("names the ayah found, its page, and opens it", () => {
    const best = { sura: 18, aya: 10, lastAya: 10, score: 0.97 };
    const html = reciteSheet(flow({ phase: "result", result: { kind: "found", best, same: [] } }));
    expect(html).toContain("Al-Kahf 10");
    expect(html).toContain(`Open page ${pageOfAyah(18, 10)}`);
    expect(html).toContain('data-action="recite-open" data-value="18:10"');
  });

  it("lists the other places the same words stand", () => {
    const best = { sura: 55, aya: 13, lastAya: 13, score: 1 };
    const same = [{ sura: 55, aya: 16, lastAya: 16, score: 1 }];
    const html = reciteSheet(flow({ phase: "result", result: { kind: "found", best, same } }));
    expect(html).toContain("also stand at");
    expect(html).toContain('data-value="55:16"');
  });

  it("offers the close matches when unsure", () => {
    const matches = [{ sura: 1, aya: 2, lastAya: 2, score: 0.7 }, { sura: 2, aya: 3, lastAya: 3, score: 0.68 }];
    const html = reciteSheet(flow({ phase: "result", result: { kind: "unsure", matches } }));
    expect(html.match(/data-action="recite-open"/g)?.length).toBe(2);
  });

  it("asks for more words, or says it could not place them", () => {
    expect(reciteSheet(flow({ phase: "result", result: { kind: "short" } }))).toContain("A few more words");
    expect(reciteSheet(flow({ phase: "result", result: { kind: "none" } }))).toContain("could not be placed");
  });

  it("says what is wrong, and offers what helps", () => {
    expect(reciteSheet(flow({ phase: "problem", problem: "mic" }))).toContain("microphone is off");
    expect(reciteSheet(flow({ phase: "problem", problem: "damaged" }))).toContain(">Download<");
    expect(reciteSheet(flow({ phase: "problem", problem: "offline" }))).toContain(">Try again<");
    expect(reciteSheet(flow({ phase: "problem", problem: "web" }))).not.toContain("recite-download");
  });

  it("names a recitation that ran over two ayahs", () => {
    expect(placeName({ sura: 18, aya: 10, lastAya: 11 })).toBe("Al-Kahf 10 to 11");
  });
});

describe("the memorise bar", () => {
  it("cannot peek or listen while the model gets ready", () => {
    const html = memoriseBar(session({ phase: "preparing" }));
    expect(html).toContain("Getting the speech model ready");
    expect(html).toMatch(/memorise-peek" disabled/);
    expect(html).toMatch(/memorise-toggle"[^>]*disabled/);
  });

  it("pauses while listening, and listens while paused", () => {
    expect(memoriseBar(session())).toContain('aria-label="Pause listening"');
    expect(memoriseBar(session({ phase: "paused" }))).toContain('aria-label="Listen"');
  });

  it("offers the way back when the page was turned", () => {
    expect(memoriseBar(session({ phase: "left" }))).toContain("Back to page 294");
  });

  it("says when every word is in", () => {
    const done = session({ m: hearChunk(startMemorise(WORDS), "ذهب الرجل الى السوق") });
    expect(memoriseBar(done)).toContain("Every word is in");
  });
});

describe("the memorise summary", () => {
  const at = new Map(WORDS.map((w, i) => [w.key, { line: 6, word: i + 1 }]));

  it("lists each slip with its line, and lets a mishearing be cleared", () => {
    const m = peek(hearChunk(startMemorise(WORDS), "ذهب الولد"));
    const html = memoriseDoneSheet(session({ m }), at);
    expect(html).toContain("Line 6, word 2");
    expect(html).toContain("heard as a different word");
    expect(html).toContain('data-action="memorise-clear" data-value="18:10:2"');
    expect(html).toContain("you peeked");
    expect(html).toContain("Keep these 2 for revision");
  });

  it("has nothing to keep when there were no slips", () => {
    const m = hearChunk(startMemorise(WORDS), "ذهب الرجل الى السوق");
    const html = memoriseDoneSheet(session({ m }), at);
    expect(html).toContain("4 words from memory, with no slips.");
    expect(html).not.toContain("memorise-keep");
  });
});

describe("painting a memorised page", () => {
  function page(): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = `<main class="reader"><section data-page="294">${WORDS.map((w) =>
      `<button class="w" data-word="${w.key}" aria-label="${w.text}">x</button>`).join("")}` +
      `<button class="w" data-word="18:10:5" aria-label="١٠">x</button></section></main>`;
    return root;
  }

  it("hides the words not yet said, labels included, and marks the slips", () => {
    const root = page();
    paintMemorise(root, session({ m: hearChunk(startMemorise(WORDS), "ذهب الولد") }));
    const words = [...root.querySelectorAll<HTMLElement>(".w")];
    expect(root.querySelector(".reader")?.classList.contains("memorising")).toBe(true);
    expect(words[0].className).toBe("w");
    expect(words[1].classList.contains("m-diff")).toBe(true);
    expect(words[2].classList.contains("m-hid")).toBe(true);
    expect(words[2].getAttribute("aria-label")).toBe("Hidden word");
    // The ayah's number is no word to recite: it stays as drawn.
    expect(words[4].className).toBe("w");
  });

  it("puts every word and label back when memorising ends", () => {
    const root = page();
    paintMemorise(root, session());
    paintMemorise(root, null);
    expect(root.querySelectorAll(".m-hid").length).toBe(0);
    expect(root.querySelector('[data-word="18:10:3"]')?.getAttribute("aria-label")).toBe("الى");
    expect(root.querySelector(".reader")?.classList.contains("memorising")).toBe(false);
  });

  it("lights an ayah found, and only a well-formed one", () => {
    const root = page();
    paintLit(root, "18:10");
    expect(root.querySelectorAll(".lit").length).toBe(5);
    paintLit(root, "18:10\"]");
    expect(root.querySelectorAll(".lit").length).toBe(0);
  });
});
