// Screen clipper — the overlay drawn on the page.
//
// Injected on demand by the service worker, never bundled into every page.
// A classic script, not a module: chrome.scripting.executeScript only injects
// classic scripts, so this file imports nothing and leaves nothing behind.
//
// The gesture is modelled on Flameshot: crosshair immediately, a live pixel
// readout while dragging, and a toolbar that only exists once there is a
// selection to act on.

(() => {
  // Injected a second time — the toolbar icon pressed again, or the shortcut
  // hit twice. The isolated world persists per frame, so the running overlay is
  // still here to take the second trigger as "never mind".
  if (window.__easynoteClip) {
    window.__easynoteClip.cancel();
    return;
  }

  const MIN_DRAG = 8; // below this the drag reads as a stray click, not a box
  const TOAST_MS = 1800;

  const host = document.createElement("div");
  host.id = "easynote-clip";
  // Fixed and above everything. A page can out-specify a class but it cannot
  // out-stack the maximum, and the shadow root keeps its CSS out entirely.
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;margin:0;padding:0;border:0;" +
    "background:transparent;pointer-events:auto;";
  // Open rather than closed: the isolation that matters is the page's CSS not
  // reaching in, which a shadow root gives either way, and a page that wanted
  // to interfere could simply remove the host element regardless.
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .layer {
        position: fixed; inset: 0; cursor: crosshair;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      /* The dim before a drag starts. Once there is a selection the hole in
         it does the dimming instead, so this one steps aside. */
      .dim { position: absolute; inset: 0; background: rgba(0,0,0,0.35); }
      .sel {
        position: absolute; display: none; background: transparent;
        outline: 1px dashed rgba(255,255,255,0.9);
        /* The cutout: everything outside the rectangle is this shadow. */
        box-shadow: 0 0 0 100vmax rgba(0,0,0,0.35);
      }
      .size, .hint, .toast {
        position: absolute; color: #fff; background: rgba(20,20,22,0.86);
        border-radius: 5px; padding: 4px 8px; white-space: nowrap;
        font-variant-numeric: tabular-nums; pointer-events: none;
      }
      .size { display: none; }
      .hint { left: 50%; top: 24px; transform: translateX(-50%); padding: 6px 12px; }
      .toast {
        display: none; left: 50%; bottom: 32px; transform: translateX(-50%);
        padding: 8px 14px; font-size: 13px;
      }
      .bar {
        position: absolute; display: none; gap: 4px; padding: 4px;
        background: rgba(20,20,22,0.92); border-radius: 7px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      }
      .bar button {
        font: inherit; font-size: 12px; color: #fff; background: transparent;
        border: 0; border-radius: 4px; padding: 5px 11px; cursor: pointer;
      }
      .bar button:hover { background: rgba(255,255,255,0.16); }
      .bar .save { background: #2f6df5; }
      .bar .save:hover { background: #4b81f7; }
      .gone { display: none !important; }
    </style>
    <div class="layer">
      <div class="dim"></div>
      <div class="sel"></div>
      <div class="size"></div>
      <div class="hint">Drag to clip &middot; Esc to cancel</div>
      <div class="bar"><button class="save">Save</button><button class="cancel">Cancel</button></div>
      <div class="toast"></div>
    </div>`;

  const layer = root.querySelector(".layer");
  const dim = root.querySelector(".dim");
  const sel = root.querySelector(".sel");
  const size = root.querySelector(".size");
  const hint = root.querySelector(".hint");
  const bar = root.querySelector(".bar");
  const toast = root.querySelector(".toast");

  // documentElement, not body: a page whose body is transformed or has its own
  // stacking context would otherwise drag the overlay along with it.
  document.documentElement.appendChild(host);

  let origin = null; // where the drag began, or null when not dragging
  let rect = null; // the committed selection, in viewport CSS pixels
  let saving = false;

  const clampX = (v) => Math.max(0, Math.min(window.innerWidth, v));
  const clampY = (v) => Math.max(0, Math.min(window.innerHeight, v));

  /* ------------------------------------------------------------ drawing */

  function boxFrom(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function drawSelection(box) {
    sel.style.display = "block";
    sel.style.left = `${box.x}px`;
    sel.style.top = `${box.y}px`;
    sel.style.width = `${box.width}px`;
    sel.style.height = `${box.height}px`;
    dim.classList.add("gone"); // the cutout dims from here on
  }

  function showSize(box, at) {
    size.style.display = "block";
    size.textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`;
    // Trailing the cursor by default, flipped in whenever that would put the
    // label off-screen — a readout you cannot read is worse than none.
    const w = size.offsetWidth;
    const h = size.offsetHeight;
    const left = at.x + 14 + w > window.innerWidth ? at.x - 14 - w : at.x + 14;
    const top = at.y + 16 + h > window.innerHeight ? at.y - 16 - h : at.y + 16;
    size.style.left = `${Math.max(2, left)}px`;
    size.style.top = `${Math.max(2, top)}px`;
  }

  // Anchored to the selection's bottom-right, tucked inside it when the
  // selection runs to the edge of the viewport.
  function showBar(box) {
    bar.style.display = "flex";
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    let top = box.y + box.height + 8;
    if (top + h > window.innerHeight) top = Math.max(2, box.y + box.height - h - 8);
    let left = box.x + box.width - w;
    left = Math.max(2, Math.min(window.innerWidth - w - 2, left));
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  function toIdle() {
    origin = null;
    rect = null;
    sel.style.display = "none";
    size.style.display = "none";
    bar.style.display = "none";
    dim.classList.remove("gone");
    hint.classList.remove("gone");
  }

  /* ------------------------------------------------------------ gestures */

  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || saving) return;
    if (e.target.closest(".bar")) return; // the toolbar has its own handlers
    e.preventDefault();
    bar.style.display = "none";
    hint.classList.add("gone");
    origin = { x: clampX(e.clientX), y: clampY(e.clientY) };
    rect = null;
    layer.setPointerCapture(e.pointerId);
  });

  layer.addEventListener("pointermove", (e) => {
    if (!origin) return;
    const at = { x: clampX(e.clientX), y: clampY(e.clientY) };
    const box = boxFrom(origin, at);
    drawSelection(box);
    showSize(box, at);
  });

  layer.addEventListener("pointerup", (e) => {
    if (!origin) return;
    const box = boxFrom(origin, { x: clampX(e.clientX), y: clampY(e.clientY) });
    origin = null;
    size.style.display = "none";

    // A click, or a box too small to hold anything. Fall back to the starting
    // state so the next drag just works, rather than offering to save nothing.
    if (box.width < MIN_DRAG || box.height < MIN_DRAG) {
      toIdle();
      return;
    }
    rect = box;
    showBar(box);
  });

  root.querySelector(".save").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    save();
  });
  root.querySelector(".cancel").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  });

  // Capture phase, so a page that swallows Escape for its own modal cannot
  // trap the user inside the overlay. Mid-drag counts.
  function onKey(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }
  window.addEventListener("keydown", onKey, true);

  // A resize invalidates a rectangle measured against the old viewport, and
  // scrolling moves the pixels out from under it. Either way, start over.
  const onReframe = () => {
    if (!saving) toIdle();
  };
  window.addEventListener("resize", onReframe, true);
  window.addEventListener("scroll", onReframe, true);

  /* -------------------------------------------------------------- saving */

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function save() {
    if (!rect || saving) return;
    saving = true;

    // captureVisibleTab photographs whatever is on screen, this overlay
    // included. Everything goes away first, and two frames are given to the
    // compositor before the shot — one is not always enough to have painted.
    host.style.display = "none";
    await nextFrame();

    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: "easynote:clip",
        rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        url: location.href,
        title: document.title,
      });
    } catch (err) {
      // The extension was reloaded or updated out from under the page.
      result = { ok: false, error: "Easy Note is not available on this page any more" };
    }

    host.style.display = "";
    layer.querySelectorAll(".dim, .sel, .bar, .size, .hint").forEach((el) => el.classList.add("gone"));
    layer.style.cursor = "default";
    // The host is what covers the viewport, so it is the one that has to stop
    // taking clicks — the toast has no business standing between the user and
    // the page while it fades.
    host.style.pointerEvents = "none";

    showToast(result && result.ok ? "Saved to Easy Note" : `Couldn't clip — ${(result && result.error) || "unknown error"}`);
  }

  function showToast(text) {
    toast.textContent = text;
    toast.style.display = "block";
    setTimeout(teardown, TOAST_MS);
  }

  function cancel() {
    if (saving) return;
    teardown();
  }

  function teardown() {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onReframe, true);
    window.removeEventListener("scroll", onReframe, true);
    host.remove();
    delete window.__easynoteClip;
  }

  window.__easynoteClip = { cancel };
})();
