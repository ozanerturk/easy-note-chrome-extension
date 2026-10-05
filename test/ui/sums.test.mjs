// Sums: type one at the end of a line and its answer waits after it, dimmed,
// until Tab or Enter makes it real or Esc sends it away.

export const title = "sums";

export default async function run(page, s) {
  const { check } = s;

  const ghost = () =>
    page.evaluate(`(() => {
      const g = document.querySelector('.note.is-active .sum-ghost');
      if (!g) return null;
      return { text: g.textContent, display: getComputedStyle(g).display,
        position: getComputedStyle(g).position, inLine: !!g.closest('p') };
    })()`);
  // The words in the note, without the ghost: it is on screen, but a widget is
  // not part of the document and must never be counted as if it were.
  const text = () => page.evaluate(`(() => {
    const body = document.querySelector('.note.is-active .note-body').cloneNode(true);
    body.querySelectorAll('.sum-ghost').forEach((g) => g.remove());
    return body.textContent;
  })()`);
  const saved = async () => {
    await page.settle(300);
    const id = await page.evaluate(`document.querySelector('.note.is-active').dataset.id`);
    return (await page.stored()).find((n) => n.id === id)?.html;
  };
  const fresh = async (x, y) => {
    await page.click(1000, 150);
    await page.settle(200);
    await page.click(x, y, 2);
    await page.settle(200);
  };

  /* ------------------------------------------------------------ showing */

  await fresh(400, 200);
  await page.typeKeys("120*0.15");
  await page.settle(150);
  let g = await ghost();
  check("a sum shows its answer after it", g && g.text === " = 18", JSON.stringify(g));
  check("inline in the line, not floating over it",
    g && g.display === "inline" && g.position === "static" && g.inLine, JSON.stringify(g));
  check("and it is not in the note", !(await text()).includes("="), await text());
  check("nor in what is saved", !((await saved()) || "").includes("="), await saved());

  // Where the ghost's text starts is where the answer goes, so taking it
  // must not move a thing.
  const at = await page.evaluate(`(() => {
    const r = document.querySelector('.note.is-active .sum-ghost').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  })()`);

  await page.key("Tab", "Tab");
  await page.settle(200);
  check("Tab makes it real", (await text()) === "120*0.15 = 18", await text());
  check("and the ghost is gone", (await ghost()) === null);
  check("saved as text", (await saved()) === "<p>120*0.15 = 18</p>", await saved());
  const landed = await page.evaluate(`(() => {
    const p = document.querySelector('.note.is-active .note-body p');
    const range = document.createRange();
    const t = p.firstChild;
    range.setStart(t, 8); range.setEnd(t, 9);
    const r = range.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  })()`);
  check("exactly where the ghost stood", Math.abs(landed.x - at.x) <= 1 && Math.abs(landed.y - at.y) <= 1,
    `${JSON.stringify(at)} → ${JSON.stringify(landed)}`);

  // Carrying on types after the answer, which is plain text now.
  await page.typeKeys(" ok");
  check("the caret lands after the answer", (await text()) === "120*0.15 = 18 ok", await text());

  /* ------------------------------------------------------------ Enter */

  await fresh(400, 380);
  await page.typeKeys("(45-12)/3");
  await page.settle(150);
  check("brackets and division", (await ghost())?.text === " = 11", JSON.stringify(await ghost()));
  await page.key("Enter", "Enter");
  await page.settle(200);
  const lines = await page.evaluate(`document.querySelectorAll('.note.is-active .note-body p').length`);
  check("Enter takes it too, instead of starting a new line",
    (await text()) === "(45-12)/3 = 11" && lines === 1, `${await text()} · ${lines} lines`);
  await page.key("Enter", "Enter");
  await page.settle(150);
  check("with no ghost, Enter is Enter again",
    (await page.evaluate(`document.querySelectorAll('.note.is-active .note-body p').length`)) === 2);

  /* --------------------------------------------------- changing your mind */

  await page.typeKeys("2+3");
  await page.settle(120);
  check("a new line gets its own", (await ghost())?.text === " = 5");
  await page.typeKeys("*4");
  await page.settle(120);
  check("typing on updates it", (await ghost())?.text === " = 14", JSON.stringify(await ghost()));
  await page.typeKeys("*");
  await page.settle(120);
  check("half a sum shows nothing", (await ghost()) === null);
  await page.key("Backspace", "Backspace");
  await page.settle(120);
  check("and it comes back when it is whole again", (await ghost())?.text === " = 14");

  await page.key("Escape", "Escape");
  await page.settle(150);
  check("Esc sends it away", (await ghost()) === null);
  check("without writing anything", (await text()).endsWith("2+3*4"), await text());
  check("and leaves the note open", await page.evaluate(`!!document.querySelector('.note.is-active')`));
  await page.typeKeys("+1");
  await page.settle(120);
  check("a changed sum is asked about again", (await ghost())?.text === " = 15", JSON.stringify(await ghost()));
  await page.typeKeys(" apples");
  await page.settle(120);
  check("words after it and it is gone", (await ghost()) === null);

  /* ------------------------------------------------------ not a sum */

  for (const [what, typed] of [
    ["a bare number", "42"],
    ["a date", "on 2024-01-05"],
    ["nonsense", "2+*3"],
    ["dividing by zero", "7/0"],
    ["a word with a sum stuck to it", "x+2*3"],
  ]) {
    await page.key("Enter", "Enter");
    await page.typeKeys(typed);
    await page.settle(120);
    check(`${what} shows nothing`, (await ghost()) === null, JSON.stringify(await ghost()));
  }

  // Tab with nothing showing is left to the note.
  await page.key("Enter", "Enter");
  await page.typeKeys("plain");
  const before = await text();
  await page.key("Tab", "Tab");
  await page.settle(120);
  check("Tab with no ghost inserts no answer", !(await text()).slice(before.length).includes("="), await text());

  /* -------------------------------------------------- the "/" list first */

  await fresh(400, 540);
  await page.typeKeys("/");
  await page.settle(150);
  const listOpen = await page.evaluate(`!!document.querySelector('.slash-menu:not([hidden])')`);
  check("the / list still opens", listOpen);
  check("with no ghost beside it", (await ghost()) === null);
  await page.key("Escape", "Escape");
}
