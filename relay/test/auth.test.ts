import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogle } from "../src/auth/google.js";
import { RelayProvider, redirectAllowed } from "../src/auth/provider.js";
import { createTokens } from "../src/auth/tokens.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";

const BASE = "https://relay.test";
const pem = () =>
  generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;

const client = { client_id: "c1", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] } as never;
const other = { client_id: "c2", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] } as never;

function setup() {
  const db = openDb(":memory:");
  const tokens = createTokens({ privateKeyPem: pem(), baseUrl: BASE, db });
  const google = {
    authorizeUrl: (state: string, nonce: string) => `https://google.test/auth?state=${state}&nonce=${nonce}`,
    subFromCode: vi.fn(async () => "google-sub-1"),
  };
  return { db, tokens, google, provider: new RelayProvider({ db, tokens, google }) };
}

// a fake express Response that records the redirect
const fakeRes = () => {
  const res = { location: "", status: 0, redirect: vi.fn((s: number, url: string) => { res.status = s; res.location = url; }) };
  return res;
};

// walks authorize -> google callback and returns the code the client would get
async function signIn(s: ReturnType<typeof setup>, challenge: string) {
  const a = fakeRes();
  await s.provider.authorize(client, { redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: challenge, state: "client-state" }, a as unknown as Response);
  const state = new URL(a.location).searchParams.get("state")!;
  const b = fakeRes();
  await s.provider.handleGoogleCallback({ state, code: "google-code" }, b as unknown as Response);
  return { state, back: new URL(b.location) };
}

describe("access tokens", () => {
  it("round-trips sub and client", async () => {
    const { tokens } = setup();
    const info = await tokens.verifyAccess(await tokens.signAccess("sub-1", "c1"));
    expect(info.extra).toEqual({ sub: "sub-1" });
    expect(info.clientId).toBe("c1");
  });

  it("rejects a token signed by another key", async () => {
    const a = setup(), b = setup();
    await expect(b.tokens.verifyAccess(await a.tokens.signAccess("sub-1", "c1"))).rejects.toThrow();
  });

  it("rejects a token meant for another relay", async () => {
    const db = openDb(":memory:");
    const key = pem();
    const mine = createTokens({ privateKeyPem: key, baseUrl: BASE, db });
    const theirs = createTokens({ privateKeyPem: key, baseUrl: "https://elsewhere.test", db });
    await expect(mine.verifyAccess(await theirs.signAccess("sub-1", "c1"))).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    const { tokens } = setup();
    const t = await tokens.signAccess("sub-1", "c1");
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    await expect(tokens.verifyAccess(t)).rejects.toThrow();
    vi.useRealTimers();
  });

  it("rejects garbage", async () => {
    await expect(setup().tokens.verifyAccess("nope")).rejects.toThrow();
  });
});

describe("refresh tokens", () => {
  it("are stored hashed", () => {
    const { db, tokens } = setup();
    const token = tokens.issueRefresh("sub-1", "c1");
    expect(db.findRefresh(token)).toBeUndefined();
    expect(db.findRefresh(createHash("sha256").update(token).digest("hex"))?.sub).toBe("sub-1");
  });

  it("rotate on use, and the old one is rejected", () => {
    const { tokens } = setup();
    const first = tokens.issueRefresh("sub-1", "c1");
    const second = tokens.rotateRefresh(first, "c1");
    expect(second?.sub).toBe("sub-1");
    expect(second?.refresh).not.toBe(first);
    expect(tokens.rotateRefresh(first, "c1")).toBeNull();
    expect(tokens.rotateRefresh(second!.refresh, "c1")).not.toBeNull();
  });

  it("are bound to the client that got them", () => {
    const { tokens } = setup();
    expect(tokens.rotateRefresh(tokens.issueRefresh("sub-1", "c1"), "c2")).toBeNull();
  });

  it("expire after 30 days", () => {
    vi.useFakeTimers();
    const { tokens } = setup();
    const t = tokens.issueRefresh("sub-1", "c1");
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(tokens.rotateRefresh(t, "c1")).toBeNull();
    vi.useRealTimers();
  });

  it("an unknown token is rejected", () => {
    expect(setup().tokens.rotateRefresh("never-issued", "c1")).toBeNull();
  });
});

