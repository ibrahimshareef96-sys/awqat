// The English and transliteration under each dhikr: fetched on the phone, kept there, refreshed at most once a week
// (Quran.com's no longer than a week), and nothing at all, rather than a crash, from a server that sends junk. The
// transliterations and English here are made up; the Arabic the matching is checked against is the app's own data.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpOptions, HttpResponse } from "@capacitor/core";
import { ADHKAR } from "../src/faith/adhkarData.ts";
import { DUAS } from "../src/faith/duaData.ts";
import { HISN_ADHKAR, HISN_DUAS } from "../src/faith/meaningIds.ts";
import {
  FETCH_DEADLINE_MS, HISN_CREDIT, QURAN_CREDIT, RETRY_MS, WEEK_MS, adhkarNeeds, dhikrMeaning, duaMeaning, duaNeeds,
  ensureMeanings, forgetMeanings, meaningIo, pruneMeanings, warmMeanings, writesDone, type Meaning,
} from "../src/faith/meaning.ts";

const AYN = String.fromCodePoint(0x2bf);
const T0 = Date.parse("2026-11-03T06:00:00+04:00");
const MINUTE = 60_000;
const DAY = 86_400_000;

const dhikr = (id: number) => ADHKAR.find((d) => d.id === id) as (typeof ADHKAR)[number];

/** A made-up chapter: each item's Arabic is our own words for it, so the check against our text passes. */
function hisnChapter(chapter: number): string {
  const byItem = new Map<number, string[]>();
  for (const [ours, [c, item]] of Object.entries(HISN_ADHKAR)) {
    if (c === chapter) byItem.set(item, [...(byItem.get(item) ?? []), dhikr(Number(ours)).text]);
  }
  for (const [ours, [c, item]] of Object.entries(HISN_DUAS)) {
    if (c === chapter) byItem.set(item, [...(byItem.get(item) ?? []), DUAS.find((d) => d.id === ours)?.text ?? ""]);
  }
  const items = [...byItem].map(([id, arabic]) => ({
    ID: id, ARABIC_TEXT: arabic.join(" ] [ "), REPEAT: 1, AUDIO: "",
    LANGUAGE_ARABIC_TRANSLATED_TEXT: id === 78 ? "(Made-up morning AAa.)[In the evening:] (Made-up evening AAa.)" : `(Made-up saying ${id}, AAa.)`,
    TRANSLATED_TEXT: id === 78 ? "(Morning meaning.)[In the evening:](Evening meaning.)" : `(Made-up meaning ${id}.)`,
  }));
  return `${String.fromCodePoint(0xfeff)}${JSON.stringify({ "A made-up chapter": items })}`;
}

/** Made-up ayat for any range asked for: word n of ayah a is "wa-n", and its English is "Line a.". */
function quranRange(url: URL): unknown {
  const [sura, from] = (url.searchParams.get("from") ?? "").split(":").map(Number);
  const to = Number((url.searchParams.get("to") ?? "").split(":")[1]);
  const verses = Array.from({ length: to - from + 1 }, (_, i) => ({
    verse_key: `${sura}:${from + i}`,
    words: [
      ...[1, 2, 3, 4, 5].map((n) => ({ position: n, char_type_name: "word", transliteration: { text: `w${from + i}-${n}` as string | null } })),
      { position: 6, char_type_name: "end", transliteration: { text: null } },
    ],
    translations: [{ resource_id: 20, text: `Line ${from + i}.<sup foot_note=1>1</sup>` }],
  }));
  return { verses, pagination: { next_page: null } };
}

let calls: HttpOptions[] = [];
let answer: (options: HttpOptions) => Promise<HttpResponse>;
let disk: string | null = null;
let writes: string[] = [];

const ok = (data: unknown): HttpResponse => ({ status: 200, data, headers: {}, url: "" });

function server(options: HttpOptions): Promise<HttpResponse> {
  const url = new URL(options.url);
  if (url.hostname === "www.hisnmuslim.com") return Promise.resolve(ok(hisnChapter(Number(url.pathname.match(/(\d+)\.json$/)?.[1]))));
  return Promise.resolve(ok(quranRange(url)));
}

beforeEach(() => {
  forgetMeanings();
  calls = [];
  disk = null;
  writes = [];
  answer = server;
  meaningIo.native = () => true;
  meaningIo.get = (options) => {
    calls.push(options);
    return answer(options);
  };
  meaningIo.read = async () => disk;
  meaningIo.write = async (text) => {
    writes.push(text);
    disk = text;
    return true;
  };
});

