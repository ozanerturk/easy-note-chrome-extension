// The two things in the demo video that are not the product: a pointer, and a
// caption bar. Injected into whichever page is on camera by scripts/video.mjs.
//
// A screencast frame has no cursor in it — the compositor draws the page, not
// the mouse — so a recording of a drag looks like a note moving on its own.
// This one follows the same pointer events the tour dispatches, which means it
// can never be out of step with what is actually being clicked.

(() => {
  if (window.__demo) return true;

  const style = document.createElement("style");
  style.textContent = [
    "#demo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px;",
    "  z-index: 2147483647; pointer-events: none; margin: -2px 0 0 -2px;",
    "  filter: drop-shadow(0 2px 5px rgba(0,0,0,0.45)); }",
    "#demo-ring { position: fixed; left: 0; top: 0; width: 34px; height: 34px;",
    "  margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(70,130,255,0.9);",
    "  z-index: 2147483646; pointer-events: none; opacity: 0; }",
    "#demo-ring.is-hit { animation: demo-ping 460ms ease-out; }",
    "@keyframes demo-ping { from { opacity: 0.85; transform: var(--at) scale(0.35); }",
    "  to { opacity: 0; transform: var(--at) scale(1.6); } }",
    "#demo-cap { position: fixed; left: 0; right: 0; bottom: 46px; z-index: 2147483645;",
    "  display: flex; justify-content: center; pointer-events: none; opacity: 0;",
    "  transition: opacity 300ms ease; }",
    "#demo-cap.is-on { opacity: 1; }",
    "#demo-cap > div { background: rgba(18,17,15,0.9); color: #fff; border-radius: 15px;",
    "  padding: 14px 28px 16px; text-align: center; max-width: 780px;",
    "  font: 400 15px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;",
    "  box-shadow: 0 12px 38px rgba(0,0,0,0.34); }",
    "#demo-cap b { display: block; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }",
    "#demo-cap span { display: block; margin-top: 4px; color: rgba(255,255,255,0.7); }",
    "#demo-card { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;",
    "  display: flex; flex-direction: column; align-items: center; justify-content: center;",
    "  gap: 8px; background: #171512; color: #fff; opacity: 0; transition: opacity 480ms ease;",
    "  font: 400 21px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }",
    "#demo-card.is-on { opacity: 1; }",
    "#demo-card img { width: 84px; height: 84px; margin-bottom: 10px; }",
    "#demo-card b { font-size: 48px; font-weight: 600; letter-spacing: -0.03em; }",
    "#demo-card span { color: rgba(255,255,255,0.66); }",
  ].join("\n");
  document.documentElement.appendChild(style);

  const add = (html) => {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const el = holder.firstElementChild;
    document.documentElement.appendChild(el);
    return el;
  };

  const cursor = add(
    '<svg id="demo-cursor" viewBox="0 0 24 24">' +
      '<path d="M5 2l14 9-6 1.4 3.2 6.4-2.6 1.3L10.4 14 5 18z" fill="#fff" stroke="#1a1a1a" ' +
      'stroke-width="1.4" stroke-linejoin="round"/></svg>'
  );
  const ring = add('<div id="demo-ring"></div>');
  const cap = add('<div id="demo-cap"><div><b></b><span></span></div></div>');
  const card = add('<div id="demo-card"><img alt=""><b></b><span></span></div>');

  const move = (x, y) => {
    const at = "translate(" + x + "px, " + y + "px)";
    cursor.style.transform = at;
    ring.style.setProperty("--at", at);
    ring.style.transform = at;
    window.__demoAt = { x: x, y: y };
  };
  move(innerWidth / 2, innerHeight - 140);

  addEventListener("pointermove", (e) => move(e.clientX, e.clientY), true);
  addEventListener(
    "pointerdown",
    (e) => {
      move(e.clientX, e.clientY);
      ring.classList.remove("is-hit");
      void ring.offsetWidth;
      ring.classList.add("is-hit");
    },
    true
  );

  window.__demo = {
    say(title, sub) {
      cap.querySelector("b").textContent = title || "";
      cap.querySelector("span").textContent = sub || "";
      cap.classList.toggle("is-on", !!title);
    },
    card(title, sub, icon) {
      card.querySelector("b").textContent = title || "";
      card.querySelector("span").textContent = sub || "";
      const img = card.querySelector("img");
      img.src = icon || "";
      img.hidden = !icon;
      card.classList.toggle("is-on", !!title);
    },
    // Some scenes fill the bottom of the frame — the gallery has its own bar
    // down there — so the caption moves out of the way rather than over it.
    lift(where) {
      if (where === "top") {
        cap.style.bottom = "auto";
        cap.style.top = "36px";
      } else {
        cap.style.top = "auto";
        cap.style.bottom = (where || 46) + "px";
      }
    },
    at: () => window.__demoAt,
  };
  return true;
})();
