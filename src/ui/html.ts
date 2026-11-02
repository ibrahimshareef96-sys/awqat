/** Tiny helpers for building screens as HTML strings; every value that is not a fixed string goes through esc(). */
export function esc(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Stroke icons, drawn inline so they follow the text colour. */
const PATHS: Readonly<Record<string, string>> = {
  back: '<path d="M15 5l-7 7 7 7"></path>',
  check: '<path d="M5 12l5 5L19 7"></path>',
  gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path>',
  minus: '<path d="M5 12h14"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"></path>',
  sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
  note: '<path d="M5 4h10l4 4v12H5z"></path><path d="M9 12h6M9 16h4"></path>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"></path>',
};

export function icon(name: keyof typeof PATHS | string, size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
}

const ORB_DOTS = [
  [18, 5, 1.6], [27.2, 8.8, 1.4], [31, 18, 1.6], [27.2, 27.2, 1.4], [18, 31, 1.6], [8.8, 27.2, 1.4], [5, 18, 1.6],
  [8.8, 8.8, 1.4],
].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"></circle>`).join("") +
  [[18, 11], [25, 18], [18, 25], [11, 18]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" opacity="0.7"></circle>`)
    .join("") + '<circle cx="18" cy="18" r="1.8"></circle>';

export function orb(size = 40): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" aria-hidden="true"><g fill="currentColor">${ORB_DOTS}</g></svg>`;
}
