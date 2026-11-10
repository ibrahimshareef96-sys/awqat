/**
 * What syncs, and how each saved value becomes records (sync/records.ts) and back. Each value made again from records
 * goes through its own reader (checkLog, checkQuranLog and the rest), so data from another device is checked exactly
 * like data read from this one. What stays on each device: the mushaf's page colour.
 */
import { checkBody, DONE_MAX, LIFTS_MAX, WEIGHTS_MAX, type BodyLog } from "../body/body.ts";
import { MEALS_MAX, checkFood, type FoodLog } from "../food/food.ts";
import { ADHKAR_KEEP_DAYS, checkAdhkarLog, type AdhkarLog } from "../faith/adhkar.ts";
import { checkFridayLog, type FridayLog } from "../faith/friday.ts";
import { checkLog, type PrayerLog } from "../prayer/log.ts";
import { checkQuranLog, type QuranLog } from "../quran/log.ts";
import { checkMarks, validBookmarkTime, type MushafMarks } from "../quran/marks.ts";
import { checkPlan, type MurajaahPlan } from "../quran/murajaah.ts";
import { checkLearn, type Learn } from "../learn/learn.ts";
import { checkModeLog, type ModeLog } from "../modes/modes.ts";
import { checkMoney, type Money } from "../money/money.ts";
import { REVIEWS_MAX, checkReviewLog, isWeekKey, type ReviewLog } from "../review/muhasabah.ts";
import { KEYS } from "../store.ts";
import { RECORD_BYTES_MAX, canonical, type Collection, type Data, type Rec } from "./records.ts";

const plain = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);
const of = (records: readonly Rec[], kind: string): Rec[] => records.filter((r) => r.kind === kind);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * What a device takes in of each kind, at most: far beyond a lifetime of use, short of slowing the phone. What passes a
 * limit is left out here (and forgotten by the sync, never removed on the user's other devices).
 */
export const LIMITS = { prayerDays: 20000, quranEntries: 50000, fridays: 3000, mistakes: 20000, notes: 10000 } as const;
/** The newest `n` of records keyed by day (ids "YYYY-MM-DD" sort by date). */
const newest = (records: readonly Rec[], n: number): Rec[] =>
  records.length <= n ? [...records] : [...records].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, n);

/** Prayer marks by day, and the prayers owed. Two devices' marks for one day are both kept. */
export const prayerCollection: Collection<PrayerLog> = {
  key: KEYS.log,
  kinds: ["prayer.day", "prayer.owed"],
  toRecords: (log) => [
    ...Object.entries(log.days).map(([date, day]) => ({ kind: "prayer.day", id: date, data: day as unknown as Data })),
    { kind: "prayer.owed", id: "owed", data: { owed: log.owed } },
  ],
  fromRecords: (records) => checkLog(JSON.stringify({
    v: 1,
    days: Object.fromEntries(newest(of(records, "prayer.day"), LIMITS.prayerDays).map((r) => [r.id, r.data])),
    owed: num(of(records, "prayer.owed")[0]?.data.owed),
  })).log,
  merge: (kind, mine, theirs) => {
    if (kind !== "prayer.day") return theirs;
    const prayers = { ...(plain(theirs.prayers) ? theirs.prayers : {}), ...(plain(mine.prayers) ? mine.prayers : {}) };
    const a = plain(mine.sunnah) ? mine.sunnah : {};
    const b = plain(theirs.sunnah) ? theirs.sunnah : {};
    const sunnah = Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, a[k] === true || b[k] === true]));
    return { ...theirs, prayers, sunnah };
  },
};

const KIND_RANK: Readonly<Record<string, number>> = { read: 0, revise: 1, study: 2 };

/**
 * The Quran log: each reading, revision and study session on its own, your place and the readings completed, and the
 * daily goal. Two places from two devices: the one further on (more readings completed, then the later page) wins.
 */
