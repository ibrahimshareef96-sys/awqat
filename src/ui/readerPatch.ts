/**
 * A reader drawn again with the same pager on screen: only what changed is touched. A page that is still there stays the
 * very same element, so the browser keeps what it has already drawn of it and a page turn lands with nothing to repaint.
 * Pages are compared by the HTML they were drawn from, because the page on screen has since been fitted and styled.
 */

const drawnFrom = new WeakMap<Element, string>();

/** What the page was drawn from (the first time it is met, what it holds now, before its fitting). */
const sourceOf = (page: HTMLElement, fallback: string): string => drawnFrom.get(page) ?? fallback;

const ATTRIBUTES = ["class", "aria-label", "tabindex", "inert"];

function copyAttributes(from: Element, to: Element): void {
  for (const name of ATTRIBUTES) {
    const value = from.getAttribute(name);
    if (value === null) to.removeAttribute(name);
    else if (to.getAttribute(name) !== value) to.setAttribute(name, value);
  }
}

function replaceIfChanged(current: Element | null, next: Element | null): void {
  if (!current || !next) return;
  if (current.outerHTML !== next.outerHTML) current.replaceWith(next);
}

export interface ReaderPatch {
  /** Pages put in or drawn anew: these need setting in their font and fitting. */
  added: HTMLElement[];
  /** Pages taken out. */
  removed: HTMLElement[];
}

/** Remembers what the pages on screen were drawn from, right after a full draw and before they are fitted. */
export function rememberPages(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-pager] [data-page]").forEach((page) => { drawnFrom.set(page, page.innerHTML); });
}

/** Brings the reader on screen up to `html` in place. Null if it cannot be done: the caller draws it whole. */
export function patchReader(root: HTMLElement, html: string): ReaderPatch | null {
  const reader = root.querySelector<HTMLElement>(".reader");
  const pager = reader?.querySelector<HTMLElement>("[data-pager].book");
  if (!reader || !pager) return null;
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const nextReader = template.content.querySelector<HTMLElement>(".reader");
  const nextPager = nextReader?.querySelector<HTMLElement>("[data-pager].book");
  if (!nextReader || !nextPager || nextPager.className.replace(" turning", "") !== pager.className.replace(" turning", "")) return null;

  // The theme; whether the bars are hidden is set again straight after, by the caller.
  if (reader.className.replace(" bars-hidden", "") !== nextReader.className) reader.className = nextReader.className;
  replaceIfChanged(reader.querySelector(".reader-top"), nextReader.querySelector(".reader-top"));
  replaceIfChanged(reader.querySelector(".reader-bottom"), nextReader.querySelector(".reader-bottom"));

  const pagesOf = (el: HTMLElement): HTMLElement[] => (Array.from(el.children) as HTMLElement[]).filter((p) => p.dataset.page);
  const present = new Map(pagesOf(pager).map((p) => [p.dataset.page, p]));
  const added: HTMLElement[] = [];
  const removed: HTMLElement[] = [];
  for (const next of pagesOf(nextPager)) {
    const have = present.get(next.dataset.page);
    const source = next.innerHTML;
    if (have && sourceOf(have, "") === source) {
      copyAttributes(next, have);
      present.delete(next.dataset.page);
      continue;
    }
    drawnFrom.set(next, source);
    if (have) {
      have.replaceWith(next);
      removed.push(have);
      present.delete(next.dataset.page);
    } else {
      pager.append(next);
    }
    added.push(next);
  }
  present.forEach((gone) => {
    gone.remove();
    removed.push(gone);
  });
  return { added, removed };
}
