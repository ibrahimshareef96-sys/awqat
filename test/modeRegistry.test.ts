// What is in each Islamic mode, and what waits on Home. Nothing of the Quran is ever in a mode's words.
import { describe, expect, it } from "vitest";
import { emptyAdhkarLog } from "../src/faith/adhkar.ts";
import { DUAS } from "../src/faith/duaData.ts";
import { emptyFridayLog, toggleFriday, FRIDAY_ITEMS } from "../src/faith/friday.ts";
import { logSession } from "../src/learn/learn.ts";
import { sampleLearn as seedLearn, TRADING_ID } from "./fixtures/learn.ts";
import { addOwnDua, emptyModeLog, setNotNow, setStep, setStudyAfter } from "../src/modes/modes.ts";
import { defOf, nextStep, stepProgress, stepsOf, waitingNow, type ModeDef } from "../src/modes/registry.ts";
import { DUBAI } from "./fixtures/places.ts";
import { addDays, dayTimes } from "../src/prayer/times.ts";

const days = Array.from({ length: 11 }, (_, i) => dayTimes(DUBAI, addDays({ y: 2026, m: 10, d: 21 }, i), "Dubai"));
const friday = days[2];
const saturday = days[3];
const def = (id: string) => defOf(id) as ModeDef;
const base = { log: emptyModeLog(), friday: emptyFridayLog(), adhkar: emptyAdhkarLog() };
const waiting = (now: Date, over: Partial<Parameters<typeof waitingNow>[0]> = {}) => waitingNow({
  days, now, ...base, learn: seedLearn(), today: "2026-10-24", ...over }).map((w) => w.mode);

describe("the dhikr after each prayer", () => {
  it.each(["dhuhr", "asr", "isha"])("%s has the dhikr after the salam, and the last three surahs once", (id) => {
    const steps = stepsOf(def(id), emptyModeLog());
    expect(steps.map((s) => s.id)).toEqual(["istighfar", "la-mani", "la-hawla", "tasbih", "kursi", "quls"]);
    expect(stepProgress(id as "dhuhr", steps[5], { ...base, date: saturday.date }).of).toBe(1);
  });

  it("counts the tasbih to a hundred, here and after Fajr and Maghrib", () => {
    for (const id of ["dhuhr", "fajr", "maghrib"]) {
      const step = stepsOf(def(id), emptyModeLog()).find((s) => s.id === "tasbih");
      expect(stepProgress(id as "dhuhr", step as never, { ...base, date: saturday.date }).of).toBe(100);
    }
  });

  it("keeps three times for the last three surahs and ten for the tahlil, after Fajr and Maghrib only", () => {
    const quls = stepsOf(def("fajr"), emptyModeLog()).find((s) => s.id === "quls");
    expect(stepProgress("fajr", quls as never, { ...base, date: saturday.date }).of).toBe(3);
    expect(stepsOf(def("fajr"), emptyModeLog()).some((s) => s.id === "ten")).toBe(true);
    expect(stepsOf(def("isha"), emptyModeLog()).some((s) => s.id === "ten")).toBe(false);
  });

  it("waits on Home once the iqama has passed, and not once it is all said", () => {
    const now = new Date(saturday.dhuhr.getTime() + 30 * 60_000);
    expect(waiting(now)).toContain("dhuhr");
    const log = stepsOf(def("dhuhr"), emptyModeLog()).reduce((l, s) => setStep(l, saturday.date, "dhuhr", s.id,
      stepProgress("dhuhr", s, { ...base, date: saturday.date }).of), emptyModeLog());
    expect(waiting(now, { log })).not.toContain("dhuhr");
  });
});

describe("pages drawn from a picture", () => {
  it("ship in no mode: a printed page belongs to whoever adds it, with its own licence", () => {
    for (const id of ["fajr", "dhuhr", "asr", "maghrib", "isha", "jumuah"]) {
      expect(stepsOf(def(id), emptyModeLog()).some((s) => s.kind === "page")).toBe(false);
    }
  });

  it("leaves Fajr going from the morning adhkar straight to the wait for sunrise", () => {
    const ids = stepsOf(def("fajr"), emptyModeLog()).map((s) => s.id);
    expect(ids.indexOf("sit")).toBe(ids.indexOf("morning") + 1);
  });
});

