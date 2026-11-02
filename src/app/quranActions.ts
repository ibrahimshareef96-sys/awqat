/** What the Quran screen's taps and forms do. */
import { PAGES } from "../quran/data.ts";
import {
  DAILY_GOAL_MAX, deleteEntry, logRead, logRevision, logStudy, setDailyGoal, setPosition, type QuranLog,
} from "../quran/log.ts";
import { bookmarkAfterLog, bookmarkPage, type LogChange } from "../quran/bookmark.ts";
import { moveBookmark } from "../quran/marks.ts";
import { KEYS } from "../store.ts";
import { announce, hooks, save, state, today } from "./state.ts";

/** `change`: how the place in the reading moved, which moves the mushaf's bookmark with it (quran/bookmark.ts). */
async function setQuran(quran: QuranLog, said: string, change?: LogChange): Promise<void> {
  const before = state.quran;
  state.quran = quran;
  state.undoArmed = false;
  const page = change ? bookmarkAfterLog(bookmarkPage(state.mushaf, before), before, quran, change) : null;
  if (page !== null) state.mushaf = moveBookmark(state.mushaf, page);
  hooks.render();
  announce(said);
  await save(KEYS.quran, quran);
  if (page !== null) await save(KEYS.mushaf, state.mushaf);
}

export function readMore(pages: number): void {
  if (!Number.isInteger(pages) || pages < 1 || pages > 20) return;
  readTo(Math.min(PAGES, state.quran.position + pages));
}

export function readTo(page: number): void {
  const next = logRead(state.quran, today(), page);
  if (next === state.quran) {
    announce(`Page ${page} is not ahead of your place, page ${state.quran.position}.`);
    return;
  }
  void setQuran(next, next.position === 0 ? "A full reading complete. MashaAllah." : `Now on page ${next.position}.`,
    "read");
}

/** Your place in a reading begun before the app, set without counting those pages as read today. */
export function setPlace(page: number): void {
  const next = setPosition(state.quran, page);
  if (next === state.quran) {
    announce(`Choose a page from 0 to ${PAGES - 1}.`);
    return;
  }
  void setQuran(next, page === 0 ? "Your place is back at the start." : `Your place is page ${page}.`, "place");
}

/** The first tap arms the button; the second undoes the last reading. */
export function undoLastRead(): void {
  const reads = state.quran.entries.filter((e) => e.kind === "read");
  const last = reads[reads.length - 1];
  if (!last) return;
  if (!state.undoArmed) {
    state.undoArmed = true;
    hooks.render();
    return;
  }
  void setQuran(deleteEntry(state.quran, last.id), "The last reading was undone.", "undo");
}

/** A tap on a juz marks it revised today; a second tap the same day takes that back. */
export function toggleJuz(juz: number): void {
  const date = today();
  const mark = state.quran.entries.find((e) => e.kind === "revise" && e.juz === juz && e.date === date);
  if (mark) void setQuran(deleteEntry(state.quran, mark.id), `Juz ${juz}: not revised today.`);
  else void setQuran(logRevision(state.quran, date, juz), `Juz ${juz}: revised today.`);
}

/** The pages a day the user aims for; 0 clears it. */
export function setGoal(pages: number): void {
  const next = setDailyGoal(state.quran, pages);
  if (next === state.quran && pages !== state.quran.dailyGoal) {
    announce(`Choose a number of pages from 0 to ${DAILY_GOAL_MAX}.`);
    return;
  }
  void setQuran(next, pages === 0 ? "Daily goal cleared." : `Goal: ${pages} page${pages === 1 ? "" : "s"} a day.`);
}

export function addStudy(text: string, minutes: number): void {
  const next = logStudy(state.quran, today(), text, minutes);
  if (next !== state.quran) void setQuran(next, "Study session saved.");
}

export function deleteStudy(id: string): void {
  void setQuran(deleteEntry(state.quran, id), "Study session deleted.");
}
