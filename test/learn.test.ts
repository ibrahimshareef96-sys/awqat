// Learn's model: tracks, items, study time and lessons, every change a new Learn, ids that keep to the id rule, the
// week from Monday, links that are https or nothing, and a saved Learn read back tolerantly with every field checked.
import { describe, expect, it } from "vitest";
import {
  ITEMS_MAX, LESSONS_MAX, NAME_MAX, SESSIONS_MAX, TRACKS_MAX, URL_MAX, addItem, addLesson, addTrack, checkLearn,
  cleanUrl, cycleItem, emptyLearn, formatMinutes, isId, logSession, newId, nextItem, parseMinutes, removeItem,
  removeLesson, removeSession, setArchived, setWeeklyMinutes, trackItems, trackLessons, weekMinutes, weekSessions,
  weekTarget, type Learn, type LearnItem, type LearnTrack,
} from "../src/learn/learn.ts";

// A Wednesday; its week runs from Monday 26 Oct to Sunday 1 Nov.
const TODAY = "2026-10-28";
// Characters that hide or turn text, built from code points so none sits in this file.
const [RLO, ZWSP, LRI, PDI] = [0x202e, 0x200b, 0x2066, 0x2069].map((c) => String.fromCodePoint(c));

function withTrack(name = "Reading", weeklyMinutes = 120): { learn: Learn; id: string } {
  const result = addTrack(emptyLearn(), { name, kind: "worldly", weeklyMinutes }, TODAY);
  return { learn: result.learn, id: result.id! };
}

function withItems(...titles: string[]): { learn: Learn; trackId: string; ids: string[] } {
  const start = withTrack();
  let learn = start.learn;
  const ids: string[] = [];
  for (const title of titles) {
    const r = addItem(learn, start.id, { title, kind: "book", url: null }, TODAY);
    learn = r.learn;
    ids.push(r.id!);
  }
  return { learn, trackId: start.id, ids };
}

describe("ids", () => {
  it("makes ids that keep to the id rule, and the rule refuses anything else", () => {
    for (let i = 0; i < 20; i += 1) expect(isId(newId())).toBe(true);
    expect(isId("track-trading")).toBe(true);
    expect(isId("")).toBe(false);
    expect(isId("a".repeat(65))).toBe(false);
    expect(isId("a b")).toBe(false);
    expect(isId("a/b")).toBe(false);
    expect(isId("<x>")).toBe(false);
    expect(isId(12)).toBe(false);
  });
});

