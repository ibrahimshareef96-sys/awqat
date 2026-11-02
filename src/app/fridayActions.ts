/** What the Friday card does: tick an item for the Friday open now, and keep its reminders in step. */
import { FRIDAY_ITEMS, FRIDAY_LABEL, fridayWindow, toggleFriday, type FridayItem } from "../faith/friday.ts";
import { KEYS } from "../store.ts";
import { announce, hooks, save, state } from "./state.ts";

const isItem = (value: string): value is FridayItem => (FRIDAY_ITEMS as readonly string[]).includes(value);

/**
 * Ticks or unticks an item, once it is saved: a tick that could not be saved is not shown (the notice says why), so
 * the screen and the reminders never count something the phone does not have. Al-Kahf changes what the reminders say,
 * so they are planned again.
 */
export async function toggleItem(value: string, now = new Date()): Promise<void> {
  const open = fridayWindow(state.days, now);
  if (!open || !isItem(value)) return;
  const before = state.friday;
  const next = toggleFriday(before, open.friday, value);
  const saved = await save(KEYS.friday, next);
  // Another tick landed meanwhile: this one goes on top of it.
  if (saved) state.friday = state.friday === before ? next : toggleFriday(state.friday, open.friday, value);
  if (saved && state.friday !== next) void save(KEYS.friday, state.friday);
  hooks.render();
  if (!saved) return;
  announce(`${FRIDAY_LABEL[value]}: ${state.friday.days[open.friday]?.[value] ? "done" : "not done"}.`);
  if (value === "kahf") await hooks.reschedule();
}
