// What the modes draw: the prompt, the list, a mode's steps, a study; the user's words escaped; no Quran shown.
import { describe, expect, it } from "vitest";
import { emptyAdhkarLog } from "../src/faith/adhkar.ts";
import { emptyFridayLog } from "../src/faith/friday.ts";
import { sampleLearn as seedLearn, TRADING_ID } from "./fixtures/learn.ts";
import { addOwnDua, emptyModeLog, modeWindows, setPlace, setStudyAfter, startTimer, type ModeLog } from "../src/modes/modes.ts";
import { defOf, waitingNow, type ModeDef } from "../src/modes/registry.ts";
import { modesCollection } from "../src/sync/collections.ts";
import { reminderTarget } from "../src/reminders/plan.ts";
import { DUBAI } from "./fixtures/places.ts";
import { addDays, dayTimes } from "../src/prayer/times.ts";
import { duaSheet, modePrompts, modeView, modesListView, occasionOf, studyView, type ModesModel } from "../src/ui/modesView.ts";
import type { Meaning } from "../src/faith/meaning.ts";
import type { AdhkarShow } from "../src/settings.ts";

const days = Array.from({ length: 11 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 21 }, i), "Dubai"));
const friday = days[2];
const saturday = days[3];
const def = (id: string) => defOf(id) as ModeDef;

function model(now: Date, log: ModeLog = emptyModeLog(), dayIndex = 2): ModesModel {
  const learn = seedLearn();
  const base = { log, friday: emptyFridayLog(), adhkar: emptyAdhkarLog(), learn, now, today: days[dayIndex].date };
  return { ...base, tz: "Asia/Dubai", day: days[dayIndex], removeArmed: null,
    open: modeWindows(days, now, log, learn.tracks.map((t) => t.id)), waiting: waitingNow({ ...base, days }) };
}

describe("the prompt on Home", () => {
  const onFriday = new Date(friday.dhuhr.getTime() - 3_600_000);

  it("asks for Al-Kahf by name on Friday, and picks it up", () => {
    const html = modePrompts(model(onFriday));
    expect(html).toContain("JUMU&#39;AH");
    expect(html).toContain("Surah Al-Kahf");
    expect(html).toContain("12 pages, p. 293 to 304");
    expect(html).toContain('data-action="mode-pick" data-value="jumuah"');
    expect(html).toContain('data-action="mode-not-now"');
  });

  it("says how far the user has got", () => {
    const log = setPlace(emptyModeLog(), "18-2026-10-23", 297, 1);
    expect(modePrompts(model(onFriday, log))).toContain("On p. 297, 7 pages to go");
  });

  it("is nothing when nothing waits", () => {
    expect(modePrompts(model(new Date(days[6].dhuhr.getTime() + 60_000), emptyModeLog(), 6))).toBe("");
  });

  it("names what else is open at the same time", () => {
    const html = modePrompts(model(new Date(friday.fajr.getTime() + 60_000)));
    expect(html).toContain("FAJR");
    expect(html).toContain("Also now: Jumu&#39;ah");
  });
});

