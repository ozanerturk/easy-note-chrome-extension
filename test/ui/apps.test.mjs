// Mini-apps — a note that does something, and the note that stores it.
//
// The checks that matter are the ones that ask the record rather than the face:
// an app whose state lived in the DOM would pass every visual check here and
// still lose the timer on a reload. So every claim about what the timer *is*
// is read back out of IndexedDB, and the running one is checked across a real
// page reload, which is the whole point of storing a deadline instead of a
// count.

import { MOD } from "./harness.mjs";

export const title = "apps";

const AWAY = { x: 860, y: 520 }; // bare canvas: clear of the note, and of the toolbar bottom-right

const face = (page) =>
  page.evaluate(`(() => {
    const el = document.querySelector('.timer-face');
    return el ? el.textContent.trim() : null;
  })()`);

const record = async (page) => (await page.stored()).filter((n) => !n.deleted)[0] || null;

const press = async (page, label) => {
  const at = await page.evaluate(`(() => {
    const b = [...document.querySelectorAll('.timer-btn')].find((x) => x.textContent === ${JSON.stringify(label)});
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!at) throw new Error(`no button labelled ${label}`);
  await page.click(at.x, at.y);
  await page.settle(150);
};

const rightClick = async (page, x, y) => {
  await page.cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1,
  });
  await page.settle(60);
  await page.cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1,
  });
  await page.settle(300);
};

const pick = async (page, label) => {
  await page.evaluate(
    `[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`
  );
  await page.settle(300);
};

const noteBox = (page) =>
  page.evaluate(`(() => {
    const r = document.querySelector('.note').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

export default async function run(page, s) {
  const { check } = s;

  /* ------------------------------------------------- the keyword converts */

  await page.click(600, 340, 2);
  await page.waitFor(`document.activeElement && document.activeElement.isContentEditable`);
  await page.type("[timer]");
  await page.click(AWAY.x, AWAY.y); // leaving the note is what reads the keyword
  await page.settle(400);

  check("a note typed [timer] into becomes one",
    await page.evaluate(`!!document.querySelector('.note-body.is-app .app-timer')`));
  check("it starts at five minutes", (await face(page)) === "05:00", await face(page));

  let stored = await record(page);
  check("the record says which app", stored && stored.app === "timer", JSON.stringify(stored && stored.app));
  check("the keyword is not left behind as text", stored && !stored.html, JSON.stringify(stored && stored.html));
  check("the state is on the note itself", !!(stored && stored.state && stored.state.ms === 300000),
    JSON.stringify(stored && stored.state));

  /* ------------------------------------------------------------ adjusting */

  await press(page, "+1m");
  check("+1m adds a minute", (await face(page)) === "06:00", await face(page));
  await press(page, "−1m");
  await press(page, "+5m");
  check("the adjustments add up", (await face(page)) === "10:00", await face(page));

  /* -------------------------------------------------------------- running */

  await press(page, "Start");
  stored = await record(page);
  check("starting stores a deadline, not a countdown",
    !!(stored && stored.state.endsAt) && stored.state.left === null,
    JSON.stringify(stored && stored.state));

  await page.settle(1300);
  const ticking = await face(page);
  check("the face counts down", ticking !== "10:00" && ticking < "10:00", ticking);

  // The real test of a deadline: throw the page away and come back.
  await page.reload();
  await page.settle(300);
  const afterReload = await face(page);
  check("a running timer survives a reload", afterReload !== null && afterReload < ticking,
    `${ticking} -> ${afterReload}`);
  check("and it is still running",
    await page.evaluate(`!!document.querySelector('.app-timer.is-running')`));

  await press(page, "Pause");
  const paused = await face(page);
  stored = await record(page);
  check("pausing puts the clock back as a duration",
    stored.state.endsAt === null && stored.state.left > 0, JSON.stringify(stored.state));
  await page.settle(900);
  check("a paused timer stays where it was", (await face(page)) === paused, `${paused} -> ${await face(page)}`);

  await press(page, "Reset");
  check("reset goes back to what was set", (await face(page)) === "10:00", await face(page));

  /* ----------------------------------------------- an app is still a note */

  const before = await page.evaluate(`Math.round(parseFloat(document.querySelector('.note').style.left))`);
  const box = await noteBox(page);
  await page.drag(box.x, box.y - 24, 120, 60); // above the buttons: body, not a control
  await page.settle(300);
  const after = await page.evaluate(`Math.round(parseFloat(document.querySelector('.note').style.left))`);
  check("a timer drags like any other note", Math.abs(after - before - 120) < 6, `${before} -> ${after}`);

  check("and it is not swept away for having no words",
    await page.evaluate(`document.querySelectorAll('.note').length`) === 1);

  /* --------------------------------------------------------- turning back */

  const on = await noteBox(page);
  await rightClick(page, on.x, on.y - 24);
  await pick(page, "Turn back into a note");
  check("it can be turned back into a note",
    await page.evaluate(`!document.querySelector('.app-timer') && !!document.querySelector('.note')`));
  stored = await record(page);
  check("and the record forgets the app", !stored.app && !stored.state, JSON.stringify([stored.app, stored.state]));

  await page.key("z", "KeyZ", MOD.meta);
  await page.settle(350);
  check("undo brings the timer back",
    await page.evaluate(`!!document.querySelector('.app-timer')`));
  stored = await record(page);
  check("with the time it was showing", stored.state && stored.state.ms === 600000,
    JSON.stringify(stored.state));

  /* ------------------------------------------------------- slash commands */

  // "/" in a note lists the apps; picking one puts it down beside the note
  // and takes only the command back out of it.
  await page.click(AWAY.x, AWAY.y);
  await page.settle(200);
  const had = new Set((await page.stored()).filter((n) => !n.deleted).map((n) => n.id));
  await page.click(330, 380, 2);
  await page.typeKeys("buy milk ");
  const writing = await page.evaluate(`document.querySelector('.note.is-active').dataset.id`);
  const slash = () => page.evaluate(`(() => {
    const m = document.querySelector('.slash-menu');
    return m && !m.hidden ? [...m.querySelectorAll('.slash-item')].map((r) => r.textContent) : null;
  })()`);

  await page.typeKeys("/");
  await page.settle(200);
  let listed = await slash();
  check("typing / in a note lists the apps", !!listed && listed.some((t) => t.startsWith("Timer")), JSON.stringify(listed));

  await page.typeKeys("zz");
  await page.settle(150);
  check("and narrows away to nothing when nothing matches", (await slash()) === null, JSON.stringify(await slash()));
  await page.key("Backspace", "Backspace");
  await page.key("Backspace", "Backspace");
  await page.typeKeys("ti");
  await page.settle(150);
  listed = await slash();
  check("typing after it narrows the list", !!listed && listed.length >= 1 && listed[0].startsWith("Timer"),
    JSON.stringify(listed));

  await page.key("Escape", "Escape");
  await page.settle(150);
  check("Esc closes the list", (await slash()) === null);
  check("and leaves the note open",
    await page.evaluate(`document.querySelector('.note.is-active')?.dataset.id === ${JSON.stringify(writing)}`));

  // Once dismissed, that "/" is just text. Take it out and ask again.
  for (let i = 0; i < 3; i++) await page.key("Backspace", "Backspace");
  await page.typeKeys("/ti");
  await page.settle(150);
  check("a fresh / asks again", !!(await slash()), JSON.stringify(await slash()));
  await page.key("Enter", "Enter");
  await page.settle(400);

  const now = (await page.stored()).filter((n) => !n.deleted);
  const source = now.find((n) => n.id === writing);
  const fresh = now.filter((n) => !had.has(n.id) && n.id !== writing);
  const made = fresh.find((n) => n.app === "timer");
  check("picking one leaves the note's words, and only takes the command out",
    source && source.html === "<p>buy milk </p>" && !source.app, JSON.stringify(source && source.html));
  check("and puts a timer down beside it", fresh.length === 1 && !!made, JSON.stringify(fresh.map((n) => n.app)));
  check("to its right, top edges level",
    !!made && made.x >= source.x + source.width && made.y === source.y,
    made ? `${source.x}+${source.width} → ${made.x}, ${source.y} → ${made.y}` : "none");
  check("with the timer running in it",
    await page.evaluate(`!!document.querySelector('.note[data-id="${made && made.id}"] .app-timer')`));
  check("while the note you were in is still the one you are writing in",
    await page.evaluate(`document.activeElement.closest('.note')?.dataset.id === ${JSON.stringify(writing)}`));

  // A slash inside a word is just a slash.
  await page.typeKeys("and/or");
  await page.settle(150);
  check("a slash inside a word opens nothing", (await slash()) === null);
}
