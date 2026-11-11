# Third-party notices

Awqat's own code, the sky paintings in `public/sky` and the brand in `brand/` are MIT licensed (LICENSE). These parts
belong to others and keep their own terms.

## Data bundled in the app

### Morning and evening adhkar: Seen Arabic, MIT

`src/faith/adhkarData.ts` is built by `scripts/make-adhkar-data.py` from Seen Arabic's
[Morning-And-Evening-Adhkar-DB](https://github.com/Seen-Arabic/Morning-And-Evening-Adhkar-DB), `ar.json` at commit
`dbe92e887ee18a67df7c32b9a44e091b1dfa0cbd`. Only the Arabic words, the counts and the source lines are kept; the
dataset's English, which copies published translations, is left out, and the short English names are Awqat's own.
The adhkar are from Hisn al-Muslim.

```
MIT License

Copyright (c) 2024 Seen Arabic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### The du'a after the salam and the Istikhara: Hisn al-Muslim, via hisnmuslim.com

`src/faith/duaData.ts` is built by `scripts/make-dua-data.py` from the Arabic of two chapters of Hisn al-Muslim by
Sa'id ibn Ali ibn Wahf al-Qahtani, as published at [hisnmuslim.com](https://www.hisnmuslim.com) (chapters 25 and 26).
The words are hadith du'a; the Istikhara was checked against Sahih al-Bukhari 1166. hisnmuslim.com states no licence
for this text. If you are its publisher and want it credited differently or removed, open an issue.

### Quran metadata: Tanzil Project

`src/quran/data.ts` is built by `scripts/make-quran-data.py` from the [Tanzil Project](https://tanzil.net)'s Quran
metadata (`quran-data.xml`): the surah names, their ayah counts and where each juz starts. It holds no Quran text.

### The 1421 print's page map: Quran.com

`scripts/page-starts-1421.json`, and the page map in `src/quran/data.ts`, list the verse key each of the 604 pages of
the King Fahd Complex 1421 print starts with, read from Quran.com's public API by `scripts/fetch-page-starts-1421.py`.
Verse keys only, never the Quran's words.

## Fetched at run time, never bundled

- **Quran fonts provided by Quran Foundation**: the King Fahd Complex's QPC V2 page fonts, downloaded on the phone,
  checked against `src/quran/fontHashes.ts`, and kept for use inside the app only. A page's words come from
  Quran Foundation's API and are kept on the phone for at most seven days. Quran Foundation's
  [developer terms](https://api-docs.quran.foundation/legal/developer-terms/) apply to anyone distributing a build:
  they ask for an active Developer Console account and this credit, and do not allow the fonts to be offered apart
  from the app.
- **The Quran speech model** (recite to find, memorise): Tarteel AI's
  [whisper-tiny-ar-quran](https://huggingface.co/tarteel-ai/whisper-tiny-ar-quran), a fine-tune of OpenAI's Whisper
  Tiny (MIT), released by Tarteel under the Apache License 2.0, as converted to ONNX by
  [Sharjeelbaig/whisper-tiny-ar-quran-onnx](https://huggingface.co/Sharjeelbaig/whisper-tiny-ar-quran-onnx) (Apache
  License 2.0), commit `cd93bdec117adc2f84d6c4ab91c10164a2e9bee9`. Downloaded on the phone only when the user asks,
  every file checked against its SHA-256 in `src/recite/model.ts`, and run on the phone. Not bundled, not modified.
- **The Quran text for recite to find**: the [Tanzil Project](https://tanzil.net)'s Uthmani text, version 1.1,
  Copyright (C) 2007-2026 Tanzil Project, [Creative Commons Attribution 3.0](https://tanzil.net/docs/text_license).
  Downloaded on the phone only when the user asks and kept there byte for byte, copyright block included; it is
  matched against in memory and never changed. Tanzil's terms allow its use in any application that names the Tanzil
  Project and links to tanzil.net, as the app's Settings and this file do.
- **The adhkar's English and transliteration: Hisn al-Muslim, via hisnmuslim.com.** The adhkar lists and the du'a
  after the salam show each dhikr's translation and transliteration from hisnmuslim.com's developer API
  (`https://www.hisnmuslim.com/api/en/27.json` and `25.json`), fetched on the phone while Sound or Meaning is on, kept
  there, asked for again at most once a week, and credited "Translation and transliteration: Hisn al-Muslim,
  hisnmuslim.com" where they are shown. hisnmuslim.com states no terms for this text, so none of it is in this
  repository: `src/faith/meaningIds.ts`, built by `scripts/make-meaning-ids.py`, holds only which of their item numbers
  goes with which dhikr. If you are its publisher and want it credited differently or not used, open an issue.
- **The Quran items' English and transliteration: Quran.com.** For Ayat al-Kursi, the end of Al-Baqarah, the last
  three surahs and At-Tawbah 129, the words' transliteration and the Saheeh International translation (resource 20)
  come from Quran.com's API on the phone, the same API the mushaf uses, under Quran Foundation's developer terms above:
  kept for at most seven days, credited "Saheeh International" and "Quran.com" where shown, never bundled.
- **Weather**: [Open-Meteo](https://open-meteo.com), CC BY 4.0, used only in a voice talk.
- **Packet nutrition**: [Open Food Facts](https://world.openfoodfacts.org), whose database is under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/), looked up by barcode when the user scans a
  packet. One product's name and what 100 g holds are read on the phone and kept only in the meals the user logs;
  nothing of the database is in this repository.
- **Book data and covers**: [Open Library](https://openlibrary.org), looked up when you scan or search for a book.
  Covers are saved on the phone and never committed to this repository.

## Fonts

- **Instrument Serif**, SIL Open Font License 1.1. The licence is in `public/fonts/OFL-InstrumentSerif.txt`, with
  the copy the iOS widgets use.
- **Geist** and **Geist Mono** (Copyright 2024 The Geist Project Authors) and **Readex Pro** (Copyright 2018 The
  Readex Pro Project Authors, with Reserved Font Name "RevReading Lexend"), SIL Open Font License 1.1. The licences
  are in `brand/fonts/OFL-Geist.txt` and `brand/fonts/OFL-ReadexPro.txt`. They are used only by `scripts/brand.py`,
  which writes their letters as outlines into the brand pictures; the font files are not shipped in the app.

## Libraries

Installed from npm; each package ships its own licence text in `node_modules`.

| Library | Licence |
|---|---|
| Capacitor and its plugins (`@capacitor/*`) | MIT |
| adhan-js (`adhan`), Copyright (c) 2016 Batoul Apps | MIT |
| ical.js | MPL-2.0 |
| Capgo Capacitor Health (`@capgo/capacitor-health`) | MPL-2.0 |
| ElevenLabs client (`@elevenlabs/client`), including the audio worklet copied into the build by `vite.config.ts` | MIT |
| LiveKit client (`livekit-client`), brought in by the ElevenLabs client | Apache-2.0 |
| transformers.js (`@huggingface/transformers`), which runs the speech model | Apache-2.0 |
| ONNX Runtime Web (`onnxruntime-web`), whose WebAssembly build is copied into the app as `recite-runtime/` by `vite.config.ts` | MIT |
| `@huggingface/jinja`, `@huggingface/tokenizers`, brought in by transformers.js | MIT / Apache-2.0 |
| Vite, Vitest, TypeScript, happy-dom (development only) | MIT / Apache-2.0 |

`onnxruntime-node` and `sharp`, which transformers.js names for Node only, are replaced by the empty stand-ins in
`stubs/` (package.json `overrides`), so their native binaries are never installed.

The MPL-2.0 libraries are used unmodified; their source is available from npm and their own repositories.

## Images

The six sky paintings in `public/sky` were made for this app by its author with Higgsfield AI, whose terms leave the
outputs with their maker. They are released under this repository's MIT licence. The app icons, splash screens and
everything in `brand/` are drawn by `scripts/brand.py` and the icon scripts.
