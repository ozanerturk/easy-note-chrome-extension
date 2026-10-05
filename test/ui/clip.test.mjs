// Screen clipper — the drag gesture and the note it produces.
//
// The overlay is normally injected into whatever page the user is on. Here it
// is run inside the new tab page instead: it is an extension page, so it has
// the chrome.runtime the overlay talks through and the database the clip lands
// in, and it is the only target the harness can drive real input at. What is
// under the overlay makes no difference to it — it never reads the page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOD } from "./harness.mjs";

export const title = "clip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OVERLAY = fs.readFileSync(path.join(root, "js/clip/overlay.js"), "utf8");

// Reaching into the overlay's shadow root, which is where all of its UI lives.
const ui = (selector, expression) =>
  `(() => {
     const host = document.getElementById('easynote-clip');
     if (!host) return null;
     const el = host.shadowRoot.querySelector(${JSON.stringify(selector)});
     return el ? (${expression}) : null;
   })()`;

const visible = (selector) => ui(selector, "getComputedStyle(el).display !== 'none'");

export default async function run(page, s) {
  // Every send is answered as a success and recorded, so the gesture can be
  // tested without a real captureVisibleTab — which needs a user gesture on the
  // toolbar icon that no automation harness can produce.
  const stub = async (reply = "{ ok: true }") =>
    page.evaluate(`(() => {
      window.__clip = { sent: [], hiddenWhenSent: null };
      chrome.runtime.sendMessage = (msg) => {
        window.__clip.sent.push(msg);
        // The overlay's own chrome must be off screen before the capture is
        // asked for, or it photographs itself — the ink is the one part of
        // it that is meant to be in the shot, so this checks the box's own
        // outline rather than the whole overlay.
        window.__clip.hiddenWhenSent =
          getComputedStyle(document.getElementById('easynote-clip').shadowRoot.querySelector('.sel')).display === 'none';
        return Promise.resolve(${reply});
      };
      return true;
    })()`);

  const inject = async () => {
    await page.evaluate(OVERLAY);
    await page.settle(120);
  };

  const gone = () => page.evaluate(`!document.getElementById('easynote-clip')`);

  /* ------------------------------------------------------------ the overlay */

  await stub();
  await inject();

  s.check("the overlay mounts on the page", await page.evaluate(`!!document.getElementById('easynote-clip')`));
  s.check("the cursor is a crosshair straight away", (await page.evaluate(ui(".layer", "getComputedStyle(el).cursor"))) === "crosshair");
  s.check("it says how to get out", (await page.evaluate(ui(".hint", "el.textContent.includes('Esc')"))) === true);
  s.check("no toolbar before there is anything to act on", (await page.evaluate(visible(".bar"))) === false);

  /* ------------------------------------------------------------- dragging */

  await page.mouse("mousePressed", 300, 220);
  await page.settle(40);
  await page.mouse("mouseMoved", 500, 340);
  await page.settle(80);

  s.check("the selection is drawn while dragging", (await page.evaluate(visible(".sel"))) === true);
  s.check(
    "the live readout gives the pixel size",
    (await page.evaluate(ui(".size", "el.textContent"))) === "200 × 120",
    await page.evaluate(ui(".size", "el.textContent"))
  );
  s.check("the hint gets out of the way once dragging starts", (await page.evaluate(visible(".hint"))) === false);
  s.check("still no toolbar mid-drag", (await page.evaluate(visible(".bar"))) === false);

  /* -------------------------------------------------- Esc, including mid-drag */

  await page.key("Escape", "Escape");
  await page.settle(120);
  s.check("Esc mid-drag removes the overlay", await gone());
  await page.mouse("mouseReleased", 500, 340, { buttons: 0 }); // let the pointer go

  /* ---------------------------------------------------- the post-drag toolbar */

  await inject();
  await page.drag(300, 220, 200, 120);
  await page.settle(120);

  s.check("the toolbar appears once the drag ends", (await page.evaluate(visible(".bar"))) === true);
  s.check("the readout goes away with the drag", (await page.evaluate(visible(".size"))) === false);
  s.check(
    "the toolbar is anchored to the selection, not to the screen",
    await page.evaluate(`(() => {
      const r = document.getElementById('easynote-clip').shadowRoot;
      const bar = r.querySelector('.bar').getBoundingClientRect();
      const sel = r.querySelector('.sel').getBoundingClientRect();
      return Math.abs(bar.right - sel.right) < 3 && bar.top >= sel.bottom;
    })()`)
  );

  /* ------------------------------------------------------- resizing a corner */

  const seHandle = await page.evaluate(`(() => {
    const r = document.getElementById('easynote-clip').shadowRoot.querySelector('.handle-se').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await page.drag(seHandle.x, seHandle.y, 60, 40);
  const resized = await page.evaluate(`(() => {
    const r = document.getElementById('easynote-clip').shadowRoot.querySelector('.sel').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  s.check(
    "dragging the bottom-right handle grows the box from that corner",
    resized.left === 300 && resized.top === 220 && resized.width === 260 && resized.height === 160,
    JSON.stringify(resized)
  );
  s.check("the toolbar comes back once it is let go", (await page.evaluate(visible(".bar"))) === true);

  // 350,250 now sits inside the resized box (300,220 to 560,380).
  await page.drag(350, 250, 40, 30);
  const untouched = await page.evaluate(`(() => {
    const r = document.getElementById('easynote-clip').shadowRoot.querySelector('.sel').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  s.check(
    "dragging inside the box does nothing — only a handle reshapes it",
    untouched.left === 300 && untouched.top === 220 && untouched.width === 260 && untouched.height === 160,
    JSON.stringify(untouched)
  );

  /* ---------------------------------------------------------------- cancel */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.cancel').click()`);
  await page.settle(120);
  s.check("Cancel leaves nothing behind", await gone());
  s.check(
    "and asks for no capture",
    !(await page.evaluate(`window.__clip.sent.some((m) => m.type === "easynote:clip")`))
  );

  /* ------------------------------------------------------------ a bare click */

  await inject();
  await page.click(400, 300);
  await page.settle(120);
  s.check("a click with no drag offers nothing to save", (await page.evaluate(visible(".bar"))) === false);
  s.check("and keeps the overlay up to try again", (await page.evaluate(`!!document.getElementById('easynote-clip')`)) === true);
  await page.evaluate(`window.__easynoteClip.cancel()`);

  /* ------------------------------------------------------------------ save */

  await stub();
  await inject();
  await page.drag(260, 180, 320, 200);
  await page.settle(120);
  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.save').click()`);
  await page.settle(300);

  const sent = await page.evaluate(`window.__clip.sent[0] || null`);
  s.check("Save asks the worker for a capture", !!sent && sent.type === "easynote:clip");
  s.check(
    "with the rectangle that was drawn",
    !!sent && sent.rect.x === 260 && sent.rect.y === 180 && sent.rect.width === 320 && sent.rect.height === 200,
    JSON.stringify(sent && sent.rect)
  );
  s.check("and the viewport it was measured against", !!sent && sent.viewport.width > 0 && sent.viewport.height > 0);
  s.check("and where it came from", !!sent && sent.url.endsWith("newtab.html"));
  s.check(
    "the overlay hides itself before the shot, so it is not in it",
    (await page.evaluate(`window.__clip.hiddenWhenSent`)) === true
  );
  s.check(
    "a toast confirms without taking the user anywhere",
    (await page.evaluate(ui(".toast", "el.textContent"))) === "Saved to Easy Note"
  );
  s.check(
    "and the page is the user's again while it fades",
    (await page.evaluate(`getComputedStyle(document.getElementById('easynote-clip')).pointerEvents`)) === "none"
  );
  await page.pause(2000); // the toast is up for as long as it takes to read
  s.check("and the overlay clears itself once the toast has been read", await gone());

  /* -------------------------------------------------------------- download */

  await page.evaluate(`(() => {
    window.__clip = { sent: [] };
    chrome.runtime.sendMessage = (msg) => {
      window.__clip.sent.push(msg);
      if (msg.type === "easynote:clip-download") return Promise.resolve({ ok: true, dataUrl: "data:image/png;base64,AAAA" });
      return Promise.resolve({ ok: true });
    };
    return true;
  })()`);
  await inject();
  await page.drag(260, 180, 320, 200);
  await page.settle(120);

  // The real save-dialog is not something a headless Chrome can be asked to
  // finish, so the anchor's own click is caught before it fires.
  await page.evaluate(`(() => {
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      HTMLAnchorElement.prototype.click = real;
      window.__downloaded = { href: this.href, download: this.download };
    };
    return true;
  })()`);
  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.download').click()`);
  await page.settle(300);

  const dlSent = await page.evaluate(`window.__clip.sent.find((m) => m.type === "easynote:clip-download") || null`);
  s.check("Download asks the worker for the region, nothing filed as a note", !!dlSent);
  const downloaded = await page.evaluate(`window.__downloaded || null`);
  s.check(
    "and builds a link to the image it got back",
    !!downloaded && downloaded.href === "data:image/png;base64,AAAA",
    JSON.stringify(downloaded)
  );
  s.check("named with an extension", !!downloaded && /\.\w+$/.test(downloaded.download), downloaded && downloaded.download);
  s.check(
    "a toast confirms, the same way Save's does",
    (await page.evaluate(ui(".toast", "el.textContent"))) === "Downloaded"
  );
  await page.pause(2000); // the toast is up for as long as it takes to read

  /* ------------------------------------------------------------- Enter saves */

  await stub();
  await inject();
  s.check("Enter does nothing before there is a box to save", await page.evaluate(`!!document.getElementById('easynote-clip')`));
  await page.key("Enter", "Enter");
  await page.settle(120);
  s.check("and the overlay is still up", await page.evaluate(`!!document.getElementById('easynote-clip')`));

  await page.drag(260, 180, 320, 200);
  await page.settle(120);
  await page.key("Enter", "Enter");
  await page.settle(300);
  s.check("Enter, once there is a box, saves it the same way the button does", !!(await page.evaluate(`window.__clip.sent[0]`)));
  await page.pause(2000); // the toast is up for as long as it takes to read

  /* ----------------------------------------------------- reading the region */

  await page.evaluate(`(() => {
    window.__clip = { sent: [] };
    chrome.runtime.sendMessage = (msg) => {
      window.__clip.sent.push(msg);
      if (msg.type === "easynote:ocr") return Promise.resolve({
        ok: true,
        text: "grabbed from the region",
        words: [
          { t: "grabbed", x: 0.1, y: 0.1, w: 0.3, h: 0.15 },
          { t: "region", x: 0.55, y: 0.1, w: 0.25, h: 0.15 },
        ],
      });
      return Promise.resolve({ ok: true });
    };
    return true;
  })()`);
  await inject();
  await page.drag(260, 180, 320, 200);
  await page.settle(120);
  s.check("no text to copy yet, right after the drag", (await page.evaluate(visible(".ocr"))) === false);
  await page.pause(700); // past OCR_DEBOUNCE_MS, so the debounced read has gone out and come back
  s.check(
    "asked to read the same region it would clip",
    (await page.evaluate(`window.__clip.sent.some((m) => m.type === "easynote:ocr" && m.rect.width === 320 && m.rect.height === 200)`))
  );
  s.check("and offers what it found to copy", (await page.evaluate(visible(".ocr"))) === true);
  s.check("the toolbar's Save and Cancel are still there beside it", (await page.evaluate(visible(".bar .save"))) === true);

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.ocr').click()`);
  await page.settle(120);
  const copiedText = await page.evaluate(`navigator.clipboard.readText()`);
  s.check("Copy text puts what was read on the clipboard", copiedText === "grabbed from the region", copiedText);

  s.check(
    "the words are laid over the picture too, same as the gallery's own",
    (await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelectorAll('.ocr-word').length`)) === 2
  );

  const wordPoint = await page.evaluate(`(() => {
    const span = document.getElementById('easynote-clip').shadowRoot.querySelector('.ocr-word');
    const r = span.getBoundingClientRect();
    return { x: r.left + 2, y: r.top + r.height / 2 };
  })()`);
  const boxBefore = await page.evaluate(`(() => {
    const r = document.getElementById('easynote-clip').shadowRoot.querySelector('.sel').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  await page.drag(wordPoint.x, wordPoint.y, 50, 0); // dragged across the word, as if selecting it
  const boxAfter = await page.evaluate(`(() => {
    const r = document.getElementById('easynote-clip').shadowRoot.querySelector('.sel').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  s.check(
    "dragging across a word selects it instead of starting a new clip",
    JSON.stringify(boxBefore) === JSON.stringify(boxAfter),
    JSON.stringify({ boxBefore, boxAfter })
  );
  const selected = (await page.evaluate(`window.getSelection().toString()`)).trim();
  s.check("and a real, native text selection is made", selected.length > 0, selected);

  // A press inside the box does nothing at all now, words or no words — only
  // starting a fresh selection outside it invalidates the reading, since
  // that is a different box, and its words have not been read yet.
  await page.drag(700, 480, 60, 40);
  s.check("a fresh selection elsewhere hides the stale Copy text button", (await page.evaluate(visible(".ocr"))) === false);
  await page.evaluate(`window.__easynoteClip.cancel()`);

  /* -------------------------------------------------------------- drawing */

  await stub();
  await inject();
  await page.drag(300, 220, 200, 120); // box: 300,220 to 500,340
  await page.settle(120);

  s.check("the tool strip appears alongside the box", (await page.evaluate(visible(".tools"))) === true);
  s.check("nothing to undo yet", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true);
  s.check("the pen is off by default, so the box still just drags", (await page.evaluate(ui(".tool-pen", "el.classList.contains('is-on')"))) === false);

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-pen').click()`);
  s.check("clicking Pen turns it on", (await page.evaluate(ui(".tool-pen", "el.classList.contains('is-on')"))) === true);
  s.check("and the canvas starts taking the pointer", (await page.evaluate(ui(".draw", "getComputedStyle(el).pointerEvents"))) === "auto");

  await page.drag(350, 250, 80, 40); // a stroke, well inside the box
  s.check("a stroke is something to undo", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === false);
  s.check("nothing to redo yet", (await page.evaluate(ui(".tool-redo", "el.disabled"))) === true);

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-undo').click()`);
  s.check("Undo takes the stroke back off", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true);
  s.check("and offers it back as a redo", (await page.evaluate(ui(".tool-redo", "el.disabled"))) === false);

  await page.key("z", "KeyZ", MOD.ctrl);
  s.check("Ctrl+Z is Undo, and does nothing with none left to take back", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true);

  await page.key("z", "KeyZ", MOD.ctrl | MOD.shift);
  s.check("Ctrl+Shift+Z redoes it", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === false);
  s.check("leaving nothing further to redo", (await page.evaluate(ui(".tool-redo", "el.disabled"))) === true);

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-undo').click()`);
  s.check("back to nothing to undo, ready for the next tool", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true);

  /* ---------------------------------------------------------------- arrow */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-arrow').click()`);
  s.check("picking Arrow puts Pen back down", (await page.evaluate(ui(".tool-pen", "el.classList.contains('is-on')"))) === false);
  s.check("and turns Arrow on", (await page.evaluate(ui(".tool-arrow", "el.classList.contains('is-on')"))) === true);

  await page.drag(330, 240, 100, 60); // an arrow, well inside the box
  s.check("an arrow is something to undo too", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === false);

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-undo').click()`);
  s.check("and Undo takes it back off the same way", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true);

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-arrow').click()`);
  s.check("clicking Arrow again puts it back down", (await page.evaluate(ui(".tool-arrow", "el.classList.contains('is-on')"))) === false);
  s.check("leaving no tool in hand", (await page.evaluate(ui(".draw", "getComputedStyle(el).pointerEvents"))) === "none");

  // Reads a pixel out of the ink canvas at a point given in viewport
  // coordinates — the box here sits at 300,220, so this is that point's
  // canvas-local position, scaled to the buffer's own device pixels.
  const canvasPixel = (vx, vy) =>
    page.evaluate(`(() => {
      const canvas = document.getElementById('easynote-clip').shadowRoot.querySelector('.draw');
      const dpr = window.devicePixelRatio || 1;
      const data = canvas.getContext('2d').getImageData(Math.round((${vx} - 300) * dpr), Math.round((${vy} - 220) * dpr), 1, 1).data;
      return { r: data[0], g: data[1], b: data[2], a: data[3] };
    })()`);

  /* ------------------------------------------------------------- highlight */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-highlight').click()`);
  s.check("picking Highlight turns it on", (await page.evaluate(ui(".tool-highlight", "el.classList.contains('is-on')"))) === true);

  await page.drag(340, 260, 80, 40); // a highlight box, well inside the selection
  s.check("a highlight box is something to undo", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === false);
  const highlighted = await canvasPixel(370, 275);
  s.check("laid down translucent, not as a solid fill", highlighted.a > 0 && highlighted.a < 255, JSON.stringify(highlighted));

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-undo').click()`);
  s.check("Undo takes it back off", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true);
  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-highlight').click()`);

  /* --------------------------------------------------------------- number */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-number').click()`);
  s.check("picking Number turns it on", (await page.evaluate(ui(".tool-number", "el.classList.contains('is-on')"))) === true);

  await page.click(340, 260);
  s.check("a click places a bubble, something to undo", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === false);
  const bubble = await canvasPixel(340, 260);
  s.check("filled in solid, not just outlined", bubble.a === 255, JSON.stringify(bubble));

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-undo').click()`);
  s.check("and Undo removes it", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true);
  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-number').click()`);

  /* ----------------------------------------------------------------- text */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-text').click()`);
  s.check("picking Text turns it on", (await page.evaluate(ui(".tool-text", "el.classList.contains('is-on')"))) === true);

  await page.click(340, 260);
  s.check(
    "a click places an editable line, focused straight away",
    (await page.evaluate(`(() => {
      const r = document.getElementById('easynote-clip').shadowRoot;
      const box = r.querySelector('.text-box[contenteditable]');
      return !!box && r.activeElement === box;
    })()`)) === true
  );

  await page.type("Hi");
  await page.key("Escape", "Escape"); // ends the line, the same as tabbing out of a field
  s.check("Escape commits it as a mark, something to undo", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === false);
  s.check(
    "left behind as plain text, in the note's own font, not still editable",
    (await page.evaluate(`(() => {
      const box = document.getElementById('easynote-clip').shadowRoot.querySelector('.text-box');
      return !!box && !box.hasAttribute('contenteditable') && box.textContent === "Hi";
    })()`)) === true
  );
  s.check(
    "and the overlay is still up — Escape ended the line, not the clip",
    await page.evaluate(`!!document.getElementById('easynote-clip')`)
  );

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-undo').click()`);
  s.check(
    "Undo removes it",
    (await page.evaluate(`!document.getElementById('easynote-clip').shadowRoot.querySelector('.text-box')`)) === true
  );

  // An empty line, let go without a word typed into it, leaves nothing behind.
  await page.click(340, 260);
  await page.key("Escape", "Escape");
  s.check(
    "an empty line is discarded rather than kept as a blank mark",
    (await page.evaluate(ui(".tool-undo", "el.disabled"))) === true
  );
  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-text').click()`);

  /* ----------------------------------------------------------------- blur */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-blur').click()`);
  s.check("picking Blur turns it on", (await page.evaluate(ui(".tool-blur", "el.classList.contains('is-on')"))) === true);

  await page.drag(340, 260, 60, 40); // a blur box, well inside the selection
  s.check("a blur box is something to undo", (await page.evaluate(ui(".tool-undo", "el.disabled"))) === false);
  s.check(
    "and a real element appears to blur the page under it",
    (await page.evaluate(`!!document.getElementById('easynote-clip').shadowRoot.querySelector('.blur-box')`)) === true
  );
  const blurFilter = await page.evaluate(
    `getComputedStyle(document.getElementById('easynote-clip').shadowRoot.querySelector('.blur-box')).backdropFilter`
  );
  s.check("blurred, by the brush's own size", blurFilter.includes("blur"), blurFilter);

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-undo').click()`);
  s.check(
    "Undo removes the blur element too",
    (await page.evaluate(`!document.getElementById('easynote-clip').shadowRoot.querySelector('.blur-box')`)) === true
  );
  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-blur').click()`);

  /* --------------------------------------------------------------- colour */

  s.check(
    "a colour to start with",
    (await page.evaluate(ui(".swatch", "getComputedStyle(el).backgroundColor"))) === "rgb(255, 59, 48)"
  );

  // Flameshot's own gesture: the right button goes down, the palette is
  // already up, and it is still held while the cursor moves onto a swatch.
  await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 280, button: "right", buttons: 2, clickCount: 1 });
  await page.settle(120);
  s.check("holding the right button down over the box brings down the colour picker", (await page.evaluate(visible(".palette"))) === true);

  const second = await page.evaluate(`(() => {
    const dots = [...document.getElementById('easynote-clip').shadowRoot.querySelectorAll('.palette button')];
    return dots[1] ? { x: dots[1].getBoundingClientRect().left + 2, y: dots[1].getBoundingClientRect().top + 2, color: getComputedStyle(dots[1]).backgroundColor } : null;
  })()`);
  await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: second.x, y: second.y, buttons: 2 });
  await page.settle(120);
  s.check(
    "dragged onto a swatch, that one shows as the one about to be picked",
    (await page.evaluate(`!!document.getElementById('easynote-clip').shadowRoot.querySelectorAll('.palette button')[1].classList.contains('is-hover')`)) === true
  );

  await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: second.x, y: second.y, button: "right", buttons: 0, clickCount: 1 });
  await page.settle(120);
  s.check("letting go over it closes the picker", (await page.evaluate(visible(".palette"))) === false);
  s.check(
    "and the tool strip shows the colour now in hand",
    (await page.evaluate(ui(".swatch", "getComputedStyle(el).backgroundColor"))) === second.color,
    second.color
  );

  /* ------------------------------------------------------------- brush size */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.tool-pen').click()`);
  await page.wheel(400, 280, -100); // scroll "up": bigger
  s.check(
    "scrolling over the box while a tool is out shows a preview of the next mark",
    (await page.evaluate(
      `getComputedStyle(document.getElementById('easynote-clip').shadowRoot.querySelector('.brush-preview')).display`
    )) === "block"
  );
  const previewInk = await page.evaluate(`(() => {
    const canvas = document.getElementById('easynote-clip').shadowRoot.querySelector('.brush-preview');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  })()`);
  s.check("drawn with a real rendering of the stroke, not left blank", previewInk === true);

  await page.evaluate(`window.__easynoteClip.cancel()`);

  /* --------------------------------------------------------- a failed clip */

  await stub(`{ ok: false, error: 'nope' }`);
  await inject();
  await page.drag(260, 180, 200, 150);
  await page.settle(120);
  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.save').click()`);
  await page.settle(300);
  s.check(
    "a failure says so rather than pretending it saved",
    (await page.evaluate(ui(".toast", "el.textContent"))).startsWith("Couldn't clip"),
    await page.evaluate(ui(".toast", "el.textContent"))
  );
  await page.pause(2000); // the toast is up for as long as it takes to read

  /* -------------------------------------------------------- the saved note */

  // saveClip normally runs in the service worker. It touches nothing but the
  // database, so it can be exercised here against the same one.
  await page.evaluate(`(async () => {
    const { saveClip } = await import('./js/clip/save.js');
    const canvas = new OffscreenCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c0ffee';
    ctx.fillRect(0, 0, 400, 300);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    await saveClip({ blob, width: 400, height: 300, scale: 2, url: 'https://example.com/a', title: 'Example page' });
    return true;
  })()`);
  await page.settle(400);

  const notes = (await page.stored("notes")).filter((n) => !n.deleted);
  const clip = notes.find((n) => n.html.includes("data-img-id"));
  const images = await page.stored("images");

  s.check("a clip becomes a note", !!clip);
  s.check("the image is stored as a blob, like a pasted one", images.length === 1);
  s.check(
    "the note points at that blob by id",
    !!clip && clip.html.includes(`data-img-id="${images[0] && images[0].id}"`)
  );
  s.check(
    "the source page is on the note as a link",
    !!clip && clip.html.includes('href="https://example.com/a"') && clip.html.includes("Example page"),
    clip && clip.html
  );
  s.check(
    "the capture lands in the tray, not on the board",
    !!clip && clip.pageId === "capture-tray"
  );
  s.check(
    "and the board it was captured from is untouched",
    notes.filter((n) => n.pageId !== "capture-tray").length === 0
  );
  s.check(
    "the note is sized to how big the region looked, not to its pixel count",
    // 400 device pixels at 2x is 200 CSS pixels wide, plus the body's padding.
    !!clip && clip.width === 224,
    clip && `${clip.width}x${clip.height}`
  );
  s.check(
    "and keeps the region's shape, ready for the board it ends up on",
    !!clip && Math.abs(clip.height - (200 * 0.75 + 76)) < 2,
    clip && String(clip.height)
  );

  // The tray page is minted on first use, not at install.
  const trayPage = (await page.stored("pages")).find((p) => p.id === "capture-tray");
  s.check("the tray page is created on the first capture", !!trayPage);
  s.check(
    "and is kept out of the sidebar",
    (await page.evaluate(`document.querySelectorAll('#page-tree [data-page-id="capture-tray"]').length`)) === 0
  );
}
