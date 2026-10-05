import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the one secret the relay keeps: a user's Google refresh
// token. Authenticated, so a tampered or wrongly-keyed value fails to open
// instead of opening to garbage. Layout: base64( iv(12) | tag(16) | ciphertext ).
export type Vault = ReturnType<typeof createVault>;

export function createVault(keyBase64: string) {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_KEY must be 32 bytes, base64 encoded");

  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
    },
    // null when it was not sealed with this key, or was altered
    open(sealed: string): string | null {
      try {
        const raw = Buffer.from(sealed, "base64");
        const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        d.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
