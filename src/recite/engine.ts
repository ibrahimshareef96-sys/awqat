/**
 * The page's side of the speech worker: starts it when recitation is first used, asks it to hear and to find, and lets
 * it go when the reader closes (the model takes about 150 MB while it is loaded). Every question gets an answer: a
 * worker that fails or is let go settles whatever was waiting on it.
 */
import type { FromWorker, LoadProblem, ToWorker } from "./messages.ts";
import type { SearchResult } from "./search.ts";
import { markReady, type ReciteFiles } from "./assets.ts";

type Ready = { ok: true } | { ok: false; why: LoadProblem };

let worker: Worker | null = null;
let loading: Promise<Ready> | null = null;
/** Settles the load still going, when the worker is let go or fails before it answers. */
let settleLoad: ((ready: Ready) => void) | null = null;
let loaded = false;
let nextId = 1;
const waiting = new Map<number, (message: FromWorker | null) => void>();

/** The runtime shipped inside the app (vite.config.ts copies it), by its address next to the page. */
const runtime = (): { mjs: string; wasm: string } => ({
  mjs: new URL("recite-runtime/ort-wasm-simd-threaded.mjs", document.baseURI).href,
  wasm: new URL("recite-runtime/ort-wasm-simd-threaded.wasm", document.baseURI).href,
});

function ask(message: Exclude<ToWorker, { type: "load" }>, transfer: Transferable[] = []): Promise<FromWorker | null> {
  const running = worker;
  if (!running || !loaded) return Promise.resolve(null);
  return new Promise((resolve) => {
    waiting.set(message.id, resolve);
    running.postMessage(message, transfer);
  });
}

function settleAll(): void {
  for (const resolve of waiting.values()) resolve(null);
  waiting.clear();
}

/** True once the model and the text are loaded in a worker that is still running. */
export const isReady = (): boolean => worker !== null && loaded;

/** Starts the worker and loads the model and the text, once; later calls wait for the same load. */
export function prepare(files: Extract<ReciteFiles, { ready: true }>): Promise<Ready> {
  if (loading) return loading;
  const started = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker = started;
  loaded = false;
  loading = new Promise<Ready>((resolve) => {
    settleLoad = resolve;
    started.onmessage = (event: MessageEvent<FromWorker>) => {
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
    // A worker that fails, before or after its load, answers nothing more: everything waiting is settled.
    started.onerror = () => {
      resolve({ ok: false, why: "model" });
      release();
    };
  });
  const load: ToWorker = { type: "load", base: files.base, tanzil: files.tanzil, runtime: runtime(), checked: files.checked };
  started.postMessage(load);
  // A failed load leaves nothing running: the next try starts afresh.
  void loading.then((ready) => { if (!ready.ok) release(); });
  return loading;
}

/** What the model heard in a stretch of 16 kHz sound; "" when it heard nothing or failed. */
export async function hear(audio: Float32Array): Promise<string> {
  const id = nextId++;
  const answer = await ask({ type: "hear", id, audio }, [audio.buffer]);
  return answer?.type === "heard" ? answer.text : "";
}

/** Which ayah the words belong to; null when the worker is gone or could not search. */
export async function find(text: string): Promise<SearchResult | null> {
  const id = nextId++;
  const answer = await ask({ type: "find", id, text });
  return answer?.type === "found" ? answer.result : null;
}

/** Lets the worker and the model go. Anything still waiting, the load included, gets its answer now. */
export function release(): void {
  worker?.terminate();
  worker = null;
  loaded = false;
  loading = null;
  settleLoad?.({ ok: false, why: "model" });
  settleLoad = null;
  settleAll();
}
