import * as auth from "./auth.js";
import { runSync, getSyncMeta } from "./sync.js";

const AUTO_INTERVAL = 2 * 60 * 1000;

const panel = document.getElementById("sync-panel");
const statusEl = document.getElementById("sync-status");
const detailEl = document.getElementById("sync-detail");
const signInBtn = document.getElementById("sync-signin");
const syncBtn = document.getElementById("sync-now");
const signOutBtn = document.getElementById("sync-signout");
const cloudBtn = document.getElementById("open-sync");

let busy = false;
let afterSync = () => {};

export function setSyncAppliedHandler(fn) {
  afterSync = fn;
}

function ago(ts) {
  if (!ts) return "never";
  const d = Date.now() - ts;
  if (d < 60000) return "just now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function show(state, text, detail = "") {
  statusEl.textContent = text;
  statusEl.title = text; // the email is ellipsised when it is long

  detailEl.textContent = detail;
  cloudBtn.dataset.state = state;
}

async function paint() {
  if (!auth.available()) {
    show("off", "Sync unavailable", "chrome.identity is not present.");
    signInBtn.hidden = true;
    return;
  }
  const on = await auth.signedIn();
  signInBtn.hidden = on;
  syncBtn.hidden = !on;
  signOutBtn.hidden = !on;

  if (!on) return show("off", "Not signed in", "Notes stay on this device.");

  const meta = await getSyncMeta();
  const who = await auth.profile().catch(() => null);
  show("on", who?.email || "Signed in", `Last sync ${ago(meta.lastSyncedAt)}`);
}

export async function sync({ silent = false } = {}) {
  if (busy || !(await auth.signedIn())) return;
  busy = true;
  if (!silent) show("busy", "Syncing…", "");
  try {
    const res = await runSync();
    const moved = res.pulledNotes + res.pulledPages + res.imagesDown;
    if (moved) await afterSync();
    show(
      "on",
      "Synced",
      `${res.pulledNotes} notes in, ${res.imagesDown} images in${res.pushed ? ", pushed" : ""}`
    );
    setTimeout(paint, 2500);
  } catch (e) {
    // Surfaced verbatim: the common failure is an extension id that does not
    // match the OAuth client, and a generic message hides that completely.
    show("error", "Sync failed", e.message);
  } finally {
    busy = false;
  }
}

export function initSyncUI() {
  cloudBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("is-open");
    if (panel.classList.contains("is-open")) paint();
  });

  document.addEventListener("pointerdown", (e) => {
    if (!panel.contains(e.target) && e.target !== cloudBtn) panel.classList.remove("is-open");
  });

  signInBtn.addEventListener("click", async () => {
    show("busy", "Waiting for Google…", "");
    try {
      await auth.signIn();
      await paint();
      await sync();
    } catch (e) {
      // "bad client id" almost always means the OAuth client is not registered
      // against *this* extension id, so show the id they need to register
      // rather than leaving them to hunt for it.
      const hint = /bad client id|invalid client/i.test(e.message)
        ? ` — register extension id ${chrome.runtime.id} on the Chrome Extension OAuth client, or pin the id with a manifest "key". See docs/SYNC.md`
        : "";
      show("error", "Sign-in failed", e.message + hint);
    }
  });

  syncBtn.addEventListener("click", () => sync());

  signOutBtn.addEventListener("click", async () => {
    await auth.signOut();
    await paint();
  });

  paint();
  sync({ silent: true });
  setInterval(() => sync({ silent: true }), AUTO_INTERVAL);
}
