/**
 * Recitation: recite to find an ayah, and memorise a page. The microphone's sound is cut at the reciter's pauses
 * (recite/audio.ts), heard by the speech worker on this device (recite/engine.ts), and laid on the Quran's text
 * (recite/search.ts) or on the page (recite/align.ts). Nothing leaves the device but the one-time download.
 *
 * The microphone is on only while the sheet says "Listening" or the memorise bar shows it listening: every start
 * takes a number (`run`), so a late start, or a late frame, from an earlier one is let go.
 */
import { Browser } from "@capacitor/browser";
import { isNative } from "../device.ts";
import { micRefused } from "../talk/mic.ts";
import { slips, startMemorise, hearChunk, peek, clearSlip } from "../recite/align.ts";
import { FIND_CUT, MEMORISE_CUT, flush, hearFrame, level, startListening, type Listening } from "../recite/audio.ts";
import {
  downloadReciteFiles, markReady, reciteFiles, removeReciteFiles, type DownloadResult, type ReciteFiles,
} from "../recite/assets.ts";
import * as engine from "../recite/engine.ts";
import { startCapture, type Capture } from "../recite/mic.ts";
import { closedFind, type FindFlow, type MemoriseSession, type ReciteProblem } from "../recite/session.ts";
import { pageOfAyah } from "../quran/pages.ts";
import type { MushafWord } from "../quran/mushafPage.ts";
import { paintFind, paintLit, paintMemorise } from "../ui/reciteView.ts";
import { announce, hooks, setNotice, state } from "./state.ts";
import * as mushaf from "./mushafActions.ts";

/** Recite to find listens this long at most (tenths of a second). */
const FIND_LONGEST = 90;
/** An ayah found stays lit this long once its page opens. */
const LIT_MS = 4000;
/** Where the Tanzil Project keeps track of changes to its text. */
const TANZIL_SITE = "https://tanzil.net";

let capture: Capture | null = null;
/** The microphone is being started: on Android its permission prompt pauses the app, which is not going away. */
let starting = false;
/**
 * The app is in the background. A download or a model load that finishes there never opens the microphone: listening
 * waits until the app is back and the reciter asks again.
 */
let away = false;
let heard: Listening = startListening();
/** Each start of the microphone gets a number, so a late start or frame from an earlier one is let go. */
let run = 0;
/** Each fresh start of memorising gets a number, so a stretch heard for an earlier one is let go. */
let attempts = 0;
/** The download in progress: a second tap, or the sheet opened again, waits for the same one. */
let downloading: Promise<DownloadResult> | null = null;

type Ready = Extract<ReciteFiles, { ready: true }>;

const overlay = (): HTMLElement | null => document.getElementById("overlay");
/** The sheet's phase as it is now (after an await, not as it was when the function began). */
const phaseNow = (): FindFlow["phase"] => state.recite.phase;

function setFind(change: Partial<FindFlow>): void {
  state.recite = { ...state.recite, ...change };
  hooks.renderOverlay();
}

function setMemorise(change: Partial<MemoriseSession>): void {
  if (!state.memorise) return;
  state.memorise = { ...state.memorise, ...change };
  hooks.render();
}

/** Stops the microphone, and makes any start or frame still on its way from it count for nothing. */
function stopMic(): void {
  capture?.stop();
  capture = null;
  starting = false;
  run += 1;
}

const outOfSight = (): boolean => away || (typeof document !== "undefined" && document.hidden);

/** A page memorised is in view: the open page, or either page of the open spread (a turn lands on either). */
function inViewOf(s: MemoriseSession): boolean {
  const shown = mushaf.pagesInView();
  return s.pages.some((p) => shown.includes(p));
}

/**
 * The model could not hear what it was given (it failed on it, or the worker is gone): it is let go, so the next try
 * loads it afresh, and the reciter is told instead of being asked for more words.
 */
function modelFailed(): void {
  engine.release();
}

function problemOf(error: unknown): ReciteProblem {
  if (micRefused(error)) return "mic";
  const name = error !== null && typeof error === "object" ? (error as { name?: unknown }).name : "";
  return name === "NotFoundError" ? "noMic" : "audio";
}

/** Starts the speech worker on the files; a damaged download is taken off the phone. */
async function ready(files: Ready): Promise<ReciteProblem | null> {
  const loaded = await engine.prepare(files);
  if (loaded.ok) return null;
  if (loaded.why === "damaged" || loaded.why === "text") {
    await removeReciteFiles();
    return "damaged";
  }
  // The files are checked again next time: a model that will not start may be a file damaged since it was checked.
  await markReady(false);
  return "model";
}

