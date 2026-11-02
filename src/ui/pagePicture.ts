/**
 * A page of the mushaf drawn to a canvas, exactly where the browser laid it out, for the leaf to carry while it turns. It
 * draws the words the page already has, in the page's own font and at the positions read from the page itself, so what
 * turns is what was on screen. Nothing of the Quran is typed or made up here. Nothing is laid out again either: it only reads.
 */

/** How a page is drawn at this moment: when any of this differs, its picture is out of date. */
export function pictureKey(page: HTMLElement, scale: number): string {
  const lines = page.querySelector<HTMLElement>(".page-lines");
  const zoom = lines ? getComputedStyle(lines).transform : "";
  // A word lit while it is held shows in the picture, so one drawn then is out of date once it is let go.
  const lit = page.querySelector(".w.held") ? "|lit" : "";
  return `${page.clientWidth}x${page.clientHeight}@${scale}|${getComputedStyle(page).getPropertyValue("--page-ground")}|${zoom}${lit}`;
}

interface Pen {
  ctx: CanvasRenderingContext2D;
  /** The page's top-left corner on screen. */
  left: number;
  top: number;
  scale: number;
}

const leafText = (el: Element): Text | null => {
  for (const node of Array.from(el.childNodes)) if (node.nodeType === 3 && (node.textContent ?? "").trim()) return node as Text;
  return null;
};

const ascents = new Map<string, number>();

/**
 * A font's ascent as the browser itself sets it, in px, read from a mark on its baseline. A canvas's own figure is rounded
 * differently, which would shift every word a little as the leaf takes over from the page.
 */
function ascentOf(doc: Document, font: string, size: number): number {
  const key = `${size}px ${font}`;
  const known = ascents.get(key);
  if (known !== undefined) return known;
  const probe = doc.createElement("div");
  Object.assign(probe.style, { position: "fixed", left: "-9999px", top: "0", visibility: "hidden", fontFamily: font, fontSize: `${size}px`, whiteSpace: "nowrap" });
  const word = probe.appendChild(doc.createTextNode("م"));
  const mark = probe.appendChild(doc.createElement("span"));
  Object.assign(mark.style, { display: "inline-block", width: "0", height: "0" });
  doc.body.append(probe);
  const range = doc.createRange();
  range.selectNodeContents(word);
  const ascent = mark.getBoundingClientRect().bottom - range.getBoundingClientRect().top;
  probe.remove();
  ascents.set(key, ascent);
  return ascent;
}

/** One run of text at the place the browser put it. `size` is its font size before any zoom; `zoom` is what the page is drawn at. */
function drawRun(pen: Pen, text: Text, font: string, size: number, zoom: number, color: string, direction: CanvasDirection): void {
  const range = text.ownerDocument.createRange();
  range.selectNodeContents(text);
  const box = range.getBoundingClientRect();
  if (box.width === 0) return;
  const { ctx, left, top, scale } = pen;
  const ascent = ascentOf(text.ownerDocument, font, size);
  ctx.font = `${size}px ${font}`;
  ctx.direction = direction;
  ctx.fillStyle = color;
  const rtl = direction === "rtl";
  ctx.textAlign = rtl ? "right" : "left";
  // The box is the font's ascent and descent, so the baseline is the ascent down from its top, whatever the line height.
  // The browser sets both on whole pixels of the screen, and so does this, or the words shift a little as the leaf takes over.
  const baseline = Math.round(scale * (box.top - top)) + Math.round(scale * zoom * ascent);
  ctx.setTransform(scale * zoom, 0, 0, scale * zoom, scale * ((rtl ? box.right : box.left) - left), baseline);
  ctx.fillText(text.data, 0, 0);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

/** A frame's two rules, as mushaf.css draws them: its border, and its outline a little outside. */
function drawFrame(pen: Pen, el: HTMLElement, zoom: number): void {
  const { ctx, left, top } = pen;
  const style = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  ctx.strokeStyle = style.borderTopColor;
  ctx.lineWidth = zoom;
  const x = box.left - left;
  const y = box.top - top;
  const corner = (parseFloat(style.borderTopLeftRadius) || 0) * zoom;
  ctx.beginPath();
  ctx.roundRect(x + zoom / 2, y + zoom / 2, box.width - zoom, box.height - zoom, Math.max(0, corner - zoom / 2));
  const out = ((parseFloat(style.outlineOffset) || 0) + 0.5) * zoom;
  // An outline follows its border's corners, set out by how far it stands off.
  ctx.roundRect(x - out, y - out, box.width + 2 * out, box.height + 2 * out, corner + out);
  ctx.stroke();
}

/** A word's mark: a mistake's tint and underline, or a note's underline. */
function drawMark(pen: Pen, word: HTMLElement, zoom: number): void {
  const { ctx, left, top } = pen;
  const style = getComputedStyle(word);
  const box = word.getBoundingClientRect();
  const x = box.left - left;
  const y = box.top - top;
  ctx.fillStyle = style.backgroundColor;
  ctx.fillRect(x, y, box.width, box.height);
  const line = /rgba?\([^)]*\)/.exec(style.boxShadow)?.[0];
  if (!line) return;
  const thick = (word.classList.contains("miss") ? 2 : 1) * zoom;
  ctx.fillStyle = line;
  ctx.fillRect(x, y + box.height - thick, box.width, thick);
}

