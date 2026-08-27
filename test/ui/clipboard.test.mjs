// Pasting onto the canvas, Ctrl+P, and stepping notes across the grid.

import { MOD } from "./harness.mjs";

export const title = "clipboard and the grid";

// The shape a real page arrives in: wrappers around wrappers, an empty one
// where an ad used to be, and whitespace between every tag.
const MESSY_PAGE = `
  <div class="article">
    <div class="header"><div><h2>  A heading  </h2></div></div>
    <div class="body">
      <div><p>First paragraph with a <a href="https://example.com">link</a>.</p></div>
      <div class="ad"><span></span></div>
      <ul><li>one</li><li>two</li></ul>
    </div>
  </div>`;

export default async function run(page, s) {
  const { check } = s;

  await page.move(700, 380);
  await page.evaluate(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'pasted from the clipboard https://example.com');
    dt.setData('text/html', '<b>pasted</b> from the clipboard <a href="https://example.com">link</a>');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await page.settle();

  let state = await page.evaluate(`(() => {
    const n = document.querySelector('.note');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const b = n.querySelector('.note-body');
    return { text: b.textContent, links: b.querySelectorAll('a[href]').length, x: r.x, y: r.y };
  })()`);
  check("a paste on the canvas makes a note", !!state && state.text.includes("pasted from the clipboard"));
  check("it lands under the cursor", Math.abs(state.x - 700) < 40 && Math.abs(state.y - 380) < 40,
    `${Math.round(state.x)},${Math.round(state.y)}`);
  check("links survive the paste", state.links === 1);
  check("and it is saved", (await page.stored()).filter((n) => !n.deleted && n.html).length === 1);

  // Real pages come off the clipboard wrapped in layers of divs. Every one of
  // them used to arrive as an empty paragraph, so a pasted note opened under a
  // stack of blank lines before its first word.
  await page.key("Escape", "Escape");
  await page.settle();
  await page.move(430, 470);
  await page.evaluate(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', ${JSON.stringify(MESSY_PAGE)});
    dt.setData('text/plain', ${JSON.stringify("A heading\nFirst paragraph with a link.\none\ntwo")});
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await page.settle(500);
  const pasted = await page.evaluate(`(() => {
    const root = document.querySelector('.note.is-active .tiptap');
    return { blanks: [...root.children].filter((c) => !c.textContent.trim() && !c.querySelector('img')).length,
      first: root.firstElementChild.textContent, links: root.querySelectorAll('a[href]').length,
      items: root.querySelectorAll('li').length };
  })()`);
  check("a pasted page opens on its first line", pasted.blanks === 0 && pasted.first === "A heading",
    `${pasted.blanks} blank lines, starts "${pasted.first}"`);
  check("and keeps what was worth keeping", pasted.links === 1 && pasted.items === 2,
    `${pasted.links} links, ${pasted.items} list items`);

  // Ctrl+P with an unreadable clipboard still opens a note to paste into
  await page.evaluate(`navigator.clipboard.read = () => Promise.reject(new Error('denied'))`);
  await page.move(400, 250);
  await page.key("p", "KeyP", MOD.ctrl);
  await page.settle();
  let notes = await page.evaluate(`[...document.querySelectorAll('.note')].map((n) => {
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), active: n.classList.contains('is-active') };
  })`);
  check("Ctrl+P opens a note at the cursor",
    notes.some((n) => Math.abs(n.x - 400) < 40 && Math.abs(n.y - 250) < 40), JSON.stringify(notes));
  check("ready to type into", notes.some((n) => n.active));

  // ...and fills it when the clipboard can be read
  await page.evaluate(`navigator.clipboard.read = async () => [{
    types: ['text/plain'], getType: async () => new Blob(['from ctrl p'], { type: 'text/plain' }) }]`);
  await page.move(900, 250);
  await page.key("p", "KeyP", MOD.ctrl);
  await page.settle(500);
  check("Ctrl+P pastes the clipboard into the note",
    (await page.evaluate(`[...document.querySelectorAll('.note')].map((n) => n.querySelector('.note-body').textContent)`))
      .includes("from ctrl p"));

  // cmd/ctrl held during a drag steps across the grid
  await page.click(1050, 120);
  const from = await page.evaluate(`(() => {
    const r = document.querySelector('.note').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await page.mouse("mousePressed", from.x, from.y);
  for (let i = 1; i <= 8; i++) await page.mouse("mouseMoved", from.x + 13 * i, from.y + 7 * i, { modifiers: MOD.ctrl });
  await page.mouse("mouseReleased", from.x + 104, from.y + 56, { buttons: 0, modifiers: MOD.ctrl });
  await page.settle();

  const placed = (await page.stored()).filter((n) => !n.deleted);
  check("a ctrl-drag lands on the grid", placed.some((n) => n.x % 24 === 0 && n.y % 24 === 0),
    JSON.stringify(placed.map((n) => [n.x, n.y])));
}
