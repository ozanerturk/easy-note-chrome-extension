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
  // Created by id rather than after a removeAll. This used to wipe the menu
  // first, which was fine while the clipper was the only thing in it — now
  // that floating notes have an item of their own, a removeAll here is a race
  // that can delete whichever half registered first. Creating the same id
  // twice is an error rather than a no-op, so it is answered and ignored.
  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: "Clip to Easy Note",
      contexts: ["page", "selection", "image", "link"],
    },
    () => void chrome.runtime.lastError
  );
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "easynote:ocr") return undefined;
  ocrRegion(msg, sender).then(
    (result) => sendResponse(result),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // the response is async
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "easynote:clip-download") return undefined;
  downloadRegion(msg, sender).then(
    (result) => sendResponse(result),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // the response is async
});

// The screenshot-and-crop the overlay's rectangle in CSS pixels down to the
// device-pixel region it names, shared by a real clip and an OCR preview of
// one — everything past this point is what tells the two apart.
async function captureCrop(rect, viewport, sender) {
  if (!sender.tab) return null;

  // One deliberate call per gesture. captureVisibleTab is rate-limited and a
  // retry loop here would spend that budget on the user's behalf; a failure is
  // reported instead, and the overlay is still up to try again.
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
  const shot = await createImageBitmap(await (await fetch(dataUrl)).blob());

  // The capture is in device pixels; the rectangle arrived in CSS pixels.
  // Deriving the ratio from the two widths rather than trusting the page's
  // devicePixelRatio keeps the crop honest under page zoom, and on a second
  // monitor whose scaling differs from the one the tab was opened on.
  const scale = shot.width / Math.max(1, viewport.width);
  const box = deviceRect(rect, scale, { width: shot.width, height: shot.height });
  if (!box) {
    shot.close();
    return null;
  }

  const canvas = new OffscreenCanvas(box.width, box.height);
  canvas.getContext("2d").drawImage(shot, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  shot.close();

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { blob, box, scale };
}

async function clip(msg, sender) {
  const cropped = await captureCrop(msg.rect, msg.viewport, sender);
  if (!cropped) return { ok: false, error: "nothing to clip" };
  const { blob, box, scale } = cropped;

  // Best-effort: a clip that could not reach the clipboard is still a clip
  // that was saved, so this never turns a working save into a failure.
  const copied = await copyImageToClipboard(blob).catch(() => false);
  await saveClip({
    blob,
    width: box.width,
    height: box.height,
    scale,
    url: msg.url,
    title: msg.title,
  });

  announce();
  return { ok: true, copied };
}

// A reading of the region the overlay currently has selected, asked for
// before the user has decided to keep anything — nothing here is saved, so a
// selection dragged past without ever being clipped never touches the
// database or the clipboard.
async function ocrRegion(msg, sender) {
  const cropped = await captureCrop(msg.rect, msg.viewport, sender);
  if (!cropped) return { ok: false, error: "nothing to read" };
  const dataUrl = await blobToDataUrl(cropped.blob);
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ target: "easynote-offscreen", type: "recognize-image", dataUrl });
  // `words` are fractions of the region's own size, same as the gallery's own
  // reading of a stored picture — so the overlay can lay a real, selectable
  // text layer over the image, not just a single Copy-everything button.
  return result && result.ok
    ? { ok: true, text: result.text || "", words: result.words || [] }
    : { ok: false, error: result && result.error };
}

// A plain export: the region as a file, nothing filed as a note and nothing
// put on the clipboard — Save and Download are two different answers to
// "what do I do with this", not one asking for both.
async function downloadRegion(msg, sender) {
  const cropped = await captureCrop(msg.rect, msg.viewport, sender);
  if (!cropped) return { ok: false, error: "nothing to clip" };
  const dataUrl = await blobToDataUrl(cropped.blob);
  return { ok: true, dataUrl };
}

/* --------------------------------------------------------- offscreen doc */

// A service worker has no document of its own to write to the system
// clipboard from, or to run OCR's worker in — so both borrow this one: a
// hidden page made on demand and left open rather than torn down after every
// use, since creating it is the slow part and clips come one gesture at a time.
async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD", "WORKERS"],
    justification: "Copy a clipped image to the clipboard and read text out of it",
  });
}

async function copyImageToClipboard(blob) {
  const dataUrl = await blobToDataUrl(blob);
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ target: "easynote-offscreen", type: "copy-image", dataUrl });
  return !!(result && result.ok);
}

// A service worker has no FileReader, and structured clone across
// chrome.runtime.sendMessage cannot carry a Blob — so it crosses as a data
// URL instead, built in chunks so a full-page screenshot does not overflow
// the call stack going through String.fromCharCode one byte at a time.
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${blob.type};base64,${btoa(binary)}`;
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
