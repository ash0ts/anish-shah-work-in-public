# Play connections: owner setup

The protected Studio connects four personal streams without putting credentials
in source code, deployment artifacts, public APIs, or browser storage.

## Credential map

| Stream | Provider | Obtain from provider | Enter in Studio | Verification |
| --- | --- | --- | --- | --- |
| Watch | MyAnimeList | Client ID and client secret | Both app credentials, then approve OAuth | **Refresh now → Current** |
| Read | Hardcover | Personal API token | Token, with or without `Bearer` | **Refresh now → Current** |
| Play | Steam | Web API key and 17-digit SteamID64 | Both values | **Refresh now → Current** |
| Move | Strava | Official public embed | URL or complete iframe snippet | Save, then consent-load it on Play |

MyAnimeList is the important distinction: its developer portal correctly gives
you a **client ID** and **client secret**. Those identify the application.
Studio sends you to MyAnimeList for owner approval and exchanges the returned
authorization code for access and refresh tokens. Do not paste the client
secret into a token field or try to create an access token manually.

For every API-backed stream, the verification sequence is **Connect or
authorize → Refresh now → confirm Current**. Saving a credential alone does not
prove that the provider accepted it.

## Local Studio and production Studio

Local and production are isolated on purpose:

| | Local Studio | Production Studio |
| --- | --- | --- |
| Address | `http://localhost:3000/studio` | [Private HTTPS Studio](https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site/studio) |
| Identity | Loopback-only development owner | Sign in with ChatGPT + exact owner allowlist |
| Database | Project-local D1 in `.wrangler/state` | Sites-managed D1 |
| Encryption | Local-only key | Existing production key; do not rotate |
| Credentials | Test credentials or a separate local registration | Re-enter through HTTPS Studio |
| Propagation | Nothing copies to production | Refresh publishes a sanitized snapshot |

### Start the local Studio

Run:

```bash
cd "/Users/ashah/Documents/New project/anish-site"
npm install
test -f .env.local || cp .env.example .env.local
openssl rand -base64 32
```

Open `.env.local` and set:

```dotenv
OWNER_EMAILS=your-owner-email@example.com
LOCAL_OWNER_EMAIL=your-owner-email@example.com
CONNECTOR_ENCRYPTION_KEY=<the newly generated local-only value>
STEAM_DATA_STORAGE_COUNTRIES=United States
SITE_URL=http://localhost:3000
```

`LOCAL_OWNER_EMAIL` must exactly match an address in `OWNER_EMAILS`. Never add
`LOCAL_OWNER_EMAIL` to production, and never replace the production encryption
key with this local key.

Start the strict localhost server:

```bash
npm run dev:studio
```

