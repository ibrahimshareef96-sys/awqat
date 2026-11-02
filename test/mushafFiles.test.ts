// The mushaf on the phone: words kept at most 7 days (Quran Foundation's terms), fonts kept only when they are the
// exact King Fahd font, and anything damaged deleted so the next open fetches it again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  get: vi.fn(),
  writeFails: false,
  fontMatches: vi.fn(async (_page: number, _data: string) => true),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { get: fake.get },
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: async ({ path }: { path: string }) => {
      if (!fake.files.has(path)) throw new Error("missing");
      return { data: fake.files.get(path) };
    },
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      if (fake.writeFails) throw new Error("full");
      fake.files.set(path, data);
    },
    deleteFile: async ({ path }: { path: string }) => {
      if (!fake.files.delete(path)) throw new Error("missing");
    },
    stat: async ({ path }: { path: string }) => {
      if (!fake.files.has(path)) throw new Error("missing");
      return {};
    },
    readdir: async ({ path }: { path: string }) => {
      const names = [...fake.files.keys()].filter((k) => k.startsWith(`${path}/`)).map((k) => k.slice(path.length + 1));
      if (names.length === 0) throw new Error("missing");
      return { files: names.map((name) => ({ name })) };
    },
    rmdir: async ({ path }: { path: string }) => {
      const inside = [...fake.files.keys()].filter((k) => k.startsWith(`${path}/`));
      if (inside.length === 0) throw new Error("missing");
      inside.forEach((k) => fake.files.delete(k));
    },
  },
}));
vi.mock("../src/books/media.ts", () => ({ dataFileSrc: (path: string) => `https://localhost/_capacitor_file_/${path}`,
  mushafDirectory: () => "DATA", MUSHAF_FONTS_DIR: "mushaf-1421-fonts" }));
vi.mock("../src/quran/fontCheck.ts", () => ({ fontMatches: fake.fontMatches }));

type Files = typeof import("../src/quran/mushafFiles.ts");
const DAY = 86_400_000;
const START = new Date("2026-10-23T08:00:00Z").getTime();
let files: Files;

/** Page 293 as the API sends it: the end of Al-Isra, then Al-Kahf's name, bismillah and first ayat. */
function apiPage() {
  const verses: [string, number[]][] = [["17:111", [1, 1, 2, 3, 4, 5, 6, 7, 8, 9]], ["18:1", [12, 12, 13]], ["18:2", [13, 14, 15]]];
  return { verses: verses.map(([key, lines]) => ({ verse_key: key, words: lines.map((line, i) => ({
    location: `${key}:${i + 1}`, code_v2: String.fromCodePoint(0xfc41 + i), line_number: line, page_number: 293,
    text_uthmani: "كلمة" })) })) };
}

const ok = { status: 200, headers: {}, data: apiPage() };
const keptAt = (fetched: number, page: unknown = { p: 293, lines: [{ n: 1, w: [["17:111:1", "ﭑ", "كلمة"]] }] }) =>
  JSON.stringify({ fetched, page });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  fake.files.clear();
  fake.get.mockReset();
  fake.writeFails = false;
  fake.fontMatches.mockReset();
  fake.fontMatches.mockResolvedValue(true);
  vi.resetModules();
  files = await import("../src/quran/mushafFiles.ts");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a page's words", () => {
  it("are fetched once and kept on the phone with the time they came", async () => {
    fake.get.mockResolvedValue(ok);
    const result = await files.loadPage(293);
    expect("page" in result && result.page.lines).toHaveLength(15);
    expect(JSON.parse(fake.files.get("mushaf-1421-pages/p293.json") ?? "{}").fetched).toBe(START);
    expect(fake.get.mock.calls[0][0]).toMatchObject({ disableRedirects: true });
  });

  it("come from the phone within 7 days, and from Quran.com again after", async () => {
    fake.files.set("mushaf-1421-pages/p293.json", keptAt(START - 6 * DAY));
    expect("page" in (await files.loadPage(293))).toBe(true);
    expect(fake.get).not.toHaveBeenCalled();

    vi.resetModules();
    files = await import("../src/quran/mushafFiles.ts");
    fake.files.set("mushaf-1421-pages/p293.json", keptAt(START - 8 * DAY));
    fake.get.mockResolvedValue(ok);
    expect("page" in (await files.loadPage(293))).toBe(true);
    expect(fake.get).toHaveBeenCalledTimes(1);
  });

  it("run out in memory too: an open page past its 7 days is not drawn from memory", async () => {
    fake.get.mockResolvedValue(ok);
    await files.loadPage(293);
    expect(files.cachedPage(293)).not.toBeNull();
    expect(files.cachedPage(293, START + 7 * DAY)).toBeNull();
  });

  it("dated a little ahead (a clock set back) are kept; dated far ahead are not", async () => {
    fake.files.set("mushaf-1421-pages/p293.json", keptAt(START + DAY / 2));
    expect("page" in (await files.loadPage(293))).toBe(true);
    expect(fake.get).not.toHaveBeenCalled();

    vi.resetModules();
    files = await import("../src/quran/mushafFiles.ts");
    fake.files.set("mushaf-1421-pages/p293.json", keptAt(START + 3 * DAY));
    fake.get.mockResolvedValue(ok);
    await files.loadPage(293);
    expect(fake.get).toHaveBeenCalledTimes(1);
  });

  it("kept in a broken file are deleted and fetched again", async () => {
    fake.files.set("mushaf-1421-pages/p293.json", "{broken");
    fake.get.mockRejectedValue(new Error("offline"));
    expect(await files.loadPage(293)).toEqual({ offline: true });
    expect(fake.files.has("mushaf-1421-pages/p293.json")).toBe(false);
  });

  it("still show when the phone could not keep them", async () => {
    fake.writeFails = true;
    fake.get.mockResolvedValue(ok);
    expect("page" in (await files.loadPage(293))).toBe(true);
  });

  it("tell offline apart from a bad answer", async () => {
    fake.get.mockRejectedValueOnce(new Error("offline"));
    expect(await files.loadPage(293)).toEqual({ offline: true });
    fake.get.mockResolvedValueOnce({ status: 500, headers: {}, data: {} });
    expect(await files.loadPage(293)).toEqual({ failed: true });
    fake.get.mockResolvedValueOnce({ ...ok, headers: { "Content-Length": "9000000" } });
    expect(await files.loadPage(293)).toEqual({ failed: true });
    fake.get.mockResolvedValueOnce({ status: 200, headers: {}, data: { verses: [{ words: [{ location: "2:255:1" }] }] } });
    expect(await files.loadPage(293)).toEqual({ failed: true });
  });
});

