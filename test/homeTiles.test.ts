// Home's way to every other screen: a tile each under one heading, each saying what is in it.
import { describe, expect, it } from "vitest";
import { homeTiles } from "../src/ui/views.ts";

const TILE = /<button type="button" class="tile" data-go="([a-z]+)"><span class="tile-name">([^<]+)<\/span><span class="tile-about">([^<]+)<\/span><\/button>/g;
const tilesOf = (html: string): string[][] => [...html.matchAll(TILE)].map((tile) => [tile[1], tile[2], tile[3]]);

describe("Home's tiles", () => {
  const withServer = homeTiles("https://os.example.com");
  const without = homeTiles("");

  it("gives every other screen a tile with its name and one line on what is in it", () => {
    expect(tilesOf(withServer).map(([go]) => go)).toEqual(["review", "modes", "books", "learn", "agenda", "body", "money", "work", "inbox"]);
    for (const [, name, about] of tilesOf(withServer)) {
      expect(name.length).toBeGreaterThan(2);
      expect(about.length).toBeGreaterThan(10);
      // Two lines at most on a narrow phone.
      expect(about.length).toBeLessThanOrEqual(34);
    }
  });

  it("offers Work and Inbox only with the user's own server set up", () => {
    expect(tilesOf(without).map(([go]) => go)).toEqual(["review", "modes", "books", "learn", "agenda", "body", "money"]);
  });

  it("sits under its own heading, in a named landmark", () => {
    expect(withServer.indexOf('<h2 class="section-title">More</h2>')).toBeGreaterThanOrEqual(0);
    expect(withServer.indexOf("section-title")).toBeLessThan(withServer.indexOf('<nav class="tiles" aria-label="More of your OS">'));
  });

  it("replaces the old row of small upper-case links", () => {
    expect(withServer).not.toContain("quiet");
  });
});