describe("tracks", () => {
  it("adds a track with a clean name, its kind and a weekly target held to 0 to 3000", () => {
    const r = addTrack(emptyLearn(), { name: `  Usul${RLO} al-Fiqh \n`, kind: "islamic", weeklyMinutes: 99999 }, TODAY);
    expect(r.refused).toBeNull();
    expect(r.learn.tracks[0]).toMatchObject({ name: "Usul al-Fiqh", kind: "islamic", weeklyMinutes: 3000, archived: false,
      added: TODAY });
    expect(isId(r.learn.tracks[0].id)).toBe(true);
    expect(addTrack(emptyLearn(), { name: "X", kind: "worldly", weeklyMinutes: -5 }, TODAY).learn.tracks[0].weeklyMinutes).toBe(0);
  });

  it("refuses a track without a name, a second track of the same name, and a 51st track", () => {
    expect(addTrack(emptyLearn(), { name: ` ${ZWSP} `, kind: "worldly", weeklyMinutes: 0 }, TODAY).refused).toBe("empty");
    const { learn, id } = withTrack("Fiqh");
    const same = addTrack(learn, { name: "fiqh!", kind: "islamic", weeklyMinutes: 0 }, TODAY);
    expect(same).toMatchObject({ refused: "exists", id, learn });
    let full = emptyLearn();
    for (let i = 0; i < TRACKS_MAX; i += 1) full = addTrack(full, { name: `T${i}`, kind: "worldly", weeklyMinutes: 0 }, TODAY).learn;
    expect(addTrack(full, { name: "One more", kind: "worldly", weeklyMinutes: 0 }, TODAY).refused).toBe("full");
  });

  it("takes a name with or without its vowel marks or accents as the same name", () => {
    const tafsir = addTrack(emptyLearn(), { name: "تفسير", kind: "islamic", weeklyMinutes: 0 }, TODAY);
    expect(addTrack(tafsir.learn, { name: "تَفْسِير", kind: "islamic", weeklyMinutes: 0 }, TODAY).refused).toBe("exists");
    const fiqh = addTrack(emptyLearn(), { name: "Usul al-Fiqh", kind: "islamic", weeklyMinutes: 0 }, TODAY);
    expect(addTrack(fiqh.learn, { name: "Uṣūl al-Fiqh", kind: "islamic", weeklyMinutes: 0 }, TODAY).refused).toBe("exists");
    expect(addTrack(fiqh.learn, { name: "Usul", kind: "islamic", weeklyMinutes: 0 }, TODAY).refused).toBeNull();
  });

  it("cuts a name to 200 characters, counting characters, not code units", () => {
    const r = addTrack(emptyLearn(), { name: "😀".repeat(300), kind: "worldly", weeklyMinutes: 0 }, TODAY);
    expect(Array.from(r.learn.tracks[0].name)).toHaveLength(NAME_MAX);
  });

  it("archives and brings back a track, and sets its target, leaving the old Learn as it was", () => {
    const { learn, id } = withTrack();
    const archived = setArchived(learn, id, true);
    expect(archived.tracks[0].archived).toBe(true);
    expect(learn.tracks[0].archived).toBe(false);
    expect(setArchived(archived, id, false).tracks[0].archived).toBe(false);
    expect(setWeeklyMinutes(learn, id, 240).tracks[0].weeklyMinutes).toBe(240);
    expect(learn.tracks[0].weeklyMinutes).toBe(120);
  });
});

