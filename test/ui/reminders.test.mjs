// Reminders: setting one, being told about it, and making it stop.

export const title = "reminders";


// The note's actions live in its context menu now. Open it the way a person
// would — the ⋯ on the note's header — and pick by label.
const noteMenu = async (page, id) => {
  await page.evaluate(`document.querySelector('[data-id="${id}"] .note-btn-more').click()`);
  await page.settle(250);
};
const pick = async (page, label) => {
  await page.evaluate(
    `[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`
  );
  await page.settle(250);
};
const menuItem = (page, label) =>
  page.evaluate(
    `(() => { const b = [...document.querySelectorAll('.ctx-item')].find((x) => x.textContent === ${JSON.stringify(label)});
       return b ? { disabled: b.disabled } : null; })()`
  );

export default async function run(page, s) {
  const { check } = s;

  const noteState = () =>
    page.evaluate(`(() => {
      const n = document.querySelector('.note');
      const chip = n.querySelector('.note-remind');
      return { chip: chip.textContent, hidden: chip.hidden,
        due: n.classList.contains('is-due'),
        wiggling: getComputedStyle(n).animationName,
        hopped: n.classList.contains('has-hopped'),
        line: getComputedStyle(n.querySelector('.note-date')).display };
    })()`);
  const menu = () =>
    page.evaluate(`[...document.querySelectorAll('.remind-item')].map((b) => b.textContent)`);
  // Two steps now: the note's own menu, then Remind me… inside it. The label
  // changes once a reminder is set, so match on either.
  const openMenu = async () => {
    await page.evaluate(`(() => {
      const n = document.querySelector('.note');
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      n.querySelector('.note-btn-more').click();
    })()`);
    await page.settle(220);
    await page.evaluate(`[...document.querySelectorAll('.ctx-item')]
      .find((b) => b.textContent.startsWith('Remind me') || b.textContent.startsWith('Change reminder')).click()`);
    await page.settle(220);
  };
  const stored = async () => (await page.stored()).find((n) => !n.deleted);

  await page.click(600, 300, 2);
  await page.type("water the plants");
  await page.settle();

  await openMenu();
  let items = await menu();
  check("the menu offers the quick times", items.slice(0, 6).join(" | ") ===
    "In 15 minutes | In an hour | This evening | Tomorrow | In 3 days | In a week", items.join(" | "));
  check("and a way to pick one", items.includes("Pick a time…"));
  check("with nothing to clear yet", !items.includes("Clear reminder"));

  const before = Date.now();
  await page.evaluate(`document.querySelectorAll('.remind-item')[0].click()`); // in 15 minutes
  await page.settle(300);

  let state = await noteState();
  check("setting one shows what it is waiting for", state.chip === "🔔 in 15m", state.chip);
  check("and it is not due yet", state.due === false && state.wiggling === "none");
  check("the line stays off until the dates are on", state.line === "none", state.line);

  let record = await stored();
  const minutes = Math.round((record.remindAt - before) / 60000);
  check("the time is written on the note", minutes === 15, `${minutes} minutes out`);
  check("setting a reminder is not an edit", record.editedAt < record.updatedAt,
    `edited ${record.editedAt}, updated ${record.updatedAt}`);

  await openMenu();
  check("and now there is something to clear", (await menu()).includes("Clear reminder"));
  await page.key("Escape", "Escape");
  await page.settle(150);
  check("Esc closes the menu", (await page.evaluate(`!document.querySelector('.remind-menu')`)) === true);

  /* --------------------------------------------------- coming due */

  // Backdate it in the database and reload: being due is worked out from the
  // record, so it has to survive the tab that set it going away.
  await page.evaluate(`new Promise((resolve) => {
    const open = indexedDB.open('easynote');
    open.onsuccess = () => {
      const db = open.result;
      db.transaction('notes', 'readonly').objectStore('notes').getAll().onsuccess = (e) => {
        const note = e.target.result.find((n) => n.remindAt);
        note.remindAt = Date.now() - 60000;
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').put(note);
        tx.oncomplete = () => resolve(true);
      };
    };
  })`);
  await page.cdp.send("Page.reload");
  await page.settle(1600);

  state = await noteState();
  check("a note that came due while away hops on arrival",
    state.due === true && state.hopped === true, JSON.stringify(state));
  check("and then holds still", state.wiggling === "none", state.wiggling);
  check("and says so", state.chip === "🔔 due", state.chip);
  check("it shows the line even with the dates off, so there is a way to stop it",
    state.line === "flex", state.line);

  const chip = await page.evaluate(`(() => {
    const r = document.querySelector('.note-remind').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await page.click(chip.x, chip.y);
  await page.settle(300);
  state = await noteState();
  check("clicking it clears the alarm", state.due === false && state.wiggling === "none");
  check("and takes the reminder off the note", state.hidden === true);
  record = await stored();
  check("the record loses it too", !record.remindAt, String(record.remindAt));

  /* ------------------------------------------------- pages and time */

  // A note that has come due on a page you are not looking at says so through
  // its page instead.
  await openMenu();
  await page.evaluate(`document.querySelectorAll('.remind-item')[1].click()`);
  await page.settle(200);
  await page.evaluate(`new Promise((resolve) => {
    const open = indexedDB.open('easynote');
    open.onsuccess = () => {
      const db = open.result;
      db.transaction('notes', 'readonly').objectStore('notes').getAll().onsuccess = (e) => {
        const note = e.target.result.find((n) => n.remindAt);
        note.remindAt = Date.now() - 1000;
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').put(note);
        tx.oncomplete = () => resolve(true);
      };
    };
  })`);

  await page.evaluate(`document.getElementById('add-page').click()`);
  await page.settle(1400); // long enough for the single hop to have finished
  const away = await page.evaluate(`(() => {
    const marked = [...document.querySelectorAll('.page-row.has-due')];
    const badge = marked[0] && marked[0].querySelector('.page-badge');
    return { notesHere: document.querySelectorAll('.note').length, rows: marked.length,
      count: badge ? badge.textContent : null,
      badgeShown: badge ? getComputedStyle(badge).display !== 'none' : false,
      nameAnimation: marked[0] ? getComputedStyle(marked[0].querySelector('.page-name')).animationName : null };
  })()`);
  check("switching pages leaves the due note behind", away.notesHere === 0);
  check("its page is the one that says so", away.rows === 1, `${away.rows} rows marked`);
  check("with a badge counting what is waiting", away.badgeShown === true && away.count === "1", JSON.stringify(away));
  // The name used to hop. The badge says the same thing without moving, which
  // is easier to read and easier to ignore until you want it.
  check("and its name stays still", away.nameAnimation === "none", String(away.nameAnimation));

  // ...and going back finds the note itself wiggling again
  await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-page-id]')];
    rows.find((r) => !r.classList.contains('is-current')).click();
  })()`);
  await page.settle(1400);
  const back = await noteState();
  check("and coming back sets it hopping again", back.due === true && back.hopped === true,
    JSON.stringify(back));
  const home = await page.evaluate(`(() => {
    const row = document.querySelector('.page-row.is-current.has-due');
    if (!row) return null;
    const name = row.querySelector('.page-name');
    return { animation: getComputedStyle(name).animationName, colour: getComputedStyle(name).color };
  })()`);
  check("the page you are on marks itself without joining in", !!home && home.animation === "none",
    JSON.stringify(home));

  // a time picked by hand
  await page.evaluate(`document.querySelector('.note-remind').click()`);
  await page.settle(200);
  await openMenu();
  await page.evaluate(`[...document.querySelectorAll('.remind-item')].find((b) => b.textContent === 'Pick a time…').click()`);
  await page.settle(200);
  check("picking a time offers a field", (await page.evaluate(`!!document.querySelector('.remind-when')`)) === true);
  const picked = await page.evaluate(`(() => {
    const input = document.querySelector('.remind-when');
    const when = new Date(Date.now() + 26 * 60 * 60000);
    when.setSeconds(0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    input.value = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate())
      + 'T' + pad(when.getHours()) + ':' + pad(when.getMinutes());
    document.querySelector('.remind-item.is-primary').click();
    return when.getTime();
  })()`);
  await page.settle(300);
  record = await stored();
  check("and sets it", Math.abs(record.remindAt - picked) < 1000, `${record.remindAt} vs ${picked}`);
  check("reading it back in plain words", (await noteState()).chip === "🔔 tomorrow",
    (await noteState()).chip);
}