Open [http://localhost:3000/studio](http://localhost:3000/studio). Stop another
process already using port 3000 rather than accepting a different port:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

The page must say **Local sandbox** before you enter anything. Local provider
calls reach the real provider, but credentials, snapshots, and audit history
stay in the local D1 sandbox.

### Promote safely

1. Validate locally with `npm run lint && npm test`.
2. Deploy code, migrations, and intentional non-secret settings.
3. Preserve the existing production `CONNECTOR_ENCRYPTION_KEY`,
   `OWNER_EMAILS`, D1 binding, site URL, and private access policy.
4. Set production `STEAM_DATA_STORAGE_COUNTRIES=United States`. Never set
   `LOCAL_OWNER_EMAIL`.
5. Open the production HTTPS Studio and enter each credential again.
6. Refresh MyAnimeList, Hardcover, and Steam; confirm **Current** and inspect
   `/play`. Save Strava, then consent-load it on `/play`.

Code propagates. Credentials do not. Never copy `.env.local`,
`.wrangler/state`, encrypted D1 rows, or a local encryption key to production.

## MyAnimeList

Use separate MyAnimeList API clients for local and production.

### Local client

1. Open the [MyAnimeList developer portal](https://myanimelist.net/apiconfig)
   and create or edit the local application.
2. Register this exact callback:

   ```text
   http://localhost:3000/api/connectors/myanimelist/oauth/callback
   ```

3. In local Studio, copy the callback shown in the Watch panel and confirm it
   matches character for character.
4. Enter the client ID and client secret, then select **Authorize with
   MyAnimeList**.
5. Sign in to the owner MyAnimeList account and approve access. MyAnimeList
   returns to Studio; no token should appear in the URL or interface.
6. Select **Refresh now**, confirm **Current**, and inspect Watch on the local
   Play page.

### Production client

1. Create a separate production application in the same developer portal.
2. Register this exact callback:

   ```text
   https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site/api/connectors/myanimelist/oauth/callback
   ```

3. Enter that application’s client ID and client secret only in the production
   HTTPS Studio and complete approval.
4. Select **Refresh now** and confirm **Current**.

Studio encrypts the client secret, access token, and refresh token. It refreshes
access shortly before expiry, persists rotated refresh tokens, and retries once
after an authorization failure. If MyAnimeList revokes access or rejects the
refresh token, Studio reports **Reauthorization required**:

- Choose **Authorize again** to reuse the stored application registration.
- Choose **Replace app credentials** only if the client ID or secret changed.
- If authorization was denied or the ten-minute attempt expired, start it
  again from Studio.
- If callback verification fails, keep the same Studio tab, verify the exact
  callback registration, and start again.

The public Watch snapshot contains only bounded, sanitized list summaries and a
profile link derived from the authorized MyAnimeList identity.

## Hardcover

1. Read the [official Hardcover API setup guide](https://docs.hardcover.app/api/getting-started/)
   and copy the token from [Hardcover account → API](https://hardcover.app/account/api).
2. In the Read panel, paste either the bare token or `Bearer <token>`.
3. Select **Connect**, then **Refresh now**.
4. Confirm **Current** and inspect Read on `/play`.

The server normalizes the authorization value and derives the public profile
link from the authenticated identity. Hardcover documents that tokens expire
after one year, reset on January 1, and may be reset without notice while the
API is in beta; its current limit is 60 requests per minute. If Hardcover
returns 401, copy a current token, choose **Replace credential**, and refresh.
If rate-limited, wait before retrying—the last successful snapshot remains
live.

## Steam

1. Read the [Steam Web API overview](https://partner.steamgames.com/doc/webapi_overview).
2. Set both **Profile** and **Game details** to Public in Steam privacy
   settings.
3. Register a standard owner Web API key at
   [Steam Web API key registration](https://steamcommunity.com/dev/apikey).
4. Locate the owner’s 17-digit SteamID64.
5. Confirm the site truthfully declares
   `STEAM_DATA_STORAGE_COUNTRIES=United States`.
6. Enter the API key and SteamID64 in the Play panel, select **Connect**, then
   **Refresh now**.
7. Confirm **Current** and inspect Play on `/play`.

The public snapshot contains rounded totals and no more than eight top-played
and eight recent games. It excludes exact minutes, presence, friends, bans,
achievements, inventories, real name, location, artwork, and raw provider
payloads. If Game details becomes private, a refresh immediately unpublishes
the Steam stream. Retry 429 responses later rather than repeatedly refreshing.

## Strava

Strava uses neither an API credential nor a custom API visualization.

1. Follow Strava’s [official embed instructions](https://support.strava.com/en-us/articles/15402053-sharing-your-activities-and-routes-with-a-strava-embed).
2. Copy one current public activity, route, or activity-feed embed.
3. In the Move panel, paste either:
   - its `https://strava-embeds.com/...` source URL, or
   - the complete single `<iframe ...>` snippet, including a snippet that spans
     multiple lines.
4. Select **Save Strava embed**.
5. Open Move on `/play`, choose to load third-party content, and inspect the
   result.

Studio extracts and stores only the source URL. It rejects non-HTTPS or legacy
hosts, URL credentials, explicit ports, fragments, scripts, and multi-element
snippets. Replacing the embed does not require a deployment. Visitors still
must consent before any Strava request or iframe loads.

## Routes, retention, and recovery

| Purpose | Route | Owner request |
| --- | --- | --- |
| Start MyAnimeList OAuth | `POST /api/connectors/myanimelist/oauth/start` | `{ "clientId": "…", "clientSecret": "…" }`, or `{}` to reauthorize |
| Finish MyAnimeList OAuth | `GET /api/connectors/myanimelist/oauth/callback` | Provider redirect only |
| Save/replace Hardcover | `POST /api/connectors/hardcover/credentials` | `{ "secret": "…" }` |
| Save/replace Steam | `POST /api/connectors/steam/credentials` | `{ "apiKey": "…", "steamId64": "…" }` |
| Refresh an API stream | `POST /api/connectors/[provider]/refresh` | No body |
| Read a public API stream | `GET /api/connectors/[provider]` | No owner credential |
| Save/replace Strava | `PUT /api/connectors/strava/config` | `{ "embed": "URL or iframe" }` |
| Read public Strava config | `GET /api/connectors/strava` | No owner credential |
| Disconnect API stream | `DELETE /api/connectors/[provider]/credentials` | No body |
| Disconnect Strava | `DELETE /api/connectors/strava/config` | No body |

Every write requires same-origin access, Sign in with ChatGPT or the constrained
local-development owner, and an exact email allowlist match. API credentials
use AES-256-GCM encryption with provider-bound associated data. OAuth state is
single-use, owner-bound, encrypted, and expires after ten minutes.

A transient provider failure preserves the latest known-good eligible snapshot.
Disconnect is different: it deletes that provider’s credentials, snapshots,
pending OAuth state, sync history, and provider-specific audit history, then
unpublishes the stream.

Do not paste credentials into source files, deployment variables intended for
browser code, D1 consoles, screenshots, issues, or chat. Rotate
`CONNECTOR_ENCRYPTION_KEY` only as part of a planned full credential reset;
existing ciphertext cannot be decrypted with a different key.
