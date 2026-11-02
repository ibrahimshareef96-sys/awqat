/**
 * The speech model's identity and files: shared by the downloader (assets.ts, which runs on the page) and the speech
 * worker (worker.ts), so it imports nothing that needs a page.
 */
export const MODEL_ID = "whisper-tiny-ar-quran";
export const MODEL_REPO = "Sharjeelbaig/whisper-tiny-ar-quran-onnx";
/** The commit the files below come from: Hugging Face serves a commit's files unchanged for good. */
export const MODEL_REVISION = "cd93bdec117adc2f84d6c4ab91c10164a2e9bee9";

export interface ModelFile { path: string; size: number; sha256: string }

/** Every file the speech model reads, with its size and SHA-256, checked after download and before first use. */
export const MODEL_FILES: readonly ModelFile[] = [
  { path: "config.json", size: 1219, sha256: "a5b9bb7f09b20952df138e436641f95e77a8c4363299ada8fc7693440ffc31e9" },
  { path: "generation_config.json", size: 3772, sha256: "f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1" },
  { path: "preprocessor_config.json", size: 356, sha256: "994838f1fa6462c8b9b3c90edada831f11f3dd8b4664634e18f4694d005c9dbf" },
  { path: "tokenizer.json", size: 3653235, sha256: "ff789e15fa4d77dc0664d18f28c4f7a1d65a56a7d31142ad48230279385c0112" },
  { path: "tokenizer_config.json", size: 20525, sha256: "b9e3f179dd00ee6ecf4637474fad1a9467b09feebe24d96c7473fddea2f65df3" },
  { path: "special_tokens_map.json", size: 2178, sha256: "d5edc7d0034441a45180aae8312fea315e467252aa08e302e8b6a4d9bc943360" },
  { path: "added_tokens.json", size: 2108, sha256: "5687ef031827f4c9fa3e7cbdd7fd915de0d6c7c6416463a28c63cbe1cf99a07a" },
  { path: "normalizer.json", size: 52666, sha256: "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd" },
  { path: "onnx/encoder_model_quantized.onnx", size: 10165184, sha256: "965e0ca31daf589ffb572e8b6deb1a4e65ad72221c1873c952331ff1c52f50c1" },
  { path: "onnx/decoder_model_merged_quantized.onnx", size: 30182187, sha256: "06a5c4409988b9ae7747bd55cf81e3851e3f2238536c86467963e0241464f652" },
];
