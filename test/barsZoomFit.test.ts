// @vitest-environment happy-dom
// A book's pages fitted when a bar's height changes: a page new to the reader is set at once, one on screen glides.
import { describe, expect, it, vi } from "vitest";
import { fitPagesAtFullSize } from "../src/ui/barsZoom.ts";

function box(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) };
}

function reader(): { root: HTMLElement; kept: HTMLElement; added: HTMLElement } {
  const root = document.createElement("div");
  root.innerHTML = `<div class="reader-top"></div><div class="reader-bottom"></div>` +
    `<div class="page"><div class="page-lines" id="kept"></div></div><div class="page"><div class="page-lines" id="added"></div></div>`;
  vi.spyOn(root.querySelector<HTMLElement>(".reader-top") as HTMLElement, "getBoundingClientRect").mockReturnValue(box(0, 80));
  vi.spyOn(root.querySelector<HTMLElement>(".reader-bottom") as HTMLElement, "getBoundingClientRect").mockReturnValue(box(600, 100));
  const lines = Array.from(root.querySelectorAll<HTMLElement>(".page-lines"));
  lines.forEach((el) => {
    Object.defineProperty(el, "offsetTop", { value: 0 });
    Object.defineProperty(el, "offsetHeight", { value: 800 });
  });
  return { root, kept: lines[0], added: lines[1] };
}

describe("fitting some pages of a book", () => {
  it("measures only the pages new to it at full size, and sets a new zoom on all of them", () => {
    const { root, kept, added } = reader();
    let keptFitting = true;
    let addedFitting = false;
    fitPagesAtFullSize(root, [added], [kept, added], () => {
      keptFitting = kept.classList.contains("fitting");
      addedFitting = added.classList.contains("fitting");
    });
    expect(addedFitting).toBe(true);
    expect(keptFitting).toBe(false);
    expect(added.classList.contains("fitting")).toBe(false);
    expect(Number(kept.style.getPropertyValue("--bars-scale"))).toBeLessThan(1);
    expect(Number(added.style.getPropertyValue("--bars-scale"))).toBeLessThan(1);
  });

  it("switches the glide off only for the new page, so a page on screen glides to its new zoom", () => {
    const { root, kept, added } = reader();
    // The moment the zoom is taken as it stands (the reader's width is read) is the moment the glide is off.
    let atTheMoment = { kept: "", added: "" };
    Object.defineProperty(root, "offsetWidth", {
      get: () => {
        atTheMoment = { kept: kept.style.transition, added: added.style.transition };
        return 0;
      },
    });
    fitPagesAtFullSize(root, [added], [kept, added], () => undefined);
    expect(atTheMoment).toEqual({ kept: "", added: "none" });
    expect(added.style.transition).toBe("");
  });

  it("leaves the page out of fitting even if measuring fails", () => {
    const { root, kept, added } = reader();
    expect(() => fitPagesAtFullSize(root, [added], [kept, added], () => { throw new Error("no font"); })).toThrow("no font");
    expect(added.classList.contains("fitting")).toBe(false);
  });
});
