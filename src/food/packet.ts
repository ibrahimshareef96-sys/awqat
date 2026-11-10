/**
 * Open Food Facts: what a packet holds per 100 g, by its barcode (free, no key, cross-origin allowed; the data is under
 * the Open Database License). Only the barcode leaves the phone. Every field read back is checked: a product with no
 * energy on record is "not known", never a guess.
 */
import { cleanShown } from "../talk/text.ts";
import { GRAMS_MAX, MEAL_NAME_MAX, type Per100 } from "./food.ts";

export interface Packet {
  code: string;
  name: string;
  per100: Per100;
  /** Grams in one serving, when the packet says; null otherwise. */
  serving: number | null;
}

/** What a lookup learned: the packet, that Open Food Facts does not know it (or its energy), or that asking failed. */
export type PacketLookup = { found: Packet } | { none: true } | { failed: true };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10000;
/** At most this much of an answer is read: one product's few fields are a few hundred bytes. */
const ANSWER_MAX = 200_000;
const KCAL_PER_100_MAX = 900;
const KJ_PER_KCAL = 4.184;
/** A serving past what the form takes as grams eaten is not offered as the amount to start from. */
const SERVING_MAX = GRAMS_MAX;

/** A retail barcode as scanned: EAN-8, UPC-A, EAN-13 or a 14-digit case code. Null for anything else. */
export function cleanBarcode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.trim();
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : null;
}

const amount = (n: unknown, max: number): number | null => {
  const v = typeof n === "string" && /^\d+(\.\d+)?$/.test(n) ? Number(n) : n;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 10) / 10 : null;
};

export function parsePacket(json: unknown, code: string): Packet | null {
  const root = json as { status?: unknown; product?: unknown } | null;
  if (!root || root.status !== 1 || typeof root.product !== "object" || root.product === null) return null;
  const p = root.product as Record<string, unknown>;
  const n = (typeof p.nutriments === "object" && p.nutriments !== null ? p.nutriments : {}) as Record<string, unknown>;
  const kj = amount(n["energy-kj_100g"], KCAL_PER_100_MAX * KJ_PER_KCAL);
  const kcal = amount(n["energy-kcal_100g"], KCAL_PER_100_MAX) ?? (kj === null ? null : Math.round((kj / KJ_PER_KCAL) * 10) / 10);
  if (kcal === null) return null;
  const brand = cleanShown(typeof p.brands === "string" ? p.brands.split(",")[0] : "", 30);
  const product = cleanShown(p.product_name, MEAL_NAME_MAX);
  const name = cleanShown(product && brand && !product.toLowerCase().includes(brand.toLowerCase()) ? `${product}, ${brand}` : product || brand,
    MEAL_NAME_MAX);
  if (name === "") return null;
  const serving = amount(p.serving_quantity, SERVING_MAX);
  return { code, name, per100: { kcal: Math.round(kcal), protein: amount(n.proteins_100g, GRAMS_MAX / 10),
    carbs: amount(n.carbohydrates_100g, GRAMS_MAX / 10), fat: amount(n.fat_100g, GRAMS_MAX / 10) },
    serving: serving !== null && serving > 0 ? serving : null };
}

/** Asks Open Food Facts for a barcode. Only the barcode leaves the phone. */
export async function findPacket(barcode: string, fetcher: Fetcher = fetch): Promise<PacketLookup> {
  const code = cleanBarcode(barcode);
  if (!code) return { none: true };
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}?fields=product_name,brands,nutriments,serving_quantity`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: "application/json" }, redirect: "error",
      credentials: "omit", referrerPolicy: "no-referrer" });
    // A barcode it has never seen is answered 404 by some of its servers and status 0 by others.
    if (response.status === 404) return { none: true };
    if (!response.ok) return { failed: true };
    // An answer that says it is too big is not read at all; one that does not say is measured once read.
    if (Number(response.headers.get("content-length") ?? 0) > ANSWER_MAX) return { failed: true };
    const text = await response.text();
    if (text.length > ANSWER_MAX) return { failed: true };
    const found = parsePacket(JSON.parse(text), code);
    return found ? { found } : { none: true };
  } catch {
    return { failed: true };
  } finally {
    clearTimeout(timer);
  }
}
