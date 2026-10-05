# Easy Note relay

A thin relay between Claude and the Easy Note extension. Claude talks MCP over
HTTPS to `/mcp`; the relay forwards each tool call over a WebSocket to the
user's open extension, which answers from their local notes. The relay never
stores or logs note content — only OAuth bookkeeping (registered clients and
hashed refresh tokens) in a SQLite file.

```
Claude ──MCP + OAuth──▶ relay ──WebSocket──▶ Easy Note service worker
```

## Settings

All in `.env` (see `.env.example`); validated at startup, and the relay exits with a clear message if one is missing.

| Variable | |
|---|---|
| `PORT` | default 3000 |
| `NODE_ENV` | `production` on the server |
| `RELAY_PUBLIC_BASE_URL` | the public address, e.g. `https://relay.easynote.tayfai.tech` |
| `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_WEB_CLIENT_SECRET` | the relay's own Google OAuth client (type *Web application*). Redirect URI: `<base url>/oauth/google/callback` |
| `EXTENSION_GOOGLE_CLIENT_ID` | the extension's OAuth client (`manifest.json` → `oauth2.client_id`); sockets are only accepted with tokens issued to it |
| `JWT_PRIVATE_KEY` | PKCS8 PEM, one line with literal `\n` is fine. `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` |
| `CREDENTIAL_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Seals the Google refresh tokens the relay keeps. Required; the relay will not start without it. If it is lost or changed those tokens cannot be opened and people just reconnect once |
| `DATABASE_URL` | SQLite file, `file:relay.db` locally; the container sets `file:/data/relay.db` itself |
| `DEV_USER` | development only, skips sign-in. The relay refuses to start if it is set in production |

## Run locally

```
npm install
cp .env.example .env     # fill it in; leave DEV_USER blank to use real Google sign-in
npm run dev
```

- `npm test` — unit tests.
- `npx tsx scripts/fake-extension.ts` — stands in for the extension (needs `DEV_USER`).
- `npx tsx scripts/oauth-smoke.ts` — plays Claude through the real sign-in and checks tokens and refresh rotation.

To point the extension at a local relay, set `relayUrl: "ws://localhost:3000/ws"` on the `bridge` record in the extension's `meta` store (dev builds only; packaged builds strip this).

## Deploy (Docker over ssh)

One instance only — the socket registry lives in the process. Scaling out would need a shared backplane.

The image is `node:24-slim`, multi-stage, runs as the non-root `node` user, and keeps its SQLite file on a docker volume (`/data`). `docker-compose.yml` publishes it on `127.0.0.1:3000` for Caddy, which runs on the host.

### First deploy, once

On the server:

1. Docker with the compose plugin, and Caddy.
2. Create the folder and its settings by hand — `.env` is never copied by the deploy script and is kept out of the image:
   ```
   mkdir -p ~/easynote-relay
   nano ~/easynote-relay/.env      # RELAY_PUBLIC_BASE_URL, the Google ids and secret, EXTENSION_GOOGLE_CLIENT_ID,
                                   # JWT_PRIVATE_KEY as ONE line with literal \n, no DEV_USER,
                                   # CREDENTIAL_KEY (openssl rand -base64 32), and keep a copy of it somewhere safe
   chmod 600 ~/easynote-relay/.env
   ```
   `NODE_ENV` and `DATABASE_URL` are set by `docker-compose.yml`, so whatever `.env` says for them is ignored. `PORT` here is the port **on the server** that Caddy proxies to (default 3000); inside the container the relay always uses 3000.
3. Put `Caddyfile.example` into the server's Caddyfile and reload Caddy. The DNS record for `relay.easynote.tayfai.tech` has to point at the server first so Caddy can get the certificate.

In Google Cloud, the relay's web client needs `https://relay.easynote.tayfai.tech/oauth/google/callback` among its redirect URIs.

### Every deploy

From this folder, on your machine:

```
DEPLOY_HOST=user@server npm run deploy
```

It runs the tests and type check, copies the source, runs `docker compose up -d --build` on the server and checks `/healthz`. Set `DEPLOY_PATH` if the folder isn't `~/easynote-relay` (an absolute path such as `/opt/easynote-relay` works). If port 3000 is taken on the server, set `PORT=<port>` in its `.env` and use the same port in Caddy's `reverse_proxy`.

### Day to day

```
ssh user@server 'cd easynote-relay && docker compose logs -f'   # method, path, status, duration — no content
ssh user@server 'cd easynote-relay && docker compose restart'
```

A restart drops every extension's socket; they reconnect on their own within a minute. The database survives rebuilds; to wipe it, `docker compose down -v`.

### Trying the image locally

```
docker compose up --build        # needs a .env here, with RELAY_PUBLIC_BASE_URL=http://localhost:3000
```

## Add it to Claude

Claude → Settings → Connectors → add a custom connector with `https://relay.easynote.tayfai.tech/mcp`, and sign in with the Google account Easy Note uses. In Easy Note, open the ☁ panel and turn on **Connect to Claude** (Chrome has to be open).

## What it will and won't do

Four tools: `search_notes`, `get_note`, `list_reminders` and `capture` (appends to the Capture Tray). It never edits or deletes notes.

Every answer says where it came from: `{ source: "browser" | "drive", asOf, result }`.

**With Chrome closed** the three reads are answered from the user's own Google Drive copy instead. At sign-in the relay also asks for the `drive.appdata` scope with offline access, and keeps the refresh token **sealed** (AES-256-GCM, `CREDENTIAL_KEY`) in `google_credentials`. When no browser is connected it refreshes an access token, reads `easynote.json` from the app data folder, answers, and keeps nothing of the notes: the parsed document is held in memory for a minute, never written down. Only `GET`s are ever made, though Google has no read-only app-data scope, so the token could do more than the code does.

- The copy is as fresh as the last sync, which runs every two minutes while an Easy Note tab is open. `asOf` is when the file was last written.
- The text read out of pictures is cached on the device only, so it is missing from Drive answers.
- `capture` needs the browser and is never redirected: doing it twice is worse than not doing it.
- The credential is deleted when the user switches Connect to Claude off (the extension sends `forget`, and the relay revokes the token at Google), when Google says access was removed, and after 90 days unused.
- The reading logic is a TypeScript copy of the extension's (`src/shared`); `test/parity.test.ts` runs both over the same inputs and fails if they differ.
