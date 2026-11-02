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

// The app ships its own files inside the native shell: no CDN, no remote fonts.
export default defineConfig({
  base: "./",
  plugins: [talkWorklet()],
  build: { outDir: "dist", target: "es2022", assetsInlineLimit: 0 },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
