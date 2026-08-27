// The editor: that it can be typed in, and — the part that matters — that it
// gives back every note written before it existed.
//
// A schema-based editor silently drops what its schema cannot model, and it
// does it the moment a note is opened. These samples are the shapes actually
// on disk: markup from the v1 import, and markup from the contenteditable
// that v3 shipped with.

import { MOD } from "./harness.mjs";

export const title = "editor";

const V1 = `<h1>Heading one</h1><p>Body with <strong>bold</strong>, <em>italic</em>, ` +
  `<u>underlined</u> and <s>struck</s> text.</p><ul><li>first</li><li>second</li></ul>` +
  `<ol><li>only</li></ol><blockquote>quoted line</blockquote><pre>code()</pre>` +
  `<p><a href="https://example.com">a link</a></p>`;

const V3 = `<div class="t-title">A title</div><div>A plain line</div>` +
  `<div class="t-small">small print</div><div><a href="https://example.com" ` +
  `target="_blank" rel="noopener noreferrer">a link</a></div>`;

const WITH_IMAGE = `<p>before</p><img data-img-id="img-test-1"><p>after</p>`;

export default async function run(page, s) {
  const { check } = s;

  const pageId = (await page.stored("pages"))[0].id;
  const at = (x, y) => ({ x, y, width: 260, height: 170, z: 1, pageId, color: "transparent",
    createdAt: 1, editedAt: 1, updatedAt: 1 });

  await page.seed("notes", [
    { id: "sample-v1", html: V1, ...at(320, 140) },
    { id: "sample-v3", html: V3, ...at(320, 380) },
    { id: "sample-img", html: WITH_IMAGE, ...at(700, 140) },
  ]);
  check("the samples are on the board", (await page.evaluate(`document.querySelectorAll('.note').length`)) === 3);

  /* ---------------------------------------------------------- fidelity */

  const open = async (id) => {
    const box = await page.evaluate(`(() => {
      const r = document.querySelector('[data-id="${id}"]').getBoundingClientRect();
      return { x: r.x, y: r.y };
    })()`);
    await page.click(box.x + 30, box.y + 14); // into the first line
    await page.settle();
    return page.evaluate(`(() => {
      const n = document.querySelector('[data-id="${id}"]');
      const root = n.querySelector('.tiptap');
      if (!root) return null;
      const count = (sel) => root.querySelectorAll(sel).length;
      return {
        text: root.textContent.replace(/\\s+/g, ' ').trim(),
        h1: count('h1'), strong: count('strong'), em: count('em'), u: count('u'), strike: count('s'),
        bullets: count('ul:not([data-type]) li'), numbered: count('ol li'),
        quote: count('blockquote'), pre: count('pre'),
        links: [...root.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
        titles: count('.t-title'), smalls: count('.t-small'),
        images: [...root.querySelectorAll('img')].map((i) => i.getAttribute('data-img-id')),
      };
    })()`);
  };

  let doc = await open("sample-v1");
  check("the editor mounts on the note that was clicked", !!doc);
  check("v1 text comes through whole",
    doc.text === "Heading oneBody with bold, italic, underlined and struck text.firstsecondonlyquoted linecode()a link",
    doc.text);
  check("v1 headings survive", doc.h1 === 1);
  check("v1 emphasis survives", doc.strong === 1 && doc.em === 1 && doc.u === 1 && doc.strike === 1,
    JSON.stringify([doc.strong, doc.em, doc.u, doc.strike]));
  check("v1 lists survive", doc.bullets === 2 && doc.numbered === 1, `${doc.bullets} bullets, ${doc.numbered} numbered`);
  check("v1 quotes and code survive", doc.quote === 1 && doc.pre === 1);
  check("v1 links keep their href", JSON.stringify(doc.links) === '["https://example.com"]', JSON.stringify(doc.links));

  doc = await open("sample-v3");
  check("v3 text comes through whole", doc.text === "A titleA plain linesmall printa link", doc.text);
  check("the three text sizes survive", doc.titles === 1 && doc.smalls === 1, `${doc.titles} title, ${doc.smalls} small`);
  check("v3 links keep their href", JSON.stringify(doc.links) === '["https://example.com"]', JSON.stringify(doc.links));

  doc = await open("sample-img");
  check("images survive by id", JSON.stringify(doc.images) === '["img-test-1"]', JSON.stringify(doc.images));
  check("text around an image survives", doc.text === "beforeafter", doc.text);

  // ...and that an edit writes it all back, still without a blob url in it
  await page.typeKeys("!");
  await page.settle();
  const savedImage = (await page.stored()).find((n) => n.id === "sample-img");
  check("an edit saves the image by id, not by url",
    savedImage.html.includes('data-img-id="img-test-1"') && !savedImage.html.includes("blob:"),
    savedImage.html);

  const savedV1 = (await page.stored()).find((n) => n.id === "sample-v1");
  check("a note only looked at is left exactly as it was", savedV1.html === V1);

  /* ------------------------------------------------------------ typing */

  await page.key("Escape", "Escape");
  await page.click(900, 480, 2);
  await page.settle();
  await page.typeKeys("- milk\nbread\n\n");
  await page.typeKeys("1. first\n\n");
  await page.typeKeys("# a heading\n");
  await page.typeKeys("[] a task\n");
  await page.settle();

  const written = await page.evaluate(`(() => {
    const root = document.querySelector('.note.is-active .tiptap');
    return { bullets: root.querySelectorAll('ul:not([data-type="taskList"]) li').length,
      numbered: root.querySelectorAll('ol li').length,
      headings: root.querySelectorAll('h1').length,
      tasks: root.querySelectorAll('ul[data-type="taskList"] li').length,
      text: root.textContent };
  })()`);
  check('typing "- " starts a bullet list', written.bullets === 2, `${written.bullets} items`);
  check('typing "1. " starts a numbered list', written.numbered === 1, `${written.numbered} items`);
  check('typing "# " makes a heading', written.headings === 1);
  check('typing "[] " makes a checkbox', written.tasks >= 1, `${written.tasks} items`);

  // marks and undo
  await page.evaluate(`(() => {
    const root = document.querySelector('.note.is-active .tiptap');
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(root.querySelector('li'));
    sel.removeAllRanges();
    sel.addRange(range);
  })()`);
  await page.settle(150); // let the editor take the selection we just set
  await page.key("b", "KeyB", MOD.meta);
  await page.settle();
  check("⌘B bolds the selection",
    (await page.evaluate(`!!document.querySelector('.note.is-active .tiptap strong')`)) === true);
  await page.key("z", "KeyZ", MOD.meta);
  await page.settle();
  check("⌘Z takes it back off",
    (await page.evaluate(`!!document.querySelector('.note.is-active .tiptap strong')`)) === false);

  // A checklist has to come back as a checklist. The node view renders a
  // plainer <li> than the schema writes, so this only holds if what is saved
  // is the rendered markup rather than what happens to be in the DOM.
  await page.key("Escape", "Escape");
  await page.settle();
  const savedTasks = (await page.stored()).find((n) => (n.html || "").includes("taskList"));
  check("a checklist is saved as one", !!savedTasks && savedTasks.html.includes('data-type="taskItem"'),
    savedTasks && savedTasks.html.slice(0, 120));

  await page.cdp.send("Page.reload");
  await page.settle(1500);
  const reopened = await page.evaluate(`(() => {
    const n = [...document.querySelectorAll('.note')].find((el) => el.innerHTML.includes('taskList'));
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y };
  })()`);
  check("it is still there after a reload", !!reopened);
  await page.click(reopened.x + 30, reopened.y + 14);
  await page.settle();
  check("and reopens as a checklist, not a stray bullet",
    (await page.evaluate(`document.querySelectorAll('.note.is-active ul[data-type="taskList"] li').length`)) >= 1);
  check("with its checkbox, not a literal \"[]\"",
    (await page.evaluate(`!document.querySelector('.note.is-active .tiptap').textContent.includes('[]')`)) === true);

  // Crossing something off a list is not editing, so it must not need the
  // note opened first: the closed copy carries a real checkbox and the click
  // has only to be let through and written down.
  await page.key("Escape", "Escape");
  await page.settle();
  const closedBox = await page.evaluate(`(() => {
    const n = [...document.querySelectorAll('.note')].find((el) => el.innerHTML.includes('taskList'));
    const b = n.querySelector('input[type="checkbox"]');
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, at: Math.round(n.getBoundingClientRect().x),
      open: !!n.querySelector('.tiptap') };
  })()`);
  check("a closed note shows its checkboxes", closedBox.open === false);
  await page.click(closedBox.x, closedBox.y);
  await page.settle(400);
  const ticked = await page.evaluate(`(() => {
    const n = [...document.querySelectorAll('.note')].find((el) => el.innerHTML.includes('taskList'));
    return { checked: n.querySelector('input[type="checkbox"]').checked,
      opened: !!n.querySelector('.tiptap'), at: Math.round(n.getBoundingClientRect().x) };
  })()`);
  check("its box can be ticked without opening it", ticked.checked === true && ticked.opened === false,
    JSON.stringify(ticked));
  check("and ticking it does not move the note", ticked.at === closedBox.at);
  const tickSaved = (await page.stored()).find((n) => (n.html || "").includes("taskList"));
  check("the tick is written down", tickSaved.html.includes('data-checked="true"'));

  // ⌘K asks for a link and applies it to the selection. Open the note first —
  // ticking a box above left it active but unopened, which is the point of it.
  const intoText = await page.evaluate(`(() => {
    const n = [...document.querySelectorAll('.note')].find((el) => el.innerHTML.includes('taskList'));
    const p = n.querySelector('p');
    const r = p.getBoundingClientRect();
    return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 };
  })()`);
  await page.click(intoText.x, intoText.y);
  await page.settle();

  await page.evaluate(`(() => {
    const root = document.querySelector('.note.is-active .tiptap');
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(root.querySelector('p'));
    sel.removeAllRanges();
    sel.addRange(range);
  })()`);
  await page.settle(150);
  await page.key("k", "KeyK", MOD.meta);
  await page.settle(200);
  check("⌘K opens the link box", (await page.evaluate(`!!document.querySelector('.link-box input')`)) === true);
  await page.evaluate(`(() => {
    const input = document.querySelector('.link-box input');
    input.value = 'example.org';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await page.settle();
  check("and links the selection with it",
    (await page.evaluate(`[...document.querySelectorAll('.note.is-active a[href]')].map((a) => a.getAttribute('href'))`))
      .includes("https://example.org"));

  // autolink
  await page.evaluate(`(() => {
    const root = document.querySelector('.note.is-active .tiptap');
    root.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(root.lastElementChild);
    range.collapse(false);
    sel.addRange(range);
  })()`);
  await page.typeKeys(" example.com ");
  await page.settle();
  const linked = await page.evaluate(`[...document.querySelectorAll('.note.is-active .tiptap a[href]')].map((a) => a.getAttribute('href'))`);
  check("typing a bare address links it", linked.includes("https://example.com"), JSON.stringify(linked));
}
