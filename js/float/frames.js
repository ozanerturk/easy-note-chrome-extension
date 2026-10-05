// Floating notes — the frames on a webpage.
//
// A classic script, injected into pages while something is floating (see
// background.js). It draws nothing itself. Each floating note is an extension
// page, float.html, in a frame of its own, and that page draws the note with the
// board's own code out of the board's own database. All this does is keep one
// frame per floating note on the page, covering the viewport, clipped down to
// as much of it as that frame asks to have showing — see float/page.js.
//
// It never touches a note's contents, on purpose. It runs alongside the page's
// own scripts in the page's own document, and anything it holds the page can
// get at. The notes stay inside the frames, which are the extension's origin.

(() => {
  // Registered for later loads and also injected into pages already open, so a
  // page can get this twice. The second time is a request to catch up.
  if (window.__easynoteFloat) {
    window.__easynoteFloat.refresh();
    return;
  }

  const ORIGIN = `chrome-extension://${chrome.runtime.id}`;
  // geometry.js, restated: a content script is a classic script and cannot
  // import it.
  const KEEP = 48;
  const DEFAULT_WIDTH = 260;
  const DEFAULT_HEIGHT = 180;
  const CASCADE = 24;
  // Room for the note's shadow before the frame has loaded and measured it —
  // see shadowReach in float/page.js, which takes over from this.
  const PAD = 28;

  // id -> { id, frame, port, box }
  const frames = new Map();

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  function clamp(box, v) {
    const width = Math.max(1, Math.min(Number(box.width) || DEFAULT_WIDTH, v.width));
    const height = Math.max(1, Math.min(Number(box.height) || DEFAULT_HEIGHT, v.height));
    return {
      x: Math.round(Math.max(KEEP - width, Math.min(Number(box.x) || 0, v.width - KEEP))),
      y: Math.round(Math.max(0, Math.min(Number(box.y) || 0, v.height - KEEP))),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  function defaultBox(v, taken) {
    const step = (taken % 6) * CASCADE;
    return clamp(
      {
        x: Math.round((v.width - DEFAULT_WIDTH) / 2) + step,
        y: Math.round((v.height - DEFAULT_HEIGHT) / 3) + step,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      },
      v
    );
  }

  const ask = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (reply) => {
          void chrome.runtime.lastError; // the worker went away mid-question
          resolve(reply || { ok: false });
        });
      } catch {
        resolve({ ok: false }); // the extension was reloaded under this page
      }
    });

  // Inline and !important, all of it: this element lives in a page whose
  // stylesheet may well have something to say about every iframe on it.
  const FRAME_STYLE = {
    position: "fixed",
    left: "0",
    top: "0",
    right: "auto",
    bottom: "auto",
    width: "100%",
    height: "100%",
    margin: "0",
    padding: "0",
    border: "0",
    "border-radius": "0",
    background: "transparent",
    "box-shadow": "none",
    outline: "none",
    display: "block",
    visibility: "visible",
    opacity: "1",
    transform: "none",
    filter: "none",
    "max-width": "none",
    "max-height": "none",
    "min-width": "0",
    "min-height": "0",
    "pointer-events": "auto",
    "z-index": "2147483000",
    // The frame is only see-through while this agrees with the frame's own
    // scheme — see css/float.css.
    "color-scheme": "light",
  };

  // Leave only `rect` of the frame showing, or all of it. Chrome sends a click
  // to whatever a clip leaves showing and to the page everywhere else, so this
  // is also how the page keeps every click that is not aimed at the note.
  const whole = (n) => Math.round(Number(n) || 0);
  function clip(entry, rect) {
    const value = rect
      ? `inset(${whole(rect.y)}px calc(100% - ${whole(rect.x) + Math.max(0, whole(rect.width))}px) ` +
        `calc(100% - ${whole(rect.y) + Math.max(0, whole(rect.height))}px) ${whole(rect.x)}px)`
      : "none";
    entry.frame.style.setProperty("clip-path", value, "important");
  }

  function add(record, taken, token) {
    const v = viewport();
    const box = record.floatingGeometry ? clamp(record.floatingGeometry, v) : defaultBox(v, taken);
    const frame = document.createElement("iframe");
    Object.entries(FRAME_STYLE).forEach(([name, value]) => frame.style.setProperty(name, value, "important"));
    frame.title = "Easy Note";
    const entry = { id: record.id, frame, port: null, box };
    // Clipped from the start, so a frame that has not loaded yet is not a
    // viewport-sized pane over the page taking its clicks.
    clip(entry, { x: box.x - PAD, y: box.y - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD });
    frame.addEventListener("load", () => greet(entry, token));
    frame.src = `${chrome.runtime.getURL("float.html")}?id=${encodeURIComponent(record.id)}`;
    frames.set(record.id, entry);
    // On the document element, not the body: a page that transforms or scales
    // its body would carry the note along with it.
    document.documentElement.appendChild(frame);
  }

  // The frame draws nothing until it has this. The token says the frame was
  // put here by the extension rather than by the page (see float/page.js), and
  // the port is how the two talk from then on — out of the page's hearing,
  // which a message posted to the window would not be.
  function greet(entry, token) {
    if (entry.port) entry.port.close();
    const channel = new MessageChannel();
    entry.port = channel.port1;
    entry.port.onmessage = (e) => heard(entry, e.data || {});
    entry.frame.contentWindow.postMessage(
      { type: "easynote:float-hello", token, box: entry.box },
      ORIGIN,
      [channel.port2]
    );
  }

  function heard(entry, msg) {
    if (msg.type === "clip") {
      clip(entry, msg.rect || null);
    } else if (msg.type === "gone") {
      remove(entry.id);
    }
  }

  function remove(id) {
    const entry = frames.get(id);
    if (!entry) return;
    frames.delete(id);
    if (entry.port) entry.port.close();
    entry.frame.remove();
  }

  let refreshing = null;
  async function refresh() {
    // One in flight at a time: a burst of changes should end in one pass.
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const reply = await ask({ type: "easynote:float-list" });
      if (!reply.ok) return;
      const seen = new Set();
      reply.notes.forEach((record, i) => {
        seen.add(record.id);
        if (!frames.has(record.id)) add(record, i, reply.token);
      });
      // Put away or deleted somewhere else while this page was open.
      [...frames.keys()].forEach((id) => {
        if (!seen.has(id)) remove(id);
      });
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "easynote:float-changed") refresh();
    });
  } catch {
    // No port to listen on — the extension was reloaded. What is here stays.
  }

  // A press on the page never lands inside a frame — those go to the frame —
  // so every press this sees is a press outside every note on the page.
  document.addEventListener(
    "pointerdown",
    () => frames.forEach((entry) => entry.port && entry.port.postMessage({ type: "away" })),
    true
  );

  window.__easynoteFloat = { refresh };
  refresh();
})();
