/**
 * What the page and the speech worker say to each other. Types only: importing the worker's own modules into the page
 * would bundle the speech runtime into it (as agenda/workerMessages.ts does for the calendar worker).
 */
import type { SearchResult } from "./search.ts";

export type ToWorker =
  /** Where the files are (same-origin paths), where the runtime is, and whether their checksums still need checking. */
  | { type: "load"; base: string; tanzil: string; runtime: { mjs: string; wasm: string }; checked: boolean }
  | { type: "hear"; id: number; audio: Float32Array }
  | { type: "find"; id: number; text: string };

export type LoadProblem = "damaged" | "text" | "model";

export type FromWorker =
  | { type: "ready"; checked: boolean }
  | { type: "failed"; why: LoadProblem }
  | { type: "heard"; id: number; text: string }
  | { type: "found"; id: number; result: SearchResult }
  | { type: "error"; id: number };
