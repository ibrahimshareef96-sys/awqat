// @vitest-environment happy-dom
// The adhkar on screen: Home's card only while a set is open and not said, Faith's card for both, and each list with
// its counts, Done, the mushaf for the Quran items (no Quran words), and the end of Al-Baqarah after Maghrib.
import { describe, expect, it } from "vitest";
import { adhkarFor, adhkarWindow, emptyAdhkarLog, setDone, type AdhkarLog } from "../src/faith/adhkar.ts";
import { adhkarView, faithAdhkarCard, homeAdhkarCard, type AdhkarScreenModel } from "../src/ui/adhkarView.ts";
import type { DayTimes } from "../src/prayer/times.ts";

const TZ = "Asia/Dubai";
const at = (time: string, date = "2026-10-27"): Date => new Date(`${date}T${time}:00+04:00`);
function day(date: string): DayTimes {
  return { date, fajr: at("05:06", date), sunrise: at("06:20", date), dhuhr: at("12:06", date), asr: at("15:20", date),
    maghrib: at("17:46", date), isha: at("19:00", date), method: "Dubai", adjusted: "none" };
}
const days = ["2026-10-26", "2026-10-27", "2026-10-28"].map(day);

function card(log: AdhkarLog, now: Date) {
  return { log, open: adhkarWindow(days, now), date: "2026-10-27", now, tz: TZ };
}

function screen(session: "morning" | "evening", now: Date, log = emptyAdhkarLog()): AdhkarScreenModel {
  return { ...card(log, now), session, maghrib: at("17:46") };
}

const parse = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

function full(session: "morning" | "evening"): AdhkarLog {
  return adhkarFor(session).reduce((log, item) => setDone(log, "2026-10-27", session, item.id, true), emptyAdhkarLog());
}

describe("Home's card", () => {
  it("comes up while the morning set is open, with its best time", () => {
    const html = homeAdhkarCard(card(emptyAdhkarLog(), at("05:30")));
    const root = parse(html);
    expect(root.querySelector("[data-go]")?.getAttribute("data-go")).toBe("adhkar:morning");
    expect(root.textContent).toContain("ADHKAR AL-SABAH");
    expect(root.textContent).toContain("0 of 25");
    expect(root.textContent).toContain("Best before sunrise, 06:20 · open until Dhuhr, 12:06");
    expect(homeAdhkarCard(card(emptyAdhkarLog(), at("07:00")))).toContain("Open until Dhuhr, 12:06");
  });

  it("comes up for the evening from Asr, and goes once the set is said or the time is over", () => {
    expect(homeAdhkarCard(card(emptyAdhkarLog(), at("16:00")))).toContain("adhkar:evening");
    expect(homeAdhkarCard(card(full("evening"), at("16:00")))).toBe("");
    expect(homeAdhkarCard(card(emptyAdhkarLog(), at("13:00")))).toBe("");
    expect(homeAdhkarCard(card(emptyAdhkarLog(), at("23:30")))).toBe("");
  });

  it("goes before Maghrib once all but the end of Al-Baqarah is said, and comes back for it at Maghrib", () => {
    const allButNight = adhkarFor("evening").filter((i) => !i.night)
      .reduce((log, item) => setDone(log, "2026-10-27", "evening", item.id, true), emptyAdhkarLog());
    expect(homeAdhkarCard(card(allButNight, at("17:00")))).toBe("");
    expect(homeAdhkarCard(card(allButNight, at("18:00")))).toContain("22 of 23");
  });
});

describe("Faith's card", () => {
  it("shows both sets with today's count, ticks a finished one, and marks the open one", () => {
    const root = parse(faithAdhkarCard(card(full("morning"), at("16:00"))));
    const rows = [...root.querySelectorAll(".adhkar-row")];
    expect(rows.map((r) => r.getAttribute("data-go"))).toEqual(["adhkar:morning", "adhkar:evening"]);
    expect(rows[0].querySelector(".tick.on")).not.toBeNull();
    expect(rows[0].textContent).toContain("25 of 25");
    expect(rows[1].textContent).toContain("0 of 23 · now");
  });
});