describe("a mode's screen", () => {
  const inFajr = new Date(saturday.fajr.getTime() + 60_000);

  it("shows du'a words from the data, and only names the ayat", () => {
    const html = modeView(def("fajr"), model(inFajr, emptyModeLog(), 3), "", "", "");
    expect(html).toContain("Al-Baqara 255. Read it from the mushaf");
    expect(html).toContain("Read it on p. 42");
    expect(html).toContain('data-action="mode-count"');
    expect(html).toContain('data-action="mode-quran" data-value="kursi"');
    expect(html).toContain("Sunrise");
    expect(html).toContain('data-go="adhkar:morning"');
    expect(html).not.toContain("الْقَيُّومُ");
  });

  it("escapes what the user wrote", () => {
    const log = addOwnDua(emptyModeLog(), "fajr", "<img src=x>", "<script>alert(1)</script>", 1, "d-1");
    const html = modeView(def("fajr"), model(inFajr, log, 3), "", "", "");
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("YOUR DU&#39;AS");
    expect(html).toContain('data-action="mode-dua-remove" data-value="d-1"');
  });

  it("says when Jumu'ah opens, and offers no tick before it", () => {
    const m = model(new Date(days[6].dhuhr.getTime()), emptyModeLog(), 6);
    expect(occasionOf(m, "jumuah")).toBeNull();
    const html = modeView(def("jumuah"), m, "", "", "");
    expect(html).toContain("This opens at Maghrib on Thursday");
    expect(html).toContain('data-action="mode-read"');
    expect(html).toContain('aria-disabled="true"');
  });

  it("keeps the reading button loud only until Al-Kahf is ticked", () => {
    const onFriday = new Date(friday.dhuhr.getTime() - 3_600_000);
    const open = model(onFriday);
    expect(modeView(def("jumuah"), open, "", "", "")).toContain('class="pill solid" data-action="mode-read"');
    const ticked = { ...open, friday: { ...open.friday, days: { [friday.date]: { kahf: true } } } } as ModesModel;
    const html = modeView(def("jumuah"), ticked, "", "", "");
    expect(html).toContain('class="pill" data-action="mode-read"');
    expect(html).not.toContain('class="pill solid" data-action="mode-read"');
  });

  it("has a sheet with a label and a limit on each field", () => {
    const html = duaSheet(def("fajr"));
    expect(html).toContain('for="md-name"');
    expect(html).toContain('for="md-text"');
    expect(html).toMatch(/maxlength="\d+"/);
    expect(html).toContain("data-sheet-error");
  });
});

describe("the list of modes", () => {
  it("has worship, worldly and Islamic knowledge, and says how each opens", () => {
    const log = setStudyAfter(emptyModeLog(), TRADING_ID, "isha", 1);
    const html = modesListView(model(new Date(friday.dhuhr.getTime() - 3_600_000), log), "", "", "");
    expect(html).toContain("WORSHIP");
    expect(html).toContain("WORLDLY KNOWLEDGE");
    expect(html).toContain("ISLAMIC KNOWLEDGE");
    expect(html).toContain("When you need it");
    expect(html).toContain("Trading");
    expect(html).toContain("By itself, after Isha");
    expect(html).toContain("NOW");
  });
});

describe("a study", () => {
  const afterIsha = new Date(saturday.isha.getTime() + 60_000);
  const track = () => seedLearn().tracks.find((t) => t.id === TRADING_ID)!;

  it("offers Start, the next item, and when it comes up", () => {
    const html = studyView(track(), model(afterIsha, setStudyAfter(emptyModeLog(), TRADING_ID, "isha", 1), 3), "", "", "");
    expect(html).toContain('data-action="mode-timer-start"');
    expect(html).toContain("Sara Example");
    expect(html).toContain('data-field="mode-study-after"');
    expect(html).toContain('value="isha" selected');
  });

  it("shows the time while it runs", () => {
    const log = startTimer(emptyModeLog(), TRADING_ID, afterIsha.getTime() - 25 * 60_000);
    const html = studyView(track(), model(afterIsha, log, 3), "", "", "");
    expect(html).toContain("25 min");
    expect(html).toContain('data-action="mode-timer-stop"');
  });
});

describe("syncing the modes", () => {
  const log = addOwnDua(setPlace(startTimer(emptyModeLog(), "t1", 9), "18-2026-10-30", 297, 5), "fajr", "a", "b", 1, "d-1");

  it("sends counts, places and du'as, never the timer, and takes this device's timer back", () => {
    const records = modesCollection.toRecords(log);
    expect(records.map((r) => r.kind).sort()).toEqual(["modes.dua", "modes.place"]);
    const back = modesCollection.fromRecords(records, log);
    expect(back.places).toEqual(log.places);
    expect(back.duas).toEqual(log.duas);
    expect(back.timer).toEqual(log.timer);
  });

  it("keeps the higher of two devices' counts, and the later place", () => {
    const merge = modesCollection.merge!;
    expect(merge("modes.day", { fajr: { ten: 4, a: 1 } }, { fajr: { ten: 7 }, maghrib: { b: 2 } }))
      .toEqual({ fajr: { ten: 7, a: 1 }, maghrib: { b: 2 } });
    expect(merge("modes.place", { page: 297, at: 9 }, { page: 300, at: 5 })).toEqual({ page: 297, at: 9 });
    expect(merge("modes.study", { after: "asr", at: 1 }, { after: "isha", at: 5 })).toEqual({ after: "isha", at: 5 });
  });
});

