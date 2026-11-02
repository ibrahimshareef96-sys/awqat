// @vitest-environment happy-dom
// The Arabic, Sound and Meaning toggles, what a dhikr shows under its Arabic, and a translation that arrives while the
// list is open: filled in where it waits, never moving what is under the finger, and never read as HTML. The words
// here are made up for the tests.
import { describe, expect, it, vi } from "vitest";
import { adhkarFor, adhkarWindow, emptyAdhkarLog, type Session } from "../src/faith/adhkar.ts";
import type { Meaning } from "../src/faith/meaning.ts";
import type { DayTimes } from "../src/prayer/times.ts";
import type { AdhkarShow } from "../src/settings.ts";
import { adhkarView, type AdhkarScreenModel } from "../src/ui/adhkarView.ts";
import { anchorFor, keepInPlace, meaningBlock, paintMeanings, showToggles } from "../src/ui/meaningView.ts";

const ALL: AdhkarShow = { arabic: true, sound: true, meaning: true };
const HOSTILE = `<img src=x onerror="alert(1)"> & "quotes"`;
const CREDIT = { both: "A made-up source", sound: "A made-up source's sounds", meaning: "A made-up source's meanings" };
const said = (t: string, e: string, wholeAyah = false): Meaning =>
  ({ kind: "text", transliteration: t, translation: e, credit: CREDIT, wholeAyah });

const at = (time: string, date = "2026-10-27"): Date => new Date(`${date}T${time}:00+04:00`);
function day(date: string): DayTimes {
  return { date, fajr: at("05:06", date), sunrise: at("06:20", date), dhuhr: at("12:06", date), asr: at("15:20", date),
    maghrib: at("17:46", date), isha: at("19:00", date), method: "Dubai", adjusted: "none" };
}
const days = ["2026-10-26", "2026-10-27", "2026-10-28"].map(day);

function screen(show: AdhkarShow, meanings: Record<number, Meaning | null>, session: Session = "morning"): AdhkarScreenModel {
  const now = at("05:30");
  return { log: emptyAdhkarLog(), open: adhkarWindow(days, now), date: "2026-10-27", now, tz: "Asia/Dubai", session,
    maghrib: at("17:46"), show, meanings };
}

const parse = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

