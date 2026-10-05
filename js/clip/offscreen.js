// The two things a service worker cannot do for itself: touch the system
// clipboard, and run OCR's own worker. background.js opens this hidden
// document to do both on its behalf — see ensureOffscreenDocument there.

import { recognize } from "../ocr.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "easynote-offscreen") return undefined;
  if (msg.type === "copy-image") {
    copyImage(msg.dataUrl).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true; // the response is async
  }
  if (msg.type === "recognize-image") {
    recognizeImage(msg.dataUrl).then(
      (found) => sendResponse({ ok: true, text: found ? found.text : "", words: found ? found.words : [] }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }
  return undefined;
});

async function copyImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

async function recognizeImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return recognize(blob);
}
