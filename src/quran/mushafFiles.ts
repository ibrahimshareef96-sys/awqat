/**
 * The mushaf on the phone, the way Quran Foundation's developer terms allow (checked 23 Oct 2026, terms of 10 Aug 2026):
 * - each page's words come from Quran.com when the page is first opened, and are kept for at most 7 days;
 * - each page's King Fahd Complex font (1421 print, QPC V2, about 160 KB) is kept on the phone, credited to Quran
 *   Foundation, and never offered outside the app.
 * Nothing of the Quran is bundled in the app or typed by hand. Until 0.13 the app drew the 1405 print (QPC V1); its
 * files, kept in other folders, are deleted (removeOldPrint).
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { MUSHAF_FONTS_DIR, dataFileSrc, mushafDirectory } from "../books/media.ts";
import { PAGES } from "./data.ts";
import { fontMatches } from "./fontCheck.ts";
import { pageFromApi, parseMushafPage, type MushafPage } from "./mushafPage.ts";

/** Quran.com's mushaf 1 is the 1421 print (QPC V2), whose words carry code_v2. */
const PAGE_URL = (page: number): string => `https://api.quran.com/api/qdc/verses/by_page/${page}?words=true&per_page=all` +
  "&word_fields=location,code_v2,line_number,page_number,text_uthmani&fields=verse_key&mushaf=1&filter_page_words=true";
const FONT_URL = (page: number): string => `https://static.qurancdn.com/fonts/quran/hafs/v2/woff2/p${page}.woff2`;
const PAGES_DIR = "mushaf-1421-pages";
const FONTS_DIR = MUSHAF_FONTS_DIR;
/** Where the 1405 print's pages and fonts were kept, up to 0.12. */
const OLD_DIRS = ["mushaf-pages", "mushaf-fonts"] as const;
const PAGE_PATH = (page: number): string => `${PAGES_DIR}/p${page}.json`;
const FONT_PATH = (page: number): string => `${FONTS_DIR}/p${page}.woff2`;
/** Quran Foundation allows content from its API to be kept for a week. */
export const KEEP_MS = 7 * 86_400_000;
/** A WOFF2 file starts with the bytes "wOF2", which is "d09GMg" in base64. */
const WOFF2_BASE64_START = "d09GMg";
/** The largest page font is under 400 KB; anything past this is not one. */
const FONT_MAX_BASE64 = 1_000_000;

const pages = new Map<number, { page: MushafPage; fetched: number }>();
const families = new Map<number, string>();
const pendingFonts = new Map<number, Promise<FontResult>>();
const pendingPages = new Map<number, Promise<PageResult>>();
const pendingDownloads = new Map<number, Promise<Download>>();
/** Tidying reads every kept page over the bridge, so on return to the app it runs at most this often. */
const PRUNE_EVERY_MS = 3_600_000;
let lastPrune = -Infinity;

export type FontResult = { family: string } | { offline: true } | { failed: true };
export type PageResult = { page: MushafPage } | { offline: true } | { failed: true };

/** A clock corrected backwards by a little does not make a kept page look as if it came from the future. */
const CLOCK_SLACK_MS = 86_400_000;
/** A page response is a few tens of kilobytes; past this it is not one. */
const PAGE_RESPONSE_MAX = 2_000_000;

const isPage = (page: number): boolean => Number.isInteger(page) && page >= 1 && page <= PAGES;
const fresh = (fetched: number, now: number): boolean =>
  Number.isFinite(fetched) && now - fetched < KEEP_MS && fetched <= now + CLOCK_SLACK_MS;

async function remove(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: mushafDirectory() });
  } catch {
    // Already gone.
  }
}

/** The compact form a page is kept in on the phone (the same form parseMushafPage reads). */
function compact(page: MushafPage): unknown {
  return { p: page.p, lines: page.lines.map((l) => l.kind === "words" ? { n: l.n, w: l.words.map((w) => [w.key, w.glyph, w.text]) }
    : l.kind === "surah" ? { n: l.n, s: l.sura } : { n: l.n, b: 1 }) };
}

type Kept = { fetched: number; page: unknown } | "missing" | "broken";

