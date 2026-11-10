// Food's log: meals in and out, what is typed read strictly, a day's totals, a packet's portion, and a saved log read
// back whatever state it is in. The meals are made up.
import { describe, expect, it } from "vitest";
import {
  MEALS_MAX, addMeal, checkFood, dayTotal, emptyFood, isMealPhoto, lastDays, mealsOn, parseGrams, parseKcal, parseKcalGoal,
  parseProteinGoal, photosInUse, portion, removeMeal, setGoal, staleMealPhotos, validMeal, type Meal,
} from "../src/food/food.ts";
import { foodCollection } from "../src/sync/collections.ts";

const meal = (change: Partial<Meal> = {}): Meal => ({ id: "m1", day: "2026-11-10", at: 1_800_000_000_000, name: "Rice and chicken",
  kcal: 650, protein: 42, carbs: 70, fat: 18, photo: null, source: "typed", ...change });

describe("a meal", () => {
  it("is added newest first, and one with the same id takes the other's place", () => {
    let log = addMeal(emptyFood(), meal());
    log = addMeal(log, meal({ id: "m2", at: 1_800_000_100_000, name: "Dates" }));
    log = addMeal(log, meal({ id: "m0", day: "2026-11-09", name: "Soup" }));
    expect(log.meals.map((m) => m.id)).toEqual(["m2", "m1", "m0"]);
    expect(addMeal(log, meal({ kcal: 700 })).meals.filter((m) => m.id === "m1")).toEqual([meal({ kcal: 700 })]);
  });

  it("is refused, the log untouched, when any part is not a meal's", () => {
    const log = addMeal(emptyFood(), meal());
    const bad: Partial<Meal>[] = [{ name: "  " }, { kcal: -1 }, { kcal: 12.5 }, { kcal: 10_001 }, { protein: -1 }, { fat: 1001 },
      { day: "2026-02-30" }, { at: 0 }, { id: "a b" }, { photo: "covers/x.jpg" }, { photo: "meals/../x.jpg" },
      { source: "guess" as never }, { carbs: Number.NaN }];
    for (const change of bad) expect(addMeal(log, meal({ id: "m9", ...change }))).toBe(log);
    expect(validMeal(null)).toBe(false);
  });

  it("has its name cleaned and its grams kept to one decimal", () => {
    const log = addMeal(emptyFood(), meal({ name: `  Lentil${String.fromCharCode(0x200b)} soup\n `, protein: 12.34 }));
    expect(log.meals[0].name).toBe("Lentil soup");
    expect(log.meals[0].protein).toBe(12.3);
  });

  it("is removed by its id", () => {
    const log = addMeal(addMeal(emptyFood(), meal()), meal({ id: "m2" }));
    expect(removeMeal(log, "m1").meals.map((m) => m.id)).toEqual(["m2"]);
    expect(removeMeal(log, "none").meals).toHaveLength(2);
  });

  it("lets go of the oldest once the log is full", () => {
    const full = { ...emptyFood(), meals: Array.from({ length: MEALS_MAX }, (_, i) => meal({ id: `x${i}`, at: 1_800_000_000_000 - i })) };
    const log = addMeal(full, meal({ id: "new", at: 1_900_000_000_000 }));
    expect(log.meals).toHaveLength(MEALS_MAX);
    expect(log.meals[0].id).toBe("new");
    expect(log.meals.some((m) => m.id === `x${MEALS_MAX - 1}`)).toBe(false);
  });
});

describe("what is typed", () => {
  it("reads energy as a whole number, with or without a comma", () => {
    expect(parseKcal("450")).toBe(450);
    expect(parseKcal(" 1,200 ")).toBe(1200);
    expect(parseKcal("0")).toBe(0);
    for (const bad of ["", "45.5", "-3", "1e3", "0x10", "12,00", "10001", "four"]) expect(parseKcal(bad)).toBeNull();
  });

  it("reads grams with a point or a comma, an empty field as none, and anything else as wrong", () => {
    expect(parseGrams("32")).toBe(32);
    expect(parseGrams("32,5 g")).toBe(32.5);
    expect(parseGrams("  ")).toBeNull();
    for (const bad of ["-1", "1001", "3.55", "1e2", "lots"]) expect(parseGrams(bad)).toBeUndefined();
  });

  it("reads goals in range, empty as none", () => {
    expect(parseKcalGoal("2,200")).toBe(2200);
    expect(parseKcalGoal("")).toBeNull();
    expect(parseKcalGoal("200")).toBeUndefined();
    expect(parseProteinGoal("140")).toBe(140);
    expect(parseProteinGoal("5")).toBeUndefined();
    expect(setGoal(emptyFood(), { kcal: 2200, protein: 9999 }).goal).toEqual({ kcal: 2200, protein: null });
  });
});

