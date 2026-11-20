// @vitest-environment happy-dom
// The page's side of the speech worker: it says when the model is ready, and every question gets an answer, even when
// the worker fails after loading or is let go while loading.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/recite/assets.ts", () => ({ markReady: vi.fn(async () => undefined) }));

import * as engine from "../src/recite/engine.ts";
import type { FromWorker, ToWorker } from "../src/recite/messages.ts";

/** A worker that answers only when the test says so. */
class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  sent: ToWorker[] = [];
  terminated = false;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  say(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }
  fail(): void {
    this.onerror?.(new Event("error"));
  }
  /** The id of the last question asked. */
  lastId(): number {
    const last = this.sent[this.sent.length - 1];
    return last && last.type !== "load" ? last.id : -1;
  }
}

const FILES = { ready: true as const, base: "/files/recite/", tanzil: "/files/recite/tanzil.txt", checked: true };
const latest = (): FakeWorker => FakeWorker.made[FakeWorker.made.length - 1];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeWorker.made = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  engine.release();
  vi.unstubAllGlobals();
});

describe("the speech worker's readiness", () => {
  it("is ready only once the model has loaded, and not after it is let go", async () => {
    expect(engine.isReady()).toBe(false);
    const load = engine.prepare(FILES);
    expect(engine.isReady()).toBe(false);
    latest().say({ type: "ready", checked: true });
    await expect(load).resolves.toEqual({ ok: true });
    expect(engine.isReady()).toBe(true);
    engine.release();
    expect(engine.isReady()).toBe(false);
    expect(FakeWorker.made[0].terminated).toBe(true);
  });

  it("is not ready after a failed load, and the next try starts a new worker", async () => {
    const load = engine.prepare(FILES);
    latest().say({ type: "failed", why: "model" });
    await expect(load).resolves.toEqual({ ok: false, why: "model" });
    await flush();
    expect(engine.isReady()).toBe(false);
    expect(FakeWorker.made[0].terminated).toBe(true);
    void engine.prepare(FILES);
    expect(FakeWorker.made.length).toBe(2);
  });

  it("answers at once, with nothing, when there is no model loaded", async () => {
    await expect(engine.hear(new Float32Array(160))).resolves.toBeNull();
    await expect(engine.find("words")).resolves.toBeNull();
  });
});

describe("keeping the model warm between reader visits", () => {
  const loadModel = async (): Promise<FakeWorker> => {
    const load = engine.prepare(FILES);
    latest().say({ type: "ready", checked: true });
    await load;
    return latest();
  };

  afterEach(() => vi.useRealTimers());

  it("waits three minutes before letting the model go", async () => {
    vi.useFakeTimers();
    expect(engine.IDLE_MS).toBe(3 * 60 * 1000);
    const worker = await loadModel();
    engine.releaseWhenIdle();
    expect(engine.isReady()).toBe(true);
    vi.advanceTimersByTime(engine.IDLE_MS - 1);
    expect(worker.terminated).toBe(false);
    expect(engine.isReady()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(worker.terminated).toBe(true);
    expect(engine.isReady()).toBe(false);
  });

  it("is loaded already when the reader is opened again within the idle time", async () => {
    vi.useFakeTimers();
    const worker = await loadModel();
    engine.releaseWhenIdle();
    vi.advanceTimersByTime(engine.IDLE_MS - 1000);
    await expect(engine.prepare(FILES)).resolves.toEqual({ ok: true });
    expect(FakeWorker.made).toHaveLength(1);
    vi.advanceTimersByTime(engine.IDLE_MS * 2);
    expect(worker.terminated).toBe(false);
    expect(engine.isReady()).toBe(true);
  });

  it("stays when the reader is only looked at again (keepWarm), and waits afresh the next time it closes", async () => {
    vi.useFakeTimers();
    const worker = await loadModel();
    engine.releaseWhenIdle();
    vi.advanceTimersByTime(engine.IDLE_MS - 1);
    engine.keepWarm();
    vi.advanceTimersByTime(engine.IDLE_MS * 2);
    expect(worker.terminated).toBe(false);
    engine.releaseWhenIdle();
    vi.advanceTimersByTime(engine.IDLE_MS);
    expect(worker.terminated).toBe(true);
  });

  it("loads afresh after the idle time has passed", async () => {
    vi.useFakeTimers();
    await loadModel();
    engine.releaseWhenIdle();
    vi.advanceTimersByTime(engine.IDLE_MS);
    void engine.prepare(FILES);
    expect(FakeWorker.made).toHaveLength(2);
    expect(latest().terminated).toBe(false);
  });

  it("lets go at once when told to, and the old timer never touches a newer worker", async () => {
    vi.useFakeTimers();
    const first = await loadModel();
    engine.releaseWhenIdle();
    engine.release();
    expect(first.terminated).toBe(true);
    const second = await loadModel();
    vi.advanceTimersByTime(engine.IDLE_MS * 2);
    expect(second.terminated).toBe(false);
  });

  it("does nothing when no model is loaded", () => {
    vi.useFakeTimers();
    engine.releaseWhenIdle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says the text is damaged, apart from the model failing, when a search finds it so", async () => {
    await loadModel();
    const finding = engine.find("words");
    latest().say({ type: "text-failed", id: latest().lastId() });
    await expect(finding).resolves.toBe("text");
    expect(engine.isReady()).toBe(true);
  });
});

describe("a worker that fails", () => {
  it("settles a hearing and a search still waiting when it fails after loading", async () => {
    const load = engine.prepare(FILES);
    latest().say({ type: "ready", checked: true });
    await load;
    const hearing = engine.hear(new Float32Array(160));
    const finding = engine.find("some words");
    latest().fail();
    await expect(hearing).resolves.toBeNull();
    await expect(finding).resolves.toBeNull();
    expect(engine.isReady()).toBe(false);
    expect(FakeWorker.made[0].terminated).toBe(true);
  });

  it("settles the load when it fails while loading", async () => {
    const load = engine.prepare(FILES);
    latest().fail();
    await expect(load).resolves.toEqual({ ok: false, why: "model" });
    expect(engine.isReady()).toBe(false);
  });

  it("settles the load when it is let go while loading", async () => {
    const load = engine.prepare(FILES);
    engine.release();
    await expect(load).resolves.toEqual({ ok: false, why: "model" });
  });

  it("tells a hearing the model failed on from one that heard no words", async () => {
    const load = engine.prepare(FILES);
    latest().say({ type: "ready", checked: true });
    await load;
    const failed = engine.hear(new Float32Array(160));
    latest().say({ type: "error", id: latest().lastId() });
    await expect(failed).resolves.toBeNull();
    const silent = engine.hear(new Float32Array(160));
    latest().say({ type: "heard", id: latest().lastId(), text: "" });
    await expect(silent).resolves.toBe("");
  });

  it("answers a search the worker could not do with nothing", async () => {
    const load = engine.prepare(FILES);
    latest().say({ type: "ready", checked: true });
    await load;
    const finding = engine.find("some words");
    latest().say({ type: "error", id: latest().lastId() });
    await expect(finding).resolves.toBeNull();
    expect(engine.isReady()).toBe(true);
  });

  it("never lets a worker already let go mark a newer one ready", async () => {
    void engine.prepare(FILES);
    const first = latest();
    engine.release();
    const second = engine.prepare(FILES);
    first.say({ type: "ready", checked: true });
    first.fail();
    expect(engine.isReady()).toBe(false);
    expect(latest().terminated).toBe(false);
    latest().say({ type: "ready", checked: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(engine.isReady()).toBe(true);
  });
});
