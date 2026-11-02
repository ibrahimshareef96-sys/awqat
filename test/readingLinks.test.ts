// Where the mushaf opens from Home and the Quran screen: both read on at the bookmark ("mushaf", never a page number,
// which would open it as revision), and show the bookmark's page.
import { describe, expect, it } from "vitest";
import { emptyQuranLog, setPosition } from "../src/quran/log.ts";
import { emptyMarks } from "../src/quran/marks.ts";
import { homeQuranCard } from "../src/ui/views.ts";
import { quranView } from "../src/ui/quranView.ts";

const DATE = "2026-10-28";
const AT = Date.UTC(2026, 9, 28, 18);

describe("Home's Quran card", () => {
  it("reads on at the bookmark, named by its surah", () => {
    const html = homeQuranCard({ quran: setPosition(emptyQuranLog(), 3), date: DATE, bookmark: 411, murajaah: null });
    expect(html).toContain(`data-go="mushaf"`);
    expect(html).not.toMatch(/data-go="mushaf:/);
    expect(html).toContain("Page 411 ");
    expect(html).toContain("Luqman · juz 21 · read on");
  });

  it("asks to open the mushaf before the user has started", () => {
    expect(homeQuranCard({ quran: emptyQuranLog(), date: DATE, bookmark: 1, murajaah: null })).toContain("Open the mushaf");
  });
});

describe("the Quran screen's Open the mushaf", () => {
  const view = (lastPageAt: number) => quranView({ quran: setPosition(emptyQuranLog(), 3), date: DATE, notice: "",
    undoArmed: false, marks: { ...emptyMarks(), lastPage: 411, lastPageAt }, download: null, plan: null }, "", "", "");

  it("reads on at the bookmark", () => {
    const html = view(AT);
    expect(html).toMatch(/data-go="mushaf">Open the mushaf <span class="soft">· p\. 411<\/span>/);
  });

  it("opens after the user's logged place while the bookmark was never set (marks from 0.12)", () => {
    expect(view(0)).toMatch(/Open the mushaf <span class="soft">· p\. 4<\/span>/);
  });

  it("credits the print, the words and the page map", () => {
    expect(view(AT)).toContain("1421 print (QPC V2), with fonts, words and page map from Quran Foundation (Quran.com)");
  });
});
