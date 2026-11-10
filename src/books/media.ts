/**
 * The phone side of books: scanning a barcode for its ISBN, and covers kept in the app's own data folder (the user's photos,
 * and Open Library covers downloaded once). Every call reports failure as a value, so a refused camera or a cancelled
 * scan never breaks a screen.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { cleanIsbn } from "./isbn.ts";
import { isPhotoName } from "./library.ts";
import { coverUrl } from "./openlibrary.ts";
import { cameraTempUri, staleCovers } from "./coverFiles.ts";

export type ScanResult = { isbn: string } | { notIsbn: string } | { cancelled: true } | { failed: true };

export async function scanIsbn(): Promise<ScanResult> {
  try {
    // Loaded on first use: the plugin carries a large web scanner the phone never needs at start-up.
    const scanner = await import("@capacitor/barcode-scanner");
    const result = await scanner.CapacitorBarcodeScanner.scanBarcode({
      hint: scanner.CapacitorBarcodeScannerTypeHint.EAN_13,
      scanInstructions: "Point the camera at the barcode on the back cover",
      scanButton: false,
      // ZXing reads the barcode on the phone with no Google service behind it; ML Kit would report usage to Google.
      android: { scanningLibrary: scanner.CapacitorBarcodeScannerAndroidScanningLibrary.ZXING },
    });
    const raw = (result?.ScanResult ?? "").trim();
    if (!raw) return { cancelled: true };
    const isbn = cleanIsbn(raw);
    return isbn ? { isbn } : { notIsbn: raw.slice(0, 40) };
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? "");
    return /cancel/i.test(message) ? { cancelled: true } : { failed: true };
  }
}

const COVERS = "covers";
const COVER_WIDTH = 900;
const COVER_HEIGHT = 1350;
const JPEG_PREFIX = "data:image/jpeg;base64,";
/** About 1.5 MB of image: a medium cover is a few tens of kilobytes. */
const DOWNLOAD_MAX_BASE64 = 2_000_000;
/** A JPEG's first bytes (FF D8 FF) in base64. */
const JPEG_BASE64_START = "/9j/";
/** Files younger than this are left alone by the clean-up, in case a book holding them is still being saved. */
const ORPHAN_AGE_MS = 10 * 60 * 1000;

