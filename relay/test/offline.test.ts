import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/index.js";
import { createVault } from "../src/auth/vault.js";
import { createDriveReader, type SyncedDoc } from "../src/drive/reader.js";
import { createRouter } from "../src/bridge/router.js";
import { createGoogle } from "../src/auth/google.js";
import { RelayProvider } from "../src/auth/provider.js";
import { createTokens } from "../src/auth/tokens.js";
import { Hub } from "../src/bridge/hub.js";
import type { CallResult } from "../src/bridge/calls.js";
import { generateKeyPairSync } from "node:crypto";

const key = () => randomBytes(32).toString("base64");
const NOW = Date.parse("2026-10-06T05:00:00Z"); // 08:00 in Istanbul

const doc: SyncedDoc = {
  pages: [
    { id: "p1", name: "Work", parentId: null },
    { id: "p2", name: "Trips", parentId: "p1" },
    { id: "capture-tray", name: "Captures", parentId: null },
  ],
  notes: [
    { id: "plan", pageId: "p2", html: "<h2>Trip plan</h2><ul><li><p>book flights</p></li></ul>", editedAt: 3, remindAt: Date.parse("2026-10-06T04:00:00Z") },
    { id: "milk", pageId: "p1", html: "<p>groceries: milk</p>", editedAt: 2, remindAt: Date.parse("2026-10-06T15:00:00Z") },
    { id: "tray", pageId: "capture-tray", html: "<p>secret trip</p>", editedAt: 1 },
    { id: "dead", pageId: "p1", html: "<p>deleted trip</p>", deleted: true },
    { id: "locked", pageId: "p1", html: "<p>locked trip secret</p>", locked: true, remindAt: Date.parse("2026-10-06T04:30:00Z") },
  ],
};

