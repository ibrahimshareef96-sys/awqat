// The speech worker's own fence: the page's security policy does not reach the worker, so its fetch refuses any web
// address of another site and lets the app's own files by; ownFile is the same test for the runtime ONNX Runtime
// imports, which fetch never sees.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownFile, sameOriginFetch } from "../src/recite/sameOrigin.ts";

const ANDROID = "https://localhost/assets/worker-abc.js";
const IOS = "capacitor://localhost/assets/worker-abc.js";

const fenced = (here: string) => {
  const inner = vi.fn(async () => new Response("ok"));
  return { inner, fetch: sameOriginFetch(inner as unknown as typeof fetch, here) };
};

describe("the speech worker's fetch", () => {
  it("reads the app's own files: a path, the runtime's full address, and Capacitor's file server", async () => {
    const { inner, fetch } = fenced(ANDROID);
    await fetch("/_capacitor_file_/data/recite/model/config.json");
    await fetch("https://localhost/recite-runtime/ort-wasm-simd-threaded.wasm");
    await fetch(new URL("https://localhost/recite-runtime/a.mjs"));
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("refuses another site before anything goes, however the address is given", async () => {
    const { inner, fetch } = fenced(ANDROID);
    await expect(fetch("https://huggingface.co/some/model/resolve/main/config.json")).rejects.toThrow(TypeError);
    await expect(fetch(new Request("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/a.wasm"))).rejects.toThrow(TypeError);
    await expect(fetch(new URL("http://localhost/recite-runtime/a.wasm"))).rejects.toThrow(TypeError);
    await expect(fetch("//example.com/a.json")).rejects.toThrow(TypeError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("on iOS, where the app is served from its own scheme, reads its files and refuses every web address", async () => {
    const { inner, fetch } = fenced(IOS);
    await fetch("/_capacitor_file_/var/mobile/recite/tanzil-uthmani.txt");
    await fetch("capacitor://localhost/recite-runtime/a.wasm");
    expect(inner).toHaveBeenCalledTimes(2);
    await expect(fetch("https://localhost/recite-runtime/a.wasm")).rejects.toThrow(TypeError);
    await expect(fetch("https://huggingface.co/a")).rejects.toThrow(TypeError);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("lets a blob or a data address by, which never leaves the phone", async () => {
    const { inner, fetch } = fenced(ANDROID);
    await fetch("data:application/octet-stream;base64,AAAA");
    await fetch("blob:https://localhost/6f1c2a4e-0000-4000-8000-000000000000");
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("passes the request and its options through unchanged", async () => {
    const { inner, fetch } = fenced(ANDROID);
    const init = { method: "HEAD" };
    await fetch("/recite-dev/config.json", init);
    expect(inner).toHaveBeenCalledWith("/recite-dev/config.json", init);
  });
});

describe("a file of the app's own", () => {
  it("is a path, an address on the app's own origin, or no web address at all", () => {
    expect(ownFile("/recite-runtime/a.mjs", ANDROID)).toBe(true);
    expect(ownFile("https://localhost/recite-runtime/a.wasm", ANDROID)).toBe(true);
    expect(ownFile("capacitor://localhost/recite-runtime/a.mjs", IOS)).toBe(true);
    expect(ownFile("blob:https://localhost/6f1c2a4e-0000-4000-8000-000000000000", ANDROID)).toBe(true);
  });

  it("is never another site, another scheme of the same host, or an address that does not parse", () => {
    expect(ownFile("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/a.mjs", ANDROID)).toBe(false);
    expect(ownFile("http://localhost/recite-runtime/a.mjs", ANDROID)).toBe(false);
    expect(ownFile("https://localhost/recite-runtime/a.mjs", IOS)).toBe(false);
    expect(ownFile("https://[nope", ANDROID)).toBe(false);
  });
});

describe("the fence put up", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("takes the place of the worker's own fetch once imported in a worker", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("WorkerGlobalScope", class { static [Symbol.hasInstance](): boolean { return true; } });
    vi.stubGlobal("location", { href: ANDROID });
    vi.stubGlobal("fetch", inner);
    vi.resetModules();
    await import("../src/recite/sameOrigin.ts");
    await expect(globalThis.fetch("https://huggingface.co/a")).rejects.toThrow(TypeError);
    await globalThis.fetch("/recite-runtime/a.wasm");
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("leaves the page's fetch alone outside a worker", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", inner);
    vi.resetModules();
    await import("../src/recite/sameOrigin.ts");
    expect(globalThis.fetch).toBe(inner);
  });
});
