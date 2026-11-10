/**
 * The phone side of Food: a meal's photo kept in the app's own folder (meals/), a packet's barcode read by the camera,
 * and the clean-up of photos no meal holds. Every call reports failure as a value, so a refused camera never breaks a
 * screen.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { dataFileSrc, keepPhoto } from "../books/media.ts";
import { isMealPhoto, staleMealPhotos } from "./food.ts";
import { cleanBarcode } from "./packet.ts";

const MEALS = "meals";
/** Files younger than this are left alone by the clean-up: a meal holding one may still be on the form. */
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

function newName(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${MEALS}/${id}.jpg`;
}

/** Takes or chooses a photo of a meal; its name ("meals/<id>.jpg") or null. */
export function mealPhoto(from: "camera" | "gallery"): Promise<string | null> {
  return keepPhoto(from, newName());
}

/** The address an <img> can load a meal's photo from (same origin), or null. */
export function mealPhotoSrc(name: string | null): string | null {
  return isMealPhoto(name) ? dataFileSrc(name) : null;
}

/** A kept photo's bytes in base64, for the user's own server to look at; null when it cannot be read. */
export async function mealPhotoBase64(name: string | null): Promise<string | null> {
  if (!isMealPhoto(name)) return null;
  try {
    const file = await Filesystem.readFile({ path: name, directory: Directory.Data });
    return typeof file.data === "string" ? file.data.replace(/\s+/g, "") : null;
  } catch {
    return null;
  }
}

export async function removeMealPhoto(name: string | null): Promise<void> {
  if (!isMealPhoto(name)) return;
  try {
    await Filesystem.deleteFile({ path: name, directory: Directory.Data });
  } catch {
    // Already gone: nothing to do.
  }
}

/** Deletes photos no meal holds any more (left by a closed app mid-entry); returns how many went. */
export async function removeUnusedMealPhotos(inUse: ReadonlySet<string>): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;
  try {
    const { files } = await Filesystem.readdir({ path: MEALS, directory: Directory.Data });
    const stale = staleMealPhotos(files, inUse, Date.now(), ORPHAN_AGE_MS);
    for (const name of stale) await removeMealPhoto(name);
    return stale.length;
  } catch {
    return 0;
  }
}

export type PacketScan = { code: string } | { notFood: true } | { cancelled: true } | { failed: true };

/** Reads a packet's barcode with the camera, on the phone. */
export async function scanPacket(): Promise<PacketScan> {
  try {
    // Loaded on first use: the plugin carries a large web scanner the phone never needs at start-up.
    const scanner = await import("@capacitor/barcode-scanner");
    const result = await scanner.CapacitorBarcodeScanner.scanBarcode({
      hint: scanner.CapacitorBarcodeScannerTypeHint.ALL,
      scanInstructions: "Point the camera at the barcode on the packet",
      scanButton: false,
      // ZXing reads the barcode on the phone with no Google service behind it; ML Kit would report usage to Google.
      android: { scanningLibrary: scanner.CapacitorBarcodeScannerAndroidScanningLibrary.ZXING },
    });
    const raw = (result?.ScanResult ?? "").trim();
    if (!raw) return { cancelled: true };
    const code = cleanBarcode(raw);
    return code ? { code } : { notFood: true };
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? "");
    return /cancel/i.test(message) ? { cancelled: true } : { failed: true };
  }
}