function newName(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${COVERS}/${id}.jpg`;
}

/** Redraws a photo at cover size: what is kept is the picture only, without the camera's location and details. */
async function redrawAsCover(base64: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = `${JPEG_PREFIX}${base64}`;
    await img.decode();
    const scale = Math.min(1, COVER_WIDTH / img.naturalWidth, COVER_HEIGHT / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return url.startsWith(JPEG_PREFIX) ? url.slice(JPEG_PREFIX.length) : null;
  } catch {
    return null;
  }
}

/** Deletes the camera's own working copy (it may still carry the location); never a photo in the user's gallery. */
async function removeTempFile(uri: string): Promise<void> {
  const own = cameraTempUri(uri);
  if (!own) return;
  try {
    await Filesystem.deleteFile({ path: own });
  } catch {
    // The camera already cleared it.
  }
}

/** Takes or chooses a photo and keeps it in the app's data folder; returns its name ("covers/<id>.jpg") or null. */
export function coverPhoto(from: "camera" | "gallery"): Promise<string | null> {
  return keepPhoto(from, newName());
}

/**
 * Takes or chooses a photo, redraws it (so the camera's location and details are gone) and keeps it under `name` in
 * the app's data folder; returns the name, or null when there is no photo. Books' covers and Food's meals use it.
 */
export async function keepPhoto(from: "camera" | "gallery", name: string): Promise<string | null> {
  try {
    const options = { quality: 82, targetWidth: COVER_WIDTH, targetHeight: COVER_HEIGHT, correctOrientation: true };
    const media = from === "camera"
      ? await Camera.takePhoto(options)
      : (await Camera.chooseFromGallery({ ...options, limit: 1 })).results[0];
    if (!media?.uri) return null;
    const file = await Filesystem.readFile({ path: media.uri });
    await removeTempFile(media.uri);
    const original = typeof file.data === "string" ? file.data : await blobToBase64(file.data);
    const data = await redrawAsCover(original);
    if (!data) return null;
    await Filesystem.writeFile({ path: name, directory: Directory.Data, data, recursive: true });
    return name;
  } catch {
    return null;
  }
}

/** A cover download: saved, gone from Open Library for good, or failed this time. */
export type CoverDownload = { photo: string } | { missing: true } | { failed: true };

/** Saves an Open Library cover on the phone (covers/ol-<id>.jpg) so it shows offline and is fetched only once. */
export async function saveCover(coverId: number): Promise<CoverDownload> {
  const url = coverUrl(coverId);
  if (!url) return { missing: true };
  if (!Capacitor.isNativePlatform()) return { failed: true };
  try {
    const response = await CapacitorHttp.get({ url, responseType: "blob", connectTimeout: 10000, readTimeout: 15000 });
    // Only a 404 means "no cover"; anything odd (a page instead of an image, too big) is tried again another time.
    if (response.status === 404) return { missing: true };
    if (response.status !== 200 || typeof response.data !== "string") return { failed: true };
    const data = response.data.replace(/\s+/g, "");
    if (!data.startsWith(JPEG_BASE64_START) || data.length > DOWNLOAD_MAX_BASE64) return { failed: true };
    const photo = `${COVERS}/ol-${coverId}.jpg`;
    await Filesystem.writeFile({ path: photo, directory: Directory.Data, data, recursive: true });
    return { photo };
  } catch {
    return { failed: true };
  }
}

export async function downloadCover(coverId: number): Promise<string | null> {
  const result = await saveCover(coverId);
  return "photo" in result ? result.photo : null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function removeCoverPhoto(name: string | null): Promise<void> {
  if (!isPhotoName(name)) return;
  try {
    await Filesystem.deleteFile({ path: name, directory: Directory.Data });
  } catch {
    // Already gone: nothing to do.
  }
}

/** Deletes cover files no book uses any more (left by a crash or a closed app mid-save); returns how many went. */
export async function removeUnusedCovers(inUse: ReadonlySet<string>): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;
  try {
    const { files } = await Filesystem.readdir({ path: COVERS, directory: Directory.Data });
    const stale = staleCovers(files, inUse, Date.now(), ORPHAN_AGE_MS);
    for (const name of stale) await removeCoverPhoto(name);
    return stale.length;
  } catch {
    return 0;
  }
}

let dataBase: string | null = null;
let mushafBase: string | null = null;

/**
 * Where the mushaf's pages and fonts are kept. On iOS, out of the iCloud backup (they can be fetched again, and Apple
 * keeps backups for what only the user makes); on Android, the app's files folder, as before.
 */
export function mushafDirectory(): Directory {
  return Capacitor.getPlatform() === "ios" ? Directory.LibraryNoCloud : Directory.Data;
}

async function folderUri(directory: Directory): Promise<string | null> {
  try {
    return (await Filesystem.getUri({ path: "", directory })).uri.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Learns where the app's folders are, once, so covers and page fonts can be shown without a call per file. */
export async function prepareFolders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  [dataBase, mushafBase] = await Promise.all([folderUri(Directory.Data), folderUri(mushafDirectory())]);
}

/** The address an <img> can load a cover from (same origin), or null. */
export function photoSrc(name: string | null): string | null {
  return isPhotoName(name) ? dataFileSrc(name) : null;
}

/** The folder the mushaf's page fonts are kept in (the 1421 print's, quran/mushafFiles.ts). */
export const MUSHAF_FONTS_DIR = "mushaf-1421-fonts";

/** Only these files in the data folder are ever given an address: covers, meal photos and mushaf page fonts. */
const SERVED = new RegExp(`^((?:covers|meals)/[A-Za-z0-9-]{1,64}\\.jpg|${MUSHAF_FONTS_DIR}/p\\d{1,3}\\.woff2)$`);

/** The same-origin address of a kept file (a cover, or a page font), or null before its folder is known. */
export function dataFileSrc(path: string): string | null {
  if (!SERVED.test(path)) return null;
  const base = path.startsWith(`${MUSHAF_FONTS_DIR}/`) ? mushafBase : dataBase;
  return base ? Capacitor.convertFileSrc(`${base}/${path}`) : null;
}
