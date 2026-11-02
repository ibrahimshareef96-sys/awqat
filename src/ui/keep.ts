/**
 * A redraw replaces the screen's HTML. These keep what the hand was on: the control in focus (the same "+5", the same
 * juz), any text typed but not yet saved, with its caret, and which folded sections were open. Only on the same
 * screen: text typed for one book never lands in another's fields.
 */
const TEXT_INPUTS = new Set(["text", "number", "search", "email", "url", "tel"]);

type Editable = HTMLInputElement | HTMLTextAreaElement;

interface Typed { selector: string; value: string; was: string; start: number | null; end: number | null }

export interface Kept { screen: string; focus: string | null; typed: Typed[]; open: string[] }

export function isEditable(el: Element | null): el is Editable {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type));
}

/** Finds the same field after a redraw: by its id, or by its name inside its form. */
function fieldSelector(el: Editable): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const form = el.closest<HTMLElement>("form[data-form]")?.dataset.form;
  return form && el.name ? `form[data-form="${CSS.escape(form)}"] [name="${CSS.escape(el.name)}"]` : null;
}

/** Finds the same button after a redraw: by its id, or by every data attribute it carries. */
function controlSelector(el: HTMLElement): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attrs = Array.from(el.attributes)
    .filter((a) => a.name.startsWith("data-") && a.name !== "data-w" && a.name !== "data-h")
    .map((a) => `[${CSS.escape(a.name)}="${CSS.escape(a.value)}"]`).join("");
  return attrs ? `${el.tagName.toLowerCase()}${attrs}` : null;
}

/** What to put back after redrawing `root`. Fields of a form just sent are left out, so they come back empty. */
export function keep(root: HTMLElement, sentForm: string | null, screen: string): Kept {
  const active = document.activeElement;
  const focus = active instanceof HTMLElement && root.contains(active)
    ? (isEditable(active) ? fieldSelector(active) : controlSelector(active)) : null;
  const typed = Array.from(root.querySelectorAll("input, textarea")).flatMap((el): Typed[] => {
    if (!isEditable(el) || el.value === el.defaultValue) return [];
    if (sentForm && el.closest(`form[data-form="${CSS.escape(sentForm)}"]`)) return [];
    const selector = fieldSelector(el);
    return selector ? [{ selector, value: el.value, was: el.defaultValue, start: el.selectionStart, end: el.selectionEnd }] : [];
  });
  const open = Array.from(root.querySelectorAll<HTMLDetailsElement>("details[id][open]")).map((d) => d.id);
  return { screen, focus, typed, open };
}

/** Typed text goes back only where the saved value under it has not changed meanwhile. */
export function restore(root: HTMLElement, kept: Kept, screen: string): void {
  if (kept.screen !== screen) return;
  for (const id of kept.open) {
    const details = root.querySelector(`#${CSS.escape(id)}`);
    if (details instanceof HTMLDetailsElement) details.open = true;
  }
  for (const t of kept.typed) {
    const el = root.querySelector(t.selector);
    if (isEditable(el) && el.defaultValue === t.was) el.value = t.value;
  }
  if (!kept.focus) return;
  const el = root.querySelector<HTMLElement>(kept.focus);
  if (!el) return;
  el.focus({ preventScroll: true });
  const t = kept.typed.find((x) => x.selector === kept.focus);
  if (t && isEditable(el) && el.value === t.value && t.start !== null && t.end !== null) {
    try {
      el.setSelectionRange(t.start, t.end);
    } catch {
      // Number fields have no caret position to set.
    }
  }
}
