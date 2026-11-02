/**
 * The phone's health store, read only: Health Connect on Android, Apple Health on iPhone and iPad, through
 * @capgo/capacitor-health (MPL-2.0). Only weight, steps, sleep and workouts are asked for, and nothing is ever written
 * there. Each kind is read on its own, so one that is not allowed (or fails) never costs the others.
 */
import { Health, type HealthDataType } from "@capgo/capacitor-health";
import { shiftKey, startOfDay } from "../agenda/days.ts";
import type { RawHealth } from "./summary.ts";
import { TREND_DAYS, WEEK_DAYS, weekStart } from "./summary.ts";

export const READ_TYPES: readonly HealthDataType[] = ["weight", "steps", "sleep", "workouts"];

export type Availability = { available: true } | { available: false; reason: string };

export async function healthAvailable(): Promise<Availability> {
  try {
    const result = await Health.isAvailable();
    return result.available ? { available: true } : { available: false, reason: result.reason ?? "" };
  } catch {
    return { available: false, reason: "" };
  }
}

/** Asks for read access to the four kinds (the system's own sheet); the kinds it did not allow come back. */
export async function connectHealth(): Promise<{ denied: HealthDataType[] } | null> {
  try {
    const status = await Health.requestAuthorization({ read: [...READ_TYPES], write: [] });
    return { denied: READ_TYPES.filter((t) => status.readDenied.includes(t)) };
  } catch {
    return null;
  }
}

/** The kinds not allowed now (Android can say; Apple never tells an app what it may not read, so none there). */
export async function deniedTypes(): Promise<HealthDataType[]> {
  try {
    const status = await Health.checkAuthorization({ read: [...READ_TYPES], write: [] });
    return READ_TYPES.filter((t) => status.readDenied.includes(t));
  } catch {
    return [];
  }
}

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** The readings Body needs, from the start of the 30-day trend to now. */
export async function readHealth(now: number, today: string, tz: string): Promise<RawHealth> {
  const end = new Date(now).toISOString();
  const iso = (day: string, shiftMs = 0) => new Date(startOfDay(day, tz) + shiftMs).toISOString();
  // Newest first, so a limit ever reached drops the oldest readings, never last night's. Apple Health gives one sleep
  // sample per stage (a night with a watch is dozens), Health Connect one per night.
  const [weight, steps, sleep, workouts] = await Promise.all([
    attempt(async () => (await Health.readSamples({ dataType: "weight", startDate: iso(shiftKey(today, -(TREND_DAYS - 1))),
      endDate: end, limit: 500, ascending: false })).samples),
    attempt(async () => (await Health.queryAggregated({ dataType: "steps", startDate: iso(shiftKey(today, -(WEEK_DAYS - 1))),
      endDate: end, bucket: "day", aggregation: "sum" })).samples),
    // From the evening before the first of the seven nights.
    attempt(async () => (await Health.readSamples({ dataType: "sleep", startDate: iso(shiftKey(today, -WEEK_DAYS), 12 * 3600000),
      endDate: end, limit: 1000, ascending: false })).samples),
    attempt(async () => (await Health.queryWorkouts({ startDate: iso(weekStart(today)), endDate: end, limit: 50,
      ascending: true })).workouts),
  ]);
  return { weight, steps, sleep, workouts };
}

/** Health Connect's own settings (Android), where access is changed or Health Connect is installed. */
export async function openHealthSettings(): Promise<void> {
  try {
    await Health.openHealthConnectSettings();
  } catch {
    // Nothing more to offer: the notice on the screen says where to look.
  }
}
