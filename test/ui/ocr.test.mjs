// Reading the words in a picture, and laying them over it.
//
// The fragile part of this is not the recognition — it is that the engine, its
// wasm core and two language files all have to load from inside the extension
// with no network and no blob workers. That either works or it does not, and
// nothing else in the app would notice if it stopped.

import { sleep } from "./harness.mjs";

export const title = "ocr";

// Long enough for a cold start — the model is read and compiled on the first
// picture ever opened — without hanging the suite if it never comes.
const PATIENCE_MS = 40000;

const draw = (lines) => `new Promise((resolve) => {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 500;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 900, 500);
  g.fillStyle = '#111111';
  ${lines.map(([text, y, size]) => `g.font = '${size}px Helvetica'; g.fillText(${JSON.stringify(text)}, 60, ${y});`).join("\n  ")}
  c.toBlob((blob) => {
    const open = indexedDB.open('easynote');
    open.onsuccess = () => {
      const tx = open.result.transaction('images', 'readwrite');
      ${lines.length ? `tx.objectStore('images').put({ id: 'shot', blob });` : `tx.objectStore('images').put({ id: 'blank', blob });`}
      tx.oncomplete = () => resolve(true);
    };
  });
})`;

export default async function run(page, s) {
  const { check } = s;

  const home = (await page.stored("pages"))[0];
  const at = (x, y) => ({ x, y, width: 300, height: 320, z: 1, pageId: home.id,
    color: "transparent", createdAt: 1, editedAt: 1, updatedAt: 1 });

  await page.evaluate(draw([["Hello world", 140, 64], ["deploy on Friday", 240, 44]]));
  await page.evaluate(draw([]));
  await page.seed("notes", [
    { id: "shot-note", html: `<p>a screenshot</p><img data-img-id="shot">`, ...at(360, 140) },
    { id: "blank-note", html: `<p>no writing on this one</p><img data-img-id="blank">`, ...at(760, 140) },
  ]);

  const words = () => page.evaluate(`document.querySelectorAll('.gallery-word').length`);
  const isOpen = () => page.evaluate(`!document.getElementById('gallery').hidden`);

  // The gallery reads the whole board before it opens, so opening is a round
  // trip to the database rather than a repaint. Waited for here so that a slow
  // machine is not read as a broken feature.
  const openPicture = async (imgId) => {
    const box = await page.evaluate(`(() => {
      const r = document.querySelector('img[data-img-id="${imgId}"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await page.click(box.x, box.y, 2);
    for (let i = 0; i < 20 && !(await isOpen()); i++) await sleep(100);
    await page.settle();
  };

  /* ------------------------------------------------------------- reading */

  await openPicture("shot");
  check("the picture opens", (await isOpen()) === true);

  const started = Date.now();
  while (!(await words()) && Date.now() - started < PATIENCE_MS) await sleep(500);

  const found = await words();
  check(`the engine runs entirely inside the extension`, found > 0,
    found ? `${found} words in ${Math.round((Date.now() - started) / 1000)}s` : "no words came back");
  check(
    "and reads what is written on the picture",
    (await page.evaluate(`document.getElementById('gallery-text').textContent`)).includes("Hello world"),
    await page.evaluate(`document.getElementById('gallery-text').textContent`)
  );
  check(
    "which can then be copied",
    (await page.evaluate(`!document.getElementById('gallery-copy').hidden`)) === true
  );

  // Dragging across two words is the gesture the whole layer exists for. It
  // starts inside the first word rather than at its edge, the way a hand
  // would, so the selection runs from mid-word to the end of the second.
  const line = await page.evaluate(`(() => {
    const w = [...document.querySelectorAll('.gallery-word')];
    const a = w[0].getBoundingClientRect(), b = w[1].getBoundingClientRect();
    return { x: a.left + a.width * 0.3, y: a.top + a.height / 2, dx: b.right - a.left - a.width * 0.3 - 4 };
  })()`);
  // Clear of the double-click that opened the gallery: another press within
  // the multi-click window is a triple-click, not the start of a drag.
  await page.settle(500);
  await page.drag(line.x, line.y, line.dx, 0);
  const picked = (await page.evaluate(`window.getSelection().toString()`)).trim();
  check(
    "the words can be selected off the picture, across the gap between them",
    picked.endsWith("world") && picked.includes(" "),
    picked
  );

  /* -------------------------------------------------------------- keeping */

  check(
    "the answer is kept, so a picture is read once",
    (await page.stored("meta")).some((r) => r.id === "ocr:shot")
  );

  await page.key("Escape", "Escape");
  await page.settle(150);
  await openPicture("shot");
  for (let i = 0; i < 20 && !(await words()); i++) await sleep(100);
  check("and comes straight back on the next open", (await words()) > 0);

  /* ------------------------------------------------- a picture with none */

  await page.key("Escape", "Escape");
  await page.settle(150);
  await openPicture("blank");

  const blankStarted = Date.now();
  while (!(await page.stored("meta")).some((r) => r.id === "ocr:blank")
    && Date.now() - blankStarted < PATIENCE_MS) await sleep(500);

  check("a picture with no writing on it is asked once", true,
    `${Math.round((Date.now() - blankStarted) / 1000)}s`);
  check("and says nothing", (await words()) === 0);
  check(
    "with no copy button to press",
    (await page.evaluate(`document.getElementById('gallery-copy').hidden`)) === true
  );
}
