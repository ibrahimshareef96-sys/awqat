// @vitest-environment happy-dom
// The toggles' taps, and the translation fetched for the list on screen: asked for only when it is to be shown, kept
// in Settings, and painted into the open list in place. The fetched words here are made up.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ write: vi.fn(async () => true) }));
vi.mock("../src/store.ts", () => ({ KEYS: { settings: "settings", adhkar: "adhkar" }, write: store.write, read: vi.fn(), keepAside: vi.fn() }));

import type { HttpOptions, HttpResponse } from "@capacitor/core";
import { adhkarWindow, emptyAdhkarLog } from "../src/faith/adhkar.ts";
import { forgetMeanings, meaningIo } from "../src/faith/meaning.ts";
import type { DayTimes } from "../src/prayer/times.ts";
import { defaultSettings } from "../src/settings.ts";
import { MESSAGES, hooks, state } from "../src/app/state.ts";
import { adhkarMeanings, fetchMeanings, notePress, noteScroll, toggleShow, warmUp } from "../src/app/meaningActions.ts";
import { DUAS } from "../src/faith/duaData.ts";
import { adhkarView } from "../src/ui/adhkarView.ts";

const at = (time: string, date = "2026-10-27"): Date => new Date(`${date}T${time}:00+04:00`);
function day(date: string): DayTimes {
  return { date, fajr: at("05:06", date), sunrise: at("06:20", date), dhuhr: at("12:06", date), asr: at("15:20", date),
    maghrib: at("17:46", date), isha: at("19:00", date), method: "Dubai", adjusted: "none" };
}
const NOW = at("05:30").getTime();

let calls: HttpOptions[] = [];

function drawList(): void {
  const now = new Date(NOW);
  const days = ["2026-10-26", "2026-10-27", "2026-10-28"].map(day);
  document.body.innerHTML = `<div id="live"></div><div id="app">${adhkarView({ log: emptyAdhkarLog(), open: adhkarWindow(days, now),
    date: "2026-10-27", now, tz: "Asia/Dubai", session: "morning", maghrib: at("17:46"), show: state.settings.adhkarShow,
    meanings: adhkarMeanings("morning", NOW) }, "", "", "")}</div>`;
}

beforeEach(() => {
  forgetMeanings();
  calls = [];
  store.write.mockReset();
  store.write.mockResolvedValue(true);
  state.settings = defaultSettings();
  state.screen = "adhkar:morning";
  state.blocked.clear();
  state.notice = "";
  hooks.render = vi.fn();
  meaningIo.native = () => true;
  meaningIo.read = async () => null;
  meaningIo.write = async () => true;
  meaningIo.get = (options) => {
    calls.push(options);
    return Promise.resolve({ status: 200, data: "{}", headers: {}, url: "" } as HttpResponse);
  };
  drawList();
});

