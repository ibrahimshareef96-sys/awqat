/** What the muraja'ah plan's taps and form do. Ticking a juz revised is the Quran screen's own action (quran-juz). */
import { lastRevised } from "../quran/log.ts";
import { juzPages, makePlan, todaysRevision, weakPages } from "../quran/murajaah.ts";
import { KEYS } from "../store.ts";
import { sheetError } from "./mushafActions.ts";
import { MESSAGES, announce, hooks, save, state, today } from "./state.ts";

/** Where "Revise Juz N" opens: the first juz left today (or the next, once today is done) at its weakest page. */
export function reviseTarget(): string {
  if (!state.murajaah) return "quran";
  const t = todaysRevision(state.murajaah, lastRevised(state.quran), today());
  const juz = t.todo[0] ?? t.next;
  if (juz === undefined || juz === null) return "quran";
  return `mushaf:${weakPages(state.mushaf, juz, 1)[0]?.page ?? juzPages(juz).first}`;
}

export function openSetup(): void {
  state.sheet = "murajaah";
  hooks.renderOverlay();
}

/** "All" and "None" above the juz in the plan sheet. */
export function chooseAll(on: boolean): void {
  document.querySelectorAll<HTMLInputElement>('#overlay input[name="juz"]').forEach((box) => { box.checked = on; });
}

/** Saves the plan first and only then shows it; a plan with no juz is not one, and the sheet says so. */
export async function savePlan(juz: readonly FormDataEntryValue[], perDay: FormDataEntryValue | null): Promise<void> {
  const plan = makePlan(juz.map(Number), Number(perDay));
  if (!plan) return sheetError("Choose at least one juz.");
  if (!(await save(KEYS.murajaah, plan))) return sheetError(state.notice || MESSAGES.unsaved);
  state.murajaah = plan;
  hooks.render();
  hooks.closeSheet(true);
  announce(`Plan saved: ${plan.perDay} juz a day from ${plan.juz.length} juz.`);
}
