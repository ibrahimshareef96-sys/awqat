/**
 * Files that hold secrets (the Talk session, the calendars' private addresses) live where the system never backs up:
 * Library/NoCloud on iOS, the app's own data on Android (excluded from backup and device transfer by
 * res/xml/data_extraction_rules.xml).
 *
 * On iOS the Filesystem plugin marks Library/NoCloud "never back up" on each call, and that quietly fails while the
 * folder does not exist yet. The first write creates it, so right after a write one more call marks it, before any
 * backup can run.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

export const secretsDirectory = (): Directory =>
  (Capacitor.getPlatform() === "ios" ? Directory.LibraryNoCloud : Directory.Data);

/** One more call on the folder just written, so iOS marks it now. The file is kept either way. */
export async function markNoBackup(path: string): Promise<void> {
  try {
    await Filesystem.stat({ path, directory: secretsDirectory() });
  } catch {
    // The next call on the folder marks it.
  }
}