/** How much the lines are drawn smaller than they were laid out, while the bars are up. */
function zoomOf(lines: HTMLElement): number {
  const width = lines.offsetWidth;
  return width > 0 ? lines.getBoundingClientRect().width / width : 1;
}

function drawLines(pen: Pen, lines: HTMLElement, wordFont: string, ink: string): void {
  const zoom = zoomOf(lines);
  const style = getComputedStyle(lines);
  const size = parseFloat(style.fontSize);
  const frames = lines.querySelectorAll<HTMLElement>(".surah-frame");
  if (lines.classList.contains("opening")) drawFrame(pen, lines, zoom);
  frames.forEach((frame) => drawFrame(pen, frame, zoom));
  lines.querySelectorAll<HTMLElement>(".surah-ar").forEach((name) => {
    const text = leafText(name);
    const own = getComputedStyle(name);
    if (text) drawRun(pen, text, own.fontFamily, parseFloat(own.fontSize), zoom, own.color, "rtl");
  });
  lines.querySelectorAll<HTMLElement>(".line.bism").forEach((line) => {
    const text = leafText(line);
    const own = getComputedStyle(line);
    if (text) drawRun(pen, text, own.fontFamily, size, zoom, ink, "rtl");
  });
  lines.querySelectorAll<HTMLElement>(".w").forEach((word) => {
    if (word.classList.contains("miss") || word.classList.contains("noted")) drawMark(pen, word, zoom);
    const text = leafText(word);
    if (text) drawRun(pen, text, wordFont, size, zoom, ink, "rtl");
  });
}

/** Draws a page. Null if a canvas cannot be had. */
export function drawPagePicture(page: HTMLElement, scale: number): HTMLCanvasElement | null {
  const box = page.getBoundingClientRect();
  const canvas = page.ownerDocument.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  // Kept in plain memory: handing it to the graphics chip is then a copy, not a slow read back.
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) return null;
  const style = getComputedStyle(page);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = style.getPropertyValue("--page-ground").trim() || style.backgroundColor;
  ctx.fillRect(0, 0, box.width, box.height);
  ctx.textBaseline = "alphabetic";
  const pen: Pen = { ctx, left: box.left, top: box.top, scale };
  if (page.classList.contains("spread-start")) {
    ctx.fillStyle = style.getPropertyValue("--page-hair").trim();
    ctx.fillRect(0, 0, 1, box.height);
  }
  const lines = page.querySelector<HTMLElement>(".page-lines");
  if (lines) {
    const own = getComputedStyle(lines);
    drawLines(pen, lines, own.fontFamily, own.color);
  }
  const number = page.querySelector<HTMLElement>(".page-no");
  const numberText = number && leafText(number);
  if (number && numberText) {
    const own = getComputedStyle(number);
    drawRun(pen, numberText, own.fontFamily, parseFloat(own.fontSize), 1, own.color, "rtl");
  }
  const waiting = page.querySelector<HTMLElement>('.page-wait[aria-busy="true"]');
  const waitingText = waiting && leafText(waiting);
  if (waiting && waitingText) {
    const own = getComputedStyle(waiting);
    drawRun(pen, waitingText, own.fontFamily, parseFloat(own.fontSize), 1, own.color, "ltr");
  }
  return canvas;
}
