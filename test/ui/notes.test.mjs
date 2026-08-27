// The note itself: what it shows, what it costs the body, and how it moves.

export const title = "notes";

export default async function run(page, s) {
  const { check } = s;

  await page.click(600, 400, 2);
  await page.type("hello there");
  await page.settle(); // the header fades in; read it once it has arrived

  let state = await page.evaluate(`(() => {
    const n = document.querySelector('.note');
    if (!n) return null;
    const h = n.querySelector('.note-header');
    const b = n.querySelector('.note-body');
    return {
      active: n.classList.contains('is-active'),
      headerOpacity: getComputedStyle(h).opacity,
      above: h.getBoundingClientRect().bottom <= n.getBoundingClientRect().top,
      bodyTop: b.getBoundingClientRect().top - n.getBoundingClientRect().top,
      clear: n.classList.contains('is-clear'),
      shadow: getComputedStyle(n).boxShadow,
      focused: b.contains(document.activeElement),
    };
  })()`);
  check("double-click makes a note", !!state);
  check("a new note is active", state.active === true);
  check("the header shows on the active note", Number(state.headerOpacity) > 0.99, state.headerOpacity);
  check("the header floats above the note", state.above === true);
  check("the header costs the body no room", state.bodyTop === 0, `${state.bodyTop}px`);
  check("new notes have no fill", state.clear === true);
  // Hovered or active it shows a hairline; what it must never do is cast the
  // drop shadow a filled note casts, which read as a smudge on the canvas.
  check("an unfilled note casts no drop shadow",
    state.shadow === "none" || state.shadow.includes("inset"), state.shadow);

  // leaving it
  await page.click(950, 250);
  await page.settle();
  state = await page.evaluate(`(() => {
    const n = document.querySelector('.note');
    const h = n.querySelector('.note-header');
    return {
      active: n.classList.contains('is-active'),
      headerOpacity: getComputedStyle(h).opacity,
      headerHits: getComputedStyle(h).pointerEvents,
      cursor: getComputedStyle(n.querySelector('.note-body')).cursor,
      focused: n.querySelector('.note-body').contains(document.activeElement),
    };
  })()`);
  check("clicking away releases the note", state.active === false);
  check("the header goes with it",
    Number(state.headerOpacity) < 0.01 && state.headerHits === "none", state.headerOpacity);
  check("and the note gives up focus", state.focused === false);
  check("an idle note offers a grab cursor", state.cursor === "grab", state.cursor);

  // dragging from the body of an idle note
  const before = await rect(page);
  await page.drag(before.x + before.w / 2, before.y + before.h / 2 + 10, 140, 90);
  let after = await page.evaluate(`(() => {
    const n = document.querySelector('.note');
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height,
      active: n.classList.contains('is-active'), text: n.querySelector('.note-body').textContent };
  })()`);
  check("a drag anywhere moves an idle note",
    Math.abs(after.x - before.x - 140) < 4 && Math.abs(after.y - before.y - 90) < 4,
    `dx=${(after.x - before.x).toFixed(0)} dy=${(after.y - before.y).toFixed(0)}`);
  check("dragging does not resize it", Math.abs(after.w - before.w) < 2 && Math.abs(after.h - before.h) < 2);
  check("dragging keeps the content", after.text === "hello there");
  check("the moved note is saved", (await page.stored()).filter((n) => !n.deleted).length === 1);

  // clicking places the caret rather than moving anything
  await page.click(950, 250);
  const idle = await rect(page);
  await page.click(idle.x + 40, idle.y + 40);
  state = await page.evaluate(`(() => {
    const n = document.querySelector('.note');
    const b = n.querySelector('.note-body');
    const r = n.getBoundingClientRect();
    const sel = window.getSelection();
    return { active: n.classList.contains('is-active'), focused: b.contains(document.activeElement),
      caretInside: sel.rangeCount ? b.contains(sel.anchorNode) : false, x: r.x, y: r.y };
  })()`);
  check("a click activates the note", state.active === true && state.focused === true);
  check("and lands the caret where it was clicked", state.caretInside === true);
  check("a click never moves the note", Math.abs(state.x - idle.x) < 1 && Math.abs(state.y - idle.y) < 1);

  // ...and once active, the body belongs to the caret
  const live = await rect(page);
  await page.drag(live.x + 16, live.y + 18, 100, 0);
  state = await page.evaluate(`(() => {
    const r = document.querySelector('.note').getBoundingClientRect();
    return { x: r.x, y: r.y, selection: String(window.getSelection()) };
  })()`);
  check("dragging inside the active note selects text", state.selection.length > 0, JSON.stringify(state.selection));
  check("and leaves the note where it is", Math.abs(state.x - live.x) < 2);

  // the resize grip
  await page.click(950, 250);
  const parked = await rect(page);
  await page.drag(parked.x + parked.w / 2, parked.y + parked.h / 2, 460 - parked.x, 240 - parked.y);
  const home = await rect(page);
  await page.drag(home.x + home.w - 5, home.y + home.h - 5, 70, 50);
  const grown = await rect(page);
  check("the grip resizes instead of moving", Math.abs(grown.x - home.x) < 2 && Math.abs(grown.y - home.y) < 2);
  check("the grip grows the note", grown.w > home.w + 40 && grown.h > home.h + 30,
    `${home.w}x${home.h} -> ${grown.w}x${grown.h}`);

  // the popover is the handle for an active note
  await page.click(grown.x + 30, grown.y + 60);
  const handle = await page.evaluate(`(() => {
    const n = document.querySelector('.note');
    const r = n.getBoundingClientRect();
    const h = n.querySelector('.note-header').getBoundingClientRect();
    return { x: r.x, y: r.y, hx: h.x + h.width / 2, hy: h.y + h.height / 2 };
  })()`);
  await page.drag(handle.hx, handle.hy, -60, 40);
  const dragged = await rect(page);
  check("the header popover drags the note",
    Math.abs(dragged.x - handle.x + 60) < 4 && Math.abs(dragged.y - handle.y - 40) < 4,
    `dx=${(dragged.x - handle.x).toFixed(0)} dy=${(dragged.y - handle.y).toFixed(0)}`);

  // colours
  const palette = await page.evaluate(`(() => {
    document.querySelector('.note .note-btn-color').click();
    const dots = [...document.querySelectorAll('.palette-dot')];
    return { count: dots.length, clear: dots.filter((d) => d.classList.contains('is-clear')).length,
      current: dots.findIndex((d) => d.classList.contains('is-current')) };
  })()`);
  check("the palette offers the wider set", palette.count === 18, String(palette.count));
  check("no fill leads it, and is current", palette.clear === 1 && palette.current === 0, JSON.stringify(palette));

  const painted = await page.evaluate(`(() => {
    [...document.querySelectorAll('.palette-dot')][4].click();
    const n = document.querySelector('.note');
    return { note: getComputedStyle(n).backgroundColor,
      header: getComputedStyle(n.querySelector('.note-header')).backgroundColor };
  })()`);
  check("the header takes the note's colour", painted.note === painted.header, JSON.stringify(painted));

  // deleting, and undo
  const close = await page.evaluate(`(() => {
    const b = document.querySelector('.note .note-btn-close').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
  await page.click(close.x, close.y);
  await page.settle();
  check("the close button deletes", (await page.evaluate(`document.querySelectorAll('.note').length`)) === 0);
  check("a delete offers undo",
    (await page.evaluate(`getComputedStyle(document.getElementById('undo-bar')).opacity !== '0'`)) === true);
  await page.evaluate(`document.getElementById('undo-btn').click()`);
  await page.settle(500); // the record is rewritten before it is re-rendered
  check("undo brings it back", (await page.evaluate(`document.querySelectorAll('.note').length`)) === 1);

  // A note that outgrows its box scrolls inside it. The note stopped hiding
  // its overflow when the header became a popover, and a flex item will not
  // shrink below its content unless told to — so this is the guard on that.
  await page.click(950, 250);
  await page.settle();
  await page.click(700, 420, 2);
  await page.settle();
  await page.typeKeys("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n");
  await page.settle();
  const spill = await page.evaluate(`(() => {
    const n = document.querySelector('.note.is-active');
    const b = n.querySelector('.note-body');
    const box = n.getBoundingClientRect();
    const last = b.lastElementChild.getBoundingClientRect();
    return { taller: b.scrollHeight > b.clientHeight, fits: b.clientHeight <= Math.round(box.height),
      beyond: Math.round(last.bottom - box.bottom) };
  })()`);
  check("a long note scrolls inside itself", spill.taller && spill.fits, JSON.stringify(spill));
  check("and never spills onto the canvas", spill.beyond <= 0, `${spill.beyond}px past the edge`);

  // an empty note removes itself
  await page.click(950, 250);
  await page.settle();
  await page.click(300, 180, 2);
  await page.settle();
  const standing = await page.evaluate(`document.querySelectorAll('.note').length`);
  check("an empty note stands while you are in it", standing === 3, `${standing} notes`);
  await page.click(950, 250);
  await page.settle();
  check("an empty note left behind is discarded",
    (await page.evaluate(`document.querySelectorAll('.note').length`)) === 2);
  check("discarding it says nothing",
    (await page.evaluate(`getComputedStyle(document.getElementById('undo-bar')).opacity === '0'`)) === true);
}

const rect = (page) =>
  page.evaluate(`(() => {
    const r = document.querySelector('.note').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
