// The speech worker answers every message: a search that throws, an answer that cannot be sent, or a failure it did
// not expect still reaches the page as an error, and the messages after it are still handled. The model and the
// search are stand-ins; no Quran text is used.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FromWorker, ToWorker } from "../src/recite/messages.ts";

const search = vi.hoisted(() => ({ buildIndex: vi.fn(() => ({})), searchRecitation: vi.fn() }));
const asr = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock("../src/recite/search.ts", () => search);
vi.mock("../src/recite/tanzil.ts", () => ({ parseTanzil: vi.fn(() => ({ verses: [] })) }));
vi.mock("@huggingface/transformers", () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: asr.pipeline,
}));

interface FakeSelf {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
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
  asr.pipeline.mockReset();
  asr.pipeline.mockResolvedValue(async () => ({ text: "heard" }));
  worker = { onmessage: null, postMessage: vi.fn() };
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

  it("still handles the next message when even an error could not be sent", async () => {
    worker.postMessage.mockImplementationOnce(() => { throw new Error("gone"); });
    worker.postMessage.mockImplementationOnce(() => { throw new Error("gone"); });
    send({ type: "hear", id: 6, audio: new Float32Array(160) });
    send({ type: "find", id: 7, text: "words" });
    await flush();
    expect(said()[said().length - 1]).toEqual({ type: "error", id: 7 });
  });
});
