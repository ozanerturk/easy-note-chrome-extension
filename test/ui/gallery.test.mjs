// Gallery mode: a picture opened at its own size, and the rest of the page's
// pictures either side of it.
//
// The reel is built from the live board rather than from the records, so the
// order it comes out in — notes down and across, images in writing order —
// is the thing worth pinning down here.

export const title = "gallery";

const TWO = `<p>first note</p><img data-img-id="g1"><img data-img-id="g2">`;
const ONE = `<p>second note</p><img data-img-id="g3">`;

export default async function run(page, s) {
  const { check } = s;

  const pageId = (await page.stored("pages"))[0].id;
  const at = (x, y) => ({ x, y, width: 260, height: 330, z: 1, pageId, color: "transparent",
    createdAt: 1, editedAt: 1, updatedAt: 1 });

  // Real blobs in the image store: an <img> with nothing behind it has no box
  // to double-click, so the pictures have to actually be there.
  await page.evaluate(`new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 60;
    const g = c.getContext('2d');
    g.fillStyle = '#4d8fe0';
    g.fillRect(0, 0, 80, 60);
    c.toBlob((blob) => {
      const open = indexedDB.open('easynote');
      open.onsuccess = () => {
        const tx = open.result.transaction('images', 'readwrite');
        ['g1', 'g2', 'g3'].forEach((id) => tx.objectStore('images').put({ id, blob }));
        tx.oncomplete = () => resolve(true);
      };
    });
  })`);

  await page.seed("notes", [
    { id: "note-a", html: TWO, ...at(320, 140) },
    { id: "note-b", html: ONE, ...at(700, 140) },
  ]);

  const count = () => page.evaluate(`document.getElementById('gallery-count').textContent`);
  const open = () => page.evaluate(`!document.getElementById('gallery').hidden`);
  const boxOf = (imgId) =>
    page.evaluate(`(() => {
      const r = document.querySelector('img[data-img-id="${imgId}"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

  check("nothing is up to begin with", (await open()) === false);

  /* ------------------------------------------------------------- opening */

  const g2 = await boxOf("g2");
  await page.click(g2.x, g2.y, 2);
  await page.settle();

  check("double-clicking a picture opens the gallery", (await open()) === true);
  check("it opens on the picture that was clicked, of all three", (await count()) === "2 / 3");

  /* ---------------------------------------------------------- navigating */

  await page.key("ArrowRight", "ArrowRight");
  await page.settle(150);
  check("the right arrow steps forward", (await count()) === "3 / 3");

  await page.key("ArrowRight", "ArrowRight");
  await page.settle(150);
  check("past the end it wraps round", (await count()) === "1 / 3");

  await page.key("ArrowLeft", "ArrowLeft");
  await page.settle(150);
  check("and back the other way", (await count()) === "3 / 3");

  const next = await page.evaluate(`(() => {
    const r = document.getElementById('gallery-next').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await page.click(next.x, next.y);
  await page.settle(150);
  check("the arrow button does what the key does", (await count()) === "1 / 3");

  /* -------------------------------------------------------- go to note */

  // Back to the third picture, which is the one living in the other note.
  await page.key("ArrowLeft", "ArrowLeft");
  await page.settle(150);

  const goto = await page.evaluate(`(() => {
    const r = document.getElementById('gallery-goto').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await page.click(goto.x, goto.y);
  await page.settle(400);

  check("going to the note closes the gallery", (await open()) === false);
  check(
    "and leaves that note the selected one",
    (await page.evaluate(`document.querySelector('.note.is-selected')?.dataset.id`)) === "note-b"
  );

  /* -------------------------------------------------------------- escape */

  const g1 = await boxOf("g1");
  await page.click(g1.x, g1.y, 2);
  await page.settle();
  check("a picture in the first note opens on the first frame", (await count()) === "1 / 3");

  // Arrows to look, Enter to go there — the mouse never has to be touched.
  await page.key("ArrowLeft", "ArrowLeft");
  await page.settle(150);
  check("stepping back from the first frame lands on the last", (await count()) === "3 / 3");

  await page.key("Enter", "Enter");
  await page.settle(400);
  check("Enter goes to the note the picture is in", (await open()) === false);
  check(
    "which is the note that picture belongs to",
    (await page.evaluate(`document.querySelector('.note.is-selected')?.dataset.id`)) === "note-b"
  );

  await page.click(g1.x, g1.y, 2);
  await page.settle();

  await page.key("Escape", "Escape");
  await page.settle(150);
  check("Escape closes it", (await open()) === false);
  check(
    "and stops there — the board is not sent home as well",
    (await page.evaluate(`document.querySelectorAll('.note').length`)) === 2
  );
}
