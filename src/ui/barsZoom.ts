/**
 * The mushaf's pages while the bars are up: each page's lines are drawn smaller, between the bars, so the bars cover
 * none of the words; with the bars down they fill the screen again. Only a transform changes (never the fitted font),
 * so the change glides from wherever it is on screen and can turn back at any moment (mushaf.css).
 */

/** Space kept between the lines and each bar. */
const GAP_PX = 10;
/** Never smaller than this: on a short screen with a tall bar (a long page note) the bar may cover a little. */
const MIN_SCALE = 0.5;

export interface Span {
  top: number;
  bottom: number;
}

/**
 * How a page's lines (box) are drawn to fit the room between the bars: the scale, and how far the middle moves. As
 * little as it takes: lines already clear of the bars stay as they are; otherwise they shrink to the room's height and
 * move only as far as it takes to clear the bars.
 */
export function barsZoom(box: Span, room: Span): { scale: number; shift: number } {
  const height = box.bottom - box.top;
  const space = room.bottom - room.top;
  if (!(height > 0) || !(space > 0)) return { scale: 1, shift: 0 };
  const scale = Math.max(MIN_SCALE, Math.min(1, space / height));
  const drawn = height * scale;
  const middle = (box.top + box.bottom) / 2;
  // Kept where it is, then moved inside the room (or, if it cannot fit even so, centred on it).
  const top = drawn > space ? (room.top + room.bottom - drawn) / 2
    : Math.min(Math.max(middle - drawn / 2, room.top), room.bottom - drawn);
  return { scale, shift: top + drawn / 2 - middle };
}

/** The room between the bars as they are laid out (hidden bars keep their place, so this holds either way). */
function roomBetweenBars(reader: HTMLElement): Span | null {
  const top = reader.querySelector<HTMLElement>(".reader-top");
  const bottom = reader.querySelector<HTMLElement>(".reader-bottom");
  if (!top || !bottom) return null;
  return { top: top.getBoundingClientRect().bottom + GAP_PX, bottom: bottom.getBoundingClientRect().top - GAP_PX };
}

/** The room between the bars as a value to compare, to tell whether it has changed. */
export function barsRoom(reader: HTMLElement): string {
  const room = roomBetweenBars(reader);
  return room ? `${room.top}|${room.bottom}` : "";
}

/** Each page's zoom for the bars, from the page as laid out (its lines' own box: offsets ignore transforms). */
function fitBars(reader: HTMLElement, all: readonly HTMLElement[]): void {
  const room = roomBetweenBars(reader);
  if (!room) return;
  for (const lines of all) {
    const page = lines.closest<HTMLElement>(".page");
    if (!page) continue;
    const top = page.getBoundingClientRect().top + lines.offsetTop;
    const { scale, shift } = barsZoom({ top, bottom: top + lines.offsetHeight }, room);
    lines.style.setProperty("--bars-scale", scale.toFixed(4));
    lines.style.setProperty("--bars-shift", `${shift.toFixed(1)}px`);
  }
}

/**
 * The pages fitted at full size (a zoom would scale the words' widths as they are measured), then each page's zoom for
 * the bars set at once: a page drawn anew, or fitted again to a new size, never glides into place.
 */
export function fitAtFullSize(reader: HTMLElement, fit: () => void): void {
  const all = Array.from(reader.querySelectorAll<HTMLElement>(".page-lines"));
  fitBoxes(reader, all, all, fit, () => {
    reader.classList.add("fitting");
    return () => reader.classList.remove("fitting");
  });
}

/**
 * The same for some pages only, in a book: `added`, the pages new to it, are fitted and set at once. `zoomed` are all the
 * pages whose zoom is worked out again; those already on screen glide to theirs when a bar's height changes.
 */
export function fitPagesAtFullSize(reader: HTMLElement, added: readonly HTMLElement[], zoomed: readonly HTMLElement[], fit: () => void): void {
  fitBoxes(reader, added, zoomed, fit, () => {
    added.forEach((box) => box.classList.add("fitting"));
    return () => added.forEach((box) => box.classList.remove("fitting"));
  });
}

function fitBoxes(reader: HTMLElement, atOnce: readonly HTMLElement[], zoomed: readonly HTMLElement[], fit: () => void, atFullSize: () => () => void): void {
  const done = atFullSize();
  try {
    fit();
    fitBars(reader, zoomed);
  } finally {
    // Even if a page could not be measured, the pages leave fitting: the zoom and its glide keep working.
    for (const lines of atOnce) lines.style.transition = "none";
    done();
    // The zoom is taken as it now stands before the transitions come back.
    void reader.offsetWidth;
    for (const lines of atOnce) lines.style.transition = "";
  }
}

/** How the reader is drawn this moment, mid-glide included: read just before it is drawn anew. */
export interface ReaderMotion {
  /** The open page's lines' transform ("none" at full size). */
  zoom: string | null;
  /** The bars' opacity. */
  bars: string | null;
}

export function readMotion(root: HTMLElement): ReaderMotion | null {
  const reader = root.querySelector<HTMLElement>(".reader");
  if (!reader) return null;
  const lines = reader.querySelector<HTMLElement>(".page[tabindex] .page-lines") ?? reader.querySelector<HTMLElement>(".page-lines");
  const top = reader.querySelector<HTMLElement>(".reader-top");
  return {
    zoom: lines ? getComputedStyle(lines).transform : null,
    bars: top ? getComputedStyle(top).opacity : null,
  };
}

/**
 * The reader drawn anew (a page turned, a page arrived) starts as the old one was on screen and glides to where it
 * should be: the pages zoom in as the bars fade when a notice goes with a turn, instead of jumping. Under reduced motion
 * the transitions are off, so it is simply where it should be.
 */
export function carryMotion(root: HTMLElement, from: ReaderMotion | null): void {
  const reader = root.querySelector<HTMLElement>(".reader");
  if (!reader || !from) return;
  const lines = from.zoom ? Array.from(reader.querySelectorAll<HTMLElement>(".page-lines")) : [];
  const bars = from.bars ? Array.from(reader.querySelectorAll<HTMLElement>(".reader-top, .reader-bottom")) : [];
  if (!lines.length && !bars.length) return;
  for (const el of lines) {
    el.style.transition = "none";
    el.style.transform = from.zoom ?? "";
  }
  for (const el of bars) {
    el.style.transition = "none";
    el.style.opacity = from.bars ?? "";
  }
  void reader.offsetWidth;
  for (const el of lines) {
    el.style.transition = "";
    el.style.transform = "";
  }
  for (const el of bars) {
    el.style.transition = "";
    el.style.opacity = "";
  }
}
