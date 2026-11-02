// @vitest-environment happy-dom
// The tap counter: the ring, and that a tap changes it in place, on the same elements, so its motion can carry on.
import { describe, expect, it } from "vitest";
import { backOne, addOne, emptyAdhkarLog, countOf } from "../src/faith/adhkar.ts";
import { paintDhikrCard } from "../src/ui/adhkarView.ts";
import { counterHtml, paintCounter, ringOffset, takePaintedInPlace } from "../src/ui/counter.ts";

function mount(n: number, of: number): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = counterHtml({ action: "dhikr", value: "20", n, of, name: "<b>Name</b>" });
  return host.firstElementChild as HTMLElement;
}

describe("the ring", () => {
  it("goes from empty to full, with no dot when empty", () => {
    expect(ringOffset(0, 33)).toBeGreaterThan(100);
    expect(ringOffset(1, 4)).toBe(75);
    expect(ringOffset(33, 33)).toBe(0);
    expect(ringOffset(99, 33)).toBe(0);
    expect(ringOffset(1, 0)).toBeGreaterThan(100);
  });

  it("escapes the name", () => {
    expect(mount(0, 3).getAttribute("aria-label")).toBe("<b>Name</b>: 0 of 3. Tap to count");
    expect(counterHtml({ action: "a", value: "b", n: 0, of: 1, name: "<b>x</b>" })).not.toContain("<b>x</b>");
  });
});

describe("a tap", () => {
  it("changes the number on the same elements, so the ring's transition carries on", () => {
    const button = mount(1, 3);
    const number = button.querySelector(".counter-num");
    const arc = button.querySelector(".counter-arc");
    paintCounter(button, 2);
    expect(button.querySelector(".counter-num")).toBe(number);
    expect(button.querySelector(".counter-arc")).toBe(arc);
    expect(number?.textContent).toBe("2");
    expect(arc?.getAttribute("stroke-dashoffset")).toBe(String(ringOffset(2, 3)));
  });

  it("shows a check at the end and stops counting, and comes back on Back one", () => {
    const button = mount(2, 3);
    paintCounter(button, 3);
    expect(button.classList.contains("done")).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.querySelector(".counter-check")).not.toBeNull();
    paintCounter(button, 2, false);
    expect(button.classList.contains("done")).toBe(false);
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.querySelector(".counter-num")?.textContent).toBe("2");
    expect(button.querySelector(".counter-of")?.textContent).toBe("of 3");
  });

  it("paints the card's side buttons too, and says when the card is not there", () => {
    const host = document.createElement("div");
    host.innerHTML = `<li data-dhikr="20"><button class="dhikr-tap"></button><button class="counter-side" hidden></button>` +
      `${counterHtml({ action: "dhikr", value: "20", n: 0, of: 3, name: "x" })}<button class="counter-side"></button></li>`;
    expect(paintDhikrCard(host, '[data-dhikr="20"]', 1, 3, true)).toBe(true);
    const sides = host.querySelectorAll(".counter-side");
    expect(sides[0].hasAttribute("hidden")).toBe(false);
    expect(paintDhikrCard(host, '[data-dhikr="20"]', 3, 3, true)).toBe(true);
    expect(sides[1].hasAttribute("hidden")).toBe(false);
    expect(sides[1].textContent).toBe("Reset");
    expect(sides[1].getAttribute("aria-label")).toBe("Reset: x");
    expect(host.querySelector(".dhikr-tap")?.getAttribute("aria-disabled")).toBe("true");
    expect(paintDhikrCard(host, '[data-dhikr="20"]', 2, 3, false)).toBe(true);
    expect(sides[1].textContent).toBe("All said");
    expect(paintDhikrCard(host, '[data-dhikr="99"]', 1, 3, true)).toBe(false);
  });

  it("gives the focus to the ring when the button that has it goes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = `<li data-dhikr="20"><button class="counter-side"></button>` +
      `${counterHtml({ action: "dhikr", value: "20", n: 1, of: 3, name: "x" })}<button class="counter-side"></button></li>`;
    const back = host.querySelector<HTMLElement>(".counter-side") as HTMLElement;
    back.focus();
    paintDhikrCard(host, '[data-dhikr="20"]', 0, 3, false);
    expect(back.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("[data-counter]"));
    host.remove();
  });

  it("takes the time line off once a count lands", () => {
    const host = document.createElement("div");
    host.innerHTML = `<li data-dhikr="3">${counterHtml({ action: "dhikr", value: "3", n: 0, of: 1, name: "x" })}` +
      `<p class="dhikr-wait">After Maghrib</p></li>`;
    paintDhikrCard(host, '[data-dhikr="3"]', 1, 1, true);
    expect(host.querySelector(".dhikr-wait")).toBeNull();
  });

  it("tells the next redraw the screen was changed in place, once", () => {
    takePaintedInPlace();
    paintCounter(mount(0, 3), 1);
    expect(takePaintedInPlace()).toBe(true);
    expect(takePaintedInPlace()).toBe(false);
  });
});

describe("back one", () => {
  it("takes one off, and never goes below none", () => {
    const log = addOne(emptyAdhkarLog(), "2026-10-27", "morning", 20);
    const back = backOne(log, "2026-10-27", "morning", 20);
    expect(countOf(back, "2026-10-27", "morning", 20)).toBe(0);
    expect(backOne(back, "2026-10-27", "morning", 20)).toBe(back);
  });
});
