// Panning and zooming, including with the cursor sitting on a note.

import { MOD } from "./harness.mjs";

export const title = "navigation";

export default async function run(page, s) {
  const { check } = s;

  await page.click(600, 300, 2);
  await page.type("line\n".repeat(30));
  await page.click(980, 120);

  const note = await page.evaluate(`(() => {
    const n = document.querySelector('.note');
    const r = n.getBoundingClientRect();
    const b = n.querySelector('.note-body');
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scrollable: b.scrollHeight > b.clientHeight };
  })()`);
  check("the note is tall enough to scroll", note.scrollable === true);

  let before = await page.view();
  const scrollBefore = await page.evaluate(`document.querySelector('.note-body').scrollTop`);
  await page.wheel(note.x, note.y, 120);
  let after = await page.view();
  check("the wheel over an idle note pans the board", after.y !== before.y, `${before.y} -> ${after.y}`);
  check("and does not scroll the note",
    (await page.evaluate(`document.querySelector('.note-body').scrollTop`)) === scrollBefore);

  before = await page.view();
  await page.wheel(note.x, note.y, -120, MOD.ctrl);
  after = await page.view();
  check("ctrl+wheel over a note still zooms", after.zoom > before.zoom, `${before.zoom} -> ${after.zoom}`);

  // the note you are working in keeps its own scrolling
  await page.evaluate(`document.getElementById('fit').click()`);
  await page.settle();
  const live = await page.evaluate(`(() => {
    const r = document.querySelector('.note').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await page.click(live.x, live.y);
  await page.settle();
  before = await page.view();
  await page.wheel(live.x, live.y, 120);
  await page.settle(200);
  after = await page.view();
  check("the wheel inside the active note scrolls it",
    (await page.evaluate(`document.querySelector('.note-body').scrollTop`)) > 0);
  check("and leaves the board alone", after.x === before.x && after.y === before.y);

  // space+drag pans from wherever the cursor is
  await page.key("Escape", "Escape");
  await page.settle();
  const pos = await page.evaluate(`(() => {
    const r = document.querySelector('.note').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  const noteBefore = (await page.stored()).map((n) => Math.round(n.x));
  before = await page.view();
  await page.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await page.drag(pos.x, pos.y, -72, -48);
  await page.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  after = await page.view();
  check("space+drag over a note pans the board", Math.abs(after.x - before.x + 72) < 8, `${before.x} -> ${after.x}`);
  check("and leaves the note where it was",
    JSON.stringify((await page.stored()).map((n) => Math.round(n.x))) === JSON.stringify(noteBefore));
}