/** Opens the recite-to-find sheet: straight to listening when the files are here, else the one-time download. */
export async function openFind(then: FindFlow["then"] = "find"): Promise<void> {
  stopMic();
  state.recite = { ...closedFind(), phase: "preparing", then };
  state.sheet = "recite";
  hooks.renderOverlay();
  if (downloading) return void watchDownload();
  const files = await reciteFiles();
  if (state.sheet !== "recite") return;
  if (!files.ready) return setFind({ phase: "intro" });
  await carryOn(files);
}

/** After the files are known to be here: find, or start memorising, as the sheet was opened for. */
async function carryOn(files: Ready): Promise<void> {
  setFind({ phase: "preparing", problem: null });
  const problem = await ready(files);
  if (state.sheet !== "recite") return;
  if (problem) return setFind({ phase: "problem", problem });
  if (state.recite.then === "memorise") {
    hooks.closeSheet(true);
    return beginMemorise(files);
  }
  await listenFind();
}

export function download(): Promise<void> {
  if (!downloading) {
    downloading = downloadReciteFiles((done, total) => {
      if (state.sheet !== "recite" || phaseNow() !== "downloading") return;
      state.recite = { ...state.recite, progress: total ? done / total : 0 };
      const root = overlay();
      if (root) paintFind(root, state.recite, 0);
    }).finally(() => { downloading = null; });
  }
  return watchDownload();
}

/** Shows the download going on, and carries on once it has finished. */
async function watchDownload(): Promise<void> {
  const running = downloading;
  if (!running) return;
  setFind({ phase: "downloading", problem: null });
  const result = await running;
  if (state.sheet !== "recite") return;
  if (!result.ok) {
    return setFind({ phase: "problem", problem: result.why === "web" ? "web" : result.why === "offline" ? "offline" : "download" });
  }
  const files = await reciteFiles();
  if (!files.ready) return setFind({ phase: "problem", problem: "download" });
  await carryOn(files);
}

async function listenFind(): Promise<void> {
  stopMic();
  if (outOfSight()) return setFind({ phase: "problem", problem: "away" });
  const mine = run;
  heard = startListening();
  setFind({ phase: "listening", result: null, problem: null });
  announce("Listening. Recite a few words.");
  try {
    starting = true;
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
    // The page went out of sight while the microphone started (Android's prompt never hides it): it stops at once.
    if (outOfSight()) appAway(false);
  } catch (error) {
    if (mine === run) setFind({ phase: "problem", problem: problemOf(error) });
  } finally {
    if (mine === run) starting = false;
  }
}

/** The reciter tapped Stop: what was heard so far is looked for. */
export function stopFind(): void {
  if (phaseNow() !== "listening") return;
  void finishFind(flush(heard, FIND_CUT));
}

async function finishFind(audio: Float32Array | null): Promise<void> {
  if (phaseNow() !== "listening") return;
  stopMic();
  // This recitation's number: closing the sheet or reciting again takes a new one, so a late answer is let go.
  const mine = run;
  const current = (): boolean => mine === run && state.sheet === "recite" && phaseNow() === "finding";
  if (!audio) return setFind({ phase: "result", result: { kind: "short" } });
  setFind({ phase: "finding" });
  const text = await engine.hear(audio);
  if (!current()) return;
  if (text === null) {
    modelFailed();
    return setFind({ phase: "problem", problem: "model" });
  }
  const result = text ? await engine.find(text) : { kind: "short" as const };
  if (!current()) return;
  if (!result) {
    modelFailed();
    return setFind({ phase: "problem", problem: "model" });
  }
  setFind({ phase: "result", result });
}

