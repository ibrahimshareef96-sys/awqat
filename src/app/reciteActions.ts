/**
 * Recitation: recite to find an ayah, and memorise a page. The microphone's sound is cut at the reciter's pauses
 * (recite/audio.ts), heard by the speech worker on this device (recite/engine.ts), and laid on the Quran's text
 * (recite/search.ts) or on the page (recite/align.ts). Nothing leaves the device but the one-time download.
 */
import { micRefused } from "../talk/mic.ts";
import { slips, startMemorise, hearChunk, peek, clearSlip } from "../recite/align.ts";
import { FIND_CUT, MEMORISE_CUT, flush, hearFrame, level, startListening, type Cut, type Listening } from "../recite/audio.ts";
import { downloadReciteFiles, reciteFiles, removeReciteFiles, type ReciteFiles } from "../recite/assets.ts";
import * as engine from "../recite/engine.ts";
import { startCapture, type Capture } from "../recite/mic.ts";
import { closedFind, type FindFlow, type ReciteProblem } from "../recite/session.ts";
import { pageOfAyah } from "../quran/pages.ts";
import { paintFind, paintLit, paintMemorise } from "../ui/reciteView.ts";
import { hooks, setNotice, state } from "./state.ts";
import * as mushaf from "./mushafActions.ts";

/** Recite to find listens this long at most (tenths of a second). */
const FIND_LONGEST = 90;
/** An ayah found stays lit this long once its page opens. */
const LIT_MS = 4000;

let capture: Capture | null = null;
let heard: Listening = startListening();
/** Each start of the microphone gets a number, so a late answer from an earlier one is let go. */
let run = 0;

type Ready = Extract<ReciteFiles, { ready: true }>;

const overlay = (): HTMLElement | null => document.getElementById("overlay");
/** The sheet's phase as it is now (after an await, not as it was when the function began). */
const phaseNow = (): FindFlow["phase"] => state.recite.phase;

function setFind(change: Partial<FindFlow>): void {
  state.recite = { ...state.recite, ...change };
  hooks.renderOverlay();
}

function stopMic(): void {
  capture?.stop();
  capture = null;
  run += 1;
}

const problemOf = (error: unknown): ReciteProblem => (micRefused(error) ? "mic" : "noMic");

/** Starts the speech worker on the files; a damaged download is taken off the phone. */
async function ready(files: Ready): Promise<ReciteProblem | null> {
  const loaded = await engine.prepare(files);
  if (loaded.ok) return null;
  if (loaded.why === "damaged" || loaded.why === "text") {
    await removeReciteFiles();
    return "damaged";
  }
  return "model";
}

/** Opens the recite-to-find sheet: straight to listening when the files are here, else the one-time download. */
export async function openFind(then: FindFlow["then"] = "find"): Promise<void> {
  stopMic();
  state.recite = { ...closedFind(), then };
  state.sheet = "recite";
  hooks.renderOverlay();
  const files = await reciteFiles();
  if (state.sheet !== "recite") return;
  if (!files.ready) return setFind({ phase: "intro" });
  await carryOn(files);
}

/** After the files are known to be here: find, or start memorising, as the sheet was opened for. */
async function carryOn(files: Ready): Promise<void> {
  setFind({ phase: "preparing" });
  const problem = await ready(files);
  if (state.sheet !== "recite") return;
  if (problem) return setFind({ phase: "problem", problem });
  if (state.recite.then === "memorise") {
    hooks.closeSheet(true);
    return beginMemorise(files);
  }
  await listenFind();
}

export async function download(): Promise<void> {
  setFind({ phase: "downloading", progress: 0, problem: null });
  const result = await downloadReciteFiles((done, total) => {
    state.recite = { ...state.recite, progress: total ? done / total : 0 };
    const root = overlay();
    if (root) paintFind(root, state.recite, 0);
  });
  if (state.sheet !== "recite") return;
  if (!result.ok) return setFind({ phase: "problem", problem: result.why === "web" ? "web" : result.why === "offline" ? "offline" : "download" });
  const files = await reciteFiles();
  if (!files.ready) return setFind({ phase: "problem", problem: "download" });
  await carryOn(files);
}

