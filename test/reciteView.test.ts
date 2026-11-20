// @vitest-environment happy-dom
// Recitation on screen: the recite-to-find sheet in each of its phases, the memorise bar and its summary, and the
// painting of a memorised page. Words in the tests are made up; nothing the model writes is ever shown.
import { describe, expect, it } from "vitest";
import { hearChunk, peek, startMemorise } from "../src/recite/align.ts";
import { closedFind, type FindFlow, type MemoriseSession } from "../src/recite/session.ts";
import { pageOfAyah } from "../src/quran/pages.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { memoriseBar, memoriseDoneSheet, paintLit, paintMemorise, paintMemoriseBar, paintMemoriseLevel, placeName,
  reciteSheet } from "../src/ui/reciteView.ts";
import type { ReciteProblem } from "../src/recite/session.ts";

const css = (file: string): string => readFileSync(resolve(process.cwd(), "src/ui", file), "utf8");
const flow = (change: Partial<FindFlow>): FindFlow => ({ ...closedFind(), ...change });
const WORDS = ["ذهب", "الرجل", "الى", "السوق"].map((text, i) => ({ key: `18:10:${i + 1}`, text }));
const session = (change: Partial<MemoriseSession> = {}): MemoriseSession =>
  ({ page: 294, pages: [294], m: startMemorise(WORDS), phase: "listening", working: 0, problem: null, attempt: 1, ...change });

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

  it("offers to recite again when the microphone failed or the app went away", () => {
    const audio = reciteSheet(flow({ phase: "problem", problem: "audio" }));
    expect(audio).toContain("could not be started");
    expect(audio).toContain('data-action="recite-again"');
    const away = reciteSheet(flow({ phase: "problem", problem: "away" }));
    expect(away).toContain("went to the background");
    expect(away).toContain('data-action="recite-again"');
  });

  it("offers to recite again when the speech model failed", () => {
    const html = reciteSheet(flow({ phase: "problem", problem: "model" }));
    expect(html).toContain("would not start");
    expect(html).toContain('data-action="recite-again"');
  });

  it("names this app, never another, when it went to the background or the microphone is off", () => {
    const away = reciteSheet(flow({ phase: "problem", problem: "away" }));
    expect(away).toContain("Listening stopped when Awqat went to the background.");
    expect(reciteSheet(flow({ phase: "problem", problem: "mic" }))).toContain("Apps, Awqat, Permissions");
    expect(reciteSheet(flow({ phase: "downloading", progress: 0 }))).toContain("Keep Awqat open");
    expect(away).not.toContain("Personal OS");
  });

  it("puts focus on the place found, so it is read out first", () => {
    const best = { sura: 18, aya: 10, lastAya: 10, score: 0.97 };
    const html = reciteSheet(flow({ phase: "result", result: { kind: "found", best, same: [] } }));
    expect(html).toMatch(/<p class="numeral" tabindex="-1" data-autofocus>Al-Kahf 10<\/p>/);
  });

  it("names a recitation that ran over two ayahs", () => {
    expect(placeName({ sura: 18, aya: 10, lastAya: 11 })).toBe("Al-Kahf 10 to 11");
  });
});

