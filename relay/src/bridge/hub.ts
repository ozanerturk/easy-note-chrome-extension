import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { hashSub, log } from "../log.js";
import { Calls, type CallResult } from "./calls.js";

export const MAX_FRAME_BYTES = 256 * 1024;
const AUTH_TIMEOUT_MS = 5_000;
const SWEEP_MS = 15_000;
const STALE_MS = 60_000;

// resolves a token from the auth frame to a user id, or null if it isn't valid
export type Authenticate = (token: string) => Promise<string | null>;

type Connection = { id: string; ws: WebSocket; sub: string; instanceId: string; lastSeen: number };

const frame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth"),
    token: z.string().min(1),
    instanceId: z.string().min(1).max(100),
    clientVersion: z.string().max(50).optional(),
  }),
  z.object({ type: z.literal("ping") }),
  // the person switched the feature off: drop what is kept for their account
  z.object({ type: z.literal("forget") }),
  z.object({
    type: z.literal("result"),
    id: z.string().min(1),
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  }),
]);

const KNOWN_CODES = ["NOT_FOUND", "INVALID_ARGS", "INTERNAL", "BUSY"] as const;

export class Hub {
  readonly calls = new Calls();
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private byUser = new Map<string, Map<string, Connection>>();
  private sweeper?: NodeJS.Timeout;

  constructor(
    private authenticate: Authenticate,
    private onForget?: (sub: string) => Promise<void>,
  ) {
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  attach(server: Server): void {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path !== "/ws") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    });
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  // routes to the connection that spoke most recently
  async call(sub: string, tool: string, args: unknown): Promise<CallResult> {
    const conn = this.pick(sub);
    if (!conn) {
      return {
        ok: false,
        error: {
          code: "NOT_CONNECTED",
          message:
            "Easy Note isn't connected. Ask the user to open Chrome and make sure 'Connect to Claude' is enabled in Easy Note settings.",
        },
      };
    }
    return this.calls.start(sub, conn.id, (id) => {
      conn.ws.send(JSON.stringify({ type: "call", id, tool, args }));
    });
  }

  shutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const conns of this.byUser.values()) for (const c of conns.values()) c.ws.close(1001);
    this.wss.close();
  }

  private pick(sub: string): Connection | undefined {
    let best: Connection | undefined;
    for (const c of this.byUser.get(sub)?.values() ?? []) {
      if (c.ws.readyState === WebSocket.OPEN && (!best || c.lastSeen > best.lastSeen)) best = c;
    }
    return best;
  }

  private onConnection(ws: WebSocket): void {
    let conn: Connection | undefined;
    const authTimer = setTimeout(() => ws.close(4401, "auth required"), AUTH_TIMEOUT_MS);

    ws.on("message", async (raw, isBinary) => {
      let msg: z.infer<typeof frame>;
      try {
        if (isBinary) throw new Error("binary");
        const parsed = frame.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) throw new Error("shape");
        msg = parsed.data;
      } catch {
        log.warn("malformed frame ignored");
        return;
      }

      if (!conn) {
        if (msg.type !== "auth") {
          ws.close(4401, "auth required");
          return;
        }
        clearTimeout(authTimer);
        let sub: string | null = null;
        try {
          sub = await this.authenticate(msg.token);
        } catch {
          sub = null;
        }
        if (!sub) {
          ws.close(4401, "auth invalid");
          return;
        }
        conn = this.register(ws, sub, msg.instanceId);
        ws.send(JSON.stringify({ type: "auth_ok", userId: sub }));
        log.info({ sub: hashSub(sub) }, "extension connected");
        return;
      }

      conn.lastSeen = Date.now();
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (msg.type === "forget") {
        this.onForget?.(conn.sub).catch(() => log.warn("forget failed"));
      } else if (msg.type === "result") {
        const result: CallResult = msg.ok
          ? { ok: true, data: msg.data }
          : {
              ok: false,
              error: {
                code: (KNOWN_CODES as readonly string[]).includes(msg.error?.code ?? "")
                  ? (msg.error!.code as (typeof KNOWN_CODES)[number])
                  : "INTERNAL",
                message: msg.error?.message ?? "Easy Note reported an error.",
              },
            };
        if (!this.calls.complete(conn.sub, msg.id, result)) log.warn("result for unknown call ignored");
      }
      // a second auth frame on an authenticated socket is ignored
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (conn) this.unregister(conn);
    });
    ws.on("error", () => ws.terminate());
  }

  private register(ws: WebSocket, sub: string, instanceId: string): Connection {
    const conn: Connection = { id: crypto.randomUUID(), ws, sub, instanceId, lastSeen: Date.now() };
    let conns = this.byUser.get(sub);
    if (!conns) this.byUser.set(sub, (conns = new Map()));
    const old = conns.get(instanceId);
    conns.set(instanceId, conn);
    old?.ws.close(1000, "replaced");
    return conn;
  }

  private unregister(conn: Connection): void {
    const conns = this.byUser.get(conn.sub);
    // a replaced connection must not evict its replacement
    if (conns?.get(conn.instanceId) === conn) {
      conns.delete(conn.instanceId);
      if (conns.size === 0) this.byUser.delete(conn.sub);
    }
    this.calls.failConnection(conn.id);
  }

  private sweep(): void {
    const cutoff = Date.now() - STALE_MS;
    for (const conns of this.byUser.values()) {
      for (const c of conns.values()) {
        if (c.lastSeen < cutoff) {
          // terminate, not close: a half-open socket never finishes the close handshake
          c.ws.terminate();
          this.unregister(c);
        }
      }
    }
  }
}
