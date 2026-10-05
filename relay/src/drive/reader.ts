import type { Db } from "../db/index.js";
import type { Vault } from "../auth/vault.js";
import type { Google } from "../auth/google.js";
import { log } from "../log.js";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DOC_NAME = "easynote.json";
const MAX_BYTES = 8 * 1024 * 1024;
// the parsed document is kept in memory, never on disk, just long enough that
// a few questions in one conversation do not each fetch it again
const DOC_TTL_MS = 60_000;
const CACHE_MAX = 50;
// a credential nobody has used for this long is let go
export const CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type Note = { id: string; html?: string; pageId?: string; deleted?: boolean; remindAt?: number; editedAt?: number; updatedAt?: number };
export type Page = { id: string; name: string; parentId?: string | null; deleted?: boolean };
export type SyncedDoc = { notes: Note[]; pages: Page[] };

export type DriveResult =
  | { status: "ok"; doc: SyncedDoc; asOf: number }
  // never signed in with Drive access: the connector was added before this existed
  | { status: "none" }
  // Google no longer honours the stored access
  | { status: "reauth" }
  | { status: "nodoc" }
  | { status: "error" };

export type DriveReader = ReturnType<typeof createDriveReader>;

type GoogleAccess = Pick<Google, "accessTokenFromRefresh" | "revoke">;

// Reads a person's synced notes straight from their own Drive. It only ever
// GETs. Nothing of the notes is written down: the refresh token is kept sealed,
// and the document lives in memory for a moment.
export function createDriveReader(deps: { db: Db; vault: Vault; google: GoogleAccess; fetch?: typeof fetch }) {
  const doFetch = deps.fetch ?? fetch;
  const access = new Map<string, { token: string; until: number }>();
  const docs = new Map<string, { doc: SyncedDoc; asOf: number; at: number }>();

  const forgetMemory = (sub: string) => {
    access.delete(sub);
    docs.delete(sub);
  };

  async function accessToken(sub: string): Promise<string | "none" | "reauth"> {
    const hit = access.get(sub);
    if (hit && hit.until > Date.now()) return hit.token;

    const stored = deps.db.getCredential(sub);
    if (!stored) return "none";
    if (stored.lastUsedAt < Date.now() - CREDENTIAL_TTL_MS) {
      deps.db.deleteCredential(sub);
      return "none";
    }
    const refresh = deps.vault.open(stored.sealed);
    if (!refresh) {
      // sealed with a different key, or damaged: unusable, so it is dropped
      deps.db.deleteCredential(sub);
      return "none";
    }
    const got = await deps.google.accessTokenFromRefresh(refresh);
    if (got === "revoked") {
      deps.db.deleteCredential(sub);
      forgetMemory(sub);
      return "reauth";
    }
    access.set(sub, { token: got.token, until: Date.now() + (got.expiresInS - 120) * 1000 });
    return got.token;
  }

  return {
    async load(sub: string): Promise<DriveResult> {
      const cached = docs.get(sub);
      if (cached && Date.now() - cached.at < DOC_TTL_MS) return { status: "ok", doc: cached.doc, asOf: cached.asOf };

      try {
        const token = await accessToken(sub);
        if (token === "none" || token === "reauth") return { status: token };
        const auth = { authorization: `Bearer ${token}` };

        const listUrl = `${DRIVE}?${new URLSearchParams({
          spaces: "appDataFolder",
          q: `name = '${DOC_NAME}'`,
          fields: "files(id,size,modifiedTime)",
          pageSize: "1",
        })}`;
        const list = await doFetch(listUrl, { headers: auth });
        if (!list.ok) return { status: "error" };
        const file = ((await list.json()) as { files?: { id: string; size?: string; modifiedTime?: string }[] }).files?.[0];
        if (!file) return { status: "nodoc" };
        if (Number(file.size) > MAX_BYTES) return { status: "error" };

        const body = await doFetch(`${DRIVE}/${file.id}?alt=media`, { headers: auth });
        if (!body.ok) return { status: "error" };
        const raw = (await body.json()) as Partial<SyncedDoc>;
        const doc: SyncedDoc = { notes: Array.isArray(raw.notes) ? raw.notes : [], pages: Array.isArray(raw.pages) ? raw.pages : [] };
        const asOf = file.modifiedTime ? Date.parse(file.modifiedTime) : Date.now();

        if (docs.size >= CACHE_MAX) docs.delete(docs.keys().next().value!);
        docs.set(sub, { doc, asOf, at: Date.now() });
        deps.db.touchCredential(sub);
        return { status: "ok", doc, asOf };
      } catch {
        // no detail is logged: it could carry a response body
        log.warn("drive read failed");
        return { status: "error" };
      }
    },

    // the person turned it off, or disconnected: drop and revoke, and forget
    // whatever is in memory
    async forget(sub: string): Promise<void> {
      const stored = deps.db.getCredential(sub);
      deps.db.deleteCredential(sub);
      forgetMemory(sub);
      const refresh = stored && deps.vault.open(stored.sealed);
      if (refresh) await deps.google.revoke(refresh);
    },
  };
}
