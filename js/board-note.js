// A note on the board.
//
// note.js draws a note and knows everything a note can do. This is where one
// lives on the canvas: placed in world coordinates, filed into lists, picked up
// in a selection, carried between pages. A note floating over a webpage has
// none of that, and is drawn by the same note.js into a frame of its own — so
// what the board does to a note is kept here, out of the note's way.

import { NOTES, getAll } from "./db.js";
import { view, world, canvas, isPanGesture, screenToWorld, GRID } from "./view.js";
import {
  isSelected,
  selectOnly,
  toggleSelect,
  selectedList,
  selected,
  selectedLists,
  selectionSize,
  isListSelected,
} from "./selection.js";
import {
  currentPageId,
  setDraggedNotes,
  dropTargetAt,
  moveNotesToPage,
  notesInHand,
  switchPage,
  adoptOrphans,
  notesOnCurrentPage,
} from "./pages.js";
import { registerLayer } from "./board.js";
import {
  createList,
  listIsOnBoard,
  mountCard,
  fileIntoList,
  freeNote,
  dropAt,
  markDropList,
  updateGap,
  hideGap,
  gapTarget,
  listEntry,
  placeList,
} from "./list.js";
import { record } from "./history.js";
import { caretAt } from "./editor.js";
import { EDGE, nudgeInside } from "./origin.js";
import { toggleFloating, markFloating } from "./floating.js";
import { loadReminders } from "./reminders.js";
import {
  notes,
  setNoteHost,
  renderNote,
  saveNote,
  updateHint,
  detachNote,
  recordMove,
  applyBox,
  reviveNote,
  bringToFront,
  isTyping,
  editorFor,
  escapeHtml,
  seedZ,
} from "./note.js";

const dragLayer = document.getElementById("drag-layer");

/* ------------------------------------------------------------------- host */

setNoteHost({
  place(note, el) {
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    el.style.width = `${note.width}px`;
    el.style.height = `${note.height}px`;
    el.style.zIndex = note.z;
    world.appendChild(el);
    // A note that belongs to a list on this board is moved into it. One that
    // names a list which is missing, deleted, or on another page is simply a note
    // on the canvas — the coupling is deliberately loose, so a half-synced board
    // shows everything it has rather than hiding what it cannot place.
    if (listIsOnBoard(note.listId)) mountCard(note, el);
  },

  // Back where it came from. A note opened full-screen out of a list has to
  // return to that list — dropping it on the canvas instead would take it out
  // of the list by way of a gesture that was only ever about reading it.
  putBack(note, el) {
    if (!mountCard(note, el)) world.appendChild(el);
  },

  wire(note, el, grip, gripLeft) {
    el.addEventListener(
      "pointerdown",
      (e) => {
        if (note.fullscreen || isPanGesture(e)) return;
        // Shift adds to the selection. Cmd/Ctrl is left free: held during a
        // drag it steps the note across the grid instead.
        if (e.shiftKey) toggleSelect(note.id);
        else if (!isSelected(note.id)) selectOnly(note.id);
      },
      true
    );
    makeDraggable(el, note);
    makeResizable(el, note, grip, "se");
    makeResizable(el, note, gripLeft, "sw");
    el.__observer = observeResize(el, note);
  },

  gang(note, el) {
    return isSelected(note.id) && selected.size > 1 ? selectedList() : [{ note, el }];
  },

  menu(note, el, gang) {
    return {
      // Floating is about one note over every page, so it is offered on one
      // note, and not on a note that is part of a list — there it is a row in
      // something else, and what would float is not a thing you are holding.
      modes:
        gang.length === 1 && !note.listId
          ? [{ label: note.floating ? "Unfloat" : "Float", run: () => toggleFloating(note, el) }]
          : [],
      // A list is something you make out of notes you already have, so it is
      // offered where that is what you are holding: several notes, picked and
      // right-clicked. There is no menu item for an empty one.
      together:
        gang.length > 1 && gang.some((g) => !g.note.listId)
          ? [{ label: `Put these ${gang.length} notes in a list`, run: () => listFromNotes(gang) }]
          : [],
    };
  },

  // Floated or put away somewhere else — from a webpage, say — and taken in.
  adopted(note, el) {
    if (el) markFloating(note, el);
  },

  beside(note, el) {
    const box = el.getBoundingClientRect();
    return screenToWorld(box.right, box.top);
  },

  owns: (note) => note.pageId === currentPageId,
});