async function listenFind(): Promise<void> {
  stopMic();
  heard = startListening();
  setFind({ phase: "listening", result: null, problem: null });
  const mine = run;
  try {
    const started = await startCapture((frame) => {
      if (mine !== run) return;
      const out = hearFrame(heard, frame, FIND_CUT);
      heard = out.state;
      const root = overlay();
      if (root) paintFind(root, state.recite, level(frame));
      if (out.stretch) void finishFind(out.stretch);
      else if (heard.total >= FIND_LONGEST) void finishFind(flush(heard, FIND_CUT));
    });
    if (mine !== run) return started.stop();
    capture = started;
  } catch (error) {
    if (mine === run) setFind({ phase: "problem", problem: problemOf(error) });
  }
}

/** The reciter tapped Stop: what was heard so far is looked for. */
export function stopFind(): void {
  if (state.recite.phase !== "listening") return;
  void finishFind(flush(heard, FIND_CUT));
}

async function finishFind(audio: Float32Array | null): Promise<void> {
  if (state.recite.phase !== "listening") return;
  stopMic();
  if (!audio) return setFind({ phase: "result", result: { kind: "short" } });
  setFind({ phase: "finding" });
  const text = await engine.hear(audio);
  const result = text ? await engine.find(text) : { kind: "short" as const };
  // Read afresh: the sheet may have closed, or the reciter started again, while the model was hearing.
  if (state.sheet !== "recite" || phaseNow() !== "finding") return;
  if (!result) return setFind({ phase: "problem", problem: "model" });
  setFind({ phase: "result", result });
}

export function again(): void {
  if (state.sheet !== "recite") return;
  void listenFind();
}

/** Opens the page of an ayah found ("sura:ayah"), with the ayah lit for a moment. */
export function openFound(value: string): void {
  const [sura, aya] = value.split(":").map(Number);
  const page = pageOfAyah(sura, aya);
  if (page === null) return;
  stopMic();
  hooks.closeSheet(true);
  state.reciteLit = `${sura}:${aya}`;
  hooks.go(`mushaf:${page}`);
  setTimeout(() => {
    if (state.reciteLit !== `${sura}:${aya}`) return;
    state.reciteLit = null;
    paintLit(document, null);
  }, LIT_MS);
}

/** Memorise this page: its words hidden, then filled in as they are recited. */
export async function startMemorising(): Promise<void> {
  const page = mushaf.pageWords(state.mushafPage);
  if (!page || page.words.length === 0) {
    setNotice("This page has not opened yet. Try again once its words are here.");
    return hooks.render();
  }
  const files = await reciteFiles();
  if (!files.ready) return openFind("memorise");
  await beginMemorise(files);
}

async function beginMemorise(files: Ready): Promise<void> {
  const page = mushaf.pageWords(state.mushafPage);
  if (!page) return;
  state.memorise = { page: state.mushafPage, m: startMemorise(page.words), phase: "preparing", working: 0, problem: null };
  hooks.render();
  const problem = await ready(files);
  if (!state.memorise) return;
  if (problem) {
    state.memorise = { ...state.memorise, problem, phase: "paused" };
    return hooks.render();
  }
  await listenMemorise();
}

async function heardStretch(audio: Float32Array, page: number): Promise<void> {
  if (!state.memorise || state.memorise.page !== page) return;
  state.memorise = { ...state.memorise, working: state.memorise.working + 1 };
  hooks.render();
  const text = await engine.hear(audio);
  const now = state.memorise;
  if (!now || now.page !== page) return;
  state.memorise = { ...now, m: text ? hearChunk(now.m, text) : now.m, working: Math.max(0, now.working - 1) };
  hooks.render();
}

