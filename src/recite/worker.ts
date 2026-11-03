/// <reference lib="webworker" />
/**
 * The speech worker: runs the Quran speech model (transformers.js on ONNX Runtime's WebAssembly, one thread) and holds
 * the Tanzil text's search index, off the page so the page never stutters. It reads only same-origin files: the
 * downloaded model and text, and the runtime shipped inside the app. Every file's SHA-256 is checked before first use.
 */
// First, before the libraries run: the worker's fetch refuses any other site (the page's policy does not reach here).
import { ownFile } from "./sameOrigin.ts";
import { env, pipeline } from "@huggingface/transformers";
import type { FromWorker, ToWorker } from "./messages.ts";
import { MODEL_FILES, MODEL_ID } from "./model.ts";
import { buildIndex, searchRecitation, type SearchIndex } from "./search.ts";
import { parseTanzil } from "./tanzil.ts";

declare const self: DedicatedWorkerGlobalScope;

type Hear = (audio: Float32Array, options: Record<string, never>) => Promise<{ text: string } | { text: string }[]>;

let hear: Hear | null = null;
let index: SearchIndex | null = null;
/** One message at a time: the model is not run twice at once. */
let queue: Promise<void> = Promise.resolve();

const post = (message: FromWorker, transfer: Transferable[] = []): void => self.postMessage(message, transfer);

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * "match" when every model file is the one pinned, byte for byte; "damaged" when one is missing or differs (it is then
 * deleted and downloaded again); "unread" when a file could not be read just now (low memory, say): tried again later.
 */
async function checkFiles(base: string): Promise<"match" | "damaged" | "unread"> {
  for (const file of MODEL_FILES) {
    let buffer: ArrayBuffer;
    try {
      const response = await fetch(`${base}${MODEL_ID}/${file.path}`);
      if (response.status === 404) return "damaged";
      if (!response.ok) return "unread";
      buffer = await response.arrayBuffer();
    } catch {
      return "unread";
    }
    if (buffer.byteLength !== file.size || await sha256(buffer) !== file.sha256) return "damaged";
  }
  return "match";
}

async function load(message: Extract<ToWorker, { type: "load" }>): Promise<void> {
  if (!message.checked) {
    const checked = await checkFiles(message.base);
    if (checked !== "match") return post({ type: "failed", why: checked === "damaged" ? "damaged" : "model" });
  }
  try {
    const text = await (await fetch(message.tanzil)).text();
    const read = parseTanzil(text);
    if (!("verses" in read)) return post({ type: "failed", why: "text" });
    index = buildIndex(read.verses);
  } catch {
    return post({ type: "failed", why: "text" });
  }
  try {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    // A path, not a full address: transformers.js checks for local files only when it is given a path.
    env.localModelPath = message.base;
    env.useBrowserCache = false;
    // The runtime is loaded from its own address, never from a blob, which the page's policy refuses.
    env.useWasmCache = false;
    // ONNX Runtime imports its runtime from these addresses, which the fetch fence never sees: the app's own copy only.
    const { mjs, wasm: binary } = message.runtime;
    if (!ownFile(mjs, self.location.href) || !ownFile(binary, self.location.href)) {
      return post({ type: "failed", why: "model" });
    }
    const wasm = env.backends.onnx.wasm;
    if (wasm) {
      wasm.wasmPaths = { mjs: message.runtime.mjs, wasm: message.runtime.wasm };
      wasm.numThreads = 1;
      wasm.proxy = false;
    }
    const asr = await pipeline("automatic-speech-recognition", MODEL_ID, { dtype: "q8", device: "wasm" });
    hear = asr as unknown as Hear;
    post({ type: "ready", checked: true });
  } catch {
    post({ type: "failed", why: "model" });
  }
}

async function handle(message: ToWorker): Promise<void> {
  if (message.type === "load") return load(message);
  if (message.type === "hear") {
    if (!hear) return post({ type: "error", id: message.id });
    try {
      const out = await hear(message.audio, {});
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      return post({ type: "heard", id: message.id, text: typeof text === "string" ? text.slice(0, 2000) : "" });
    } catch {
      return post({ type: "error", id: message.id });
    }
  }
  if (!index) return post({ type: "error", id: message.id });
  try {
    post({ type: "found", id: message.id, result: searchRecitation(index, message.text.slice(0, 2000)) });
  } catch {
    post({ type: "error", id: message.id });
  }
}

/** Says a message failed, so the page never waits on it; if even that cannot be said, the queue still goes on. */
function answerFailure(message: ToWorker): void {
  try {
    post(message.type === "load" ? { type: "failed", why: "model" } : { type: "error", id: message.id });
  } catch {
    // Nothing more can reach the page for this message; the next one is still handled.
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  // Whatever goes wrong, the page gets an answer, so nothing it waits on hangs.
  queue = queue.then(() => handle(message)).catch(() => answerFailure(message));
};