async function readKeptFile(page: number): Promise<Kept> {
  let text: string;
  try {
    const file = await Filesystem.readFile({ path: PAGE_PATH(page), directory: mushafDirectory(), encoding: Encoding.UTF8 });
    text = String(file.data);
  } catch {
    return "missing";
  }
  try {
    const kept = JSON.parse(text) as { fetched?: unknown; page?: unknown };
    return { fetched: typeof kept.fetched === "number" ? kept.fetched : NaN, page: kept.page };
  } catch {
    return "broken";
  }
}

/** A kept page, if still within its 7 days and valid; anything else kept for it is deleted. */
async function readKept(page: number, now: number): Promise<MushafPage | null> {
  const kept = await readKeptFile(page);
  if (kept === "missing") return null;
  const parsed = kept === "broken" || !fresh(kept.fetched, now) ? null : parseMushafPage(kept.page, page);
  if (parsed && kept !== "broken") {
    pages.set(page, { page: parsed, fetched: kept.fetched });
    return parsed;
  }
  await remove(PAGE_PATH(page));
  return null;
}

async function fetchPage(page: number, now: number): Promise<PageResult> {
  let parsed: MushafPage | null;
  try {
    const response = await CapacitorHttp.get({ url: PAGE_URL(page), responseType: "json", connectTimeout: 10000,
      readTimeout: 20000, disableRedirects: true });
    const length = Number(response.headers?.["Content-Length"] ?? response.headers?.["content-length"] ?? 0);
    if (response.status !== 200 || length > PAGE_RESPONSE_MAX) return { failed: true };
    parsed = pageFromApi(response.data, page);
  } catch {
    return { offline: true };
  }
  if (!parsed) return { failed: true };
  pages.set(page, { page: parsed, fetched: now });
  try {
    await Filesystem.writeFile({ path: PAGE_PATH(page), directory: mushafDirectory(), encoding: Encoding.UTF8, recursive: true,
      data: JSON.stringify({ fetched: now, page: compact(parsed) }) });
  } catch {
    // Not kept on the phone this time; the page is still shown, and is fetched again next time.
  }
  return { page: parsed };
}

async function getPage(page: number): Promise<PageResult> {
  if (!isPage(page) || !Capacitor.isNativePlatform()) return { failed: true };
  const now = Date.now();
  const held = pages.get(page);
  if (held && fresh(held.fetched, now)) return { page: held.page };
  const kept = await readKept(page, now);
  return kept ? { page: kept } : fetchPage(page, now);
}

/** A page's lines: kept from the last 7 days, or fetched now. */
export function loadPage(page: number): Promise<PageResult> {
  const inFlight = pendingPages.get(page);
  if (inFlight) return inFlight;
  const loading = getPage(page).finally(() => pendingPages.delete(page));
  pendingPages.set(page, loading);
  return loading;
}

/** A page's lines if already loaded and still fresh, without waiting (the screen is drawn synchronously). */
export function cachedPage(page: number, now = Date.now()): MushafPage | null {
  const held = pages.get(page);
  return held && fresh(held.fetched, now) ? held.page : null;
}

async function haveFontFile(page: number): Promise<boolean> {
  try {
    await Filesystem.stat({ path: FONT_PATH(page), directory: mushafDirectory() });
    return true;
  } catch {
    return false;
  }
}

type Download = "ok" | "offline" | "failed";

/**
 * Downloads a page's font into the data folder, keeping it only if it is exactly that page's King Fahd font. One
 * download per page at a time: the reader and "Ready the whole mushaf" never write the same file twice at once.
 */
export function downloadFont(page: number): Promise<Download> {
  const inFlight = pendingDownloads.get(page);
  if (inFlight) return inFlight;
  const downloading = fetchFont(page).finally(() => pendingDownloads.delete(page));
  pendingDownloads.set(page, downloading);
  return downloading;
}

