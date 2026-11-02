/**
 * Where the mushaf opens to read on: the bookmark (marks.lastPage), like the ribbon in a printed mushaf. Reading on in
 * the mushaf moves it to the page shown (app/mushafActions.ts); a change to the user's log moves it as below, so the page after
 * what the user logged is never behind it.
 */
import { PAGES } from "./data.ts";
import type { QuranLog } from "./log.ts";
import type { MushafMarks } from "./marks.ts";

/** "read": read to a page or +pages; "place": set my place; "undo": the last reading taken back. */
export type LogChange = "read" | "place" | "undo";

/** The page after a place in the log: 0 (not started, or a reading just completed) is page 1. */
export const pageAfter = (position: number): number => Math.min(PAGES, Math.max(1, Math.round(position) + 1));

/**
 * Where the mushaf opens to read on: the bookmark once it has been set (in 0.13 or later, here or on another device),
 * and before that the page after the user's logged place (0.12's last page open also moved with revision links).
 */
export const bookmarkPage = (marks: MushafMarks, quran: QuranLog): number =>
  marks.lastPageAt > 0 ? Math.min(PAGES, Math.max(1, marks.lastPage)) : pageAfter(quran.position);

/**
 * The bookmark after a change to the log, or null when it stays where it is:
 * - a reading completed starts again at page 1;
 * - read to, or +pages: never behind the page after the new place (reading ahead in the mushaf is kept);
 * - set my place: the page after it, whichever way it moved (the user is correcting it);
 * - undo: back with the place, when the bookmark was following it.
 */
export function bookmarkAfterLog(bookmark: number, before: QuranLog, after: QuranLog, change: LogChange): number | null {
  let next: number = bookmark;
  if (change === "read" && after.completed > before.completed) next = 1;
  else if (change === "read") next = Math.max(bookmark, pageAfter(after.position));
  else if (change === "place") next = pageAfter(after.position);
  else if (bookmark === pageAfter(before.position)) next = pageAfter(after.position);
  return next === bookmark ? null : next;
}
