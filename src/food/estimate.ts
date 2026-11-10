/**
 * An estimate of a meal from its photo, asked of the user's own server (docs/backend.md, POST /app/food/estimate) and
 * only when they tap for it: without a server this is never called and no photo leaves the phone. Native HTTP, the
 * session as a bearer token, never a redirect. The answer is a guess by a model: every field is checked, and the app
 * shows it for the user to correct before anything is saved.
 */
import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import { cleanShown } from "../talk/text.ts";
import { GRAMS_MAX, KCAL_MAX, MEAL_NAME_MAX, type Meal } from "./food.ts";

export type Estimate = Pick<Meal, "name" | "kcal" | "protein" | "carbs" | "fat">;
export type EstimateAnswer = { estimate: Estimate } | { unsure: true } | { failed: true; signedOut: boolean };
export type Post = (options: HttpOptions) => Promise<HttpResponse>;

/** A photo as sent: at most about 1.5 MB of JPEG in base64. */
export const PHOTO_BASE64_MAX = 2_000_000;
const DEADLINE_MS = 45000;
const JPEG_BASE64 = /^\/9j\/[A-Za-z0-9+/]+={0,2}$/;

const grams = (n: unknown): number | null | undefined =>
  n === null || n === undefined ? null : typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= GRAMS_MAX ? Math.round(n * 10) / 10 : undefined;

/** The server's answer as an estimate, or null when any part of it is not what an estimate holds. */
export function parseEstimate(body: unknown): Estimate | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const name = cleanShown(b.name, MEAL_NAME_MAX);
  const kcal = typeof b.kcal === "number" && Number.isFinite(b.kcal) ? Math.round(b.kcal) : NaN;
  const [protein, carbs, fat] = [grams(b.protein), grams(b.carbs), grams(b.fat)];
  if (name === "" || !(kcal >= 0 && kcal <= KCAL_MAX) || protein === undefined || carbs === undefined || fat === undefined) return null;
  return { name, kcal, protein, carbs, fat };
}

const nativePost: Post = (options) => CapacitorHttp.post(options);

/** Sends one photo to the user's server and reads back its estimate. `unsure` is the server saying it sees no meal. */
export async function estimateMeal(worker: string, session: string, photoBase64: string, send: Post = nativePost,
  deadline = DEADLINE_MS): Promise<EstimateAnswer> {
  if (!worker.startsWith("https://") || photoBase64.length > PHOTO_BASE64_MAX || !JPEG_BASE64.test(photoBase64)) {
    return { failed: true, signedOut: false };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deadline); });
  try {
    const response = await Promise.race([send({ url: `${worker}/app/food/estimate`, data: { image: photoBase64 },
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${session}` },
      responseType: "json", connectTimeout: 10000, readTimeout: 40000, disableRedirects: true }), late]);
    if (response === null) return { failed: true, signedOut: false };
    if (response.status === 401) return { failed: true, signedOut: true };
    const body = response.data as Record<string, unknown> | null;
    if (response.status !== 200 || body === null || typeof body !== "object") return { failed: true, signedOut: false };
    if (body.ok === true && body.unsure === true) return { unsure: true };
    const estimate = body.ok === true ? parseEstimate(body) : null;
    return estimate ? { estimate } : { failed: true, signedOut: false };
  } catch {
    return { failed: true, signedOut: false };
  } finally {
    clearTimeout(timer);
  }
}