describe("the toggles", () => {
  it("turn a part off and on again, kept in Settings, and say so", () => {
    toggleShow("sound");
    expect(state.settings.adhkarShow).toEqual({ arabic: true, sound: false, meaning: true });
    expect(store.write).toHaveBeenLastCalledWith("settings", state.settings);
    expect(hooks.render).toHaveBeenCalled();
    expect(document.getElementById("live")?.textContent).toBe("Sound off.");
    toggleShow("sound");
    expect(state.settings.adhkarShow.sound).toBe(true);
    expect(document.getElementById("live")?.textContent).toBe("Sound on.");
  });

  it("change nothing for a part that is not one", () => {
    const before = state.settings;
    toggleShow("audio");
    toggleShow("");
    expect(state.settings).toBe(before);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("say so when the settings could not be read, as every save does", () => {
    state.blocked.add("settings");
    toggleShow("arabic");
    expect(state.notice).toBe(MESSAGES.unreadable);
  });

  it("keep one of the three on, so a dhikr always has words", () => {
    toggleShow("sound");
    toggleShow("meaning");
    const before = state.settings;
    store.write.mockClear();
    toggleShow("arabic");
    expect(state.settings).toBe(before);
    expect(state.settings.adhkarShow.arabic).toBe(true);
    expect(store.write).not.toHaveBeenCalled();
    expect(document.getElementById("live")?.textContent).toBe("Arabic stays on: keep one of Arabic, Sound or Meaning.");
  });
});

describe("fetching for the list on screen", () => {
  it("asks for the morning's texts, and fills in each block where it waits", async () => {
    expect(document.querySelector('[data-meaning="a:11"]')?.textContent).toBe("Getting the translation");
    await fetchMeanings(NOW);
    expect(calls.some((c) => c.url.endsWith("/27.json"))).toBe(true);
    // The made-up server answered with nothing usable: each block says so, in place.
    expect(document.querySelector('[data-meaning="a:11"]')?.textContent).toBe("Translation unavailable offline");
    expect(hooks.render).not.toHaveBeenCalled();
  });

  it("asks nothing when both Sound and Meaning are off", async () => {
    state.settings = { ...state.settings, adhkarShow: { arabic: true, sound: false, meaning: false } };
    await fetchMeanings(NOW);
    expect(calls).toHaveLength(0);
  });

  it("asks nothing on a screen without adhkar or du'as", async () => {
    state.screen = "books";
    await fetchMeanings(NOW);
    state.screen = "mode:istikhara";
    await fetchMeanings(NOW);
    expect(calls).toHaveLength(0);
  });

  it("asks for the du'a after the salam on a prayer's mode", async () => {
    state.screen = "mode:fajr";
    await fetchMeanings(NOW);
    expect(calls.map((c) => c.url)).toEqual(["https://www.hisnmuslim.com/api/en/25.json"]);
  });

  it("paints nothing once the list on screen has changed", async () => {
    const waiting: ((r: HttpResponse) => void)[] = [];
    meaningIo.get = () => new Promise((resolve) => { waiting.push(resolve); });
    const going = fetchMeanings(NOW);
    // Every request goes out at once; the user leaves before any answer comes.
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    state.screen = "home";
    waiting.forEach((resolve) => resolve({ status: 500, data: "", headers: {}, url: "" } as HttpResponse));
    await going;
    expect(document.querySelector('[data-meaning="a:11"]')?.textContent).toBe("Getting the translation");
  });

  it("fills in a prayer's mode, block by du'a", async () => {
    state.screen = "mode:fajr";
    const ours = DUAS.find((d) => d.id === "istighfar")?.text ?? "";
    const items = [{ ID: 66, ARABIC_TEXT: ours, LANGUAGE_ARABIC_TRANSLATED_TEXT: "(Made-up saying.)", TRANSLATED_TEXT: "(Made-up meaning.)" }];
    meaningIo.get = (options) => {
      calls.push(options);
      return Promise.resolve({ status: 200, data: { "A made-up chapter": items }, headers: {}, url: "" } as HttpResponse);
    };
    document.body.innerHTML = `<div id="live"></div><div id="app"><ol><li class="card dhikr"><span class="dhikr-meaning" ` +
      `data-meaning="d:istighfar" data-shown="x">Getting the translation</span></li></ol></div>`;
    await fetchMeanings(NOW);
    expect(document.querySelector('[data-meaning="d:istighfar"] .dhikr-say')?.textContent).toBe("Made-up saying.");
    expect(document.querySelector('[data-meaning="d:istighfar"] .dhikr-en')?.textContent).toBe("Made-up meaning.");
  });

  it("waits for the list to stop scrolling before filling in, so a fling keeps its speed", async () => {
    noteScroll();
    await fetchMeanings(NOW);
    expect(document.querySelector('[data-meaning="a:11"]')?.textContent).toBe("Getting the translation");
    await vi.waitFor(() => expect(document.querySelector('[data-meaning="a:11"]')?.textContent).toBe("Translation unavailable offline"));
  });

  it("never throws, whatever goes wrong underneath", async () => {
    meaningIo.native = () => {
      throw new Error("bridge gone");
    };
    await expect(fetchMeanings(NOW)).resolves.toBeUndefined();
    meaningIo.read = () => Promise.reject(new Error("disk gone"));
    forgetMeanings();
    await expect(warmUp()).resolves.toBeUndefined();
  });

  it("reads the phone's copy at start-up and fills in the list on screen", async () => {
    meaningIo.native = () => false;
    await warmUp();
    // Nothing on the phone, and no fetching in a browser: each block says so.
    expect(document.querySelector('[data-meaning="a:11"]')?.textContent).toBe("Translation unavailable offline");
  });

  it("remembers where the finger last pressed", () => {
    expect(() => notePress({ clientX: 10, clientY: 20 } as PointerEvent)).not.toThrow();
  });
});
