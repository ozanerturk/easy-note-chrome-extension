import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Db } from "../db/index.js";
import { log } from "../log.js";
import { ACCESS_TTL_S, type Tokens } from "./tokens.js";

const PENDING_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;

// where Claude may be sent back to: its hosted callback (claude.com is the
// announced successor of claude.ai) and loopback, which Claude Code and the
// MCP Inspector use on a port that changes every run
const CALLBACKS = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function redirectAllowed(uri: string): boolean {
  if (CALLBACKS.has(uri)) return true;
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

type Pending = { clientId: string; redirectUri: string; codeChallenge: string; clientState?: string; nonce: string; expires: number };
type Code = { sub: string; clientId: string; codeChallenge: string; redirectUri: string; expires: number };

// what the provider needs from Google, so tests can stand one in
export type GoogleIdentity = {
  authorizeUrl(state: string, nonce: string): string;
  subFromCode(code: string, nonce: string): Promise<string>;
};

const random = () => randomBytes(32).toString("base64url");

function prune<T extends { expires: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires < now) map.delete(k);
}

// The relay is the authorization server Claude talks to; Google only proves
// who the person is. Everything in between lives here, in memory, because a
// request that takes longer than ten minutes is a request that was abandoned.
export class RelayProvider implements OAuthServerProvider {
  private pending = new Map<string, Pending>();
  private codes = new Map<string, Code>();

  constructor(
    private deps: { db: Db; tokens: Tokens; google: GoogleIdentity },
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    const { db } = this.deps;
    return {
      getClient: (id) => db.getClient(id),
      registerClient: (client) => {
        const uris = (client.redirect_uris ?? []).map(String);
        if (!uris.length || !uris.every(redirectAllowed)) {
          throw new InvalidClientMetadataError("redirect_uris must be Claude's callback or a loopback address");
        }
        const full = client as OAuthClientInformationFull;
        db.saveClient(full);
        return full;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    prune(this.pending);
    const state = random();
    const nonce = random();
    this.pending.set(state, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      clientState: params.state,
      nonce,
      expires: Date.now() + PENDING_TTL_MS,
    });
    res.redirect(302, this.deps.google.authorizeUrl(state, nonce));
  }

  // Google sends the person back here. Whatever happens, they end up back at
  // Claude with either a code or an error, never stranded on the relay.
  async handleGoogleCallback(query: Record<string, unknown>, res: Response): Promise<void> {
    const state = typeof query.state === "string" ? query.state : "";
    const pending = this.pending.get(state);
    this.pending.delete(state); // single use
    if (!pending || pending.expires < Date.now()) {
      res.status(400).type("text/plain").send("This sign-in link has expired. Start again from Claude.");
      return;
    }

    const back = (params: Record<string, string>) => {
      const url = new URL(pending.redirectUri);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      if (pending.clientState) url.searchParams.set("state", pending.clientState);
      res.redirect(302, url.toString());
    };

    if (typeof query.error === "string" || typeof query.code !== "string") return back({ error: "access_denied" });

    try {
      const sub = await this.deps.google.subFromCode(query.code, pending.nonce);
      prune(this.codes);
      const code = random();
      this.codes.set(code, {
        sub,
        clientId: pending.clientId,
        codeChallenge: pending.codeChallenge,
        redirectUri: pending.redirectUri,
        expires: Date.now() + CODE_TTL_MS,
      });
      back({ code });
    } catch {
      log.warn("google sign-in failed");
      back({ error: "server_error" });
    }
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const entry = this.codes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id || entry.expires < Date.now()) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _verifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const entry = this.codes.get(authorizationCode);
    this.codes.delete(authorizationCode); // single use, whatever happens next
    if (!entry || entry.clientId !== client.client_id || entry.expires < Date.now()) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    if (redirectUri !== undefined && redirectUri !== entry.redirectUri) throw new InvalidGrantError("redirect_uri mismatch");
    return this.mint(entry.sub, client.client_id, this.deps.tokens.issueRefresh(entry.sub, client.client_id));
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const rotated = this.deps.tokens.rotateRefresh(refreshToken, client.client_id);
    if (!rotated) throw new InvalidGrantError("Invalid refresh token");
    return this.mint(rotated.sub, client.client_id, rotated.refresh);
  }

  async verifyAccessToken(token: string) {
    try {
      return await this.deps.tokens.verifyAccess(token);
    } catch {
      throw new InvalidTokenError("Invalid or expired token");
    }
  }

  async revokeToken(client: OAuthClientInformationFull, request: { token: string }): Promise<void> {
    this.deps.tokens.revokeRefresh(request.token, client.client_id);
  }

  private async mint(sub: string, clientId: string, refresh: string): Promise<OAuthTokens> {
    return {
      access_token: await this.deps.tokens.signAccess(sub, clientId),
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
    };
  }
}
