// testing only: stands in for the extension, answering each tool with canned data
import { WebSocket } from "ws";

const url = process.env.RELAY_WS_URL ?? "ws://localhost:3000/ws";
const token = process.env.DEV_USER ?? "dev-user";

const canned: Record<string, (args: any) => unknown> = {
  search_notes: () => [
    { id: "n1", title: "Groceries", snippet: "milk, eggs, …", pagePath: "Home / Lists", updatedAt: 1700000000000 },
  ],
  get_note: (a) => ({
    id: a.id, title: "Groceries", pagePath: "Home / Lists", content: "# Groceries\n- milk\n- eggs",
    updatedAt: 1700000000000, truncated: false,
  }),
  capture: () => ({ id: "c1", location: "Capture Tray" }),
};

const ws = new WebSocket(url);
let ping: NodeJS.Timeout;
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", token, instanceId: "fake-extension", clientVersion: "0.0.0" }));
  ping = setInterval(() => ws.send(JSON.stringify({ type: "ping" })), 20_000);
});
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "auth_ok") console.log("connected");
  if (msg.type !== "call") return;
  const handler = canned[msg.tool];
  ws.send(JSON.stringify(
    handler
      ? { type: "result", id: msg.id, ok: true, data: handler(msg.args) }
      : { type: "result", id: msg.id, ok: false, error: { code: "INVALID_ARGS", message: "unknown tool" } },
  ));
});
ws.on("close", (code) => {
  clearInterval(ping);
  console.log("closed", code);
  process.exit(0);
});