describe("the memorise bar", () => {
  it("cannot peek or listen while the model gets ready", () => {
    const html = memoriseBar(session({ phase: "preparing" }));
    expect(html).toContain("Getting the model ready");
    expect(html).toMatch(/memorise-peek" disabled/);
    expect(html).toMatch(/memorise-toggle"[^>]*disabled/);
  });

  it("keeps one name on the microphone, saying whether it listens by aria-pressed", () => {
    expect(memoriseBar(session())).toMatch(/aria-pressed="true" aria-label="Listen"/);
    expect(memoriseBar(session({ phase: "paused" }))).toMatch(/aria-pressed="false" aria-label="Listen"/);
  });

  it("offers the way back when the page was turned", () => {
    expect(memoriseBar(session({ phase: "left" }))).toContain("Back to page 294");
    expect(memoriseBar(session({ phase: "left" }))).toContain("You left page 294.");
    expect(memoriseBar(session({ phase: "left", pages: [293, 294] }))).toContain("Back to the pages");
  });

  it("says when every word is in", () => {
    const done = session({ m: hearChunk(startMemorise(WORDS), "ذهب الرجل الى السوق") });
    expect(memoriseBar(done)).toContain("Every word is in");
  });
});

const lineOf = (html: string): string => html.match(/data-memorise-line[^>]*>([^<]*)</)?.[1] ?? "";
const everyWordIn = hearChunk(startMemorise(WORDS), "ذهب الرجل الى السوق");

describe("the memorise bar's steady height", () => {
  const PROBLEMS: ReciteProblem[] = ["mic", "noMic", "audio", "away", "offline", "download", "damaged", "model", "web"];

  it("says each state in a few plain words, never more than two lines at 320 px", () => {
    const states = [session({ phase: "preparing" }), session(), session({ working: 1 }), session({ phase: "paused" }),
      session({ phase: "left" }), session({ phase: "left", pages: [293, 294] }), session({ m: everyWordIn }),
      ...PROBLEMS.map((problem) => session({ phase: "paused", problem }))];
    for (const s of states) {
      const line = lineOf(memoriseBar(s));
      expect(line.length).toBeGreaterThan(0);
      // 13px text is about 6.3px a letter, and the bar's line is at most 288px wide at 320px: two lines hold ~90.
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it("says the same things in fewer words", () => {
    expect(lineOf(memoriseBar(session({ phase: "preparing" })))).toBe("Getting the model ready…");
    expect(lineOf(memoriseBar(session()))).toBe("Listening. Start anywhere.");
    expect(lineOf(memoriseBar(session({ working: 2 })))).toBe("Filling in what you said…");
    expect(lineOf(memoriseBar(session({ phase: "paused", m: hearChunk(startMemorise(WORDS), "ذهب") })))).toBe("Paused. 1 of 4 words.");
    expect(lineOf(memoriseBar(session({ m: everyWordIn })))).toBe("Every word is in. Tap Done.");
    expect(lineOf(memoriseBar(session({ phase: "left", pages: [293, 294] })))).toBe("You left these pages.");
  });

  it("keeps one line element and one level meter, so the bar has the same parts in every listening state", () => {
    for (const s of [session(), session({ working: 1 }), session({ phase: "paused" }), session({ phase: "preparing" })]) {
      const html = memoriseBar(s);
      expect(html.match(/data-memorise-line/g)).toHaveLength(1);
      expect(html).toContain('data-memorise-bar="on"');
      expect(html.match(/class="memorise-level"/g)).toHaveLength(1);
    }
  });

  it("reserves the line's height in the style sheet, whatever it says", () => {
    const rule = css("mushaf.css").match(/\.memorise-line \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/\bheight: \d/);
    expect(rule).toContain("overflow: hidden");
    expect(rule).not.toMatch(/min-height|max-height/);
  });
});

describe("the memorise bar painted in place", () => {
  const bar = (s: MemoriseSession): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = `<main class="reader">${memoriseBar(s)}</main>`;
    return root;
  };

  it("changes the line's text and the buttons' state without replacing anything", () => {
    const root = bar(session());
    const line = root.querySelector("[data-memorise-line]");
    const peekButton = root.querySelector('[data-action="memorise-peek"]');
    paintMemoriseBar(root, session({ working: 1 }));
    expect(root.querySelector("[data-memorise-line]")).toBe(line);
    expect(line?.textContent).toBe("Filling in what you said…");
    paintMemoriseBar(root, session({ working: 0 }));
    expect(line?.textContent).toBe("Listening. Start anywhere.");
    paintMemoriseBar(root, session({ m: everyWordIn }));
    expect(line?.textContent).toBe("Every word is in. Tap Done.");
    expect(root.querySelector('[data-action="memorise-peek"]')).toBe(peekButton);
    expect((peekButton as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('[data-action="memorise-toggle"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows, but does not read out, the line that flips with every stretch heard; reads out the rest", () => {
    // While you recite, a screen reader stays quiet over your voice.
    const root = bar(session());
    const line = root.querySelector("[data-memorise-line]") as HTMLElement;
    expect(line.getAttribute("aria-live")).toBe("off");
    expect(line.hasAttribute("role")).toBe(false);
    paintMemoriseBar(root, session({ working: 1 }));
    expect(line.getAttribute("aria-live")).toBe("off");
    // The end of the page is said, and so are a pause, a problem and the model getting ready.
    paintMemoriseBar(root, session({ m: everyWordIn }));
    expect(line.getAttribute("role")).toBe("status");
    expect(line.hasAttribute("aria-live")).toBe(false);
    paintMemoriseBar(root, session({ working: 1 }));
    expect(line.getAttribute("aria-live")).toBe("off");
    expect(line.hasAttribute("role")).toBe(false);
    for (const spoken of [session({ phase: "paused" }), session({ phase: "preparing" }), session({ problem: "audio" }), session({ phase: "left" })]) {
      expect(memoriseBar(spoken)).toContain('role="status" data-memorise-line');
    }
    expect(memoriseBar(session())).toContain('aria-live="off" data-memorise-line');
  });

  it("leaves the line alone when it already says it", () => {
    const root = bar(session());
    const watch = new MutationObserver(() => undefined);
    watch.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
    paintMemoriseBar(root, session());
    expect(watch.takeRecords()).toHaveLength(0);
    watch.disconnect();
  });

  it("never paints the way-back bar, or a session that has ended", () => {
    const root = bar(session({ phase: "left" }));
    paintMemoriseBar(root, session({ working: 1 }));
    expect(lineOf(root.innerHTML)).toBe("You left page 294.");
    paintMemoriseBar(root, null);
    paintMemoriseBar(root, session({ phase: "left" }));
    expect(lineOf(root.innerHTML)).toBe("You left page 294.");
  });

  it("moves the level meter with a transform, within 0 and 1", () => {
    const root = bar(session());
    const fill = root.querySelector<HTMLElement>(".memorise-level span");
    paintMemoriseLevel(root, 0.05);
    expect(fill?.style.transform).toBe("scaleX(0.300)");
    paintMemoriseLevel(root, 0.9);
    expect(fill?.style.transform).toBe("scaleX(1.000)");
    paintMemoriseLevel(root, 0);
    expect(fill?.style.transform).toBe("scaleX(0.000)");
    expect(() => paintMemoriseLevel(document.createElement("div"), 0.3)).not.toThrow();
  });

  it("rests the meter once it is no longer listening", () => {
    const root = bar(session());
    paintMemoriseLevel(root, 0.1);
    paintMemoriseBar(root, session({ phase: "paused" }));
    expect(root.querySelector<HTMLElement>(".memorise-level span")?.style.transform).toBe("scaleX(0.000)");
  });
});

describe("the memorise styles", () => {
  it("fades a revealed word's ink in over 160 ms, colour only, and never animates a word being hidden", () => {
    const word = css("mushaf.css").match(/\n\.w \{[^}]*\}/)?.[0] ?? "";
    expect(word).toMatch(/transition: [^;]*background-color 300ms ease-out, color 160ms ease-out;/);
    expect(word).not.toMatch(/transition: [^;]*(width|height|transform|margin|padding|all)/);
    expect(css("mushaf.css")).toMatch(/\.reader\.memorising \.w\.m-hid \{[^}]*transition: none;/);
  });

  it("is covered by reduced motion: every transition is off, and the meter's own rule says so", () => {
    expect(css("app.css")).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, ::before, ::after \{ transition: none !important;/);
    expect(css("mushaf.css")).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.memorise-level span \{ transition: none; \}/);
    expect(css("mushaf.css")).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.page-lines, \.w \{ transition: none; \}/);
  });
});

describe("the memorise summary", () => {
  const at = new Map(WORDS.map((w, i) => [w.key, { page: 294, line: 6, word: i + 1 }]));

  it("waits for the last words still being heard before anything is kept", () => {
    const m = peek(hearChunk(startMemorise(WORDS), "ذهب الولد"));
    const html = memoriseDoneSheet(session({ m, working: 1 }), at);
    expect(html).toMatch(/data-action="memorise-keep" data-autofocus disabled/);
    expect(html).toContain("Still hearing your last words");
    expect(memoriseDoneSheet(session({ working: 1 }), at)).toContain("Still hearing your last words");
  });

  it("names the page of each slip when two pages were memorised", () => {
    const two = new Map(WORDS.map((w, i) => [w.key, { page: i < 2 ? 293 : 294, line: 1, word: i + 1 }]));
    const m = hearChunk(startMemorise(WORDS), "ذهب الرجل الولد");
    const html = memoriseDoneSheet(session({ m, pages: [293, 294] }), two);
    expect(html).toContain("Page 294, line 1, word 3");
    expect(html).toContain("PAGES 293 AND 294");
  });

  it("names both pages of a spread in its heading and label, and says when nothing was recited on them", () => {
    const two = new Map(WORDS.map((w, i) => [w.key, { page: i < 2 ? 293 : 294, line: 1, word: i + 1 }]));
    const html = memoriseDoneSheet(session({ pages: [293, 294] }), two);
    expect(html).toContain("PAGES 293 AND 294 · MEMORISE");
    expect(html).toContain('aria-label="Memorise, pages 293 and 294"');
    expect(html).toContain("Nothing was recited on these pages yet.");
  });

  it("names one page without a page on each line", () => {
    const m = hearChunk(startMemorise(WORDS), "ذهب الرجل الولد");
    const html = memoriseDoneSheet(session({ m }), at);
    expect(html).toContain("PAGE 294 · MEMORISE");
    expect(html).toContain("Line 6, word 3");
    expect(html).not.toContain("Page 294, line");
  });

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

  it("takes hidden words out of the tab order", () => {
    const root = page();
    paintMemorise(root, session());
    expect(root.querySelector('[data-word="18:10:1"]')?.getAttribute("tabindex")).toBe("-1");
  });

  it("puts every word, label and tab stop back when memorising ends", () => {
    const root = page();
    paintMemorise(root, session());
    paintMemorise(root, null);
    expect(root.querySelectorAll(".m-hid").length).toBe(0);
    expect(root.querySelector('[data-word="18:10:3"]')?.getAttribute("aria-label")).toBe("الى");
    expect(root.querySelector('[data-word="18:10:3"]')?.hasAttribute("tabindex")).toBe(false);
    expect(root.querySelector(".reader")?.classList.contains("memorising")).toBe(false);
  });

  it("hides the words on both pages of a spread", () => {
    const root = document.createElement("div");
    root.innerHTML = `<main class="reader"><section data-page="293">` +
      `<button class="w" data-word="${WORDS[0].key}" aria-label="a">x</button></section><section data-page="294">` +
      `<button class="w" data-word="${WORDS[3].key}" aria-label="b">x</button></section></main>`;
    paintMemorise(root, session({ pages: [293, 294] }));
    expect(root.querySelectorAll(".m-hid").length).toBe(2);
    paintMemorise(root, session({ pages: [294] }));
    expect(root.querySelectorAll(".m-hid").length).toBe(1);
  });

  it("hides only the pages memorised, and gives the others their labels back", () => {
    const root = document.createElement("div");
    root.innerHTML = `<main class="reader"><section data-page="293">` +
      `<button class="w" data-word="${WORDS[0].key}" aria-label="a">x</button>` +
      `<button class="w" data-word="${WORDS[1].key}" aria-label="b">x</button></section><section data-page="294">` +
      `<button class="w" data-word="${WORDS[2].key}" aria-label="c">x</button>` +
      `<button class="w" data-word="${WORDS[3].key}" aria-label="d">x</button></section></main>`;
    paintMemorise(root, session({ pages: [293, 294] }));
    expect(root.querySelectorAll(".m-hid").length).toBe(4);
    paintMemorise(root, session({ pages: [294] }));
    expect(root.querySelectorAll('[data-page="293"] .m-hid').length).toBe(0);
    expect(root.querySelectorAll('[data-page="294"] .m-hid').length).toBe(2);
    expect(root.querySelector('[data-word="18:10:1"]')?.getAttribute("aria-label")).toBe("a");
    expect(root.querySelector('[data-word="18:10:1"]')?.hasAttribute("tabindex")).toBe(false);
  });

  it("touches only the words whose mark changed since the last paint", () => {
    const root = page();
    const first = startMemorise(WORDS);
    paintMemorise(root, session({ m: first }));
    const watch = new MutationObserver(() => undefined);
    watch.observe(root, { attributes: true, childList: true, subtree: true });
    paintMemorise(root, session({ m: first }));
    expect(watch.takeRecords()).toHaveLength(0);
    paintMemorise(root, session({ m: hearChunk(first, "ذهب") }));
    const touched = new Set(watch.takeRecords().map((r) => (r.target as HTMLElement).dataset.word));
    expect([...touched]).toEqual(["18:10:1"]);
    const words = [...root.querySelectorAll<HTMLElement>(".w")];
    expect(words[0].className).toBe("w");
    expect(words[0].getAttribute("aria-label")).toBe("ذهب");
    expect(words[1].classList.contains("m-hid")).toBe(true);
    watch.disconnect();
  });

  it("paints everything again when the page was drawn anew", () => {
    const root = page();
    const m = hearChunk(startMemorise(WORDS), "ذهب الولد");
    paintMemorise(root, session({ m }));
    const html = root.innerHTML;
    root.innerHTML = html.replace(/ m-hid| m-diff|tabindex="-1"/g, "");
    expect(root.querySelectorAll(".m-hid, .m-diff").length).toBe(0);
    paintMemorise(root, session({ m }));
    const words = [...root.querySelectorAll<HTMLElement>(".w")];
    expect(words[1].classList.contains("m-diff")).toBe(true);
    expect(words[2].classList.contains("m-hid")).toBe(true);
    expect(words[2].getAttribute("aria-label")).toBe("Hidden word");
    expect(words[2].getAttribute("tabindex")).toBe("-1");
  });

  it("repaints a word whose mark was taken off from outside", () => {
    const root = page();
    paintMemorise(root, session());
    root.querySelector('[data-word="18:10:2"]')?.classList.remove("m-hid");
    paintMemorise(root, session());
    expect(root.querySelector('[data-word="18:10:2"]')?.classList.contains("m-hid")).toBe(true);
  });

  it("gives every word back, labels and tab stops too, when the page is turned away from", () => {
    const root = page();
    paintMemorise(root, session({ m: hearChunk(startMemorise(WORDS), "ذهب الولد") }));
    paintMemorise(root, session({ phase: "left" }));
    expect(root.querySelectorAll(".m-hid, .m-diff").length).toBe(0);
    expect(root.querySelector('[data-word="18:10:3"]')?.getAttribute("aria-label")).toBe("الى");
    expect(root.querySelector('[data-word="18:10:3"]')?.hasAttribute("tabindex")).toBe(false);
    paintMemorise(root, session());
    expect(root.querySelectorAll(".m-hid").length).toBe(4);
  });

  it("lights an ayah found, and only a well-formed one", () => {
    const root = page();
    paintLit(root, "18:10");
    expect(root.querySelectorAll(".lit").length).toBe(5);
    paintLit(root, "18:10\"]");
    expect(root.querySelectorAll(".lit").length).toBe(0);
  });
});
