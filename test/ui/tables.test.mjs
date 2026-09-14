// Tables: that one can be put in a note, that it takes the note's width and
// shares it out evenly, and that the controls for rows and columns are there
// on hover and nowhere else.
//
// The controls are drawn over the table rather than in it, so every press here
// goes through real mouse input at real coordinates — a synthetic click on a
// button that was never placed would pass while the thing on screen was in the
// wrong place entirely.

export const title = "tables";

const BAR = 12; // the thickness of the + strips, as js/table.js has it

const EXCEL = `<table border="1" width="480"><colgroup><col width="240"><col width="120">` +
  `<col width="120"></colgroup><tbody><tr><td style="width:240px">Item</td>` +
  `<td style="width:120px">Qty</td><td style="width:120px">Cost</td></tr>` +
  `<tr><td>Rope</td><td>2</td><td>14</td></tr></tbody></table>`;

export default async function run(page, s) {
  const { check } = s;

  const pageId = (await page.stored("pages"))[0].id;
  const at = (x, y) => ({ x, y, width: 460, height: 340, z: 1, pageId, color: "transparent",
    createdAt: 1, editedAt: 1, updatedAt: 1 });

  await page.seed("notes", [
    { id: "with-table", html: "<p>Kit list</p>", ...at(200, 120) },
    { id: "one-cell", html: `<table class="note-table"><tbody><tr><td><p>only</p></td></tr></tbody></table>`,
      ...at(760, 120) },
    // A table taller than the note it is in, so it has to be scrolled to be
    // read — and the controls have somewhere they must not go.
    { id: "too-tall", html: `<table class="note-table"><tbody>` +
      "<tr><td><p>one</p></td><td><p>1</p></td></tr>".repeat(8) + `</tbody></table>`,
      ...at(200, 560), height: 120 },
  ]);

  const open = async (id, into = 380) => {
    const box = await page.evaluate(`(() => {
      const r = document.querySelector('[data-id="${id}"]').getBoundingClientRect();
      return { x: r.x, y: r.y };
    })()`);
    // Past the end of the first line, so the caret lands at the end of it: a
    // table put in there is the last thing in the note, which is the case
    // where there is otherwise nowhere left to write.
    await page.click(box.x + into, box.y + 14);
    await page.settle();
  };

  /** The shape of the table in the open note, measured off the page. */
  const shape = () => page.evaluate(`(() => {
    const root = document.querySelector('.note.is-active .tiptap');
    const table = root.querySelector('table');
    if (!table) return null;
    const widths = [...table.rows[0].cells].map((c) => c.getBoundingClientRect().width);
    return {
      rows: table.rows.length,
      cols: table.rows[0].cells.length,
      headers: table.querySelectorAll('th').length,
      colgroups: table.querySelectorAll('colgroup').length,
      classes: table.className,
      spread: Math.max(...widths) - Math.min(...widths),
      width: table.getBoundingClientRect().width,
      room: root.getBoundingClientRect().width,
    };
  })()`);

  /** Every hover control that is currently on screen — they live off the note. */
  const controls = () => page.evaluate(`(() => {
    const shown = [...document.querySelectorAll('.table-controls .table-ctl')].filter((el) => !el.hidden);
    return shown.map((el) => {
      const r = el.getBoundingClientRect();
      return { kind: el.className.replace('table-ctl ', ''), title: el.title,
        x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  })()`);

  const press = async (kind) => {
    const found = (await controls()).find((c) => c.kind === kind);
    if (!found) throw new Error(`no ${kind} control on screen`);
    await page.click(found.x, found.y);
    await page.settle();
  };

  /** Hover the middle of one cell, the way a pointer would arrive at it. */
  const hover = async (row, col) => {
    const spot = await page.evaluate(`(() => {
      const t = document.querySelector('.note.is-active table');
      const r = t.rows[${row}].cells[${col}].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await page.move(spot.x, spot.y);
    await page.settle(100);
  };

  /* --------------------------------------------------------- inserting */

  await open("with-table");
  await page.evaluate(`document.querySelector('[data-id="with-table"] .note-btn-more').click()`);
  const items = await page.evaluate(`[...document.querySelectorAll('.ctx-item')].map((b) => b.textContent)`);
  check("the note's menu offers a table", items.includes("Table"), String(items));
  await page.evaluate(`[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === 'Table').click()`);
  await page.settle();

  let table = await shape();
  check("the menu puts a 3x3 table in the note", !!table && table.rows === 3 && table.cols === 3,
    JSON.stringify(table));
  check("with no header row to explain", table.headers === 0);
  check("it fills the note's width", Math.abs(table.width - table.room) < 2,
    `${table.width.toFixed(1)} of ${table.room.toFixed(1)}`);
  check("and the columns are even", table.spread < 1.5, `spread ${table.spread.toFixed(2)}px`);

  // A table can be the last thing in a note, and then there is nowhere left to
  // write: no line under it, only cells.
  const tail = await page.evaluate(`(() => {
    const last = document.querySelector('.note.is-active .tiptap').lastElementChild;
    return { tag: last.tagName, empty: !last.textContent.trim() };
  })()`);
  check("it leaves a line under it to go on writing on", tail.tag === "P" && tail.empty,
    JSON.stringify(tail));

  // The editor takes the caret back on a later frame, and on a busy machine
  // that is a lot later. Wait for the caret, not for a guess at the frame.
  await page
    .waitFor(`(() => {
      const at = window.getSelection().anchorNode;
      const cell = at && (at.nodeType === 1 ? at : at.parentElement).closest('td');
      return cell === document.querySelector('.note.is-active table td');
    })()`, { timeout: 3000 })
    .catch(() => {});
  await page.typeKeys("Rope");
  await page.settle();
  check("and the caret starts in the first cell",
    (await page.evaluate(`document.querySelector('.note.is-active table td').textContent`)) === "Rope");

  /* ---------------------------------------------------------- controls */

  check("a table at rest carries no controls", (await controls()).length === 0);

  await hover(1, 1); // a cell in the middle of the table
  check("a cell in the middle of a table has nothing around it",
    (await controls()).length === 0, JSON.stringify(await controls()));

  // The × live in the gutters a table is read from: the first column for a
  // row, the first row for a column.
  await hover(0, 0);
  const gutter = await controls();
  check("the first cell of a row and of a column offers to take them away",
    gutter.map((c) => c.kind).sort().join(",") === "is-col-x,is-row-x",
    gutter.map((c) => c.kind).join(","));
  check("and says which is which",
    gutter.find((c) => c.kind === "is-row-x").title === "Delete row" &&
    gutter.find((c) => c.kind === "is-col-x").title === "Delete column",
    JSON.stringify(gutter.map((c) => c.title)));

  // The + belongs where the new row or column would go, and nowhere else.
  await hover(2, 2); // the last row, and the last column
  const corner = await controls();
  check("the last row and the last column offer a +",
    corner.map((c) => c.kind).sort().join(",") === "is-col-plus,is-row-plus",
    corner.map((c) => c.kind).join(","));

  // Every control sits astride the edge it works on. Outside the table they
  // were at the mercy of the note's edge, and the pointer had to leave the
  // table to reach them — the + for a column could not be got at at all.
  const geometry = await page.evaluate(`(() => {
    const t = document.querySelector('.note.is-active table').getBoundingClientRect();
    const box = (name) => document.querySelector('.table-controls .' + name).getBoundingClientRect();
    const row = box('is-row-plus');
    const col = box('is-col-plus');
    return {
      rowAstride: row.top < t.bottom && row.bottom > t.bottom,
      colAstride: col.left < t.right && col.right > t.right,
      inside: col.right <= t.right + ${BAR} && row.bottom <= t.bottom + ${BAR},
      meet: row.left < col.right && col.left < row.right && row.top < col.bottom && col.top < row.bottom,
      under: { x: (t.left + t.right) / 2, y: t.bottom + 3 },
    };
  })()`);
  check("the + for a row sits astride the bottom edge", geometry.rowAstride, JSON.stringify(geometry));
  check("the + for a column astride the right one", geometry.colAstride, JSON.stringify(geometry));
  check("neither hangs off into the note", geometry.inside, JSON.stringify(geometry));
  check("and the two of them never meet", geometry.meet === false, JSON.stringify(geometry));

  // Reaching one means crossing a strip of note that is not a cell; letting go
  // of the table there used to take the controls away as you set off.
  await page.move(geometry.under.x, geometry.under.y);
  await page.settle(100);
  check("the + is still there when the pointer arrives on it",
    (await controls()).some((c) => c.kind === "is-row-plus"), JSON.stringify(await controls()));

  await page.move(60, 60); // off the note altogether
  await page.settle(100);
  check("but they all go when the pointer leaves", (await controls()).length === 0);

  /* ------------------------------------------------- rows and columns */

  await hover(2, 2);
  await press("is-row-plus");
  check("the + under the table adds a row", (await shape()).rows === 4, JSON.stringify(await shape()));

  // The press left the pointer on the +, and the row it would add is now the
  // one below the row that just arrived: pressing again adds another.
  await press("is-row-plus");
  check("and again, without chasing it", (await shape()).rows === 5, JSON.stringify(await shape()));

  await hover(4, 2);
  await press("is-col-plus");
  table = await shape();
  check("the + beside it adds a column", table.cols === 4, JSON.stringify(table));
  check("and a fourth column is still an even share", table.spread < 1.5,
    `spread ${table.spread.toFixed(2)}px`);
  check("the table is no wider for it", Math.abs(table.width - table.room) < 2,
    `${table.width.toFixed(1)} of ${table.room.toFixed(1)}`);

  await hover(2, 0); // the gutter, which is where the × for a row is
  await press("is-row-x");
  check("the × on a row deletes it", (await shape()).rows === 4, JSON.stringify(await shape()));

  await hover(0, 2); // and the top of the column, for a column
  await press("is-col-x");
  check("the × on a column deletes it", (await shape()).cols === 3, JSON.stringify(await shape()));

  /* ------------------------------------------------------- what we keep */

  await page.key("Escape", "Escape");
  await page.settle();
  const saved = (await page.stored()).find((n) => n.id === "with-table");
  check("the table is saved as a table", saved.html.includes('<table class="note-table">'),
    saved.html.slice(0, 120));
  check("with no widths written into it",
    !saved.html.includes("colgroup") && !saved.html.includes("width"), saved.html.slice(0, 200));

  await page.reload();
  await open("with-table");
  check("and it comes back the same shape after a reload",
    JSON.stringify(await shape().then((t) => [t.rows, t.cols])) === "[4,3]");

  /* ------------------------------------------------------------- paste */

  await page.evaluate(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', ${JSON.stringify(EXCEL)});
    dt.setData('text/plain', 'Item\\tQty\\tCost');
    document.querySelector('.note.is-active .tiptap')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await page.settle();

  const pasted = await page.evaluate(`(() => {
    const tables = [...document.querySelectorAll('.note.is-active table')];
    const t = tables.find((el) => el.textContent.includes('Rope'));
    if (!t) return null;
    const widths = [...t.rows[0].cells].map((c) => c.getBoundingClientRect().width);
    return { rows: t.rows.length, cols: t.rows[0].cells.length,
      colgroups: t.querySelectorAll('colgroup').length,
      sized: t.querySelectorAll('[width], [style*="width"]').length,
      spread: Math.max(...widths) - Math.min(...widths),
      width: t.getBoundingClientRect().width,
      room: t.closest('.tiptap').getBoundingClientRect().width };
  })()`);
  check("a table pasted from a spreadsheet arrives whole",
    !!pasted && pasted.rows === 2 && pasted.cols === 3, JSON.stringify(pasted));
  check("its own widths are left behind", pasted.colgroups === 0 && pasted.sized === 0,
    JSON.stringify(pasted));
  check("so it looks like one inserted here",
    Math.abs(pasted.width - pasted.room) < 2 && pasted.spread < 1.5, JSON.stringify(pasted));

  /* ------------------------------------------ a table taller than the note */

  await page.key("Escape", "Escape");
  await page.settle();
  await open("too-tall", 30);
  // Opening it put the caret at the end, which scrolled the note; hover a cell
  // that is actually on show rather than one counted from the top.
  const spot = await page.evaluate(`(() => {
    const note = document.querySelector('.note.is-active');
    const host = note.querySelector('.note-body').getBoundingClientRect();
    const cell = [...note.querySelectorAll('td')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.top > host.top + 2 && r.bottom < host.bottom - 2;
    });
    const r = cell.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await page.move(spot.x, spot.y);
  await page.settle(100);
  const penned = await page.evaluate(`(() => {
    const host = document.querySelector('.note.is-active .note-body').getBoundingClientRect();
    const shown = [...document.querySelectorAll('.table-controls .table-ctl')].filter((el) => !el.hidden);
    const out = shown.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left < host.left - 1 || r.top < host.top - 1 || r.right > host.right + 1 || r.bottom > host.bottom + 1;
    });
    return { shown: shown.length, out: out.map((el) => el.className) };
  })()`);
  check("a table taller than its note still has controls", penned.shown > 0, JSON.stringify(penned));
  check("and not one of them hangs outside the note", penned.out.length === 0, JSON.stringify(penned));

  /* ------------------------------------------------- the last row of all */

  await page.key("Escape", "Escape");
  await page.settle();
  await open("one-cell", 30); // into the one cell it has, not past the end of it
  await hover(0, 0);
  const last = await controls();
  check("the last row of a table offers to take the table",
    last.find((c) => c.kind === "is-row-x").title === "Delete table",
    JSON.stringify(last.map((c) => c.title)));
  await press("is-row-x");
  check("and does", (await page.evaluate(`!document.querySelector('.note.is-active table')`)) === true);

  await page.key("Escape", "Escape");
  await page.settle();
  const emptied = (await page.stored()).find((n) => n.id === "one-cell");
  check("leaving the note with no table in it", !emptied.html.includes("<table"), emptied.html);
}
