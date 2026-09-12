// The board's undo stack.
//
// There are two histories in this app and they never overlap. Tiptap keeps one
// inside the note you are typing in, for the words; this is the one outside it,
// for everything done *to* notes — moving them, resizing them, deleting them,
// and the edit you made to a note you have since walked away from. ⌘Z asks
// whichever of the two is listening: the editor while the caret is in a note,
// this one while it is not.
//
// A step is a pair of functions, so this module knows nothing about notes and
// note.js does not have to import a stack to describe a move. Either function
// may be async; steps are applied strictly one at a time.

const LIMIT = 100; // deep enough to walk back an afternoon, shallow enough to stay cheap

let past = [];
let future = [];

/**
 * Write down something that just happened, and how to take it back.
 *
 * @param {{label: string, undo: Function, redo: Function}} step
 * @returns the step, so a caller can hand it to the undo bar
 */
export function record(step) {
  past.push(step);
  if (past.length > LIMIT) past.shift();
  future = []; // a fresh action makes the redone future unreachable
  return step;
}

export function canUndo() {
  return past.length > 0;
}

export function canRedo() {
  return future.length > 0;
}

// A step in flight. Undo is async — it can wait on a database write — and two
// ⌘Z in quick succession would otherwise interleave halfway through one.
let busy = false;

/** Take back the most recent step. Resolves with it, or null if there was none. */
export async function undo() {
  if (busy || !past.length) return null;
  const step = past.pop();
  busy = true;
  try {
    await step.undo();
  } catch (err) {
    console.warn("undo failed", err); // a broken step is dropped, not retried
    return null;
  } finally {
    busy = false;
  }
  future.push(step);
  return step;
}

/** Put back the most recently undone step. */
export async function redo() {
  if (busy || !future.length) return null;
  const step = future.pop();
  busy = true;
  try {
    await step.redo();
  } catch (err) {
    console.warn("redo failed", err);
    return null;
  } finally {
    busy = false;
  }
  past.push(step);
  return step;
}

/**
 * Undo back through the stack until `step` itself has been taken back.
 *
 * This is what the undo bar's button does. The bar names one particular thing —
 * "3 notes deleted" — and must deliver that thing, but a stack cannot be undone
 * out of order, so anything done since goes back with it.
 */
export async function undoTo(step) {
  if (!past.includes(step)) return false;
  while (past.includes(step)) {
    if (!(await undo())) return false; // a step refused; stop rather than spin
  }
  return true;
}

/**
 * Drop every step matching `predicate`.
 *
 * For work that turned out never to have happened: a note made by accident and
 * abandoned empty leaves no trace on the board, so it should leave none here
 * either — otherwise ⌘Z hands back a blank square nobody asked for.
 */
export function forget(predicate) {
  past = past.filter((step) => !predicate(step));
  future = future.filter((step) => !predicate(step));
}

/**
 * Throw the whole history away.
 *
 * Called when the board underneath it is replaced — switching pages, or a sync
 * landing someone else's edits. The steps hold note records from the old board,
 * and applying one to the new one would resurrect a note from a page you are no
 * longer looking at.
 */
export function clearHistory() {
  past = [];
  future = [];
}
