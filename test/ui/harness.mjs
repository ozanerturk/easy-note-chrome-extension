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
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSION_ID = "hheobakelknbjicekbkmijjgcbephcef"; // pinned by the manifest key

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  }

  send(method, params = {}) {
    const id = ++this.seq;
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

/** Launch Chrome with the extension loaded and nothing of the user's in it. */
export async function launch({ port: wanted = 9333, profile } = {}) {
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
      `--load-extension=${root}`,
      `--disable-extensions-except=${root}`,
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--window-size=1200,800",
      "--window-position=0,0",
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

  return {
    /** A fresh new-tab page, with its own clean board. */
    async page() {
      const { targetId } = await browser.send("Target.createTarget", {
        url: `chrome-extension://${EXTENSION_ID}/newtab.html`,
      });
      await sleep(1200);
      const target = (await getJson(port, "/json/list")).find((t) => t.id === targetId);
      const cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send("Runtime.enable");
      await cdp.send("Page.bringToFront").catch(() => {}); // :hover needs the foreground
      await sleep(500);
      return makePage(cdp, targetId, browser);
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

function makePage(cdp, targetId, browser) {
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

  return {
    cdp,
    evaluate,
    mouse,

    async click(x, y, times = 1, extra = {}) {
      for (let i = 1; i <= times; i++) {
        await mouse("mousePressed", x, y, { clickCount: i, ...extra });
        await sleep(30);
        await mouse("mouseReleased", x, y, { clickCount: i, buttons: 0, ...extra });
        await sleep(60);
      }
    },

    /** Press, move in steps, release — the only way to exercise a real drag. */
    async drag(x, y, dx, dy, extra = {}) {
      await mouse("mousePressed", x, y, extra);
      await sleep(40);
      for (let i = 1; i <= 8; i++) {
        await mouse("mouseMoved", x + (dx * i) / 8, y + (dy * i) / 8, extra);
        await sleep(25);
      }
      await mouse("mouseReleased", x + dx, y + dy, { buttons: 0, ...extra });
      await sleep(180);
    },

    move: (x, y) => mouse("mouseMoved", x, y, { buttons: 0 }),

    /** Let async work — an IndexedDB write, a clipboard read — actually land. */
    settle: (ms = 350) => sleep(ms),

    wheel: (x, y, deltaY, modifiers = 0) =>
      cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x, y, deltaX: 0, deltaY, modifiers, pointerType: "mouse",
      }),

    async key(key, code, modifiers = 0) {
      const shared = { key, code, modifiers, windowsVirtualKeyCode: VK[code] ?? key.toUpperCase().charCodeAt(0) };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...shared });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...shared });
    },

    type: (text) => evaluate(`document.execCommand('insertText', false, ${JSON.stringify(text)})`),

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
      await cdp.send("Page.reload");
      await sleep(1400);
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
      await evaluate(`try { localStorage.clear(); } catch (e) {}`);
      await cdp.send("Page.reload");
      await sleep(1400);
    },

    async close() {
      await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    },
  };
}

const VK = { Escape: 27, Space: 32, Enter: 13, Backspace: 8, Delete: 46 };

/* ------------------------------------------------------------------ suites */

export const MOD = { ctrl: 2, shift: 8, meta: 4 };

export function suite(name) {
  const checks = [];
  return {
    name,
    checks,
    check(label, pass, detail = "") {
      checks.push({ label, pass, detail });
      console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
      return pass;
    },
    get failures() {
      return checks.filter((c) => !c.pass);
    },
  };
}
