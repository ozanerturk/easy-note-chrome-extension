// Moving notes between pages, and saying so before the drop happens.

export const title = "pages";

export default async function run(page, s) {
  const { check } = s;

  await page.evaluate(`document.getElementById('add-page').click()`);
  await page.settle(400);
  const rows = await page.evaluate(`[...document.querySelectorAll('[data-page-id]')].map((r) => ({
    id: r.dataset.pageId, current: r.classList.contains('is-current'), box: r.getBoundingClientRect().toJSON() }))`);
  check("a second page exists", rows.length === 2);

  const [home, target] = rows;
  await page.click(home.box.x + 40, home.box.y + home.box.height / 2);
  await page.settle(400);

  for (const [x, y] of [[500, 200], [800, 200], [500, 420]]) {
    await page.click(x, y, 2);
    await page.type(`note at ${x}`);
  }
  await page.click(1050, 120);
  check("three notes on the first page", (await page.evaluate(`document.querySelectorAll('.note').length`)) === 3);

  await page.drag(420, 140, 640, 400);
  check("a marquee takes all three",
    (await page.evaluate(`document.querySelectorAll('.note.is-selected').length`)) === 3);

  // drag one of the selection onto the other page, stopping over the row
  const from = await page.evaluate(`(() => {
    const r = document.querySelector('.note').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  const tx = target.box.x + target.box.width / 2;
  const ty = target.box.y + target.box.height / 2;
  await page.mouse("mousePressed", from.x, from.y);
  await page.settle(40);
  for (let i = 1; i <= 10; i++) {
    await page.mouse("mouseMoved", from.x + ((tx - from.x) * i) / 10, from.y + ((ty - from.y) * i) / 10);
    await page.settle(30);
  }
  const hovering = await page.evaluate(`(() => {
    const row = document.querySelector('.page-row.is-note-drop');
    const panel = document.getElementById('sidebar');
    return { marked: !!row, filled: row && getComputedStyle(row).backgroundColor,
      dragging: panel.classList.contains('is-drop-target'),
      panelEdge: getComputedStyle(panel).boxShadow };
  })()`);
  check("the sidebar knows a drop is coming", hovering.dragging === true);
  check("the row under the cursor fills in", hovering.marked === true, hovering.filled);
  check("and the panel itself is left alone", hovering.panelEdge === "none", hovering.panelEdge);

  await page.mouse("mouseReleased", tx, ty, { buttons: 0 });
  await page.settle(600); // three records, written one after another
  const landed = (await page.stored()).filter((n) => !n.deleted).filter((n) => n.pageId === target.id);
  check("all three land on the other page", landed.length === 3, `${landed.length} of 3`);
  check("and leave the board they came from",
    (await page.evaluate(`document.querySelectorAll('.note').length`)) === 0);
  check("the mark clears once it is done",
    (await page.evaluate(`!document.querySelector('.page-row.is-note-drop')`)) === true);

  /* Every way you would actually pick a note up has to reach a page. The
     header popover is the one that matters most — it is the handle offered
     the moment a note is clicked — and it was landing on itself: the popover
     sets its own pointer-events, so the hit test under the cursor found the
     header instead of the row beneath it. */
  const dropOnTarget = async (from) => {
    await page.mouse("mousePressed", from.x, from.y);
    await page.settle(40);
    for (let i = 1; i <= 10; i++) {
      await page.mouse("mouseMoved", from.x + ((tx - from.x) * i) / 10, from.y + ((ty - from.y) * i) / 10);
      await page.settle(30);
    }
    const marked = await page.evaluate(`!!document.querySelector('.page-row.is-note-drop')`);
    await page.mouse("mouseReleased", tx, ty, { buttons: 0 });
    await page.settle(500);
    return marked;
  };
  const onTarget = async () => (await page.stored()).filter((n) => !n.deleted && n.pageId === target.id).length;
  const geometry = () => page.evaluate(`(() => {
    const n = document.querySelector('.note');
    const r = n.getBoundingClientRect();
    const h = n.querySelector('.note-header').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, hx: h.x + h.width / 2, hy: h.y + h.height / 2 };
  })()`);

  await page.click(600, 300, 2);
  await page.type("by the body");
  await page.settle();
  await page.click(1050, 120); // leave it, so the whole note is a handle
  await page.settle();
  let g = await geometry();
  check("an idle note drops in, dragged by its body", (await dropOnTarget({ x: g.x + g.w / 2, y: g.y + g.h / 2 })) &&
    (await onTarget()) === 4);

  await page.click(600, 300, 2);
  await page.type("by the header");
  await page.settle();
  g = await geometry();

  // ...and on the way it has to get out of its own way: a note is wider than
  // the sidebar, so at full strength it covers the list being aimed at.
  await page.mouse("mousePressed", g.hx, g.hy);
  await page.settle(40);
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", g.hx + ((tx - g.hx) * i) / 6, g.hy + ((ty - g.hy) * i) / 6);
    await page.settle(30);
  }
  const carried = await page.evaluate(`(() => {
    const layer = document.getElementById('drag-layer');
    const row = document.querySelector('.page-row.is-note-drop');
    return { faded: +getComputedStyle(layer.querySelector('.note')).opacity,
      over: layer.classList.contains('is-over-sidebar'),
      rowVisible: !!row && getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)' };
  })()`);
  check("a note carried over the sidebar fades out of the way",
    carried.over && carried.faded < 0.5, `opacity ${carried.faded}`);
  check("so the row underneath can be seen", carried.rowVisible === true);
  await page.mouse("mouseReleased", tx, ty, { buttons: 0 });
  await page.settle(500);
  check("an active note drops in, dragged by its header", (await onTarget()) === 5);
  check("and comes back to full strength afterwards",
    (await page.evaluate(`!document.getElementById('drag-layer').classList.contains('is-over-sidebar')`)) === true);

  await page.click(600, 300, 2);
  await page.type("by the margin");
  await page.settle();
  g = await geometry();
  check("and dragged by the margin around its text",
    (await dropOnTarget({ x: g.x + 4, y: g.y + g.h / 2 })) && (await onTarget()) === 6);
}
