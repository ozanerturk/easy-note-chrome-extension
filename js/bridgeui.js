// The Connect to Claude switch in the sync panel. The worker owns the
// connection and every write about it; this asks it to change and shows what
// it hears back.

import { META, getOne } from "./db.js";
import { CONNECTOR_URL } from "./bridge/config.js";
import { CHANNEL } from "./bridge/state.js";

const LABELS = {
  off: "Off",
  connecting: "Connecting…",
  connected: "Connected",
  auth_required: "Sign-in required",
  unreachable: "Can't reach server",
};

const toggle = document.getElementById("bridge-enabled");
const statusEl = document.getElementById("bridge-status");
const connector = document.getElementById("bridge-connector");
const urlEl = document.getElementById("bridge-url");
const copyBtn = document.getElementById("bridge-copy");

function show(enabled, status) {
  toggle.checked = enabled;
  statusEl.textContent = LABELS[enabled ? status : "off"] || LABELS.off;
  connector.hidden = !enabled;
}

export async function initBridgeUI() {
  urlEl.value = CONNECTOR_URL;

  const state = (await getOne(META, "bridge")) || {};
  show(!!state.enabled, state.status);

  new BroadcastChannel(CHANNEL).onmessage = (e) => {
    if (e.data?.type === "status") show(toggle.checked, e.data.status);
  };

  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    show(enabled, enabled ? "connecting" : "off");
    chrome.runtime.sendMessage({ type: "easynote:bridge-set", enabled }).catch(() => show(false, "off"));
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    } catch {
      urlEl.select();
    }
  });
}
