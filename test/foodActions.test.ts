// @vitest-environment happy-dom
// Food's flow with the camera, the scanner, Open Food Facts and the user's server stood in for: what is typed survives
// a photo or a scan, a photo leaves the phone only on the Estimate tap, a late answer is let go, and files are deleted
// only when nothing holds them. The meals are made up.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(async () => true), native: true,
  photo: vi.fn(), base64: vi.fn(), removePhoto: vi.fn(async () => undefined), removeUnused: vi.fn(async () => 0), scan: vi.fn(),
  find: vi.fn(), estimate: vi.fn(), session: vi.fn(),
}));
vi.mock("../src/store.ts", () => ({ KEYS: { food: "food", body: "body" }, write: mocks.write, read: vi.fn(), keepAside: vi.fn() }));
vi.mock("../src/device.ts", () => ({ isNative: () => mocks.native }));
vi.mock("../src/food/phone.ts", () => ({
  mealPhoto: mocks.photo, mealPhotoBase64: mocks.base64, mealPhotoSrc: (name: string | null) => (name ? `/files/${name}` : null),
  removeMealPhoto: mocks.removePhoto, removeUnusedMealPhotos: mocks.removeUnused, scanPacket: mocks.scan,
}));
vi.mock("../src/food/packet.ts", async (original) => ({ ...(await original<typeof import("../src/food/packet.ts")>()), findPacket: mocks.find }));
vi.mock("../src/food/estimate.ts", async (original) => ({ ...(await original<typeof import("../src/food/estimate.ts")>()), estimateMeal: mocks.estimate }));
vi.mock("../src/talk/session.ts", async (original) => ({ ...(await original<typeof import("../src/talk/session.ts")>()), readSession: mocks.session }));

import { emptyFood } from "../src/food/food.ts";
import { emptyDraft, mealFromDraft, withFields, withPacket } from "../src/food/draft.ts";
import { hooks, state } from "../src/app/state.ts";
import * as food from "../src/app/foodActions.ts";

