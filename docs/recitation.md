# Recitation: recite to find, and memorise

Two features, one engine, all on the phone.

- **Recite to find.** Tap the microphone in the mushaf's top bar, recite three or four words of any ayah, and its page
  opens with the ayah lit.
- **Memorise.** Tap Memorise under a page. Its words are hidden (each keeps its place, so the lines stand as printed),
  and they fill in as you recite. A word heard as another is drawn in rose, a skipped one is underlined in apricot, a
  peeked one in sand. At the end, the slips can be kept as revision mistakes on their words, so they show on the page
  and among the muraja'ah plan's weak pages.

Words are checked, not tajweed. The model can mishear on a phone microphone in a noisy room, so every slip can be
cleared with a tap ("It was right").

## How it works

```
microphone ── AudioWorklet (public/recite/pcm-capture.js)
          └─ recite/mic.ts: tenths of a second, resampled to 16 kHz
               └─ recite/audio.ts: cut at the reciter's pauses (pure)
                    └─ recite/engine.ts ── web worker (recite/worker.ts)
                         ├─ transformers.js + ONNX Runtime (WebAssembly, one thread): speech to Arabic
                         └─ recite/search.ts over the Tanzil text: which ayah (recite to find)
               recite/align.ts: the heard words laid on the page's words (memorise, pure)
```

- **The model**: Tarteel AI's Whisper Tiny fine-tune for Quran recitation (Apache-2.0), as an ONNX conversion pinned
  to one commit, about 40 MB quantised. The ten files and their SHA-256 are in `src/recite/model.ts`; the worker
  checks every one before first use and the app deletes a download that does not match.
- **The runtime**: ONNX Runtime Web's plain WebAssembly build (about 13 MB), copied into the app as `recite-runtime/`
  by `vite.config.ts`, never fetched from a CDN. The WebGPU builds are left out.
- **The text**: the Tanzil Project's Uthmani text (CC BY 3.0), downloaded once and kept byte for byte. It is folded
  (no vowel marks, one alef, and so on) only in memory, while matching.
- **Search**: three-letter pieces of the folded text pick the likely ayahs; an edit distance that lets the recitation
  sit anywhere inside an ayah, or run over up to two ayahs either side, scores them. An ayah the Quran says more than
  once is reported with every place it stands.
- **Memorise**: each stretch of recitation is aligned to the page from where the reciter has got to (a word-level edit
  distance with word similarity at least 0.7). A stretch that fits nowhere (talk, noise) is let go; one that fits
  further on picks up there, without calling the words before skipped.

Measured on a laptop (Chrome, WebAssembly, one thread): the model loads in under a second; 23 seconds of recitation is
heard in about 2 seconds; a search over all 6,236 ayahs takes under 10 ms. Expect a phone to be two to four times
slower.

## Rules this keeps

- Nothing of the Quran is bundled: the text and the model are downloaded on the user's word, after a sheet that says
  how big they are.
- Nothing the model writes is shown. A slip is pointed at on the page, where the right word is drawn in the mushaf's
  own script.
- No audio leaves the phone. The page's security policy lets it reach no new site: the files are read by a
  same-origin path (Capacitor's file server), and `'wasm-unsafe-eval'` is the only change to the policy.
- The microphone is open only while the sheet says "Listening" or the memorise bar shows the listening button; turning
  the page away, closing the sheet, leaving the reader or sending the app to the background stops it. A download or a
  model load that finishes while the app is in the background never opens it: the sheet says listening stopped, and
  the reciter taps Recite again. (Android's own microphone prompt pauses the app too; that one is left to finish.)
- A model that fails on what it was given is let go and named as the problem, never taken for "a few more words".

## Files

| Path | What |
|---|---|
| `src/recite/fold.ts` | Arabic folded for matching, edit distance, word similarity |
| `src/recite/tanzil.ts` | Reads and checks the Tanzil file (every ayah, in order) |
| `src/recite/search.ts` | Recite to find |
| `src/recite/align.ts` | Memorise |
| `src/recite/audio.ts` | Resampling and cutting at pauses |
| `src/recite/model.ts`, `assets.ts` | What is downloaded, from where, checked how |
| `src/recite/engine.ts`, `worker.ts`, `messages.ts` | The speech worker and its messages |
| `src/recite/mic.ts`, `public/recite/pcm-capture.js` | The microphone |
| `src/app/reciteActions.ts`, `src/ui/reciteView.ts` | The sheet, the memorise bar and its summary |

## Trying it in a browser

The web build cannot download the files (the phone does that natively). For development, build the app and put the
model folder and the Tanzil file in the built app's folder:

```bash
npm run build
mkdir -p dist/recite-dev
# dist/recite-dev/whisper-tiny-ar-quran/ : the ten files in src/recite/model.ts, from the pinned commit
# dist/recite-dev/tanzil-uthmani.txt     : the Tanzil Uthmani text, "sura|aya|text" format
npx vite preview
```

`dist/` is never committed or shipped with these files: `npx cap sync` copies `dist/`, so delete `dist/recite-dev`
before building for a phone.