async function fetchFont(page: number): Promise<Download> {
  if (!isPage(page) || !Capacitor.isNativePlatform()) return "failed";
  if (await haveFontFile(page)) return "ok";
  let data: string;
  try {
    const response = await CapacitorHttp.get({ url: FONT_URL(page), responseType: "blob", connectTimeout: 10000,
      readTimeout: 20000, disableRedirects: true });
    if (response.status !== 200 || typeof response.data !== "string") return "failed";
    data = response.data.replace(/\s+/g, "");
  } catch {
    return "offline";
  }
  if (!data.startsWith(WOFF2_BASE64_START) || data.length > FONT_MAX_BASE64 || !(await fontMatches(page, data))) return "failed";
  try {
    await Filesystem.writeFile({ path: FONT_PATH(page), directory: mushafDirectory(), data, recursive: true });
    return "ok";
  } catch {
    await remove(FONT_PATH(page));
    return "failed";
  }
}

/** The kept font is still exactly its page's (one from an earlier version, or one damaged on disk, is not). */
async function keptFontIntact(page: number): Promise<boolean> {
  try {
    const file = await Filesystem.readFile({ path: FONT_PATH(page), directory: mushafDirectory() });
    return typeof file.data === "string" && (await fontMatches(page, file.data.replace(/\s+/g, "")));
  } catch {
    return false;
  }
}

async function loadFont(page: number): Promise<FontResult> {
  let got = await downloadFont(page);
  if (got === "ok" && !(await keptFontIntact(page))) {
    // Checked once a session, before it draws a word: a font that is not exactly its page's is replaced.
    await remove(FONT_PATH(page));
    got = await downloadFont(page);
  }
  if (got !== "ok") return got === "offline" ? { offline: true } : { failed: true };
  const src = dataFileSrc(FONT_PATH(page));
  if (!src) return { failed: true };
  try {
    const family = `qpc2-p${page}`;
    const face = new FontFace(family, `url("${src}") format("woff2")`, { display: "block" });
    document.fonts.add(await face.load());
    families.set(page, family);
    return { family };
  } catch {
    // The file is intact (checked above), so it stays: Try again loads it without the internet.
    return { failed: true };
  }
}

/** The font family that draws this page, loading it (once) if needed. */
export function pageFont(page: number): Promise<FontResult> {
  const known = families.get(page);
  if (known) return Promise.resolve({ family: known });
  const inFlight = pendingFonts.get(page);
  if (inFlight) return inFlight;
  const loading = loadFont(page).finally(() => pendingFonts.delete(page));
  pendingFonts.set(page, loading);
  return loading;
}

/** The family already loaded for a page, without waiting. */
export function loadedFont(page: number): string | null {
  return families.get(page) ?? null;
}

/** How many page fonts are already on the phone. */
export async function fontsOnPhone(): Promise<number> {
  try {
    const { files } = await Filesystem.readdir({ path: FONTS_DIR, directory: mushafDirectory() });
    return files.filter((f) => /^p\d{1,3}\.woff2$/.test(f.name)).length;
  } catch {
    return 0;
  }
}

/**
 * Deletes pages kept longer than 7 days, and anything else in the folder; run at start-up and on return to the app
 * (at most hourly). A page is also checked each time it is read, so none is ever shown past its 7 days.
 */
export async function pruneKeptPages(now = Date.now()): Promise<void> {
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  await removeOldPrint();
  let names: string[];
  try {
    names = (await Filesystem.readdir({ path: PAGES_DIR, directory: mushafDirectory() })).files.map((f) => f.name);
  } catch {
    return;
  }
  for (const name of names) {
    const match = /^p([1-9]\d{0,2})\.json$/.exec(name);
    const page = match ? Number(match[1]) : 0;
    const kept = isPage(page) ? await readKeptFile(page) : "broken";
    if (typeof kept === "object" && fresh(kept.fetched, now)) continue;
    await remove(`${PAGES_DIR}/${name}`);
    if (isPage(page)) pages.delete(page);
  }
}

let oldPrintRemoved = false;

/** The 1405 print's pages and fonts, kept up to 0.12, are deleted once a session (nothing draws them any more). */
async function removeOldPrint(): Promise<void> {
  if (oldPrintRemoved) return;
  oldPrintRemoved = true;
  for (const path of OLD_DIRS) {
    try {
      await Filesystem.rmdir({ path, directory: mushafDirectory(), recursive: true });
    } catch {
      // Already gone (or never there).
    }
  }
}