describe("authorization flow", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  it("sends the person to Google, then back to Claude with a code and Claude's own state", async () => {
    const { back } = await signIn(s, "challenge");
    expect(back.origin + back.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(back.searchParams.get("state")).toBe("client-state");
    expect(back.searchParams.get("code")).toBeTruthy();
  });

  it("a code is bound to its client, its PKCE challenge, and works once", async () => {
    const { back } = await signIn(s, "challenge");
    const code = back.searchParams.get("code")!;
    await expect(s.provider.challengeForAuthorizationCode(other, code)).rejects.toThrow();
    expect(await s.provider.challengeForAuthorizationCode(client, code)).toBe("challenge");

    const tokens = await s.provider.exchangeAuthorizationCode(client, code, undefined, "https://claude.ai/api/mcp/auth_callback");
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect((await s.provider.verifyAccessToken(tokens.access_token)).extra).toEqual({ sub: "google-sub-1" });
    await expect(s.provider.exchangeAuthorizationCode(client, code)).rejects.toThrow();
  });

  it("rejects a code redeemed with a different redirect_uri", async () => {
    const { back } = await signIn(s, "challenge");
    await expect(s.provider.exchangeAuthorizationCode(client, back.searchParams.get("code")!, undefined, "https://evil.test/cb")).rejects.toThrow();
  });

  it("a code expires after 60s", async () => {
    vi.useFakeTimers();
    const { back } = await signIn(s, "challenge");
    vi.setSystemTime(Date.now() + 61_000);
    await expect(s.provider.challengeForAuthorizationCode(client, back.searchParams.get("code")!)).rejects.toThrow();
    vi.useRealTimers();
  });

  it("a pending sign-in is single use and expires after 10 minutes", async () => {
    const a = fakeRes();
    await s.provider.authorize(client, { redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: "c" }, a as unknown as Response);
    const state = new URL(a.location).searchParams.get("state")!;
    const first = fakeRes();
    await s.provider.handleGoogleCallback({ state, code: "x" }, first as unknown as Response);
    expect(first.status).toBe(302);
    const replay = { status: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn() };
    await s.provider.handleGoogleCallback({ state, code: "x" }, replay as unknown as Response);
    expect(replay.status).toHaveBeenCalledWith(400);

    vi.useFakeTimers();
    const b = fakeRes();
    await s.provider.authorize(client, { redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: "c" }, b as unknown as Response);
    const state2 = new URL(b.location).searchParams.get("state")!;
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const late = { status: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn() };
    await s.provider.handleGoogleCallback({ state: state2, code: "x" }, late as unknown as Response);
    expect(late.status).toHaveBeenCalledWith(400);
    vi.useRealTimers();
  });

  it("a Google failure goes back to Claude as an error, not a code", async () => {
    s.google.subFromCode.mockRejectedValueOnce(new Error("bad id token"));
    const { back } = await signIn(s, "challenge");
    expect(back.searchParams.get("error")).toBe("server_error");
    expect(back.searchParams.get("code")).toBeNull();
  });

  it("the person declining at Google goes back as access_denied", async () => {
    const a = fakeRes();
    await s.provider.authorize(client, { redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: "c", state: "st" }, a as unknown as Response);
    const state = new URL(a.location).searchParams.get("state")!;
    const b = fakeRes();
    await s.provider.handleGoogleCallback({ state, error: "access_denied" }, b as unknown as Response);
    expect(new URL(b.location).searchParams.get("error")).toBe("access_denied");
  });

  it("refresh through the provider rotates", async () => {
    const { back } = await signIn(s, "challenge");
    const t1 = await s.provider.exchangeAuthorizationCode(client, back.searchParams.get("code")!);
    const t2 = await s.provider.exchangeRefreshToken(client, t1.refresh_token!);
    expect(t2.refresh_token).not.toBe(t1.refresh_token);
    await expect(s.provider.exchangeRefreshToken(client, t1.refresh_token!)).rejects.toThrow();
  });
});

