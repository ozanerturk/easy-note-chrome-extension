// The board has an origin.
//
// It starts at the top-left corner and grows right and down, the way a sheet
// of paper is written on. A board with no edge at all let you drift off in
// any direction and left nowhere that was the start of it. So the view never
// shows what is above or to the left of the origin, and nothing is put down
// nearer to it than one step of the grid.
//
// Kept free of the DOM, so the rule itself can be tested in node.

import { NOTES, LISTS, getAll, put } from "./db.js";

// One step of the grid (GRID in view.js), so the first note on a page sits on
// the first row of dots rather than against the edge.
export const EDGE = 24;

/** A point moved inside the origin, if it was not already. */
export const inBounds = (x, y) => ({ x: Math.max(EDGE, x), y: Math.max(EDGE, y) });

/**
 * How far a group of things with x/y has to move, together, to be inside the
 * origin. Moved as one so a group keeps its own shape rather than piling up
 * against the edge.
 */
export function shiftInto(boxes) {
  if (!boxes.length) return { dx: 0, dy: 0 };
  const minX = Math.min(...boxes.map((b) => Number(b.x) || 0));
  const minY = Math.min(...boxes.map((b) => Number(b.y) || 0));
  return { dx: Math.max(0, EDGE - minX), dy: Math.max(0, EDGE - minY) };
}

/** Move a group by what shiftInto says, in place. */
export function nudgeInside(boxes) {
  const { dx, dy } = shiftInto(boxes);
  if (dx || dy) boxes.forEach((b) => {
    b.x = (Number(b.x) || 0) + dx;
    b.y = (Number(b.y) || 0) + dy;
  });
  return { dx, dy };
}

/**
 * Bring a page made before there was an origin inside it.
 *
 * Its notes may sit anywhere, far up and to the left included, and those would
 * be out of reach for good behind an edge the view cannot pass. The whole page
 * moves as one, so nothing on it changes place relative to anything else. A
 * page that is already inside is not touched, so this is a read on every open
 * and a write only once.
 *
 * Moving is not an edit: updatedAt changes, so sync carries it, but editedAt
 * does not, so "last edited" still means written in.
 */
export async function settleOrigin(pageId) {
  const lists = (await getAll(LISTS)).filter((l) => !l.deleted && l.pageId === pageId);
  const listed = new Set(lists.map((l) => l.id));
  // A card in a list is placed by its list; its own x/y is only where it was
  // before it was filed. One naming a list that is not here is drawn loose on
  // the board, so it counts like any other note.
  const notes = (await getAll(NOTES)).filter(
    (n) => !n.deleted && n.pageId === pageId && !(n.listId && listed.has(n.listId))
  );
  const records = [...notes.map((n) => [NOTES, n]), ...lists.map((l) => [LISTS, l])];
  const { dx, dy } = nudgeInside(records.map(([, r]) => r));
  if (!dx && !dy) return false;

  const now = Date.now();
  for (const [store, record] of records) {
    record.updatedAt = now;
    await put(store, record);
  }
  return true;
}