/* ------------------------------------------------------------------ lists */

/**
 * Gather notes into a new list, in the order they were lying in.
 *
 * The list arrives where the topmost-leftmost of them was, so the board keeps
 * its shape: the notes leave the canvas and the thing holding them stands where
 * they stood. Cards already in a list stay where they are.
 */
function listFromNotes(entries) {
  const loose = entries.filter(({ note }) => !note.listId);
  if (!loose.length) return null;
  const list = createList(
    Math.min(...loose.map(({ note }) => note.x)),
    Math.min(...loose.map(({ note }) => note.y))
  );
  loose
    .slice()
    .sort((a, b) => a.note.y - b.note.y || a.note.x - b.note.x)
    .forEach(({ note, el }, i) => fileIntoList(note, el, list.id, i));
  return list;
}

/* ------------------------------------------------------------ undo steps */

/**
 * Record notes having joined, left, or moved within a list.
 *
 * Separate from recordMove because taking one back means restoring membership
 * and rank, not only a position — and because a note coming out of a list has
 * both to restore, from one step. Notes whose list and rank both came out
 * unchanged are left out: a drag that ended where it started costs nothing.
 */
function recordListing(anchored) {
  const changes = anchored
    .map((entry) => ({
      note: entry.note,
      from: {
        listId: entry.startListId,
        listOrder: entry.startListOrder,
        x: entry.startLeft,
        y: entry.startTop,
      },
      to: {
        listId: entry.note.listId,
        listOrder: entry.note.listOrder,
        x: entry.note.x,
        y: entry.note.y,
      },
    }))
    .filter(({ from, to }) => from.listId !== to.listId || from.listOrder !== to.listOrder);
  if (!changes.length) return;

  record({
    kind: "listing",
    noteId: changes.length === 1 ? changes[0].note.id : null,
    label: changes.length === 1 ? "the move" : `the move of ${changes.length} notes`,
    undo: () => changes.forEach(({ note, from }) => applyListing(note, from)),
    redo: () => changes.forEach(({ note, to }) => applyListing(note, to)),
  });
}

// Put a note back in, or out of, a list. A list that is no longer on the board
// leaves the note on the canvas, which is the same rule the renderer follows.
function applyListing(note, at) {
  const entry = reviveNote(note);
  if (!entry) return;
  if (at.listId && listIsOnBoard(at.listId)) {
    note.listId = at.listId;
    note.listOrder = at.listOrder;
    saveNote(note);
    mountCard(note, entry.el);
  } else {
    freeNote(note, entry.el, at.x, at.y);
  }
}

// A note whose page has changed is on the wrong board until this is called:
// either it belongs to the one on screen and is not drawn, or it is drawn and
// no longer belongs there.
function showOnRightBoard(note) {
  const entry = notes.get(note.id);
  if (note.pageId === currentPageId) {
    if (entry) applyBox(note, { x: note.x, y: note.y });
    else renderNote(note);
  } else if (entry) {
    detachNote(entry);
  }
  updateHint();
}

/**
 * Record notes having been filed into another page.
 *
 * A move that crosses a board, so taking it back means restoring the page as
 * well as the position — a note sprung onto another page was also put down
 * somewhere on it, and undoing only half of that leaves it in the wrong place
 * on the right page.
 */
