// Screen clipper — the half that lives outside the page.
//
// Nothing here runs until the user asks for it: the worker wakes on a click, a
// shortcut or a context-menu pick, injects the overlay for that one tab, and
// goes back to sleep. The `activeTab` permission is granted by that same
// gesture and expires with it, which is why the extension still asks for no
// host access at all.

import { saveClip } from "./save.js";
import { deviceRect } from "./crop.js";

const OVERLAY = "js/clip/overlay.js";
const MENU_ID = "easynote-clip";
const BADGE_MS = 2500;

// Pages Chrome will not put a content script on. Injecting anyway fails with
// an opaque error a beat after the gesture, which reads as the extension
// having done nothing — so they are caught up front and answered instead.
const BLOCKED = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^chrome-untrusted:\/\//i,
  /^devtools:\/\//i,
  /^edge:\/\//i,
  /^about:/i,
  /^view-source:/i,
  /^https?:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/chromewebstore\.google\.com/i,
  // The built-in PDF viewer is a plugin document, not a DOM the overlay could
  // sit on top of. The extension is the wrong tool there; say so.
  /^[^?#]+\.pdf([?#]|$)/i,
];

const canInject = (url) => !!url && !BLOCKED.some((re) => re.test(url));

/* --------------------------------------------------------------- triggers */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Clip to Easy Note",
      contexts: ["page", "selection", "image", "link"],
    });
  });
});

chrome.action.onClicked.addListener((tab) => startCapture(tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "clip-region") startCapture(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) startCapture(tab);
});

async function startCapture(tab) {
  if (!tab || tab.id == null) return;
  await chrome.action.setBadgeText({ text: "" }); // clear whatever the last try left

  if (!canInject(tab.url)) {
    await flashBadge("—", "#8a8a8a", "Easy Note can't clip this page");
    return;
  }
  try {
    // Top frame only. An iframe's overlay would be trapped inside its own box
    // and could not draw a rectangle across the page the user is looking at.
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: [OVERLAY] });
  } catch (err) {
    await flashBadge("—", "#8a8a8a", "Easy Note can't clip this page");
  }
}

/* ---------------------------------------------------------------- capture */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "easynote:clip") return undefined;
  clip(msg, sender).then(
    (result) => sendResponse(result),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // the response is async
});

async function clip(msg, sender) {
  if (!sender.tab) return { ok: false, error: "no tab" };

  // One deliberate call per gesture. captureVisibleTab is rate-limited and a
  // retry loop here would spend that budget on the user's behalf; a failure is
  // reported instead, and the overlay is still up to try again.
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
  const shot = await createImageBitmap(await (await fetch(dataUrl)).blob());

  // The capture is in device pixels; the rectangle arrived in CSS pixels.
  // Deriving the ratio from the two widths rather than trusting the page's
  // devicePixelRatio keeps the crop honest under page zoom, and on a second
  // monitor whose scaling differs from the one the tab was opened on.
  const scale = shot.width / Math.max(1, msg.viewport.width);
  const box = deviceRect(msg.rect, scale, { width: shot.width, height: shot.height });
  if (!box) {
    shot.close();
    return { ok: false, error: "nothing to clip" };
  }

  const canvas = new OffscreenCanvas(box.width, box.height);
  canvas.getContext("2d").drawImage(shot, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  shot.close();

  const blob = await canvas.convertToBlob({ type: "image/png" });
  await saveClip({
    blob,
    width: box.width,
    height: box.height,
    scale,
    url: msg.url,
    title: msg.title,
  });

  announce();
  return { ok: true };
}

// A new tab already open elsewhere has its board rendered from a read that
// happened before this clip existed. Tell it so the note appears rather than
// waiting for a reload.
function announce() {
  chrome.runtime.sendMessage({ type: "easynote:clip-saved" }).catch(() => {});
}

/* --------------------------------------------------------------- feedback */

// The overlay shows its own toast, but a page that could not be injected into
// never gets one. The badge is the only surface left that costs no permission.
async function flashBadge(text, color, title) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  if (title) await chrome.action.setTitle({ title });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Easy Note" });
  }, BADGE_MS);
}
