/**
 * A page font is kept only if it is exactly the King Fahd Complex font for that page: its SHA-256 must match the list
 * built from the 604 fonts (scripts/make-font-hashes.py). A changed or damaged font is never used to draw the Quran.
 */
import { FONT_SHA256 } from "./fontHashes.ts";

async function sha256Base64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  digest.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

/** Whether a downloaded font (base64) is the one this page should have. */
export async function fontMatches(page: number, base64: string, hashes: readonly string[] = FONT_SHA256): Promise<boolean> {
  const expected = hashes[page - 1];
  if (!Number.isInteger(page) || !expected) return false;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return (await sha256Base64(bytes)) === expected;
  } catch {
    return false;
  }
}
