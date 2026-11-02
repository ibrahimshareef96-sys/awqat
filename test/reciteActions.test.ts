// @vitest-environment happy-dom
// Recitation's flow, with the speech model, the microphone and the download stood in for: what a late answer from
// any of them may and may not change. Every race the code guards against has a test here. The words are made up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/recite/engine.ts", () => ({
  prepare: vi.fn(), hear: vi.fn(), find: vi.fn(), isReady: vi.fn(), release: vi.fn(),
}));
vi.mock("../src/recite/mic.ts", () => ({ startCapture: vi.fn() }));
vi.mock("../src/recite/assets.ts", () => ({
  DOWNLOAD_BYTES: 45_000_000,
  reciteFiles: vi.fn(), downloadReciteFiles: vi.fn(), markReady: vi.fn(async () => undefined),
  removeReciteFiles: vi.fn(async () => undefined),
}));
vi.mock("../src/app/mushafActions.ts", () => ({
  pagesInView: vi.fn(), pageWords: vi.fn(), keepMistakes: vi.fn(), turnTo: vi.fn(),
}));

import * as engine from "../src/recite/engine.ts";
import * as mic from "../src/recite/mic.ts";
import * as assets from "../src/recite/assets.ts";
import * as mushaf from "../src/app/mushafActions.ts";
import { FRAME } from "../src/recite/audio.ts";
import type { MushafWord } from "../src/quran/mushafPage.ts";
import { closedFind } from "../src/recite/session.ts";
import { hooks, state } from "../src/app/state.ts";
import * as recite from "../src/app/reciteActions.ts";

const WORDS = ["ذهب", "الرجل", "الى", "السوق"].map((text, i) => ({ key: `18:10:${i + 1}`, text })) as unknown as MushafWord[];
const READY = { ready: true as const, base: "recite-dev/", tanzil: "recite-dev/tanzil.txt", checked: true };
const FOUND = { kind: "found" as const, best: { sura: 18, aya: 10, lastAya: 10, score: 0.97 }, same: [] };

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const loud = (): Float32Array => Float32Array.from({ length: FRAME }, (_, i) => (i % 2 ? 0.3 : -0.3));
const quiet = (): Float32Array => new Float32Array(FRAME);

/** The frames the stood-in microphone sends, and each capture it handed out. */
let sendFrame: (frame: Float32Array) => void = () => undefined;
let captures: { stop: ReturnType<typeof vi.fn> }[] = [];

function micOpensAtOnce(): void {
  vi.mocked(mic.startCapture).mockImplementation(async (onFrame) => {
    sendFrame = onFrame;
    const capture = { stop: vi.fn() };
    captures.push(capture);
    return capture;
  });
}

beforeEach(() => {
  document.body.innerHTML = `<div id="live"></div><div id="overlay"></div><div id="app"></div>`;
  captures = [];
  sendFrame = () => undefined;
  vi.mocked(engine.prepare).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(engine.hear).mockReset().mockResolvedValue("ذهب الرجل");
  vi.mocked(engine.find).mockReset().mockResolvedValue(FOUND);
  vi.mocked(engine.isReady).mockReset().mockReturnValue(true);
  vi.mocked(engine.release).mockReset();
  vi.mocked(assets.reciteFiles).mockReset().mockResolvedValue(READY);
  vi.mocked(assets.downloadReciteFiles).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(assets.markReady).mockClear();
  vi.mocked(assets.removeReciteFiles).mockClear();
  vi.mocked(mushaf.pagesInView).mockReset().mockReturnValue([294]);
  vi.mocked(mushaf.pageWords).mockReset().mockReturnValue({ words: WORDS, at: new Map() });
  vi.mocked(mushaf.keepMistakes).mockReset().mockResolvedValue(true);
  vi.mocked(mushaf.turnTo).mockReset();
  micOpensAtOnce();
  hooks.render = vi.fn();
  hooks.renderOverlay = vi.fn();
  hooks.closeSheet = vi.fn(() => { state.sheet = null; });
  hooks.go = vi.fn();
  state.sheet = null;
  state.recite = closedFind();
  state.memorise = null;
  state.mushafPage = 294;
  state.notice = "";
});