describe("items", () => {
  it("adds items at the end of their own track, in order", () => {
    const { learn, trackId, ids } = withItems("First", "Second", "Third");
    expect(trackItems(learn, trackId).map((i) => i.title)).toEqual(["First", "Second", "Third"]);
    expect(trackItems(learn, trackId).map((i) => i.order)).toEqual([1, 2, 3]);
    const other = addTrack(learn, { name: "Other", kind: "worldly", weeklyMinutes: 0 }, TODAY);
    const there = addItem(other.learn, other.id!, { title: "Elsewhere", kind: "video", url: null }, TODAY);
    expect(itemById(there.learn, there.id!).order).toBe(1);
    expect(ids.every(isId)).toBe(true);
  });

  it("refuses an item with no title, for a track that is not there, or past 5000", () => {
    const { learn, id } = withTrack();
    expect(addItem(learn, id, { title: "  ", kind: "book", url: null }, TODAY).refused).toBe("empty");
    expect(addItem(learn, "missing", { title: "A", kind: "book", url: null }, TODAY).refused).toBe("track");
    const items: LearnItem[] = Array.from({ length: ITEMS_MAX }, (_, i) => ({ id: `i-${i}`, trackId: id, title: "x",
      kind: "book", url: null, status: "todo", order: i, added: TODAY, done: null }));
    expect(addItem({ ...learn, items }, id, { title: "A", kind: "book", url: null }, TODAY).refused).toBe("full");
  });

  it("keeps only https links of 500 characters or fewer", () => {
    const { learn, id } = withTrack();
    const good = addItem(learn, id, { title: "A", kind: "course", url: "https://example.com/course" }, TODAY);
    expect(itemById(good.learn, good.id!).url).toBe("https://example.com/course");
    const bad = addItem(learn, id, { title: "B", kind: "course", url: "javascript:alert(1)" }, TODAY);
    expect(itemById(bad.learn, bad.id!).url).toBeNull();
  });

  it("cycles to do, doing, done (dated), and back to to do", () => {
    const { learn, ids } = withItems("Lecture");
    const doing = cycleItem(learn, ids[0], TODAY);
    expect(itemById(doing, ids[0])).toMatchObject({ status: "doing", done: null });
    const done = cycleItem(doing, ids[0], TODAY);
    expect(itemById(done, ids[0])).toMatchObject({ status: "done", done: TODAY });
    expect(itemById(cycleItem(done, ids[0], "2026-10-29"), ids[0])).toMatchObject({ status: "todo", done: null });
    expect(itemById(learn, ids[0]).status).toBe("todo");
  });

  it("names the item being done as next, else the first still to do, else none", () => {
    const { learn, trackId, ids } = withItems("One", "Two", "Three");
    expect(nextItem(learn, trackId)?.title).toBe("One");
    const twoDoing = cycleItem(cycleItem(cycleItem(learn, ids[0], TODAY), ids[0], TODAY), ids[1], TODAY);
    expect(nextItem(twoDoing, trackId)?.title).toBe("Two");
    const allDone = [ids[1], ids[1], ids[2], ids[2]].reduce((l, id) => cycleItem(l, id, TODAY),
      cycleItem(cycleItem(learn, ids[0], TODAY), ids[0], TODAY));
    expect(nextItem(allDone, trackId)).toBeNull();
  });

  it("removes an item, keeping the user's study time and lessons on the track without its name", () => {
    const { learn, trackId, ids } = withItems("Gone", "Stays");
    const logged = logSession(learn, { trackId, itemId: ids[0], minutes: 30, note: "" }, TODAY).learn;
    const noted = addLesson(logged, { trackId, itemId: ids[0], text: "A thing", source: "" }, TODAY).learn;
    const removed = removeItem(noted, ids[0]);
    expect(removed.items.map((i) => i.title)).toEqual(["Stays"]);
    expect(removed.sessions[0].itemId).toBeNull();
    expect(removed.lessons[0].itemId).toBeNull();
    expect(noted.sessions[0].itemId).toBe(ids[0]);
  });
});

describe("study time", () => {
  it("logs 1 to 600 whole minutes today, and refuses anything else", () => {
    const { learn, id } = withTrack();
    for (const minutes of [0, 601, 12.5, Number.NaN, -3]) {
      expect(logSession(learn, { trackId: id, itemId: null, minutes, note: "" }, TODAY).refused).toBe("minutes");
    }
    const r = logSession(learn, { trackId: id, itemId: null, minutes: 600, note: " a  long\nnote " }, TODAY);
    expect(r.learn.sessions[0]).toMatchObject({ trackId: id, itemId: null, date: TODAY, minutes: 600, note: "a long note" });
    expect(logSession(learn, { trackId: "nope", itemId: null, minutes: 5, note: "" }, TODAY).refused).toBe("track");
  });

  it("starts an item not yet begun, and never names an item of another track", () => {
    const { learn, trackId, ids } = withItems("Lecture");
    const started = logSession(learn, { trackId, itemId: ids[0], minutes: 45, note: "" }, TODAY).learn;
    expect(itemById(started, ids[0]).status).toBe("doing");
    const other = addTrack(started, { name: "Other", kind: "worldly", weeklyMinutes: 0 }, TODAY);
    const wrong = logSession(other.learn, { trackId: other.id!, itemId: ids[0], minutes: 5, note: "" }, TODAY).learn;
    expect(wrong.sessions[1].itemId).toBeNull();
  });

  it("refuses a session past 20000", () => {
    const { learn, id } = withTrack();
    const sessions = Array.from({ length: SESSIONS_MAX }, (_, i) => ({ id: `s-${i}`, trackId: id, itemId: null, date: TODAY,
      minutes: 1, note: "" }));
    expect(logSession({ ...learn, sessions }, { trackId: id, itemId: null, minutes: 5, note: "" }, TODAY).refused).toBe("full");
  });

  it("counts the week from Monday to Sunday, on one track or on every track still studied", () => {
    const { learn, id } = withTrack("A", 120);
    const b = addTrack(learn, { name: "B", kind: "islamic", weeklyMinutes: 60 }, TODAY);
    const at = (l: Learn, trackId: string, minutes: number, day: string) =>
      logSession(l, { trackId, itemId: null, minutes, note: "" }, day).learn;
    let l = at(b.learn, id, 30, "2026-10-25"); // the Sunday before: last week
    l = at(l, id, 40, "2026-10-26"); // Monday
    l = at(l, id, 50, "2026-11-01"); // Sunday
    l = at(l, id, 60, "2026-11-02"); // next Monday
    l = at(l, b.id!, 20, TODAY);
    expect(weekMinutes(l, TODAY, id)).toBe(90);
    expect(weekSessions(l, id, TODAY).map((s) => s.date)).toEqual(["2026-11-01", "2026-10-26"]);
    expect(weekMinutes(l, TODAY)).toBe(110);
    expect(weekTarget(l)).toBe(180);
    const archived = setArchived(l, b.id!, true);
    expect(weekMinutes(archived, TODAY)).toBe(90);
    expect(weekTarget(archived)).toBe(120);
    expect(weekMinutes(l, "2026-11-01", id)).toBe(90);
  });

  it("deletes one session", () => {
    const { learn, id } = withTrack();
    const r = logSession(learn, { trackId: id, itemId: null, minutes: 5, note: "" }, TODAY);
    expect(removeSession(r.learn, r.id!).sessions).toEqual([]);
  });
});

