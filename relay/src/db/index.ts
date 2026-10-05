import Database from "better-sqlite3";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

// the only data the relay keeps: who registered, and refresh tokens (hashed)
const SCHEMA = `
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_info TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
`;

export type RefreshRow = { token_hash: string; sub: string; client_id: string; expires_at: number; revoked_at: number | null };

export type Db = ReturnType<typeof openDb>;

// "file:relay.db" or a plain path; ":memory:" for tests
export function openDb(url: string) {
  const path = url.startsWith("file:") ? url.slice("file:".length) : url;
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const getClient = db.prepare("SELECT client_info FROM oauth_clients WHERE client_id = ?");
  const putClient = db.prepare("INSERT INTO oauth_clients (client_id, client_info, created_at) VALUES (?, ?, ?)");
  const putRefresh = db.prepare("INSERT INTO refresh_tokens (token_hash, sub, client_id, expires_at) VALUES (?, ?, ?, ?)");
  const getRefresh = db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?");
  // the WHERE makes "use" atomic: only one caller can ever flip a live token to revoked
  const spend = db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL");

  return {
    getClient(clientId: string): OAuthClientInformationFull | undefined {
      const row = getClient.get(clientId) as { client_info: string } | undefined;
      return row ? (JSON.parse(row.client_info) as OAuthClientInformationFull) : undefined;
    },
    saveClient(info: OAuthClientInformationFull): void {
      putClient.run(info.client_id, JSON.stringify(info), Date.now());
    },
    addRefresh(hash: string, sub: string, clientId: string, expiresAt: number): void {
      putRefresh.run(hash, sub, clientId, expiresAt);
    },
    findRefresh(hash: string): RefreshRow | undefined {
      return getRefresh.get(hash) as RefreshRow | undefined;
    },
    // true if this call is the one that spent it
    revokeRefresh(hash: string): boolean {
      return spend.run(Date.now(), hash).changes === 1;
    },
    close(): void {
      db.close();
    },
  };
}
