// @vitest-environment happy-dom
// A book's reader brought up to date in place: pages that are still there stay the very same elements, so the browser
// keeps what it has drawn of them.
import { beforeEach, describe, expect, it } from "vitest";
import { patchReader, rememberPages } from "../src/ui/readerPatch.ts";

const page = (n: number, body = `words of ${n}`, attrs = " inert"): string =>
  `<section class="page" data-page="${n}" aria-label="Page ${n}"${attrs}><div class="page-lines">${body}</div></section>`;
const reader = (title: string, pages: string, opts: { theme?: string; book?: boolean; spread?: boolean } = {}): string =>
  `<main class="reader theme-${opts.theme ?? "paper"}"><header class="reader-top">${title}</header>` +
  `<div class="pager${opts.spread ? " spread" : ""}${opts.book === false ? "" : " book"}" dir="rtl" data-pager>${pages}</div>` +
  `<footer class="reader-bottom">foot</footer></main>`;

let root: HTMLElement;
const pageAt = (n: number): HTMLElement | null => root.querySelector(`[data-page="${n}"]`);

beforeEach(() => {
  root = document.createElement("div");
  root.innerHTML = reader("p. 2", page(1) + page(2, undefined, ` tabindex="-1"`) + page(3));
  rememberPages(root);
});

describe("a page turned", () => {
  it("keeps the pages that stay, adds the new one, drops the old", () => {
    const [two, three] = [pageAt(2), pageAt(3)];
    const patch = patchReader(root, reader("p. 3", page(2) + page(3, undefined, ` tabindex="-1"`) + page(4)));
    expect(pageAt(2)).toBe(two);
    expect(pageAt(3)).toBe(three);
    expect(patch?.added.map((p) => p.dataset.page)).toEqual(["4"]);
    expect(patch?.removed.map((p) => p.dataset.page)).toEqual(["1"]);
    expect(pageAt(1)).toBeNull();
  });

  it("moves which page takes focus without drawing either again", () => {
    patchReader(root, reader("p. 3", page(2) + page(3, undefined, ` tabindex="-1"`) + page(4)));
    expect(pageAt(2)?.hasAttribute("tabindex")).toBe(false);
    expect(pageAt(2)?.hasAttribute("inert")).toBe(true);
    expect(pageAt(3)?.getAttribute("tabindex")).toBe("-1");
    expect(pageAt(3)?.hasAttribute("inert")).toBe(false);
  });

  it("leaves a page's own fitting alone", () => {
    const lines = pageAt(2)?.querySelector<HTMLElement>(".page-lines") as HTMLElement;
    lines.style.fontSize = "31px";
    patchReader(root, reader("p. 3", page(2) + page(3) + page(4)));
    expect(pageAt(2)?.querySelector<HTMLElement>(".page-lines")?.style.fontSize).toBe("31px");
  });

  it("draws the bars anew, and leaves them be when the same", () => {
    const foot = root.querySelector(".reader-bottom");
    patchReader(root, reader("p. 3", page(1) + page(2, undefined, ` tabindex="-1"`) + page(3)));
    expect(root.querySelector(".reader-top")?.textContent).toBe("p. 3");
    expect(root.querySelector(".reader-bottom")).toBe(foot);
  });

  it("keeps anything else in the pager, such as the leaf's canvas", () => {
    const canvas = document.createElement("canvas");
    root.querySelector("[data-pager]")?.append(canvas);
    patchReader(root, reader("p. 3", page(2) + page(3) + page(4)));
    expect(canvas.parentElement).toBe(root.querySelector("[data-pager]"));
  });
});

describe("a page that changed", () => {
  it("is drawn anew: a mistake marked, or a page's words arrived", () => {
    const [one, two] = [pageAt(1), pageAt(2)];
    const patch = patchReader(root, reader("p. 2", page(1) + page(2, "marked") + page(3)));
    expect(pageAt(1)).toBe(one);
    expect(pageAt(2)).not.toBe(two);
    expect(pageAt(2)?.textContent).toBe("marked");
    expect(patch?.added).toEqual([pageAt(2)]);
    expect(patch?.removed).toEqual([two]);
  });

  it("drawn anew is then compared by what it was drawn from, not by what it has become", () => {
    patchReader(root, reader("p. 2", page(1) + page(2, "marked") + page(3)));
    const two = pageAt(2);
    (two?.querySelector(".page-lines") as HTMLElement).style.fontSize = "31px";
    patchReader(root, reader("p. 2", page(1) + page(2, "marked") + page(3)));
    expect(pageAt(2)).toBe(two);
  });
});

describe("the reader around the pages", () => {
  it("takes the theme, with the pages left as they are", () => {
    const two = pageAt(2);
    patchReader(root, reader("p. 2", page(1) + page(2, undefined, ` tabindex="-1"`) + page(3), { theme: "night" }));
    expect(root.querySelector(".reader")?.classList.contains("theme-night")).toBe(true);
    expect(pageAt(2)).toBe(two);
  });

  it("is drawn whole when the pages go from one open to two", () => {
    expect(patchReader(root, reader("p. 2", page(1), { spread: true }))).toBeNull();
  });

  it("is drawn whole with no book on screen, or none wanted", () => {
    expect(patchReader(root, reader("p. 2", page(1), { book: false }))).toBeNull();
    root.innerHTML = "<main>home</main>";
    expect(patchReader(root, reader("p. 2", page(1)))).toBeNull();
  });

  it("is drawn whole when the HTML is not a reader", () => {
    expect(patchReader(root, "<main>home</main>")).toBeNull();
  });
});
