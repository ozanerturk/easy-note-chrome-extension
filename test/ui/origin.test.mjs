// The board's origin: it starts at the top-left corner and grows right and
// down. The view never goes past it, nothing is put down past it, and a page
// made before it existed is brought inside it whole.

export const title = "origin";

export default async function run(page, s) {
  const { check } = s;

  const pageId = (await page.stored("pages"))[0].id;
  const now = Date.now();
  const note = (id, x, y) => ({
    id, pageId, html: `<p>${id}</p>`, x, y, width: 200, height: 120, z: 1,
    createdAt: now - 3600000, editedAt: now - 3600000, updatedAt: now - 3600000,
  });

  /* ------------------------------------------------- an old page, settled */

  await page.seed("notes", [note("far", -500, -300), note("near", 100, 50)]);
  const byId = async () => Object.fromEntries((await page.stored()).map((n) => [n.id, n]));
  let rec = await byId();
  check("a page reaching up and left of the origin is brought inside it",
    rec.far.x === 24 && rec.far.y === 24, `${rec.far.x}, ${rec.far.y}`);
  check("all of it together, so nothing moves relative to anything else",
    rec.near.x - rec.far.x === 600 && rec.near.y - rec.far.y === 350, `${rec.near.x}, ${rec.near.y}`);
  check("which is a move, not an edit", rec.far.editedAt === now - 3600000 && rec.far.updatedAt > now - 1000,
    `edited ${rec.far.editedAt}, updated ${rec.far.updatedAt}`);

  await page.reload();
  const again = await byId();
  // (updatedAt is no measure here: the board saves a note's measured size on
  // load. Where it is, is.)
  check("and only once", again.far.x === 24 && again.far.y === 24 && again.near.x === 624 && again.near.y === 374,
    JSON.stringify({ before: [rec.far.x, rec.far.y, rec.far.updatedAt], after: [again.far.x, again.far.y, again.far.updatedAt],
      near: [again.near.x, again.near.y, again.near.updatedAt] }));

  /* ------------------------------------------------ the view stops there */

  const canvasBox = await page.evaluate(`(() => {
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  const mid = { x: canvasBox.left + canvasBox.width / 2, y: canvasBox.top + canvasBox.height / 2 };

  // Scroll up and left, far past the corner.
  for (let i = 0; i < 12; i++) {
    await page.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: mid.x, y: mid.y, deltaX: -400, deltaY: -400, pointerType: "mouse",
    });
  }
  await page.settle(200);
  let v = await page.view();
  check("scrolling up and left stops at the origin", v.x === 0 && v.y === 0, JSON.stringify(v));

  await page.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await page.drag(mid.x, mid.y, 300, 200);
  await page.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await page.settle(200);
  v = await page.view();
  check("and so does dragging the board", v.x === 0 && v.y === 0, JSON.stringify(v));

  await page.evaluate(`document.getElementById('zoom-out').click()`);
  await page.evaluate(`document.getElementById('zoom-out').click()`);
  await page.settle(200);
  v = await page.view();
  check("zooming out keeps the origin in the corner", v.x <= 0 && v.y <= 0 && v.zoom < 1, JSON.stringify(v));

  await page.evaluate(`document.getElementById('fit').click()`);
  await page.settle(200);
  v = await page.view();
  check("as does fitting the board", v.x <= 0 && v.y <= 0, JSON.stringify(v));
  await page.evaluate(`document.getElementById('zoom-level').click()`); // back to 100%
  await page.settle(200);
  for (let i = 0; i < 12; i++) {
    await page.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: mid.x, y: mid.y, deltaX: -400, deltaY: -400, pointerType: "mouse",
    });
  }
  await page.settle(200);

  /* --------------------------------------------- nothing put down past it */

  // A double-click right in the corner makes a note one grid step in from it.
  await page.click(canvasBox.left + 6, canvasBox.top + 40, 2);
  await page.type("corner");
  await page.settle(300);
  rec = (await page.stored()).find((n) => n.html.includes("corner"));
  check("a note made against the edge starts one step in from it", rec && rec.x === 24 && rec.y >= 24,
    rec ? `${rec.x}, ${rec.y}` : "no note");
  await page.click(canvasBox.left + canvasBox.width - 60, canvasBox.top + canvasBox.height - 120);
  await page.settle(200);

  // Drag "near" by its header area far up and to the left.
  const nearBox = await page.evaluate(`(() => {
    const r = document.querySelector('.note[data-id="near"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 12 };
  })()`);
  await page.drag(nearBox.x, nearBox.y, -2000, -2000);
  await page.settle(300);
  rec = await byId();
  check("a note dragged past the edge stops at it", rec.near.x === 24 && rec.near.y === 24,
    `${rec.near.x}, ${rec.near.y}`);
  const shown = await page.evaluate(`(() => {
    const el = document.querySelector('.note[data-id="near"]');
    return { left: el.style.left, top: el.style.top, inWorld: el.parentElement.id === 'world' };
  })()`);
  check("and is drawn where it was put", shown.inWorld && shown.left === "24px" && shown.top === "24px",
    JSON.stringify(shown));
}
