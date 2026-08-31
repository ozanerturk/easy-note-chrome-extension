// The home view: a viewport each page can be sent back to.
//
// Distinct from the view that follows you around and remembers wherever you
// stopped — this one only moves when it is deliberately set, which is what
// makes it somewhere to return to.

export const title = "home view";

const centre = (page, selector) =>
  page.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

const near = (a, b, slack = 2) =>
  Math.abs(a.x - b.x) < slack && Math.abs(a.y - b.y) < slack && Math.abs(a.zoom - b.zoom) < 0.02;

export default async function run(page, s) {
  const home = (await page.stored("pages")).find((p) => !p.deleted).id;

  await page.seed("notes", [
    {
      id: "a", x: 100, y: 100, width: 200, height: 150, html: "<p>one</p>",
      color: "transparent", z: 1, locked: false,
      createdAt: Date.now(), editedAt: Date.now(), updatedAt: Date.now(), pageId: home,
    },
  ]);

  const button = await centre(page, "#go-home");

  /* --------------------------------------------------- before one is set */

  await page.evaluate(`import('./js/view.js').then(m => m.setView({ x: -400, y: -300, zoom: 2.5 }))`);
  await page.settle(300);
  s.check("the board can be moved somewhere odd", (await page.view()).zoom === 2.5);

  await page.click(button.x, button.y);
  await page.settle(500);
  const framed = await page.view();
  s.check(
    "with no home view set, Home frames the notes instead of doing nothing",
    framed.zoom !== 2.5,
    JSON.stringify(framed)
  );

  /* ---------------------------------------------------------- setting one */

  await page.evaluate(`import('./js/view.js').then(m => m.setView({ x: 120, y: 90, zoom: 1.4 }))`);
  await page.settle(300);
  const wanted = await page.view();

  // Press and hold, which is how a home view is set.
  await page.mouse("mousePressed", button.x, button.y);
  await page.settle(950); // past the 700ms hold
  await page.mouse("mouseReleased", button.x, button.y, { buttons: 0 });
  await page.settle(400);

  s.check(
    "holding the button says it took",
    (await page.evaluate(`document.getElementById('toast').textContent`)) === "Home view set for this page",
    await page.evaluate(`document.getElementById('toast').textContent`)
  );
  s.check(
    "and says it where it can be read",
    (await page.evaluate(`document.getElementById('toast').classList.contains('is-open')`)) === true
  );
  s.check(
    "and stores the view against the page",
    !!(await page.stored("meta")).find((r) => r.id === `home:${home}`)
  );

  /* --------------------------------------------------------- returning */

  await page.evaluate(`import('./js/view.js').then(m => m.setView({ x: -800, y: -600, zoom: 0.4 }))`);
  await page.settle(300);
  s.check("wander off", (await page.view()).zoom === 0.4);

  await page.click(button.x, button.y);
  await page.settle(500);
  s.check("clicking Home goes back to it", near(await page.view(), wanted), JSON.stringify(await page.view()));

  /* -------------------------------------------------------------- Escape */

  await page.evaluate(`import('./js/view.js').then(m => m.setView({ x: -800, y: -600, zoom: 0.4 }))`);
  await page.settle(300);
  await page.key("Escape", "Escape");
  await page.settle(500);
  s.check("Escape with nothing else to dismiss goes home too", near(await page.view(), wanted), JSON.stringify(await page.view()));

  /* ------------------------------------ but only once there is nothing else */

  const noteAt = await centre(page, "#world .note");
  await page.click(noteAt.x, noteAt.y);
  await page.settle(400);
  s.check("a note is open", (await page.evaluate(`document.querySelectorAll('.note.is-active').length`)) === 1);

  await page.evaluate(`import('./js/view.js').then(m => m.setView({ x: -800, y: -600, zoom: 0.4 }))`);
  await page.settle(300);
  await page.key("Escape", "Escape");
  await page.settle(400);

  s.check("Escape steps out of the note first", (await page.evaluate(`document.querySelectorAll('.note.is-active').length`)) === 0);
  s.check(
    "and leaves the view alone while doing it",
    (await page.view()).zoom === 0.4,
    JSON.stringify(await page.view())
  );

  // Clicking a note both opened it and selected it, so Escape has one more
  // rung to walk down before the view is the only thing left to reset.
  s.check(
    "the note is still selected, so Escape is not done yet",
    (await page.evaluate(`document.querySelectorAll('.note.is-selected').length`)) === 1,
    await page.evaluate(`document.querySelector('#world .note').className`)
  );

  await page.key("Escape", "Escape");
  await page.settle(400);
  s.check("a second Escape drops the selection", (await page.evaluate(`document.querySelectorAll('.note.is-selected').length`)) === 0);
  s.check("still without moving the board", (await page.view()).zoom === 0.4);

  await page.key("Escape", "Escape");
  await page.settle(500);
  s.check("and only then does Escape go home", near(await page.view(), wanted), JSON.stringify(await page.view()));

  /* ------------------------------------------------------- one per page */

  await page.evaluate(`(async () => {
    const pages = await import('./js/pages.js');
    await pages.createPage(null);
    document.activeElement.blur();
    return true;
  })()`);
  await page.settle(800);

  const other = (await page.stored("pages")).map((p) => p.id).find((id) => id !== home);
  await page.evaluate(`import('./js/view.js').then(m => m.setView({ x: -50, y: -50, zoom: 3 }))`);
  await page.settle(300);
  await page.mouse("mousePressed", button.x, button.y);
  await page.settle(950); // past the 700ms hold
  await page.mouse("mouseReleased", button.x, button.y, { buttons: 0 });
  await page.settle(400);

  const records = await page.stored("meta");
  s.check("each page keeps its own home view", !!records.find((r) => r.id === `home:${other}`));
  s.check(
    "and setting one does not disturb the other",
    near(records.find((r) => r.id === `home:${home}`), wanted),
    JSON.stringify(records.find((r) => r.id === `home:${home}`))
  );
}
