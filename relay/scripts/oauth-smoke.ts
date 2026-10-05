// testing only: plays Claude. Registers, sends your browser through the real
// Google sign-in, trades the code for tokens, calls a tool, and checks that a
// refresh token rotates. Never prints a token.
//
//   npx tsx scripts/oauth-smoke.ts            # RELAY_BASE defaults to http://localhost:3000
import { createHash, randomBytes } from "node:crypto";
import { exec } from "node:child_process";
import { createServer } from "node:http";

const base = (process.env.RELAY_BASE ?? "http://localhost:3000").replace(/\/+$/, "");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });

// a loopback listener for the redirect, like Claude Code or the Inspector would have
const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const redirect = `http://127.0.0.1:${port}/callback`;

const reg = await (await fetch(`${base}/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "oauth-smoke", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
})).json() as { client_id?: string };
check("client registers", !!reg.client_id, JSON.stringify(reg));
const clientId = reg.client_id!;

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");
const url = `${base}/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state })}`;

console.log("\nopening your browser — sign in with Google (pick the account whose Easy Note you want to reach)\n");
exec(`open "${url}"`);

const code = await new Promise<string | null>((resolve) => {
  const timer = setTimeout(() => resolve(null), 180_000);
  server.on("request", (req, res) => {
    const q = new URL(req.url!, redirect).searchParams;
    res.end("Signed in. You can close this tab and go back to the terminal.");
    clearTimeout(timer);
    resolve(q.get("state") === state ? q.get("code") : null);
  });
});
server.close();
check("browser came back with a code and our state", !!code);
if (!code) process.exit(1);

const tok = await (await fetch(`${base}/token`, form({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect }))).json() as Record<string, string | number>;
check("code trades for tokens", typeof tok.access_token === "string" && typeof tok.refresh_token === "string", JSON.stringify(Object.keys(tok)));
check("access token lasts an hour", tok.expires_in === 3600);

const replay = await fetch(`${base}/token`, form({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect }));
check("the same code cannot be used twice", replay.status === 400);

const mcp = (access: string, body: unknown) =>
  fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${access}` }, body: JSON.stringify(body) });
const call = async (access: string) => {
  const res = await mcp(access, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_notes", arguments: { query: "a" } } });
  if (res.status !== 200) return { status: res.status, isError: true, text: "" };
  const line = (await res.text()).split("\n").find((l) => l.startsWith("data:"));
  const r = JSON.parse(line!.slice(5)).result;
  return { status: 200, isError: !!r.isError, text: String(r.content?.[0]?.text ?? "") };
};

const first = await call(tok.access_token as string);
check("the access token is accepted by /mcp", first.status === 200, `HTTP ${first.status}`);
if (first.isError && /isn't connected/.test(first.text)) {
  console.log("INFO  tool call says Easy Note isn't connected — expected if you signed in with a different Google account than the extension, or the extension toggle is off");
} else {
  check("tool call reached your extension and came back", !first.isError, first.text.slice(0, 120));
}

// rotation: r1 -> r2 works, r1 again does not, r2 -> r3 works
const r1 = tok.refresh_token as string;
const second = await (await fetch(`${base}/token`, form({ grant_type: "refresh_token", client_id: clientId, refresh_token: r1 }))).json() as Record<string, string>;
check("refresh token exchanges for a new pair", !!second.access_token && !!second.refresh_token && second.refresh_token !== r1);
const old = await fetch(`${base}/token`, form({ grant_type: "refresh_token", client_id: clientId, refresh_token: r1 }));
check("the old refresh token is now rejected", old.status === 400);
const third = await fetch(`${base}/token`, form({ grant_type: "refresh_token", client_id: clientId, refresh_token: second.refresh_token! }));
check("the new one still works", third.status === 200);

const bad = await mcp("garbage", { jsonrpc: "2.0", id: 1, method: "tools/list" });
check("a made-up token is refused with 401 and a resource_metadata header", bad.status === 401 && /resource_metadata=/.test(bad.headers.get("www-authenticate") ?? ""));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