async function listenMemorise(): Promise<void> {
  const session = state.memorise;
  if (!session) return;
  stopMic();
  heard = startListening();
  state.memorise = { ...session, phase: "listening", problem: null };
  hooks.render();
  const mine = run;
  const page = session.page;
  const cut: Cut = MEMORISE_CUT;
  try {
    const started = await startCapture((frame) => {
      if (mine !== run) return;
      const out = hearFrame(heard, frame, cut);
      heard = out.state;
      if (out.stretch) void heardStretch(out.stretch, page);
    });
    if (mine !== run) return started.stop();
    capture = started;
  } catch (error) {
    if (mine !== run || !state.memorise) return;
    state.memorise = { ...state.memorise, phase: "paused", problem: problemOf(error) };
    hooks.render();
  }
}

/** Stops listening; what was being said is still heard and laid on the page. */
function pauseMemorise(): void {
  const session = state.memorise;
  if (!session) return;
  const rest = flush(heard, MEMORISE_CUT);
  stopMic();
  heard = startListening();
  state.memorise = { ...session, phase: session.phase === "left" ? "left" : "paused" };
  hooks.render();
  if (rest) void heardStretch(rest, session.page);
}

export function toggleListening(): void {
  const session = state.memorise;
  if (!session || session.phase === "preparing") return;
  if (session.phase === "listening") return pauseMemorise();
  void listenMemorise();
}

export function peekWord(): void {
  if (!state.memorise) return;
  state.memorise = { ...state.memorise, m: peek(state.memorise.m) };
  hooks.render();
}

export function finishMemorising(): void {
  if (!state.memorise) return;
  if (state.memorise.phase === "listening") pauseMemorise();
  state.sheet = "memorise-done";
  hooks.renderOverlay();
}

export function clearWordSlip(key: string): void {
  if (!state.memorise) return;
  state.memorise = { ...state.memorise, m: clearSlip(state.memorise.m, key) };
  hooks.render();
  hooks.renderOverlay();
}

export async function keepSlips(): Promise<void> {
  const session = state.memorise;
  if (!session) return;
  const words = slips(session.m);
  state.memorise = null;
  await mushaf.keepMistakes(words, `${words.length} kept for revision.`);
}

export function memoriseAgain(): void {
  const page = state.memorise ? mushaf.pageWords(state.memorise.page) : null;
  if (!state.memorise || !page) return;
  state.memorise = { ...state.memorise, m: startMemorise(page.words), phase: "paused", working: 0, problem: null };
  hooks.closeSheet(true);
  void listenMemorise();
}

export function endMemorising(): void {
  stopMic();
  state.memorise = null;
  if (state.sheet === "memorise-done") hooks.closeSheet(true);
  hooks.render();
}

/** Back to the page being memorised, from a page turned to. */
export function backToPage(): void {
  const session = state.memorise;
  if (!session) return;
  mushaf.turnTo(session.page);
  state.memorise = { ...session, phase: "paused" };
  hooks.render();
}

/**
 * After every draw of the reader: a page memorised is painted in place, a page turned away from stops the listening,
 * and an ayah just found is lit.
 */
export function afterReaderDraw(root: ParentNode): void {
  const session = state.memorise;
  // A change of phase is drawn after this draw has finished, never inside it.
  if (session && session.page !== state.mushafPage && session.phase !== "left") {
    stopMic();
    state.memorise = { ...session, phase: "left" };
    queueMicrotask(hooks.render);
    return;
  }
  if (session && session.page === state.mushafPage && session.phase === "left") {
    state.memorise = { ...session, phase: "paused" };
    queueMicrotask(hooks.render);
    return;
  }
  paintMemorise(root, state.memorise);
  paintLit(root, state.reciteLit);
}

/** The reader closed: the microphone and the speech model are let go, and a memorising is ended. */
export function leaveReader(): void {
  stopMic();
  state.memorise = null;
  if (state.sheet !== "recite") engine.release();
}

/** The recite sheet closed: the microphone stops (the model stays loaded while the reader is open). */
export function sheetClosed(): void {
  if (state.recite.phase === "listening" || state.recite.phase === "finding") stopMic();
  state.recite = closedFind();
}
