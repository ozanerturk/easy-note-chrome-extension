// Rows and columns, added and taken away on hover.
//
// A table in a note should read as a table and nothing else — no gutter of
// buttons down the side, no toolbar sitting above it waiting to be used. So
// the controls are not part of the note at all: four small things drawn over
// whichever table the pointer is on, and gone the moment it leaves.
//
// They live in a layer of their own on the page, the way the selection bar in
// js/bubble.js does, rather than inside the note. Anything put inside the note
// is text the note then has — it would turn up in what gets saved, in what a
// search reads, and in the copy taken when the note is closed.

const SIZE = 14; // the round × controls, centred on the edge they act along
const BAR = 12; // the thickness of the + strips
const PILL = 44; // and their length: a target, not a rail down the whole edge

/**
 * Put hover controls on every table in one note's editor.
 *
 * `body` is the note's body, which is what the pointer is watched over; the
 * controls themselves are placed in screen coordinates, over whatever the
 * canvas happens to be showing.
 */
export function attachTableControls(editor, body) {
  const layer = document.createElement("div");
  layer.className = "table-controls";
  document.body.appendChild(layer);

  // What the pointer is on. Held so a control can act on the row or column it
  // was drawn for rather than on wherever the caret happens to be.
  let cell = null;

  const control = (className, label, title) => {
    const el = document.createElement("button");
    el.className = `table-ctl ${className}`;
    el.innerHTML = label;
    el.title = title;
    el.hidden = true;
    // Pressing a control must not take the caret out of the note.
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    layer.appendChild(el);
    return el;
  };

  const rowX = control("is-row-x", "&times;", "Delete row");
  const colX = control("is-col-x", "&times;", "Delete column");
  const rowPlus = control("is-row-plus", "+", "Add a row");
  const colPlus = control("is-col-plus", "+", "Add a column");
  const all = [rowX, colX, rowPlus, colPlus];

  function hide() {
    cell = null;
    all.forEach((el) => (el.hidden = true));
  }

  function place(el, left, top, width, height) {
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.hidden = false;
  }

  function show(next) {
    cell = next;
    const row = cell.parentElement;
    const table = cell.closest("table");
    const t = table.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const c = cell.getBoundingClientRect();

    // A note scrolls, and a table scrolled out of one has taken its controls
    // with it — they are drawn on the page rather than in the note, so nothing
    // else would clip them.
    const host = body.getBoundingClientRect();
    if (c.bottom < host.top || c.top > host.bottom || c.right < host.left || c.left > host.right) {
      return hide();
    }

    // Taking the last row or the last column away leaves nothing a table can
    // be made of, so that press removes the table instead of erroring or
    // leaving an empty one behind. The label says so before it is pressed.
    const lastRow = table.rows.length <= 1;
    const lastCol = row.cells.length <= 1;
    rowX.title = lastRow ? "Delete table" : "Delete row";
    colX.title = lastCol ? "Delete table" : "Delete column";

    // A table taller than the note is scrolled inside it, and these are drawn
    // on the page rather than in the note, so nothing would stop them running
    // on down the canvas. The note's own box is as far as they go: a strip is
    // cut off at it, and a × that no longer fits does not appear.
    const dot = (el, left, top) => {
      const inside = left >= host.left && top >= host.top &&
        left + SIZE <= host.right && top + SIZE <= host.bottom;
      if (inside) place(el, left, top, SIZE, SIZE);
      else el.hidden = true;
    };
    const strip = (el, left, top, width, height) => {
      const l = Math.max(left, host.left);
      const t2 = Math.max(top, host.top);
      const r2 = Math.min(left + width, host.right);
      const b = Math.min(top + height, host.bottom);
      // Under a few pixels there is nothing left to aim at, and a sliver of a
      // control is worse than none.
      if (r2 - l < 8 || b - t2 < 8) el.hidden = true;
      else place(el, l, t2, r2 - l, b - t2);
    };

    // Every control sits astride the edge it works on, half of it over the
    // cell's own padding and half over the note's. Nothing is out beyond the
    // table, where the note's edge would cut it off and the pointer would have
    // to leave the table to reach it.
    //
    // And each one only appears along the edge it belongs to: the × for a row
    // and a column in the gutters the table is read from, the + where the new
    // row or column would actually go. A cell in the middle of a table has
    // nothing around it at all.
    const cells = [...row.cells];
    const rows = [...table.rows];

    if (cell === cells[0]) dot(rowX, t.left - SIZE / 2, r.top + r.height / 2 - SIZE / 2);
    else rowX.hidden = true;

    if (row === rows[0]) dot(colX, c.left + c.width / 2 - SIZE / 2, t.top - SIZE / 2);
    else colX.hidden = true;

    // A short pill in the middle of the edge, not a rail down the whole of it:
    // a rail read as part of the table — one of them was mistaken for the
    // note's scrollbar — and two rails meet in the corner.
    const down = band(t.top, t.bottom, host.top, host.bottom);
    const across = band(t.left, t.right, host.left, host.right);

    if (row === rows[rows.length - 1] && across) strip(rowPlus, across.from, t.bottom - BAR / 2, across.size, BAR);
    else rowPlus.hidden = true;

    if (cell === cells[cells.length - 1] && down) strip(colPlus, t.right - BAR / 2, down.from, BAR, down.size);
    else colPlus.hidden = true;
  }

  /** The caret into the hovered cell, so a table command knows where it is. */
  function inCell() {
    // Straight inside the cell is the boundary before its first block; one
    // further in is a place text can be, which is what a selection wants.
    const pos = editor.view.posAtDOM(cell, 0) + 1;
    return editor.chain().focus(pos);
  }

  /**
   * Where a + sits along one edge: in the middle of it, but pulled back into
   * whatever part of that edge the note is actually showing, so a table longer
   * than its note still has one to press.
   */
  function band(start, end, min, max) {
    const from = Math.max(start, min);
    const to = Math.min(end, max);
    const room = to - from;
    if (room < 12) return null;
    const size = Math.min(PILL, room);
    const middle = Math.min(Math.max((start + end) / 2, from + size / 2), to - size / 2);
    return { from: middle - size / 2, size };
  }

  /**
   * Draw them again where they now belong — after a row arrives, a word is
   * typed, an undo, or the note scrolling under the pointer.
   */
  function refresh() {
    if (!cell) return;
    if (cell.isConnected && editor.isEditable) show(cell);
    else hide();
  }

  const act = (el, run) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!cell || !cell.isConnected) return;
      run(inCell(), cell.closest("table"), cell.parentElement);
    });

  act(rowX, (chain, table) => (table.rows.length <= 1 ? chain.deleteTable() : chain.deleteRow()).run());
  act(colX, (chain, table, row) => (row.cells.length <= 1 ? chain.deleteTable() : chain.deleteColumn()).run());
  // After adding, the pointer is still on the + but the last row or column is
  // a new one, so the hover moves on to it: press again and another arrives.
  act(rowPlus, (chain, table, row) => {
    const column = [...row.cells].indexOf(cell);
    chain.addRowAfter().run();
    const last = table.isConnected && table.rows[table.rows.length - 1];
    if (last) show(last.cells[Math.min(column, last.cells.length - 1)]);
  });
  act(colPlus, (chain, table, row) => {
    chain.addColumnAfter().run();
    if (row.isConnected) show(row.cells[row.cells.length - 1]);
  });

  /** Is the pointer in the margin the + strips sit in, just off the table? */
  function beside(table, e) {
    const t = table.getBoundingClientRect();
    const room = SIZE; // as far out as the controls themselves reach
    return e.clientX > t.left - room && e.clientX < t.right + room &&
      e.clientY > t.top - room && e.clientY < t.bottom + room;
  }

  function onMove(e) {
    if (layer.contains(e.target)) return; // the controls count as part of the table
    if (!editor.isEditable || editor.isDestroyed) return hide();
    const over = e.target.closest && e.target.closest("td, th");
    if (over) return show(over);
    // The + strips are outside the table, so getting to one means crossing a
    // strip of note that is not a cell. Letting go of the table there took the
    // controls away as the pointer set off towards them.
    if (cell && cell.isConnected && beside(cell.closest("table"), e)) return;
    hide();
  }

  // Moving onto a control is leaving the note, as far as the note is
  // concerned — and taking the controls away as the pointer arrives on one is
  // how you build something that cannot be pressed.
  function onLeave(e) {
    if (!layer.contains(e.relatedTarget)) hide();
  }

  // And the other way round: once the pointer is on a control the note has
  // already been left, so leaving the control is the only thing left to hear.
  function offControls(e) {
    if (!body.contains(e.relatedTarget)) hide();
  }

  body.addEventListener("mousemove", onMove);
  body.addEventListener("mouseleave", onLeave);
  layer.addEventListener("mouseleave", offControls);
  // The note scrolling, or the page under it: the table has moved, so the
  // controls move with it.
  window.addEventListener("scroll", refresh, true);
  editor.on("transaction", refresh);

  editor.on("destroy", () => {
    body.removeEventListener("mousemove", onMove);
    body.removeEventListener("mouseleave", onLeave);
    window.removeEventListener("scroll", refresh, true);
    layer.remove();
  });
}
