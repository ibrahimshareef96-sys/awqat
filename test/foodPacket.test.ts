// A packet looked up by its barcode on Open Food Facts, and a meal estimated from a photo by the user's own server:
// every answer is checked field by field, and anything else is "not known" or "failed", never a guess. Stand-in servers.
import { describe, expect, it, vi } from "vitest";
import { cleanBarcode, findPacket, parsePacket } from "../src/food/packet.ts";
import { PHOTO_BASE64_MAX, estimateMeal, parseEstimate } from "../src/food/estimate.ts";

const PRODUCT = { status: 1, product: { product_name: "Hazelnut spread", brands: "Example Foods, Other", serving_quantity: "15",
  nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 } } };
/** A right-to-left override and a null, written by their numbers so this file holds no hidden character itself. */
const HIDDEN = String.fromCharCode(0x202e, 0);
const answer = (body: unknown, status = 200): Response => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("a barcode", () => {
  it("is 8, 12, 13 or 14 digits and nothing else", () => {
    for (const good of ["12345678", "123456789012", "3017620422003", "12345678901234"]) expect(cleanBarcode(` ${good} `)).toBe(good);
    for (const bad of ["1234567", "123456789", "30176204220034567", "30176 20422003", "https://example.com", "../3017620422003", "", null, 3017620422003]) {
      expect(cleanBarcode(bad)).toBeNull();
    }
  });
});

