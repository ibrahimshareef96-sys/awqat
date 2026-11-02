"""Builds src/faith/adhkarData.ts from Seen-Arabic's Morning-And-Evening-Adhkar-DB (MIT, Copyright (c) 2024 Seen Arabic).

Usage: python3 -I scripts/make-adhkar-data.py /path/to/ar.json
The file is ar.json at commit dbe92e887ee18a67df7c32b9a44e091b1dfa0cbd (14 Feb 2026), checked by its SHA-256 below.

Only the Arabic words, the counts and the source lines are kept. The dataset's English copies two copyrighted
translations, so it is left out; the short English names below are our own. Nothing of the Quran is kept: Ayat
al-Kursi, the end of Al-Baqarah, the three Quls and "Hasbiya Allah" (the closing words of At-Tawbah 129, said as they
stand) are read in the app's mushaf, so for them only the words said before the recitation (the isti'adha) stay, with
the surah and ayahs to open. The line drawn: an item that is the words of an ayah, said as they are, is Quran; a
hadith dua that echoes a Quranic phrase inside its own words is a dua and stays. The opening line (order 1) is the
chapter's preface, not a dhikr, and is left out.

Checked on 27 Oct 2026 against rn0x/Adhkar-json's copy of Hisn al-Muslim, word by word: the letters agree everywhere;
the vowel marks fixed in CORRECTIONS are the ones that were wrong.
"""
import hashlib
import json
import sys
import unicodedata
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "faith" / "adhkarData.ts"
SHA256 = "9e0dd6a10d26ddc0e2b36b94098c287644996c7f81b707f8ad24f1ce40b8c821"

# The dataset's type: 0 both, 1 morning, 2 evening.
SESSIONS = {0: ["morning", "evening"], 1: ["morning"], 2: ["evening"]}

# Recited from the mushaf, not shown: (surah, first ayah, last ayah, which words when not the whole ayah or "").
QURAN = {2: (2, 255, 255, ""), 3: (2, 285, 286, ""), 4: (112, 1, 4, ""), 5: (113, 1, 5, ""), 6: (114, 1, 6, ""),
         17: (9, 129, 129, "its closing words")}
# The isti'adha is the only thing a Quran item may keep: five words (a'udhu billahi min ash-shaytan ar-rajim).
ISTIADHA_START = "أَعُوذُ"
# Read at night: the last two verses of Al-Baqarah (Bukhari 4008, "in a night"), so from Maghrib.
NIGHT = {3}
SKIP = {1}

NAMES = {
    2: "Ayat al-Kursi",
    3: "The last two verses of Al-Baqarah",
    4: "Al-Ikhlas",
    5: "Al-Falaq",
    6: "An-Nas",
    7: "We have reached the morning",
    8: "We have reached the evening",
    9: "By You we reach the morning",
    10: "By You we reach the evening",
    11: "Sayyid al-Istighfar",
    12: "I call on You to witness",
    13: "I call on You to witness",
    14: "Every blessing is from You",
    15: "Every blessing is from You",
    16: "Well-being in body, hearing and sight",
    17: "Allah is enough for me",
    18: "Pardon and well-being",
    19: "Knower of the unseen",
    20: "In the name of Allah, with whose name nothing harms",
    21: "Content with Allah as Lord",
    22: "Ya Hayy, ya Qayyum",
    23: "The good of this day",
    24: "The good of this night",
    25: "Upon the fitrah of Islam",
    26: "Upon the fitrah of Islam",
    27: "Knowledge that benefits",
    28: "La ilaha illa Allah wahdahu",
    29: "Salawat on the Prophet ﷺ",
    30: "The perfect words of Allah",
    31: "Glory be to Allah, as many as His creation",
    32: "La ilaha illa Allah wahdahu",
    33: "Istighfar",
    34: "SubhanAllah wa bihamdihi",
}

