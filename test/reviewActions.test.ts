// @vitest-environment happy-dom
// The Weekly Review's actions: keeping this week's review from its form, refusing an empty one, ticking an intention
// from Home, reading a past week in its sheet, and keeping what was typed when the screen is left before saving.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../src/store.ts", () => ({ KEYS: { reviews: "reviews", settings: "settings" }, write: mocks.write, read: vi.fn(),
  keepAside: vi.fn() }));
vi.mock("../src/device.ts", () => ({ isNative: () => true }));
vi.mock("../src/app/schedule.ts", () => ({ freshDays: () => [] }));

import { hooks, state } from "../src/app/state.ts";
import {
  REVIEW_MESSAGES, keepReviewDraft, openPastReview, pastSheet, reviewModel, submitReview, tickIntention, weekCard,
} from "../src/app/reviewActions.ts";
import { emptyReviewLog, REVIEW_ERRORS, saveReview } from "../src/review/muhasabah.ts";
import { weekReview } from "../src/review/week.ts";
import { emptyLog } from "../src/prayer/log.ts";
import { emptyQuranLog } from "../src/quran/log.ts";
import { emptyAdhkarLog } from "../src/faith/adhkar.ts";
import { emptyLearn } from "../src/learn/learn.ts";
import { emptyBody } from "../src/body/body.ts";
import { emptyMoney } from "../src/money/money.ts";
import { DUBAI } from "./fixtures/places.ts";

/** Tuesday 3 November 2026, 09:00 in Dubai; the week began on Monday the 2nd. */
const NOW = new Date("2026-11-03T05:00:00Z");
const MON = "2026-11-02";
const numbers = weekReview({ today: "2026-11-03", prayerDay: "2026-11-03", prayersDueToday: 1, prayers: emptyLog(),
  quran: emptyQuranLog(), adhkar: emptyAdhkarLog(), learn: emptyLearn(), body: emptyBody(), health: null, money: emptyMoney() });

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(name, v);
  return data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  state.place = DUBAI;
  state.reviews = emptyReviewLog();
  state.reviewDraft = null;
  state.reviewPast = null;
  state.sheet = null;
  state.notice = "";
  state.blocked.clear();
  hooks.render = vi.fn();
  hooks.softRender = vi.fn();
  hooks.renderOverlay = vi.fn();
  hooks.reschedule = vi.fn(async () => undefined);
  document.body.innerHTML = `<div id="live"></div><div id="app"></div>`;
});