afterEach(() => {
  state.sheet = null;
  recite.leaveReader();
});

describe("recite to find", () => {
  it("listens at once when the files are here and the model loads", async () => {
    void recite.openFind();
    await flush();
    expect(state.sheet).toBe("recite");
    expect(state.recite.phase).toBe("listening");
    expect(captures).toHaveLength(1);
  });

  it("finds the ayah from what was heard when Stop is tapped", async () => {
    void recite.openFind();
    await flush();
    for (let i = 0; i < 8; i++) sendFrame(loud());
    recite.stopFind();
    await flush();
    expect(engine.hear).toHaveBeenCalledTimes(1);
    expect(state.recite.phase).toBe("result");
    expect(state.recite.result).toEqual(FOUND);
    expect(captures[0].stop).toHaveBeenCalled();
  });

  it("asks for more words when too little was heard, without asking the model", async () => {
    void recite.openFind();
    await flush();
    sendFrame(loud());
    recite.stopFind();
    await flush();
    expect(engine.hear).not.toHaveBeenCalled();
    expect(state.recite.result).toEqual({ kind: "short" });
  });

  it("stops a microphone that starts only after the sheet closed", async () => {
    const start = deferred<{ stop: () => void }>();
    vi.mocked(mic.startCapture).mockReturnValue(start.promise);
    void recite.openFind();
    await flush();
    state.sheet = null;
    recite.sheetClosed();
    const stop = vi.fn();
    start.resolve({ stop });
    await flush();
    expect(stop).toHaveBeenCalled();
  });

  it("lets go of an answer that comes back after the sheet closed", async () => {
    const found = deferred<typeof FOUND>();
    vi.mocked(engine.find).mockReturnValue(found.promise);
    void recite.openFind();
    await flush();
    for (let i = 0; i < 8; i++) sendFrame(loud());
    recite.stopFind();
    await flush();
    expect(state.recite.phase).toBe("finding");
    state.sheet = null;
    recite.sheetClosed();
    found.resolve(FOUND);
    await flush();
    expect(state.recite.phase).toBe("intro");
    expect(state.recite.result).toBeNull();
  });

  it("says the model failed when the worker could not search", async () => {
    vi.mocked(engine.find).mockResolvedValue(null);
    void recite.openFind();
    await flush();
    for (let i = 0; i < 8; i++) sendFrame(loud());
    recite.stopFind();
    await flush();
    expect(state.recite).toMatchObject({ phase: "problem", problem: "model" });
  });

  it("offers the one-time download when the files are not here", async () => {
    vi.mocked(assets.reciteFiles).mockResolvedValue({ ready: false });
    await recite.openFind();
    expect(state.recite.phase).toBe("intro");
    expect(engine.prepare).not.toHaveBeenCalled();
  });

  it("downloads once however many times Download is tapped", async () => {
    const done = deferred<{ ok: true }>();
    vi.mocked(assets.downloadReciteFiles).mockReturnValue(done.promise);
    vi.mocked(assets.reciteFiles).mockResolvedValueOnce({ ready: false });
    await recite.openFind();
    void recite.download();
    void recite.download();
    expect(assets.downloadReciteFiles).toHaveBeenCalledTimes(1);
    expect(state.recite.phase).toBe("downloading");
    done.resolve({ ok: true });
    await flush();
    expect(state.recite.phase).toBe("listening");
  });

  it("names a download that could not reach the internet", async () => {
    vi.mocked(assets.downloadReciteFiles).mockResolvedValue({ ok: false, why: "offline" });
    vi.mocked(assets.reciteFiles).mockResolvedValueOnce({ ready: false });
    await recite.openFind();
    await recite.download();
    expect(state.recite).toMatchObject({ phase: "problem", problem: "offline" });
  });

  it("removes damaged files, and checks the files again after a model that would not start", async () => {
    vi.mocked(engine.prepare).mockResolvedValueOnce({ ok: false, why: "damaged" });
    await recite.openFind();
    expect(assets.removeReciteFiles).toHaveBeenCalled();
    expect(state.recite).toMatchObject({ phase: "problem", problem: "damaged" });

    vi.mocked(engine.prepare).mockResolvedValueOnce({ ok: false, why: "model" });
    await recite.openFind();
    expect(assets.markReady).toHaveBeenCalledWith(false);
    expect(state.recite).toMatchObject({ phase: "problem", problem: "model" });
  });

  it("loads the model again on Recite again after a failure", async () => {
    vi.mocked(engine.prepare).mockResolvedValueOnce({ ok: false, why: "model" });
    await recite.openFind();
    vi.mocked(engine.isReady).mockReturnValue(false);
    recite.again();
    await flush();
    expect(engine.prepare).toHaveBeenCalledTimes(2);
    expect(state.recite.phase).toBe("listening");
  });

  it("says when the microphone is refused, or will not start", async () => {
    vi.mocked(mic.startCapture).mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotFoundError" }));
    void recite.openFind();
    await flush();
    expect(state.recite).toMatchObject({ phase: "problem", problem: "noMic" });
    vi.mocked(mic.startCapture).mockRejectedValueOnce(new Error("broken"));
    recite.again();
    await flush();
    expect(state.recite).toMatchObject({ phase: "problem", problem: "audio" });
  });
});

