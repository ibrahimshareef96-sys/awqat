import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * ElevenLabs' audio worklet, shipped inside the app as talk-worklets/raw-audio-processor.js (talk/talk.ts WORKLETS):
 * without a path of its own the voice library loads it from a blob: URL, which the page's policy refuses.
 */
function talkWorklet(): Plugin {
  const source = fileURLToPath(new URL("node_modules/@elevenlabs/client/worklets/rawAudioProcessor.js", import.meta.url));
  return {
    name: "talk-worklet",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "talk-worklets/raw-audio-processor.js", source: readFileSync(source) });
    },
  };
}

/**
 * ONNX Runtime's WebAssembly build, which runs the recitation model (recite/worker.ts): shipped as recite-runtime/ so it
 * is never fetched from a CDN. The plain build (about 13 MB), not the WebGPU one: the model runs on the CPU, one thread.
 */
function reciteRuntime(): Plugin {
  const dist = (name: string): string =>
    fileURLToPath(new URL(`node_modules/onnxruntime-web/dist/${name}`, import.meta.url));
  return {
    name: "recite-runtime",
    generateBundle() {
      for (const name of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
        this.emitFile({ type: "asset", fileName: `recite-runtime/${name}`, source: readFileSync(dist(name)) });
      }
    },
  };
}

/**
 * ONNX Runtime names its other WebAssembly builds in its own code, so the bundler would ship them (23 MB and more). The
 * speech worker always points the runtime at recite-runtime/ (recite/worker.ts), so those copies are never loaded.
 */
function dropUnusedRuntimes(): Plugin {
  return {
    name: "drop-unused-runtimes",
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm-simd-threaded\.(asyncify|jsep|jspi)[^/]*\.wasm$/.test(name)) delete bundle[name];
      }
    },
  };
}

// The app ships its own files inside the native shell: no CDN, no remote fonts.
export default defineConfig({
  base: "./",
  plugins: [talkWorklet(), reciteRuntime(), dropUnusedRuntimes()],
  worker: { format: "es", plugins: () => [dropUnusedRuntimes()] },
  build: { outDir: "dist", target: "es2022", assetsInlineLimit: 0 },
  // The tests never see a Worker built in from someone's .env.local: they set one themselves where they need it.
  test: { include: ["test/**/*.test.ts"], environment: "node", env: { VITE_WORKER_URL: "" } },
});
