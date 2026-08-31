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
        // The overlay must be off screen before the capture is asked for, or
        // it photographs itself.
        window.__clip.hiddenWhenSent =
          document.getElementById('easynote-clip').style.display === 'none';
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

  /* ---------------------------------------------------------------- cancel */

  await page.evaluate(`document.getElementById('easynote-clip').shadowRoot.querySelector('.cancel').click()`);
  await page.settle(120);
  s.check("Cancel leaves nothing behind", await gone());
  s.check("and asks for no capture", (await page.evaluate(`window.__clip.sent.length`)) === 0);

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
  await page.settle(2000);
  s.check("and the overlay clears itself once the toast has been read", await gone());

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
  await page.settle(2000);

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
