"""Builds src/faith/meaningIds.ts: which item of hisnmuslim.com's developer API ("للمطورين API") holds the English and
the transliteration of each dhikr and du'a in the app. Numbers only: the app fetches those texts on the phone, keeps its
own copy there, and credits them; this repository never holds a word of them.

Usage: python3 -I scripts/make-meaning-ids.py
It downloads https://www.hisnmuslim.com/api/en/27.json (the morning and evening adhkar) and 25.json (after the salam),
folds the Arabic on both sides (no vowel marks or tatweel, one alef, ta marbuta as ha, alef maqsura as ya) and matches
each item by how many of its word pairs the other text holds. It prints the table for a person to check against the
Arabic, then writes the ids.

Left out on purpose:
- The Quran items (Ayat al-Kursi, the end of Al-Baqarah, the three Quls, At-Tawbah 129's closing words): their English
  and transliteration come from Quran.com at run time (src/faith/meaning.ts), never from here.
- LEFT_OUT below: matches that are right but whose texts cannot be shown under our Arabic without guessing.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "faith" / "meaningIds.ts"
ADHKAR = ROOT / "src" / "faith" / "adhkarData.ts"
DUAS = ROOT / "src" / "faith" / "duaData.ts"
API = "https://www.hisnmuslim.com/api/en/{}.json"
ADHKAR_CHAPTER = 27
DUA_CHAPTER = 25
DOWNLOAD_MAX = 2_000_000
# Below this share of our word pairs found in theirs, a match is not trusted (the right ones score 0.8 and more).
THRESHOLD = 0.6
# And the best must beat the next best by this much, or the two are too alike to tell apart.
MARGIN = 0.2

# Checked by hand on 3 Nov 2026. Each is the right item, but its texts would mislead under our words.
LEFT_OUT = {
    7: "item 77's transliteration gives the evening's 'this night' under the morning's words and carries English inside",
    8: "item 77 has no evening wording to split off: its English is the morning's, its transliteration mixed",
    "istikhara": "its item (26.json, 74) wraps the du'a in Jabir's report and Al Imran 159; no marker to cut by",
}

# The letters that fold together, as code points (escapes would be turned into the characters themselves by editors).
DIACRITICS = [(0x0610, 0x061A), (0x064B, 0x065F), (0x0670, 0x0670), (0x06D6, 0x06ED)]
TATWEEL = 0x0640
ALEFS = [0x0622, 0x0623, 0x0625, 0x0671]
ALEF, TA_MARBUTA, HA, ALEF_MAQSURA, YA = 0x0627, 0x0629, 0x0647, 0x0649, 0x064A
LETTERS = (0x0621, 0x064A)


def fold(text: str) -> str:
    """Arabic letters only, without vowel marks or tatweel, one alef, ta marbuta as ha, alef maqsura as ya."""
    out = []
    for ch in text:
        code = ord(ch)
        if code == TATWEEL or any(lo <= code <= hi for lo, hi in DIACRITICS):
            continue
        if code in ALEFS:
            code = ALEF
        elif code == TA_MARBUTA:
            code = HA
        elif code == ALEF_MAQSURA:
            code = YA
        out.append(chr(code) if LETTERS[0] <= code <= LETTERS[1] else " ")
    return " ".join("".join(out).split())


def pairs(words: list) -> set:
    return {f"{a} {b}" for a, b in zip(words, words[1:])}


def share(ours: str, theirs: str) -> float:
    """The share of our word pairs found in theirs: 1 when all of ours is in their text (src/faith/meaningText.ts)."""
    mine, found = fold(ours).split(), fold(theirs).split()
    if len(mine) <= 1:
        return 1.0 if mine and mine[0] in found else 0.0
    return len(pairs(mine) & pairs(found)) / len(pairs(mine))


def download(url: str) -> bytes:
    """The body, read up to DOWNLOAD_MAX: curl uses the system's certificates (this Python may have none), and -q keeps
    any ~/.curlrc out of it."""
    command = ["/usr/bin/curl", "-q", "-sSf", "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "0",
               "--tlsv1.2", "--max-time", "30", "--max-filesize", str(DOWNLOAD_MAX), url]
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as curl:
        body = curl.stdout.read(DOWNLOAD_MAX + 1)
        if len(body) > DOWNLOAD_MAX:
            curl.kill()
            sys.exit(f"{url}: more than {DOWNLOAD_MAX} bytes")
        problem = curl.stderr.read().decode("utf-8", errors="replace")
        if curl.wait() != 0:
            sys.exit(f"{url}: {problem}")
    return body


def get_json(url: str) -> dict:
    try:
        chapter = json.loads(download(url).decode("utf-8-sig"))
        items = next(iter(chapter.values())) if isinstance(chapter, dict) and chapter else None
    except (ValueError, RecursionError) as problem:
        sys.exit(f"{url}: not JSON ({problem})")
    good = isinstance(items, list) and all(isinstance(i, dict) and type(i.get("ID")) is int and i["ID"] > 0 for i in items)
    if not good:
        sys.exit(f"{url}: not a chapter")
    return {i["ID"]: i for i in items if isinstance(i.get("ARABIC_TEXT"), str)}


def generated(path: Path) -> list:
    """The rows of one of our generated data files (one JSON object a line)."""
    return [json.loads(line.strip().rstrip(",")) for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip().startswith("{")]


def match(key, text: str, count: int, chapter: dict):
    """Their item for our words, or None; prints the line a person checks."""
    scores = sorted(((share(text, item["ARABIC_TEXT"]), item_id) for item_id, item in chapter.items()), reverse=True)
    rivals = [s for s in scores[1:] if scores[0][0] - s[0] < MARGIN]
    # The same words said ten times and a hundred times are two items: told apart by their count, when only one fits.
    counted = [s for s in [scores[0], *rivals] if chapter[s[1]].get("REPEAT") == count]
    by_count = bool(rivals) and len(counted) == 1
    best, best_id = counted[0] if by_count else scores[0]
    second, second_id = next(s for s in scores if s[1] != best_id)
    if key in LEFT_OUT:
        verdict = f"left out: {LEFT_OUT[key]}"
    elif best < THRESHOLD or (rivals and not by_count):
        verdict = "left out: not certain"
    else:
        verdict = "mapped, by its count" if by_count else "mapped"
    print(f"{str(key):>10}  {best_id:>4} {best:.2f}  (next {second_id:>3} {second:.2f})  {verdict}")
    return best_id if verdict.startswith("mapped") else None


def main() -> None:
    adhkar_chapter = get_json(API.format(ADHKAR_CHAPTER))
    dua_chapter = get_json(API.format(DUA_CHAPTER))
    print(f"{'ours':>10}  {'item':>4} {'share':>4}")
    adhkar = {}
    for row in generated(ADHKAR):
        if "quran" in row:
            print(f"{row['id']:>10}  Quran: from Quran.com at run time")
            continue
        found = match(row["id"], row["text"], row["count"], adhkar_chapter)
        if found is not None:
            adhkar[row["id"]] = found
    duas = {}
    for row in generated(DUAS):
        if row["id"] in LEFT_OUT:
            print(f"{row['id']:>10}  left out: {LEFT_OUT[row['id']]}")
            continue
        found = match(row["id"], row["text"], row["count"], dua_chapter)
        if found is not None:
            duas[row["id"]] = found
    adhkar_lines = "\n".join(f"  {k}: [{ADHKAR_CHAPTER}, {v}]," for k, v in adhkar.items())
    dua_lines = "\n".join(f'  "{k}": [{DUA_CHAPTER}, {v}],' for k, v in duas.items())
    if not re.fullmatch(r"[\d\s:,\[\]\"a-z-]*", adhkar_lines + dua_lines):
        sys.exit("only ids and numbers go in")
    OUT.write_text(
        "// Generated by scripts/make-meaning-ids.py from hisnmuslim.com's developer API (en/27.json, en/25.json). Numbers\n"
        "// only: which of their items holds the English and transliteration of each dhikr and du'a. The texts themselves\n"
        "// are fetched on the phone (meaning.ts) and never kept in this repository. Do not edit by hand.\n\n"
        "/** A dhikr's id (adhkarData.ts) to [chapter, item] on hisnmuslim.com. */\n"
        f"export const HISN_ADHKAR: Readonly<Record<number, readonly [number, number]>> = {{\n{adhkar_lines}\n}};\n\n"
        "/** A du'a's id (duaData.ts) to [chapter, item] on hisnmuslim.com. */\n"
        f"export const HISN_DUAS: Readonly<Record<string, readonly [number, number]>> = {{\n{dua_lines}\n}};\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({len(adhkar)} adhkar, {len(duas)} du'as)")


if __name__ == "__main__":
    main()
