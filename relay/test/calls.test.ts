import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Calls } from "../src/bridge/calls.js";

describe("Calls", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the result for the matching user", async () => {
    const calls = new Calls();
    let id = "";
    const p = calls.start("alice", "c1", (callId) => (id = callId));
    expect(calls.complete("alice", id, { ok: true, data: { hi: 1 } })).toBe(true);
    expect(await p).toEqual({ ok: true, data: { hi: 1 } });
    expect(calls.pendingFor("alice")).toBe(0);
  });

  it("times out after 10s and frees the slot", async () => {
    const calls = new Calls();
    const p = calls.start("alice", "c1", () => {});
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(r.ok === false && r.error.code).toBe("TIMEOUT");
    expect(calls.pendingFor("alice")).toBe(0);
  });

  it("fails pending calls when their connection closes", async () => {
    const calls = new Calls();
    const a = calls.start("alice", "c1", () => {});
    const b = calls.start("alice", "c2", () => {});
    calls.failConnection("c1");
    const ra = await a;
    expect(ra.ok === false && ra.error.code).toBe("NOT_CONNECTED");
    expect(calls.pendingFor("alice")).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await b;
  });

  it("rejects a result from another user and keeps the call pending", async () => {
    const calls = new Calls();
    let id = "";
    const p = calls.start("alice", "c1", (callId) => (id = callId));
    expect(calls.complete("mallory", id, { ok: true, data: "forged" })).toBe(false);
    expect(calls.pendingFor("alice")).toBe(1);
    expect(calls.complete("alice", id, { ok: true, data: "real" })).toBe(true);
    expect(await p).toEqual({ ok: true, data: "real" });
  });

  it("ignores results for unknown ids", () => {
    expect(new Calls().complete("alice", "nope", { ok: true, data: 1 })).toBe(false);
  });

  it("caps pending calls at 5 per user with BUSY", async () => {
    const calls = new Calls();
    for (let i = 0; i < 5; i++) void calls.start("alice", "c1", () => {});
    const r = await calls.start("alice", "c1", () => {});
    expect(r.ok === false && r.error.code).toBe("BUSY");
    // another user is unaffected
    void calls.start("bob", "c2", () => {});
    expect(calls.pendingFor("bob")).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
  });

  it("fails at once if sending throws", async () => {
    const calls = new Calls();
    const r = await calls.start("alice", "c1", () => {
      throw new Error("socket closed");
    });
    expect(r.ok === false && r.error.code).toBe("INTERNAL");
    expect(calls.pendingFor("alice")).toBe(0);
  });
});
