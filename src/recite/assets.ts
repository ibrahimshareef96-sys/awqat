/**
 * What recitation needs on the phone, downloaded once when the user asks: the Quran speech model (Tarteel's Whisper
 * Tiny fine-tune, Apache-2.0, as converted to ONNX by Sharjeelbaig, pinned to one commit) and the Tanzil Project's
 * Uthmani text (CC BY 3.0, kept byte for byte with its copyright block). Neither is bundled in the app. They live where
 * the mushaf's files live (out of iCloud backup on iOS), and the page reads them by a same-origin path, so the page's
 * policy never has to let it reach another site.
 */
import { Capacitor, CapacitorHttp, type PluginListenerHandle } from "@capacitor/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { mushafDirectory } from "../books/media.ts";
import { MODEL_FILES, MODEL_ID, MODEL_REPO, MODEL_REVISION, type ModelFile } from "./model.ts";
import { parseTanzil, TANZIL_MAX } from "./tanzil.ts";

export const TANZIL_URL = "https://tanzil.net/pub/download/index.php?marks=true&sajdah=true&rub=false&tatweel=true" +
  "&quranType=uthmani&outType=txt-2&agree=true";
/** The Tanzil file is about 1.4 MB. */
const TANZIL_SIZE = 1_400_000;

/** Everything downloaded, in bytes, for the line that says how big it is. */
export const DOWNLOAD_BYTES = MODEL_FILES.reduce((n, f) => n + f.size, 0) + TANZIL_SIZE;

const DIR = "recite";
const MODEL_DIR = `${DIR}/${MODEL_ID}`;
const TANZIL_PATH = `${DIR}/tanzil-uthmani.txt`;
/** Written last, once every file is in place and its size checked: its absence means "not downloaded". */
const READY_PATH = `${DIR}/ready.json`;
/** In a browser (development only), the same files can be put in the built app's folder under this name. */
const WEB_DIR = "recite-dev";

export const modelFileUrl = (file: ModelFile): string =>
  `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file.path}`;

export type ReciteFiles =
  /** `base` is a same-origin path to the folder holding the model's folder; `tanzil` the text's same-origin path. */
  | { ready: true; base: string; tanzil: string; checked: boolean }
  | { ready: false };

/** A same-origin path for a file URL the web view serves (Capacitor's convertFileSrc), so it is never another site. */
function servedPath(uri: string): string {
  return new URL(Capacitor.convertFileSrc(uri)).pathname;
}

async function webFiles(): Promise<ReciteFiles> {
  try {
    const response = await fetch(`${WEB_DIR}/${MODEL_ID}/config.json`, { method: "HEAD" });
    if (!response.ok) return { ready: false };
    const base = new URL(`${WEB_DIR}/`, document.baseURI).pathname;
    return { ready: true, base, tanzil: `${base}tanzil-uthmani.txt`, checked: true };
  } catch {
    return { ready: false };
  }
}

/** Whether the files are on the phone, and where the page reads them. */
export async function reciteFiles(): Promise<ReciteFiles> {
  if (!Capacitor.isNativePlatform()) return webFiles();
  try {
    const ready = await Filesystem.readFile({ path: READY_PATH, directory: mushafDirectory(), encoding: Encoding.UTF8 });
    const kept = JSON.parse(String(ready.data)) as { revision?: unknown; checked?: unknown };
    if (kept.revision !== MODEL_REVISION) return { ready: false };
    const { uri } = await Filesystem.getUri({ path: DIR, directory: mushafDirectory() });
    const base = `${servedPath(uri).replace(/\/$/, "")}/`;
    return { ready: true, base, tanzil: `${base}tanzil-uthmani.txt`, checked: kept.checked === true };
  } catch {
    return { ready: false };
  }
}

export type DownloadResult = { ok: true } | { ok: false; why: "offline" | "failed" | "web" };

async function sizeOf(path: string): Promise<number> {
  try {
    return (await Filesystem.stat({ path, directory: mushafDirectory() })).size;
  } catch {
    return -1;
  }
}

async function getTanzil(): Promise<DownloadResult> {
  const response = await CapacitorHttp.get({ url: TANZIL_URL, responseType: "text", connectTimeout: 15000, readTimeout: 60000 });
  if (response.status !== 200 || typeof response.data !== "string" || response.data.length > TANZIL_MAX) {
    return { ok: false, why: "failed" };
  }
  if (!("verses" in parseTanzil(response.data))) return { ok: false, why: "failed" };
  // Kept exactly as Tanzil sent it, copyright block and all.
  await Filesystem.writeFile({ path: TANZIL_PATH, directory: mushafDirectory(), data: response.data, encoding: Encoding.UTF8,
    recursive: true });
  return { ok: true };
}

/** Downloads what is missing, reporting bytes done of the total; files already in place at their size are kept. */
export async function downloadReciteFiles(progress: (done: number, total: number) => void): Promise<DownloadResult> {
  if (!Capacitor.isNativePlatform()) return { ok: false, why: "web" };
  let done = 0;
  let listener: PluginListenerHandle | null = null;
  try {
    for (const file of MODEL_FILES) {
      const path = `${MODEL_DIR}/${file.path}`;
      if (await sizeOf(path) === file.size) { done += file.size; progress(done, DOWNLOAD_BYTES); continue; }
      const before = done;
      listener = await Filesystem.addListener("progress", (p) => {
        if (p.url === modelFileUrl(file)) progress(before + Math.min(file.size, p.bytes), DOWNLOAD_BYTES);
      });
      await Filesystem.downloadFile({ url: modelFileUrl(file), path, directory: mushafDirectory(), progress: true, recursive: true });
      await listener.remove();
      listener = null;
      if (await sizeOf(path) !== file.size) {
        await Filesystem.deleteFile({ path, directory: mushafDirectory() }).catch(() => undefined);
        return { ok: false, why: "failed" };
      }
      done += file.size;
      progress(done, DOWNLOAD_BYTES);
    }
    if (await sizeOf(TANZIL_PATH) <= 0) {
      const text = await getTanzil();
      if (!text.ok) return text;
    }
    progress(DOWNLOAD_BYTES, DOWNLOAD_BYTES);
    await markReady(false);
    return { ok: true };
  } catch {
    return { ok: false, why: "offline" };
  } finally {
    await listener?.remove();
  }
}

/** Notes that the files are all here; `checked` once the speech worker has matched every file's SHA-256. */
export async function markReady(checked: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await Filesystem.writeFile({ path: READY_PATH, directory: mushafDirectory(), encoding: Encoding.UTF8, recursive: true,
    data: JSON.stringify({ revision: MODEL_REVISION, checked }) });
}

/** Takes everything off the phone (a damaged download, or the user's choice in Settings). */
export async function removeReciteFiles(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Filesystem.rmdir({ path: DIR, directory: mushafDirectory(), recursive: true });
  } catch {
    // Already gone.
  }
}