describe("vault", () => {
  it("round-trips and never stores the plain text", () => {
    const v = createVault(key());
    const sealed = v.seal("1//refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(v.open(sealed)).toBe("1//refresh-token");
  });
  it("seals the same text differently each time", () => {
    const v = createVault(key());
    expect(v.seal("x")).not.toBe(v.seal("x"));
  });
  it("does not open under another key, or when altered", () => {
    const sealed = createVault(key()).seal("secret");
    expect(createVault(key()).open(sealed)).toBeNull();
    const v = createVault(key());
    const good = v.seal("secret");
    const raw = Buffer.from(good, "base64");
    raw[raw.length - 1]! ^= 1;
    expect(v.open(raw.toString("base64"))).toBeNull();
    expect(v.open("not base64 at all")).toBeNull();
  });
  it("refuses a key that is not 32 bytes", () => {
    expect(() => createVault(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

function setup() {
  const db = openDb(":memory:");
  const vault = createVault(key());
  const google = {
    accessTokenFromRefresh: vi.fn(async () => ({ token: "access-1", expiresInS: 3600 }) as { token: string; expiresInS: number } | "revoked"),
    revoke: vi.fn(async () => {}),
  };
  const calls: string[] = [];
  const fetchSpy = vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("alt=media")) return { ok: true, json: async () => doc } as Response;
    return { ok: true, json: async () => ({ files: [{ id: "f1", size: "1000", modifiedTime: "2026-10-05T22:03:06.428Z" }] }) } as Response;
  });
  const reader = createDriveReader({ db, vault, google, fetch: fetchSpy as never });
  return { db, vault, google, fetchSpy, calls, reader };
}

describe("drive reader", () => {
  it("reads the document with a refreshed access token, and only ever GETs", async () => {
    const s = setup();
    s.db.saveCredential("u1", s.vault.seal("refresh"));
    const r = await s.reader.load("u1");
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.doc.notes).toHaveLength(5);
      expect(r.asOf).toBe(Date.parse("2026-10-05T22:03:06.428Z"));
    }
    expect(s.google.accessTokenFromRefresh).toHaveBeenCalledWith("refresh");
    for (const [, init] of s.fetchSpy.mock.calls) expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    expect(s.calls[0]).toContain("spaces=appDataFolder");
  });

  it("keeps the document in memory for a minute, and no longer", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.db.saveCredential("u1", s.vault.seal("refresh"));
    await s.reader.load("u1");
    await s.reader.load("u1");
    expect(s.fetchSpy).toHaveBeenCalledTimes(2); // one list + one download, once
    vi.setSystemTime(Date.now() + 61_000);
    await s.reader.load("u1");
    expect(s.fetchSpy).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("has nothing for someone who never allowed it", async () => {
    expect((await setup().reader.load("nobody")).status).toBe("none");
  });

  it("when Google says the access is gone, deletes the credential and asks them to reconnect", async () => {
    const s = setup();
    s.db.saveCredential("u1", s.vault.seal("refresh"));
    s.google.accessTokenFromRefresh.mockResolvedValueOnce("revoked");
    expect((await s.reader.load("u1")).status).toBe("reauth");
    expect(s.db.getCredential("u1")).toBeUndefined();
    expect((await s.reader.load("u1")).status).toBe("none");
  });

  it("drops a credential sealed with another key", async () => {
    const s = setup();
    s.db.saveCredential("u1", createVault(key()).seal("refresh"));
    expect((await s.reader.load("u1")).status).toBe("none");
    expect(s.db.getCredential("u1")).toBeUndefined();
  });

  it("lets go of a credential unused for 90 days", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.db.saveCredential("u1", s.vault.seal("refresh"));
    vi.setSystemTime(Date.now() + 91 * 24 * 3600 * 1000);
    expect((await s.reader.load("u1")).status).toBe("none");
    expect(s.db.getCredential("u1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("prunes old credentials in bulk", () => {
    vi.useFakeTimers();
    const s = setup();
    s.db.saveCredential("old", "x");
    vi.setSystemTime(Date.now() + 40 * 24 * 3600 * 1000);
    s.db.saveCredential("fresh", "x");
    expect(s.db.pruneCredentials(30 * 24 * 3600 * 1000)).toBe(1);
    expect(s.db.getCredential("old")).toBeUndefined();
    expect(s.db.getCredential("fresh")).toBeDefined();
    vi.useRealTimers();
  });

  it("reports a missing document and a failed read", async () => {
    const s = setup();
    s.db.saveCredential("u1", s.vault.seal("refresh"));
    s.fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) } as Response);
    expect((await s.reader.load("u1")).status).toBe("nodoc");
    s.fetchSpy.mockResolvedValueOnce({ ok: false } as Response);
    expect((await s.reader.load("u1")).status).toBe("error");
  });

  it("forget deletes the credential, revokes it at Google and drops the memory", async () => {
    const s = setup();
    s.db.saveCredential("u1", s.vault.seal("refresh"));
    await s.reader.load("u1");
    await s.reader.forget("u1");
    expect(s.db.getCredential("u1")).toBeUndefined();
    expect(s.google.revoke).toHaveBeenCalledWith("refresh");
    expect((await s.reader.load("u1")).status).toBe("none");
  });
});

describe("router", () => {
  const live = (r: CallResult) => ({ call: vi.fn(async () => r) });
  const offline = { ok: false, error: { code: "NOT_CONNECTED", message: "Easy Note isn't connected." } } as CallResult;
  const withDrive = () => {
    const s = setup();
    s.db.saveCredential("u1", s.vault.seal("refresh"));
    return s;
  };

  it("prefers the open browser, and says so", async () => {
    const s = withDrive();
    const r = await createRouter({ hub: live({ ok: true, data: [1] }), drive: s.reader }).call("u1", "search_notes", { query: "x", limit: 5 });
    expect(r).toEqual({ ok: true, data: { source: "browser", asOf: null, result: [1] } });
    expect(s.fetchSpy).not.toHaveBeenCalled();
  });

  it("with no browser, answers a search from Drive and says when that copy was written", async () => {
    const s = withDrive();
    const r = await createRouter({ hub: live(offline), drive: s.reader }).call("u1", "search_notes", { query: "trip", limit: 10 });
    expect(r.ok).toBe(true);
    const d = (r as { data: { source: string; asOf: string; result: { id: string; pagePath: string }[] } }).data;
    expect(d.source).toBe("drive");
    expect(d.asOf).toBe("2026-10-05T22:03:06.428Z");
    expect(d.result.map((x) => x.id)).toEqual(["plan"]); // not the tray note, the deleted one, or the locked one
    expect(d.result[0]!.pagePath).toBe("Work › Trips");
  });

  it("falls back when the browser did not answer in time", async () => {
    const s = withDrive();
    const slow = { ok: false, error: { code: "TIMEOUT", message: "slow" } } as CallResult;
    expect((await createRouter({ hub: live(slow), drive: s.reader }).call("u1", "get_note", { id: "plan" })).ok).toBe(true);
  });

  it("reads one note offline, and a missing one is NOT_FOUND", async () => {
    const s = withDrive();
    const router = createRouter({ hub: live(offline), drive: s.reader });
    const ok = await router.call("u1", "get_note", { id: "plan" });
    expect((ok as { data: { result: { content: string } } }).data.result.content).toBe("Trip plan\n- book flights");
    for (const id of ["tray", "dead", "locked", "nope"]) {
      const r = await router.call("u1", "get_note", { id });
      expect(r.ok === false && r.error.code).toBe("NOT_FOUND");
    }
  });

  it("lists today's reminders offline, in the user's day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const s = withDrive();
    const r = await createRouter({ hub: live(offline), drive: s.reader }).call("u1", "list_reminders", { when: "today", timezone: "Europe/Istanbul", limit: 50 });
    const res = (r as { data: { result: { id: string; due: boolean; remindAtLocal: string }[] } }).data.result;
    // the locked note has a reminder in range, and must not appear
    expect(res.map((x) => [x.id, x.due, x.remindAtLocal])).toEqual([["plan", true, "2026-10-06 07:00"], ["milk", false, "2026-10-06 18:00"]]);
    vi.useRealTimers();
  });

  it("never redirects a capture: it needs the browser", async () => {
    const s = withDrive();
    const r = await createRouter({ hub: live(offline), drive: s.reader }).call("u1", "capture", { text: "hi" });
    expect(r.ok === false && r.error.code).toBe("NOT_CONNECTED");
    expect(s.fetchSpy).not.toHaveBeenCalled();
  });

  it("does not hide a real error from the browser behind the Drive copy", async () => {
    const s = withDrive();
    const err = { ok: false, error: { code: "NOT_FOUND", message: "Note not found" } } as CallResult;
    expect(await createRouter({ hub: live(err), drive: s.reader }).call("u1", "get_note", { id: "x" })).toEqual(err);
    expect(s.fetchSpy).not.toHaveBeenCalled();
  });

  it("tells them how to fix it when there is no Drive access", async () => {
    const s = setup();
    const r = await createRouter({ hub: live(offline), drive: s.reader }).call("someone", "search_notes", { query: "x", limit: 5 });
    expect(r.ok === false && r.error.message).toMatch(/remove and add the Easy Note connector/);
  });

  it("with no Drive reader at all (dev), just passes the live answer through", async () => {
    expect(await createRouter({ hub: live(offline) }).call("u1", "search_notes", {})).toEqual(offline);
  });
});