describe("the app going to the background", () => {
  it("stops listening and says so", async () => {
    void recite.openFind();
    await flush();
    recite.appAway(false);
    expect(captures[0].stop).toHaveBeenCalled();
    expect(state.recite).toMatchObject({ phase: "problem", problem: "away" });
  });

  it("leaves Android's microphone prompt alone, so listening starts once it is answered", async () => {
    const start = deferred<{ stop: () => void }>();
    vi.mocked(mic.startCapture).mockReturnValue(start.promise);
    void recite.openFind();
    await flush();
    recite.appAway(true);
    expect(state.recite.phase).toBe("listening");
    const stop = vi.fn();
    start.resolve({ stop });
    await flush();
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops a microphone still starting when the app really went away", async () => {
    const start = deferred<{ stop: () => void }>();
    vi.mocked(mic.startCapture).mockReturnValue(start.promise);
    void recite.openFind();
    await flush();
    recite.appAway(false);
    const stop = vi.fn();
    start.resolve({ stop });
    await flush();
    expect(stop).toHaveBeenCalled();
    expect(state.recite.problem).toBe("away");
  });

  it("pauses a page being memorised", async () => {
    void recite.startMemorising();
    await flush();
    expect(state.memorise?.phase).toBe("listening");
    recite.appAway(false);
    expect(state.memorise?.phase).toBe("paused");
    expect(captures[0].stop).toHaveBeenCalled();
  });
});