describe("tidying kept pages", () => {
  it("keeps fresh pages and deletes old, broken and stray files", async () => {
    fake.files.set("mushaf-1421-pages/p1.json", keptAt(START - DAY));
    fake.files.set("mushaf-1421-pages/p2.json", keptAt(START - 9 * DAY));
    fake.files.set("mushaf-1421-pages/p3.json", "not json");
    fake.files.set("mushaf-1421-pages/p999.json", keptAt(START));
    fake.files.set("mushaf-1421-pages/notes.txt", "x");
    await files.pruneKeptPages(START);
    expect([...fake.files.keys()]).toEqual(["mushaf-1421-pages/p1.json"]);
  });

  it("deletes the 1405 print's pages and fonts kept up to 0.12, and keeps the 1421 print's", async () => {
    fake.files.set("mushaf-pages/p1.json", keptAt(START - DAY));
    fake.files.set("mushaf-fonts/p1.woff2", "d09GMg");
    fake.files.set("mushaf-1421-fonts/p1.woff2", "d09GMg");
    await files.pruneKeptPages(START);
    expect([...fake.files.keys()]).toEqual(["mushaf-1421-fonts/p1.woff2"]);
  });
});

describe("a page's font", () => {
  const woff2 = { status: 200, headers: {}, data: `d09GMg${"A".repeat(100)}` };

  it("is kept only when it is the exact font for that page", async () => {
    fake.get.mockResolvedValue(woff2);
    fake.fontMatches.mockResolvedValueOnce(false);
    expect(await files.downloadFont(5)).toBe("failed");
    expect(fake.files.has("mushaf-1421-fonts/p5.woff2")).toBe(false);
    expect(await files.downloadFont(5)).toBe("ok");
    expect(fake.files.has("mushaf-1421-fonts/p5.woff2")).toBe(true);
    expect(fake.fontMatches).toHaveBeenLastCalledWith(5, woff2.data);
  });

  it("is refused when it is not a WOFF2 file, and is not fetched again once kept", async () => {
    fake.get.mockResolvedValueOnce({ status: 200, headers: {}, data: "PGh0bWw+" });
    expect(await files.downloadFont(6)).toBe("failed");
    fake.files.set("mushaf-1421-fonts/p6.woff2", "d09GMg");
    expect(await files.downloadFont(6)).toBe("ok");
    expect(fake.get).toHaveBeenCalledTimes(1);
  });

  it("kept from before is checked before it draws, and replaced when it is not its page's", async () => {
    fake.files.set("mushaf-1421-fonts/p7.woff2", "d09GMgOLD");
    fake.fontMatches.mockImplementation(async (_page: number, data: string) => data !== "d09GMgOLD");
    fake.get.mockResolvedValue(woff2);
    vi.stubGlobal("FontFace", class { load() { return Promise.resolve(this); } });
    vi.stubGlobal("document", { fonts: { add: vi.fn() } });
    expect(await files.pageFont(7)).toEqual({ family: "qpc2-p7" });
    expect(fake.files.get("mushaf-1421-fonts/p7.woff2")).toBe(woff2.data);
  });

  it("that is intact but will not load this time is kept, so Try again works offline", async () => {
    fake.files.set("mushaf-1421-fonts/p8.woff2", "d09GMg");
    vi.stubGlobal("FontFace", class { load() { return Promise.reject(new Error("busy")); } });
    vi.stubGlobal("document", { fonts: { add: vi.fn() } });
    expect(await files.pageFont(8)).toEqual({ failed: true });
    expect(fake.files.has("mushaf-1421-fonts/p8.woff2")).toBe(true);
    expect(fake.get).not.toHaveBeenCalled();
  });

  it("is downloaded once when the reader and Ready-offline ask for it together", async () => {
    fake.get.mockResolvedValue(woff2);
    const [a, b] = await Promise.all([files.downloadFont(9), files.downloadFont(9)]);
    expect([a, b]).toEqual(["ok", "ok"]);
    expect(fake.get).toHaveBeenCalledTimes(1);
  });
});

describe("tidying on return to the app", () => {
  it("runs at most once an hour", async () => {
    fake.files.set("mushaf-1421-pages/p2.json", keptAt(START - 9 * DAY));
    await files.pruneKeptPages(START);
    fake.files.set("mushaf-1421-pages/p3.json", keptAt(START - 9 * DAY));
    await files.pruneKeptPages(START + 30 * 60_000);
    expect(fake.files.has("mushaf-1421-pages/p3.json")).toBe(true);
    await files.pruneKeptPages(START + 61 * 60_000);
    expect(fake.files.has("mushaf-1421-pages/p3.json")).toBe(false);
  });
});