function recordFiling(entries, fromPageId, toPageId) {
  const moves = entries.map(({ note, startLeft, startTop }) => ({
    note,
    from: { pageId: fromPageId, x: startLeft, y: startTop },
    to: { pageId: toPageId, x: note.x, y: note.y },
  }));
  if (!moves.length) return;

  const apply = async (side) => {
    for (const move of moves) {
      const at = move[side];
      move.note.x = at.x;
      move.note.y = at.y;
      await moveNotesToPage([move.note], at.pageId);
      showOnRightBoard(move.note);
    }
    loadReminders(); // whatever is due may have changed pages with them
  };

  record({
    kind: "file",
    noteId: moves.length === 1 ? moves[0].note.id : null,
    label: moves.length === 1 ? "the filing" : `the filing of ${moves.length} notes`,
    undo: () => apply("from"),
    redo: () => apply("to"),
  });
}

function resizeStep(note, from, to) {
  return {
    kind: "resize",
    noteId: note.id,
    label: "the resize",
    undo: () => applyBox(note, from),
    redo: () => applyBox(note, to),
  };
}

/* --------------------------------------------------------------- drag layer */

// While dragging, a note leaves #world for #drag-layer so it is not clipped by
// the canvas and floats above the sidebar. Position becomes screen-space, and
// the world's scale is reapplied per-note so its size does not jump.
function liftToDragLayer(entries, pointer) {
  const rect = canvas.getBoundingClientRect();
  entries.forEach((entry) => {
    const { note, el } = entry;
    // A card being lifted out of a list becomes a note again on the way up: the
    // drag layer positions absolutely, which a listed card is not, and the size
    // it is about to have on the board is the honest thing to drag.
    if (el.classList.contains("is-listed")) {
      el.classList.remove("is-listed");
      el.style.width = `${note.width}px`;
      el.style.height = `${note.height}px`;
    }
    const left = rect.left + view.x + note.x * view.zoom;
    const top = rect.top + view.y + note.y * view.zoom;
    el.style.transform = `scale(${view.zoom})`;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // Where the note sits relative to the cursor, frozen at the moment it was
    // picked up. Once it is in hand the pointer carries it directly: spring-
    // loading a page swaps the view out from under the drag, and anything
    // deriving screen position from world coordinates would teleport.
    entry.grabX = left - pointer.x;
    entry.grabY = top - pointer.y;
    dragLayer.appendChild(el);
  });
}

function positionInDragLayer(entries, pointer) {
  entries.forEach(({ el, grabX, grabY }) => {
    el.style.left = `${pointer.x + grabX}px`;
    el.style.top = `${pointer.y + grabY}px`;
  });
}

// Where a note in hand currently is, in the world of whatever board is on
// screen now — which is not necessarily the board it was picked up from.
function worldPositionOf(el) {
  const at = screenToWorld(parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
  return { x: Math.round(at.x), y: Math.round(at.y) };
}

const overCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};

function returnToWorld(entries) {
  entries.forEach(({ note, el }) => {
    el.style.transform = "";
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    if (!el.isConnected) return;
    // A note picked up out of a list belongs back in it, not on the canvas
    // underneath — this is the path Escape takes, and abandoning a drag should
    // put things back exactly as they were found.
    if (!mountCard(note, el)) world.appendChild(el);
  });
}

// A click that never became a drag opens the note and puts the caret where it
// landed. The pointerdown was cancelled to keep the drag available, so nothing
// does this on its own.
function placeCaret(id, x, y) {
  const editor = editorFor(id);
  if (editor) caretAt(editor, x, y);
}

// Where each note in a drag was picked up from, in the shape the history wants.
const movesOf = (entries) =>
  entries.map(({ note, startLeft, startTop }) => ({ note, from: { x: startLeft, y: startTop } }));