describe("client registration", () => {
  it("allows Claude's callbacks and loopback", () => {
    expect(redirectAllowed("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectAllowed("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(redirectAllowed("http://localhost:6274/oauth/callback")).toBe(true);
    expect(redirectAllowed("http://127.0.0.1:5555/callback")).toBe(true);
  });
  it("refuses everything else", () => {
    expect(redirectAllowed("https://evil.test/cb")).toBe(false);
    expect(redirectAllowed("https://claude.ai/other")).toBe(false);
    expect(redirectAllowed("http://claude.ai/api/mcp/auth_callback")).toBe(false);
    expect(redirectAllowed("https://localhost/cb")).toBe(false);
    expect(redirectAllowed("not a url")).toBe(false);
  });
  it("stores a client and reads it back, refusing a bad redirect", async () => {
    const { provider } = setup();
    const info = { client_id: "c9", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
    await provider.clientsStore.registerClient!(info as never);
    expect((await provider.clientsStore.getClient("c9"))?.client_id).toBe("c9");
    expect(() => provider.clientsStore.registerClient!({ redirect_uris: ["https://evil.test/cb"] } as never)).toThrow();
  });
});

describe("extension token validation", () => {
  const mk = (info: object | null, fetchSpy = vi.fn()) => {
    fetchSpy.mockImplementation(async () => ({ ok: info !== null, json: async () => info }));
    return { fetchSpy, google: createGoogle({ clientId: "web", clientSecret: "s", extensionClientId: "ext", baseUrl: BASE, fetch: fetchSpy as never }) };
  };

  it("accepts a token issued to the extension's client", async () => {
    const { google } = mk({ azp: "ext", sub: "s1", expires_in: "3000" });
    expect(await google.validateExtensionAccessToken("tok")).toBe("s1");
  });
  it("rejects a token issued to a different client", async () => {
    expect(await mk({ azp: "someone-else", sub: "s1", expires_in: "3000" }).google.validateExtensionAccessToken("tok")).toBeNull();
  });
  it("rejects expired, unknown, and sub-less tokens", async () => {
    expect(await mk({ azp: "ext", sub: "s1", expires_in: "0" }).google.validateExtensionAccessToken("tok")).toBeNull();
    expect(await mk(null).google.validateExtensionAccessToken("tok")).toBeNull();
    expect(await mk({ azp: "ext", expires_in: "100" }).google.validateExtensionAccessToken("tok")).toBeNull();
  });
  it("caches a success for 5 minutes", async () => {
    vi.useFakeTimers();
    const { google, fetchSpy } = mk({ azp: "ext", sub: "s1", expires_in: "3000" });
    await google.validateExtensionAccessToken("tok");
    await google.validateExtensionAccessToken("tok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
    await google.validateExtensionAccessToken("tok");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("sends the token in the body, never in the URL", async () => {
    const { google, fetchSpy } = mk({ azp: "ext", sub: "s1", expires_in: "3000" });
    await google.validateExtensionAccessToken("secret-token");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).not.toContain("secret-token");
    expect(String((init as RequestInit).body)).toContain("secret-token");
  });
});

describe("startup", () => {
  const base = { NODE_ENV: "production", RELAY_PUBLIC_BASE_URL: BASE, GOOGLE_WEB_CLIENT_ID: "a", GOOGLE_WEB_CLIENT_SECRET: "b", EXTENSION_GOOGLE_CLIENT_ID: "c", JWT_PRIVATE_KEY: "k", DATABASE_URL: "file:x.db" };
  it("refuses DEV_USER in production", () => {
    vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => loadConfig({ ...base, DEV_USER: "x" } as never)).toThrow("exit");
    vi.restoreAllMocks();
  });
  it("requires the real settings in production", () => {
    vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { JWT_PRIVATE_KEY: _drop, ...rest } = base;
    expect(() => loadConfig(rest as never)).toThrow("exit");
    vi.restoreAllMocks();
  });
  it("dev auth is on only in development with DEV_USER", () => {
    expect(loadConfig({ NODE_ENV: "development", RELAY_PUBLIC_BASE_URL: BASE, DEV_USER: "u" } as never).devAuth).toBe(true);
    expect(loadConfig(base as never).devAuth).toBe(false);
  });
  it("turns a one-line PEM with \\n back into lines", () => {
    expect(loadConfig({ ...base, JWT_PRIVATE_KEY: "a\\nb" } as never).real?.jwtPrivateKey).toBe("a\nb");
  });
});