describe("lessons", () => {
  it("keeps the user's words and the user's source as typed, due tomorrow at the first step", () => {
    const { learn, id } = withTrack();
    const r = addLesson(learn, { trackId: id, itemId: null, text: "  Line one\nline   two  ", source: " Al-Baqarah 255 " }, TODAY);
    expect(r.learn.lessons[0]).toMatchObject({ text: "Line one\nline two", source: "Al-Baqarah 255", date: TODAY,
      due: "2026-10-29", step: 0 });
  });

  it("refuses an empty lesson or one past 20000, and cuts text to 1000 and sources to 200", () => {
    const { learn, id } = withTrack();
    expect(addLesson(learn, { trackId: id, itemId: null, text: `${LRI} ${PDI}`, source: "" }, TODAY).refused).toBe("empty");
    const long = addLesson(learn, { trackId: id, itemId: null, text: "a".repeat(1500), source: "b".repeat(300) }, TODAY);
    expect(long.learn.lessons[0].text).toHaveLength(1000);
    expect(long.learn.lessons[0].source).toHaveLength(200);
    const lessons = Array.from({ length: LESSONS_MAX }, (_, i) => ({ id: `l-${i}`, trackId: id, itemId: null, date: TODAY,
      text: "x", source: "", due: TODAY, step: 0 }));
    expect(addLesson({ ...learn, lessons }, { trackId: id, itemId: null, text: "y", source: "" }, TODAY).refused).toBe("full");
  });

  it("lists a track's lessons newest first, and deletes one", () => {
    const { learn, id } = withTrack();
    const a = addLesson(learn, { trackId: id, itemId: null, text: "Older", source: "" }, "2026-10-20");
    const b = addLesson(a.learn, { trackId: id, itemId: null, text: "Newer", source: "" }, TODAY);
    const c = addLesson(b.learn, { trackId: id, itemId: null, text: "Newest same day", source: "" }, TODAY);
    expect(trackLessons(c.learn, id).map((l) => l.text)).toEqual(["Newest same day", "Newer", "Older"]);
    expect(removeLesson(c.learn, a.id!).lessons.map((l) => l.text)).toEqual(["Newer", "Newest same day"]);
  });
});

