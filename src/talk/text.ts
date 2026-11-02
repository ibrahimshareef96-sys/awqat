/**
 * Words from outside the app (the Worker's refusals, what the agent says) made safe to show as text: control
 * characters and line or paragraph separators become one space, and the characters that change direction or hide
 * text (bidi overrides and isolates, zero-width space, word joiner and invisible operators, BOM, soft hyphen, the
 * invisible tag block, blank fillers) are dropped, so nothing can look like something it is not. The joiners and
 * marks real scripts and emoji need (ZWNJ, ZWJ, LRM, RLM, ALM) stay. Cuts are by whole characters. The patterns are
 * built from code points, as escapes typed into this file can turn into the very characters they name.
 */
const range = (from: number, to: number): string => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const one = (code: number): string => String.fromCodePoint(code);

/** C0 and C1 controls (line breaks among them) and the line and paragraph separators, shown as one space. */
const CONTROLS = new RegExp(`[${range(0x00, 0x1f)}${range(0x7f, 0x9f)}${range(0x2028, 0x2029)}]+`, "gu");
/** Characters that change direction or hide text, removed. */
const HIDDEN = new RegExp(`[${one(0xad)}${one(0x200b)}${range(0x202a, 0x202e)}${range(0x2060, 0x2064)}` +
  `${range(0x2066, 0x2069)}${one(0x2800)}${one(0x3164)}${one(0xfeff)}${range(0xe0000, 0xe007f)}` +
  `${range(0xe0100, 0xe01ef)}]`, "gu");

/** The text cleaned and cut to `max` characters; "" for anything that is not a string. */
export function cleanShown(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(HIDDEN, "").replace(CONTROLS, " ").trim();
  return Array.from(text).slice(0, max).join("").trim();
}
