// Food on screen: today's numbers against the user's own goals, the form in each of its states, and nothing shown
// unescaped. The meals are made up.
import { describe, expect, it } from "vitest";
import { addMeal, emptyFood, setGoal, type Meal } from "../src/food/food.ts";
import { emptyDraft, withPacket } from "../src/food/draft.ts";
import { foodCard, foodFact, mealLine, type FoodModel } from "../src/ui/foodView.ts";

const meal = (change: Partial<Meal> = {}): Meal => ({ id: "m1", day: "2026-11-10", at: Date.UTC(2026, 10, 10, 9, 30), name: "Rice and chicken",
  kcal: 650, protein: 42, carbs: 70.5, fat: null, photo: null, source: "typed", ...change });
const model = (change: Partial<FoodModel> = {}): FoodModel => ({ log: emptyFood(), today: "2026-11-10", tz: "Asia/Dubai", draft: null, armed: null,
  busy: false, native: true, server: false, photoSrc: (name) => (name ? `/files/${name}` : null), ...change });
const PACKET = { code: "3017620422003", name: "Hazelnut spread", serving: 15, per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9 } };

describe("the food card", () => {
  it("starts at zero with the form, and no bars or goal lines", () => {
    const html = foodCard(model());
    expect(html).toContain("0 <span class=\"soft\">kcal today</span>");
    expect(html).toContain('data-form="meal-add"');
    expect(html).not.toContain('class="bars"');
    expect(html).not.toContain("to your goal");
  });

  it("adds up today, lists its meals with only the numbers given, and draws the week", () => {
    const log = [meal(), meal({ id: "m2", name: "Dates", kcal: 120, protein: null, carbs: null }), meal({ id: "m0", day: "2026-11-08", kcal: 900 })]
      .reduce(addMeal, emptyFood());
    const html = foodCard(model({ log }));
    expect(html).toContain("770 <span");
    expect(html).toContain("2 meals today");
    expect(html).toContain("650 kcal · 42 g protein · 70.5 g carbs");
    expect(html).toContain("120 kcal</span>");
    expect(html).toContain('aria-label="Sunday: 900 kcal"');
    expect(html).toContain('aria-label="Monday: nothing logged"');
  });

  it("says how far the user's own goals are, and when one is met, without a verdict", () => {
    const log = setGoal(addMeal(emptyFood(), meal()), { kcal: 2200, protein: 40 });
    const html = foodCard(model({ log }));
    expect(html).toContain("Energy: 1,550 kcal to your goal of 2,200");
    expect(html).toContain("Protein: Your goal of 40 g is met");
    expect(html).toContain('data-w="29"');
    expect(html).not.toMatch(/over|too much|bad|great|well done/i);
  });

  it("shows the photo on the form, with Estimate only where a server is set", () => {
    const draft = { ...emptyDraft(), photo: "meals/p1.jpg", name: "Soup" };
    const without = foodCard(model({ draft }));
    expect(without).toContain('src="/files/meals/p1.jpg"');
    expect(without).toContain("This photo stays on your phone.");
    expect(without).toContain("Retake the photo");
    expect(without).not.toContain("meal-estimate");
    expect(foodCard(model({ draft, server: true }))).toContain('data-action="meal-estimate"');
    expect(foodCard(model({ draft: { ...draft, estimated: true }, server: true }))).toContain("Check it before you log it");
  });

  it("asks only for the grams of a scanned packet, and says what they come to", () => {
    const html = foodCard(model({ draft: { ...withPacket(emptyDraft(), PACKET), grams: "30" } }));
    expect(html).toContain('name="grams"');
    expect(html).not.toContain('id="meal-kcal"');
    expect(html).toContain("Per 100 g: 539 kcal · 6.3 g protein · 57.5 g carbs · 30.9 g fat · one serving is 15 g");
    expect(html).toContain("30 g comes to 162 kcal");
    expect(html).toContain("From Open Food Facts");
    expect(html).not.toContain("meal-estimate");
  });

  it("has no camera or scanner buttons in a browser, and turns its buttons off while busy", () => {
    expect(foodCard(model({ native: false }))).not.toContain("meal-photo");
    expect(foodCard(model({ busy: true }))).toMatch(/data-action="meal-scan" disabled/);
  });

  it("arms a meal's Remove, and labels it by the meal", () => {
    const log = addMeal(emptyFood(), meal());
    expect(foodCard(model({ log }))).toContain('aria-label="Remove: Rice and chicken"');
    expect(foodCard(model({ log, armed: "m1" }))).toContain("Tap again to remove");
  });

  it("escapes everything a meal, a packet or a draft carries", () => {
    const nasty = `<img src=x onerror=alert(1)>"'`;
    const log = addMeal(emptyFood(), meal({ name: nasty }));
    const html = foodCard(model({ log, draft: { ...withPacket(emptyDraft(), { ...PACKET, name: nasty }), grams: nasty } }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain(`value="${nasty}`);
  });
});

describe("food's lines elsewhere", () => {
  it("gives a meal's numbers in one line", () => {
    expect(mealLine({ kcal: 1200, protein: 30, carbs: null, fat: 10.5 })).toBe("1,200 kcal · 30 g protein · 10.5 g fat");
  });

  it("gives Home a fact only once something is logged today", () => {
    expect(foodFact(emptyFood(), "2026-11-10")).toBe("");
    const log = addMeal(emptyFood(), meal());
    expect(foodFact(log, "2026-11-10")).toBe("Food 650 kcal");
    expect(foodFact(setGoal(log, { kcal: 2200, protein: null }), "2026-11-10")).toBe("Food 650 of 2,200 kcal");
    expect(foodFact(log, "2026-11-11")).toBe("");
  });
});
