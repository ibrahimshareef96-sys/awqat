/**
 * The painted sky behind everything follows the prayer day. The next painting is decoded first, then two layers
 * cross-fade from wherever the fade has got to; with reduced motion the new sky simply replaces the old one.
 */
import type { SkyMoment } from "../prayer/window.ts";

let wanted: SkyMoment | null = null;
let shown: SkyMoment | null = null;
let front: HTMLElement | null = null;

async function decoded(src: string): Promise<void> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    // Show it anyway: a failed decode only means it may appear without the fade.
  }
}

export function setSky(moment: SkyMoment): void {
  if (moment === wanted) return;
  wanted = moment;
  const src = `sky/${moment}.jpg`;
  void decoded(src).then(() => {
    if (wanted !== moment || shown === moment) return;
    const a = document.getElementById("sky-a");
    const b = document.getElementById("sky-b");
    if (!a || !b) return;
    const next = front === a ? b : a;
    next.style.backgroundImage = `url("${src}")`;
    next.classList.add("on");
    front?.classList.remove("on");
    front = next;
    shown = moment;
    document.documentElement.dataset.sky = moment;
  });
}