describe("the modes' words", () => {
  it("has every du'a it names, from the generated data", () => {
    const words = ["fajr", "maghrib", "istikhara"].flatMap((id) => stepsOf(def(id), base.log))
      .filter((s) => s.kind === "dua");
    expect(words.length).toBeGreaterThan(5);
    for (const s of words) expect(DUAS.some((d) => d.text === s.text)).toBe(true);
  });

  it("shows no ayah: the data has none of the surahs or Ayat al-Kursi it sends the user to", () => {
    for (const d of DUAS) {
      expect(d.text).not.toContain("الْقَيُّومُ");
      expect(d.text).not.toContain("أَحَدٌ");
      expect(d.text).not.toContain("﴿");
    }
  });

  it("opens the mushaf at the right pages for what it counts", () => {
    const pages = Object.fromEntries(stepsOf(def("fajr"), base.log).flatMap((s) =>
      (s.kind === "quran" ? [[s.id, s.page]] : [])));
    expect(pages).toEqual({ kursi: 42, quls: 604 });
  });

  it("carries the Istikhara's words and says where to name the matter", () => {
    const step = stepsOf(def("istikhara"), base.log).find((s) => s.kind === "dua");
    expect(step).toMatchObject({ source: "Bukhari 1166" });
    expect(step?.kind === "dua" && step.hint).toContain("hadha al-amr");
  });

  it("names Tirmidhi 586's two gradings, not one", () => {
    const sit = stepsOf(def("fajr"), base.log).find((s) => s.id === "sit");
    expect(sit?.kind === "sunnah" && sit.source).toMatch(/Hasan gharib.*da'if/);
  });
});

describe("how far a step has got", () => {
  const date = "2026-10-23";

  it("reads Friday's ticks from the Friday log", () => {
    const ticked = toggleFriday(emptyFridayLog(), date, "kahf");
    const kahf = def("jumuah").groups[0].steps[0];
    expect(stepProgress("jumuah", kahf, { ...base, date }).n).toBe(0);
    expect(stepProgress("jumuah", kahf, { ...base, friday: ticked, date }).n).toBe(1);
  });

  it("counts nothing with no occasion open", () => {
    const steps = stepsOf(def("fajr"), base.log);
    const ticked = setStep(base.log, date, "fajr", "ten", 10);
    const ten = steps.find((s) => s.id === "ten");
    expect(ten && stepProgress("fajr", ten, { ...base, log: ticked, date: null }).n).toBe(0);
    expect(ten && stepProgress("fajr", ten, { ...base, log: ticked, date })).toEqual({ n: 10, of: 10 });
  });

  it("picks up at the first step not done, ending with the user's own du'as", () => {
    const log = addOwnDua(base.log, "istikhara", "Mine", "words", 1, "d-1");
    const ctx = (l = log) => ({ ...base, log: l, date });
    expect(nextStep(def("istikhara"), ctx())?.id).toBe("two");
    const two = setStep(log, date, "istikhara", "two", 1);
    expect(nextStep(def("istikhara"), ctx(two))?.id).toBe("istikhara");
    const dua = setStep(two, date, "istikhara", "istikhara", 1);
    expect(nextStep(def("istikhara"), ctx(dua))?.id).toBe("d-1");
    expect(nextStep(def("istikhara"), ctx(setStep(dua, date, "istikhara", "d-1", 1)))).toBeNull();
  });
});

describe("what waits on Home", () => {
  const nearMaghrib = new Date(friday.maghrib.getTime() - 60_000);
  const inMaghrib = new Date(saturday.maghrib.getTime() + 60_000);

  it("asks for Jumu'ah until every item is ticked", () => {
    expect(waiting(nearMaghrib)).toContain("jumuah");
    const all = FRIDAY_ITEMS.reduce((log, item) => toggleFriday(log, "2026-10-23", item), emptyFridayLog());
    expect(waiting(nearMaghrib, { friday: all })).not.toContain("jumuah");
  });

  it("stays away after Not now, for that occasion only", () => {
    const log = setNotNow(emptyModeLog(), "2026-10-24", "maghrib");
    expect(waiting(inMaghrib)).toEqual(["maghrib"]);
    expect(waiting(inMaghrib, { log })).toEqual([]);
    const nextDay = new Date(days[4].maghrib.getTime() + 60_000);
    expect(waiting(nextDay, { log, today: "2026-10-25" })).toEqual(["maghrib"]);
  });

  it("asks for a study set to come after Isha, until it was studied today", () => {
    const afterIsha = new Date(saturday.isha.getTime() + 60_000);
    const study = `study:${TRADING_ID}`;
    const isha = setStudyAfter(emptyModeLog(), TRADING_ID, "isha", 1);
    expect(waiting(afterIsha)).toEqual([]);
    expect(waiting(afterIsha, { log: isha })).toEqual([study]);
    const logged = logSession(seedLearn(), { trackId: TRADING_ID, itemId: null, minutes: 30, note: "" }, "2026-10-24").learn;
    expect(waiting(afterIsha, { learn: logged, log: isha })).toEqual([]);
    expect(waiting(afterIsha, { log: setStudyAfter(isha, TRADING_ID, "off", 2) })).toEqual([]);
  });

  it("does not ask again past midnight for what was studied before it", () => {
    const afterIsha = new Date(saturday.isha.getTime() + 60_000);
    const isha = setStudyAfter(emptyModeLog(), TRADING_ID, "isha", 1);
    const logged = logSession(seedLearn(), { trackId: TRADING_ID, itemId: null, minutes: 30, note: "" }, "2026-10-24").learn;
    expect(waiting(afterIsha, { learn: logged, log: isha, today: "2026-10-25" })).toEqual([]);
  });
});