/** Recite again: listens at once when the model is loaded, else loads it first (after a failure, say). */
export function again(): void {
  if (state.sheet !== "recite") return;
  if (!engine.isReady()) return void openFind(state.recite.then);
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

/** The words of every page in view, in reading order, with each word's place; null while a page has not opened. */
function wordsInView(): { pages: number[]; words: MushafWord[] } | null {
  const pages = mushaf.pagesInView();
  const found = pages.map((p) => mushaf.pageWords(p));
  if (found.some((p) => !p || p.words.length === 0)) return null;
  return { pages, words: found.flatMap((p) => p!.words) };
}

/** Memorise the page (or both pages open): their words hidden, then filled in as they are recited. */
export async function startMemorising(): Promise<void> {
  if (!wordsInView()) {
    setNotice("This page has not opened yet. Try again once its words are here.");
    return hooks.render();
  }
  const files = await reciteFiles();
  // The reader may have closed while the files were looked for: nothing starts, and no sheet opens over another screen.
  if (state.screen !== "mushaf") return;
  if (!files.ready) return openFind("memorise");
  await beginMemorise(files);
}

async function beginMemorise(files: Ready): Promise<void> {
  // Only on the reader: leaving it ends a memorising (leaveReader), and nothing would end one started after.
  if (state.screen !== "mushaf") return;
  const view = wordsInView();
  if (!view) return;
  attempts += 1;
  const attempt = attempts;
  state.memorise = { page: state.mushafPage, pages: view.pages, m: startMemorise(view.words), phase: "preparing",
    working: 0, problem: null, attempt };
  hooks.render();
  const problem = await ready(files);
  const now = state.memorise;
  // Only this same start goes on, and only while it still waits: Done, a turn of the page or an end come first.
  if (!now || now.attempt !== attempt || now.phase !== "preparing") return;
  if (problem) return setMemorise({ phase: "paused", problem });
  await listenMemorise();
}

async function heardStretch(audio: Float32Array, attempt: number): Promise<void> {
  if (!state.memorise || state.memorise.attempt !== attempt) return;
  setMemorise({ working: state.memorise.working + 1 });
  const text = await engine.hear(audio);
  const now = state.memorise;
  if (!now || now.attempt !== attempt) return;
  const working = Math.max(0, now.working - 1);
  if (text === null) {
    // The model failed on it: listening stops and says so, rather than filling nothing in without a word.
    if (now.phase === "listening") stopMic();
    modelFailed();
    state.memorise = { ...now, working, problem: "model", phase: now.phase === "listening" ? "paused" : now.phase };
  } else state.memorise = { ...now, m: text ? hearChunk(now.m, text) : now.m, working };
  hooks.render();
  // The summary drawn while this stretch was being heard is brought up to date.
  if (state.sheet === "memorise-done") hooks.renderOverlay();
}

async function listenMemorise(): Promise<void> {
  const session = state.memorise;
  if (!session) return;
  if (!inViewOf(session)) return setMemorise({ phase: "left" });
  // Never under the summary, and never with the app out of sight.
  if (state.sheet === "memorise-done" || outOfSight()) return setMemorise({ phase: "paused" });
  stopMic();
  const mine = run;
  heard = startListening();
  setMemorise({ phase: "listening", problem: null });
  // The draw above may have found the page turned away (afterReaderDraw stops the microphone): then nothing starts.
  if (mine !== run || state.memorise?.phase !== "listening") return;
  const attempt = session.attempt;
  try {
    starting = true;
    const started = await startCapture((frame) => {
      if (mine !== run) return;
      const out = hearFrame(heard, frame, MEMORISE_CUT);
      heard = out.state;
      if (out.stretch) void heardStretch(out.stretch, attempt);
    });
    if (mine !== run) return started.stop();
    capture = started;
    if (outOfSight()) appAway(false);
  } catch (error) {
    if (mine !== run || !state.memorise) return;
    setMemorise({ phase: "paused", problem: problemOf(error) });
  } finally {
    if (mine === run) starting = false;
  }
}

/** Stops listening; what was being said is still heard and laid on the page. */
function pauseMemorise(): void {
  const session = state.memorise;
  if (!session) return;
  const rest = flush(heard, MEMORISE_CUT);
  stopMic();
  heard = startListening();
  setMemorise({ phase: session.phase === "left" ? "left" : "paused" });
  if (rest) void heardStretch(rest, session.attempt);
}

export async function toggleListening(): Promise<void> {
  const session = state.memorise;
  if (!session || session.phase === "preparing") return;
  if (session.phase === "listening") return pauseMemorise();
  // After a model or file failure, the model is loaded again (and the files checked again) before listening.
  if (!engine.isReady()) {
    setMemorise({ phase: "preparing", problem: null });
    const files = await reciteFiles();
    // Done, a new start or an end may have come while the files were looked for.
    const waited = state.memorise;
    if (!waited || waited.attempt !== session.attempt || waited.phase !== "preparing") return;
    if (!files.ready) {
      setMemorise({ phase: "paused" });
      return openFind("memorise");
    }
    const problem = await ready(files);
    const now = state.memorise;
    if (!now || now.attempt !== session.attempt || now.phase !== "preparing") return;
    if (problem) return setMemorise({ phase: "paused", problem });
  }
  await listenMemorise();
}

export function peekWord(): void {
  if (!state.memorise) return;
  setMemorise({ m: peek(state.memorise.m) });
}

/**
 * A page is being memorised (not left for another page): its hidden words stay hidden, so holding one opens nothing.
 */
export const memorising = (): boolean => state.memorise !== null && state.memorise.phase !== "left";

/**
 * A sheet is laid over the page (the summary, or Talk opened by a link or Siri with the app still in front): listening
 * stops, and a model still getting ready does not start it under the sheet.
 */
export function pauseForSheet(): void {
  const phase = state.memorise?.phase;
  if (phase === "listening") pauseMemorise();
  else if (phase === "preparing") setMemorise({ phase: "paused" });
}

export function finishMemorising(): void {
  if (!state.memorise) return;
  pauseForSheet();
  state.sheet = "memorise-done";
  hooks.renderOverlay();
}

export function clearWordSlip(key: string): void {
  if (!state.memorise) return;
  setMemorise({ m: clearSlip(state.memorise.m, key) });
  hooks.renderOverlay();
}

/** Keeps the slips and peeks as revision mistakes; the session ends only once they are saved. */
export async function keepSlips(): Promise<void> {
  const session = state.memorise;
  if (!session || session.working > 0) return;
  stopMic();
  const words = slips(session.m);
  const saved = await mushaf.keepMistakes(words, `${words.length} kept for revision.`);
  if (saved && state.memorise?.attempt === session.attempt) {
    state.memorise = null;
    hooks.render();
  }
}

export function memoriseAgain(): void {
  const session = state.memorise;
  if (!session) return;
  if (!inViewOf(session)) mushaf.turnTo(session.page);
  const view = wordsInView();
  if (!view) return;
  attempts += 1;
  state.memorise = { ...session, pages: view.pages, m: startMemorise(view.words), phase: "paused", working: 0, problem: null,
    attempt: attempts };
  hooks.closeSheet(true);
  void toggleListening();
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
  setMemorise({ phase: "paused" });
}

/**
 * After every draw of the reader: a page memorised is painted in place, a page turned away from stops the listening,
 * and an ayah just found is lit.
 */
export function afterReaderDraw(root: ParentNode): void {
  const session = state.memorise;
  const shown = session ? inViewOf(session) : false;
  // A change of phase is drawn after this draw has finished, never inside it.
  if (session && !shown && session.phase !== "left") {
    stopMic();
    state.memorise = { ...session, phase: "left" };
    queueMicrotask(hooks.render);
    return;
  }
  if (session && shown && session.phase === "left") {
    state.memorise = { ...session, phase: "paused" };
    queueMicrotask(hooks.render);
    return;
  }
  paintMemorise(root, state.memorise);
  paintLit(root, state.reciteLit);
}

/**
 * The app went to the background: listening stops, and says so (the system may cut the microphone anyway). Android's
 * microphone prompt pauses the app too: while that is open, listening is left to start once it is answered. Only the
 * pause event may be the prompt (`android` true); the page hidden is always the app going away (main.ts).
 */
export function appAway(android: boolean): void {
  if (starting && android) return;
  // Whatever the phase: a download or load still going finishes, but does not start listening (outOfSight).
  away = true;
  if (state.sheet === "recite" && phaseNow() === "listening") {
    stopMic();
    setFind({ phase: "problem", problem: "away" });
  }
  if (state.memorise?.phase === "listening") pauseMemorise();
}

/** The app is back in sight: listening may start again, when the reciter asks for it. */
export function appBack(): void {
  away = false;
}

/** The reader closed: the microphone and the speech model are let go, and a memorising is ended. */
export function leaveReader(): void {
  stopMic();
  state.memorise = null;
  if (state.sheet !== "recite") engine.release();
}

/** The recite sheet closed: the microphone stops (the model stays loaded while the reader is open). */
export function sheetClosed(): void {
  if (phaseNow() === "listening" || phaseNow() === "finding") stopMic();
  state.recite = closedFind();
}

/** The Tanzil text's link in Settings, which its terms ask for: tanzil.net in the browser, only when it is tapped. */
export async function openTanzil(): Promise<void> {
  try {
    if (isNative()) await Browser.open({ url: TANZIL_SITE, presentationStyle: "popover", toolbarColor: "#0B0A0D" });
    else window.open(TANZIL_SITE, "_blank", "noopener");
  } catch {
    setNotice("tanzil.net did not open. Try again.");
    hooks.render();
  }
}

/** Settings: takes the recitation download off the phone; it downloads again the next time it is used. */
export async function removeDownload(): Promise<void> {
  if (downloading) return setNotice("The recitation download is still going. Try again once it has finished.");
  stopMic();
  engine.release();
  await removeReciteFiles();
  setNotice("The recitation download is removed. It downloads again the next time you recite.");
  hooks.render();
}
