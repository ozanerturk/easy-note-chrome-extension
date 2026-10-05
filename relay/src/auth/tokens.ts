import { createHash, createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { SignJWT, importPKCS8, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Db } from "../db/index.js";

export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ALG = "RS256";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export type Tokens = ReturnType<typeof createTokens>;

export function createTokens(opts: { privateKeyPem: string; baseUrl: string; db: Db }) {
  const { baseUrl, db } = opts;
  // the public half is derived, so there is one secret to configure
  const publicKey = createPublicKey(createPrivateKey(opts.privateKeyPem));
  const privateKey = importPKCS8(opts.privateKeyPem, ALG);

  return {
    async signAccess(sub: string, clientId: string): Promise<string> {
      return new SignJWT({ client_id: clientId })
        .setProtectedHeader({ alg: ALG })
        .setSubject(sub)
        .setIssuer(baseUrl)
        .setAudience(baseUrl)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TTL_S}s`)
        .sign(await privateKey);
    },

    // throws on anything that is not a live token we signed for this relay
    async verifyAccess(token: string): Promise<AuthInfo> {
      const { payload } = await jwtVerify(token, publicKey, { algorithms: [ALG], issuer: baseUrl, audience: baseUrl });
      if (typeof payload.sub !== "string" || typeof payload.exp !== "number") throw new Error("bad claims");
      return {
        token,
        clientId: String(payload.client_id ?? ""),
        scopes: [],
        expiresAt: payload.exp,
        extra: { sub: payload.sub },
      };
    },

    // only the hash is stored; the token itself is returned once
    issueRefresh(sub: string, clientId: string): string {
      const token = randomBytes(32).toString("base64url");
      db.addRefresh(sha256(token), sub, clientId, Date.now() + REFRESH_TTL_MS);
      return token;
    },

    // spends the old token and mints its replacement, or returns null
    rotateRefresh(token: string, clientId: string): { sub: string; refresh: string } | null {
      const row = db.findRefresh(sha256(token));
      if (!row || row.client_id !== clientId || row.revoked_at !== null || row.expires_at < Date.now()) return null;
      if (!db.revokeRefresh(row.token_hash)) return null;
      return { sub: row.sub, refresh: this.issueRefresh(row.sub, clientId) };
    },

    revokeRefresh(token: string, clientId: string): void {
      const row = db.findRefresh(sha256(token));
      if (row && row.client_id === clientId) db.revokeRefresh(row.token_hash);
    },
  };
}
