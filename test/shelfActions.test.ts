// Keeping the TV's shelf in step: sent once the Talk session is read, only when it changed (or the session did), one
// send at a time with a change during a send sent right after, and what Books says when it could not go.
import { beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({ isNative: vi.fn(() => true) }));
const http = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("../src/device.ts", () => device);
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()), CapacitorHttp: { put: http.put },
}));

import { addBook, emptyLibrary, type Library } from "../src/books/library.ts";
import { hooks, state } from "../src/app/state.ts";
import { SHELF_PAUSE_MS, resetShelf, shelfChanged, syncShelf } from "../src/app/shelfActions.ts";
import type { Put } from "../src/books/shelf.ts";

const WORKER = "https://os-inbox.example.com";
const TOKEN = "a".repeat(43);

function library(...titles: string[]): Library {
  return titles.reduce((lib, title) => addBook(lib, { title, authors: [], isbn: null, pages: null, coverId: null,
    photo: null, source: "typed", shelf: "reading" }, "2026-10-28").library, emptyLibrary());
}

const taken = { status: 200, data: { ok: true }, headers: {}, url: "" };
const ok = () => vi.fn<Put>(async () => taken);

beforeEach(() => {
  resetShelf();
  http.put.mockReset();
  http.put.mockResolvedValue(taken);
  device.isNative.mockReturnValue(true);
  state.settings = { ...state.settings, voiceUrl: WORKER };
  state.talk = { ...state.talk, session: { worker: WORKER, token: TOKEN }, sessionRead: true };
  state.library = library("One", "Two");
  state.tvShelf = { state: "idle" };
  hooks.softRender = vi.fn();
});

describe("sending the shelf", () => {
  it("sends the books in hand once, and not again until something changes", async () => {
    const send = ok();
    await syncShelf(send);
    await syncShelf(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.tvShelf).toMatchObject({ state: "sent", count: 2 });
    state.library = library("One", "Two", "Three");
    await syncShelf(send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends again for a new session, as the Worker may not have the shelf from this one", async () => {
    const send = ok();
    await syncShelf(send);
    state.talk = { ...state.talk, session: { worker: WORKER, token: "b".repeat(43) } };
    await syncShelf(send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits for the session to be read, and does nothing outside the installed app", async () => {
    const send = ok();
    state.talk = { ...state.talk, sessionRead: false };
    await syncShelf(send);
    state.talk = { ...state.talk, sessionRead: true };
    device.isNative.mockReturnValue(false);
    await syncShelf(send);
    expect(send).not.toHaveBeenCalled();
  });

  it("asks for a Talk sign-in when there is no session for this Worker, sending nothing", async () => {
    const send = ok();
    state.talk = { ...state.talk, session: { worker: "https://another.example.com", token: TOKEN } };
    await syncShelf(send);
    expect(send).not.toHaveBeenCalled();
    expect(state.tvShelf).toEqual({ state: "signin" });
  });

  it("sends again after the address went elsewhere and came back, so Books never stays on sign in", async () => {
    const send = ok();
    await syncShelf(send);
    state.settings = { ...state.settings, voiceUrl: "https://other.example.com" };
    await syncShelf(send);
    expect(state.tvShelf).toEqual({ state: "signin" });
    state.settings = { ...state.settings, voiceUrl: WORKER };
    await syncShelf(send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(state.tvShelf).toMatchObject({ state: "sent" });
  });

  it("tries again later after a send that did not get through", async () => {
    const fails = vi.fn<Put>(async () => ({ status: 404, data: { error: "Not found." }, headers: {}, url: "" }));
    await syncShelf(fails);
    expect(state.tvShelf).toEqual({ state: "missing" });
    const send = ok();
    await syncShelf(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.tvShelf).toMatchObject({ state: "sent" });
  });

  it("sends a change made during a send right after it, one at a time", async () => {
    let release: () => void = () => undefined;
    const send = vi.fn<Put>()
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(taken); }))
      .mockResolvedValue(taken);
    const first = syncShelf(send);
    state.library = library("Changed");
    const second = syncShelf(send);
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1][0].data as { reading: { title: string }[] }).reading.map((b) => b.title)).toEqual(["Changed"]);
  });
});

describe("when it should not go", () => {
  it("sends nothing while the library could not be read, so the TV keeps its shelf", async () => {
    const send = ok();
    state.blocked.add("os.library.v1");
    try {
      state.library = emptyLibrary();
      await syncShelf(send);
      expect(send).not.toHaveBeenCalled();
    } finally {
      state.blocked.delete("os.library.v1");
    }
  });

  it("drops a session the Worker no longer knows, and asks for a sign-in", async () => {
    const refused = vi.fn<Put>(async () => ({ status: 401, data: { error: "Sign in on the app first." }, headers: {},
      url: "" }));
    await syncShelf(refused);
    expect(state.talk.session).toBeNull();
    expect(state.tvShelf).toEqual({ state: "signin" });
  });

  it("keeps going when a redraw fails, without an unhandled rejection", async () => {
    hooks.softRender = vi.fn(() => { throw new Error("redraw"); });
    await expect(syncShelf(ok())).resolves.toBeUndefined();
    hooks.softRender = vi.fn();
    state.library = library("Next");
    const send = ok();
    await syncShelf(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("after a library change", () => {
  it("sends once the changes settle, with the phone's own HTTP", async () => {
    vi.useFakeTimers();
    try {
      shelfChanged();
      shelfChanged();
      await vi.advanceTimersByTimeAsync(SHELF_PAUSE_MS - 1);
      expect(http.put).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(http.put).toHaveBeenCalledTimes(1);
      expect(http.put.mock.calls[0][0]).toMatchObject({ url: `${WORKER}/app/library`, disableRedirects: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