const text = (m: Meaning | null): Extract<Meaning, { kind: "text" }> => {
  if (m?.kind !== "text") throw new Error(`expected text, got ${JSON.stringify(m)}`);
  return m;
};

describe("before anything has come", () => {
  it("is on its way on the phone, unavailable in a browser, and nothing for a dhikr that has none", () => {
    expect(dhikrMeaning(dhikr(9), "morning", T0)).toEqual({ kind: "pending" });
    expect(dhikrMeaning(dhikr(2), "morning", T0)).toEqual({ kind: "pending" });
    expect(dhikrMeaning(dhikr(7), "morning", T0)).toBeNull();
    expect(duaMeaning("istikhara")).toBeNull();
    meaningIo.native = () => false;
    expect(dhikrMeaning(dhikr(9), "morning", T0)).toEqual({ kind: "offline" });
  });
});

describe("fetched", () => {
  it("shows the session's own part of an item that holds both, with the ayn written as a letter", async () => {
    expect(await ensureMeanings(adhkarNeeds("morning"), T0)).toBe(true);
    const morning = text(dhikrMeaning(dhikr(9), "morning", T0));
    expect(morning).toEqual({ kind: "text", transliteration: `Made-up morning ${AYN}a.`, translation: "Morning meaning.",
      credit: HISN_CREDIT, wholeAyah: false });
    expect(text(dhikrMeaning(dhikr(10), "evening", T0)).transliteration).toBe(`Made-up evening ${AYN}a.`);
    expect(text(dhikrMeaning(dhikr(11), "morning", T0)).translation).toBe("Made-up meaning 79.");
  });

  it("asks hisnmuslim.com and Quran.com over https only, never following a redirect", async () => {
    await ensureMeanings(adhkarNeeds("evening"), T0);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.url.startsWith("https://")).toBe(true);
      expect(call.disableRedirects).toBe(true);
      expect(["www.hisnmuslim.com", "api.quran.com"]).toContain(new URL(call.url).hostname);
    }
    expect(calls.filter((c) => c.url === "https://www.hisnmuslim.com/api/en/27.json")).toHaveLength(1);
    const kursi = calls.find((c) => c.url.includes("from=2:255"));
    expect(kursi?.url).toContain("translations=20");
    expect(kursi?.url).toContain("to=2:255");
    expect(calls.some((c) => c.url.includes("from=2:285") && c.url.includes("to=2:286"))).toBe(true);
  });

  it("gives a Quran item Quran.com's transliteration and English, numbered when there are several ayat", async () => {
    await ensureMeanings(adhkarNeeds("evening"), T0);
    const kursi = text(dhikrMeaning(dhikr(2), "evening", T0));
    expect(kursi.transliteration).toBe("w255-1 w255-2 w255-3 w255-4 w255-5");
    expect(kursi.translation).toBe("Line 255.");
    expect(kursi.credit).toBe(QURAN_CREDIT);
    const end = text(dhikrMeaning(dhikr(3), "evening", T0));
    expect(end.transliteration).toBe("w285-1 w285-2 w285-3 w285-4 w285-5 (285) w286-1 w286-2 w286-3 w286-4 w286-5 (286)");
    expect(end.translation).toBe("Line 285. (285) Line 286. (286)");
  });

  it("gives At-Tawbah 129 only its closing words to say, with the English of the whole ayah", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0);
    const hasbi = text(dhikrMeaning(dhikr(17), "morning", T0));
    expect(hasbi.transliteration).toBe("w129-4 w129-5");
    expect(hasbi.translation).toBe("Line 129.");
    expect(hasbi.wholeAyah).toBe(true);
  });

  it("gives the du'a after the salam theirs, and leaves a du'a without one alone", async () => {
    await ensureMeanings(duaNeeds(["istighfar", "tasbih", "istikhara"]), T0);
    expect(text(duaMeaning("istighfar")).translation).toBe("Made-up meaning 66.");
    expect(duaMeaning("istikhara")).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["https://www.hisnmuslim.com/api/en/25.json"]);
  });

  it("asks once for what two lists want at the same moment", async () => {
    await Promise.all([ensureMeanings(adhkarNeeds("morning"), T0), ensureMeanings(adhkarNeeds("morning"), T0)]);
    expect(calls.filter((c) => c.url.endsWith("/27.json"))).toHaveLength(1);
  });
});

