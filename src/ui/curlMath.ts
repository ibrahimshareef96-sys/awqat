/**
 * The shape of a page as it turns, as numbers only (curlGl.ts draws it). The page wraps round a cylinder whose axis moves
 * from the free edge to the spine, and past the cylinder it lies flat again on its own back, the way paper folds. Length
 * along the paper is kept, so nothing stretches. Held by the middle of its edge the fold runs straight up and down; held
 * nearer a corner it leans, and that corner leads, as a real page does.
 *
 * One number says how far: `pos`, 0 at rest, towards 1 turning to the next page or spread, towards -1 turning back. The turn
 * back is the same turn seen from its other end, so a page can reverse under the finger with nothing changing but `pos`.
 */

export interface CurlShape {
  /** Where the fold's axis is, in px from the spine along the page. */
  axis: number;
  /** The cylinder's radius in px: nothing at either end of the turn, where the page lies flat. */
  radius: number;
  /** How far the fold leans, in radians. */
  theta: number;
}

/** What is in play at `pos`. */
export interface TurnScene {
  /** How far through the turn: 0 lying on its first side, 1 lying on its other. */
  progress: number;
  /** The page on the leaf's face. */
  front: number;
  /** The page on the leaf's back (two pages open), or null: with one page open it is the back of the same paper. */
  back: number | null;
  /** The pages that lie under the leaf, shown for real while it turns. */
  under: number[];
}

const RADIUS_SHARE = 0.11;
const LEAN_MAX = 0.2;
/** Where the fold's size grows in from nothing and shrinks back, as shares of the turn. */
const GROW_TO = 0.2;
const SHRINK_FROM = 0.72;

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));
const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * The fold at a point in the turn. With two pages open the finger crosses twice the page's width, so the free edge stays
 * under it; with one, the fold itself stays under it. `lean` is where the finger holds the page, -1 to 1 from its middle.
 */
export function curlAt(progress: number, width: number, lean = 0): CurlShape {
  const p = clamp(progress, 0, 1);
  const radius = width * RADIUS_SHARE * smooth(p / GROW_TO) * smooth((1 - p) / (1 - SHRINK_FROM));
  return {
    axis: Math.max(0, width * (1 - p) - (Math.PI * radius) / 2),
    radius,
    // Gone at both ends, so the page lands square on the spine.
    theta: clamp(lean, -1, 1) * LEAN_MAX * Math.sin(Math.PI * p),
  };
}

/** Where a point of the paper ends up, `along` px from the spine: where along the page, how high, and how far round the fold. */
export function foldPoint(along: number, shape: CurlShape): { along: number; height: number; phase: number } {
  const { axis, radius } = shape;
  const past = along - axis;
  if (past <= 0) return { along, height: 0, phase: 0 };
  if (radius < 0.001 || past >= Math.PI * radius) return { along: axis - (past - Math.PI * radius), height: 2 * radius, phase: Math.PI };
  const phase = past / radius;
  return { along: axis + radius * Math.sin(phase), height: radius * (1 - Math.cos(phase)), phase };
}

/**
 * The pages to lie on top while the leaf turns: what is under it, and where there is nothing under it (the end of the
 * mushaf, or of a mode's reading) the leaf's own page stays, so no other page shows past its edge.
 */
export function topPages(scene: TurnScene, spread: boolean): number[] {
  return scene.under.length < (spread ? 2 : 1) ? [...scene.under, scene.front] : scene.under;
}

/**
 * Every page in play at `pos`, given the open page (with two open, the right-hand one) and which pages exist. Null when
 * there is no leaf to turn.
 */
export function sceneAt(pos: number, open: number, spread: boolean, has: (page: number) => boolean): TurnScene | null {
  const forward = pos >= 0;
  const progress = forward ? pos : 1 + pos;
  if (!spread) {
    const front = forward ? open : open - 1;
    if (!has(front)) return null;
    return { progress, front, back: null, under: [front + 1].filter(has) };
  }
  // The leaf has this spread's left page on its face and the next spread's right page on its back.
  const right = forward ? open : open - 2;
  if (!has(right + 1)) return null;
  return { progress, front: right + 1, back: has(right + 2) ? right + 2 : null, under: [right, right + 3].filter(has) };
}
