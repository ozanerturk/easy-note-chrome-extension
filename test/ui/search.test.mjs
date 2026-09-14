// Search: opened with a tap of Space, a list of every note before anything is
// typed, in the order its tabs say — and typing narrows that list.

export const title = "search";

export default async function run(page, s) {
  const { check } = s;

  const pageId = (await page.stored("pages"))[0].id;
  const now = Date.now();
  const note = (id, text, editedAgo, extra = {}) => ({
    id, pageId, html: `<p>${text}</p>`, x: 100 + id.length * 10, y: 100, width: 200, height: 120,
    z: 1, createdAt: now - editedAgo, editedAt: now - editedAgo, updatedAt: now - editedAgo, ...extra,
  });
  await page.seed("notes", [
    note("n1", "banana split", 4 * 60000),
    note("n2", "apple pie", 1 * 60000, { remindAt: now + 3 * 3600000 }),
    note("n3", "cherry tart", 9 * 60000, { remindAt: now - 60000 }),
    note("n4", "banana bread", 2 * 60000),
  ]);

  const state = () =>
    page.evaluate(`(() => ({
      open: document.getElementById('search').classList.contains('is-open'),
      tab: document.querySelector('#search-filters .is-on')?.dataset.sort,
      rows: [...document.querySelectorAll('.search-row .search-text')].map((t) => t.textContent),
      when: [...document.querySelectorAll('.search-row .search-when')].map((t) => t.textContent),
      due: [...document.querySelectorAll('.search-when.is-due')].length,
      empty: document.querySelector('.search-empty')?.textContent || null,
    }))()`);
  const settled = () => page.settle(200);
  const tab = async (sort) => {
    await page.evaluate(`document.querySelector('#search-filters [data-sort="${sort}"]').click()`);
    await settled();
  };

  /* ------------------------------------------------------------- opening */

  await page.key(" ", "Space");
  await settled();
  let st = await state();
  check("a tap of Space opens search", st.open, JSON.stringify(st));
  check("on Recent", st.tab === "recent", st.tab);
  check("listing every note, last edited first",
    st.rows.join(" | ") === "apple pie | banana bread | banana split | cherry tart", st.rows.join(" | "));
  check("the box has the keys", await page.evaluate(`document.activeElement.id === 'search-input'`));

  /* ---------------------------------------------------------------- tabs */

  await tab("reminders");
  st = await state();
  check("Reminders lists only notes waiting on something", st.rows.join(" | ") === "cherry tart | apple pie",
    st.rows.join(" | "));
  check("soonest first, so what is due is on top", st.when[0] === "🔔 due" && st.due === 1, JSON.stringify(st.when));
  check("and says when the rest are due", st.when[1] === "🔔 in 3h", st.when[1]);

  await tab("az");
  st = await state();
  check("A–Z", st.rows.join(" | ") === "apple pie | banana bread | banana split | cherry tart", st.rows.join(" | "));
  await tab("za");
  st = await state();
  check("Z–A", st.rows.join(" | ") === "cherry tart | banana split | banana bread | apple pie", st.rows.join(" | "));

  /* ------------------------------------------------ typing, within a tab */

  await page.type("banana");
  await page.settle(300);
  st = await state();
  check("typing narrows the tab you are on", st.tab === "za" && st.rows.join(" | ") === "banana split | banana bread",
    JSON.stringify(st));
  await tab("reminders");
  st = await state();
  check("a tab with nothing matching says so", st.rows.length === 0 && st.empty === "No matching notes",
    JSON.stringify(st));

  await page.key("Tab", "Tab");
  await settled();
  check("Tab steps to the next tab", (await state()).tab === "az");
  await page.key("Tab", "Tab", 8);
  await settled();
  check("and Shift+Tab back", (await state()).tab === "reminders");

  await page.key("Escape", "Escape");
  await settled();
  check("Esc closes it", (await state()).open === false);

  await page.key(" ", "Space");
  await settled();
  st = await state();
  check("it opens on Recent again, with the box empty",
    st.tab === "recent" && st.rows.length === 4 && (await page.evaluate(`document.getElementById('search-input').value`)) === "",
    JSON.stringify(st));

  /* ------------------------------------------------ clicking a result */

  // Search only finds: it closes, goes to the note and picks it out, and
  // leaves opening it to you.
  const rowAt = (i) => page.evaluate(`(() => {
    const r = document.querySelectorAll('.search-row')[${i}].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  const found = (id) => page.evaluate(`(() => {
    const el = document.querySelector('.note[data-id="${id}"]');
    const r = el.getBoundingClientRect();
    const c = document.getElementById('canvas').getBoundingClientRect();
    return { open: document.getElementById('search').classList.contains('is-open'),
      selected: el.classList.contains('is-selected'), active: el.classList.contains('is-active'),
      typing: !!document.activeElement.closest('.note'),
      onScreen: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom };
  })()`);
  const at = await rowAt(2); // banana split
  await page.click(at.x, at.y);
  await page.settle(150);
  const hop = await page.evaluate(`getComputedStyle(document.querySelector('.note[data-id="n1"]')).animationName`);
  check("the note it found hops, the way a due one does", hop === "note-wiggle", hop);
  await page.waitFor(`!document.querySelector('.note[data-id="n1"]').classList.contains('is-found')`, { timeout: 3000 });
  check("once", (await page.evaluate(`getComputedStyle(document.querySelector('.note[data-id="n1"]')).animationName`)) === "none");
  let f = await found("n1");
  check("clicking a result closes search", f.open === false, JSON.stringify(f));
  check("and shows the note, picked out", f.selected && f.onScreen, JSON.stringify(f));
  check("without opening it for typing", !f.active && !f.typing, JSON.stringify(f));

  await page.key(" ", "Space");
  await settled();
  await page.key("Enter", "Enter");
  await page.settle(500);
  f = await found("n2");
  check("Enter does the same with the top result", !f.open && f.selected && !f.active && !f.typing, JSON.stringify(f));
  await page.click(1000, 150);
  await page.settle(300);

  /* ---------------------------------------------------- Space still pans */

  const spaceDown = () =>
    page.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  const spaceUp = () =>
    page.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });

  const before = await page.view();
  await spaceDown();
  await page.drag(800, 300, -120, -80);
  await spaceUp();
  await settled();
  const after = await page.view();
  check("Space held while dragging still pans", after.x !== before.x || after.y !== before.y,
    `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check("and does not open search", (await state()).open === false);
  check("nor type into a note",
    (await page.stored()).map((n) => n.html).sort().join() ===
    ["<p>apple pie</p>", "<p>banana bread</p>", "<p>banana split</p>", "<p>cherry tart</p>"].join());

  await spaceDown();
  await page.pause(600); // a hold that has to be held
  await spaceUp();
  await settled();
  check("nor does Space held and let go", (await state()).open === false);

  // In a note, Space is a space.
  await page.click(1000, 500, 2);
  await page.typeKeys("a b");
  await settled();
  check("typing in a note is left alone", (await state()).open === false);
  const typed = await page.evaluate(`document.querySelector('.note.is-active .note-body').textContent`);
  check("and the space lands in the note", typed === "a b", JSON.stringify(typed));
}
