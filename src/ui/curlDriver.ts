/**
 * What stands between the gesture (pageTurn.ts) and the graphics chip (curlGl.ts): one canvas over the pages, shown only
 * while a page turns, and each page's picture, kept ready ahead of a swipe so a turn starts with nothing left to draw.
 */
import { createCurlGl, type CurlGl } from "./curlGl.ts";
import { curlAt, type TurnScene } from "./curlMath.ts";
import { drawPagePicture, pictureKey } from "./pagePicture.ts";

export interface CurlDriver {
  /** This pager is the one on screen. */
  attach: (pager: HTMLElement) => void;
  /** A turn begins: each page's picture is checked once, then kept for the whole of the turn. */
  begin: () => void;
  /** Gets a page's picture ready now, if it is out of date. */
  prepare: (page: HTMLElement) => void;
  /** Draws the turn; false if it could not (the page then simply lands). */
  draw: (pager: HTMLElement, pages: ReadonlyMap<number, HTMLElement>, scene: TurnScene, lean: number) => boolean;
  /** Takes the canvas off the screen: nothing is turning. */
  hide: () => void;
  /** This page has gone from the reader. */
  forget: (page: HTMLElement) => void;
}

/** The sharpest the leaf is drawn: the screen's own pixels, up to this many a point. */
const SCALE_MAX = 3;

interface Picture { key: string; texture: WebGLTexture }

let gl: CurlGl | null = null;
let canvas: HTMLCanvasElement | null = null;
let probed = false;
let lost = false;
const pictures = new Map<HTMLElement, Picture>();
/** The pages already checked in this turn. Their pictures are not looked at again, whatever the page does under the leaf. */
let checked = new Set<HTMLElement>();

const pixelScale = (): number => Math.min(SCALE_MAX, globalThis.devicePixelRatio || 1);

function forgetAll(): void {
  // After a lost context there is nothing left to delete: the old textures went with it.
  if (gl && !lost) pictures.forEach((p) => gl?.drop(p.texture));
  pictures.clear();
}

function start(): CurlGl | null {
  if (probed) return gl;
  probed = true;
  if (typeof document === "undefined") return null;
  const made = document.createElement("canvas");
  made.className = "curl-canvas";
  made.setAttribute("aria-hidden", "true");
  gl = createCurlGl(made);
  if (!gl) return null;
  canvas = made;
  made.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
    forgetAll();
  });
  made.addEventListener("webglcontextrestored", () => {
    lost = false;
    // The programs and the mesh went too, so it is made again from nothing on this same canvas.
    gl = createCurlGl(made);
  });
  return gl;
}

/** Whether the turn can be drawn here. */
export const curlAvailable = (): boolean => start() !== null && !lost;

function textureOf(chip: CurlGl, page: HTMLElement): WebGLTexture | null {
  const scale = pixelScale();
  const key = pictureKey(page, scale);
  const have = pictures.get(page);
  if (have?.key === key) return have.texture;
  const source = drawPagePicture(page, scale);
  const texture = source ? chip.picture(source) : null;
  if (source) {
    // On the chip now: the copy in plain memory goes at once, not whenever the browser next tidies up.
    source.width = 0;
    source.height = 0;
  }
  if (have) chip.drop(have.texture);
  if (!texture) {
    pictures.delete(page);
    return null;
  }
  pictures.set(page, { key, texture });
  return texture;
}

/** The picture for a page in this turn. */
function turnTexture(chip: CurlGl, page: HTMLElement): WebGLTexture | null {
  const have = pictures.get(page);
  if (have && checked.has(page)) return have.texture;
  checked.add(page);
  return textureOf(chip, page);
}

/** Every picture let go, and the canvas with them: the reader has been left, and they are large. */
export function releasePictures(): void {
  forgetAll();
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export const curlDriver: CurlDriver = {
  attach(pager) {
    if (!start() || !canvas) return;
    if (canvas.parentElement !== pager) {
      forgetAll();
      pager.append(canvas);
    }
    const scale = pixelScale();
    // Sizes as they truly are, not rounded to whole points: half a point here shows as the words shifting.
    const box = pager.getBoundingClientRect();
    const width = Math.round(box.width * scale);
    const height = Math.round(box.height * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  },
  begin() {
    checked = new Set();
  },
  prepare(page) {
    if (gl && !lost) textureOf(gl, page);
  },
  draw(pager, pages, scene, lean) {
    if (!gl || !canvas || lost) return false;
    const leaf = pages.get(scene.front);
    if (!leaf) return false;
    const front = turnTexture(gl, leaf);
    const backPage = scene.back === null ? undefined : pages.get(scene.back);
    const back = backPage ? turnTexture(gl, backPage) : null;
    if (!front) return false;
    const { width, height } = pager.getBoundingClientRect();
    const pageWidth = leaf.getBoundingClientRect().width;
    const shape = curlAt(scene.progress, pageWidth, lean);
    gl.draw({
      front, back, shape, progress: scene.progress, view: { width, height }, pageWidth,
      // With two pages open the spine is mid-screen; with one, the page's right edge, as the mushaf is bound.
      hinge: pager.classList.contains("spread") ? width / 2 : width,
      night: pager.closest(".theme-night") !== null,
    });
    canvas.classList.add("on");
    return true;
  },
  hide() {
    canvas?.classList.remove("on");
    if (gl && !lost) gl.clear();
  },
  forget(page) {
    const have = pictures.get(page);
    if (!have) return;
    if (gl && !lost) gl.drop(have.texture);
    pictures.delete(page);
  },
};
