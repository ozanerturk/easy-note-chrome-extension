// Drives the real extension in Chrome for Testing over the DevTools protocol.
//
// The unit tests in test/ cover pure functions. Everything else in this app is
// interaction — drags, focus, pointer gestures — and those only break in a real
// browser. Synthetic events lie: .click() bypasses the compatibility-event path
// that once hid a broken delete button, so every gesture here is dispatched as
// trusted input.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EXTENSION_ID = "hheobakelknbjicekbkmijjgcbephcef"; // pinned by the manifest key

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Put into every document the harness opens, before the app's own scripts run.
// It counts what the page still has in flight — short timers, database
// transactions, messages to the worker, fetches, animation frames, running
// animations — so settle() can return the moment there is nothing left, rather
// than sleeping for a guess at how long that takes.
const QUIET = `(() => {
  if (window.__settled) return;
  // longer than this is the app waiting on a person, not on work
  const SHORT = 1000;
  const st = setTimeout.bind(window), ct = clearTimeout.bind(window);
  const raf = requestAnimationFrame.bind(window), caf = cancelAnimationFrame.bind(window);
  const timers = new Set(), frames = new Set();
  let busy = 0;

  window.setTimeout = function (fn, ms, ...rest) {
    if (typeof fn !== 'function' || Number(ms) > SHORT) return st(fn, ms, ...rest);
    const id = st(() => { timers.delete(id); fn(...rest); }, ms);
    timers.add(id);
    return id;
  };
  window.clearTimeout = (id) => { timers.delete(id); ct(id); };
  window.requestAnimationFrame = (fn) => {
    const id = raf((t) => { frames.delete(id); fn(t); });
    frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => { frames.delete(id); caf(id); };

  const track = (p) => {
    if (p && typeof p.then === 'function') {
      busy++;
      let done = false;
      const end = () => { if (!done) { done = true; busy--; } };
      p.then(end, end);
    }
    return p;
  };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args);
    track(new Promise((end) => {
      tx.addEventListener('complete', end);
      tx.addEventListener('abort', end);
    }));
    return tx;
  };
  const fetch = window.fetch;
  window.fetch = function (...args) { return track(fetch.apply(this, args)); };
  if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = function (...args) { return track(send.apply(chrome.runtime, args)); };
  }

  // a fade or a slide is work; an endless one (a floating note's bob) or a long
  // one (the undo bar counting down its eight seconds) is waiting on a person
  const working = (a) =>
    a.playState === 'running' && a.effect && a.effect.getComputedTiming().endTime <= SHORT;
  const animating = () => document.getAnimations().some(working);
  const quiet = () => document.readyState === 'complete' &&
    !timers.size && !frames.size && !busy && !animating();
  // what is keeping a page busy, when settle() never comes back early
  window.__busy = () => ({
    loading: document.readyState !== 'complete', timers: timers.size, frames: frames.size, busy,
    animations: document.getAnimations()
      .filter(working)
      .map((a) => (a.animationName || a.transitionProperty || 'script') + ' on ' +
        ((a.effect.target && (a.effect.target.id || a.effect.target.className)) || '?')),
  });

  // asked after a frame has been drawn, so layout and resize observers have had
  // their turn; a page in the background draws no frames, hence the timer
  window.__settled = () => new Promise((resolve) => {
    const answer = () => resolve(quiet());
    raf(() => raf(answer));
    st(answer, 100);
  });
})()`;

function findChrome() {
  const chromeRoot = path.join(root, ".chrome", "chrome");
  if (!fs.existsSync(chromeRoot)) return null;
  for (const build of fs.readdirSync(chromeRoot)) {
    for (const dir of ["chrome-mac-arm64", "chrome-mac-x64", "linux-x64", "win64"]) {
      const bin = path.join(
        chromeRoot, build, dir,
        process.platform === "darwin"
          ? "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
          : "chrome"
      );
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

const getJson = (port, route) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: route }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(JSON.parse(body)));
      })
      .on("error", reject);
  });

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      const waiter = msg.id && this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
    });
    // A target that goes away — a frame taken off its page, a tab closed —
    // closes its socket, and a call still waiting on it would wait forever: a
    // whole run once sat there for ten minutes over one removed frame.
    ws.on("close", () => {
      const gone = new Error("the target went away");
      this.pending.forEach((waiter) => waiter.reject(gone));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("the target went away"));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const connect = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    ws.on("open", () => resolve(new Connection(ws)));
    ws.on("error", reject);
  });

