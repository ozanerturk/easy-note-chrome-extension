// Where a floating note sits, in viewport pixels.
//
// A floating note carries two places at once: its x/y/width/height on the
// board, in world coordinates like any other note, and a floating box in
// viewport pixels. The two are deliberately different spaces — that is the
// whole mechanism by which zooming the board leaves the floating widget alone.
// Nothing in here knows about the board's transform, and that is the point.
//
// DOM-free so the clamping can be tested in node. The frame that draws the note
// imports it; the content script that puts that frame on a page cannot import
// anything, and restates the few lines it needs to clip a frame before the
// note inside has loaded.

export const DEFAULT_WIDTH = 260;
export const DEFAULT_HEIGHT = 180;

// How far each additional floating note steps down and to the right, so two
// of them made in a row do not land on top of each other.
export const CASCADE = 24;

// How much of the widget must stay on screen. A note dragged almost entirely
// off the right edge is still findable by its remaining sliver; one dragged
// fully off is gone for good, and no amount of dragging brings it back.
const KEEP = 48;

/**
 * Hold a box inside a viewport.
 *
 * Applied on render rather than only on save, because a box saved on a wide
 * monitor arrives by sync on a laptop that never agreed to it — and because a
 * window can be resized under a note that was perfectly placed at the time.
 */
export function clampBox(box, viewport) {
  const width = Math.max(1, Math.min(Number(box.width) || DEFAULT_WIDTH, viewport.width));
  const height = Math.max(1, Math.min(Number(box.height) || DEFAULT_HEIGHT, viewport.height));
  return {
    x: Math.round(Math.max(KEEP - width, Math.min(Number(box.x) || 0, viewport.width - KEEP))),
    y: Math.round(Math.max(0, Math.min(Number(box.y) || 0, viewport.height - KEEP))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * A box for a note that has never floated.
 *
 * Roughly centred, stepped by how many are already floating. `taken` is that
 * count, not the notes themselves, so the service worker can call this knowing
 * only how many records have `floating` set.
 */
export function defaultBox(viewport, taken = 0) {
  const step = (taken % 6) * CASCADE;
  return clampBox(
    {
      x: Math.round((viewport.width - DEFAULT_WIDTH) / 2) + step,
      y: Math.round((viewport.height - DEFAULT_HEIGHT) / 3) + step,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    },
    viewport
  );
}

// A note tucked away at the side of the page leaves this much of itself
// showing. On the right it also keeps clear of the edge, where a scrollbar
// drawn over the page — macOS draws them over, not beside — covered the whole
// of the sliver and left nothing to see or click.
export const TUCK_TIP = 16;
export const TUCK_RIGHT_GAP = 18;

// A tucked-away note shows the top of itself as a tab this tall, so several
// can wait down one edge of the page without covering each other.
export const TUCK_TAB = 72;
export const TUCK_GAP = 8;

/**
 * Where a tucked-away note goes across: to the left unless it is well over to
 * the right, since the left edge of a page has nothing drawn over it. `side`,
 * once it has been decided, decides.
 */
export function tuckedX(box, viewportWidth, side) {
  const toLeft = side ? side === "left" : box.x + box.width / 2 < (viewportWidth * 2) / 3;
  return {
    toLeft,
    x: toLeft ? TUCK_TIP - box.width : viewportWidth - TUCK_TIP - TUCK_RIGHT_GAP,
  };
}

/**
 * Where a note tucks away: which side, and how far down. At the height it was,
 * unless another note's tab is already there — then the nearest height that is
 * free. Two notes tucked from the same height used to land exactly on top of
 * each other, and only one of them could ever be clicked back.
 *
 * @param taken  the tabs already at the edges, as { side, y }
 */
export function tuckedSpot(box, viewport, taken = []) {
  const side = tuckedX(box, viewport.width).toLeft ? "left" : "right";
  const lowest = Math.max(TUCK_GAP, viewport.height - TUCK_TAB - TUCK_GAP);
  const wanted = Math.min(Math.max(TUCK_GAP, Math.round(Number(box.y) || 0)), lowest);
  const beside = taken.filter((t) => t && t.side === side);
  const free = (y) => beside.every((t) => y + TUCK_TAB + TUCK_GAP <= t.y || t.y + TUCK_TAB + TUCK_GAP <= y);
  const choices = [wanted, ...beside.flatMap((t) => [t.y + TUCK_TAB + TUCK_GAP, t.y - TUCK_TAB - TUCK_GAP])]
    .filter((y) => y >= TUCK_GAP && y <= lowest && free(y))
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
  // An edge with no room left: share, rather than refuse to tuck.
  return { side, y: choices.length ? choices[0] : wanted };
}

/** The floating box of a record, defaulted and clamped in one go. */
export function boxOf(note, viewport, taken = 0) {
  return note.floatingGeometry
    ? clampBox(note.floatingGeometry, viewport)
    : defaultBox(viewport, taken);
}