describe("the list", () => {
  it("shows every dhikr of the set with its words, count and source", () => {
    const root = parse(adhkarView(screen("morning", at("05:30")), "<header></header>", "", ""));
    const items = [...root.querySelectorAll("li.dhikr")];
    expect(items).toHaveLength(25);
    const bismillah = root.querySelector('[data-dhikr="20"]') as HTMLElement;
    expect(bismillah.querySelector(".dhikr-ar")?.getAttribute("lang")).toBe("ar");
    const counter = bismillah.querySelector("[data-counter]") as HTMLElement;
    expect(counter.textContent).toBe("0of 3");
    expect(counter.getAttribute("data-action")).toBe("dhikr");
    expect(counter.getAttribute("data-value")).toBe("20");
    expect(bismillah.querySelector("details .source")?.textContent).toContain("أبو داود");
    // Each control names its dhikr for a screen reader, and the source keeps its id so a redraw keeps it open.
    expect(counter.getAttribute("aria-label")).toBe("In the name of Allah, with whose name nothing harms: 0 of 3. Tap to count");
    expect(bismillah.querySelector('[data-action="dhikr-done"]')?.getAttribute("aria-label"))
      .toBe("All said: In the name of Allah, with whose name nothing harms");
    expect(bismillah.querySelector('[data-action="dhikr-back"]')?.hasAttribute("hidden")).toBe(true);
    expect(bismillah.querySelector("details")?.id).toBe("dhikr-source-20");
    expect(bismillah.querySelector("summary")?.textContent).toBe("Source of In the name of Allah, with whose name nothing harms");
  });

  it("shows At-Tawbah 129's closing words only as a place in the mushaf", () => {
    const root = parse(adhkarView(screen("morning", at("05:30")), "", "", ""));
    const hasbi = root.querySelector('[data-dhikr="17"]') as HTMLElement;
    expect(hasbi.querySelector(".dhikr-ar")).toBeNull();
    expect(hasbi.querySelector(".dhikr-quran")?.textContent).toBe(
      "At-Tawba 129, its closing words. Read it from the mushaf, then count it here.");
    // The spoken name starts with the button's own words.
    expect(hasbi.querySelector("[data-go]")?.getAttribute("aria-label")).toBe("Read Allah is enough for me, page 207");
    expect(hasbi.querySelector("[data-go]")?.getAttribute("data-go")).toBe("mushaf:207");
    expect(hasbi.querySelector("[data-counter]")?.textContent).toBe("0of 7");
  });

  it("says plainly that a Quran item is Quran, and labels what is said before it", () => {
    const root = parse(adhkarView(screen("morning", at("05:30")), "", "", ""));
    const kursi = root.querySelector('[data-dhikr="2"]') as HTMLElement;
    expect(kursi.querySelector(".label")?.textContent).toBe("QURAN");
    expect(kursi.querySelector(".dhikr-quran-name")?.textContent).toBe("Ayat al-Kursi");
    expect(kursi.querySelector(".dhikr-read")?.textContent).toBe("Read it on p. 42");
    // The refuge in Allah is what is said first: labelled, and never drawn as the thing to read.
    expect(kursi.querySelector(".dhikr-before .small")?.textContent).toBe("Begin with");
    expect(kursi.querySelector(".dhikr-ar")).toBeNull();
    // A tap on the card does not count it: only the ring does.
    expect(kursi.querySelector(".dhikr-tap")).toBeNull();
  });

  it("names a count of one as once, with no all-at-once button", () => {
    const root = parse(adhkarView(screen("morning", at("05:30")), "", "", ""));
    const one = root.querySelector('[data-dhikr="7"]') as HTMLElement;
    expect(one.querySelector("[data-counter]")?.textContent).toBe("0once");
    expect(one.querySelector('[data-action="dhikr-done"]')?.hasAttribute("hidden")).toBe(true);
  });

  it("shows no Quran words for the Quran items: it names the place and opens the mushaf there", () => {
    const root = parse(adhkarView(screen("morning", at("05:30")), "", "", ""));
    const kursi = root.querySelector('[data-dhikr="2"]') as HTMLElement;
    expect(kursi.querySelector(".dhikr-quran")?.textContent).toBe("Al-Baqara 255. Read it from the mushaf, then count it here.");
    expect(kursi.querySelector("[data-go]")?.getAttribute("data-go")).toBe("mushaf:42");
    const ikhlas = root.querySelector('[data-dhikr="4"]') as HTMLElement;
    expect(ikhlas.querySelector(".dhikr-ar")).toBeNull();
    expect(ikhlas.querySelector(".dhikr-quran")?.textContent).toContain("The whole surah");
    expect(ikhlas.querySelector(".dhikr-read")?.textContent).toBe("Read it on p. 604");
    expect(ikhlas.querySelector(".dhikr-quran-name")?.textContent).toBe("Al-Ikhlas");
    const baqarah = parse(adhkarView(screen("evening", at("18:00")), "", "", "")).querySelector('[data-dhikr="3"]');
    expect(baqarah?.querySelector(".dhikr-quran")?.textContent).toContain("Al-Baqara 285 to 286");
    expect(baqarah?.querySelector(".dhikr-read")?.textContent).toContain("p. 49");
  });

  it("marks a dhikr said in full, and turns off its tap while keeping it focusable", () => {
    const log = setDone(emptyAdhkarLog(), "2026-10-27", "morning", 20, true);
    const root = parse(adhkarView(screen("morning", at("05:30"), log), "", "", ""));
    const item = root.querySelector('[data-dhikr="20"]') as HTMLElement;
    expect(item.classList.contains("done")).toBe(true);
    const tap = item.querySelector('[data-action="dhikr"]') as HTMLButtonElement;
    expect(tap.getAttribute("aria-disabled")).toBe("true");
    expect(tap.disabled).toBe(false);
    expect(item.querySelector("[data-counter]")?.classList.contains("done")).toBe(true);
    expect(item.querySelector('[data-action="dhikr-back"]')?.hasAttribute("hidden")).toBe(false);
    // Said in full, the other side starts it again: a slip onto All said is one tap from put right.
    expect(item.querySelector('[data-action="dhikr-done"]')?.textContent).toBe("Reset");
    expect(item.querySelector('[data-action="dhikr-done"]')?.hasAttribute("hidden")).toBe(false);
    expect(root.querySelector(".numeral")?.textContent).toBe("1 of 25");
  });

  it("holds the end of Al-Baqarah until Maghrib", () => {
    const before = parse(adhkarView(screen("evening", at("16:00")), "", "", ""));
    const baqarah = before.querySelector('[data-dhikr="3"]') as HTMLElement;
    expect(baqarah.querySelector('[data-action="dhikr"]')?.getAttribute("aria-disabled")).toBe("true");
    expect(baqarah.querySelector('[data-action="dhikr-done"]')?.hasAttribute("hidden")).toBe(true);
    expect(baqarah.textContent).toContain("After Maghrib, 17:46");
    const after = parse(adhkarView(screen("evening", at("18:00")), "", "", ""));
    expect(after.querySelector('[data-dhikr="3"] [data-action="dhikr"]')?.hasAttribute("aria-disabled")).toBe(false);
  });

  it("says when a set is open when it is not open now", () => {
    expect(adhkarView(screen("evening", at("08:00")), "", "", "")).toContain("From Asr until the middle of the night");
  });
});
