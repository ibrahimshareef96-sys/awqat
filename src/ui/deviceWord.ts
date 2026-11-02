/** What the app calls the device it runs on, in its own words: "iPad" on an iPad, "phone" everywhere else (foldables too). */
import { Capacitor } from "@capacitor/core";

export type DeviceWord = "iPad" | "phone";

/** An iPad's web view reports itself as a Mac (desktop-class browsing); a Mac has no touch screen, an iPad does. */
export function deviceWordFor(platform: string, userAgent: string, touchPoints: number): DeviceWord {
  if (platform !== "ios") return "phone";
  return /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1) ? "iPad" : "phone";
}

/** An iPhone or iPad: where steps differ by system (Safari and Files instead of Chrome and Downloads). */
export const onIos = (): boolean => Capacitor.getPlatform() === "ios";

let known: DeviceWord | null = null;

export function deviceWord(): DeviceWord {
  if (known) return known;
  const nav = globalThis.navigator;
  known = deviceWordFor(Capacitor.getPlatform(), nav?.userAgent ?? "", nav?.maxTouchPoints ?? 0);
  return known;
}