describe("a packet from Open Food Facts", () => {
  it("is read with its name, brand, serving and what 100 g holds", () => {
    expect(parsePacket(PRODUCT, "3017620422003")).toEqual({ code: "3017620422003", name: "Hazelnut spread, Example Foods", serving: 15,
      per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9 } });
  });

  it("takes kilojoules where no kilocalories are given, and leaves out what is missing or absurd", () => {
    const p = parsePacket({ status: 1, product: { product_name: "Oats", nutriments: { "energy-kj_100g": 1548, proteins_100g: 250, fat_100g: -1 } } }, "12345678");
    expect(p).toEqual({ code: "12345678", name: "Oats", serving: null, per100: { kcal: 370, protein: null, carbs: null, fat: null } });
  });

  it("is not known without a name, without energy, or when the product was not found", () => {
    expect(parsePacket({ status: 0 }, "12345678")).toBeNull();
    expect(parsePacket({ status: 1, product: { product_name: "", nutriments: { "energy-kcal_100g": 100 } } }, "12345678")).toBeNull();
    expect(parsePacket({ status: 1, product: { product_name: "Water", nutriments: {} } }, "12345678")).toBeNull();
    expect(parsePacket({ status: 1, product: { product_name: "Odd", nutriments: { "energy-kcal_100g": 5000 } } }, "12345678")).toBeNull();
    for (const junk of [null, "text", 4, [], { status: 1, product: null }]) expect(parsePacket(junk, "12345678")).toBeNull();
  });

  it("has its name cleaned of hidden characters and cut short", () => {
    const p = parsePacket({ status: 1, product: { product_name: `Bar${HIDDEN} ${"x".repeat(200)}`, nutriments: { "energy-kcal_100g": 100 } } }, "12345678");
    expect(p?.name.length).toBeLessThanOrEqual(60);
    expect([...HIDDEN].some((c) => p?.name.includes(c))).toBe(false);
  });

  it("is asked for by its barcode only, with no redirect followed and nothing else sent", async () => {
    const fetcher = vi.fn(async () => answer(PRODUCT));
    const found = await findPacket("3017620422003", fetcher);
    expect("found" in found && found.found.name).toBe("Hazelnut spread, Example Foods");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://world.openfoodfacts.org/api/v2/product/3017620422003?fields=product_name,brands,nutriments,serving_quantity");
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("never asks for something that is not a barcode", async () => {
    const fetcher = vi.fn(async () => answer(PRODUCT));
    expect(await findPacket("../../secret", fetcher)).toEqual({ none: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says not known for a 404 or an unknown product, and failed for anything else", async () => {
    expect(await findPacket("12345678", async () => answer({ status: 0 }, 404))).toEqual({ none: true });
    expect(await findPacket("12345678", async () => answer({ status: 0 }))).toEqual({ none: true });
    expect(await findPacket("12345678", async () => answer("busy", 503))).toEqual({ failed: true });
    expect(await findPacket("12345678", async () => answer("<html>"))).toEqual({ failed: true });
    expect(await findPacket("12345678", async () => answer("x".repeat(200_001)))).toEqual({ failed: true });
    expect(await findPacket("12345678", async () => { throw new TypeError("offline"); })).toEqual({ failed: true });
  });
});

describe("an estimate from the user's own server", () => {
  const PHOTO = "/9j/AAAA";
  const send = (status: number, data: unknown) => vi.fn(async () => ({ status, data, headers: {}, url: "" }));

  it("is read when every part is an estimate's", () => {
    expect(parseEstimate({ ok: true, name: " Chicken wrap ", kcal: 512.4, protein: 31.26, carbs: null, fat: 18 }))
      .toEqual({ name: "Chicken wrap", kcal: 512, protein: 31.3, carbs: null, fat: 18 });
  });

  it("is refused when any part is not", () => {
    for (const bad of [null, [], "text", { name: "", kcal: 100 }, { name: "x", kcal: "100" }, { name: "x", kcal: -1 }, { name: "x", kcal: 20_000 },
      { name: "x", kcal: 100, protein: "lots" }, { name: "x", kcal: 100, fat: -2 }, { name: "x", kcal: Number.NaN }]) {
      expect(parseEstimate(bad)).toBeNull();
    }
  });

  it("is asked for with the session, over https, never following a redirect", async () => {
    const post = send(200, { ok: true, name: "Soup", kcal: 180, protein: 9 });
    expect(await estimateMeal("https://worker.example", "token", PHOTO, post)).toEqual({ estimate: { name: "Soup", kcal: 180, protein: 9, carbs: null, fat: null } });
    expect((post.mock.calls[0] as unknown[])[0]).toMatchObject({ url: "https://worker.example/app/food/estimate", data: { image: PHOTO },
      disableRedirects: true, headers: { Authorization: "Bearer token" } });
  });

  it("sends nothing to a plain http address, nor anything that is not a JPEG of a sane size", async () => {
    const post = send(200, { ok: true, name: "Soup", kcal: 180 });
    expect(await estimateMeal("http://worker.example", "token", PHOTO, post)).toEqual({ failed: true, signedOut: false });
    expect(await estimateMeal("https://worker.example", "token", "PHN2Zz4=", post)).toEqual({ failed: true, signedOut: false });
    expect(await estimateMeal("https://worker.example", "token", `/9j/${"A".repeat(PHOTO_BASE64_MAX)}`, post)).toEqual({ failed: true, signedOut: false });
    expect(post).not.toHaveBeenCalled();
  });

  it("says the session ended on a 401, unsure when the server sees no meal, and failed for the rest", async () => {
    expect(await estimateMeal("https://worker.example", "t", PHOTO, send(401, { ok: false }))).toEqual({ failed: true, signedOut: true });
    expect(await estimateMeal("https://worker.example", "t", PHOTO, send(200, { ok: true, unsure: true }))).toEqual({ unsure: true });
    expect(await estimateMeal("https://worker.example", "t", PHOTO, send(200, { ok: true, name: "x", kcal: -5 }))).toEqual({ failed: true, signedOut: false });
    expect(await estimateMeal("https://worker.example", "t", PHOTO, send(200, "<html>"))).toEqual({ failed: true, signedOut: false });
    expect(await estimateMeal("https://worker.example", "t", PHOTO, send(302, null))).toEqual({ failed: true, signedOut: false });
    expect(await estimateMeal("https://worker.example", "t", PHOTO, vi.fn(async () => { throw new Error("offline"); }))).toEqual({ failed: true, signedOut: false });
  });

  it("gives up once its deadline passes", async () => {
    const never = vi.fn(() => new Promise<never>(() => undefined));
    expect(await estimateMeal("https://worker.example", "t", PHOTO, never, 5)).toEqual({ failed: true, signedOut: false });
  });
});