export const quranCollection: Collection<QuranLog> = {
  key: KEYS.quran,
  kinds: ["quran.entry", "quran.place", "quran.goal"],
  toRecords: (log) => [
    ...log.entries.map((entry) => ({ kind: "quran.entry", id: entry.id, data: entry as unknown as Data })),
    { kind: "quran.place", id: "place", data: { position: log.position, completed: log.completed } },
    ...(log.dailyGoal > 0 ? [{ kind: "quran.goal", id: "goal", data: { pages: log.dailyGoal } }] : []),
  ],
  fromRecords: (records) => {
    const place = of(records, "quran.place")[0]?.data ?? {};
    // Oldest first, as the log keeps them, in one order every device agrees on: by day, then readings before revision
    // and study, readings by their first page, then by id. (A reading that finishes the Quran and a new one begun the
    // same day cannot be told apart by order: entries carry a day, not a time.)
    const rank = (e: Data) => KIND_RANK[String(e.kind)] ?? 3;
    const entries = of(records, "quran.entry").map((r): Data => ({ ...r.data, id: r.id }))
      .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0) ||
        rank(a) - rank(b) || num(a.fromPage) - num(b.fromPage) ||
        (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
      .slice(-LIMITS.quranEntries);
    return checkQuranLog(JSON.stringify({ v: 1, position: num(place.position), completed: num(place.completed), entries,
      dailyGoal: num(of(records, "quran.goal")[0]?.data.pages) })).log;
  },
  merge: (kind, mine, theirs) => {
    if (kind !== "quran.place") return theirs;
    const ahead = num(mine.completed) - num(theirs.completed) || num(mine.position) - num(theirs.position);
    return ahead > 0 ? mine : theirs;
  },
};

/** The adhkar by day: two devices' counts for one day keep the higher of each. */
export const adhkarCollection: Collection<AdhkarLog> = {
  key: KEYS.adhkar,
  kinds: ["adhkar.day"],
  toRecords: (log) => Object.entries(log.days).map(([date, day]) => ({ kind: "adhkar.day", id: date, data: day as Data })),
  fromRecords: (records) => checkAdhkarLog(JSON.stringify({
    v: 1, days: Object.fromEntries(newest(records, ADHKAR_KEEP_DAYS).map((r) => [r.id, r.data])),
  })).log,
  merge: (_kind, mine, theirs) => {
    const sessions = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
    return Object.fromEntries([...sessions].map((session) => {
      const a = plain(mine[session]) ? mine[session] as Data : {};
      const b = plain(theirs[session]) ? theirs[session] as Data : {};
      const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [session, Object.fromEntries([...ids].map((id) => [id, Math.max(num(a[id]), num(b[id]))]))];
    }));
  },
};

/** The Friday routine by Friday: two devices' ticks for one Friday are both kept. */
export const fridayCollection: Collection<FridayLog> = {
  key: KEYS.friday,
  kinds: ["friday.day"],
  toRecords: (log) => Object.entries(log.days).map(([date, items]) => ({ kind: "friday.day", id: date, data: items as Data })),
  fromRecords: (records) => checkFridayLog(JSON.stringify({
    v: 1, days: Object.fromEntries(newest(records, LIMITS.fridays).map((r) => [r.id, r.data])),
  })).log,
  merge: (_kind, mine, theirs) => ({ ...theirs, ...mine }),
};

/**
 * A mushaf key ("2:255", "2:255:3") travels as an id ("2-255", "2-255-3"); both are digits only, so it comes back. An
 * id with a leading zero ("02-255") would come back as a second key for the same place: such an id is left out.
 */
const toId = (key: string): string => key.replaceAll(":", "-");
const toKey = (id: string): string => id.replaceAll("-", ":");
const canonicalId = (r: Rec): boolean => r.id.split("-").every((part) => String(Number(part)) === part);
const marked = (records: readonly Rec[], kind: string, n: number): Rec[] => of(records, kind).filter(canonicalId).slice(0, n);
const later = (a: Data, b: Data, field: string): Data => (String(a[field] ?? "") > String(b[field] ?? "") ? a : b);

/**
 * The mushaf's mistakes and notes, and its bookmark (where the user stopped reading: of two devices', the one set later
 * wins). The page colour stays on each device. A bookmark never set (lastPageAt 0) is not sent, so a device that has
 * not read yet never moves the others' back.
 */