function makeDraggable(el, note) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Space+drag pans the board from wherever the cursor is, note or not.
    if (isPanGesture(e)) return;
    // Buttons in the header must keep their click event: preventDefault() on
    // pointerdown suppresses the compatibility click that follows.
    if (e.target.closest(".note-btn")) return;
    if (note.fullscreen) return;

    // A tick box answers to the click itself; cancelling the pointerdown to
    // start a drag would swallow it. An app's own controls are the same case.
    if (e.target.closest('input[type="checkbox"], label')) return;
    if (e.target.closest(".note-body.is-app button, .note-body.is-app input")) return;

    const inBody = !!e.target.closest(".note-body");
    // A note you are writing in has given its body to the caret: dragging
    // there selects text, and the header popover is the handle. Its margin
    // is still a handle too — the editor fills the body, so landing on the
    // body itself means the pointer is out in the padding, on no text at all.
    const onMargin = e.target.classList.contains("note-body");
    if (inBody && !onMargin && isTyping(el)) return;
    if (e.target.closest("a[href]")) return;

    e.preventDefault();
    e.stopPropagation(); // don't let the canvas start a pan or marquee
    bringToFront(note, el);

    const startX = e.clientX;
    const startY = e.clientY;
    // Where these notes live. Spring-loading can change the board under the
    // drag, so "the page they came from" has to be remembered, not read back
    // off currentPageId at the end.
    const homePageId = currentPageId;

    // Dragging any member of a multi-selection moves the whole group.
    // Picked-out lists come too, cards and all; a card whose list is coming
    // stays in it rather than being lifted out, unless it is the one in your
    // hand.
    const grouped = isSelected(note.id) && selectionSize() > 1;
    const group = grouped
      ? selectedList().filter((entry) => entry.note.id === note.id || !(entry.note.listId && isListSelected(entry.note.listId)))
      : [{ note, el }];
    const carriedLists = grouped
      ? [...selectedLists]
          .map(listEntry)
          .filter(Boolean)
          .map((entry) => ({ ...entry, from: { x: entry.list.x, y: entry.list.y } }))
      : [];
    // Where the lists end up is kept only if the notes land on the board they
    // came from; anything else — another page, into a list, Escape — leaves
    // the lists where they were.
    const putListsBack = () =>
      carriedLists.forEach((c) => {
        c.list.x = c.from.x;
        c.list.y = c.from.y;
        c.el.style.left = `${c.from.x}px`;
        c.el.style.top = `${c.from.y}px`;
      });
    const keepLists = () => carriedLists.forEach((c) => placeList(c.list, { x: c.list.x, y: c.list.y }));
    const listMoves = () => carriedLists.map((c) => ({ list: c.list, from: c.from }));
    const anchored = group
      .map((entry) => {
        // A note in a list has no meaningful place on the canvas: its stored
        // x/y is wherever it sat before it was filed, which may be far off
        // screen. Starting from where it visibly is means lifting one out of a
        // list does not teleport it, and dropping it on the board leaves it
        // where it was let go.
        const box = entry.note.listId ? entry.el.getBoundingClientRect() : null;
        const at = box ? screenToWorld(box.left, box.top) : { x: entry.note.x, y: entry.note.y };
        return {
          ...entry,
          startLeft: Math.round(at.x),
          startTop: Math.round(at.y),
          startListId: entry.note.listId,
          startListOrder: entry.note.listOrder,
          // How much room to hold open for it. Measured now, while it is still
          // standing where it started, because a moment later it is in the drag
          // layer at the world's scale and no longer the size a list sees.
          cardHeight: Math.round(entry.el.getBoundingClientRect().height / view.zoom),
        };
      });

    let lifted = false;
    let moved = false;

    // Snapping steps by the note under the cursor, or by the first that can
    // actually move if that one is pinned.
    const lead = anchored.find((entry) => entry.note.id === note.id) || anchored[0];

    // The furthest a group can go up and left: its top-left corner stops at
    // the origin's edge, and the rest keep their places behind it. The note in
    // hand still follows the pointer — it has to, to reach a page in the
    // sidebar — but where it would land on the board is kept inside.
    const leftmost = Math.min(...anchored.map((entry) => entry.startLeft), ...carriedLists.map((c) => c.from.x));
    const topmost = Math.min(...anchored.map((entry) => entry.startTop), ...carriedLists.map((c) => c.from.y));

    const onMove = (moveEvent) => {
      // Screen delta -> world delta.
      let dx = (moveEvent.clientX - startX) / view.zoom;
      let dy = (moveEvent.clientY - startY) / view.zoom;

      // Cmd/Ctrl steps across the grid you can see behind the notes. Read
      // live, so it can be pressed or let go mid-drag. A group snaps by the
      // note under the cursor and travels with it, keeping its own shape.
      if (lead && (moveEvent.metaKey || moveEvent.ctrlKey)) {
        dx = Math.round((lead.startLeft + dx) / GRID) * GRID - lead.startLeft;
        dy = Math.round((lead.startTop + dy) / GRID) * GRID - lead.startTop;
      }
      if (anchored.length) {
        dx = Math.max(dx, EDGE - leftmost);
        dy = Math.max(dy, EDGE - topmost);
        carriedLists.forEach((c) => {
          c.list.x = Math.round(c.from.x + dx);
          c.list.y = Math.round(c.from.y + dy);
          c.el.style.left = `${c.list.x}px`;
          c.el.style.top = `${c.list.y}px`;
        });
      }

      anchored.forEach((entry) => {
        entry.note.x = entry.startLeft + dx;
        entry.note.y = entry.startTop + dy;
      });

      if (!lifted && anchored.length && Math.hypot(dx * view.zoom, dy * view.zoom) > 3) {
        lifted = true;
        moved = true;
        // Only now is this a drag, so only now do the pages light up as drop
        // targets — a plain click on a note should not flash the sidebar.
        setDraggedNotes(anchored.map((entry) => entry.note.id));
        liftToDragLayer(anchored, { x: moveEvent.clientX, y: moveEvent.clientY });
      }

      if (lifted) {
        positionInDragLayer(anchored, { x: moveEvent.clientX, y: moveEvent.clientY });
        // The list under the cursor fills in and opens a gap where the card
        // would land, the way a page row lights up. Without it, dropping into a
        // list is aiming at something that never answers.
        const over = updateGap(
          moveEvent.clientX,
          moveEvent.clientY,
          lead ? lead.cardHeight : 40
        );
        markDropList(over && over.listId);
      } else {
        anchored.forEach((entry) => {
          // A card in a list is placed by the list, not by coordinates. Writing
          // left/top on one shoves it across the board by its own world
          // position — it is `position: relative` in there, so these are an
          // offset from where it is standing rather than where it is. Nothing
          // needs moving before the lift anyway: the gap does that work.
          if (entry.note.listId) return;
          entry.el.style.left = `${entry.note.x}px`;
          entry.el.style.top = `${entry.note.y}px`;
        });
      }
    };

    const stopListening = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
    };

    // Put everything back exactly as it was found, including the board that
    // was on screen when the drag began. Used by Escape, and by dropping the
    // notes on the row of the page they already live on — "file these where
    // they already are" means nothing, and stranding them under the sidebar
    // is not what was meant by it.
    const revert = async () => {
      hideGap();
      markDropList(null);
      putListsBack();
      anchored.forEach((entry) => {
        entry.note.x = entry.startLeft;
        entry.note.y = entry.startTop;
      });
      if (currentPageId !== homePageId) await switchPage(homePageId);
      if (lifted) returnToWorld(anchored);
      setDraggedNotes(null); // last: the switch above needs them still in hand
      updateHint();
    };

    // Escape abandons the drag at any point, the same as everywhere else in
    // the app. Capture phase, so it beats the board's own Escape handler.
    const onKey = (keyEvent) => {
      if (keyEvent.key !== "Escape" || !moved) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      stopListening();
      revert();
    };

    const onUp = async (upEvent) => {
      stopListening();

      if (!moved) {
        // A click, not a drag. Clicking the body is how you start writing.
        if (inBody) placeCaret(note.id, upEvent.clientX, upEvent.clientY);
        return;
      }

      markDropList(null);
      const records = anchored.map((entry) => entry.note);
      const onRow = dropTargetAt(upEvent.clientX, upEvent.clientY);
      // The gap is the promise the drag made about where this lands, so it is
      // what the drop reads. Falling back to the pointer covers a drop that
      // never moved far enough to open one.
      const intoList = gapTarget() || dropAt(upEvent.clientX, upEvent.clientY);
      hideGap();
      // Whether a page was sprung open mid-drag, leaving these notes hovering
      // over a board that is not their own.
      const sprung = currentPageId !== homePageId;

      // Back onto their own page: a change of mind, so treat it as one.
      if (onRow && onRow === homePageId) {
        await revert();
        return;
      }

      // Reading the drop target first: this also cancels a spring still
      // counting down, so letting go never opens a page a beat too late.
      setDraggedNotes(null);

      // Dropped on another page's row: they go to it unplaced, as they always
      // have. Their coordinates are left alone — a row says which page, not
      // where on it, and the sidebar is no place to read a position from.
      if (onRow) {
        putListsBack();
        await moveNotesToPage(records, onRow);
        if (onRow === currentPageId) returnToWorld(anchored);
        else anchored.forEach(detachNote);
        updateHint();
        loadReminders(); // they may be another page's business now
        recordFiling(anchored, homePageId, onRow);
        return;
      }

      // Dropped into a list. Checked before the board, because a list is on the
      // board — the more specific target has to be asked about first.
      if (intoList && !sprung) {
        putListsBack();
        anchored.forEach((entry, i) => {
          fileIntoList(entry.note, entry.el, intoList.listId, intoList.index + i);
        });
        recordListing(anchored);
        updateHint();
        return;
      }

      // Dropped on the board. If a page was sprung open, this is the whole
      // point of having opened it: they join that page exactly where they were
      // put, rather than arriving somewhere on it unseen.
      if (overCanvas(upEvent)) {
        // Out of a list and onto the canvas: the note stops being in the list,
        // and the position it was let go at becomes its own again.
        const wasListed = anchored.some((entry) => entry.startListId);
        anchored.forEach((entry) => {
          if (entry.note.listId) freeNote(entry.note, entry.el, entry.note.x, entry.note.y);
        });
        if (sprung) {
          putListsBack();
          const target = currentPageId;
          await moveNotesToPage(records, target);
          land(anchored);
          updateHint();
          loadReminders();
          recordFiling(anchored, homePageId, target);
        } else {
          // An ordinary move on the board they came from. The coordinates
          // onMove computed are kept as they are, so grid snapping survives.
          if (lifted) returnToWorld(anchored);
          anchored.forEach((entry) => saveNote(entry.note));
          keepLists();
          // Coming out of a list is one thing that happened, not two: the step
          // that restores the membership restores the position with it, so a
          // move step on top would take two ⌘Z to undo one drag.
          if (wasListed) {
            recordListing(anchored);
            recordMove([], null, listMoves());
          } else recordMove(movesOf(anchored), null, listMoves());
        }
        return;
      }

      // Dropped on nothing — the sidebar's empty space, or off the window.
      if (sprung) {
        // They still belong to their own page, which is no longer on screen.
        putListsBack();
        anchored.forEach((entry) => saveNote(entry.note));
        anchored.forEach(detachNote);
        updateHint();
      } else {
        if (lifted) returnToWorld(anchored);
        anchored.forEach((entry) => saveNote(entry.note));
        keepLists();
        recordMove(movesOf(anchored), null, listMoves());
      }
    };

    // Put notes down on the board that is currently up, where they visibly
    // are — not where their old page's coordinates would have put them.
    function land(entries) {
      entries.forEach((entry) => {
        const at = worldPositionOf(entry.el);
        entry.note.x = at.x;
        entry.note.y = at.y;
      });
      nudgeInside(entries.map((entry) => entry.note));
      returnToWorld(entries);
      entries.forEach((entry) => saveNote(entry.note));
    }

    // Window-level listeners rather than setPointerCapture: capture silently
    // failed to re-establish on repeat drags, stranding the note mid-gesture.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  });
}

