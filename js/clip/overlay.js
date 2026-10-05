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
  // Long enough that adjusting the box a few times in a row asks for OCR
  // once, not on every pixel it moves.
  const OCR_DEBOUNCE_MS = 500;

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
      /* Where a box can be reshaped from — the corners, and nowhere else, so
         a click inside it starts a fresh one rather than nudging this one. */
      .handle {
        position: absolute; display: none; width: 12px; height: 12px; margin: -6px;
        border-radius: 50%; background: #fff; border: 2px solid #2f6df5;
        pointer-events: auto;
      }
      .handle-nw, .handle-se { cursor: nwse-resize; }
      .handle-ne, .handle-sw { cursor: nesw-resize; }
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
        font: inherit; color: #fff; background: transparent;
        border: 0; border-radius: 4px; cursor: pointer;
        width: 30px; height: 28px; display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .bar button:hover { background: rgba(255,255,255,0.16); }
      .bar .save { background: #2f6df5; }
      .bar .save:hover { background: #4b81f7; }
      .bar .ocr.just-copied { background: #34c759; }
      /* The ink itself. Sits over the cutout, under nothing — pointer-events
         only while a drawing tool is picked, so a box with no tool active
         still drags exactly as it always did. */
      .draw { position: absolute; pointer-events: none; touch-action: none; }
      .draw.is-active { cursor: crosshair; }
      .tools {
        position: absolute; display: none; align-items: center; gap: 4px; padding: 4px;
        background: rgba(20,20,22,0.92); border-radius: 7px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      }
      .tools button {
        font: inherit; color: #fff; background: transparent;
        border: 0; border-radius: 4px; cursor: pointer;
        width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .tools button:hover { background: rgba(255,255,255,0.16); }
      .tools button.is-on { background: #2f6df5; }
      .tools button:disabled { opacity: 0.35; cursor: default; background: transparent; }
      .swatch {
        width: 14px; height: 14px; border-radius: 50%; display: block;
        border: 1px solid rgba(255,255,255,0.6);
      }
      .palette {
        position: absolute; display: none; gap: 6px; padding: 6px;
        background: rgba(20,20,22,0.92); border-radius: 7px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      }
      .palette button {
        width: 20px; height: 20px; border-radius: 50%; padding: 0; cursor: pointer;
        border: 2px solid transparent;
      }
      .palette button.is-current { border-color: #fff; }
      .palette button.is-hover { border-color: #fff; transform: scale(1.2); }
      /* Plain characters rather than hand-built shapes — a hand-built shape
         this small reads as a smudge more often than as the thing it is
         meant to be; a real glyph is legible at a glance instead. */
      .icon { font-size: 15px; line-height: 1; }
      .icon-number, .icon-undo, .icon-redo { font-size: 16px; }
      /* A blurred box is a real background-filter, not ink — it has to sit
         over the actual page to have anything to blur. */
      .blur-box { position: absolute; pointer-events: none; }
      /* Real text, in the note's own font — set with a size and colour but
         otherwise unstyled, so it reads like something written, not a label. */
      .text-box {
        position: absolute; pointer-events: auto; cursor: text; outline: none;
        white-space: pre-wrap; word-break: break-word; line-height: 1.15;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .text-box[contenteditable] { outline: 1px dashed rgba(255,255,255,0.6); }
      /* Read off the picture itself, the way the gallery's own pictures are —
         invisible text sized and placed over the real words, there only to
         be selected. The container lets a click in the gaps through to the
         box beneath it; a word only exists where Tesseract found one. */
      .ocr-words { position: absolute; pointer-events: none; }
      .ocr-word {
        position: absolute; color: transparent; pointer-events: auto;
        white-space: pre; line-height: 1; cursor: text; transform-origin: left top;
      }
      .ocr-word::selection { background: rgba(77,143,224,0.5); }
      /* What the next mark would look like, sized and coloured for real —
         shown a moment after the brush, the tool or the colour changes. */
      .brush-preview {
        position: fixed; display: none; z-index: 1;
        background: rgba(20,20,22,0.92); border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      }
      .gone { display: none !important; }
    </style>
    <div class="layer">
      <div class="dim"></div>
      <div class="sel"></div>
      <div class="blurs"></div>
      <div class="texts"></div>
      <div class="ocr-words"></div>
      <canvas class="draw"></canvas>
      <div class="handle handle-nw"></div>
      <div class="handle handle-ne"></div>
      <div class="handle handle-sw"></div>
      <div class="handle handle-se"></div>
      <canvas class="brush-preview" width="72" height="72"></canvas>
      <div class="size"></div>
      <div class="hint">Drag to clip &middot; Esc to cancel</div>
      <div class="tools">
        <button class="tool-color" title="Colour"><span class="swatch"></span></button>
        <button class="tool-pen" title="Pen"><span class="icon icon-pen">&#9998;</span></button>
        <button class="tool-highlight" title="Highlight"><span class="icon icon-highlight">&#9648;</span></button>
        <button class="tool-arrow" title="Arrow"><span class="icon icon-arrow">&#8599;</span></button>
        <button class="tool-number" title="Number"><span class="icon icon-number">&#9312;</span></button>
        <button class="tool-text" title="Text"><span class="icon icon-text">A</span></button>
        <button class="tool-blur" title="Blur"><span class="icon icon-blur">&#9617;</span></button>
        <button class="tool-undo" title="Undo" disabled><span class="icon icon-undo">&#8630;</span></button>
        <button class="tool-redo" title="Redo" disabled><span class="icon icon-redo">&#8631;</span></button>
      </div>
      <div class="palette"></div>
      <div class="bar">
        <button class="ocr gone" title="Copy text"><span class="icon icon-copy">&#10697;</span></button>
        <button class="download" title="Download"><span class="icon icon-download">&#10515;</span></button>
        <button class="save" title="Save"><span class="icon icon-save">&#10003;</span></button>
        <button class="cancel" title="Cancel"><span class="icon icon-cancel">&#10005;</span></button>
      </div>
      <div class="toast"></div>
    </div>`;

  const layer = root.querySelector(".layer");
  const dim = root.querySelector(".dim");
  const sel = root.querySelector(".sel");
  const blursEl = root.querySelector(".blurs");
  const textsEl = root.querySelector(".texts");
  const ocrWordsEl = root.querySelector(".ocr-words");
  const drawCanvas = root.querySelector(".draw");
  const drawCtx = drawCanvas.getContext("2d");
  const previewCanvas = root.querySelector(".brush-preview");
  const previewCtx = previewCanvas.getContext("2d");
  const handles = {
    nw: root.querySelector(".handle-nw"),
    ne: root.querySelector(".handle-ne"),
    sw: root.querySelector(".handle-sw"),
    se: root.querySelector(".handle-se"),
  };
  const size = root.querySelector(".size");
  const hint = root.querySelector(".hint");
  const tools = root.querySelector(".tools");
  const penBtn = root.querySelector(".tool-pen");
  const highlightBtn = root.querySelector(".tool-highlight");
  const arrowBtn = root.querySelector(".tool-arrow");
  const numberBtn = root.querySelector(".tool-number");
  const textBtn = root.querySelector(".tool-text");
  const blurBtn = root.querySelector(".tool-blur");
  const undoBtn = root.querySelector(".tool-undo");
  const redoBtn = root.querySelector(".tool-redo");
  const colorBtn = root.querySelector(".tool-color");
  const swatch = root.querySelector(".swatch");
  const palette = root.querySelector(".palette");
  const bar = root.querySelector(".bar");
  const downloadBtn = root.querySelector(".download");
  const ocrBtn = root.querySelector(".ocr");
  const toast = root.querySelector(".toast");

  // documentElement, not body: a page whose body is transformed or has its own
  // stacking context would otherwise drag the overlay along with it.
  document.documentElement.appendChild(host);

  let origin = null; // where the drag began, or null when not dragging
  let rect = null; // the committed selection, in viewport CSS pixels
  let saving = false;

  let resizing = null; // { corner, fixed } while a handle is being dragged
  let destroyed = false;

  let ocrTimer = null;
  let ocrText = ""; // what Copy text would put on the clipboard, or "" to hide the button

  // The ink. `marks` is what is on the canvas — pen strokes, arrows, numbered
  // bubbles, text and blurred or highlighted boxes alike — and `redoStack` is
  // what Undo has taken back off it; a fresh mark empties it, same as any
  // other editor. `activeTool` is null (the box just sits there) or one of
  // the tool names below; only one at a time.
  const PALETTE = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#0a84ff", "#5e5ce6", "#ffffff", "#1c1c1e"];
  const MIN_BRUSH = 2;
  const MAX_BRUSH = 24;
  // Each tool remembers its own size rather than sharing one — a pen stroke
  // and a numbered bubble are not the same kind of "big" at all, and picking
  // one tool has never been a reason to forget what the last one was set to.
  const BRUSH_DEFAULTS = { pen: 8, highlight: 8, arrow: 6, number: 5, text: 20, blur: 8 };
  // The same stack a note itself is set in, so a Text annotation reads like
  // something written in Easy Note rather than a caption bolted onto a photo.
  const EASYNOTE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  let activeTool = null;
  let brushColor = PALETTE[0];
  let brushWidths = { ...BRUSH_DEFAULTS };
  let marks = [];
  let redoStack = [];
  let drawing = null; // the mark in progress: a pen stroke's points, or an arrow's two ends
  let brushFlashTimer = null;

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

  const inBox = (at, box) =>
    at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height;

  // Keeps the box's own size, only sliding it back on screen — a box dragged
  // toward an edge stops there rather than running off it.
  function clampBox(box) {
    const maxX = Math.max(0, window.innerWidth - box.width);
    const maxY = Math.max(0, window.innerHeight - box.height);
    return { ...box, x: Math.max(0, Math.min(maxX, box.x)), y: Math.max(0, Math.min(maxY, box.y)) };
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

  // Anchored above the selection's top-left, tucked below it when that would
  // run off the top of the screen — the mirror image of showBar, so the two
  // never compete for the same corner.
  function showTools(box) {
    tools.style.display = "flex";
    const h = tools.offsetHeight;
    const w = tools.offsetWidth;
    let top = box.y - h - 8;
    if (top < 2) top = Math.min(window.innerHeight - h - 2, box.y + 8);
    const left = Math.max(2, Math.min(window.innerWidth - w - 2, box.x));
    tools.style.left = `${left}px`;
    tools.style.top = `${Math.max(2, top)}px`;
  }

  // A handle at each corner of the box, for reshaping it — the only way to
  // change the box once it exists, now that picking it up no longer moves it.
  function positionHandles(box) {
    handles.nw.style.left = `${box.x}px`;
    handles.nw.style.top = `${box.y}px`;
    handles.ne.style.left = `${box.x + box.width}px`;
    handles.ne.style.top = `${box.y}px`;
    handles.sw.style.left = `${box.x}px`;
    handles.sw.style.top = `${box.y + box.height}px`;
    handles.se.style.left = `${box.x + box.width}px`;
    handles.se.style.top = `${box.y + box.height}px`;
  }

  function showHandles(box) {
    Object.values(handles).forEach((h) => (h.style.display = "block"));
    positionHandles(box);
  }

  function hideHandles() {
    Object.values(handles).forEach((h) => (h.style.display = "none"));
  }

  function toIdle() {
    origin = null;
    resizing = null;
    rect = null;
    sel.style.display = "none";
    size.style.display = "none";
    bar.style.display = "none";
    tools.style.display = "none";
    hideHandles();
    dim.classList.remove("gone");
    hint.classList.remove("gone");
    clearTimeout(ocrTimer);
    setOcrText("");
    resetInk();
  }

  /* ----------------------------------------------------------------- ink */

  // Sized to the box in device pixels so a mark stays crisp, then repainted
  // from `marks` — the buffer is new, so there is nothing to carry over by
  // any other means.
  function sizeCanvasTo(box) {
    const dpr = window.devicePixelRatio || 1;
    drawCanvas.style.left = `${box.x}px`;
    drawCanvas.style.top = `${box.y}px`;
    drawCanvas.style.width = `${box.width}px`;
    drawCanvas.style.height = `${box.height}px`;
    drawCanvas.width = Math.max(1, Math.round(box.width * dpr));
    drawCanvas.height = Math.max(1, Math.round(box.height * dpr));
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawMarks();
  }

  // A handle drag moves one corner and leaves the opposite one fixed, which
  // slides the canvas's own origin — so whatever is already drawn is nudged
  // by the same amount, and stays over the same pixels of the page rather
  // than sliding across the box that holds it. A blurred box is drawn over
  // the page directly, in the page's own coordinates, so it needs none of
  // this — it never moves just because the selection around it resized.
  function shiftMark(mark, dx, dy) {
    if (mark.type === "blur") return;
    const shiftPoint = (p) => {
      p.x += dx;
      p.y += dy;
    };
    if (mark.type === "arrow") {
      shiftPoint(mark.from);
      shiftPoint(mark.to);
    } else if (mark.type === "number" || mark.type === "text" || mark.type === "highlight") {
      shiftPoint(mark); // a point, or a box's own top-left — either way, x/y
    } else {
      mark.points.forEach(shiftPoint); // pen
    }
  }

  function shiftMarks(dx, dy) {
    marks.forEach((m) => shiftMark(m, dx, dy));
    redoStack.forEach((m) => shiftMark(m, dx, dy));
  }

  function resetInk() {
    marks = [];
    redoStack = [];
    drawing = null;
    setActiveTool(null);
    updateHistoryButtons();
    closePalette();
    discardTextEdit();
    blursEl.textContent = "";
    textsEl.textContent = "";
  }

  function redrawMarks() {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    let bubbles = 0;
    marks.forEach((mark) => paintMark(drawCtx, mark, mark.type === "number" ? ++bubbles : undefined));
    syncBlurBoxes();
    syncTextBoxes();
  }

  function paintMark(ctx, mark, bubbleNumber) {
    if (mark.type === "arrow") paintArrow(ctx, mark);
    else if (mark.type === "number") paintNumber(ctx, mark, bubbleNumber);
    else if (mark.type === "highlight") paintHighlight(ctx, mark);
    else if (mark.type === "blur" || mark.type === "text") return; // real elements, not canvas ink
    else paintFreehand(ctx, mark); // pen
  }

  function paintFreehand(ctx, stroke) {
    if (stroke.points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    stroke.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }

  // A rectangle of the brush's own colour, half see-through — a real
  // highlighter's own shape, dragged out the same way a blur box is.
  function paintHighlight(ctx, { x, y, width, height, color }) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }

  // A shaft the width of the brush, stopping short of the tip so its round
  // cap does not blunt the point, and a narrow head scaled to the brush
  // rather than a fixed size — a thick arrow with a thin arrowhead reads as
  // a mistake.
  function paintArrow(ctx, { from, to, color, width }) {
    if (dist(from, to) < 2) return;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = 8 + width * 3;
    const headAngle = Math.PI / 10;
    const backoff = headLen * 0.85;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x - backoff * Math.cos(angle), to.y - backoff * Math.sin(angle));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - headAngle), to.y - headLen * Math.sin(angle - headAngle));
    ctx.lineTo(to.x - headLen * Math.cos(angle + headAngle), to.y - headLen * Math.sin(angle + headAngle));
    ctx.closePath();
    ctx.fill();
  }

  // A filled bubble with the count of bubbles up to and including this one —
  // worked out fresh on every redraw rather than stored on the mark, so
  // undoing #3 leaves the next one placed as #3 again, not #4. Its own size
  // is stored on the mark, the same as everything else — the brush can move
  // on to a different size without reaching back to resize it.
  function paintNumber(ctx, { x, y, color, width }, n) {
    const r = Math.max(11, width * 3);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(r * 1.15)}px ${EASYNOTE_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), x, y + 1);
    ctx.restore();
  }

  function makeBlurEl(mark) {
    const el = document.createElement("div");
    el.className = "blur-box";
    el.style.left = `${mark.x}px`;
    el.style.top = `${mark.y}px`;
    el.style.width = `${mark.width}px`;
    el.style.height = `${mark.height}px`;
    el.style.backdropFilter = `blur(${mark.amount}px)`;
    el.style.webkitBackdropFilter = `blur(${mark.amount}px)`;
    return el;
  }

  // Rebuilt from `marks` every time rather than patched in place — there are
  // never more than a handful, and a rebuild can never drift from what undo
  // and redo say is actually there.
  function syncBlurBoxes() {
    blursEl.textContent = "";
    marks.filter((m) => m.type === "blur").forEach((m) => blursEl.appendChild(makeBlurEl(m)));
  }

  // The box being dragged out, shown as it grows — the real element is
  // among `marks` only once the drag is let go.
  let blurPreviewEl = null;
  function showBlurPreview(box) {
    if (!blurPreviewEl) {
      blurPreviewEl = makeBlurEl(box);
      blursEl.appendChild(blurPreviewEl);
    } else {
      Object.assign(blurPreviewEl.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
    }
  }

  function hideBlurPreview() {
    if (!blurPreviewEl) return;
    blurPreviewEl.remove();
    blurPreviewEl = null;
  }

  // Text lives as real elements, in canvas-local coordinates like a pen
  // stroke or a bubble — placed by adding the box's own top-left, since the
  // box is what `.text-box` sits inside without actually being a child of it.
  function makeTextEl(mark) {
    const el = document.createElement("div");
    el.className = "text-box";
    el.style.left = `${rect.x + mark.x}px`;
    el.style.top = `${rect.y + mark.y}px`;
    el.style.color = mark.color;
    el.style.fontSize = `${mark.width}px`;
    el.textContent = mark.text;
    return el;
  }

  function syncTextBoxes() {
    textsEl.textContent = "";
    marks.filter((m) => m.type === "text").forEach((m) => textsEl.appendChild(makeTextEl(m)));
  }

  // The one box being typed into, if any — a real contentEditable, focused
  // the moment it is placed. It becomes a mark on its own only once it is
  // let go with something in it; an empty one just goes away.
  let editingTextEl = null;
  const isEditingText = () => !!editingTextEl;

  function beginTextEdit(point) {
    // Fixed for this line the moment it is placed — scrolling the brush
    // bigger mid-sentence should not change a word already being typed.
    const color = brushColor;
    const width = brushWidths.text;

    const el = document.createElement("div");
    el.className = "text-box";
    el.contentEditable = "plaintext-only";
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true"; // not every engine has the plain mode
    el.style.left = `${rect.x + point.x}px`;
    el.style.top = `${rect.y + point.y}px`;
    el.style.color = color;
    el.style.fontSize = `${width}px`;
    editingTextEl = el;

    const commit = () => {
      if (editingTextEl !== el) return; // already settled once — blur can fire twice
      editingTextEl = null;
      const text = el.textContent.trim();
      el.remove();
      if (!text) return;
      redoStack = []; // a fresh mark starts a new future
      marks.push({ type: "text", x: point.x, y: point.y, color, width, text });
      redrawMarks();
      updateHistoryButtons();
    };

    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (e) => {
      // Never the overlay's own Escape, Enter or Ctrl+Z while a letter is
      // still being typed — onKey already steps aside for exactly this.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        el.blur();
      }
    });

    textsEl.appendChild(el);
    el.focus();
  }

  // A new selection, or the overlay closing, cuts a still-open line of text
  // short — there is nowhere left for it to keep being written.
  function discardTextEdit() {
    if (!editingTextEl) return;
    const el = editingTextEl;
    editingTextEl = null;
    el.remove();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = !marks.length;
    redoBtn.disabled = !redoStack.length;
  }

  function undo() {
    if (!marks.length) return;
    redoStack.push(marks.pop());
    redrawMarks();
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    marks.push(redoStack.pop());
    redrawMarks();
    updateHistoryButtons();
  }

  // null (the box just sits there) or a tool name — clicking the tool
  // already in hand puts it back down rather than needing a separate button
  // for "nothing".
  function setActiveTool(tool) {
    if (activeTool === "text") discardTextEdit();
    activeTool = tool;
    penBtn.classList.toggle("is-on", activeTool === "pen");
    highlightBtn.classList.toggle("is-on", activeTool === "highlight");
    arrowBtn.classList.toggle("is-on", activeTool === "arrow");
    numberBtn.classList.toggle("is-on", activeTool === "number");
    textBtn.classList.toggle("is-on", activeTool === "text");
    blurBtn.classList.toggle("is-on", activeTool === "blur");
    drawCanvas.classList.toggle("is-active", !!activeTool);
    // Off, a click on the box reaches through to the layer beneath, which
    // starts a fresh selection there — the canvas has to get out of the way
    // of it, not just stop reacting to it.
    drawCanvas.style.pointerEvents = activeTool ? "auto" : "none";
  }

  function setBrushColor(color) {
    brushColor = color;
    swatch.style.background = color;
  }
  setBrushColor(brushColor);

  function canvasPoint(e) {
    const r = drawCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const PREVIEW_SIZE = 72;

  // Shown for a moment wherever the brush, the tool or the colour just
  // changed — a real rendering of the next mark, at true size and colour,
  // not just a number to picture it from.
  function flashBrushPreview(x, y) {
    previewCanvas.style.left = `${Math.max(4, Math.min(window.innerWidth - PREVIEW_SIZE - 4, x - PREVIEW_SIZE / 2))}px`;
    previewCanvas.style.top = `${Math.max(4, Math.min(window.innerHeight - PREVIEW_SIZE - 4, y - PREVIEW_SIZE - 16))}px`;
    previewCanvas.style.display = "block";
    drawBrushPreview();
    clearTimeout(brushFlashTimer);
    brushFlashTimer = setTimeout(() => {
      previewCanvas.style.display = "none";
    }, 900);
  }

  function drawBrushPreview() {
    const mid = PREVIEW_SIZE / 2;
    const width = brushWidths[activeTool] ?? BRUSH_DEFAULTS.pen;
    previewCtx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    if (activeTool === "arrow") {
      paintArrow(previewCtx, { from: { x: 16, y: PREVIEW_SIZE - 16 }, to: { x: PREVIEW_SIZE - 16, y: 16 }, color: brushColor, width });
    } else if (activeTool === "number") {
      paintNumber(previewCtx, { x: mid, y: mid, color: brushColor, width }, 1);
    } else if (activeTool === "highlight") {
      const h = Math.min(PREVIEW_SIZE - 16, width * 3);
      paintHighlight(previewCtx, { x: 10, y: mid - h / 2, width: PREVIEW_SIZE - 20, height: h, color: brushColor });
    } else if (activeTool === "blur") {
      previewCtx.save();
      previewCtx.filter = `blur(${width}px)`;
      previewCtx.fillStyle = "#9a9a9a";
      previewCtx.fillRect(10, 10, PREVIEW_SIZE - 20, PREVIEW_SIZE - 20);
      previewCtx.restore();
    } else if (activeTool === "text") {
      previewCtx.save();
      previewCtx.fillStyle = brushColor;
      previewCtx.font = `${width}px ${EASYNOTE_FONT}`;
      previewCtx.textAlign = "center";
      previewCtx.textBaseline = "middle";
      previewCtx.fillText("Ag", mid, mid);
      previewCtx.restore();
    } else {
      paintFreehand(previewCtx, {
        points: [{ x: 16, y: PREVIEW_SIZE - 16 }, { x: PREVIEW_SIZE - 16, y: 16 }],
        color: brushColor,
        width,
      });
    }
    previewCtx.save();
    previewCtx.fillStyle = "#fff";
    previewCtx.font = `10px ${EASYNOTE_FONT}`;
    previewCtx.textAlign = "left";
    previewCtx.textBaseline = "top";
    previewCtx.fillText(`${width}px`, 4, 4);
    previewCtx.restore();
  }

  const viewportPoint = (e) => ({ x: e.clientX, y: e.clientY });

  // What a press starts, by tool: a freehand stroke's first point, an
  // arrow's two ends (both the same point until it moves), a bubble sitting
  // wherever it was pressed, or a highlight/blur box with nothing to it yet.
  function startDrawing(e) {
    if (activeTool === "arrow") {
      const p = canvasPoint(e);
      return { type: "arrow", color: brushColor, width: brushWidths.arrow, from: p, to: p };
    }
    if (activeTool === "number") {
      const p = canvasPoint(e);
      return { type: "number", color: brushColor, width: brushWidths.number, x: p.x, y: p.y };
    }
    if (activeTool === "highlight") {
      const p = canvasPoint(e);
      return { type: "highlight", origin: p, x: p.x, y: p.y, width: 0, height: 0, color: brushColor };
    }
    if (activeTool === "blur") {
      const p = viewportPoint(e);
      return { type: "blur", origin: p, x: p.x, y: p.y, width: 0, height: 0, amount: brushWidths.blur };
    }
    return { type: "pen", color: brushColor, width: brushWidths.pen, points: [canvasPoint(e)] };
  }

  drawCanvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !activeTool || saving) return;
    e.preventDefault();
    e.stopPropagation(); // not the box's own move gesture
    if (activeTool === "text") {
      beginTextEdit(canvasPoint(e));
      return;
    }
    drawing = startDrawing(e);
    redoStack = []; // a fresh mark starts a new future
    updateHistoryButtons();
    drawCanvas.setPointerCapture(e.pointerId);
  });

  drawCanvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    if (drawing.type === "arrow") {
      // The whole shape changes with the far end, not just grows from it —
      // nothing for it but to repaint everything under it too.
      drawing.to = canvasPoint(e);
      redrawMarks();
      paintMark(drawCtx, drawing);
      return;
    }
    if (drawing.type === "number") {
      // Held and dragged before letting go, to fine-tune where it lands.
      Object.assign(drawing, canvasPoint(e));
      redrawMarks();
      paintMark(drawCtx, drawing, marks.filter((m) => m.type === "number").length + 1);
      return;
    }
    if (drawing.type === "highlight") {
      Object.assign(drawing, boxFrom(drawing.origin, canvasPoint(e)));
      redrawMarks();
      paintMark(drawCtx, drawing);
      return;
    }
    if (drawing.type === "blur") {
      Object.assign(drawing, boxFrom(drawing.origin, viewportPoint(e)));
      showBlurPreview(drawing);
      return;
    }
    const p = canvasPoint(e);
    const last = drawing.points[drawing.points.length - 1];
    drawing.points.push(p);
    paintFreehand(drawCtx, { points: [last, p], color: drawing.color, width: drawing.width });
  });

  drawCanvas.addEventListener("pointerup", () => {
    if (!drawing) return;
    const valid =
      drawing.type === "arrow"
        ? dist(drawing.from, drawing.to) >= 2
        : drawing.type === "number"
          ? true
          : drawing.type === "highlight" || drawing.type === "blur"
            ? drawing.width >= MIN_DRAG && drawing.height >= MIN_DRAG
            : drawing.points.length > 1;
    if (drawing.type === "blur") hideBlurPreview();
    if (valid) {
      delete drawing.origin;
      marks.push(drawing);
      redrawMarks(); // a bubble's own number, and a blur/highlight box's element, come from here
    } else {
      redrawMarks(); // the false start's live preview does not get to stay
    }
    drawing = null;
    updateHistoryButtons();
  });

  // Scaling the brush is a hover gesture, not a drawing one — only while a
  // tool is in hand, so the page still scrolls normally otherwise.
  //
  // A trackpad reports a whole run of small wheel events for one swipe of a
  // finger, where a real mouse wheel reports one large one per notch — so a
  // step is taken only once enough of either has piled up, rather than on
  // every event, which is what made a light trackpad swipe send the size
  // flying. WHEEL_STEP is chosen to still be one notch of a mouse wheel.
  const WHEEL_STEP = 60;
  let wheelAccum = 0;
  drawCanvas.addEventListener(
    "wheel",
    (e) => {
      if (!activeTool) return;
      e.preventDefault();
      e.stopPropagation();
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < WHEEL_STEP) return;
      const step = wheelAccum < 0 ? 1 : -1;
      wheelAccum = 0;
      brushWidths[activeTool] = Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, brushWidths[activeTool] + step));
      flashBrushPreview(e.clientX, e.clientY);
    },
    { passive: false }
  );

  function wireTool(button, tool) {
    button.addEventListener("pointerdown", (e) => e.stopPropagation());
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const turningOn = activeTool !== tool;
      setActiveTool(turningOn ? tool : null);
      if (turningOn) {
        const r = button.getBoundingClientRect();
        flashBrushPreview(r.left + r.width / 2, r.top);
      }
    });
  }
  wireTool(penBtn, "pen");
  wireTool(highlightBtn, "highlight");
  wireTool(arrowBtn, "arrow");
  wireTool(numberBtn, "number");
  wireTool(textBtn, "text");
  wireTool(blurBtn, "blur");

  undoBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  undoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    undo();
  });

  redoBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  redoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    redo();
  });

  function openPalette(anchor) {
    palette.innerHTML = "";
    PALETTE.forEach((color) => {
      const dot = document.createElement("button");
      dot.style.background = color;
      dot.dataset.color = color;
      dot.classList.toggle("is-current", color === brushColor);
      dot.addEventListener("pointerdown", (e) => e.stopPropagation());
      dot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickColor(color, dot);
        closePalette();
      });
      palette.appendChild(dot);
    });
    palette.style.display = "flex";
    const w = palette.offsetWidth;
    const h = palette.offsetHeight;
    let top = anchor.bottom + 6;
    if (top + h > window.innerHeight) top = anchor.top - h - 6;
    const left = Math.max(2, Math.min(window.innerWidth - w - 2, anchor.left));
    palette.style.left = `${left}px`;
    palette.style.top = `${Math.max(2, top)}px`;
  }

  function closePalette() {
    palette.style.display = "none";
  }

  function pickColor(color, dot) {
    setBrushColor(color);
    if (activeTool) {
      const r = dot.getBoundingClientRect();
      flashBrushPreview(r.left + r.width / 2, r.top);
    }
  }

  // The dot under a given point, or null — used while a right-click drag is
  // still deciding which one it is over. elementFromPoint on the shadow root
  // itself, not the document, is what reaches inside it.
  function paletteDotAt(x, y) {
    const el = root.elementFromPoint(x, y);
    return el && el.closest ? el.closest(".palette button") : null;
  }

  colorBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  colorBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (palette.style.display === "flex") closePalette();
    else openPalette(colorBtn.getBoundingClientRect());
  });

  // Flameshot's own gesture: press the right button down and the palette is
  // already up, drag over the one wanted, let go anywhere on it and that is
  // the colour now — one motion, not a menu to click twice. Anywhere on the
  // box, regardless of which tool is in hand, since colour is a setting
  // every tool shares.
  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 2 || !rect || !inBox({ x: e.clientX, y: e.clientY }, rect)) return;
    // Right-clicking a word is the browser's own way to Copy a selection —
    // the colour picker has no business standing in front of it.
    if (e.target.closest(".ocr-word")) return;
    e.preventDefault();
    e.stopPropagation();
    openPalette({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
    highlightDot(paletteDotAt(e.clientX, e.clientY));

    const onMove = (m) => highlightDot(paletteDotAt(m.clientX, m.clientY));
    const onUp = (u) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      const dot = paletteDotAt(u.clientX, u.clientY);
      if (dot) pickColor(dot.dataset.color, dot);
      closePalette();
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
  });

  function highlightDot(dot) {
    [...palette.children].forEach((d) => d.classList.toggle("is-hover", d === dot));
  }

  // Only to stop the browser's own menu from following the button back up —
  // the picking itself already happened on the way down.
  layer.addEventListener("contextmenu", (e) => {
    if (!rect || !inBox({ x: e.clientX, y: e.clientY }, rect)) return;
    if (e.target.closest(".ocr-word")) return;
    e.preventDefault();
    e.stopPropagation();
  });

  /* ----------------------------------------------------------------- ocr */

  function setOcrText(text, words) {
    ocrText = text || "";
    ocrBtn.classList.toggle("gone", !ocrText);
    paintOcrWords(words || []);
  }

  // The same trick the gallery lays over one of its own pictures: an
  // invisible word sized and placed over the real one, there only to be
  // selected and copied — Ctrl+C, or the browser's own right-click Copy,
  // neither of which needs a button of ours.
  function paintOcrWords(words) {
    ocrWordsEl.textContent = "";
    if (!rect || !words.length) return;
    const spans = words.map((word) => {
      const span = document.createElement("span");
      span.className = "ocr-word";
      // The trailing space is what makes a selection dragged across several
      // words paste as a sentence rather than as onelongword.
      span.textContent = `${word.t} `;
      span.style.left = `${rect.x + word.x * rect.width}px`;
      span.style.top = `${rect.y + word.y * rect.height}px`;
      span.style.fontSize = `${Math.max(6, word.h * rect.height)}px`;
      ocrWordsEl.appendChild(span);
      return span;
    });
    // Widths, in one read pass and then one write pass: a typeface that is
    // not the one in the picture will not set a word to the same width, so
    // each is stretched to the box Tesseract found it in.
    const measured = spans.map((span) => {
      const text = span.firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, text.length - 1); // the word, without its trailing space
      return range.getBoundingClientRect().width;
    });
    spans.forEach((span, i) => {
      const wanted = words[i].w * rect.width;
      if (measured[i] > 0.5 && wanted > 0.5) span.style.transform = `scaleX(${wanted / measured[i]})`;
    });
  }

  // Debounced: the box the user is still nudging into place is not the box
  // worth reading yet. Called every time a drag or a move settles on one.
  function scheduleOcr() {
    clearTimeout(ocrTimer);
    setOcrText(""); // stale until the settled box has been read
    ocrTimer = setTimeout(runOcr, OCR_DEBOUNCE_MS);
  }

  // Nothing here hides the toolbar for the shot the way Save does — a
  // reading that happens on every settled box, unasked for, should not be
  // announced by the menu blinking off and back on every time.
  async function runOcr() {
    if (!rect || saving) return;
    const box = rect;

    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: "easynote:ocr",
        rect: box,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    } catch (err) {
      result = null;
    }

    // The box moved on, or the overlay is gone, while this was in flight.
    if (destroyed || rect !== box) return;
    setOcrText(result && result.ok ? result.text : "", result && result.ok ? result.words : []);
  }

  ocrBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  ocrBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!ocrText) return;
    navigator.clipboard.writeText(ocrText).then(() => {
      // A flash on the icon itself rather than swapping it for a word —
      // there is no text in this button to swap in the first place.
      ocrBtn.title = "Copied!";
      ocrBtn.classList.add("just-copied");
      setTimeout(() => {
        ocrBtn.title = "Copy text";
        ocrBtn.classList.remove("just-copied");
      }, 1200);
    });
  });

  /* ------------------------------------------------------------ gestures */

  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || saving) return;
    if (e.target.closest(".bar, .tools, .palette")) return; // their own handlers
    // A word read off the picture: left to the browser's own text selection,
    // untouched and with nothing of ours preventing its default action —
    // starting a fresh box here would end the selection before it began.
    if (e.target.closest(".ocr-word")) return;
    // Inside the box and not on a word is still the box — reading it, or
    // just steadying the mouse, should never cost the clip. Only a press
    // outside it says "start over"; reshaping it is what the handles are for.
    if (rect && inBox({ x: e.clientX, y: e.clientY }, rect)) return;

    // A click outside the existing box starts a fresh selection, replacing
    // it. A handle is the only way to reshape the one already there; it sits
    // above the layer and this never sees a press on one.
    e.preventDefault();
    bar.style.display = "none";
    tools.style.display = "none";
    hideHandles();
    closePalette();
    hint.classList.add("gone");
    clearTimeout(ocrTimer);
    setOcrText("");
    resetInk();
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
    sizeCanvasTo(box);
    showTools(box);
    showHandles(box);
    scheduleOcr();
  });

  // A handle drags the corner it sits on; the opposite corner holds still,
  // the same shape a resize has always had, on a note or anywhere else.
  function wireHandle(el, corner) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || saving) return;
      e.preventDefault();
      e.stopPropagation();
      const opposite = { nw: "se", ne: "sw", sw: "ne", se: "nw" }[corner];
      const fixed = {
        x: opposite.includes("w") ? rect.x : rect.x + rect.width,
        y: opposite.includes("n") ? rect.y : rect.y + rect.height,
      };
      resizing = { fixed };
      bar.style.display = "none";
      tools.style.display = "none";
      closePalette();
      clearTimeout(ocrTimer);
      setOcrText("");
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const at = { x: clampX(e.clientX), y: clampY(e.clientY) };
      const box = boxFrom(resizing.fixed, at);
      if (box.width < MIN_DRAG || box.height < MIN_DRAG) return; // never collapse to nothing
      const from = rect;
      rect = box;
      drawSelection(rect);
      positionHandles(rect);
      shiftMarks(from.x - rect.x, from.y - rect.y);
      sizeCanvasTo(rect);
    });

    el.addEventListener("pointerup", () => {
      if (!resizing) return;
      resizing = null;
      showBar(rect);
      showTools(rect);
      scheduleOcr();
    });
  }
  wireHandle(handles.nw, "nw");
  wireHandle(handles.ne, "ne");
  wireHandle(handles.sw, "sw");
  wireHandle(handles.se, "se");

  downloadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    downloadClip();
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

  // Capture phase, so a page that swallows Escape, Enter or Ctrl+Z for its
  // own modal cannot trap the user inside the overlay. Mid-drag, Escape
  // counts; the rest only once there is a committed box for them to mean
  // anything, and Ctrl+Z only past that if there is ink to take back.
  function onKey(e) {
    // A letter being typed into a text mark answers to its own keydown
    // handler, not to any of this — Escape there ends the line, not the clip.
    if (isEditingText()) return;
    if (e.key === "Enter" && rect && !saving) {
      e.preventDefault();
      e.stopPropagation();
      save();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
      if (!marks.length && !redoStack.length) return; // nothing here is ours to take
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
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

  // captureVisibleTab photographs whatever is on screen, this overlay
  // included — every part of it but the ink, which is content, not chrome,
  // and is meant to end up in the shot. Two frames are given to the
  // compositor before the shot — one is not always enough to have painted.
  async function hideChromeForCapture() {
    layer.querySelectorAll(".dim, .sel, .bar, .tools, .handle, .size, .hint, .brush-preview").forEach((el) => el.classList.add("gone"));
    await nextFrame();
  }

  function afterCapture() {
    layer.style.cursor = "default";
    drawCanvas.style.pointerEvents = "none";
    // The host is what covers the viewport, so it is the one that has to stop
    // taking clicks — the toast has no business standing between the user and
    // the page while it fades.
    host.style.pointerEvents = "none";
  }

  async function save() {
    if (!rect || saving) return;
    saving = true;
    clearTimeout(ocrTimer);
    closePalette();
    await hideChromeForCapture();

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

    afterCapture();
    showToast(
      result && result.ok
        ? result.copied
          ? "Saved to Easy Note — copied to your clipboard"
          : "Saved to Easy Note"
        : `Couldn't clip — ${(result && result.error) || "unknown error"}`
    );
  }

  // A copy for its own sake — a file on disk, nothing filed in Easy Note and
  // nothing on the clipboard either, so it does not compete with what Save
  // already offers.
  async function downloadClip() {
    if (!rect || saving) return;
    saving = true;
    clearTimeout(ocrTimer);
    closePalette();
    await hideChromeForCapture();

    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: "easynote:clip-download",
        rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    } catch (err) {
      result = null;
    }

    if (result && result.ok) {
      const a = document.createElement("a");
      a.href = result.dataUrl;
      a.download = "easynote-clip.png";
      a.click();
    }

    afterCapture();
    showToast(result && result.ok ? "Downloaded" : "Couldn't download the clip");
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
    destroyed = true;
    clearTimeout(ocrTimer);
    clearTimeout(brushFlashTimer);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onReframe, true);
    window.removeEventListener("scroll", onReframe, true);
    host.remove();
    delete window.__easynoteClip;
  }

  window.__easynoteClip = { cancel };
})();