export const mushafCollection: Collection<MushafMarks> = {
  key: KEYS.mushaf,
  kinds: ["mushaf.mistake", "mushaf.note", "mushaf.pagenote", "mushaf.place"],
  toRecords: (marks) => [
    ...Object.entries(marks.mistakes).map(([key, m]) => ({ kind: "mushaf.mistake", id: toId(key), data: m as unknown as Data })),
    ...Object.entries(marks.notes).map(([key, n]) => ({ kind: "mushaf.note", id: toId(key), data: n as unknown as Data })),
    ...Object.entries(marks.pageNotes).map(([page, n]) => ({ kind: "mushaf.pagenote", id: page, data: n as unknown as Data })),
    ...(marks.lastPageAt > 0 ? [{ kind: "mushaf.place", id: "place", data: { page: marks.lastPage, at: marks.lastPageAt } }] : []),
  ],
  fromRecords: (records, current) => {
    const found = of(records, "mushaf.place").find((r) => r.id === "place")?.data;
    // A bookmark is taken whole or not at all: a page out of the mushaf, or a time out of range, leaves this one.
    const place = found && Number.isInteger(found.page) && num(found.page) >= 1 && num(found.page) <= 604 &&
      validBookmarkTime(found.at) ? found : undefined;
    return checkMarks(JSON.stringify({
      v: 1,
      mistakes: Object.fromEntries(marked(records, "mushaf.mistake", LIMITS.mistakes).map((r) => [toKey(r.id), r.data])),
      notes: Object.fromEntries(marked(records, "mushaf.note", LIMITS.notes).map((r) => [toKey(r.id), r.data])),
      pageNotes: Object.fromEntries(marked(records, "mushaf.pagenote", 604).map((r) => [r.id, r.data])),
      // A time from a clock running ahead is kept as now, so it cannot outrank the moves made here for a day.
      lastPage: place ? place.page : current.lastPage,
      lastPageAt: place ? Math.min(num(place.at), Date.now()) : current.lastPageAt,
      theme: current.theme,
    })).marks;
  },
  merge: (kind, mine, theirs) => {
    if (kind === "mushaf.mistake") {
      return { count: Math.max(num(mine.count), num(theirs.count)), last: later(mine, theirs, "last").last };
    }
    if (kind === "mushaf.place") {
      // A time out of range never wins: it would be dropped on reading, and this device's change with it.
      if (!validBookmarkTime(theirs.at)) return mine;
      if (!validBookmarkTime(mine.at)) return theirs;
      return num(mine.at) > num(theirs.at) ? mine : theirs;
    }
    return later(mine, theirs, "updated");
  },
};

/**
 * Learn (learn/learn.ts): each track, item, study session and lesson on its own record. The order on this device is
 * kept, with what arrives after it; checkLearn checks every field as it does when Learn is read from the store.
 */
export const learnCollection: Collection<Learn> = {
  key: KEYS.learn,
  kinds: ["learn.track", "learn.item", "learn.session", "learn.lesson"],
  toRecords: (learn) => [
    ...learn.tracks.map((t) => ({ kind: "learn.track", id: t.id, data: t as unknown as Data })),
    ...learn.items.map((i) => ({ kind: "learn.item", id: i.id, data: i as unknown as Data })),
    ...learn.sessions.map((s) => ({ kind: "learn.session", id: s.id, data: s as unknown as Data })),
    ...learn.lessons.map((l) => ({ kind: "learn.lesson", id: l.id, data: l as unknown as Data })),
  ],
  fromRecords: (records) => {
    const list = (kind: string) => of(records, kind).map((r): Data => ({ ...r.data, id: r.id }));
    return checkLearn(JSON.stringify({ v: 1, tracks: list("learn.track"), items: list("learn.item"),
      sessions: list("learn.session"), lessons: list("learn.lesson") })).learn;
  },
};

/**
 * The modes: each day's counts, each reading's place, each study's time, each du'a the user added. Two devices' counts for a
 * day keep the higher of each; of two places or times, the one set later wins. A timer stays on the device running it.
 */