// A Chrome left behind by an earlier run still answers on its debugging port,
// and connecting to it means testing whatever build that one loaded. Step past
// anything already listening rather than talking to it.
async function freePort(from) {
  for (let candidate = from; candidate < from + 30; candidate += 1) {
    try {
      await getJson(candidate, "/json/version");
    } catch {
      return candidate; // nothing there
    }
  }
  throw new Error("no free debugging port; is a stray Chrome still running?");
}

/**
 * A copy of the extension that already holds access to every site.
 *
 * Floating notes need <all_urls>, which the real manifest only asks for when a
 * note is first floated — and that ask is a Chrome prompt no test can answer.
 * The copy declares it outright instead, so a suite can have the real content
 * script put the real frame on a real page. Same key, so the same extension id.
 * The caller removes the directory when it is done with it.
 */
export function withHostAccess() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easynote-ext-"));
  for (const name of ["js", "css", "icons", "newtab.html", "float.html"]) {
    fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  manifest.host_permissions = ["<all_urls>"];
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

/** Launch Chrome with the extension loaded and nothing of the user's in it. */
export async function launch({ port: wanted = 9333, profile, flags = [], headless = false, extension = root } = {}) {
  const port = await freePort(wanted);
  const bin = findChrome();
  if (!bin) {
    throw new Error(
      "Chrome for Testing not found. Install it with:\n" +
        `  npx @puppeteer/browsers install chrome@stable --path "${path.join(root, ".chrome")}"`
    );
  }

  const userDataDir = profile || fs.mkdtempSync(path.join(root, ".ui-profile-"));
  const chrome = spawn(
    bin,
    [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--window-size=1200,800",
      "--window-position=0,0",
      // no window means nothing to fight over for focus, which is what lets
      // several of these run side by side
      ...(headless ? ["--headless"] : []),
      ...flags,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let version;
  for (let i = 0; i < 80 && !version; i++) {
    try {
      version = await getJson(port, "/json/version");
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome never came up on the debugging port");

  const browser = await connect(version.webSocketDebuggerUrl);

  // Open a target and come back with a connection to it. The debugging endpoint
  // lists a target a beat after it is created, so it is waited for.
  async function openTarget(url, { newWindow = false } = {}) {
    // Opened blank and then sent on, so the tracker is in place before the
    // first line of the app runs.
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", newWindow });
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      target = (await getJson(port, "/json/list")).find((t) => t.id === targetId);
      if (!target) await sleep(50);
    }
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    // without the Page domain on, the script is accepted and then never run
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: QUIET });
    await cdp.send("Page.navigate", { url });
    return { cdp, targetId };
  }

  return {
    /** A fresh new-tab page, with its own clean board. */
    async page() {
      const { cdp, targetId } = await openTarget(`chrome-extension://${EXTENSION_ID}/newtab.html`);
      await cdp.send("Page.bringToFront").catch(() => {}); // :hover needs the foreground
      const page = makePage(cdp, targetId, browser, { port, openTarget });
      await page.ready();
      return page;
    },

    /**
     * Any page, for a suite that needs a second document. `newWindow` puts it in
     * a window of its own, so it is drawn — and takes input into its frames —
     * whichever other tab was brought to the front last.
     */
    async open(url, { newWindow = false } = {}) {
      const { cdp, targetId } = await openTarget(url, { newWindow });
      return makePage(cdp, targetId, browser, { port, openTarget });
    },
    /**
     * A frame inside some page — a floating note — driven like a page of its own.
     *
     * Matched by a piece of its address. An extension frame on a website runs in
     * a process of its own, so it is a debugging target of its own, and waited
     * for since it is listed a beat after the frame is made.
     */
    async frame(match, { timeout = 10000 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const listed = (await getJson(port, "/json/list").catch(() => [])).find(
          (t) => t.type === "iframe" && String(t.url).includes(match)
        );
        let info = listed;
        if (!info) {
          const { targetInfos = [] } = await browser.send("Target.getTargets").catch(() => ({}));
          info = targetInfos.find((t) => t.type === "iframe" && String(t.url).includes(match));
        }
        if (info) {
          const id = info.id || info.targetId;
          const cdp = await connect(info.webSocketDebuggerUrl || `ws://127.0.0.1:${port}/devtools/page/${id}`);
          await cdp.send("Runtime.enable");
          return makePage(cdp, id, browser, { port, openTarget });
        }
        if (Date.now() > deadline) throw new Error(`no frame matching ${match}`);
        await sleep(100);
      }
    },

    async close() {
      await browser.send("Browser.close").catch(() => {});
      chrome.kill();
      // Chrome is still flushing its profile for a moment after it is asked
      // to go, so the delete needs to be patient about it.
      await sleep(400);
      if (!profile) {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      }
    },
  };
}

function makePage(cdp, targetId, browser, { port, openTarget } = {}) {
  const evaluate = async (expression, { gesture = false } = {}) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: gesture,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
    }
    return result.result.value;
  };

  const mouse = (type, x, y, extra = {}) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      ...extra,
    });

  /**
   * Poll until an expression is true.
   *
   * Every wait in here used to be a sleep long enough for the slowest machine,
   * which is dead time on every other one and still a coin toss on that one.
   * Polling is both faster and steadier: it returns the moment the thing is
   * true, and it fails loudly rather than carrying on against a page that was
   * never ready.
   */
  const waitFor = async (expression, { timeout = 10000, every = 30 } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      try {
        if (await evaluate(expression)) return true;
      } catch (err) {
        // A navigation in flight takes the execution context with it.
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expression}`);
      await sleep(every);
    }
  };

  /**
   * Let async work — an IndexedDB write, a fade, a debounced save — land.
   *
   * Returns as soon as the page has nothing left in flight (see QUIET), and
   * never later than `ms`, which is what this used to sleep for outright. So a
   * suite can only get faster by it: where the page is quiet sooner it moves
   * on sooner, and where something is still running it waits exactly as long
   * as it always did.
   */
  const settle = async (ms = 250) => {
    const deadline = Date.now() + ms;
    for (let left = ms; left > 0; left = deadline - Date.now()) {
      const quiet = await Promise.race([
        evaluate(`window.__settled ? window.__settled() : false`).catch(() => false),
        sleep(left).then(() => false),
      ]);
      if (quiet) return;
      await sleep(Math.min(10, Math.max(0, deadline - Date.now())));
    }
    // QUIET_DEBUG=1 says what held a long settle to its full length
    if (process.env.QUIET_DEBUG && ms >= 100) {
      const busy = await evaluate(`window.__busy ? window.__busy() : null`).catch(() => null);
      console.error(`settle(${ms}) ran out: ${JSON.stringify(busy)}\n${new Error().stack.split("\n").slice(2, 4).join("\n")}`);
    }
  };

  // main.js sets this at the end of its boot chain — the board is up and
  // everything that reads the database has read it.
  const ready = async () => {
    await waitFor(`document.documentElement.dataset.ready === "1"`);
    // The flag says the data is in; the board still has a frame of layout and
    // a fade or two to get through, which a test measuring a note's position
    // must not catch mid-animation.
    await settle(250);
  };

  /**
   * Reload, and come back when the app has booted again.
   *
   * The flag has to be taken down first. A page that has already booted still
   * says it is ready for the whole of the navigation that is replacing it, so
   * a wait started after the reload was asked for reads the answer from the
   * document on its way out — and the test then runs against a page that is
   * about to vanish underneath it.
   */
  const reload = async () => {
    await evaluate(`delete document.documentElement.dataset.ready`).catch(() => {});
    await cdp.send("Page.reload");
    await ready();
  };

  /**
   * The extension's own service worker, as somewhere to run code.
   *
   * Worker-side code used to be tested by importing it into the board's page,
   * which is a different thing wearing the same name: everything shares one
   * context there, so a message that only ever reaches extension pages looks
   * like a message that reaches everyone. This is the real worker, with the
   * real chrome APIs and the real database.
   */
  const worker = async () => {
    // It may be asleep. A message wakes it, and then it appears as a target.
    await evaluate(`chrome.runtime.sendMessage({ type: 'easynote:wake' }).catch(() => {})`).catch(() => {});
    let target;
    for (let i = 0; i < 80 && !target; i++) {
      const targets = await getJson(port, "/json/list");
      target = targets.find(
        (t) => t.type === "service_worker" && String(t.url).includes(EXTENSION_ID)
      );
      if (!target) await sleep(100);
    }
    if (!target) throw new Error("the extension's service worker never appeared");
    const wcdp = await connect(target.webSocketDebuggerUrl);
    await wcdp.send("Runtime.enable");
    return {
      async evaluate(expression) {
        const result = await wcdp.send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description || "worker evaluate failed");
        }
        return result.result.value;
      },
    };
  };

  return {
    cdp,
    evaluate,
    mouse,
    waitFor,
    ready,
    reload,
    worker,
    open: (url) => openTarget && browserOpen(browser, port, openTarget, url),

    async click(x, y, times = 1, extra = {}) {
      for (let i = 1; i <= times; i++) {
        await mouse("mousePressed", x, y, { clickCount: i, ...extra });
        await sleep(10);
        await mouse("mouseReleased", x, y, { clickCount: i, buttons: 0, ...extra });
        await settle(60);
      }
    },

    /** Press, move in steps, release — the only way to exercise a real drag. */
    async drag(x, y, dx, dy, extra = {}) {
      // a frame between steps, since Chrome hands pointer moves over once a frame
      await mouse("mousePressed", x, y, extra);
      await sleep(16);
      for (let i = 1; i <= 8; i++) {
        await mouse("mouseMoved", x + (dx * i) / 8, y + (dy * i) / 8, extra);
        await sleep(16);
      }
      await mouse("mouseReleased", x + dx, y + dy, { buttons: 0, ...extra });
      await settle(180);
    },

    move: (x, y) => mouse("mouseMoved", x, y, { buttons: 0 }),

    settle,

    /** Real time passing: a clock that has to tick, a hold that has to be held. */
    pause: (ms) => sleep(ms),

    wheel: (x, y, deltaY, modifiers = 0) =>
      cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x, y, deltaX: 0, deltaY, modifiers, pointerType: "mouse",
      }),

    async key(key, code, modifiers = 0) {
      const shared = { key, code, modifiers, windowsVirtualKeyCode: VK[code] ?? key.toUpperCase().charCodeAt(0) };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...shared });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...shared });
    },

    async type(text) {
      return evaluate(`document.execCommand('insertText', false, ${JSON.stringify(text)})`);
    },

    /** Real per-character key events, so the editor's input rules see them. */
    async typeKeys(text) {
      for (const ch of text) {
        const enter = ch === "\n";
        const shared = enter
          ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }
          : { key: ch, code: `Key${ch.toUpperCase()}`, text: ch, unmodifiedText: ch };
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...shared });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: shared.key, code: shared.code });
        await sleep(12);
      }
    },

    /** Write records straight into the database, then reload onto them. */
    async seed(store, records) {
      await evaluate(`new Promise((resolve) => {
        const open = indexedDB.open('easynote');
        open.onsuccess = () => {
          const tx = open.result.transaction('${store}', 'readwrite');
          const os = tx.objectStore('${store}');
          ${JSON.stringify(records)}.forEach((r) => os.put(r));
          tx.oncomplete = () => resolve(true);
        };
      })`);
      await reload();
    },

    /** What actually reached the database, not what the DOM claims. */
    stored: (store = "notes") =>
      evaluate(`new Promise((resolve) => {
        const open = indexedDB.open('easynote');
        open.onsuccess = () => {
          const req = open.result.transaction('${store}', 'readonly').objectStore('${store}').getAll();
          req.onsuccess = () => resolve(req.result);
        };
      })`),

    view: () =>
      evaluate(`(() => {
        const m = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('world')).transform);
        return { x: Math.round(m.e), y: Math.round(m.f), zoom: +m.a.toFixed(3) };
      })()`),

    /** Empty the database and reload, so each suite starts from nothing. */
    async reset() {
      await evaluate(`new Promise((resolve) => {
        const open = indexedDB.open('easynote');
        open.onsuccess = () => {
          const db = open.result;
          const stores = [...db.objectStoreNames];
          const tx = db.transaction(stores, 'readwrite');
          stores.forEach((s) => tx.objectStore(s).clear());
          tx.oncomplete = () => resolve(true);
        };
      })`);
      // Setting a reminder asks Chrome, once, whether it may notify — and that
      // is a real browser prompt waiting on a person. Every suite starts as a
      // profile that has already been asked.
      await evaluate(`try { localStorage.clear(); localStorage.setItem('easynote:askedToNotify', '1'); } catch (e) {}`);
      await reload();
    },

    async close() {
      await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    },
  };
}

// A second document, driven like the first. Used by the floating suite, which
// has to put its widget somewhere that is not the board's own page.
async function browserOpen(browser, port, openTarget, url) {
  const { cdp, targetId } = await openTarget(url);
  return makePage(cdp, targetId, browser, { port, openTarget });
}

const VK = { Escape: 27, Space: 32, Enter: 13, Backspace: 8, Delete: 46, ArrowRight: 39 };

/* ------------------------------------------------------------------ suites */

export const MOD = { ctrl: 2, shift: 8, meta: 4 };

export function suite(name, log = console.log) {
  const checks = [];
  return {
    name,
    checks,
    check(label, pass, detail = "") {
      checks.push({ label, pass, detail });
      log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
      return pass;
    },
    get failures() {
      return checks.filter((c) => !c.pass);
    },
  };
}
