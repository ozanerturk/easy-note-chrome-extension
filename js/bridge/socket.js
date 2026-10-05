// The connection to the relay: connect, say who we are, keep it alive, come
// back when it drops. Nothing here is logged beyond this file's own status —
// not frames, not tokens, not what a note said.

import * as auth from "../auth.js";
import { RELAY_WS_URL, MAX_FRAME_BYTES } from "./config.js";
import { dispatch } from "./dispatcher.js";
import { CHANNEL, readState, writeState } from "./state.js";

const PING_MS = 20_000;
const BACKOFF_START = 1_000;
const BACKOFF_CAP = 60_000;
export const WATCHDOG = "bridge-watchdog";

const channel = new BroadcastChannel(CHANNEL);
const encoder = new TextEncoder();

let ws = null;
let connecting = false; // between "decided to connect" and the socket existing
let retryTimer = null;
let pingTimer = null;
let backoff = BACKOFF_START;
let authRetried = false;
let stopped = false; // auth_required: stay down until the user turns it off and on
let status = null;

async function setStatus(next) {
  if (status === next) return;
  status = next;
  await writeState({ status: next });
  channel.postMessage({ type: "status", status: next });
}

const alive = () => ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

function send(socket, frame) {
  const text = JSON.stringify(frame);
  if (encoder.encode(text).length <= MAX_FRAME_BYTES) return socket.send(text);
  // too big to send: answer the call instead of leaving it to time out
  if (frame.type === "result") {
    socket.send(JSON.stringify({ type: "result", id: frame.id, ok: false, error: { code: "INTERNAL", message: "Result too large to send." } }));
  }
}

async function credentials(state) {
  // dev-auth:begin
  if (state.devUser) return state.devUser;
  // dev-auth:end
  return auth.getToken({ interactive: false });
}

async function endpoint(state) {
  // dev-auth:begin
  if (state.relayUrl) return state.relayUrl;
  // dev-auth:end
  return RELAY_WS_URL;
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  const delay = backoff * (0.8 + Math.random() * 0.4);
  backoff = Math.min(backoff * 2, BACKOFF_CAP);
  retryTimer = setTimeout(connect, delay);
}

async function connect() {
  clearTimeout(retryTimer);
  if (alive() || connecting || stopped) return;
  const state = await readState();
  if (!state.enabled) return;

  connecting = true;
  let token;
  try {
    token = await credentials(state);
  } catch {
    connecting = false;
    stopped = true;
    return setStatus("auth_required");
  }
  if (status !== "connected" && status !== "unreachable") await setStatus("connecting");

  const socket = new WebSocket(await endpoint(state));
  ws = socket;
  connecting = false;
  let authed = false;

  socket.onopen = () => {
    send(socket, { type: "auth", token, instanceId: state.instanceId, clientVersion: chrome.runtime.getManifest().version });
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== "string" || event.data.length > MAX_FRAME_BYTES) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "auth_ok") {
      authed = true;
      backoff = BACKOFF_START;
      authRetried = false;
      clearInterval(pingTimer);
      // this traffic is also what keeps the service worker from being put to sleep
      pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && send(socket, { type: "ping" }), PING_MS);
      setStatus("connected");
    } else if (msg.type === "call" && authed && typeof msg.id === "string") {
      dispatch(msg).then((frame) => socket.readyState === WebSocket.OPEN && send(socket, frame));
    }
  };

  socket.onclose = async (event) => {
    clearInterval(pingTimer);
    if (ws !== socket) return; // a socket we already replaced
    ws = null;
    const now = await readState();
    if (!now.enabled) return;

    if (event.code === 4401) {
      // the token may only have gone stale: drop it, fetch a fresh one, try once more
      if (authRetried) {
        stopped = true;
        return setStatus("auth_required");
      }
      authRetried = true;
      await auth.invalidate().catch(() => {});
      return connect();
    }
    await setStatus(authed ? "connecting" : "unreachable");
    scheduleReconnect();
  };

  // an error is always followed by a close, which is where it is handled
  socket.onerror = () => {};
}

function disconnect() {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  const socket = ws;
  ws = null;
  // switching it off asks the relay to forget this account's Drive access, not
  // just to hang up; sent before the close so it is ahead of it on the wire
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "forget" }));
  socket?.close(1000);
}

/** Bring the connection in line with the setting. Safe to call at any time. */
export async function sync() {
  const state = await readState();
  if (state.enabled) {
    await chrome.alarms.create(WATCHDOG, { periodInMinutes: 0.5 });
    await connect();
  } else {
    stopped = false;
    backoff = BACKOFF_START;
    authRetried = false;
    disconnect();
    await chrome.alarms.clear(WATCHDOG);
    await setStatus("off");
  }
}

export async function setEnabled(enabled) {
  const state = await readState();
  await writeState({ enabled, instanceId: state.instanceId || crypto.randomUUID() });
  // a fresh try, including after "sign-in required"
  stopped = false;
  authRetried = false;
  backoff = BACKOFF_START;
  if (!enabled) status = null;
  await sync();
}

// Called on every alarm: if it is meant to be up and is not, make it so.
export async function watchdog() {
  if (stopped || alive() || connecting) return;
  await connect();
}
