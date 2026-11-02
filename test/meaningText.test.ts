// The texts under a dhikr made ready to show: Arabic folded to compare two copies of the same words, the morning's or
// the evening's part of an item that holds both, and hisnmuslim.com's transliteration made readable without changing a
// word. The Arabic here is made up for the tests, never Quran.
import { describe, expect, it } from "vitest";
import {
  fingerprint, foldArabic, plainTranslation, sessionPart, shareOfPairs, showTranslation, showTransliteration, tidyText,
  withoutInvisible,
} from "../src/faith/meaningText.ts";

const AYN = String.fromCodePoint(0x2bf);

describe("folding Arabic", () => {
  it("drops the vowel marks and the tatweel", () => {
    expect(foldArabic("ذَهَبَ الْوَلَدُ")).toBe("ذهب الولد");
    expect(foldArabic("كـتـاب")).toBe("كتاب");
  });

  it("writes every alef the same, ta marbuta as ha and alef maqsura as ya", () => {
    expect(foldArabic("أحمد إلى آخر ٱسم")).toBe("احمد الي اخر اسم");
    expect(foldArabic("مدرسة")).toBe("مدرسه");
    expect(foldArabic("مشى")).toBe("مشي");
  });

  it("keeps letters only: brackets, commas and counts become spaces", () => {
    expect(foldArabic("((قَالَ، ثُمَّ مَشَى)) (ثَلَاثَ مَرَّاتٍ).")).toBe("قال ثم مشي ثلاث مرات");
    expect(foldArabic("")).toBe("");
  });
});

describe("how much of our words another copy holds", () => {
  it("is the share of our word pairs found in theirs", () => {
    expect(shareOfPairs("ذهب الولد الي المدرسه", "((ذَهَبَ الْوَلَدُ إِلَى الْمَدْرَسَةِ)) (مرة)")).toBe(1);
    expect(shareOfPairs("ذهب الولد الي المدرسه", "ذهب الولد الي البيت")).toBeCloseTo(2 / 3);
    expect(shareOfPairs("ذهب الولد", "جلست البنت")).toBe(0);
    expect(shareOfPairs("", "ذهب")).toBe(0);
  });

  it("counts a single word as itself", () => {
    expect(shareOfPairs("مرحبا", "قالت مرحبا")).toBe(1);
    expect(shareOfPairs("مرحبا", "قالت شكرا")).toBe(0);
  });
});

describe("the morning's or the evening's part", () => {
  const both = "(We set out in the morning.)[In the evening:] (We set out in the evening.)";

  it("splits at the marker: the morning before it, the evening after it", () => {
    expect(sessionPart(both, "morning")).toBe("(We set out in the morning.)");
    expect(sessionPart(both, "evening")).toBe("(We set out in the evening.)");
  });

  it("knows the longer marker too", () => {
    const longer = "(Morning words.)[For the evening, the supplication is read as follows: ](Evening words.)";
    expect(sessionPart(longer, "morning")).toBe("(Morning words.)");
    expect(sessionPart(longer, "evening")).toBe("(Evening words.)");
    expect(sessionPart("(Morning.)[in the EVENING:](Evening.)", "evening")).toBe("(Evening.)");
  });

  it("shows the whole text when the marker is not there, rather than guess", () => {
    const note = "(Morning words.)(Note: for the evening, one reads kalimatan instead of kalimatun.)";
    expect(sessionPart(note, "evening")).toBe(note);
    expect(sessionPart(note, "morning")).toBe(note);
  });

  it("shows the whole text when there are two markers, or one with nothing on a side", () => {
    const twice = "(A.)[In the evening:](B.)[In the evening:](C.)";
    expect(sessionPart(twice, "evening")).toBe(twice);
    expect(sessionPart("[In the evening:] (Only evening.)", "morning")).toBe("[In the evening:] (Only evening.)");
    expect(sessionPart("(Only morning.) [In the evening:]", "evening")).toBe("(Only morning.) [In the evening:]");
  });

  it("shows the whole text for a du'a, which has no session", () => {
    expect(sessionPart(both, null)).toBe(both);
  });

  it("leaves other bracketed notes alone", () => {
    expect(sessionPart("(Words.) [ten times]", "evening")).toBe("(Words.) [ten times]");
  });
});

