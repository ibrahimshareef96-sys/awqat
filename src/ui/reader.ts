/**
 * The mushaf reader's layout after each redraw. Each page is set in its own font; its lines are sized so the widest
 * fills the page edge to edge, as in print, and shorter lines (a surah's last line, the two opening pages) sit centred.
 * The lines are fitted to the whole screen; while the bars are up they are drawn smaller between them (barsZoom.ts).
 * Turning pages is the browser's own scrolling (snap, momentum, interruption); this only reads where it settled.
 */
import { spreadStart } from "../quran/spread.ts";
import { barsRoom, fitAtFullSize, fitPagesAtFullSize } from "./barsZoom.ts";
import { layOutBook } from "./pageTurn.ts";

const LINES = 15;
/**
 * Line height as a share of the font size: the 1421 print's own spacing, the page fonts' ascent and descent (1.2 and
 * 0.6 of the font size in nearly all of the 604, a little less in the rest). Kept equal to .line's height in mushaf.css.
 */
const LINE_HEIGHT = 1.8;
const SHORT = 0.8;
const MEASURE_PX = 20;
/** How far a line may be spread past its natural width to fill the page. */
const STRETCH_MAX = 1.08;

function naturalWidth(line: HTMLElement): number {
  if (!line.querySelector(".w")) return 0;
  let sum = 0;
  line.querySelectorAll<HTMLElement>(".w").forEach((w) => { sum += w.getBoundingClientRect().width; });
  return sum;
}

function fitLines(box: HTMLElement): void {
  const page = box.closest<HTMLElement>(".page");
  if (!page) return;
  box.style.fontSize = `${MEASURE_PX}px`;
  box.style.maxWidth = "";
  const lines = Array.from(box.querySelectorAll<HTMLElement>(".line"));
  const widths = lines.map(naturalWidth);
  const widest = Math.max(0, ...widths);
  if (widest === 0) return;
  const byWidth = (MEASURE_PX * box.clientWidth * 0.992) / widest;
  const byHeight = page.clientHeight / ((LINES + 1.2) * LINE_HEIGHT);
  const size = Math.max(10, Math.min(byWidth, byHeight));
  box.style.fontSize = `${size.toFixed(2)}px`;
  // A screen wider than a printed page (an unfolded device) keeps the page's shape: lines stretch a little, as in
  // print, and no more, so the words never drift apart.
  if (byWidth > byHeight * STRETCH_MAX) {
    box.style.maxWidth = `${Math.ceil(((widest * size) / MEASURE_PX / 0.992) * STRETCH_MAX + horizontalPadding(box))}px`;
  }
  lines.forEach((line, i) => line.classList.toggle("short", widths[i] > 0 && widths[i] < widest * SHORT));
}

/** The opening pages sit in a framed box with padding; its width counts toward the box's. */
function horizontalPadding(box: HTMLElement): number {
  const style = getComputedStyle(box);
  return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
}

const setFonts = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>("[data-font]").forEach((el) => {
    el.style.fontFamily = `"${el.dataset.font}", serif`;
  });
};

/**
 * A book's reader patched in place (readerPatch.ts): only the pages new to it are set in their font and fitted, each at
 * its full size for a moment. The rest are left alone, as the browser has already drawn them.
 */
export function layoutPatched(root: HTMLElement, added: readonly HTMLElement[], current: number): void {
  const pager = root.querySelector<HTMLElement>("[data-pager]");
  const reader = pager?.closest<HTMLElement>(".reader");
  if (!pager || !reader) return;
  added.forEach(setFonts);
  const boxes = added.flatMap((page) => Array.from(page.querySelectorAll<HTMLElement>(".page-lines")));
  // A bar that changed height (a note saved, a notice) leaves a different room between them for every page's lines.
  const room = barsRoom(reader);
  const roomChanged = reader.dataset.barsRoom !== room;
  reader.dataset.barsRoom = room;
  const zoomed = roomChanged ? Array.from(pager.querySelectorAll<HTMLElement>(".page-lines")) : boxes;
  if (zoomed.length > 0) fitPagesAtFullSize(reader, boxes, zoomed, () => boxes.forEach(fitLines));
  layOutBook(pager, pager.classList.contains("spread") ? spreadStart(current) : current);
}

export function layoutReader(root: HTMLElement, current: number): void {
  const pager = root.querySelector<HTMLElement>("[data-pager]");
  if (!pager) return;
  setFonts(root);
  const fit = (): void => pager.querySelectorAll<HTMLElement>(".page-lines").forEach(fitLines);
  const reader = pager.closest<HTMLElement>(".reader");
  if (reader) {
    fitAtFullSize(reader, fit);
    reader.dataset.barsRoom = barsRoom(reader);
  } else fit();
  // Two pages open: the spread's right-hand page sits at the right edge (the start, right to left), its pair beside it.
  const spread = pager.classList.contains("spread");
  if (pager.classList.contains("book")) return layOutBook(pager, spread ? spreadStart(current) : current);
  pager.querySelector<HTMLElement>(`[data-page="${spread ? spreadStart(current) : current}"]`)
    ?.scrollIntoView({ inline: spread ? "start" : "center", block: "nearest", behavior: "instant" });
}

/** The page the pager settled on: the one whose middle is nearest the pager's middle. */
export function settledPage(pager: HTMLElement): number | null {
  const box = pager.getBoundingClientRect();
  const middle = box.left + box.width / 2;
  let best: { page: number; distance: number } | null = null;
  pager.querySelectorAll<HTMLElement>("[data-page]").forEach((el) => {
    const r = el.getBoundingClientRect();
    const distance = Math.abs(r.left + r.width / 2 - middle);
    const page = Number(el.dataset.page);
    if (!best || distance < best.distance) best = { page, distance };
  });
  return best ? (best as { page: number }).page : null;
}
