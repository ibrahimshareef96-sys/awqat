// Page fonts are kept only when they are byte for byte the King Fahd Complex font for that page.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fontMatches } from "../src/quran/fontCheck.ts";
import { FONT_SHA256 } from "../src/quran/fontHashes.ts";

const font = Buffer.from("wOF2 pretend page font bytes");
const hashes = [createHash("sha256").update(font).digest("base64"), "other"];

describe("checking a page font", () => {
  it("accepts the exact font for its page", async () => {
    expect(await fontMatches(1, font.toString("base64"), hashes)).toBe(true);
  });

  it("refuses a changed font, the wrong page, bad base64 or a page with no hash", async () => {
    expect(await fontMatches(1, Buffer.from("wOF2 changed").toString("base64"), hashes)).toBe(false);
    expect(await fontMatches(2, font.toString("base64"), hashes)).toBe(false);
    expect(await fontMatches(1, "%%%not base64", hashes)).toBe(false);
    expect(await fontMatches(3, font.toString("base64"), hashes)).toBe(false);
  });

  it("has a distinct hash for each of the 604 pages", () => {
    expect(FONT_SHA256).toHaveLength(604);
    expect(new Set(FONT_SHA256).size).toBe(604);
    expect(FONT_SHA256.every((h) => /^[A-Za-z0-9+/]{43}=$/.test(h))).toBe(true);
  });
});