describe("helpers", () => {
  it("takes whole minutes within the range given", () => {
    expect(parseMinutes("45", 1, 600)).toBe(45);
    expect(parseMinutes(" 45 ", 1, 600)).toBe(45);
    expect(parseMinutes("45.5", 1, 600)).toBeNull();
    expect(parseMinutes("", 0, 3000)).toBeNull();
    expect(parseMinutes("0", 0, 3000)).toBe(0);
    expect(parseMinutes("1e3", 0, 3000)).toBe(1000);
    expect(parseMinutes("abc", 1, 600)).toBeNull();
    expect(parseMinutes(null, 1, 600)).toBeNull();
  });

  it("says minutes the way people say them", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(240)).toBe("4 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
  });

  it("keeps a link only when it is https, short enough, and hides nothing", () => {
    expect(cleanUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(cleanUrl("http://example.com")).toBeNull();
    // Only a public site: nothing on the user's own network or the phone itself.
    for (const local of ["https://127.0.0.1/x", "https://192.168.1.5/", "https://[::1]/", "https://localhost/", "https://nas.local/"]) {
      expect(cleanUrl(local)).toBeNull();
    }
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("data:text/html,hi")).toBeNull();
    expect(cleanUrl("https://user:pass@example.com")).toBeNull();
    expect(cleanUrl("https://exa mple.example.com")).toBeNull();
    expect(cleanUrl(`https://example.com/${RLO}gnp.exe`)).toBeNull();
    expect(cleanUrl(`https://example.com/${"a".repeat(URL_MAX)}`)).toBeNull();
    expect(cleanUrl(`https://example.com/${"a".repeat(URL_MAX - 20)}`)).toHaveLength(URL_MAX);
    expect(cleanUrl("not a link")).toBeNull();
    expect(cleanUrl(42)).toBeNull();
  });

  it("keeps a link as it is read, so what is shown is what opens, and refuses forms parsers read differently", () => {
    expect(cleanUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
    expect(cleanUrl("https://example.com")).toBe("https://example.com/");
    expect(cleanUrl("https:example.com")).toBeNull();
    expect(cleanUrl("https:/example.com")).toBeNull();
    expect(cleanUrl("https:\\\\evil.example")).toBeNull();
    expect(cleanUrl("https://example.com\\@evil.example")).toBeNull();
    expect(cleanUrl("https://xn--exmple-cua.example.com/")).toBe("https://xn--exmple-cua.example.com/");
  });
});