// CSS `resize: both` was doing this, but it forces overflow:hidden on the
// note — which would clip the header popover against the note's own edge.
// Fifteen lines buys the popover its room, and a grip we can style.
//
// `corner` is "se" (grip at bottom-right, the default) or "sw" (bottom-left):
// dragging the left corner grows the note leftward, moving `note.x` along
// with it while the opposite edge holds still — same idea as the right grip,
// mirrored.
function makeResizable(el, note, grip, corner = "se") {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || note.fullscreen) return;
    // In a list the column owns the width and the words own the height. The
    // grip is hidden there; this is the guard behind the styling.
    if (note.listId) return;
    e.preventDefault();
    e.stopPropagation(); // not a drag of the note itself

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    const startLeft = note.x;
    const rightEdge = startLeft + startW; // what the sw grip holds still

    const stopListening = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
    };

    const onMove = (m) => {
      // Screen delta -> world delta, as everywhere else on the canvas.
      const dx = (m.clientX - startX) / view.zoom;
      el.style.height = `${startH + (m.clientY - startY) / view.zoom}px`;
      if (corner === "sw") {
        el.style.width = `${startW - dx}px`;
        // Read back the width CSS actually settled on (min-width can clamp
        // it) so the fixed right edge does not drift while it is clamped.
        el.style.left = `${rightEdge - el.offsetWidth}px`;
      } else {
        el.style.width = `${startW + dx}px`;
      }
    };

    const onUp = () => {
      stopListening();
      note.width = el.offsetWidth;
      note.height = el.offsetHeight;
      note.x = parseFloat(el.style.left) || note.x;
      if (note.width === startW && note.height === startH) return; // a grab, not a resize
      saveNote(note);
      record(
        resizeStep(
          note,
          { x: startLeft, width: startW, height: startH },
          { x: note.x, width: note.width, height: note.height }
        )
      );
    };

    // Escape abandons a resize the way it abandons a drag, and for the same
    // reason: the gesture is reversible right up until it is let go.
    const onKey = (keyEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      stopListening();
      applyBox(note, { x: startLeft, width: startW, height: startH });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  });
}

