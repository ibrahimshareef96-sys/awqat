/**
 * The mushaf open on a big screen on its side, as the printed mushaf lies open: two pages side by side, the odd page on
 * the right and the even page on the left (1 and 2, 3 and 4, ... 603 and 604), turned a spread at a time.
 */
import { PAGES } from "./data.ts";

/**
 * Room for two pages: each at least as wide as a phone page (320 px), and tall enough for 15 lines to stay readable.
 * A landscape foldable viewport can be about 790 by 650 after camera and status-bar insets;
 * a landscape phone viewport is typically no taller than about 450.
 */
const MIN_WIDTH = 640;
const MIN_HEIGHT = 500;

/** A big screen held on its side: a tablet or an open foldable. Never a phone on its side (too short). */
export function showsSpread(width: number, height: number): boolean {
  return width >= MIN_WIDTH && height >= MIN_HEIGHT && width > height;
}

/** The right-hand (odd) page of the spread a page is in. */
export function spreadStart(page: number): number {
  return page % 2 === 1 ? page : page - 1;
}

/** The two pages open together, right then left. */
export function spreadPages(page: number): number[] {
  const start = spreadStart(page);
  return [start, start + 1].filter((p) => p >= 1 && p <= PAGES);
}

/** The open spread and the spreads either side, ready for a swipe. */
export function spreadNeighbours(page: number): number[] {
  const start = spreadStart(page);
  return [start - 2, start - 1, start, start + 1, start + 2, start + 3].filter((p) => p >= 1 && p <= PAGES);
}