describe("the three toggles", () => {
  it("are real buttons that say whether they are on, with plain names", () => {
    const root = parse(showToggles({ arabic: true, sound: false, meaning: true }));
    const buttons = [...root.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Arabic", "Sound", "Meaning"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "true"]);
    expect(buttons.map((b) => b.dataset.action)).toEqual(["adhkar-show", "adhkar-show", "adhkar-show"]);
    expect(buttons.map((b) => b.dataset.value)).toEqual(["arabic", "sound", "meaning"]);
    expect(buttons.every((b) => b.type === "button")).toBe(true);
    // The spoken name starts with the words on the button.
    expect(buttons[1].getAttribute("aria-label")?.startsWith("Sound")).toBe(true);
    expect(buttons[2].getAttribute("aria-label")?.startsWith("Meaning")).toBe(true);
    expect(root.querySelector('[role="group"]')?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("under a dhikr", () => {
  it("shows the transliteration and the English, left to right, each in its language", () => {
    const root = parse(meaningBlock("a:9", said("Dhahaba al-waladu", "The boy went"), ALL));
    const say = root.querySelector(".dhikr-say") as HTMLElement;
    const english = root.querySelector(".dhikr-en") as HTMLElement;
    expect(say.textContent).toBe("Dhahaba al-waladu");
    expect(say.getAttribute("dir")).toBe("ltr");
    expect(say.getAttribute("lang")).toBe("ar-Latn");
    expect(english.textContent).toBe("The boy went");
    expect(english.getAttribute("lang")).toBe("en");
    expect(english.getAttribute("dir")).toBe("ltr");
    expect(root.querySelector("[data-meaning]")?.getAttribute("data-meaning")).toBe("a:9");
  });

  it("shows only what is turned on, and nothing when neither is", () => {
    const m = said("Dhahaba al-waladu", "The boy went");
    expect(parse(meaningBlock("a:9", m, { ...ALL, sound: false })).querySelector(".dhikr-say")).toBeNull();
    expect(parse(meaningBlock("a:9", m, { ...ALL, meaning: false })).querySelector(".dhikr-en")).toBeNull();
    expect(meaningBlock("a:9", m, { arabic: true, sound: false, meaning: false })).toBe("");
    expect(meaningBlock("a:9", null, ALL)).toBe("");
  });

  it("says when it is on its way, or cannot be had offline", () => {
    expect(parse(meaningBlock("a:9", { kind: "pending" }, ALL)).textContent).toBe("Getting the translation");
    expect(parse(meaningBlock("a:9", { kind: "offline" }, ALL)).textContent).toBe("Translation unavailable offline");
  });

  it("says when the English is of the whole ayah and the words to say are only its end", () => {
    const root = parse(meaningBlock("a:17", said("made-up words", "The whole of it."), ALL));
    expect(root.querySelector(".dhikr-en")?.textContent).toBe("The whole of it.");
    expect(parse(meaningBlock("a:17", said("made-up words", "The whole of it.", true), ALL)).querySelector(".dhikr-en")?.textContent)
      .toBe("The whole ayah: The whole of it.");
  });

  it("never reads fetched text as HTML", () => {
    const html = meaningBlock(`a:"><b>`, said(HOSTILE, HOSTILE), ALL);
    const root = parse(html);
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector(".dhikr-say")?.textContent).toBe(HOSTILE);
    expect(root.querySelector(".dhikr-en")?.textContent).toBe(HOSTILE);
  });
});

describe("the adhkar list with the toggles", () => {
  it("puts the toggles above the list, and the meaning under each dhikr's Arabic inside the words that count", () => {
    const root = parse(adhkarView(screen(ALL, { 9: said("Dhahaba al-waladu", "The boy went") }), "", "", ""));
    const toggles = root.querySelector(".dhikr-show") as HTMLElement;
    const list = root.querySelector(".dhikr-list") as HTMLElement;
    expect(toggles.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const card = root.querySelector('[data-dhikr="9"]') as HTMLElement;
    const tap = card.querySelector(".dhikr-tap") as HTMLElement;
    const arabic = tap.querySelector(".dhikr-ar") as HTMLElement;
    const meaning = tap.querySelector(".dhikr-meaning") as HTMLElement;
    expect(arabic.compareDocumentPosition(meaning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tap.dataset.action).toBe("dhikr");
    // The counter is where it always was.
    expect(card.querySelector("[data-counter]")?.getAttribute("data-value")).toBe("9");
  });

  it("hides the Arabic when it is turned off, and keeps the name and the count", () => {
    const root = parse(adhkarView(screen({ ...ALL, arabic: false }, { 9: said("Dhahaba", "The boy went") }), "", "", ""));
    const card = root.querySelector('[data-dhikr="9"]') as HTMLElement;
    expect(card.querySelector(".dhikr-ar")).toBeNull();
    expect(card.querySelector(".dhikr-name")?.textContent).toBe("By You we reach the morning");
    expect(card.querySelector(".dhikr-say")?.textContent).toBe("Dhahaba");
    expect(card.querySelector("[data-counter]")).not.toBeNull();
    // A Quran item drops the Arabic said before it too.
    expect(root.querySelector('[data-dhikr="2"] .dhikr-before')).toBeNull();
  });

  it("keeps the Arabic, even turned off, where nothing else would give the words", () => {
    const off = { ...ALL, arabic: false };
    const root = parse(adhkarView(screen(off, { 9: { kind: "pending" }, 11: { kind: "offline" }, 7: null }), "", "", ""));
    for (const id of [7, 9, 11, 12]) {
      const arabic = root.querySelector(`[data-dhikr="${id}"] .dhikr-ar`) as HTMLElement;
      expect(arabic.getAttribute("lang")).toBe("ar");
      expect(arabic.hasAttribute("data-fallback")).toBe(true);
    }
    // Only the English shown, with Sound off: the English gives the words, so the Arabic stays off.
    const english = parse(adhkarView(screen({ ...off, sound: false }, { 9: said("Dhahaba", "The boy went") }), "", "", ""));
    expect(english.querySelector('[data-dhikr="9"] .dhikr-ar')).toBeNull();
    // Only Sound on, and this one has no transliteration: its Arabic shows.
    const noSound = parse(adhkarView(screen({ ...off, meaning: false }, { 9: said("", "The boy went") }), "", "", ""));
    expect(noSound.querySelector('[data-dhikr="9"] .dhikr-ar')).not.toBeNull();
  });

  it("shows a Quran item's meaning above its button to the mushaf, and nothing of the Quran in Arabic", () => {
    const root = parse(adhkarView(screen(ALL, { 2: { kind: "offline" } }), "", "", ""));
    const kursi = root.querySelector('[data-dhikr="2"]') as HTMLElement;
    expect(kursi.querySelector(".dhikr-meaning")?.textContent).toBe("Translation unavailable offline");
    expect(kursi.querySelector(".dhikr-read")?.textContent).toBe("Read it on p. 42");
    expect(kursi.querySelector(".dhikr-ar")).toBeNull();
  });

  it("credits each source shown, at the foot", () => {
    const root = parse(adhkarView(screen(ALL, { 9: said("a", "b"), 11: said("c", "d"), 12: { kind: "pending" } }), "", "", ""));
    expect(root.querySelector("[data-meaning-credits]")?.textContent).toBe("A made-up source");
    const none = parse(adhkarView(screen({ ...ALL, sound: false, meaning: false }, { 9: said("a", "b") }), "", "", ""));
    expect(none.querySelector("[data-meaning-credits]")?.textContent ?? "").toBe("");
  });

  it("credits only what is shown: how to say it, or the meaning", () => {
    const sound = parse(adhkarView(screen({ ...ALL, meaning: false }, { 9: said("a", "b") }), "", "", ""));
    expect(sound.querySelector("[data-meaning-credits]")?.textContent).toBe("A made-up source's sounds");
    const meaning = parse(adhkarView(screen({ ...ALL, sound: false }, { 9: said("a", "b") }), "", "", ""));
    expect(meaning.querySelector("[data-meaning-credits]")?.textContent).toBe("A made-up source's meanings");
  });

  it("shows every dhikr as before when nothing has been fetched", () => {
    const root = parse(adhkarView(screen(ALL, {}), "", "", ""));
    expect(root.querySelectorAll("li.dhikr")).toHaveLength(adhkarFor("morning").length);
    expect(root.querySelector(".dhikr-meaning")).toBeNull();
  });
});

describe("filling in what arrives", () => {
  function onScreen(): HTMLElement {
    document.body.innerHTML = `<div id="app">${adhkarView(screen(ALL, { 9: { kind: "pending" }, 11: { kind: "pending" } }), "", "", "")}</div>`;
    return document.getElementById("app") as HTMLElement;
  }

  it("puts the text where it waited, leaving the card and its buttons as they are", () => {
    const root = onScreen();
    const tap = root.querySelector('[data-dhikr="9"] .dhikr-tap');
    const block = root.querySelector('[data-meaning="a:9"]');
    paintMeanings(root, (key) => (key === "a:9" ? said(HOSTILE, "The boy went") : { kind: "pending" }), ALL);
    expect(root.querySelector('[data-dhikr="9"] .dhikr-tap')).toBe(tap);
    expect(root.querySelector('[data-meaning="a:9"]')).toBe(block);
    expect(block?.querySelector(".dhikr-say")?.textContent).toBe(HOSTILE);
    expect(block?.querySelector("img")).toBeNull();
    expect(root.querySelector('[data-meaning="a:11"]')?.textContent).toBe("Getting the translation");
    expect(root.querySelector("[data-meaning-credits]")?.textContent).toBe("A made-up source");
  });

  it("leaves a block alone that already shows the same", () => {
    const root = onScreen();
    paintMeanings(root, () => said("a", "b"), ALL);
    const inner = root.querySelector('[data-meaning="a:9"] .dhikr-say');
    paintMeanings(root, () => said("a", "b"), ALL);
    expect(root.querySelector('[data-meaning="a:9"] .dhikr-say')).toBe(inner);
  });

  it("empties a block whose dhikr turned out to have nothing", () => {
    const root = onScreen();
    paintMeanings(root, () => null, ALL);
    const block = root.querySelector('[data-meaning="a:9"]') as HTMLElement;
    expect(block.textContent).toBe("");
    expect(block.hidden).toBe(true);
  });

  it("keeps what is under the finger where it was", () => {
    const anchor = document.body.appendChild(document.createElement("div"));
    let top = 300;
    anchor.getBoundingClientRect = () => ({ top } as DOMRect);
    const scroll = vi.fn();
    keepInPlace(anchor, () => { top = 380; }, scroll);
    expect(scroll).toHaveBeenCalledWith(80);
    const still = vi.fn();
    keepInPlace(anchor, () => undefined, still);
    expect(still).not.toHaveBeenCalled();
    keepInPlace(null, () => undefined, still);
    expect(still).not.toHaveBeenCalled();
  });

  it("anchors on what was last pressed, else on the first card on screen", () => {
    const root = onScreen();
    const card = root.querySelector('[data-dhikr="9"]') as HTMLElement;
    const ring = card.querySelector("[data-counter]") as HTMLElement;
    document.elementFromPoint = () => ring;
    expect(anchorFor(document, { x: 10, y: 20 })).toBe(ring);
    // Pressed outside the app (a sheet, the orb): the first card still in view.
    document.elementFromPoint = () => document.body;
    const cards = [...root.querySelectorAll<HTMLElement>("li.dhikr")];
    cards.forEach((c, i) => { c.getBoundingClientRect = () => ({ top: i * 100 - 150, bottom: i * 100 - 50 } as DOMRect); });
    // The second card's foot is still on screen: it is the first in view.
    expect(anchorFor(document, { x: 10, y: 20 })).toBe(cards[1]);
    expect(anchorFor(document, null)).toBe(cards[1]);
    // Pressed on the page between cards, which nothing going in would move: the first card in view too.
    document.elementFromPoint = () => root.querySelector("main");
    expect(anchorFor(document, { x: 10, y: 20 })).toBe(cards[1]);
    // Pressed on the line that waits: the block, which stays, not the line, which is replaced.
    const wait = root.querySelector('[data-meaning="a:9"] .dhikr-meaning-wait');
    document.elementFromPoint = () => wait;
    expect(anchorFor(document, { x: 10, y: 20 })).toBe(root.querySelector('[data-meaning="a:9"]'));
  });

  it("hides the Arabic kept for want of anything else once the translation is there", () => {
    const waiting = { 9: { kind: "pending" }, 11: { kind: "pending" } } as const;
    document.body.innerHTML = `<div id="app">${adhkarView(screen({ ...ALL, arabic: false }, waiting), "", "", "")}</div>`;
    const root = document.getElementById("app") as HTMLElement;
    const arabic = root.querySelector('[data-dhikr="9"] .dhikr-ar') as HTMLElement;
    expect(arabic.hidden).toBe(false);
    // Pressed on that Arabic: held by its card, as the Arabic itself is about to go.
    document.elementFromPoint = () => arabic;
    expect(anchorFor(document, { x: 10, y: 20 })).toBe(root.querySelector('[data-dhikr="9"]'));
    paintMeanings(root, (key) => (key === "a:9" ? said("Dhahaba", "The boy went") : { kind: "offline" }), { ...ALL, arabic: false });
    expect(arabic.hidden).toBe(true);
    // One whose fetch failed keeps its Arabic.
    expect((root.querySelector('[data-dhikr="11"] .dhikr-ar') as HTMLElement).hidden).toBe(false);
  });
});
