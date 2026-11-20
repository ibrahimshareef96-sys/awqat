/**
 * A section's heading on the sky, over its cards (app.css ".section-head"): its name large, one plain line under it
 * saying what the section is, a count beside the name when there is one to give, and "STEP 2 OF 4" over it where the
 * screen is a run of steps. A screen's parts are told apart by these, not by the small labels inside the cards.
 */
import { esc } from "./html.ts";

export interface SectionExtras { count?: string; step?: string }

export function sectionHead(title: string, about: string, extras: SectionExtras = {}): string {
  const { count = "", step = "" } = extras;
  return `<header class="section-head">${step ? `<p class="section-step">${esc(step)}</p>` : ""}` +
    `<h2 class="section-title">${esc(title)}${count ? ` <span class="section-count">${esc(count)}</span>` : ""}</h2>` +
    `${about ? `<p class="section-about">${esc(about)}</p>` : ""}</header>`;
}