describe("the transliteration on screen", () => {
  // Everyday made-up Arabic in their spelling: "he sat on the chair", "and I gave a book", "with his friend".
  it("writes their AA as the letter ayn", () => {
    expect(showTransliteration("jalasa AAala al-kursi")).toBe(`jalasa ${AYN}ala al-kursi`);
    expect(showTransliteration("wa-aAAtaytu kitaban")).toBe(`wa-a${AYN}taytu kitaban`);
    expect(showTransliteration("maAAa sadeeqihi")).toBe(`ma${AYN}a sadeeqihi`);
  });

  it("leaves a lower-case long vowel as it is", () => {
    expect(showTransliteration("Marhabaa bika yaa 'Umar")).toBe("Marhabaa bika yaa 'Umar");
  });

  it("only tidies: the words stay as they were", () => {
    const shown = showTransliteration("(Dhahaba al-waladu,  ila l-madrasati, sha/nu kitabihi.)");
    expect(shown).toBe("Dhahaba al-waladu, ila l-madrasati, sha/nu kitabihi.");
  });
});

describe("tidying", () => {
  it("drops the brackets wrapped round the whole text", () => {
    expect(tidyText("(Some words.)")).toBe("Some words.");
    expect(tidyText("((Some words.))")).toBe("Some words.");
    expect(tidyText("  (Some (inner) words.)  ")).toBe("Some (inner) words.");
  });

  it("makes double brackets single, and keeps two groups apart", () => {
    expect(tidyText("(First part.)((ten times))")).toBe("(First part.) (ten times)");
    expect(tidyText("(First part.)(Second part.)")).toBe("(First part.) (Second part.)");
  });

  it("leaves brackets that do not pair up as they are", () => {
    expect(tidyText("(Words.)ten times)")).toBe("(Words.) ten times)");
  });

  it("puts spaces where they belong and takes out the rest", () => {
    expect(tidyText("one ,two")).toBe("one, two");
    expect(tidyText("words .")).toBe("words.");
    expect(tidyText("Zaydin[ten times]")).toBe("Zaydin [ten times]");
    expect(tidyText("( [ten times or once])")).toBe("[ten times or once]");
    expect(tidyText("a\n\tb   c")).toBe("a b c");
  });

  it("shows the English the same way, without touching its letters", () => {
    expect(showTranslation("(Then AAbdullah  said.)")).toBe("Then AAbdullah said.");
  });
});

describe("invisible marks in fetched text", () => {
  it("goes: controls, bidi overrides and isolates, zero-width marks and the byte order mark", () => {
    const marks = [0x07, 0x1b, 0x85, 0x200b, 0x200e, 0x200f, 0x202e, 0x2066, 0x2069, 0xfeff].map((c) => String.fromCodePoint(c)).join("");
    expect(withoutInvisible(`a${marks}b`)).toBe("ab");
  });

  it("keeps letters, accents, the ayn's mark, line breaks and Arabic", () => {
    const text = `ḥā ${AYN}a\nسلام`;
    expect(withoutInvisible(text)).toBe(text);
  });
});

describe("a fingerprint", () => {
  it("is the same for the same text and differs for another", () => {
    expect(fingerprint("one")).toBe(fingerprint("one"));
    expect(fingerprint("one")).not.toBe(fingerprint("two"));
    expect(fingerprint("x".repeat(500))).toMatch(/^500-[0-9a-z]+$/);
  });
});

describe("Quran.com's translation as plain text", () => {
  it("drops the footnote marks and any other tags", () => {
    expect(plainTranslation("A made-up line.<sup foot_note=12345>1</sup>")).toBe("A made-up line.");
    expect(plainTranslation("Some <i>slanted</i> words")).toBe("Some slanted words");
  });

  it("reads the plain entities, so they are escaped once when shown", () => {
    expect(plainTranslation("Fish &amp; chips &quot;here&quot; &#39;now&#39; &lt;b&gt;")).toBe(`Fish & chips "here" 'now' <b>`);
  });

  it("reads each entity once, numbers and the usual quotes included", () => {
    expect(plainTranslation("&amp;lt; stays")).toBe("&lt; stays");
    expect(plainTranslation("it&rsquo;s &#x27;so&#x27;&nbsp;now&hellip;")).toBe(`it${String.fromCodePoint(0x2019)}s 'so' now${String.fromCodePoint(0x2026)}`);
    expect(plainTranslation("&madeup; &#0; &#xD800; &#x202E;x")).toBe("&madeup; &#0; &#xD800; x");
  });

  it("drops invisible marks a translation carries", () => {
    expect(plainTranslation(`one${String.fromCodePoint(0x202e)} two`)).toBe("one two");
  });

  it("keeps a stray angle bracket as a character, never as a tag", () => {
    expect(plainTranslation("one < two")).toBe("one < two");
  });
});