function observeResize(el, note) {
  const observer = new ResizeObserver(() => {
    // Removal fires this with a 0x0 box; fullscreen fires it with the viewport
    // size. Neither is a real resize of the note.
    if (note.deleted || note.fullscreen || !el.isConnected) return;
    // Nor is being in a list: there the column sets the width and the content
    // sets the height, and writing those back would overwrite the size the note
    // has on the board — and sync the overwrite — the moment it was filed.
    if (note.listId) return;
    note.width = el.offsetWidth;
    note.height = el.offsetHeight;
    saveNote(note);
  });
  observer.observe(el);
  return observer;
}

/* ------------------------------------------------------------------- boot */

export function clearBoard() {
  // Whatever is in hand stays there. Spring-loading rebuilds the board in the
  // middle of a drag, and detaching a note being carried would delete the
  // element under the cursor halfway through the gesture.
  const inHand = notesInHand();
  [...notes.values()]
    .filter((entry) => !inHand || !inHand.has(entry.note.id))
    .forEach(detachNote);
}

export function loadNote(record) {
  // A note in hand is already on screen, in the drag layer: clearBoard leaves
  // it there on purpose so a page switch mid-drag does not destroy the thing
  // under the cursor. Rendering it again here gave it a second element, which
  // is how dropping a note back on its own page produced two of it.
  const inHand = notesInHand();
  if (inHand && inHand.has(record.id)) return;

  // v1 stored plain text under `text`; carry it over as escaped markup.
  if (record.html === undefined) record.html = escapeHtml(record.text || "");
  delete record.deleted;
  delete record.fullscreen;
  seedZ(record.z || 1);
  renderNote(record);
}

// Notes draw after lists, so that a note belonging to one has a list body to be
// rendered into. Everything a page needs to show its notes is in here; opening
// a page is board.js's business, and no longer main.js's.
registerLayer({
  name: "notes",
  order: 20,
  clear: clearBoard,
  load: async () => {
    const records = adoptOrphans(await getAll(NOTES));
    notesOnCurrentPage(records).forEach(loadNote);
    updateHint();
    // Whatever came due while this page was not on screen starts wiggling now.
    await loadReminders();
  },
});

