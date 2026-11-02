/**
 * The phone's location and notifications. Every call is guarded: a refusal or a missing plugin (a browser) leaves the
 * app working on its saved place and without reminders, never broken.
 */
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { roughPlace, type Place } from "./place.ts";
import { isReminderId, type AdhanSound, type Reminder } from "./reminders/plan.ts";

export const PRAYER_CHANNEL = "prayers";

/**
 * The adhan reminders' sounds. Android plays the whole recording through its own channel (a channel's sound can never
 * change once made, so each recording has one), from res/raw; iOS plays at most 30 seconds, so it gets a 29.5 s copy
 * (public/sounds, put into Library/Sounds by prayer/adhanSounds.ts, where the system looks first).
 *
 * No recording ships with the code: an adhan is a performance, and its licence has to allow redistribution. A build
 * that adds its own (docs/adhan.md) sets VITE_ADHAN=1; without it the Adhan switch is hidden and every reminder uses
 * the system's sound, since an Android channel pointed at a missing file would ring silently.
 */
export const ADHAN_BUNDLED = import.meta.env.VITE_ADHAN === "1";

export const ADHAN_CHANNELS: Readonly<Record<AdhanSound, { id: string; name: string; android: string; ios: string }>> = {
  "adhan": { id: "adhan", name: "Adhan", android: "adhan.mp3", ios: "adhan.caf" },
  "adhan-fajr": { id: "adhan_fajr", name: "Fajr adhan", android: "adhan_fajr.mp3", ios: "adhan_fajr.caf" },
};

export const isNative = (): boolean => Capacitor.isNativePlatform();
/** "android", "ios" or "web". */
export const platform = (): string => Capacitor.getPlatform();

export type LocateResult = { place: Place } | { refused: true } | { failed: true };

/** A rough position (coarse, about 1 km) with the phone's time zone, or why there is none. */
export async function locate(ask: boolean, timeZone: string): Promise<LocateResult> {
  try {
    let perm = await Geolocation.checkPermissions();
    if (perm.coarseLocation !== "granted" && perm.location !== "granted") {
      if (!ask) return { refused: true };
      perm = await Geolocation.requestPermissions({ permissions: ["coarseLocation"] });
      if (perm.coarseLocation !== "granted" && perm.location !== "granted") return { refused: true };
    }
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 });
    return { place: roughPlace(pos.coords.latitude, pos.coords.longitude, Date.now(), timeZone) };
  } catch {
    return { failed: true };
  }
}

export type NotifyState = "granted" | "denied" | "prompt" | "unavailable";

export async function notifyPermission(ask: boolean): Promise<NotifyState> {
  if (!isNative()) return "unavailable";
  try {
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted" && ask) perm = await LocalNotifications.requestPermissions();
    return perm.display === "granted" ? "granted" : perm.display === "denied" ? "denied" : "prompt";
  } catch {
    return "unavailable";
  }
}

export async function exactAlarms(): Promise<"granted" | "denied" | "unknown"> {
  if (Capacitor.getPlatform() !== "android") return "granted";
  try {
    const s = await LocalNotifications.checkExactNotificationSetting();
    return s.exact_alarm === "granted" ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

export async function openExactAlarmSettings(): Promise<void> {
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch {
    // Not on this device: nothing to open.
  }
}

/**
 * Makes the pending prayer reminders match the plan: schedules the plan first (an id already pending is replaced in
 * place), then cancels only the old ids the plan no longer has. A failed schedule leaves the old reminders standing.
 * Returns how many of the plan's reminders are pending, or null if scheduling failed.
 */
export async function scheduleReminders(plan: Reminder[]): Promise<number | null> {
  if (!isNative()) return null;
  try {
    // Channels are Android's; iOS has none and refuses the call.
    const ios = Capacitor.getPlatform() === "ios";
    if (Capacitor.getPlatform() === "android") {
      await LocalNotifications.createChannel({
        id: PRAYER_CHANNEL, name: "Prayer reminders", description: "A reminder at each prayer time",
        importance: 4, visibility: 1, vibration: true,
      });
      for (const channel of ADHAN_BUNDLED ? Object.values(ADHAN_CHANNELS) : []) {
        await LocalNotifications.createChannel({
          id: channel.id, name: channel.name, description: "The adhan at each prayer time", importance: 4,
          visibility: 1, vibration: true, sound: channel.android,
        });
      }
    }
    if (plan.length > 0) {
      // Without exact alarms, schedule() would open the system settings screen on every reschedule; ask for inexact
      // ones instead, and Settings offers the switch.
      const exact = (await exactAlarms()) === "granted";
      await LocalNotifications.schedule({
        notifications: plan.map((r) => ({
          id: r.id, title: r.title, body: r.body,
          channelId: r.sound ? ADHAN_CHANNELS[r.sound].id : PRAYER_CHANNEL,
          ...(ios && r.sound ? { sound: ADHAN_CHANNELS[r.sound].ios } : {}),
          schedule: { at: r.at, allowWhileIdle: true }, isExactNotification: exact,
        })),
      });
    }
    const keep = new Set(plan.map((r) => r.id));
    const pending = await LocalNotifications.getPending();
    const stale = pending.notifications.filter((n) => isReminderId(n.id) && !keep.has(n.id)).map((n) => ({ id: n.id }));
    if (stale.length > 0) await LocalNotifications.cancel({ notifications: stale });
    return plan.length;
  } catch {
    return null;
  }
}