describe("memorising a page", () => {
  /** A stretch of recitation: speech, then the pause that ends it. */
  function recitePhrase(): void {
    for (let i = 0; i < 5; i++) sendFrame(loud());
    for (let i = 0; i < 7; i++) sendFrame(quiet());
  }

  it("will not start before the page has opened", async () => {
    vi.mocked(mushaf.pageWords).mockReturnValue(null);
    await recite.startMemorising();
    expect(state.memorise).toBeNull();
    expect(state.notice).toContain("has not opened yet");
  });

  it("hides both pages of a spread, and fills in what is recited", async () => {
    vi.mocked(mushaf.pagesInView).mockReturnValue([294, 295]);
    vi.mocked(mushaf.pageWords).mockImplementation((page) =>
      ({ words: page === 294 ? WORDS.slice(0, 2) : WORDS.slice(2), at: new Map() }));
    void recite.startMemorising();
    await flush();
    expect(state.memorise?.pages).toEqual([294, 295]);
    expect(state.memorise?.m.keys).toHaveLength(4);
    recitePhrase();
    await flush();
    expect(state.memorise?.m.marks.slice(0, 2)).toEqual(["said", "said"]);
    expect(state.memorise?.working).toBe(0);
  });

  it("lets go of a stretch heard for an earlier start of the page", async () => {
    const heard = deferred<string>();
    vi.mocked(engine.hear).mockReturnValueOnce(heard.promise);
    void recite.startMemorising();
    await flush();
    recitePhrase();
    await flush();
    expect(state.memorise?.working).toBe(1);
    const first = state.memorise?.attempt ?? 0;
    recite.memoriseAgain();
    await flush();
    heard.resolve("ذهب الرجل");
    await flush();
    expect(state.memorise?.attempt).toBe(first + 1);
    expect(state.memorise?.m.marks.every((mark) => mark === null)).toBe(true);
  });

  it("does not start listening when Done comes while the model is getting ready", async () => {
    const loaded = deferred<{ ok: true }>();
    vi.mocked(engine.prepare).mockReturnValueOnce(loaded.promise);
    void recite.startMemorising();
    await flush();
    expect(state.memorise?.phase).toBe("preparing");
    recite.finishMemorising();
    loaded.resolve({ ok: true });
    await flush();
    expect(state.memorise?.phase).toBe("paused");
    expect(state.sheet).toBe("memorise-done");
    expect(mic.startCapture).not.toHaveBeenCalled();
  });

  it("stops listening when the page is turned away, and offers the way back", async () => {
    void recite.startMemorising();
    await flush();
    state.mushafPage = 300;
    recite.afterReaderDraw(document);
    expect(state.memorise?.phase).toBe("left");
    expect(captures[0].stop).toHaveBeenCalled();
    recite.backToPage();
    expect(mushaf.turnTo).toHaveBeenCalledWith(294);
  });

  it("keeps the slips only once nothing is still being heard, and ends only once they are saved", async () => {
    const heard = deferred<string>();
    vi.mocked(engine.hear).mockReturnValueOnce(heard.promise);
    void recite.startMemorising();
    await flush();
    recitePhrase();
    await flush();
    recite.finishMemorising();
    await recite.keepSlips();
    expect(mushaf.keepMistakes).not.toHaveBeenCalled();

    heard.resolve("ذهب الولد");
    await flush();
    vi.mocked(mushaf.keepMistakes).mockResolvedValueOnce(false);
    await recite.keepSlips();
    expect(mushaf.keepMistakes).toHaveBeenCalledTimes(1);
    expect(state.memorise).not.toBeNull();

    await recite.keepSlips();
    expect(state.memorise).toBeNull();
  });

  it("loads the model again before listening after a failure", async () => {
    vi.mocked(engine.prepare).mockResolvedValueOnce({ ok: false, why: "model" });
    await recite.startMemorising();
    expect(state.memorise).toMatchObject({ phase: "paused", problem: "model" });
    vi.mocked(engine.isReady).mockReturnValue(false);
    await recite.toggleListening();
    expect(engine.prepare).toHaveBeenCalledTimes(2);
    expect(state.memorise?.phase).toBe("listening");
  });

  it("ends, and lets the model go, when the reader closes", async () => {
    void recite.startMemorising();
    await flush();
    recite.leaveReader();
    expect(state.memorise).toBeNull();
    expect(captures[0].stop).toHaveBeenCalled();
    expect(engine.release).toHaveBeenCalled();
  });
});

describe("removing the download", () => {
  it("waits while the download is still going", async () => {
    const done = deferred<{ ok: true }>();
    vi.mocked(assets.downloadReciteFiles).mockReturnValue(done.promise);
    vi.mocked(assets.reciteFiles).mockResolvedValueOnce({ ready: false });
    await recite.openFind();
    void recite.download();
    await recite.removeDownload();
    expect(assets.removeReciteFiles).not.toHaveBeenCalled();
    expect(state.notice).toContain("still going");
    done.resolve({ ok: true });
    await flush();
  });

  it("lets the model go and takes the files off the device", async () => {
    await recite.removeDownload();
    expect(engine.release).toHaveBeenCalled();
    expect(assets.removeReciteFiles).toHaveBeenCalled();
    expect(state.notice).toContain("removed");
  });
});
