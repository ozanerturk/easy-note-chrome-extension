export type ErrorCode = "NOT_FOUND" | "INVALID_ARGS" | "INTERNAL" | "BUSY" | "NOT_CONNECTED" | "TIMEOUT";

export type CallResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

type Pending = {
  sub: string;
  connKey: string;
  resolve: (r: CallResult) => void;
  timer: NodeJS.Timeout;
};

export const CALL_TIMEOUT_MS = 10_000;
export const MAX_PENDING_PER_USER = 5;

const fail = (code: ErrorCode, message: string): CallResult => ({ ok: false, error: { code, message } });

// correlates relay→extension calls with their results; knows nothing about sockets
export class Calls {
  private pending = new Map<string, Pending>();

  constructor(
    private timeoutMs = CALL_TIMEOUT_MS,
    private maxPerUser = MAX_PENDING_PER_USER,
  ) {}

  pendingFor(sub: string): number {
    let n = 0;
    for (const p of this.pending.values()) if (p.sub === sub) n++;
    return n;
  }

  // `send` puts the frame on the wire; if it throws the call fails at once
  start(sub: string, connKey: string, send: (callId: string) => void): Promise<CallResult> {
    if (this.pendingFor(sub) >= this.maxPerUser) {
      return Promise.resolve(fail("BUSY", "Too many calls in flight for this user. Try again in a moment."));
    }
    const id = crypto.randomUUID();
    return new Promise<CallResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(fail("TIMEOUT", "Easy Note didn't respond in time. The browser may be asleep; try again."));
      }, this.timeoutMs);
      this.pending.set(id, { sub, connKey, resolve, timer });
      try {
        send(id);
      } catch {
        this.settle(id, fail("INTERNAL", "Couldn't reach Easy Note."));
      }
    });
  }

  // a result only counts if it comes from the same user the call was made for
  complete(sub: string, id: string, result: CallResult): boolean {
    const p = this.pending.get(id);
    if (!p || p.sub !== sub) return false;
    this.settle(id, result);
    return true;
  }

  failConnection(connKey: string): void {
    for (const [id, p] of this.pending) {
      if (p.connKey === connKey) {
        this.settle(id, fail("NOT_CONNECTED", "Easy Note disconnected before it could answer. Try again."));
      }
    }
  }

  private settle(id: string, result: CallResult): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(result);
  }
}