export const modesCollection: Collection<ModeLog> = {
  key: KEYS.modes,
  kinds: ["modes.day", "modes.place", "modes.study", "modes.dua"],
  toRecords: (log) => [
    ...Object.entries(log.days).map(([date, day]) => ({ kind: "modes.day", id: date, data: day as Data })),
    ...Object.entries(log.places).map(([key, p]) => ({ kind: "modes.place", id: key, data: p as unknown as Data })),
    ...Object.entries(log.study).map(([id, s]) => ({ kind: "modes.study", id, data: s as unknown as Data })),
    ...Object.entries(log.duas).map(([id, d]) => ({ kind: "modes.dua", id, data: d as unknown as Data })),
  ],
  fromRecords: (records, current) => {
    const byId = (kind: string) => Object.fromEntries(of(records, kind).map((r) => [r.id, r.data]));
    return checkModeLog(JSON.stringify({ v: 1, days: byId("modes.day"), places: byId("modes.place"), study: byId("modes.study"),
      duas: byId("modes.dua"), timer: current.timer })).log;
  },
  merge: (kind, mine, theirs) => {
    if (kind === "modes.place" || kind === "modes.study") return num(mine.at) > num(theirs.at) ? mine : theirs;
    if (kind !== "modes.day") return theirs;
    const modes = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
    return Object.fromEntries([...modes].map((mode) => {
      const a = plain(mine[mode]) ? mine[mode] as Data : {};
      const b = plain(theirs[mode]) ? theirs[mode] as Data : {};
      const steps = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [mode, Object.fromEntries([...steps].map((step) => [step, Math.max(num(a[step]), num(b[step]))]))];
    }));
  },
};

/**
 * Body's own log: the plan, each typed weight, lift and day done on its own record. What the health store reads stays on
 * the device, and so does whether this device connected to it.
 */
export const bodyCollection: Collection<BodyLog> = {
  key: KEYS.body,
  kinds: ["body.plan", "body.weight", "body.lift", "body.done"],
  toRecords: (log) => [
    ...(log.weeklyTarget !== null || log.stepGoal !== null || Object.keys(log.plan).length > 0
      ? [{ kind: "body.plan", id: "plan", data: { weeklyTarget: log.weeklyTarget, stepGoal: log.stepGoal, plan: log.plan } as unknown as Data }] : []),
    ...log.weights.map((w) => ({ kind: "body.weight", id: `w${w.at}`, data: { at: w.at, kg: w.kg } as Data })),
    ...log.lifts.map((l) => ({ kind: "body.lift", id: l.id, data: l as unknown as Data })),
    ...log.done.map((day) => ({ kind: "body.done", id: day, data: { day } as Data })),
  ],
  fromRecords: (records, current) => {
    const plan = of(records, "body.plan")[0]?.data ?? {};
    return checkBody(JSON.stringify({
      v: 1,
      connected: current.connected,
      weeklyTarget: plan.weeklyTarget ?? null,
      stepGoal: plan.stepGoal ?? null,
      plan: plan.plan ?? {},
      // Each list's newest, within what a log holds: two devices' rows together can pass it, and a log past it reads as damaged.
      weights: of(records, "body.weight").map((r) => r.data).sort((a, b) => num(b.at) - num(a.at)).slice(0, WEIGHTS_MAX),
      lifts: of(records, "body.lift").map((r): Data => ({ ...r.data, id: r.id }))
        .sort((a, b) => (String(a.date) < String(b.date) ? 1 : String(a.date) > String(b.date) ? -1 : 0)).slice(0, LIFTS_MAX),
      done: newest(of(records, "body.done"), DONE_MAX).map((r) => r.id),
    })).log;
  },
};

/**
 * Food: the goals on one record and each meal on its own. A meal's photo is a file on the device that took it, so its
 * name never travels: a meal arriving from another device keeps the photo this device already holds for it, or none.
 */
export const foodCollection: Collection<FoodLog> = {
  key: KEYS.food,
  kinds: ["food.goal", "food.meal"],
  toRecords: (log) => [
    ...(log.goal.kcal !== null || log.goal.protein !== null ? [{ kind: "food.goal", id: "goal", data: { ...log.goal } as Data }] : []),
    ...log.meals.map((m) => ({ kind: "food.meal", id: m.id, data: { ...m, photo: null } as unknown as Data })),
  ],
  fromRecords: (records, current) => {
    const photos = new Map(current.meals.map((m) => [m.id, m.photo]));
    return checkFood(JSON.stringify({
      v: 1,
      goal: of(records, "food.goal")[0]?.data ?? { kcal: null, protein: null },
      meals: of(records, "food.meal").map((r): Data => ({ ...r.data, id: r.id, photo: photos.get(r.id) ?? null }))
        .sort((a, b) => (String(a.day) < String(b.day) ? 1 : String(a.day) > String(b.day) ? -1 : num(b.at) - num(a.at))).slice(0, MEALS_MAX),
    })).log;
  },
};

