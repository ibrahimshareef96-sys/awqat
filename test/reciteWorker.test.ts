// The speech worker answers every message: a search that throws, an answer that cannot be sent, or a failure it did
// not expect still reaches the page as an error, and the messages after it are still handled. The model and the
// search are stand-ins; no Quran text is used.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FromWorker, ToWorker } from "../src/recite/messages.ts";

const search = vi.hoisted(() => ({ buildIndex: vi.fn(() => ({})), searchRecitation: vi.fn() }));
const asr = vi.hoisted(() => ({ pipeline: vi.fn() }));
const tanzil = vi.hoisted(() => ({ parseTanzil: vi.fn() }));
vi.mock("../src/recite/search.ts", () => search);
vi.mock("../src/recite/tanzil.ts", () => tanzil);
vi.mock("@huggingface/transformers", () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: asr.pipeline,
}));

interface FakeSelf {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  location: { href: string };
}

let worker: FakeSelf;
const said = (): FromWorker[] => worker.postMessage.mock.calls.map((call) => call[0] as FromWorker);
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const send = (message: ToWorker): void => worker.onmessage?.({ data: message } as MessageEvent<ToWorker>);
const LOAD: ToWorker = { type: "load", base: "/files/recite/", tanzil: "/files/recite/tanzil.txt",
  runtime: { mjs: "/recite-runtime/a.mjs", wasm: "/recite-runtime/a.wasm" }, checked: true };

beforeEach(async () => {
  vi.resetModules();
  search.searchRecitation.mockReset();
  search.buildIndex.mockClear();
  tanzil.parseTanzil.mockReset().mockReturnValue({ verses: [] });
  asr.pipeline.mockReset();
  asr.pipeline.mockResolvedValue(async () => ({ text: "heard" }));
  worker = { onmessage: null, postMessage: vi.fn(), location: { href: "https://localhost/assets/worker.js" } };
  vi.stubGlobal("self", worker);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("1|1|text")));
  await import("../src/recite/worker.ts");
});

