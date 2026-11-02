// Covers for books with no ISBN: Open Library asked by title and first author, the title cut to the book's own name,
// and only a match on that name (with a cover) taken, since a wrong cover is worse than none.
import { describe, expect, it, vi } from "vitest";
import { findTitle, mainTitle, pickByTitle } from "../src/books/openlibrary.ts";

const doc = (title: string, cover_i: number | null = 11) => ({ title, author_name: ["P. Writer"], cover_i });

describe("searching Open Library by title", () => {
  it("cuts a Goodreads title to the book's own name", () => {
    expect(mainTitle("The Name of the Wind (The Kingkiller Chronicle, #1)")).toBe("The Name of the Wind");
    expect(mainTitle("Everyday Wonders: An Easy & Proven Way to Build Good Habits")).toBe("Everyday Wonders");
    expect(mainTitle("Re:Zero")).toBe("Re:Zero");
  });

  it("takes the first answer with the same name and a cover, ignoring case, accents and punctuation", () => {
    const json = { docs: [doc("Everyday Wonders Workbook"), doc("Everyday wonders", null), doc("EVERYDAY WONDERS!", 42)] };
    expect(pickByTitle(json, "Everyday Wonders: An Easy & Proven Way")?.coverId).toBe(42);
    expect(pickByTitle({ docs: [doc("Les Misérables", 7)] }, "Les Miserables")?.coverId).toBe(7);
  });

  it("holds a series volume to its own subtitle, so one volume never takes another's cover", () => {
    const json = { docs: [doc("Mistborn: The Final Empire", 1), doc("Mistborn: The Hero of Ages", 3)] };
    expect(pickByTitle(json, "Mistborn: The Hero of Ages (Mistborn, #3)")?.coverId).toBe(3);
    expect(pickByTitle({ docs: [doc("Mistborn: The Final Empire", 1)] }, "Mistborn: The Hero of Ages")).toBeNull();
  });

  it("takes nothing that is only like it", () => {
    expect(pickByTitle({ docs: [doc("Dune Messiah"), doc("The Dune Encyclopedia")] }, "Dune")).toBeNull();
    expect(pickByTitle({ docs: "nope" }, "Dune")).toBeNull();
    expect(pickByTitle({ docs: [doc("Dune")] }, "(#1)")).toBeNull();
  });

  it("sends only the main title and the first author, and says when Open Library is slow or down", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ docs: [doc("The Name of the Wind", 5)] })));
    const found = await findTitle("The Name of the Wind (The Kingkiller Chronicle, #1)", "Yusuf Example", fetcher);
    expect(found).toEqual({ found: { title: "The Name of the Wind", authors: ["P. Writer"], pages: null, coverId: 5 } });
    const url = String((fetcher.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("title=The%20Name%20of%20the%20Wind&author=Yusuf%20Example");
    expect(url).not.toContain("Kingkiller");
    expect(await findTitle("Dune", undefined, vi.fn(async () => new Response("", { status: 429 }))))
      .toEqual({ failed: true, slowDown: true });
    expect(await findTitle("Dune", undefined, vi.fn(async () => { throw new Error("offline"); })))
      .toEqual({ failed: true, slowDown: false });
    expect(await findTitle("", "X", vi.fn())).toEqual({ none: true });
  });
});
