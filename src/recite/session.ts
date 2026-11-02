/** Where recitation stands on screen: the recite-to-find sheet, and a page being memorised. Types only. */
import type { Memorise } from "./align.ts";
import type { SearchResult } from "./search.ts";

export type ReciteProblem =
  /** The microphone is refused for the app, or there is none. */
  | "mic" | "noMic"
  /** The download could not reach the internet, or what came back was not the files. */
  | "offline" | "download"
  /** A file on the phone is not the one pinned; or the model or text would not load. */
  | "damaged" | "model"
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
  page: number;
  m: Memorise;
  phase: MemorisePhase;
  /** Stretches of recitation the model is still hearing. */
  working: number;
  problem: ReciteProblem | null;
}

export const closedFind = (): FindFlow => ({ phase: "intro", progress: 0, result: null, problem: null, then: "find" });