# Vowel marks the dataset has wrong (order: [(wrong, right), ...]). Order 7 lost the damma of al-mulk twice; order 24
# (the evening "khayra hadhihi al-laylah") has a dual al-'alamayn, inna for inni, and others; it is given the vowels of
# its morning twin, order 23.
CORRECTIONS = {
    7: [("الْملْكُ", "الْمُلْكُ")],
    24: [("الْعَالَمَيْنِ", "الْعَالَمِينَ"), ("إِنَّي", "إِنِّي"), ("هَذَه", "هَذِهِ"), ("فيهِا", "فِيهَا"),
         ("وَشَرَّ", "وَشَرِّ")],
}

# The Hisn al-Muslim print writes "rahimahullah" as one glyph that the dataset carries as a quotation mark.
RAHIMAHULLAH = "رحمه الله"


def clean(text: str) -> str:
    """One line of NFC text: controls and invisible marks gone, spaces single, no stray leading punctuation."""
    kept = []
    for ch in unicodedata.normalize("NFC", text):
        if ch in "\n\r\t":
            kept.append(" ")
        elif unicodedata.category(ch) in ("Cc", "Cf"):
            continue
        else:
            kept.append(ch)
    line = " ".join("".join(kept).split())
    return line.lstrip("،, ").strip()


def corrected(order: int, text: str) -> str:
    for wrong, right in CORRECTIONS.get(order, []):
        assert wrong in text, f"order {order}: expected to find {wrong!r}"
        text = text.replace(wrong, right)
    return text


def item(record: dict) -> dict:
    order = record["order"]
    content = clean(record["content"])
    quran = QURAN.get(order)
    if quran:
        # Only what is said before the recitation; the recitation itself is read in the mushaf.
        text = content.split("﴿", 1)[0].strip() if "﴿" in content else ""
        assert text == "" or (text.startswith(ISTIADHA_START) and len(text.split()) == 5), \
            f"order {order}: a Quran item keeps only the isti'adha"
    else:
        assert "﴿" not in content, f"order {order}: Quran brackets in a dhikr"
        text = corrected(order, content)
    source = clean(record["source"].replace("‘", RAHIMAHULLAH))
    count = record["count"]
    assert isinstance(count, int) and 1 <= count <= 100, f"order {order}: count {count!r}"
    entry = {
        "id": order,
        "sessions": SESSIONS[record["type"]],
        "count": count,
        "times": clean(record["count_description"]),
        "name": NAMES[order],
        "text": text,
        "source": source,
    }
    if quran:
        entry["quran"] = {"sura": quran[0], "from": quran[1], "to": quran[2], **({"words": quran[3]} if quran[3] else {})}
    if order in NIGHT:
        entry["night"] = True
    return entry


def main(path: str) -> None:
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == SHA256, f"not the checked file (SHA-256 {digest})"
    records = json.loads(raw.decode("utf-8"))
    assert [r["order"] for r in records] == list(range(1, 35)), "expected orders 1 to 34"
    assert all(r["type"] in SESSIONS for r in records), "unknown type"
    items = [item(r) for r in records if r["order"] not in SKIP]
    assert set(NAMES) == {i["id"] for i in items}, "every item needs a name"
    body = ",\n".join("  " + json.dumps(i, ensure_ascii=False, separators=(",", ":")) for i in items)
    OUT.write_text(
        "// Generated by scripts/make-adhkar-data.py from Seen-Arabic's Morning-And-Evening-Adhkar-DB (MIT, Copyright (c)\n"
        "// 2024 Seen Arabic, https://github.com/Seen-Arabic/Morning-And-Evening-Adhkar-DB), ar.json at commit dbe92e8.\n"
        "// Hisn al-Muslim's morning and evening adhkar: Arabic words, counts and sources only; the Quran items are read in\n"
        "// the mushaf. Do not edit by hand.\n"
        'import type { Dhikr } from "./adhkar.ts";\n\n'
        f"export const ADHKAR: readonly Dhikr[] = [\n{body},\n];\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({len(items)} items)")


if __name__ == "__main__":
    main(sys.argv[1])