describe("how long it is kept", () => {
  it("asks again for hisnmuslim.com's at most once a week, showing the copy it has meanwhile", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0);
    const first = calls.length;
    expect(await ensureMeanings(adhkarNeeds("morning"), T0 + 6 * DAY)).toBe(false);
    expect(calls).toHaveLength(first);
    answer = () => new Promise(() => undefined);
    void ensureMeanings(adhkarNeeds("morning"), T0 + 8 * DAY);
    await vi.waitFor(() => expect(calls.filter((c) => c.url.endsWith("/27.json"))).toHaveLength(2));
    expect(dhikrMeaning(dhikr(11), "morning", T0 + 8 * DAY)?.kind).toBe("text");
  });

  it("never shows Quran.com's past a week, and asks for it again", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0);
    expect(dhikrMeaning(dhikr(2), "morning", T0 + WEEK_MS - MINUTE)?.kind).toBe("text");
    expect(dhikrMeaning(dhikr(2), "morning", T0 + WEEK_MS + MINUTE)).toEqual({ kind: "pending" });
    await ensureMeanings(adhkarNeeds("morning"), T0 + WEEK_MS + MINUTE);
    expect(dhikrMeaning(dhikr(2), "morning", T0 + WEEK_MS + MINUTE)?.kind).toBe("text");
  });

  it("takes a copy dated in the future as old (a clock put right)", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0 + 30 * DAY);
    expect(dhikrMeaning(dhikr(2), "morning", T0)).toEqual({ kind: "pending" });
  });

  it("keeps a copy on the phone, and reads it back without asking again", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0);
    await writesDone();
    expect(writes.length).toBeGreaterThan(0);
    forgetMeanings();
    calls = [];
    await warmMeanings();
    expect(text(dhikrMeaning(dhikr(11), "morning", T0 + DAY)).translation).toBe("Made-up meaning 79.");
    expect(dhikrMeaning(dhikr(2), "morning", T0 + DAY)?.kind).toBe("text");
    expect(await ensureMeanings(adhkarNeeds("morning"), T0 + DAY)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("lets go of Quran.com's text on the phone once it is a week old, whatever screen is open", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0);
    await writesDone();
    forgetMeanings();
    expect(await pruneMeanings(T0 + WEEK_MS + DAY)).toBe(true);
    await writesDone();
    const kept = JSON.parse(disk ?? "{}") as { quran?: Record<string, unknown>; hisn?: Record<string, unknown> };
    expect(Object.keys(kept.quran ?? {})).toHaveLength(0);
    expect(Object.keys(kept.hisn ?? {})).toEqual(["27"]);
    expect(await pruneMeanings(T0 + WEEK_MS + DAY)).toBe(false);
  });

  it("never shows a copy checked against other words (another version's ids), and asks again", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0);
    await writesDone();
    const kept = JSON.parse(disk ?? "{}") as { hisn: Record<string, { stamp: string }> };
    kept.hisn["27"].stamp = "an-older-table";
    disk = JSON.stringify(kept);
    forgetMeanings();
    calls = [];
    await warmMeanings();
    expect(dhikrMeaning(dhikr(11), "morning", T0 + DAY)).toEqual({ kind: "pending" });
    await ensureMeanings(adhkarNeeds("morning"), T0 + DAY);
    expect(calls.map((c) => c.url)).toEqual(["https://www.hisnmuslim.com/api/en/27.json"]);
    expect(dhikrMeaning(dhikr(11), "morning", T0 + DAY)?.kind).toBe("text");
  });

  it("starts afresh from a damaged copy", async () => {
    disk = "{not json";
    await warmMeanings();
    expect(dhikrMeaning(dhikr(11), "morning", T0)).toEqual({ kind: "pending" });
  });
});

