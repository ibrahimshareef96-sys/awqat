/**
 * The page's side of the speech worker: starts it when recitation is first used, asks it to hear and to find, and lets
 * it go when the reader closes (the model takes about 150 MB while it is loaded).
 */
import type { FromWorker, LoadProblem, ToWorker } from "./messages.ts";
import type { SearchResult } from "./search.ts";
import { markReady, type ReciteFiles } from "./assets.ts";

type Ready = { ok: true } | { ok: false; why: LoadProblem };

let worker: Worker | null = null;
let loading: Promise<Ready> | null = null;
let nextId = 1;
const waiting = new Map<number, (message: FromWorker | null) => void>();

/** The runtime shipped inside the app (vite.config.ts copies it), by its address next to the page. */
const runtime = (): { mjs: string; wasm: string } => ({
  mjs: new URL("recite-runtime/ort-wasm-simd-threaded.mjs", document.baseURI).href,
  wasm: new URL("recite-runtime/ort-wasm-simd-threaded.wasm", document.baseURI).href,
});

function ask(message: ToWorker, transfer: Transferable[] = []): Promise<FromWorker | null> {
  if (!worker || message.type === "load") return Promise.resolve(null);
  const id = message.id;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage(message, transfer);
  });
}

function settleAll(): void {
  for (const resolve of waiting.values()) resolve(null);
  waiting.clear();
}

/** Starts the worker and loads the model and the text, once; later calls wait for the same load. */
export function prepare(files: Extract<ReciteFiles, { ready: true }>): Promise<Ready> {
  if (loading) return loading;
  const started = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker = started;
  loading = new Promise<Ready>((resolve) => {
    started.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "ready") {
        if (!files.checked) void markReady(true);
        return resolve({ ok: true });
      }
      if (message.type === "failed") return resolve({ ok: false, why: message.why });
      const settle = waiting.get(message.id);
      waiting.delete(message.id);
      settle?.(message);
    };
    started.onerror = () => resolve({ ok: false, why: "model" });
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

/** Which ayah the words belong to; null when the worker is gone. */
export async function find(text: string): Promise<SearchResult | null> {
  const id = nextId++;
  const answer = await ask({ type: "find", id, text });
  return answer?.type === "found" ? answer.result : null;
}

/** Lets the worker and the model go. Anything still waiting gets no answer. */
export function release(): void {
  worker?.terminate();
  worker = null;
  loading = null;
  settleAll();
}
