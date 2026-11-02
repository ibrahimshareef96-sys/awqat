// @vitest-environment happy-dom
// Redraws replace the screen's HTML; what the hand was on must come back: focus, typed text, open sections.
import { beforeEach, describe, expect, it } from "vitest";
import { keep, restore } from "../src/ui/keep.ts";

const screenHtml = (opts: { note?: string; lesson?: string } = {}) =>
  `<button data-action="quran-plus" data-value="1">+1</button><button data-action="quran-plus" data-value="5">+5</button>` +
  `<form data-form="book-lesson"><input name="text" value="${opts.lesson ?? ""}"></form>` +
  `<textarea id="commentary">${opts.note ?? ""}</textarea>` +
  `<details id="set-place"><summary>Set</summary><input id="place-page" type="number" value="0"></details>`;

let root: HTMLElement;

function redraw(html: string, sent: string | null = null, before = "book:a", after = before): void {
  const kept = keep(root, sent, before);
  root.innerHTML = html;
  restore(root, kept, after);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById("app") as HTMLElement;
  root.innerHTML = screenHtml();
});

describe("keeping focus", () => {
  it("puts focus back on the same button, not the first one with the same action", () => {
    (root.querySelector('[data-value="5"]') as HTMLElement).focus();
    redraw(screenHtml());
    expect((document.activeElement as HTMLElement).dataset.value).toBe("5");
  });

  it("puts focus back in the field being typed in, with its caret", () => {
    const notes = root.querySelector("#commentary") as HTMLTextAreaElement;
    notes.focus();
    notes.value = "Identity first";
    notes.setSelectionRange(3, 3);
    redraw(screenHtml());
    const after = root.querySelector("#commentary") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("Identity first");
    expect(after.selectionStart).toBe(3);
  });
});

describe("keeping typed text", () => {
  it("gives back text typed but not yet saved", () => {
    (root.querySelector('[name="text"]') as HTMLInputElement).value = "Small habits compound";
    redraw(screenHtml());
    expect((root.querySelector('[name="text"]') as HTMLInputElement).value).toBe("Small habits compound");
  });

  it("clears the fields of the form just sent", () => {
    (root.querySelector('[name="text"]') as HTMLInputElement).value = "Saved lesson";
    redraw(screenHtml(), "book-lesson");
    expect((root.querySelector('[name="text"]') as HTMLInputElement).value).toBe("");
  });

  it("shows the saved value when it changed underneath the typing", () => {
    (root.querySelector("#commentary") as HTMLTextAreaElement).value = "typed";
    redraw(screenHtml({ note: "saved elsewhere" }));
    expect((root.querySelector("#commentary") as HTMLTextAreaElement).value).toBe("saved elsewhere");
  });

  it("never carries text from one book to another", () => {
    (root.querySelector('[name="text"]') as HTMLInputElement).value = "A lesson for book A";
    redraw(screenHtml(), null, "book:a", "book:b");
    expect((root.querySelector('[name="text"]') as HTMLInputElement).value).toBe("");
  });
});

describe("keeping open sections", () => {
  it("keeps an opened section open across a redraw", () => {
    (root.querySelector("#set-place") as HTMLDetailsElement).open = true;
    redraw(screenHtml());
    expect((root.querySelector("#set-place") as HTMLDetailsElement).open).toBe(true);
  });
});
