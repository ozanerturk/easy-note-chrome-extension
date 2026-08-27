// A locked note stays where it was put, and stays there.

export const title = "locking";

export default async function run(page, s) {
  const { check } = s;

  const make = async (x, y, text) => {
    await page.click(x, y, 2);
    await page.type(text);
    await page.settle();
    return page.evaluate(`document.querySelector('.note.is-active').dataset.id`);
  };
  const posOf = async (id) =>
    (await page.stored()).filter((n) => n.id === id).map((n) => [Math.round(n.x), Math.round(n.y)])[0];
  const boxOf = (id) =>
    page.evaluate(`(() => { const r = document.querySelector('[data-id="${id}"]').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);

  const pinned = await make(420, 200, "pinned");
  await page.evaluate(`document.querySelector('[data-id="${pinned}"] .note-btn-lock').click()`);
  await page.settle();
  check("the note reports itself locked",
    (await page.evaluate(`document.querySelector('[data-id="${pinned}"]').classList.contains('is-locked')`)) === true);
  check("and its delete button is out of reach",
    (await page.evaluate(`document.querySelector('[data-id="${pinned}"] .note-btn-close').disabled`)) === true);

  // dragging it does nothing
  await page.click(1050, 120);
  await page.settle();
  const before = await posOf(pinned);
  let box = await boxOf(pinned);
  await page.drag(box.x + box.w / 2, box.y + box.h / 2, 200, 120);
  check("a locked note cannot be dragged", JSON.stringify(await posOf(pinned)) === JSON.stringify(before),
    `${before} -> ${await posOf(pinned)}`);

  // ...but can still be resized, since only its place is pinned
  box = await boxOf(pinned);
  await page.drag(box.x + box.w - 5, box.y + box.h - 5, 70, 50);
  await page.settle();
  const grown = await boxOf(pinned);
  check("a locked note can still be resized", grown.w > box.w + 40 && grown.h > box.h + 30,
    `${box.w}x${box.h} -> ${grown.w}x${grown.h}`);
  check("resizing it does not move it", JSON.stringify(await posOf(pinned)) === JSON.stringify(before));

  // a group drag leaves it behind
  const free = await make(820, 200, "free");
  await page.click(1050, 120);
  await page.settle();
  await page.drag(360, 130, 700, 400); // marquee over both
  await page.settle();
  check("both are selected", (await page.evaluate(`document.querySelectorAll('.note.is-selected').length`)) === 2);

  const freeBefore = await posOf(free);
  const grab = await boxOf(free);
  await page.drag(grab.x + grab.w / 2, grab.y + grab.h / 2, -120, 150);
  await page.settle();
  const freeAfter = await posOf(free);
  check("dragging the group moves the note that can move",
    Math.abs(freeAfter[0] - freeBefore[0] + 120) < 4 && Math.abs(freeAfter[1] - freeBefore[1] - 150) < 4,
    `${freeBefore} -> ${freeAfter}`);
  check("and leaves the locked one behind", JSON.stringify(await posOf(pinned)) === JSON.stringify(before),
    `${before} -> ${await posOf(pinned)}`);

  // aligning the selection lines the others up against it, without moving it
  await page.evaluate(`document.querySelector('#arrange [data-align="top"]').click()`);
  await page.settle();
  check("aligning leaves a locked note where it is",
    JSON.stringify(await posOf(pinned)) === JSON.stringify(before), `${before} -> ${await posOf(pinned)}`);
  check("and lines the free one up with it", (await posOf(free))[1] === before[1],
    `${(await posOf(free))[1]} vs ${before[1]}`);

  // unlocking hands it back
  await page.click(1050, 120);
  await page.settle();
  await page.click((await boxOf(pinned)).x + 20, (await boxOf(pinned)).y + 20);
  await page.settle();
  await page.evaluate(`document.querySelector('[data-id="${pinned}"] .note-btn-lock').click()`);
  await page.settle();
  await page.click(1050, 120);
  await page.settle();
  box = await boxOf(pinned);
  await page.drag(box.x + box.w / 2, box.y + box.h / 2, 90, 60);
  await page.settle();
  const moved = await posOf(pinned);
  check("unlocking makes it draggable again",
    Math.abs(moved[0] - before[0] - 90) < 4 && Math.abs(moved[1] - before[1] - 60) < 4, `${before} -> ${moved}`);
}