describe("the speech worker", () => {
  it("loads, then hears", async () => {
    send(LOAD);
    send({ type: "hear", id: 1, audio: new Float32Array(160) });
    await flush();
    expect(said()).toEqual([{ type: "ready", checked: true }, { type: "heard", id: 1, text: "heard" }]);
  });

  it("answers a search that throws with an error, and goes on to the next", async () => {
    search.searchRecitation.mockImplementationOnce(() => { throw new Error("out of memory"); });
    search.searchRecitation.mockReturnValueOnce({ kind: "none" });
    send(LOAD);
    send({ type: "find", id: 2, text: "words" });
    send({ type: "find", id: 3, text: "words" });
    await flush();
    expect(said()).toContainEqual({ type: "error", id: 2 });
    expect(said()).toContainEqual({ type: "found", id: 3, result: { kind: "none" } });
  });

  it("answers with an error when a result cannot be sent", async () => {
    search.searchRecitation.mockReturnValue({ kind: "none" });
    send(LOAD);
    await flush();
    worker.postMessage.mockImplementationOnce(() => { throw new DOMException("could not be cloned", "DataCloneError"); });
    send({ type: "find", id: 4, text: "words" });
    await flush();
    expect(said()[said().length - 1]).toEqual({ type: "error", id: 4 });
  });

  it("answers a search before the text is loaded with an error", async () => {
    send({ type: "find", id: 5, text: "words" });
    await flush();
    expect(said()).toEqual([{ type: "error", id: 5 }]);
  });

  it("says a load failed when the model will not start", async () => {
    asr.pipeline.mockRejectedValue(new Error("no memory"));
    send(LOAD);
    await flush();
    expect(said()).toEqual([{ type: "failed", why: "model" }]);
  });

  it("never loads a runtime from another site, which its import() would reach past the fetch fence", async () => {
    send({ ...LOAD, runtime: { mjs: "https://cdn.example.com/ort.mjs", wasm: "/recite-runtime/a.wasm" } });
    send({ ...LOAD, runtime: { mjs: "/recite-runtime/a.mjs", wasm: "https://cdn.example.com/ort.wasm" } });
    await flush();
    expect(said()).toEqual([{ type: "failed", why: "model" }, { type: "failed", why: "model" }]);
    expect(asr.pipeline).not.toHaveBeenCalled();
  });

  it("loads nothing from an address that is another site's, or not a plain string", async () => {
    const sly = { href: "https://cdn.example.com/ort.mjs", toString: () => "/recite-runtime/a.mjs" };
    send({ ...LOAD, runtime: { mjs: sly as unknown as string, wasm: "/recite-runtime/a.wasm" } });
    send({ ...LOAD, base: "https://cdn.example.com/model/" });
    send({ ...LOAD, tanzil: "data:text/plain,1|1|text" });
    await flush();
    expect(said()).toEqual([1, 2, 3].map(() => ({ type: "failed", why: "model" })));
    expect(asr.pipeline).not.toHaveBeenCalled();
  });

  it("loads the runtime from the app's own scheme on iOS", async () => {
    worker.location.href = "capacitor://localhost/assets/worker.js";
    send({ ...LOAD, runtime: { mjs: "capacitor://localhost/recite-runtime/a.mjs",
      wasm: "capacitor://localhost/recite-runtime/a.wasm" } });
    await flush();
    expect(said()).toEqual([{ type: "ready", checked: true }]);
  });

  it("says the files are damaged when one is not the file pinned", async () => {
    send({ ...LOAD, checked: false });
    await flush();
    expect(said()).toEqual([{ type: "failed", why: "damaged" }]);
    expect(asr.pipeline).not.toHaveBeenCalled();
  });

  it("says the files are damaged when one is missing, but only that the model failed when one could not be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    send({ ...LOAD, checked: false });
    await flush();
    expect(said()).toEqual([{ type: "failed", why: "damaged" }]);
    worker.postMessage.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("low memory"); }));
    send({ ...LOAD, checked: false });
    await flush();
    expect(said()).toEqual([{ type: "failed", why: "model" }]);
  });

  it("is ready as soon as the model is, without reading the Quran text", async () => {
    const fetched = vi.fn(async () => new Response("1|1|text"));
    vi.stubGlobal("fetch", fetched);
    send(LOAD);
    await flush();
    expect(said()).toEqual([{ type: "ready", checked: true }]);
    expect(fetched).not.toHaveBeenCalled();
    expect(tanzil.parseTanzil).not.toHaveBeenCalled();
    expect(search.buildIndex).not.toHaveBeenCalled();
  });

  it("runs the model once on a second of silence before it says ready", async () => {
    const run = vi.fn(async () => ({ text: "" }));
    const order: string[] = [];
    run.mockImplementation(async () => { order.push("warm"); return { text: "" }; });
    worker.postMessage.mockImplementation((message: FromWorker) => { order.push(message.type); });
    asr.pipeline.mockResolvedValue(run);
    send(LOAD);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    const [audio] = run.mock.calls[0] as unknown as [Float32Array];
    expect(audio).toBeInstanceOf(Float32Array);
    expect(audio.length).toBe(16_000);
    expect(audio.every((sample) => sample === 0)).toBe(true);
    expect(order).toEqual(["warm", "ready"]);
  });

  it("is still ready when the warm-up run fails", async () => {
    asr.pipeline.mockResolvedValue(async () => { throw new Error("no memory"); });
    send(LOAD);
    send({ type: "hear", id: 1, audio: new Float32Array(160) });
    await flush();
    expect(said()[0]).toEqual({ type: "ready", checked: true });
    expect(said()[1]).toEqual({ type: "error", id: 1 });
  });

  it("reads the text and builds the search the first time a search is asked for, and only then", async () => {
    const fetched = vi.fn(async () => new Response("1|1|text"));
    vi.stubGlobal("fetch", fetched);
    search.searchRecitation.mockReturnValue({ kind: "none" });
    send(LOAD);
    await flush();
    send({ type: "find", id: 8, text: "words" });
    send({ type: "find", id: 9, text: "words" });
    await flush();
    expect(said()).toContainEqual({ type: "found", id: 8, result: { kind: "none" } });
    expect(said()).toContainEqual({ type: "found", id: 9, result: { kind: "none" } });
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched).toHaveBeenCalledWith("/files/recite/tanzil.txt");
    expect(search.buildIndex).toHaveBeenCalledTimes(1);
  });

  it("says the text is damaged, at the first search, when it is not the Quran text", async () => {
    tanzil.parseTanzil.mockReturnValue({ error: "notTanzil" });
    send(LOAD);
    send({ type: "find", id: 10, text: "words" });
    await flush();
    expect(said()).toEqual([{ type: "ready", checked: true }, { type: "text-failed", id: 10 }]);
    expect(search.searchRecitation).not.toHaveBeenCalled();
  });

  it("says the text is damaged, at the search, when the file is not there; hearing still works", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    send(LOAD);
    send({ type: "find", id: 11, text: "words" });
    send({ type: "hear", id: 12, audio: new Float32Array(160) });
    await flush();
    expect(said()).toContainEqual({ type: "text-failed", id: 11 });
    expect(said()).toContainEqual({ type: "heard", id: 12, text: "heard" });
    expect(tanzil.parseTanzil).not.toHaveBeenCalled();
  });

  it("answers with an error, not a damaged text, when the text could not be read this time, and reads it again next time", async () => {
    // A read that fails, or one the web view answers oddly, says nothing about the file: the download is kept.
    const fetched = vi.fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("read failed"))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValue(new Response("1|1|text"));
    vi.stubGlobal("fetch", fetched);
    search.searchRecitation.mockReturnValue({ kind: "none" });
    send(LOAD);
    send({ type: "find", id: 13, text: "words" });
    send({ type: "find", id: 14, text: "words" });
    send({ type: "find", id: 15, text: "words" });
    await flush();
    expect(said()).toContainEqual({ type: "error", id: 13 });
    expect(said()).toContainEqual({ type: "error", id: 14 });
    expect(said()).toContainEqual({ type: "found", id: 15, result: { kind: "none" } });
    expect(said().some((message) => message.type === "text-failed")).toBe(false);
  });

  it("answers with an error when the index cannot be built for want of memory", async () => {
    search.buildIndex.mockImplementationOnce(() => { throw new RangeError("out of memory"); });
    send(LOAD);
    send({ type: "find", id: 16, text: "words" });
    await flush();
    expect(said()).toContainEqual({ type: "error", id: 16 });
  });

  it("still handles the next message when even an error could not be sent", async () => {
    worker.postMessage.mockImplementationOnce(() => { throw new Error("gone"); });
    worker.postMessage.mockImplementationOnce(() => { throw new Error("gone"); });
    send({ type: "hear", id: 6, audio: new Float32Array(160) });
    send({ type: "find", id: 7, text: "words" });
    await flush();
    expect(said()[said().length - 1]).toEqual({ type: "error", id: 7 });
  });
});