describe("keeping this week's review", () => {
  it("saves what the form holds under this week, says so, and plans the reminders again", async () => {
    await submitReview(form({ well: "Fajr at the mosque", short: "", change: "Sleep earlier", intention: ["Walk", "", ""] }));
    expect(state.reviews.reviews).toHaveLength(1);
    expect(state.reviews.reviews[0]).toMatchObject({ week: MON, well: "Fajr at the mosque", intentions: [{ text: "Walk", done: false }] });
    expect(mocks.write).toHaveBeenCalledWith("reviews", state.reviews);
    expect(state.notice).toBe(REVIEW_MESSAGES.kept);
    expect(hooks.reschedule).toHaveBeenCalled();
    expect(reviewModel(NOW, numbers)).toMatchObject({ kept: true,
      form: { well: "Fajr at the mosque", change: "Sleep earlier", intentions: ["Walk"] } });
  });

  it("refuses an empty review with a word by the button, and saves nothing", async () => {
    await submitReview(form({ well: "  ", intention: ["", "", ""] }));
    expect(state.notice).toBe(REVIEW_ERRORS.empty);
    expect(state.reviews).toEqual(emptyReviewLog());
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("says when it could not be saved, and leaves the reminders as they were", async () => {
    mocks.write.mockResolvedValueOnce(false);
    await submitReview(form({ well: "Something" }));
    expect(state.notice).toBe("That could not be saved. Try again.");
    expect(hooks.reschedule).not.toHaveBeenCalled();
  });

  it("lets this week's review go when every field is cleared, and says so", async () => {
    await submitReview(form({ well: "Something", intention: ["Walk"] }));
    await submitReview(form({ well: "", short: "", change: "", intention: ["", "", ""] }));
    expect(state.reviews.reviews).toEqual([]);
    expect(state.notice).toBe(REVIEW_MESSAGES.cleared);
    expect(mocks.write).toHaveBeenLastCalledWith("reviews", { v: 1, reviews: [] });
    expect(weekCard()).toBeNull();
  });

  it("saves nothing over reviews that could not be read", async () => {
    state.blocked.add("reviews");
    await submitReview(form({ well: "Something" }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(state.notice).toContain("could not be read");
  });
});

describe("Home's intentions", () => {
  beforeEach(async () => {
    await submitReview(form({ intention: ["Walk", "Call home"] }));
    vi.clearAllMocks();
  });

  it("show for the week, and tick and untick with a tap, saved each time", async () => {
    expect(weekCard()?.intentions.map((i) => i.text)).toEqual(["Walk", "Call home"]);
    await tickIntention(`${MON}:1`);
    expect(weekCard()?.intentions.map((i) => i.done)).toEqual([false, true]);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(document.getElementById("live")?.textContent).toBe("Call home, done.");
    await tickIntention(`${MON}:1`);
    expect(weekCard()?.intentions.map((i) => i.done)).toEqual([false, false]);
  });

  it("ignore a tap that names nothing there", async () => {
    for (const value of [`${MON}:`, `${MON}:9`, "2026-10-26:0", "", "nonsense", `${MON}:1:2`]) await tickIntention(value);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(weekCard()?.intentions.every((i) => !i.done)).toBe(true);
  });
});

describe("a past week", () => {
  it("opens in its sheet, and only when it is there", () => {
    const old = saveReview(emptyReviewLog(), { well: "Last week's", short: "", change: "", intentions: [] }, "2026-10-27");
    if ("error" in old) throw new Error(old.error);
    state.reviews = old.log;
    openPastReview("2026-10-19");
    expect(state.sheet).toBeNull();
    openPastReview("2026-10-26");
    expect(state.sheet).toBe("review-past");
    expect(hooks.renderOverlay).toHaveBeenCalled();
    expect(pastSheet()).toContain("Last week&#39;s");
    expect(reviewModel(NOW, numbers).past).toEqual([{ week: "2026-10-26", line: "Last week's" }]);
  });
});

describe("what was typed and not kept", () => {
  const draw = (well: string) => {
    document.getElementById("app")!.innerHTML = `<form data-form="review"><textarea name="well">${well}</textarea>` +
      `<textarea name="short"></textarea><textarea name="change"></textarea><input name="intention" value="Walk">` +
      `<input name="intention" value=""><input name="intention" value=""></form>`;
  };

  it("is kept in memory when the screen is left, and fills the form when it opens again", () => {
    draw("Half a thought");
    keepReviewDraft();
    expect(state.reviewDraft).toMatchObject({ week: MON, well: "Half a thought", intentions: ["Walk", "", ""] });
    expect(reviewModel(NOW, numbers).form).toMatchObject({ well: "Half a thought", intentions: ["Walk", "", ""] });
  });

  it("is let go once kept, and is not kept when it is what was saved", async () => {
    draw("Half a thought");
    keepReviewDraft();
    await submitReview(form({ well: "Half a thought", intention: ["Walk"] }));
    expect(state.reviewDraft).toBeNull();
    draw("Half a thought");
    keepReviewDraft();
    expect(state.reviewDraft).toBeNull();
  });

  it("belongs to its week: last week's draft does not fill this week's form", () => {
    state.reviewDraft = { week: "2026-10-26", well: "Old", short: "", change: "", intentions: [] };
    expect(reviewModel(NOW, numbers).form.well).toBe("");
  });

  it("does nothing off the review screen", () => {
    document.getElementById("app")!.innerHTML = "";
    keepReviewDraft();
    expect(state.reviewDraft).toBeNull();
  });
});

describe("the look ahead", () => {
  it("says the intentions reach the assistant only where Talk is set up", () => {
    state.settings = { ...state.settings, voiceUrl: "" };
    expect(reviewModel(NOW, numbers).talk).toBe(false);
    state.settings = { ...state.settings, voiceUrl: "https://worker.example" };
    expect(reviewModel(NOW, numbers).talk).toBe(true);
    state.settings = { ...state.settings, voiceUrl: "" };
  });

  it("names work due only with a backend whose Work feed was read", () => {
    const due = [{ text: "Send it", date: "2026-11-04", time: "", late: false }];
    state.feeds = { ...state.feeds, work: { feed: { at: 1, projects: [], due, waiting: [] }, status: "ok" } };
    state.settings = { ...state.settings, voiceUrl: "" };
    expect(reviewModel(NOW, numbers).ahead.some((l) => l.startsWith("Work"))).toBe(false);
    state.settings = { ...state.settings, voiceUrl: "https://worker.example" };
    expect(reviewModel(NOW, numbers).ahead).toContain("Work due: Wed Send it");
    state.settings = { ...state.settings, voiceUrl: "" };
  });
});
