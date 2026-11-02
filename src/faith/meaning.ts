/**
 * The English and the transliteration ("how to say it") under each dhikr and du'a. None of it is in this repository
 * (THIRD_PARTY_NOTICES.md); it is fetched on the phone and kept there:
 * - the hadith du'a from hisnmuslim.com's developer API, which states no licence: asked for again at most once a week,
 *   the copy on the phone shown meanwhile, and credited where it is shown;
 * - the Quran items from Quran.com, the API the mushaf uses: each word's transliteration and one English translation,
 *   kept for at most a week as its developer terms allow, and never shown past it.
 * Requests go out natively (CapacitorHttp), https only and never following a redirect, so the page's policy stays shut.
 */
import { Capacitor, CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { mushafDirectory } from "../books/media.ts";
import { withDeadline } from "../deadline.ts";
import type { Dhikr, Session } from "./adhkar.ts";
import { ADHKAR } from "./adhkarData.ts";
import { DUAS } from "./duaData.ts";
import { HISN_ADHKAR, HISN_DUAS } from "./meaningIds.ts";
import {
  CHAPTER_CHARS_MAX, keptText, rangeKey, readHisnChapter, readKept, readQuranRange, type Kept, type QuranRange,
} from "./meaningRead.ts";
import { fingerprint, sessionPart, showTranslation, showTransliteration } from "./meaningText.ts";

/** Who a text is from, said for what is shown: how to say it, the meaning, or both. */
export interface Credit { both: string; sound: string; meaning: string }

export type Meaning =
  | { kind: "text"; transliteration: string; translation: string; credit: Credit; wholeAyah: boolean }
  /** On its way: shown as "Getting the translation". */
  | { kind: "pending" }
  /** Not on the phone, and it could not be fetched (offline, refused, or junk). */
  | { kind: "offline" };

export interface Needs { chapters: readonly number[]; ranges: readonly QuranRange[] }

/** Quran.com's English, by its resource id there (resources/translations). */
export const QURAN_TRANSLATION = { id: 20, name: "Saheeh International" } as const;
export const HISN_CREDIT: Credit = {
  both: "Translation and transliteration: Hisn al-Muslim, hisnmuslim.com",
  sound: "Transliteration: Hisn al-Muslim, hisnmuslim.com",
  meaning: "Translation: Hisn al-Muslim, hisnmuslim.com",
};
export const QURAN_CREDIT: Credit = {
  both: `Quran in English: ${QURAN_TRANSLATION.name}, and its transliteration, from Quran.com`,
  sound: "Quran transliteration: Quran.com",
  meaning: `Quran in English: ${QURAN_TRANSLATION.name}, from Quran.com`,
};
export const WEEK_MS = 7 * 86_400_000;
/** A fetch that failed is not tried again for this long (each list opened would otherwise ask again). */
export const RETRY_MS = 10 * 60_000;
/** A request still going after this is given up, however slowly the server keeps sending. */
export const FETCH_DEADLINE_MS = 30_000;
/** A clock put back a little does not make a copy look as if it came from the future. */
const CLOCK_SLACK_MS = 86_400_000;
/**
 * At-Tawbah 129's closing words start at its fourth word (word positions on Quran.com, checked on 3 Nov 2026): the
 * three before them are not part of the dhikr. By dhikr id.
 */
const SAID_FROM_WORD: Readonly<Record<number, number>> = { 17: 4 };
const FILE = "meanings/kept.json";

const hisnUrl = (chapter: number): string => `https://www.hisnmuslim.com/api/en/${chapter}.json`;
const quranUrl = (r: QuranRange): string => `https://api.quran.com/api/qdc/verses/by_range?from=${r.sura}:${r.from}` +
  `&to=${r.sura}:${r.to}&words=true&translations=${QURAN_TRANSLATION.id}&word_fields=location&fields=verse_key&per_page=all`;

export interface MeaningIo {
  native: () => boolean;
  get: (options: HttpOptions) => Promise<HttpResponse>;
  /** The copy kept on the phone, or null. */
  read: () => Promise<string | null>;
  write: (text: string) => Promise<boolean>;
}

/** The phone's side, replaced in tests. The copy lives with the mushaf's words, in a folder never backed up. */
export const meaningIo: MeaningIo = {
  native: () => Capacitor.isNativePlatform(),
  get: (options) => CapacitorHttp.get(options),
  read: async () => {
    try {
      const file = await Filesystem.readFile({ path: FILE, directory: mushafDirectory(), encoding: Encoding.UTF8 });
      return typeof file.data === "string" ? file.data : null;
    } catch {
      return null;
    }
  },
  write: async (text) => {
    try {
      await Filesystem.writeFile({ path: FILE, directory: mushafDirectory(), encoding: Encoding.UTF8, recursive: true, data: text });
      return true;
    } catch {
      return false;
    }
  },
};

const PENDING: Meaning = { kind: "pending" };
const OFFLINE: Meaning = { kind: "offline" };

let kept: Kept = { hisn: new Map(), quran: new Map() };
let warming: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();
let queued = false;
const failedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/** Everything in memory let go, as at start-up (for tests). */
export function forgetMeanings(): void {
  kept = { hisn: new Map(), quran: new Map() };
  warming = null;
  writing = Promise.resolve();
  queued = false;
  failedAt.clear();
  inFlight.clear();
}

const fresh = (fetched: number, now: number): boolean => now - fetched < WEEK_MS && fetched <= now + CLOCK_SLACK_MS;
const own = <T>(record: Readonly<Record<string | number, T>>, key: string | number): T | undefined =>
  (Object.hasOwn(record, key) ? record[key] : undefined);

/** Each item of a chapter we use, with our Arabic for it, which theirs must match. */
function wantedFrom(chapter: number): Map<number, string[]> {
  const pairs = [
    ...Object.entries(HISN_ADHKAR).map(([id, at]) => [at, ADHKAR.find((d) => d.id === Number(id))?.text ?? ""] as const),
    ...Object.entries(HISN_DUAS).map(([id, at]) => [at, DUAS.find((d) => d.id === id)?.text ?? ""] as const),
  ].filter(([at, text]) => at[0] === chapter && text);
  return pairs.reduce((wanted, [at, text]) => new Map(wanted).set(at[1], [...(wanted.get(at[1]) ?? []), text]),
    new Map<number, string[]>());
}

/**
 * Which of our words a chapter's items were checked against. A copy kept by another version of the app (a remapped
 * item, an edited dhikr) has another stamp, and is not shown: its items were never checked against these words.
 */
const stamps = new Map<number, string>();
function stampOf(chapter: number): string {
  const known = stamps.get(chapter);
  if (known) return known;
  const stamp = fingerprint(JSON.stringify([...wantedFrom(chapter)]));
  stamps.set(chapter, stamp);
  return stamp;
}

/**
 * Nothing on the phone for it: on its way (being fetched, or not asked for yet), or not to be had (the last try failed,
 * or this is a browser). A failure says so until a new try starts, however long the list stays open.
 */
function waiting(key: string): Meaning {
  if (!meaningIo.native()) return OFFLINE;
  if (inFlight.has(key)) return PENDING;
  return failedAt.has(key) ? OFFLINE : PENDING;
}

/** hisnmuslim.com's copy is shown however old it is, while a fresh one is asked for (it states no limit). */
function hisnMeaning(at: readonly [number, number], session: Session | null): Meaning | null {
  const chapter = kept.hisn.get(at[0]);
  if (!chapter) return waiting(`h${at[0]}`);
  // Fetched, and this item did not hold up (or the site has none): the Arabic alone, as before.
  const item = chapter.items.get(at[1]);
  if (!item) return null;
  const transliteration = showTransliteration(sessionPart(item.transliteration, session));
  const translation = showTranslation(sessionPart(item.translation, session));
  return transliteration || translation ? { kind: "text", transliteration, translation, credit: HISN_CREDIT, wholeAyah: false } : null;
}

function quranMeaning(item: Dhikr, q: NonNullable<Dhikr["quran"]>, now: number): Meaning {
  const range = { sura: q.sura, from: q.from, to: q.to };
  const got = kept.quran.get(rangeKey(range));
  if (!got || !fresh(got.fetched, now)) return waiting(`q${rangeKey(range)}`);
  const from = own(SAID_FROM_WORD, item.id) ?? 1;
  // Several ayat are numbered, so the English and the words to say line up.
  const number = (i: number): string => (got.verses.length > 1 ? ` (${q.from + i})` : "");
  const transliteration = got.verses.map((v, i) => v.words.filter(([position]) => position >= from).map(([, said]) => said)
    .join(" ") + number(i)).join(" ").trim();
  const translation = got.verses.map((v, i) => v.translation + number(i)).join(" ");
  return { kind: "text", transliteration, translation, credit: QURAN_CREDIT, wholeAyah: q.words !== undefined };
}

/**
 * What shows under a dhikr of the list for `session`; null when it has none (it shows its Arabic alone). `now` decides
 * whether Quran.com's copy is still within its week.
 */
export function dhikrMeaning(item: Dhikr, session: Session, now = Date.now()): Meaning | null {
  if (item.quran) return quranMeaning(item, item.quran, now);
  const at = own(HISN_ADHKAR, item.id);
  return at ? hisnMeaning(at, session) : null;
}

/** What shows under one of the du'as (duaData.ts); null when it has none. */
export function duaMeaning(id: string): Meaning | null {
  const at = own(HISN_DUAS, id);
  return at ? hisnMeaning(at, null) : null;
}

/** What a list of `session` needs fetched: its chapter on hisnmuslim.com and each Quran item's ayat. */
export function adhkarNeeds(session: Session): Needs {
  const items = ADHKAR.filter((d) => d.sessions.includes(session));
  const chapters = new Set(items.flatMap((d) => own(HISN_ADHKAR, d.id)?.slice(0, 1) ?? []));
  const ranges = items.flatMap((d) => (d.quran ? [{ sura: d.quran.sura, from: d.quran.from, to: d.quran.to }] : []));
  return { chapters: [...chapters], ranges };
}

/** What du'as with these ids need fetched. */
export function duaNeeds(ids: readonly string[]): Needs {
  return { chapters: [...new Set(ids.flatMap((id) => own(HISN_DUAS, id)?.slice(0, 1) ?? []))], ranges: [] };
}

/** One save at a time, each of what is in memory when its turn comes. */
function persist(): void {
  if (queued) return;
  queued = true;
  writing = writing.then(async () => {
    queued = false;
    const text = keptText(kept);
    if (text.length > CHAPTER_CHARS_MAX) return;
    try {
      await meaningIo.write(text);
    } catch {
      // Still in memory; the next change writes it.
    }
  });
}

/** The saves still to finish (for tests). */
export function writesDone(): Promise<void> {
  return writing;
}

/**
 * What may not be kept any longer goes, from memory and from the phone: Quran.com's words a week old, and a chapter
 * checked against other words than ours. True when anything went.
 */
function dropOld(now: number): boolean {
  const quran = [...kept.quran].filter(([, r]) => fresh(r.fetched, now));
  const hisn = [...kept.hisn].filter(([chapter, c]) => c.stamp === stampOf(chapter));
  if (quran.length === kept.quran.size && hisn.length === kept.hisn.size) return false;
  kept = { hisn: new Map(hisn), quran: new Map(quran) };
  persist();
  return true;
}

/** Reads the phone's copy once; a damaged one is nothing, and is written over with the next fetch. */
export function warmMeanings(): Promise<void> {
  if (!warming) {
    warming = meaningIo.read().then((text) => {
      const read = readKept(text);
      // Only chapters checked against our words now; what was fetched meanwhile is newer than the copy.
      const hisn = [...read.hisn].filter(([chapter, c]) => c.stamp === stampOf(chapter));
      kept = { hisn: new Map([...hisn, ...kept.hisn]), quran: new Map([...read.quran, ...kept.quran]) };
    }).catch(() => undefined);
  }
  return warming;
}

/** The phone's copy read, and what may not be kept any longer let go, whatever screen is open. */
export async function pruneMeanings(now = Date.now()): Promise<boolean> {
  await warmMeanings();
  return dropOld(now);
}

const header = (response: HttpResponse, name: string): string | undefined => {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : undefined;
};

/** The answer's body, or null for a refusal, one too big, one too slow, or no answer at all. */
async function answerOf(url: string): Promise<unknown> {
  try {
    const response = await withDeadline(meaningIo.get({ url, responseType: "json", connectTimeout: 10000, readTimeout: 20000,
      disableRedirects: true, headers: { Accept: "application/json" } }), FETCH_DEADLINE_MS);
    if (!response) return null;
    const length = Number(header(response, "content-length") ?? 0);
    return response.status === 200 && length <= CHAPTER_CHARS_MAX ? response.data : null;
  } catch {
    return null;
  }
}

async function fetchChapter(chapter: number, now: number): Promise<void> {
  const answer = await answerOf(hisnUrl(chapter));
  const read = answer === null ? null : readHisnChapter(answer, wantedFrom(chapter));
  // A chapter with nothing usable leaves the copy there was, if any.
  if (!read || read.size === 0) {
    failedAt.set(`h${chapter}`, now);
    return;
  }
  failedAt.delete(`h${chapter}`);
  kept = { ...kept, hisn: new Map(kept.hisn).set(chapter, { fetched: now, stamp: stampOf(chapter), items: read }) };
  persist();
}

async function fetchRange(range: QuranRange, now: number): Promise<void> {
  const key = rangeKey(range);
  const answer = await answerOf(quranUrl(range));
  const verses = answer === null ? null : readQuranRange(answer, range, QURAN_TRANSLATION.id);
  if (!verses) {
    failedAt.set(`q${key}`, now);
    return;
  }
  failedAt.delete(`q${key}`);
  kept = { ...kept, quran: new Map(kept.quran).set(key, { fetched: now, verses }) };
  persist();
}

/** One request per text at a time: a second list asking for the same waits on the first. */
function once(key: string, work: () => Promise<void>): Promise<void> {
  const going = inFlight.get(key);
  if (going) return going;
  const started = work().catch(() => undefined).finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}

/** Whether to ask for a text now: there is none fresh, the phone can ask, and it did not just fail. */
function shouldAsk(key: string, fetched: number | undefined, now: number): boolean {
  if (fetched !== undefined && fresh(fetched, now)) return false;
  if (inFlight.has(key)) return true;
  const failed = failedAt.get(key);
  return meaningIo.native() && (failed === undefined || now - failed >= RETRY_MS);
}

/**
 * Makes sure what a list needs is on the phone: from its copy, or fetched when there is none or it is a week old.
 * `settled` hears as each text arrives or fails, so what came first shows without waiting for the slowest. True when
 * anything shown may have changed (something arrived, failed or went).
 */
export async function ensureMeanings(needs: Needs, now = Date.now(), settled?: () => void): Promise<boolean> {
  const dropped = await pruneMeanings(now);
  const jobs = [
    ...needs.chapters.filter((c) => shouldAsk(`h${c}`, kept.hisn.get(c)?.fetched, now))
      .map((c) => once(`h${c}`, () => fetchChapter(c, now))),
    ...needs.ranges.filter((r) => shouldAsk(`q${rangeKey(r)}`, kept.quran.get(rangeKey(r))?.fetched, now))
      .map((r) => once(`q${rangeKey(r)}`, () => fetchRange(r, now))),
  ].map((job) => job.then(() => settled?.()));
  if (jobs.length === 0) return dropped;
  await Promise.allSettled(jobs);
  return true;
}