describe("the du'a after the salam, with its meaning", () => {
  const inFajr = new Date(saturday.fajr.getTime() + 60_000);
  const credit = { both: "A made-up source", sound: "A made-up source", meaning: "A made-up source" };
  const said: Meaning = { kind: "text", transliteration: "Made-up <b>saying</b>", translation: "A made-up meaning", credit,
    wholeAyah: false };
  const withMeanings = (show: AdhkarShow, log = emptyModeLog()): ModesModel =>
    ({ ...model(inFajr, log, 3), show, duaMeanings: { istighfar: said, "la-mani": { kind: "pending" }, istikhara: null } });
  const ALL: AdhkarShow = { arabic: true, sound: true, meaning: true };

  it("puts the toggles above the steps, and the meaning under the du'a's Arabic", () => {
    const html = modeView(def("fajr"), withMeanings(ALL), "", "", "");
    expect(html.indexOf('data-action="adhkar-show"')).toBeLessThan(html.indexOf("dhikr-list"));
    const card = html.slice(html.indexOf('data-step="istighfar"'), html.indexOf('data-step="la-mani"'));
    expect(card.indexOf("dhikr-ar")).toBeLessThan(card.indexOf("dhikr-say"));
    expect(card).toContain("Made-up &lt;b&gt;saying&lt;/b&gt;");
    expect(card).toContain('lang="en"');
    expect(html).toContain("Getting the translation");
    expect(html).toContain('data-meaning-credits');
    expect(html).toContain("A made-up source");
  });

  it("hides the app's Arabic when it is turned off, but never the user's own words", () => {
    const log = addOwnDua(emptyModeLog(), "fajr", "Mine", "My own words", 1, "d-1");
    const html = modeView(def("fajr"), withMeanings({ ...ALL, arabic: false }, log), "", "", "");
    const card = html.slice(html.indexOf('data-step="istighfar"'), html.indexOf('data-step="la-mani"'));
    expect(card).not.toContain("dhikr-ar");
    expect(html).toContain("My own words");
    // One still waiting for its translation keeps its Arabic, so it has words to say.
    const waiting = html.slice(html.indexOf('data-step="la-mani"'), html.indexOf('data-step="la-hawla"'));
    expect(waiting).toContain("dhikr-ar");
    expect(waiting).toContain("data-fallback");
  });

  it("has no toggles where no du'a has a meaning to show", () => {
    expect(modeView(def("istikhara"), withMeanings(ALL), "", "", "")).not.toContain('data-action="adhkar-show"');
    expect(modeView(def("jumuah"), withMeanings(ALL), "", "", "")).not.toContain('data-action="adhkar-show"');
    // The Arabic shows there whatever the toggles say elsewhere.
    expect(modeView(def("istikhara"), withMeanings({ ...ALL, arabic: false }), "", "", "")).toContain("dhikr-ar");
  });

  it("draws as before without any meanings", () => {
    expect(modeView(def("fajr"), model(inFajr, emptyModeLog(), 3), "", "", "")).not.toContain("dhikr-meaning");
  });
});

describe("a tapped reminder", () => {
  it("opens its mode", () => {
    const id = (slot: number) => 20261023 * 10 + slot;
    expect(reminderTarget(id(7))).toBe("mode:jumuah");
    expect(reminderTarget(id(8))).toBe("mode:jumuah");
    expect(reminderTarget(id(0))).toBe("mode:fajr");
    expect(reminderTarget(id(5))).toBe("mode:fajr");
    expect(reminderTarget(id(3))).toBe("mode:maghrib");
    expect(reminderTarget(id(6))).toBe("adhkar:evening");
    expect(reminderTarget(id(1))).toBeNull();
    expect(reminderTarget(5)).toBeNull();
  });
});
