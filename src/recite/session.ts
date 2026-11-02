/** Where recitation stands on screen: the recite-to-find sheet, and a page being memorised. Types only. */
import type { Memorise } from "./align.ts";
import type { SearchResult } from "./search.ts";

export type ReciteProblem =
  /** The microphone is refused for the app, or there is none, or it would not start. */
  | "mic" | "noMic" | "audio"
  /** The download could not reach the internet, or what came back was not the files. */
  | "offline" | "download"
  /** A file on the phone is not the one pinned; or the model or text would not load. */
  | "damaged" | "model"
  /** The app went to the background while listening. */
  | "away"
  /** A browser, not the installed app. */
  | "web";

export type FindPhase = "intro" | "downloading" | "preparing" | "listening" | "finding" | "result" | "problem";

export interface FindFlow {
  phase: FindPhase;
  /** Download progress, 0 to 1. */
  progress: number;
  result: SearchResult | null;
  problem: ReciteProblem | null;
  /** What the sheet was opened for: after the one-time download, memorising starts instead of finding. */
  then: "find" | "memorise";
}

export type MemorisePhase = "preparing" | "listening" | "paused" | "left";

export interface MemoriseSession {
  /** The page the reader was on when memorising began (with two pages open, the right-hand one). */
  page: number;
  /** Every page whose words are hidden: the page, or both pages of the spread. */
  pages: readonly number[];
  m: Memorise;
  phase: MemorisePhase;
  /** Stretches of recitation the model is still hearing. */
  working: number;
  problem: ReciteProblem | null;
  /** Counts each fresh start of the page, so a stretch heard for an earlier one is let go. */
  attempt: number;
}

export const closedFind = (): FindFlow => ({ phase: "intro", progress: 0, result: null, problem: null, then: "find" });
