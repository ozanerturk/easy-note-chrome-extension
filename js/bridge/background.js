// The bridge to Claude — the half that lives in the service worker.
//
// Off until the user turns it on; while it is off no socket is opened. Every
// listener is registered at the top level, as a worker needs, and `sync()` on
// load means any wake-up finds the connection as the setting says it should be.

import { sync, setEnabled, watchdog, WATCHDOG } from "./socket.js";

chrome.runtime.onStartup.addListener(() => sync());
chrome.runtime.onInstalled.addListener(() => sync());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG) watchdog();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "easynote:bridge-set") return undefined;
  setEnabled(!!msg.enabled).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }),
  );
  return true; // the response is async
});

sync();