describe("reading a saved Learn", () => {
  it("starts empty when nothing was saved, and calls anything that is not one damaged", () => {
    expect(checkLearn(null)).toEqual({ learn: emptyLearn(), damaged: false });
    for (const json of ["{", "null", "[]", '"text"', '{"v":2,"tracks":[]}', '{"v":1}', '{"v":1,"tracks":{},"items":[],"sessions":[],"lessons":[]}']) {
      expect(checkLearn(json).damaged).toBe(true);
    }
  });

  it("reads back what was saved, unchanged and not damaged", () => {
    const { learn, trackId, ids } = withItems("One");
    const logged = logSession(learn, { trackId, itemId: ids[0], minutes: 25, note: "n" }, TODAY).learn;
    const full = addLesson(logged, { trackId, itemId: ids[0], text: "t", source: "s" }, TODAY).learn;
    expect(checkLearn(JSON.stringify(full))).toEqual({ learn: full, damaged: false });
  });

  it("leaves out records with a bad id, no name, an unknown track or no date, and says it is damaged", () => {
    const track: LearnTrack = { id: "t-1", name: "Good", kind: "worldly", weeklyMinutes: 60, archived: false, added: TODAY };
    const raw = {
      v: 1,
      tracks: [track, { ...track, id: "bad id" }, { ...track, id: "t-2", name: " " }, { ...track }],
      items: [{ id: "i-1", trackId: "t-1", title: "Item", kind: "book", url: null, status: "todo", order: 1, added: TODAY,
        done: null }, { id: "i-2", trackId: "t-9", title: "Orphan" }],
      sessions: [{ id: "s-1", trackId: "t-1", itemId: "i-1", date: TODAY, minutes: 30, note: "" },
        { id: "s-2", trackId: "t-1", date: "2026-02-30", minutes: 30 }, { id: "s-3", trackId: "t-1", date: TODAY, minutes: 0 }],
      lessons: [{ id: "l-1", trackId: "t-1", itemId: null, date: TODAY, text: "", source: "", due: TODAY, step: 0 }],
    };
    const { learn, damaged } = checkLearn(JSON.stringify(raw));
    expect(damaged).toBe(true);
    expect(learn.tracks.map((t) => t.id)).toEqual(["t-1"]);
    expect(learn.items.map((i) => i.id)).toEqual(["i-1"]);
    expect(learn.sessions.map((s) => s.id)).toEqual(["s-1"]);
    expect(learn.lessons).toEqual([]);
  });

  it("checks every field: kinds, statuses, limits, links, dates and steps, and items of another track", () => {
    const raw = {
      v: 1,
      tracks: [{ id: "t-1", name: `<b>${"n".repeat(500)}`, kind: "spiritual", weeklyMinutes: 9999.4, archived: "yes", added: "x" },
        { id: "t-2", name: "Two", kind: "islamic", weeklyMinutes: "60", archived: true, added: TODAY }],
      items: [{ id: "i-1", trackId: "t-1", title: "Item", kind: "podcast", url: "http://example.com", status: "finished",
        order: "3", added: TODAY, done: TODAY }, { id: "i-2", trackId: "t-2", title: "Done", kind: "video",
        url: "https://example.com", status: "done", order: 2.6, added: TODAY, done: "2026-13-01" }],
      sessions: [{ id: "s-1", trackId: "t-1", itemId: "i-2", date: TODAY, minutes: 9000, note: 5 }],
      lessons: [{ id: "l-1", trackId: "t-2", itemId: "i-2", date: TODAY, text: "Kept", source: null, due: "soon", step: 40 }],
    };
    const { learn, damaged } = checkLearn(JSON.stringify(raw));
    expect(damaged).toBe(false);
    expect(learn.tracks[0]).toMatchObject({ kind: "worldly", weeklyMinutes: 3000, archived: false, added: "2000-01-01" });
    expect(learn.tracks[0].name).toHaveLength(NAME_MAX);
    expect(learn.tracks[1]).toMatchObject({ weeklyMinutes: 0, archived: true });
    expect(learn.items[0]).toMatchObject({ kind: "other", url: null, status: "todo", order: 0, done: null });
    expect(learn.items[1]).toMatchObject({ status: "done", order: 3, done: null, url: "https://example.com/" });
    expect(learn.sessions[0]).toMatchObject({ itemId: null, minutes: 600, note: "" });
    expect(learn.lessons[0]).toMatchObject({ itemId: "i-2", source: "", due: "2026-10-29", step: 6 });
  });

  it("keeps the first of two records with the same id, and at most the limit of each", () => {
    const track = { id: "t-1", name: "One", kind: "worldly", weeklyMinutes: 0, archived: false, added: TODAY };
    const many = Array.from({ length: TRACKS_MAX + 5 }, (_, i) => ({ ...track, id: `m-${i}`, name: `M${i}` }));
    const { learn, damaged } = checkLearn(JSON.stringify({ v: 1, tracks: [track, { ...track, name: "Copy" }, ...many],
      items: [], sessions: [], lessons: [] }));
    expect(learn.tracks[0].name).toBe("One");
    expect(learn.tracks).toHaveLength(TRACKS_MAX - 1);
    expect(damaged).toBe(true);
  });
});

function itemById(learn: Learn, id: string): LearnItem {
  const item = learn.items.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
}
