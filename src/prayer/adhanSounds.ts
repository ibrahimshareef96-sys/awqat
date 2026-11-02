/**
 * iOS plays a notification's sound only from the app's Library/Sounds (or the bundle's top level, which a web build
 * cannot reach), so the two 29.5 s adhan copies shipped with the page (public/sounds) are written there, and again
 * whenever the copy there is not the same size (cut short, or an older recording). Each start reads the two bundled
 * files (about 350 KB each, from the app itself) to compare. Android plays its channels' sounds from res/raw.
 */
import { Directory, Filesystem } from "@capacitor/filesystem";
import { ADHAN_BUNDLED, ADHAN_CHANNELS, platform } from "../device.ts";

const FOLDER = "Sounds";

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < view.length; i += 32768) text += String.fromCharCode(...view.subarray(i, i + 32768));
  return btoa(text);
}

/** The size of the copy in Library/Sounds, or null when there is none. */
async function keptSize(path: string): Promise<number | null> {
  try {
    return (await Filesystem.stat({ path, directory: Directory.Library })).size;
  } catch {
    return null;
  }
}

/**
 * Puts each adhan copy in Library/Sounds unless the same-sized copy is there already, so one cut short (the app closed
 * mid-write) or an older recording under the same name is written again. True once both are in place. Never throws.
 */
export async function installAdhanSounds(): Promise<boolean> {
  if (platform() !== "ios" || !ADHAN_BUNDLED) return true;
  let ready = true;
  for (const { ios: name } of Object.values(ADHAN_CHANNELS)) {
    const path = `${FOLDER}/${name}`;
    const kept = await keptSize(path);
    try {
      const response = await fetch(`./sounds/${name}`);
      if (!response.ok) throw new Error(`sound ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (kept === bytes.byteLength) continue;
      await Filesystem.writeFile({ path, directory: Directory.Library, data: base64(bytes), recursive: true });
    } catch {
      // A copy already there still plays; only a missing one leaves the reminder with the system's sound.
      if (kept === null) ready = false;
    }
  }
  return ready;
}