describe("when the server does not answer, or answers junk", () => {
  it("says it is unavailable, keeps any copy it has, and waits a while before asking again", async () => {
    answer = () => Promise.reject(new Error("offline"));
    await ensureMeanings(adhkarNeeds("morning"), T0);
    expect(dhikrMeaning(dhikr(11), "morning", T0)).toEqual({ kind: "offline" });
    expect(dhikrMeaning(dhikr(2), "morning", T0)).toEqual({ kind: "offline" });
    const asked = calls.length;
    await ensureMeanings(adhkarNeeds("morning"), T0 + RETRY_MS - MINUTE);
    expect(calls).toHaveLength(asked);
    // A list left open says so until a new try starts, never "on its way" with nothing asked.
    expect(dhikrMeaning(dhikr(2), "morning", T0 + RETRY_MS + MINUTE)).toEqual({ kind: "offline" });
    answer = server;
    await ensureMeanings(adhkarNeeds("morning"), T0 + RETRY_MS + MINUTE);
    expect(dhikrMeaning(dhikr(11), "morning", T0 + RETRY_MS + MINUTE)?.kind).toBe("text");
  });

  it("keeps the old copy when the weekly refresh fails", async () => {
    await ensureMeanings(adhkarNeeds("morning"), T0);
    answer = () => Promise.reject(new Error("offline"));
    await ensureMeanings(adhkarNeeds("morning"), T0 + 8 * DAY);
    expect(dhikrMeaning(dhikr(11), "morning", T0 + 8 * DAY)?.kind).toBe("text");
  });

  it("takes nothing from a refusal, a huge answer or junk", async () => {
    for (const reply of [
      { status: 403, data: "no", headers: {}, url: "" },
      { status: 200, data: "x", headers: { "Content-Length": "99000000" }, url: "" },
      ok("<html>not json</html>"), ok({ verses: 5 }), ok(null),
    ] as HttpResponse[]) {
      forgetMeanings();
      answer = () => Promise.resolve(reply);
      await ensureMeanings(adhkarNeeds("morning"), T0);
      expect(dhikrMeaning(dhikr(11), "morning", T0)).toEqual({ kind: "offline" });
      expect(dhikrMeaning(dhikr(2), "morning", T0)).toEqual({ kind: "offline" });
    }
  });

  it("gives up on a request that never ends, and says so", async () => {
    vi.useFakeTimers();
    try {
      answer = () => new Promise(() => undefined);
      const going = ensureMeanings(duaNeeds(["istighfar"]), T0);
      await vi.advanceTimersByTimeAsync(FETCH_DEADLINE_MS + 1);
      expect(await going).toBe(true);
      expect(duaMeaning("istighfar")).toEqual({ kind: "offline" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows what came first without waiting for the slowest", async () => {
    answer = (options) => (options.url.includes("hisnmuslim") ? server(options) : new Promise(() => undefined));
    const seen: (string | undefined)[] = [];
    void ensureMeanings(adhkarNeeds("morning"), T0, () => seen.push(dhikrMeaning(dhikr(11), "morning", T0)?.kind));
    await vi.waitFor(() => expect(seen).toEqual(["text"]));
    expect(dhikrMeaning(dhikr(2), "morning", T0)).toEqual({ kind: "pending" });
  });

  it("asks nothing in a browser", async () => {
    meaningIo.native = () => false;
    await ensureMeanings(adhkarNeeds("morning"), T0);
    expect(calls).toHaveLength(0);
  });

  it("survives the copy on the phone failing to save", async () => {
    meaningIo.write = vi.fn(async () => false);
    await ensureMeanings(adhkarNeeds("morning"), T0);
    await writesDone();
    expect(dhikrMeaning(dhikr(11), "morning", T0)?.kind).toBe("text");
  });
});

describe("the ids kept in the repository", () => {
  it("name only dhikr and du'as the app has, never a Quran item, and only numbers", () => {
    for (const [id, [chapter, item]] of Object.entries(HISN_ADHKAR)) {
      const found = ADHKAR.find((d) => d.id === Number(id));
      expect(found).toBeDefined();
      expect(found?.quran).toBeUndefined();
      expect([chapter, item].every(Number.isInteger)).toBe(true);
    }
    for (const [id, at] of Object.entries(HISN_DUAS)) {
      expect(DUAS.some((d) => d.id === id)).toBe(true);
      expect(at.every(Number.isInteger)).toBe(true);
    }
  });
});

describe("what each list needs", () => {
  it("the evening wants the end of Al-Baqarah, the morning does not", () => {
    const morning = adhkarNeeds("morning");
    const evening = adhkarNeeds("evening");
    expect(morning.chapters).toEqual([27]);
    expect(morning.ranges.some((r) => r.sura === 2 && r.from === 285)).toBe(false);
    expect(evening.ranges.some((r) => r.sura === 2 && r.from === 285 && r.to === 286)).toBe(true);
    expect(evening.ranges.some((r) => r.sura === 9 && r.from === 129)).toBe(true);
  });

  it("a mode wants chapter 25 only for the du'as that have a match", () => {
    expect(duaNeeds(["istighfar"]).chapters).toEqual([25]);
    expect(duaNeeds(["istikhara"]).chapters).toEqual([]);
    expect(duaNeeds([]).ranges).toEqual([]);
  });
});
