// Words from outside the app shown as plain text: direction-changing and invisible spoofing characters go, the joiners
// that real scripts and emoji need stay, and a cut never splits a character in two.
import { describe, expect, it } from "vitest";
import { cleanShown } from "../src/talk/text.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

describe("cleaning outside words for the screen", () => {
  it("drops bidi overrides and isolates, zero-width spaces and invisible tag characters", () => {
    const sneaky = `pay${cp(0x202e)}moc.evil${cp(0x2066)}${cp(0x200b)}${cp(0xe0041, 0xe0042)}${cp(0xfeff)} now`;
    expect(cleanShown(sneaky, 100)).toBe("paymoc.evil now");
  });

  it("keeps the joiners Persian, Urdu and emoji families need", () => {
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const persian = `${cp(0x645, 0x6cc)}${cp(0x200c)}${cp(0x62e, 0x648, 0x627, 0x647, 0x645)}`;
    expect(cleanShown(`${family} ${persian}`, 100)).toBe(`${family} ${persian}`);
  });

  it("turns line breaks and other controls into one space", () => {
    expect(cleanShown(`two\nlines${cp(0x2028)}three${cp(0x7)}`, 100)).toBe("two lines three");
  });

  it("cuts by whole characters, never leaving half of one", () => {
    const smiles = cp(0x1f600).repeat(5);
    expect(cleanShown(smiles, 3)).toBe(cp(0x1f600).repeat(3));
    expect([...cleanShown(`a${cp(0x1f600)}`, 2)]).toHaveLength(2);
  });

  it("answers nothing for anything that is not text", () => {
    expect(cleanShown(5, 10)).toBe("");
    expect(cleanShown(null, 10)).toBe("");
  });
});
