/**
 * The page's side of the speech worker: starts it when recitation is first used, asks it to hear and to find, and lets
 * it go a few minutes after the reader closes (the model takes about 150 MB while it is loaded). Every question gets an answer: a
 * worker that fails, while loading or after, or is let go, settles the load and whatever was waiting on it.
 */
import type { FromWorker, LoadProblem, ToWorker } from "./messages.ts";
import type { SearchResult } from "./search.ts";
import { markReady, type ReciteFiles } from "./assets.ts";

type Ready = { ok: true } | { ok: false; why: LoadProblem };

let worker: Worker | null = null;
let loading: Promise<Ready> | null = null;
/** Settles the load still going, when the worker is let go or fails before it answers. */
let settleLoad: ((ready: Ready) => void) | null = null;
/** The model and the text are loaded in the running worker. */
let loaded = false;
let nextId = 1;
/** How long the model stays loaded after the reader closes. */
export const IDLE_MS = 3 * 60 * 1000;
/** The wait before an idle model is let go; null when none is running. */
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const waiting = new Map<number, (message: FromWorker | null) => void>();

/** The runtime shipped inside the app (vite.config.ts copies it), by its address next to the page. */
const runtime = (): { mjs: string; wasm: string } => ({
  mjs: new URL("recite-runtime/ort-wasm-simd-threaded.mjs", document.baseURI).href,
  wasm: new URL("recite-runtime/ort-wasm-simd-threaded.wasm", document.baseURI).href,
});

/** Asks the loaded worker; null at once when there is none (never loaded, failed, or let go). */
function ask(message: Exclude<ToWorker, { type: "load" }>, transfer: Transferable[] = []): Promise<FromWorker | null> {
  const running = worker;
  if (!running || !loaded) return Promise.resolve(null);
  return new Promise((resolve) => {
    waiting.set(message.id, resolve);
    try {
      running.postMessage(message, transfer);
    } catch {
      waiting.delete(message.id);
      resolve(null);
    }
  });
}

function settleAll(): void {
  const settles = [...waiting.values()];
  waiting.clear();
  for (const resolve of settles) resolve(null);
}

/** True once the model and the text are loaded in a worker that is still running. */
export const isReady = (): boolean => worker !== null && loaded;

/** Starts the worker and loads the model and the text, once; later calls wait for the same load. */
export function prepare(files: Extract<ReciteFiles, { ready: true }>): Promise<Ready> {
  keepWarm();
  if (loading) return loading;
  const started = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker = started;
  loaded = false;
  const pending = new Promise<Ready>((resolve) => {
    settleLoad = resolve;
    started.onmessage = (event: MessageEvent<FromWorker>) => {
      // A worker already let go says nothing more, so it can never mark a newer one loaded.
      if (worker !== started) return;
      const message = event.data;
      if (message.type === "ready") {
        loaded = true;
        settleLoad = null;
        if (!files.checked) void markReady(true);
        return resolve({ ok: true });
      }
      if (message.type === "failed") {
        settleLoad = null;
        return resolve({ ok: false, why: message.why });
      }
      const settle = waiting.get(message.id);
      waiting.delete(message.id);
      settle?.(message);
    };
    // A worker that fails, before or after its load (out of memory, say), answers nothing more: the load and
    // everything waiting are settled now, and the next try starts afresh.
    const failed = (): void => {
      if (worker === started) release();
    };
    started.onerror = failed;
    started.onmessageerror = failed;
  });
  loading = pending;
  const load: ToWorker = { type: "load", base: files.base, tanzil: files.tanzil, runtime: runtime(), checked: files.checked };
  started.postMessage(load);
  // A failed load leaves nothing running: the next try starts afresh.
  void pending.then((ready) => { if (!ready.ok && worker === started) release(); });
  return pending;
}

/**
 * What the model heard in a stretch of 16 kHz sound: "" when it heard no words, null when it could not hear at all
 * (no model loaded, the worker gone, or the model failing on it), so a failure is never taken for silence.
 */
export async function hear(audio: Float32Array): Promise<string | null> {
  const id = nextId++;
  const answer = await ask({ type: "hear", id, audio }, [audio.buffer]);
  return answer?.type === "heard" ? answer.text : null;
}

/**
 * Which ayah the words belong to; null when the worker is gone or could not search; "text" when the Quran text, read
 * just now for this first search, was missing or not the text (the files are then damaged).
 */
export async function find(text: string): Promise<SearchResult | "text" | null> {
  const id = nextId++;
  const answer = await ask({ type: "find", id, text });
  if (answer?.type === "text-failed") return "text";
  return answer?.type === "found" ? answer.result : null;
}

/** The reader is in use again: a model waiting out its idle time stays loaded. */
export function keepWarm(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
}

/**
 * The reader closed: the model stays loaded for a while, so opening it again is instant, and goes only when no one
 * has used it for `ms`. Preparing again, or keepWarm, cancels the wait.
 */
export function releaseWhenIdle(ms: number = IDLE_MS): void {
  keepWarm();
  const waiting = worker;
  if (!waiting) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    // Only the worker that was waiting: one started since is not this wait's to let go.
    if (worker === waiting) release();
  }, ms);
}

/** Lets the worker and the model go. Anything still waiting, the load included, gets its answer now. */
export function release(): void {
  keepWarm();
  worker?.terminate();
  worker = null;
  loaded = false;
  loading = null;
  const settle = settleLoad;
  settleLoad = null;
  settle?.({ ok: false, why: "model" });
  settleAll();
}
