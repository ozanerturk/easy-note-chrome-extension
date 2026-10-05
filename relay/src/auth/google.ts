import { createRemoteJWKSet, jwtVerify } from "jose";
import { sha256 } from "./tokens.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKENINFO_URL = "https://www.googleapis.com/oauth2/v3/tokeninfo";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX = 1000;

export type Google = ReturnType<typeof createGoogle>;

export function createGoogle(opts: {
  clientId: string;
  clientSecret: string;
  extensionClientId: string;
  baseUrl: string;
  fetch?: typeof fetch;
}) {
  const doFetch = opts.fetch ?? fetch;
  const jwks = createRemoteJWKSet(new URL(JWKS_URL));
  const callback = `${opts.baseUrl}/oauth/google/callback`;
  // sha256(token) -> sub, until
  const cache = new Map<string, { sub: string; until: number }>();

  return {
    authorizeUrl(state: string, nonce: string): string {
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: callback,
        response_type: "code",
        scope: "openid email",
        state,
        nonce,
        // let the user pick which Google account is theirs
        prompt: "select_account",
      }).toString();
      return url.toString();
    },

    // trades the code for an ID token, checks it, and returns the account's sub
    async subFromCode(code: string, nonce: string): Promise<string> {
      const res = await doFetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: callback,
          grant_type: "authorization_code",
        }),
      });
      if (!res.ok) throw new Error(`google token exchange failed (${res.status})`);
      const { id_token } = (await res.json()) as { id_token?: string };
      if (!id_token) throw new Error("google returned no id_token");
      const { payload } = await jwtVerify(id_token, jwks, { issuer: ISSUERS, audience: opts.clientId });
      if (payload.nonce !== nonce) throw new Error("nonce mismatch");
      if (typeof payload.sub !== "string") throw new Error("id_token has no sub");
      return payload.sub;
    },

    // the extension's Google access token -> that account's sub, or null.
    // only tokens issued to the extension's own OAuth client are accepted.
    async validateExtensionAccessToken(token: string): Promise<string | null> {
      const key = sha256(token);
      const hit = cache.get(key);
      if (hit && hit.until > Date.now()) return hit.sub;
      cache.delete(key);

      // POST, so the token is in the body and not in a URL anyone logs
      const res = await doFetch(TOKENINFO_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: token }),
      });
      if (!res.ok) return null;
      const info = (await res.json()) as { azp?: string; aud?: string; sub?: string; user_id?: string; expires_in?: string | number };
      if ((info.azp ?? info.aud) !== opts.extensionClientId) return null;
      const expiresIn = Number(info.expires_in);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
      const sub = info.sub ?? info.user_id;
      if (!sub) return null;

      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { sub, until: Date.now() + Math.min(CACHE_MS, expiresIn * 1000) });
      return sub;
    },
  };
}
