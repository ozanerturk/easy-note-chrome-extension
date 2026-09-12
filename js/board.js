// What gets drawn on the board when a page opens.
//
// Opening a page used to mean "clear the notes, load the notes", written out
// once in main.js and reached from three directions — boot, a page switch, and
// a sync landing someone else's edits. Adding a second kind of thing to the
// board meant editing that one function and hoping every caller still agreed.
//
// A layer says how to clear itself and how to load a page, and registers here.
// main.js no longer knows what is on the board, only that there is one.

const layers = [];

/**
 * Add something that draws on the board.
 *
 * `order` is explicit rather than the order things happened to register in,
 * which would depend on the order main.js happens to import them — a trap for
 * exactly the kind of dependency that matters here: lists draw before notes,
 * because a note in a list needs its list's body to exist to be rendered into.
 *
 * @param {{name: string, order: number, clear: Function, load: Function}} layer
 */
export function registerLayer(layer) {
  layers.push(layer);
  layers.sort((a, b) => a.order - b.order);
}

/**
 * Redraw the board for a page.
 *
 * Everything is cleared before anything is loaded: a layer that tore itself
 * down halfway through another's load would leave the second one holding
 * elements that are about to be thrown away.
 */
export async function drawBoard(pageId) {
  layers.forEach((layer) => layer.clear());
  for (const layer of layers) await layer.load(pageId);
}
