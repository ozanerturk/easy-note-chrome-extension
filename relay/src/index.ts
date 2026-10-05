import { createServer } from "node:http";
import express, { type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { Hub, type Authenticate } from "./bridge/hub.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { createGoogle } from "./auth/google.js";
import { RelayProvider } from "./auth/provider.js";
import { createTokens } from "./auth/tokens.js";
import { createVault } from "./auth/vault.js";
import { createDriveReader, CREDENTIAL_TTL_MS } from "./drive/reader.js";
import { createRouter } from "./bridge/router.js";
import { log, requestLog } from "./log.js";
import { mcpHandler, methodNotAllowed } from "./mcp/server.js";

// single instance only: the hub's registry and pending calls live in this process.
// scaling out would need a backplane so a call can reach a socket held by another node.

const cfg = loadConfig();
const baseUrl = new URL(cfg.baseUrl);
const mcpUrl = new URL(`${cfg.baseUrl}/mcp`);

const app = express();
// one proxy (Caddy) in front: without this every client looks like 127.0.0.1
// to the SDK's per-address rate limits
app.set("trust proxy", 1);
app.use(requestLog);
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

let authenticate: Authenticate;
let drive: ReturnType<typeof createDriveReader> | undefined;
let guard: RequestHandler[];

if (cfg.devAuth) {
  // development only: no sign-in, everything acts as DEV_USER
  log.warn("DEV_USER set: real auth is OFF");
  authenticate = async (token) => (token === cfg.DEV_USER ? token : null);
  guard = [
    (req, _res, next) => {
      (req as typeof req & { auth?: unknown }).auth = { token: "dev", clientId: "dev", scopes: [], extra: { sub: cfg.DEV_USER } };
      next();
    },
  ];
} else {
  const real = cfg.real!;
  const db = openDb(real.databaseUrl);
  const google = createGoogle({
    clientId: real.googleClientId,
    clientSecret: real.googleClientSecret,
    extensionClientId: real.extensionClientId,
    baseUrl: cfg.baseUrl,
  });
  const tokens = createTokens({ privateKeyPem: real.jwtPrivateKey, baseUrl: cfg.baseUrl, db });
  const vault = createVault(real.credentialKey);
  drive = createDriveReader({ db, vault, google });
  const provider = new RelayProvider({ db, tokens, google, vault });

  // credentials nobody has used for a long while are let go, at start and daily
  const prune = () => db.pruneCredentials(CREDENTIAL_TTL_MS);
  prune();
  setInterval(prune, 24 * 60 * 60 * 1000).unref();

  // /authorize, /token, /register, /revoke and both well-known documents
  app.use(mcpAuthRouter({ provider, issuerUrl: baseUrl, resourceServerUrl: mcpUrl, resourceName: "Easy Note" }));
  // RFC 9728 also lets clients ask for the resource document at the root
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({ resource: mcpUrl.href, authorization_servers: [cfg.baseUrl], resource_name: "Easy Note" });
  });
  app.get("/oauth/google/callback", (req, res) => {
    void provider.handleGoogleCallback(req.query, res);
  });

  authenticate = (token) => google.validateExtensionAccessToken(token);
  guard = [
    requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) }),
    // after sign-in, so the limit is per person, not per address
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => String(req.auth?.extra?.sub ?? "anonymous"),
    }),
  ];
}

const hub = new Hub(authenticate, drive ? (sub) => drive!.forget(sub) : undefined);
const router = createRouter({ hub, drive });

// the body is only read once we know who is asking
app.post("/mcp", ...guard, express.json({ limit: "1mb" }), mcpHandler(router));
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const server = createServer(app);
hub.attach(server);
server.listen(cfg.PORT, () => log.info({ port: cfg.PORT, env: cfg.NODE_ENV }, "relay listening"));

// SIGTERM from `docker stop`, SIGINT from Ctrl-C in development
function shutdown() {
  log.info("shutting down");
  hub.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
