// The page tree's own furniture: the due badge, and the context menu.

export const title = "sidebar";

const count = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;

const due = (id, pageId, ago) => ({
  id, x: 40, y: 40, width: 200, height: 150, html: `<p>${id}</p>`,
  color: "transparent", z: 1, locked: false, remindAt: Date.now() - ago,
  createdAt: Date.now(), editedAt: Date.now(), updatedAt: Date.now(), pageId,
});

export default async function run(page, s) {
  const home = (await page.stored("pages")).find((p) => !p.deleted).id;

  // A second page, so there is somewhere to be notified *about* rather than
  // just somewhere to look at.
  await page.evaluate(`(async () => {
    const pages = await import('./js/pages.js');
    await pages.createPage(null);
    document.activeElement.blur();
    await pages.switchPage(${JSON.stringify(home)});
    return true;
  })()`);
  await page.settle(700);
  const other = (await page.stored("pages")).map((p) => p.id).find((id) => id !== home);

  /* ---------------------------------------------------------- the badge */

  s.check("no badge while nothing is due", (await page.evaluate(count(".page-row.has-due"))) === 0);

  await page.seed("notes", [
    due("first", other, 30000),
    due("second", other, 20000),
    due("third", other, 10000),
    { ...due("quiet", home, 0), remindAt: undefined },
  ]);
  await page.settle(500);

  const badgeText = (id) =>
    page.evaluate(`document.querySelector('[data-page-id="${id}"] .page-badge').textContent`);
  const shown = (id) =>
    page.evaluate(`getComputedStyle(document.querySelector('[data-page-id="${id}"] .page-badge')).display !== 'none'`);

  s.check("the page holding them says how many", (await badgeText(other)) === "3", await badgeText(other));
  s.check("and shows the badge", (await shown(other)) === true);
  s.check("a page with nothing due shows none", (await shown(home)) === false);

  /* ------------------------------------------- badges line up in a column */

  await page.seed("notes", [
    due("first", other, 30000),
    due("second", other, 20000),
    due("third", other, 10000),
    due("here", home, 5000),
  ]);
  await page.settle(500);

  const rights = await page.evaluate(`
    [...document.querySelectorAll('.page-row')]
      .filter((r) => r.classList.contains('has-due'))
      .map((r) => Math.round(r.querySelector('.page-badge').getBoundingClientRect().right))`);
  s.check("both pages badge up", rights.length === 2, JSON.stringify(rights));
  s.check("and the badges line up in one column", rights[0] === rights[1], JSON.stringify(rights));

  const gap = await page.evaluate(`(() => {
    const row = document.querySelector('.page-row.has-due');
    const name = row.querySelector('.page-name').getBoundingClientRect();
    const badge = row.querySelector('.page-badge').getBoundingClientRect();
    return Math.round(badge.left - name.right);
  })()`);
  s.check("with the name kept clear of them", gap >= 6, `${gap}px`);

  const centred = await page.evaluate(`(() => {
    const row = document.querySelector('.page-row.has-due');
    const r = row.getBoundingClientRect();
    const b = row.querySelector('.page-badge').getBoundingClientRect();
    return Math.abs((b.top + b.bottom) / 2 - (r.top + r.bottom) / 2);
  })()`);
  s.check("and sitting on the row's centre line", centred < 1.5, `${centred}px off`);

  /* -------------------------------------------- clicking through the queue */

  const clickBadge = async (id) => {
    await page.evaluate(`document.querySelector('[data-page-id="${id}"] .page-badge').click()`);
    await page.settle(600);
  };
  const activeNote = () => page.evaluate(`(document.querySelector('.note.is-active') || {}).id || ''`);
  const currentPage = () => page.evaluate(`document.querySelector('.page-row.is-current').dataset.pageId`);

  await clickBadge(other);
  s.check("clicking the badge goes to the page holding them", (await currentPage()) === other);
  s.check(
    "and opens the note that came due first",
    (await page.evaluate(`[...document.querySelectorAll('.note.is-active')].length`)) === 1
  );
  const firstSeen = await page.evaluate(`document.querySelector('.note.is-active .note-body').textContent`);
  s.check("oldest first", firstSeen === "first", firstSeen);

  await clickBadge(other);
  const second = await page.evaluate(`document.querySelector('.note.is-active .note-body').textContent`);
  s.check("clicking again steps to the next one", second === "second", second);

  await clickBadge(other);
  await clickBadge(other);
  const wrapped = await page.evaluate(`document.querySelector('.note.is-active .note-body').textContent`);
  s.check("and it wraps round rather than stopping at the end", wrapped === "first", wrapped);

  /* ------------------------------------------------------ the context menu */

  const rowAt = async (id) =>
    page.evaluate(`(() => {
      const r = document.querySelector('[data-page-id="${id}"]').getBoundingClientRect();
      return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) };
    })()`);

  const open = async (id) => {
    const at = await rowAt(id);
    await page.cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: at.x, y: at.y, button: "right", buttons: 2, clickCount: 1,
    });
    await page.settle(60);
    await page.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: at.x, y: at.y, button: "right", buttons: 0, clickCount: 1,
    });
    await page.settle(300);
  };

  await open(other);
  s.check("right-clicking a page opens a menu", (await page.evaluate(count(".ctx-menu"))) === 1);
  const items = await page.evaluate(`[...document.querySelectorAll('.ctx-item')].map((b) => b.textContent)`);
  s.check("with the things you can do to a page", items.join(",") === "Rename,New sub-page,Delete page", items.join(","));

  await page.key("Escape", "Escape");
  await page.settle(250);
  s.check("Escape closes it", (await page.evaluate(count(".ctx-menu"))) === 0);

  /* ------------------------------------------------------ deleting a page */

  // confirm() is what the delete asks through, so count the asking.
  await page.evaluate(`(() => {
    window.__asked = [];
    window.confirm = (text) => { window.__asked.push(text); return true; };
    return true;
  })()`);

  // An empty page first: nothing to lose, so nothing to ask.
  await page.evaluate(`(async () => {
    const pages = await import('./js/pages.js');
    await pages.createPage(null);
    document.activeElement.blur();
    return true;
  })()`);
  await page.settle(700);
  const empty = (await page.stored("pages")).map((p) => p.id).find((id) => id !== home && id !== other);

  await open(empty);
  await page.evaluate(`[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === 'Delete page').click()`);
  await page.settle(600);
  s.check("deleting an empty page asks nothing", (await page.evaluate(`window.__asked.length`)) === 0);
  s.check("and it is gone", (await page.stored("pages")).find((p) => p.id === empty).deleted === true);

  // Now one with notes in it.
  await open(other);
  await page.evaluate(`[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === 'Delete page').click()`);
  await page.settle(800);

  const asked = await page.evaluate(`window.__asked`);
  s.check("deleting a page with notes asks twice", asked.length === 2, String(asked.length));
  s.check("the first says what is going", asked[0] && asked[0].includes("3 notes"), asked[0]);
  s.check("the second says it cannot be undone", asked[1] && asked[1].includes("cannot be undone"), asked[1]);
  s.check(
    "and the notes go with the page",
    (await page.stored("notes")).filter((n) => n.pageId === other && !n.deleted).length === 0
  );

  /* ------------------------------------ the last page standing is protected */

  await open(home);
  const disabled = await page.evaluate(
    `[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === 'Delete page').disabled`
  );
  s.check("the only remaining page cannot be deleted", disabled === true);
}
