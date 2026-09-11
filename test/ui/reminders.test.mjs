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
        line: getComputedStyle(n.querySelector('.note-footer')).display };
    })()`);
  const menu = () =>
    page.evaluate(`[...document.querySelectorAll('.remind-item')].map((b) => b.textContent)`);
  // Two steps now: the note's own menu, then Remind me… inside it. The label
  // changes once a reminder is set, so match on either.
  const openMenu = async () => {
    await page.evaluate(`(() => {
      const n = document.querySelector('.note');
      // Down and up: a press left hanging arms a drag that the next real
      // mouse move would pick the note up with.
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      n.querySelector('.note-btn-more').click();
    })()`);
    await page.settle(220);
    await page.evaluate(`[...document.querySelectorAll('.ctx-item')]
      .find((b) => b.textContent.startsWith('Remind me') || b.textContent.startsWith('Change reminder')).click()`);
    await page.settle(220);
  };
  const stored = async () => (await page.stored()).find((n) => !n.deleted);
  const choose = (label) =>
    page.evaluate(`[...document.querySelectorAll('.remind-item')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);

  await page.click(600, 300, 2);
  await page.type("water the plants");
  await page.settle();

  // The footer's own button: the quick way in, without the ⋯ menu.
  const footerNow = () => page.evaluate(`(() => {
    const n = document.querySelector('.note');
    const add = n.querySelector('.note-remind-add');
    return { line: getComputedStyle(n.querySelector('.note-footer')).display,
      add: add ? getComputedStyle(add).display : null };
  })()`);
  let footer = await footerNow();
  check("the note you are in shows its footer", footer.line === "flex", JSON.stringify(footer));
  check("with a button to set a reminder", footer.add !== "none" && footer.add !== null, JSON.stringify(footer));
  const addAt = await page.evaluate(`(() => {
    const r = document.querySelector('.note-remind-add').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await page.click(addAt.x, addAt.y);
  await page.settle(220);
  check("which opens the reminder menu", (await menu()).includes("In 15 minutes"), (await menu()).join(" | "));
  await page.key("Escape", "Escape");
  await page.settle(150);

  await openMenu();
  let items = await menu();
  check("the menu offers the quick times", items.slice(0, 7).join(" | ") ===
    "Now | In 15 minutes | In an hour | This evening | Tomorrow | In 3 days | In a week", items.join(" | "));
  check("and a way to pick one", items.includes("Pick a time…"));
  check("with nothing to clear yet", !items.includes("Clear reminder"));

  const before = Date.now();
  await choose("In 15 minutes");
  await page.settle(300);

  let state = await noteState();
  check("setting one shows what it is waiting for", state.chip === "🔔 in 15m", state.chip);
  check("and it is not due yet", state.due === false && state.wiggling === "none");
  check("a note with a reminder keeps its footer showing", state.line === "flex", state.line);
  footer = await footerNow();
  check("and swaps the button for the chip", footer.add === "none", JSON.stringify(footer));

  let record = await stored();
  const minutes = Math.round((record.remindAt - before) / 60000);
  check("the time is written on the note", minutes === 15, `${minutes} minutes out`);
  check("setting a reminder is not an edit", record.editedAt < record.updatedAt,
    `edited ${record.editedAt}, updated ${record.updatedAt}`);

  // The service worker keeps one alarm for the next reminder, read from the
  // database rather than handed over by the tab.
  const alarm = () =>
    page.evaluate(`chrome.alarms.get('easynote-reminder').then((a) => (a ? a.scheduledTime : null))`);
  await page.waitFor(`chrome.alarms.get('easynote-reminder').then((a) => !!a)`);
  const wakes = await alarm();
  check("the worker sets an alarm for it", Math.abs(wakes - record.remindAt) < 1000,
    `${wakes} vs ${record.remindAt}`);

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
  await page.reload(); // back when the app has booted, not when a timer says so
  // The hop is a one-off animation the note runs on arrival, and `has-hopped`
  // is the note saying it has finished. Waiting for that rather than for a
  // stopwatch is what makes this check about the behaviour again.
  await page.waitFor(`!!document.querySelector('.note.has-hopped')`);

  state = await noteState();
  check("a note that came due while away hops on arrival",
    state.due === true && state.hopped === true, JSON.stringify(state));
  check("and then holds still", state.wiggling === "none", state.wiggling);
  check("and says so", state.chip === "🔔 due", state.chip);
  check("it shows the footer, so there is a way to stop it", state.line === "flex", state.line);

  // Nothing can be seen of the notification itself without the permission,
  // which no test can click through. What the worker wrote down can. Asking it
  // to look again answers once it has, so there is nothing to poll for.
  const announced = () =>
    page.stored("meta").then((rows) => (rows.find((r) => r.id === "notified") || {}).shown || {});
  const rescanned = () => page.evaluate(`chrome.runtime.sendMessage({ type: 'easynote:reminders' })`);
  const dueNote = await stored();
  const scan = await rescanned();
  check("the worker looks at it once it is due", scan && scan.ok === true, JSON.stringify(scan));
  // The test profile never says yes. Marking it announced now would mean the
  // first reminder set before Chrome's question is answered never notifies.
  check("but with no permission it is not marked announced", !(dueNote.id in (await announced())),
    JSON.stringify(await announced()));

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

  // With nothing to wait for, the footer is back to being there only when you
  // are: away from the note, and out of it, it goes.
  await page.move(1000, 150);
  await page.click(1000, 150);
  await page.settle(250);
  footer = await footerNow();
  check("an idle note without a reminder hides its footer", footer.line === "none", JSON.stringify(footer));
  const noteAt = await page.evaluate(`(() => {
    const r = document.querySelector('.note .note-body').getBoundingClientRect();
    return { x: r.x + 20, y: r.y + 10 };
  })()`);
  await page.move(noteAt.x, noteAt.y);
  await page.settle(120);
  check("and hovering brings it back", (await footerNow()).line === "flex");
  await rescanned();
  check("and the worker has nothing left to wake for", (await alarm()) === null);

  // Now is due the moment it is set, with nothing to wait for. (No hop: the
  // note whose menu you just used is the one you are in.)
  await openMenu();
  await choose("Now");
  await page.waitFor(`!!document.querySelector('.note.is-due')`, { timeout: 2000 });
  state = await noteState();
  check("a reminder for now is due at once", state.due === true && state.chip === "🔔 due", JSON.stringify(state));
  await page.evaluate(`document.querySelector('.note-remind').click()`);
  await page.settle(300);
  check("dismissed the same way", (await noteState()).hidden === true);

  /* ------------------------------------------------- pages and time */

  // A note that has come due on a page you are not looking at says so through
  // its page instead.
  await openMenu();
  await choose("In an hour");
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

  /* ------------------------------------------- a notification, clicked */

  // Clicking one opens a tab on newtab.html#note=<id>. Start from the other
  // page, so arriving on the note means having crossed over to it.
  const target = (await stored()).id;
  await page.evaluate(`[...document.querySelectorAll('[data-page-id]')]
    .find((r) => !r.classList.contains('is-current')).click()`);
  await page.settle(600);
  check("starting from a page without the note",
    (await page.evaluate(`document.querySelectorAll('.note').length`)) === 0);

  await page.evaluate(`location.hash = ${JSON.stringify(`note=${target}`)}`);
  await page.reload();
  const landed = await page.evaluate(`(() => {
    const el = document.querySelector('.note[data-id=${JSON.stringify(target)}]');
    return { there: !!el, selected: !!el && el.classList.contains('is-selected'), hash: location.hash };
  })()`);
  check("the tab opens on the note's page", landed.there, JSON.stringify(landed));
  check("with the note picked out", landed.selected, JSON.stringify(landed));
  check("and the address cleaned, so a reload stays put", landed.hash === "", landed.hash);
}
