/**
 * What a dhikr shows under its Arabic: the three toggles above a list (Arabic, Sound, Meaning), how to say it and the
 * English, and their credits at the foot. A translation that arrives while the list is open goes in where its line
 * waits, and the screen is held so that what is under the finger stays where it is. Every fetched word goes through
 * esc(); none is ever read as HTML.
 */
import type { Meaning } from "../faith/meaning.ts";
import { fingerprint } from "../faith/meaningText.ts";
import type { AdhkarShow } from "../settings.ts";
import { esc } from "./html.ts";

export const SHOW_ALL: AdhkarShow = { arabic: true, sound: true, meaning: true };

const PARTS: readonly { part: keyof AdhkarShow; label: string; spoken: string }[] = [
  { part: "arabic", label: "Arabic", spoken: "" },
  // The spoken names start with the words on the buttons, so Voice Control's "tap Sound" finds them.
  { part: "sound", label: "Sound", spoken: "Sound: how to say it" },
  { part: "meaning", label: "Meaning", spoken: "Meaning: in English" },
];

/** Real buttons that say whether they are on; what each shows is kept in Settings. */
export function showToggles(show: AdhkarShow): string {
  const buttons = PARTS.map(({ part, label, spoken }) => `<button type="button" class="chip${show[part] ? " on" : ""}" ` +
    `data-action="adhkar-show" data-value="${part}" aria-pressed="${show[part]}"${spoken ? ` aria-label="${spoken}"` : ""}>` +
    `${label}</button>`).join("");
  return `<div class="chips start dhikr-show" role="group" aria-label="Show under each dhikr">${buttons}</div>`;
}

/** The block's own words: a line while it waits, or how to say it and the English, as far as each is turned on. */
function inner(m: Meaning | null | undefined, show: AdhkarShow): string {
  if (!m || (!show.sound && !show.meaning)) return "";
  if (m.kind === "pending") return `<span class="small dhikr-meaning-wait">Getting the translation</span>`;
  if (m.kind === "offline") return `<span class="small dhikr-meaning-wait">Translation unavailable offline</span>`;
  const say = show.sound && m.transliteration
    ? `<span class="dhikr-say" lang="ar-Latn" dir="ltr">${esc(m.transliteration)}</span>` : "";
  // At-Tawbah 129: the words said are its end, the English is of all of it.
  const note = m.wholeAyah ? `<span class="dhikr-en-note">The whole ayah: </span>` : "";
  const english = show.meaning && m.translation
    ? `<span class="dhikr-en" lang="en" dir="ltr">${note}${esc(m.translation)}</span>` : "";
  return say + english;
}

/** Whether a dhikr shows words of its own under the Arabic: how to say it or its meaning, as far as each is on. */
export function showsWords(m: Meaning | null | undefined, show: AdhkarShow): boolean {
  return m?.kind === "text" && ((show.sound && m.transliteration !== "") || (show.meaning && m.translation !== ""));
}

/**
 * Whether the Arabic shows: when it is turned on, and also when nothing else would (no translation for this dhikr,
 * or none yet), so a card never has no words to say. `fallback` marks the second case, which a translation arriving
 * later hides (paintMeanings).
 */
export function arabicShown(m: Meaning | null | undefined, show: AdhkarShow): { shown: boolean; fallback: boolean } {
  if (show.arabic) return { shown: true, fallback: false };
  const shown = !showsWords(m, show);
  return { shown, fallback: shown };
}

/** Under a dhikr's Arabic; nothing when it has no meaning, or both Sound and Meaning are off. */
export function meaningBlock(key: string, m: Meaning | null | undefined, show: AdhkarShow): string {
  if (!m || (!show.sound && !show.meaning)) return "";
  const html = inner(m, show);
  return `<span class="dhikr-meaning" data-meaning="${esc(key)}" data-shown="${fingerprint(html)}"${html ? "" : " hidden"}>` +
    `${html}</span>`;
}

/** Each source shown, once, saying only what of it shows (how to say it, the meaning, or both). */
function creditsOf(meanings: readonly (Meaning | null | undefined)[], show: AdhkarShow): string {
  const said = (m: Meaning | null | undefined): string[] => {
    if (m?.kind !== "text" || !showsWords(m, show)) return [];
    return [show.sound && show.meaning ? m.credit.both : show.sound ? m.credit.sound : m.credit.meaning];
  };
  return [...new Set(meanings.flatMap(said))].join(" · ");
}

/** Who each text shown on the list is from, at its foot; there, empty, until one arrives. */
export function creditsLine(meanings: readonly (Meaning | null | undefined)[], show: AdhkarShow): string {
  const credits = creditsOf(meanings, show);
  return `<p class="foot" data-meaning-credits${credits ? "" : " hidden"}>${esc(credits)}</p>`;
}

/** What arrived, put into each block in place: no card, button or ring is replaced, so a tap under way still lands. */
export function paintMeanings(root: ParentNode, lookup: (key: string) => Meaning | null, show: AdhkarShow): void {
  const shown: (Meaning | null)[] = [];
  root.querySelectorAll<HTMLElement>("[data-meaning]").forEach((block) => {
    const m = lookup(block.dataset.meaning ?? "");
    shown.push(m);
    const html = inner(m, show);
    const print = fingerprint(html);
    if (block.dataset.shown === print) return;
    // Fixed markup round words that went through esc() (inner above): never a fetched tag.
    block.innerHTML = html;
    block.dataset.shown = print;
    block.hidden = html === "";
    // Arabic shown only because there was nothing else to read goes once there is.
    block.closest("li")?.querySelector<HTMLElement>("[data-fallback]")?.toggleAttribute("hidden", showsWords(m, show));
  });
  const credits = root.querySelector<HTMLElement>("[data-meaning-credits]");
  if (!credits) return;
  const line = creditsOf(shown, show);
  credits.textContent = line;
  credits.hidden = line === "";
}

/**
 * What the screen is held by while text goes in: what was last pressed, if it is a control or a card in the app (a
 * block itself rather than the line inside it, which is replaced; the card round Arabic that may be hidden), else the
 * first card still in view. A press on the page between cards holds nothing, so it falls back too.
 */
export function anchorFor(doc: Document, press: { x: number; y: number } | null): HTMLElement | null {
  const app = doc.getElementById("app");
  const under = press && typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(press.x, press.y) : null;
  if (under instanceof HTMLElement && app?.contains(under)) {
    const block = under.closest<HTMLElement>("[data-meaning]");
    if (block) return block;
    if (under.closest("[data-fallback]")) return under.closest<HTMLElement>("li");
    if (under.closest("li, button")) return under;
  }
  return [...doc.querySelectorAll<HTMLElement>("li.dhikr")].find((card) => card.getBoundingClientRect().bottom > 0) ?? null;
}

const scrollNow = (dy: number): void => window.scrollBy({ top: dy, behavior: "instant" });

/** Runs `paint`, then scrolls by however far it moved the anchor, at once: on screen, the anchor never moves. */
export function keepInPlace(anchor: HTMLElement | null, paint: () => void, scroll: (dy: number) => void = scrollNow): void {
  const before = anchor?.getBoundingClientRect().top;
  paint();
  if (!anchor || before === undefined || !anchor.isConnected) return;
  const moved = anchor.getBoundingClientRect().top - before;
  if (Number.isFinite(moved) && Math.abs(moved) >= 0.5) scroll(moved);
}