const WORKER = "https://worker.example";
const TOKEN = "a".repeat(43);
const PACKET = { code: "3017620422003", name: "Hazelnut spread", serving: 15, per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9 } };

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** The form as it is on screen, with something typed into it. */
function typeOnScreen(fields: Record<string, string>): void {
  document.body.innerHTML = `<div id="live"></div><form data-form="meal-add">${Object.entries(fields).map(([name, value]) =>
    `<input name="${name}" value="${value}">`).join("")}</form>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = true;
  mocks.write.mockResolvedValue(true);
  mocks.photo.mockResolvedValue("meals/p1.jpg");
  mocks.base64.mockResolvedValue("/9j/AAAA");
  mocks.scan.mockResolvedValue({ code: PACKET.code });
  mocks.find.mockResolvedValue({ found: PACKET });
  mocks.session.mockResolvedValue({ worker: WORKER, token: TOKEN });
  mocks.estimate.mockResolvedValue({ estimate: { name: "Chicken wrap", kcal: 512, protein: 31, carbs: null, fat: 18 } });
  state.food = emptyFood();
  state.foodDraft = null;
  state.mealRemoveArmed = null;
  state.busy = false;
  state.notice = "";
  state.blocked.clear();
  state.settings = { ...state.settings, voiceUrl: WORKER };
  hooks.render = vi.fn();
  hooks.renderOverlay = vi.fn();
  document.body.innerHTML = `<div id="live"></div>`;
});

describe("a meal on the form, turned into a meal", () => {
  it("needs a name and whole kcal; grams may be empty but never wrong", () => {
    const typed = { ...emptyDraft(), name: "Rice", kcal: "450", protein: "12,5" };
    expect(mealFromDraft(typed, "m1", "2026-11-10", 5)).toEqual({ meal: { id: "m1", day: "2026-11-10", at: 5, name: "Rice", kcal: 450,
      protein: 12.5, carbs: null, fat: null, photo: null, source: "typed" } });
    expect(mealFromDraft({ ...typed, name: " " }, "m1", "2026-11-10", 5)).toEqual({ problem: "name" });
    expect(mealFromDraft({ ...typed, kcal: "a lot" }, "m1", "2026-11-10", 5)).toEqual({ problem: "kcal" });
    expect(mealFromDraft({ ...typed, fat: "some" }, "m1", "2026-11-10", 5)).toEqual({ problem: "grams" });
  });

  it("from a packet is the grams eaten of what 100 g holds, whatever the other fields say", () => {
    const draft = { ...withPacket(emptyDraft(), PACKET), kcal: "9999" };
    expect(draft.grams).toBe("15");
    const result = mealFromDraft({ ...draft, grams: "30" }, "m1", "2026-11-10", 5);
    expect("meal" in result && result.meal).toMatchObject({ name: "Hazelnut spread", kcal: 162, protein: 1.9, source: "barcode" });
    for (const grams of ["", "0", "lots"]) expect(mealFromDraft({ ...draft, grams }, "m1", "2026-11-10", 5)).toEqual({ problem: "amount" });
  });

  it("with a photo is marked as one, and a field the form lacks keeps the draft's own", () => {
    const draft = withFields({ ...emptyDraft(), photo: "meals/p1.jpg", grams: "40" }, (name) => (name === "name" ? "Soup" : name === "kcal" ? "180" : null));
    expect(draft.grams).toBe("40");
    const result = mealFromDraft(draft, "m1", "2026-11-10", 5);
    expect("meal" in result && result.meal).toMatchObject({ photo: "meals/p1.jpg", source: "photo", kcal: 180 });
  });
});

describe("logging a meal", () => {
  it("saves it for today and clears the form", async () => {
    await food.logMeal(form({ name: "Rice and chicken", kcal: "650", protein: "42", carbs: "", fat: "" }));
    expect(state.food.meals).toHaveLength(1);
    expect(state.food.meals[0]).toMatchObject({ name: "Rice and chicken", kcal: 650, protein: 42, carbs: null, source: "typed" });
    expect(state.foodDraft).toBeNull();
    expect(mocks.write).toHaveBeenCalledWith("food", state.food);
  });

  it("says what to correct and keeps what was typed", async () => {
    await food.logMeal(form({ name: "Rice", kcal: "lots", protein: "", carbs: "", fat: "" }));
    expect(state.food.meals).toHaveLength(0);
    expect(state.notice).toBe(food.FOOD_MESSAGES.kcal);
    expect(state.foodDraft).toMatchObject({ name: "Rice", kcal: "lots" });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("logs once however fast Log it is tapped twice", async () => {
    const saved = deferred<boolean>();
    mocks.write.mockReturnValueOnce(saved.promise);
    const fields = { name: "Dates", kcal: "120", protein: "", carbs: "", fat: "" };
    const first = food.logMeal(form(fields));
    await food.logMeal(form(fields));
    saved.resolve(true);
    await first;
    expect(state.food.meals).toHaveLength(1);
  });

  it("keeps the photo taken for it with the meal", async () => {
    typeOnScreen({ name: "Soup", kcal: "", protein: "", carbs: "", fat: "" });
    await food.addPhoto("camera");
    expect(state.foodDraft).toMatchObject({ photo: "meals/p1.jpg", name: "Soup" });
    await food.logMeal(form({ name: "Soup", kcal: "180", protein: "", carbs: "", fat: "" }));
    expect(state.food.meals[0]).toMatchObject({ photo: "meals/p1.jpg", source: "photo" });
    expect(mocks.removePhoto).not.toHaveBeenCalled();
  });
});

describe("a photo", () => {
  it("replaces the one before it, whose file is deleted", async () => {
    await food.addPhoto("camera");
    mocks.photo.mockResolvedValueOnce("meals/p2.jpg");
    await food.addPhoto("camera");
    expect(state.foodDraft?.photo).toBe("meals/p2.jpg");
    expect(mocks.removePhoto).toHaveBeenCalledWith("meals/p1.jpg");
  });

  it("that was not taken changes nothing but says so", async () => {
    mocks.photo.mockResolvedValueOnce(null);
    await food.addPhoto("camera");
    expect(state.foodDraft).toBeNull();
    expect(state.notice).toBe(food.FOOD_MESSAGES.camera);
  });

  it("is deleted when the form is cleared", async () => {
    await food.addPhoto("camera");
    await food.cancelDraft();
    expect(state.foodDraft).toBeNull();
    expect(mocks.removePhoto).toHaveBeenCalledWith("meals/p1.jpg");
  });

  it("clears what was typed too, and is left alone while the camera or the scanner is still at work", async () => {
    await food.addPhoto("camera");
    typeOnScreen({ name: "Rice", kcal: "450", protein: "", carbs: "", fat: "" });
    const typedName = document.querySelector<HTMLInputElement>('input[name="name"]')!;
    typedName.value = "Rice and beans";
    state.busy = true;
    await food.cancelDraft();
    expect(state.foodDraft?.photo).toBe("meals/p1.jpg");
    expect(mocks.removePhoto).not.toHaveBeenCalled();
    state.busy = false;
    await food.cancelDraft();
    expect(typedName.value).toBe("Rice");
    expect(state.foodDraft).toBeNull();
  });

  it("retaken lets go of an estimate made from the one before", async () => {
    await food.addPhoto("camera");
    await food.estimate();
    expect(state.foodDraft?.estimated).toBe(true);
    mocks.photo.mockResolvedValueOnce("meals/p2.jpg");
    await food.addPhoto("camera");
    expect(state.foodDraft).toMatchObject({ photo: "meals/p2.jpg", estimated: false });
  });

  it("is never asked for in a browser", async () => {
    mocks.native = false;
    await food.addPhoto("camera");
    await food.scan();
    expect(mocks.photo).not.toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(state.notice).toBe(food.FOOD_MESSAGES.phoneOnly);
  });
});

describe("scanning a packet", () => {
  it("fills the form with the packet and one serving, keeping the photo already there", async () => {
    await food.addPhoto("camera");
    await food.scan();
    expect(mocks.find).toHaveBeenCalledWith(PACKET.code);
    expect(state.foodDraft).toMatchObject({ packet: PACKET, name: "Hazelnut spread", grams: "15", photo: "meals/p1.jpg" });
  });

  it("says so, and leaves the form alone, when the packet is unknown, the lookup fails, or it is no barcode", async () => {
    typeOnScreen({ name: "Bar", kcal: "200", protein: "", carbs: "", fat: "" });
    for (const [answer, message] of [[{ none: true }, food.FOOD_MESSAGES.unknown], [{ failed: true }, food.FOOD_MESSAGES.lookupFailed]] as const) {
      mocks.find.mockResolvedValueOnce(answer);
      await food.scan();
      expect(state.notice).toBe(message);
      expect(state.foodDraft).toBeNull();
    }
    mocks.scan.mockResolvedValueOnce({ notFood: true });
    await food.scan();
    expect(state.notice).toBe(food.FOOD_MESSAGES.notFood);
    mocks.scan.mockResolvedValueOnce({ failed: true });
    await food.scan();
    expect(state.notice).toBe(food.FOOD_MESSAGES.scanner);
  });

  it("does nothing at all when the scan is cancelled", async () => {
    mocks.scan.mockResolvedValueOnce({ cancelled: true });
    await food.scan();
    expect(mocks.find).not.toHaveBeenCalled();
    expect(state.notice).toBe("");
  });
});

describe("an estimate from the photo", () => {
  it("sends the photo to the user's own server with its session, and fills the form to be checked", async () => {
    await food.addPhoto("camera");
    await food.estimate();
    expect(mocks.estimate).toHaveBeenCalledWith(WORKER, TOKEN, "/9j/AAAA");
    expect(state.foodDraft).toMatchObject({ name: "Chicken wrap", kcal: "512", protein: "31", carbs: "", fat: "18", estimated: true });
    expect(state.food.meals).toHaveLength(0);
    expect(state.notice).toBe(food.FOOD_MESSAGES.estimated);
  });

  it("keeps the name the user typed over the server's", async () => {
    await food.addPhoto("camera");
    typeOnScreen({ name: "My lunch", kcal: "", protein: "", carbs: "", fat: "" });
    await food.estimate();
    expect(state.foodDraft?.name).toBe("My lunch");
  });

  it("sends nothing without a photo, without a server, or without a session for that server", async () => {
    await food.estimate();
    await food.addPhoto("camera");
    state.settings = { ...state.settings, voiceUrl: "" };
    await food.estimate();
    expect(state.notice).toBe(food.FOOD_MESSAGES.noServer);
    state.settings = { ...state.settings, voiceUrl: WORKER };
    mocks.session.mockResolvedValueOnce({ worker: "https://other.example", token: TOKEN });
    await food.estimate();
    expect(state.notice).toBe(food.FOOD_MESSAGES.signIn);
    mocks.session.mockResolvedValueOnce(null);
    await food.estimate();
    expect(mocks.base64).not.toHaveBeenCalled();
    expect(mocks.estimate).not.toHaveBeenCalled();
  });

  it("lets go of an answer that comes back after the form was cleared or the photo retaken", async () => {
    await food.addPhoto("camera");
    const slow = deferred<unknown>();
    mocks.estimate.mockReturnValueOnce(slow.promise);
    const asking = food.estimate();
    await vi.waitFor(() => expect(mocks.estimate).toHaveBeenCalled());
    state.foodDraft = { ...emptyDraft(), photo: "meals/p2.jpg" };
    slow.resolve({ estimate: { name: "Old", kcal: 1, protein: null, carbs: null, fat: null } });
    await asking;
    expect(state.foodDraft).toMatchObject({ photo: "meals/p2.jpg", kcal: "", estimated: false });
  });

  it("says why when the server is unsure, signed out, or silent", async () => {
    await food.addPhoto("camera");
    for (const [answer, message] of [[{ unsure: true }, food.FOOD_MESSAGES.unsure], [{ failed: true, signedOut: true }, food.FOOD_MESSAGES.signIn],
      [{ failed: true, signedOut: false }, food.FOOD_MESSAGES.estimateFailed]] as const) {
      mocks.estimate.mockResolvedValueOnce(answer);
      await food.estimate();
      expect(state.notice).toBe(message);
      expect(state.foodDraft?.estimated).toBe(false);
    }
  });
});

describe("removing a meal", () => {
  beforeEach(async () => {
    await food.addPhoto("camera");
    await food.logMeal(form({ name: "Soup", kcal: "180", protein: "", carbs: "", fat: "" }), 1_800_000_000_000);
    vi.clearAllMocks();
    mocks.write.mockResolvedValue(true);
  });

  it("takes two taps with a moment between, then deletes its photo once the removal is saved", async () => {
    const id = state.food.meals[0].id;
    await food.removeMealTap(id, 1000);
    expect(state.mealRemoveArmed).toBe(id);
    await food.removeMealTap(id, 1100);
    expect(state.food.meals).toHaveLength(1);
    await food.removeMealTap(id, 2000);
    expect(state.food.meals).toHaveLength(0);
    expect(mocks.removePhoto).toHaveBeenCalledWith("meals/p1.jpg");
  });

  it("keeps the photo when the removal could not be saved", async () => {
    const id = state.food.meals[0].id;
    mocks.write.mockResolvedValue(false);
    await food.removeMealTap(id, 1000);
    await food.removeMealTap(id, 2000);
    expect(mocks.removePhoto).not.toHaveBeenCalled();
  });
});

describe("the goals", () => {
  it("are saved as typed, either left empty", async () => {
    await food.saveGoal(form({ kcal: "2,200", protein: "" }));
    expect(state.food.goal).toEqual({ kcal: 2200, protein: null });
    expect(state.notice).toBe(food.FOOD_MESSAGES.saved);
  });

  it("are asked for again when out of range, nothing saved", async () => {
    await food.saveGoal(form({ kcal: "90", protein: "140" }));
    expect(state.food.goal).toEqual({ kcal: null, protein: null });
    expect(state.notice).toBe(food.FOOD_MESSAGES.goal);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("tidying photos at start-up", () => {
  it("spares every photo a meal or the form holds, and runs only when Food was read whole", async () => {
    await food.addPhoto("camera");
    await food.tidyMealPhotos(false);
    expect(mocks.removeUnused).not.toHaveBeenCalled();
    await food.tidyMealPhotos(true);
    expect([...(mocks.removeUnused.mock.calls[0] as unknown as [Set<string>])[0]]).toEqual(["meals/p1.jpg"]);
    state.blocked.add("food");
    await food.tidyMealPhotos(true);
    expect(mocks.removeUnused).toHaveBeenCalledTimes(1);
  });
});
