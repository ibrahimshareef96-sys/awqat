/** Decisions about cover files that need no phone to test: what the clean-up may delete, and which camera copies are ours. */
import { isPhotoName } from "./library.ts";

export interface CoverFile { name: string; type: string; mtime: unknown }

/**
 * Files in covers/ that can go: named like a cover, used by no book, and older than `minAgeMs`. A file with no
 * modified time counts as new, so it is kept.
 */
export function staleCovers(files: readonly CoverFile[], inUse: ReadonlySet<string>, now: number, minAgeMs: number): string[] {
  return files.flatMap((f) => {
    const name = `covers/${f.name}`;
    const mtime = typeof f.mtime === "number" && Number.isFinite(f.mtime) && f.mtime > 0 ? f.mtime : null;
    const old = mtime !== null && now - mtime > minAgeMs;
    return f.type === "file" && isPhotoName(name) && !inUse.has(name) && old ? [name] : [];
  });
}

const OWN_FOLDER = /^\/(data\/user\/\d+|data\/data|storage\/emulated\/\d+\/Android\/data)\/app\.awqat\/(cache|files)\//;
const UUID = "[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}";
/**
 * iOS: a photo directly in the app's own temporary folder (an app can reach no other app's), on a device or in the
 * simulator. Only a JPEG file there, never the folder or anything under it (deleting a folder removes all it holds).
 */
const OWN_TMP_IOS = new RegExp(`^(?:(?:/private)?/var/mobile|/Users/[^/]+/Library/Developer/CoreSimulator/Devices/` +
  `${UUID}/data)/Containers/Data/Application/${UUID}/tmp/[^/]+\\.jpe?g$`, "i");

/** Android: only a JPEG file, never a folder (deleting a folder removes all it holds). */
const JPEG_FILE = /\/[^/]+\.jpe?g$/i;

/**
 * The camera's working copy as a file:// address to delete, when it sits in this app's private cache or files folder
 * (Android) or its temporary folder (iOS): never the user's gallery, another app, or a saved cover. Null for anything else,
 * including paths with "..", ".", "%" or an empty part ("//"), which could slip past the covers folder's name.
 */
export function cameraTempUri(uri: string): string | null {
  const path = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  if (path.includes("%") || path.includes("//") || path.split("/").some((part) => part === ".." || part === ".")) return null;
  if (OWN_TMP_IOS.test(path)) return `file://${path}`;
  if (!OWN_FOLDER.test(path) || !JPEG_FILE.test(path) || path.includes("/files/covers/")) return null;
  return `file://${path}`;
}