/** Money: the goal, and each amount that came in, is owed or goes out on its own record. Of two edits, the later wins. */
export const moneyCollection: Collection<Money> = {
  key: KEYS.money,
  kinds: ["money.goal", "money.entry", "money.owed", "money.commitment", "money.skipped"],
  toRecords: (money) => [
    ...(money.goal ? [{ kind: "money.goal", id: "goal", data: money.goal as unknown as Data }] : []),
    ...money.entries.map((e) => ({ kind: "money.entry", id: e.id, data: e as unknown as Data })),
    ...money.owed.map((o) => ({ kind: "money.owed", id: o.id, data: o as unknown as Data })),
    ...money.commitments.map((c) => ({ kind: "money.commitment", id: c.id, data: c as unknown as Data })),
    ...money.skipped.map((id) => ({ kind: "money.skipped", id, data: {} })),
  ],
  fromRecords: (records) => {
    const list = (kind: string) => of(records, kind).map((r): Data => ({ ...r.data, id: r.id }));
    return checkMoney(JSON.stringify({ v: 1, goal: of(records, "money.goal")[0]?.data ?? null, entries: list("money.entry"),
      owed: list("money.owed"), commitments: list("money.commitment"), skipped: of(records, "money.skipped").map((r) => r.id) })).money;
  },
};

const intentionsOf = (d: Data): unknown[] => (Array.isArray(d.intentions) ? d.intentions : []);
const doneAt = (d: Data, n: number): boolean => {
  const i = intentionsOf(d)[n];
  return plain(i) && i.done === true;
};
/** A review's words, its ticks set aside. */
const wordsOf = (d: Data): string => canonical({ ...d, intentions: intentionsOf(d).map((i) => (plain(i) ? i.text : i)) });

/** A record no bigger than the Worker takes (sync/records.ts), measured as the app measures what it sends. */
const fits = (r: Rec): boolean => new TextEncoder().encode(JSON.stringify(r.data)).length <= RECORD_BYTES_MAX;

/**
 * The Weekly Reviews (review/muhasabah.ts), one record a week, by its Monday. When two devices' copies of a week differ
 * only in their ticks, each intention done on either stays done (so an untick made while the other device's tick is on
 * its way gives way to it, as a prayer unmarked does); otherwise the newer review wins. Only records whose id is a week
 * and whose size the Worker allows are read, before the newest 52 are taken, so nothing else can push a review out.
 */
export const reviewsCollection: Collection<ReviewLog> = {
  key: KEYS.reviews,
  kinds: ["review.week"],
  toRecords: (log) => log.reviews.map((r) => ({ kind: "review.week", id: r.week, data: r as unknown as Data })),
  fromRecords: (records) => checkReviewLog(JSON.stringify({
    v: 1, reviews: newest(of(records, "review.week").filter((r) => isWeekKey(r.id) && fits(r)), REVIEWS_MAX)
      .map((r) => ({ ...r.data, week: r.id })),
  })).log,
  merge: (_kind, mine, theirs) => (wordsOf(mine) !== wordsOf(theirs) ? theirs
    : { ...theirs, intentions: intentionsOf(theirs).map((i, n) => (plain(i) ? { ...i, done: doneAt(mine, n) || doneAt(theirs, n) } : i)) }),
};

/** The muraja'ah plan, one record; no plan is no record. */
export const murajaahCollection: Collection<MurajaahPlan | null> = {
  key: KEYS.murajaah,
  kinds: ["murajaah.plan"],
  toRecords: (plan) => (plan ? [{ kind: "murajaah.plan", id: "plan", data: plan as unknown as Data }] : []),
  fromRecords: (records) => {
    const rec = records[0];
    return rec ? checkPlan(JSON.stringify(rec.data)).plan : null;
  },
};
