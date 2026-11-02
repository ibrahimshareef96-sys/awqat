// A Learn with a worldly track and a reading list, for the tests that need items, sessions and a study window. The
// app itself starts with three empty Islamic tracks (src/learn/seed.ts); these titles are only examples.
import { emptyLearn, type ItemKind, type Learn, type LearnItem, type LearnTrack } from "../../src/learn/learn.ts";
import { SEED_DATE } from "../../src/learn/seed.ts";

export const TRADING_ID = "track-trading";

const track = (id: string, name: string, kind: LearnTrack["kind"], weeklyMinutes: number): LearnTrack =>
  ({ id, name, kind, weeklyMinutes, archived: false, added: SEED_DATE });

const SHILLER_URL = "https://example.com/sample-markets";
const SHILLER_LECTURES = [2, 15, 7, 11, 8, 12, 4, 21];

const TRADING_ITEMS: readonly (readonly [string, string, ItemKind, string | null])[] = [
  ...SHILLER_LECTURES.map((n) => [`trading-shiller-${String(n).padStart(2, "0")}`,
    `Sara Example, Sample Markets: lecture ${n}`, "lecture", SHILLER_URL] as const),
  ["trading-housel", "Sara Example, Sample Money Lessons", "book", null],
  ["trading-carver", "Yusuf Example, Sample Trading", "book",
    "https://example.com/sample-trading"],
  ["trading-clenow", "Sara Example, Sample Trends, 2nd edition", "book",
    "https://example.com/sample-trends"],
  ["trading-aronson", "Yusuf Example, Sample Technical Analysis: the chapters on data-mining bias", "book", null],
  ["trading-quantopian", "Example lecture notebooks: p-hacking, overfitting and position sizing", "course",
    "https://example.com/sample-notebooks"],
  ["trading-lo-15401", "Sara Example, Sample Finance Theory I", "course", "https://example.com/sample-finance"],
  ["trading-chan", "Yusuf Example, Sample Quantitative Trading, 2nd edition", "book",
    "https://example.com/sample-quantitative-trading"],
  ["trading-mastering-bitcoin", "Sara Example and Yusuf Example, Sample Digital Currency, 3rd edition", "book",
    "https://example.com/sample-digital-currency"],
  ["trading-princeton-bitcoin", "Sara Example, Sample Currency Technologies (Example Academy)", "course",
    "https://example.com/sample-currency-course"],
];

/** Four tracks, the worldly one with a target of four hours a week and seventeen items in order. */
export function sampleLearn(): Learn {
  const items: LearnItem[] = TRADING_ITEMS.map(([id, title, kind, url], i) => ({
    id, trackId: TRADING_ID, title, kind, url, status: "todo", order: i + 1, added: SEED_DATE, done: null,
  }));
  return {
    ...emptyLearn(),
    tracks: [track(TRADING_ID, "Trading", "worldly", 240), track("track-tafsir", "Tafsir", "islamic", 0),
      track("track-hadith", "Hadith", "islamic", 0), track("track-fiqh", "Fiqh", "islamic", 0)],
    items,
  };
}