describe("keeping the credential at sign-in, and forgetting it", () => {
  it("the Google sign-in asks for offline Drive access", () => {
    const g = createGoogle({ clientId: "web", clientSecret: "s", extensionClientId: "ext", baseUrl: "https://relay.test" });
    const q = new URL(g.authorizeUrl("st", "no")).searchParams;
    expect(q.get("scope")).toContain("https://www.googleapis.com/auth/drive.appdata");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toContain("consent");
  });

  it("the callback stores the refresh token sealed, not in the clear", async () => {
    const db = openDb(":memory:");
    const vault = createVault(key());
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
    const google = { authorizeUrl: (s: string, n: string) => `https://g.test/?state=${s}&nonce=${n}`, subFromCode: vi.fn(async () => ({ sub: "u9", refreshToken: "1//plain-refresh" })) };
    const provider = new RelayProvider({ db, tokens: createTokens({ privateKeyPem: pem, baseUrl: "https://relay.test", db }), google, vault });
    const res: { location: string; redirect: (s: number, u: string) => void } = { location: "", redirect(_s, u) { this.location = u; } };
    await provider.authorize({ client_id: "c1", redirect_uris: [] } as never, { redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: "c" }, res as never);
    const state = new URL(res.location).searchParams.get("state")!;
    await provider.handleGoogleCallback({ state, code: "x" }, res as never);
    const stored = db.getCredential("u9")!;
    expect(stored.sealed).not.toContain("plain-refresh");
    expect(vault.open(stored.sealed)).toBe("1//plain-refresh");
  });

  it("a forget frame from the signed-in extension reaches the reader", async () => {
    const { WebSocket } = await import("ws");
    const { createServer } = await import("node:http");
    const forgot = vi.fn(async () => {});
    const hub = new Hub(async (t) => t, forgot);
    const server = createServer();
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ type: "forget" })); // before auth: ignored, and it closes
    await new Promise((r) => ws.on("close", r));
    expect(forgot).not.toHaveBeenCalled();

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws2.on("open", () => r()));
    ws2.send(JSON.stringify({ type: "auth", token: "user-7", instanceId: "i" }));
    await new Promise((r) => ws2.on("message", r));
    ws2.send(JSON.stringify({ type: "forget" }));
    await vi.waitFor(() => expect(forgot).toHaveBeenCalledWith("user-7"));
    ws2.close();
    hub.shutdown();
    server.close();
  });
});