describe("a day", () => {
  const log = [meal(), meal({ id: "m2", kcal: 200, protein: null, carbs: 30.5, fat: null }), meal({ id: "m3", day: "2026-11-08", kcal: 900 })]
    .reduce(addMeal, emptyFood());

  it("adds up what was given, a missing number adding nothing", () => {
    expect(mealsOn(log, "2026-11-10")).toHaveLength(2);
    expect(dayTotal(log, "2026-11-10")).toEqual({ day: "2026-11-10", meals: 2, kcal: 850, protein: 42, carbs: 100.5, fat: 18 });
    expect(dayTotal(log, "2026-11-01").kcal).toBe(0);
  });

  it("gives the last seven days, oldest first, empty days included", () => {
    const days = lastDays(log, "2026-11-10");
    expect(days.map((d) => d.day)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(days.map((d) => d.kcal)).toEqual([0, 0, 0, 0, 900, 0, 850]);
  });
});

describe("a portion of a packet", () => {
  const per100 = { kcal: 539, protein: 6.3, carbs: 57.5, fat: null };

  it("scales what 100 g holds to the grams eaten", () => {
    expect(portion(per100, 30)).toEqual({ kcal: 162, protein: 1.9, carbs: 17.3, fat: null });
  });

  it("is refused for no grams, or for more than a meal can hold", () => {
    for (const grams of [0, -5, Number.NaN, 5001]) expect(portion(per100, grams)).toBeNull();
    expect(portion({ ...per100, kcal: 900 }, 2000)).toBeNull();
  });
});

describe("photos", () => {
  it("are named only as meals/<id>.jpg", () => {
    expect(isMealPhoto("meals/0f8fad5b-d9cb-469f-a165-70867728950e.jpg")).toBe(true);
    for (const bad of ["meals/a.png", "meals/a/b.jpg", "covers/a.jpg", "/meals/a.jpg", "meals/.jpg", null, 4]) expect(isMealPhoto(bad)).toBe(false);
  });

  it("in use are every meal's, and only old files no meal holds can go", () => {
    const log = addMeal(emptyFood(), meal({ photo: "meals/kept.jpg" }));
    const inUse = photosInUse(log);
    expect([...inUse]).toEqual(["meals/kept.jpg"]);
    const now = 10_000_000;
    const files = [{ name: "kept.jpg", type: "file", mtime: 1 }, { name: "old.jpg", type: "file", mtime: 1 },
      { name: "new.jpg", type: "file", mtime: now - 1000 }, { name: "nodate.jpg", type: "file", mtime: undefined },
      { name: "folder.jpg", type: "directory", mtime: 1 }, { name: "notes.txt", type: "file", mtime: 1 }];
    expect(staleMealPhotos(files, inUse, now, 60_000)).toEqual(["meals/old.jpg"]);
  });
});

describe("a saved log read back", () => {
  it("is empty and whole when nothing was saved", () => {
    expect(checkFood(null)).toEqual({ log: emptyFood(), damaged: false });
  });

  it("comes back as it was saved", () => {
    const log = setGoal(addMeal(emptyFood(), meal({ photo: "meals/a1.jpg", source: "photo" })), { kcal: 2200, protein: 140 });
    expect(checkFood(JSON.stringify(log))).toEqual({ log, damaged: false });
  });

  it("keeps the good rows and says it was damaged when any had to go", () => {
    const raw = { v: 1, goal: { kcal: 50, protein: 140 }, meals: [meal(), { ...meal({ id: "m2" }), kcal: "many" }, meal()] };
    const back = checkFood(JSON.stringify(raw));
    expect(back.damaged).toBe(true);
    expect(back.log.meals.map((m) => m.id)).toEqual(["m1"]);
    expect(back.log.goal).toEqual({ kcal: null, protein: 140 });
  });

  it("is damaged, and empty, for anything that is not a log", () => {
    for (const text of ["", "{", "null", "[]", '{"v":2,"meals":[]}', '{"v":1,"meals":{}}']) {
      expect(checkFood(text)).toEqual({ log: emptyFood(), damaged: true });
    }
  });
});

describe("syncing food", () => {
  const log = setGoal([meal({ photo: "meals/a1.jpg", source: "photo" }), meal({ id: "m2", day: "2026-11-09" })].reduce(addMeal, emptyFood()),
    { kcal: 2200, protein: null });

  it("sends each meal on its own record, never the name of its photo", () => {
    const records = foodCollection.toRecords(log);
    expect(records.map((r) => `${r.kind}:${r.id}`)).toEqual(["food.goal:goal", "food.meal:m1", "food.meal:m2"]);
    expect(records.every((r) => r.kind !== "food.meal" || r.data.photo === null)).toBe(true);
    expect(foodCollection.toRecords(emptyFood())).toEqual([]);
  });

  it("comes back whole, a meal keeping the photo this device already holds for it", () => {
    const records = foodCollection.toRecords(log).map((r) => ({ ...r, updated: 1 }));
    expect(foodCollection.fromRecords(records as never, log)).toEqual(log);
    const elsewhere = foodCollection.fromRecords(records as never, emptyFood());
    expect(elsewhere.meals.map((m) => m.photo)).toEqual([null, null]);
    expect(elsewhere.goal).toEqual(log.goal);
  });

  it("drops a record from another device that is not a meal", () => {
    const records = [{ kind: "food.meal", id: "m7", data: { ...meal(), kcal: -4 }, updated: 1 },
      { kind: "food.meal", id: "m8", data: { ...meal(), photo: "meals/../../x.jpg" }, updated: 1 }];
    expect(foodCollection.fromRecords(records as never, emptyFood()).meals.map((m) => m.id)).toEqual(["m8"]);
    expect(foodCollection.fromRecords(records as never, emptyFood()).meals[0].photo).toBeNull();
  });
});
