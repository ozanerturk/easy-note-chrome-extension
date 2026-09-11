// Reminders, told to the system rather than only to a tab.
//
// The board works out what is due from the record every time it looks, and
// that stays the whole truth: a note is due once its time has passed, and
// stops being due when it is dismissed there. This half covers the time when
// no tab is looking. It keeps one alarm set for the next reminder, wakes on
// it, and puts up a notification for whatever has come due.
//
// It reads the database itself rather than being told times by the tabs. Two
// tabs each holding their own idea of the next reminder would take turns
// overwriting the one alarm; the database has only one idea.
//
// Notifications are an optional permission, asked for the first time a
// reminder is set. Asking in the manifest would have Chrome disable the
// extension on update until the new permission was accepted — a blank new tab
// for everyone, for the sake of a feature most of them had not reached for.

import { openOnce, getAll, getOne, put, NOTES, PAGES, META } from "../db.js";
import { planNotices, noticeText } from "./plan.js";

const ALARM = "easynote-reminder";
// Which reminders this device has already announced. In META, which does not
// sync: two devices each owe the user their own notification.
const SHOWN = "notified";
const PREFIX = "note:";

// An alarm, a tab and a browser starting up can all ask at once. One scan at a
// time, or two of them could both announce the same note.
let running = Promise.resolve();
function rescan() {
  running = running.catch(() => {}).then(scan);
  return running;
}

async function scan() {
  await openOnce();
  const record = await getOne(META, SHOWN);
  // Not granted: nothing to show, and the board still says so.
  const canShow = !!chrome.notifications;
  const plan = planNotices(await getAll(NOTES), record ? record.shown : null, Date.now(), { canShow });

  if (plan.next) await chrome.alarms.create(ALARM, { when: plan.next });
  else await chrome.alarms.clear(ALARM);

  await put(META, { id: SHOWN, shown: plan.shown });

  if (!canShow) return;
  plan.clear.forEach((id) => chrome.notifications.clear(PREFIX + id));
  if (!plan.show.length) return;

  const prefs = (await getOne(META, "prefs")) || {};
  const pages = new Map((await getAll(PAGES)).map((p) => [p.id, p]));
  plan.show.forEach((note) => {
    chrome.notifications.create(PREFIX + note.id, notice(note, pages.get(note.pageId), !!prefs.blurNotes));
  });
}

function notice(note, page, blurred) {
  const base = {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    // A reminder that slides away unread might as well not have been set. It
    // stays until it is clicked or closed.
    requireInteraction: true,
    priority: 2,
  };
  // The blur is there for a shared screen, which is exactly where a
  // notification would read the note out anyway.
  if (blurred) return { ...base, title: "A note is due", message: "Open Easy Note to see it." };

  const { title, body } = noticeText(note.html);
  return {
    ...base,
    title: title || "A note is due",
    message: body || (title ? "Reminder" : "Open Easy Note to see it."),
    ...(page && page.name ? { contextMessage: page.name } : {}),
  };
}

// Clicking one goes to the note. It does not dismiss the reminder: the note is
// still hopping on the board, and dismissing it there is the one way that is
// already known to mean "done".
async function open(notificationId) {
  if (!notificationId.startsWith(PREFIX)) return;
  chrome.notifications.clear(notificationId);
  const url = chrome.runtime.getURL(`newtab.html#note=${encodeURIComponent(notificationId.slice(PREFIX.length))}`);
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (err) {
    // Chrome still running with every window closed, as it does on a Mac.
    await chrome.windows.create({ url, focused: true });
  }
}

// The listener has to be added while the worker starts for Chrome to wake it
// for a click. Before the permission is granted there is nothing to add it to,
// so it is also added the moment it is.
let listening = false;
function listen() {
  if (listening || !chrome.notifications) return;
  listening = true;
  chrome.notifications.onClicked.addListener(open);
}
listen();
chrome.permissions.onAdded.addListener(() => {
  listen();
  rescan();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) rescan();
});

// Whatever came due while the browser was closed.
chrome.runtime.onStartup.addListener(() => rescan());
chrome.runtime.onInstalled.addListener(() => rescan());

// A tab changed the set of reminders: set, dismissed, deleted, synced in.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "easynote:reminders") return undefined;
  rescan().then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true;
});
