# Play connections: owner setup

The protected Studio connects five personal streams without putting credentials
in source code, deployment artifacts, public APIs, or browser storage.

## Credential map

| Stream | Provider | Obtain from provider | Enter in Studio | Verification |
| --- | --- | --- | --- | --- |
| Watch | MyAnimeList | Client ID and client secret | Both app credentials, then approve OAuth | **Refresh now → Current** |
| Read | Hardcover | Personal API token | Token, with or without `Bearer` | **Refresh now → Current** |
| Listen | Spotify | Client ID and client secret | Both app credentials, then approve OAuth | **Refresh now → Current**, then review publication |
| Play | Steam | Web API key and 17-digit SteamID64 | Both values | **Refresh now → Current** |
| Move | Strava | Public athlete URL and optional cumulative feed | Athlete URL + complete generated profile-feed/summary iframe | Save; Play uses the checked feed or profile-link fallback |

MyAnimeList is the important distinction: its developer portal correctly gives
you a **client ID** and **client secret**. Those identify the application.
Studio sends you to MyAnimeList for owner approval and exchanges the returned
authorization code for access and refresh tokens. Do not paste the client
secret into a token field or try to create an access token manually.

Spotify follows the same application-then-authorization pattern. Its Top
Tracks response is an affinity ranking for the selected time window, not a
play-count history. Studio never requests listening history or derives minutes,
genres, trends, or a taste profile from Spotify data.

For every API-backed stream, the verification sequence is **Connect or
authorize → Refresh now → confirm Current**. Saving a credential alone does not
prove that the provider accepted it.

## Local Studio and production Studio

Local and production are isolated on purpose:

| | Local Studio | Production Studio |
| --- | --- | --- |
| Address | `http://localhost:3000/studio` | `${PRODUCTION_SITE_URL}/studio` on the public Worker |
| Identity | Loopback-only development owner | Cloudflare Access + exact owner allowlist |
| Database | Project-local D1 in `.wrangler/state` | Owner-controlled Cloudflare D1 |
| Encryption | Local-only key | Existing production key; do not rotate |
| Credentials | Test credentials or a separate local registration | Re-encrypted after explicit production review |
| Propagation | One-time server-to-server handoff | Validation publishes a sanitized snapshot |

### Start the local Studio

Run:

```bash
cd "/path/to/anish-site"
npm install --global npm@11.6.2 --ignore-scripts
npm ci
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
PRODUCTION_SITE_URL=https://anish-shah-is.online
```

`LOCAL_OWNER_EMAIL` must exactly match an address in `OWNER_EMAILS`. Never add
`LOCAL_OWNER_EMAIL` to production, and never replace the production encryption
key with this local key.

Provider credentials and profile URLs are intentionally not loaded from
`.env` or `.env.local`. Variables such as `MAL_CLIENT_ID`,
`MAL_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
`HARDCOVER_API_KEY`, `STEAM_API_KEY`, provider profile URLs, and
`NEXT_PUBLIC_STRAVA_EMBED_URL` do not connect a stream. Enter those
values through Studio instead; the API-backed credentials are encrypted in D1,
profile links are derived from the authenticated provider identity, and Strava
stores only its validated athlete and generated embed URLs.

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
3. Open the Access-protected production Studio and select **Create one-time
   transfer code**. The code expires after ten minutes and works once.
4. Paste that code into **Local → production** in the local Studio and select
   **Stage in production**. The local server—not the browser—decrypts the local
   Hardcover, Steam, and Strava settings and sends them to the exact
   `PRODUCTION_SITE_URL` over HTTPS.
5. Return to production Studio. Review the provider names, then select
   **Validate and apply**. Production calls each provider before replacing its
   current credential or snapshot, encrypts accepted credentials with the
   production key, and leaves existing production state unchanged for a
   provider that fails validation.
6. Authorize MyAnimeList and Spotify separately with their production API
   clients, then inspect all five streams on `/play`.

The transfer never includes MyAnimeList or Spotify app credentials or OAuth
tokens, Spotify snapshots or publication approval, any provider snapshots,
audit history, `.wrangler/state`, or the local encryption key. A
staged payload expires after thirty minutes. Production does not publish it
until the allowlisted owner applies it.

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
   https://anish-shah-is.online/api/connectors/myanimelist/oauth/callback
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

The server stores a complete sanitized Watch snapshot so the distributions are
not biased toward recent updates. The public endpoint sends whole-library
distributions plus only the requested 12, 24, or 36-title gallery page and a
profile link derived from the authorized MyAnimeList identity.

## Hardcover

1. Read the [official Hardcover API setup guide](https://docs.hardcover.app/api/getting-started/)
   and copy the token from [Hardcover account → API](https://hardcover.app/account/api).
2. In the Read panel, paste either the bare token or `Bearer <token>`.
3. Select **Connect**, then **Refresh now**.
4. Confirm **Current** and inspect Read on `/play`.

The server normalizes the authorization value, retrieves the complete sanitized
shelf, and derives the public profile link from the authenticated identity. The
public endpoint sends whole-shelf distributions plus only one bounded gallery
page. Hardcover documents that tokens expire after one year, reset on January
1, and may be reset without notice while the API is in beta; its current limit
is 60 requests per minute. If Hardcover returns 401, copy a current token,
choose **Replace credential**, and refresh. If rate-limited, wait before
retrying—the last successful snapshot remains live.

## Spotify

Use separate Spotify applications for local and production. Spotify does not
accept `localhost` as an OAuth redirect host; the local callback must use the
explicit loopback address `127.0.0.1` even when Studio itself is already open
at `localhost`.

### Local application

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and create the local application.
2. In the application settings, register this exact redirect URI:

   ```text
   http://127.0.0.1:3000/api/connectors/spotify/oauth/callback
   ```

3. Confirm the application owner has an active Spotify Premium subscription,
   then add the owner Spotify account to the application’s development-mode
   user allowlist. Both are required for a development-mode app to function.
4. In local Studio, open **Listen · Spotify** and confirm its callback matches
   the value above. Enter the local client ID and client secret, then select
   **Authorize with Spotify**.
5. Approve the two displayed permissions for the owner account. Spotify returns
   through `127.0.0.1`; the local owner session accepts either loopback host.
6. Select **Refresh now**, confirm **Current**, and inspect Listen on the local
   Play page.
7. Optionally add an official Spotify track, album, or playlist URL as the
   fallback. Leave **Publish Top Tracks publicly** off during initial testing.

### Production application and publication review

1. Create a separate production application in the Spotify dashboard.
2. Register this exact redirect URI:

   ```text
   https://anish-shah-is.online/api/connectors/spotify/oauth/callback
   ```

3. Enter the production client ID and secret only in the Cloudflare
   Access-protected production Studio. Authorize the owner account there.
4. Select **Refresh now** and confirm **Current** before changing publication.
5. Review the displayed qualification and select the acknowledgement that the
   public site will show Spotify-calculated Top Tracks affinity rather than
   play counts. Then enable **Publish Top Tracks publicly** and save.
6. Open Listen in a logged-out browser. Confirm the ranked list, Spotify
   attribution, direct track links, and consent-gated official player.

Studio requests `user-top-read` and `user-read-private`. It discards country,
subscription, account identifiers, popularity, raw responses, and preview
URLs. It keeps only the current twelve-track rankings for Spotify’s approximate
four-week, six-month, and one-year windows. The ranking order is preserved; the
site does not compare windows or infer play counts, listening time, genres,
trends, or a listener profile.

The fallback accepts only a complete official
`https://open.spotify.com/track/...`, `/album/...`, or `/playlist/...` URL or
the corresponding official embed URL. It is displayed only after visitor
consent. Spotify decides whether and how much audio is playable; the site never
downloads preview audio or promises a fixed clip length.

Spotify refresh tokens expire six months after the original authorization; a
normal refresh does not extend that lifetime. If Studio reports
**Reauthorization required**, select **Authorize again** to reuse the stored
application and create a new authorization. Replace the app credentials only
when the client ID or secret changed. A 403 commonly means the application
owner no longer has Premium or the authorized account is not on the
development-mode allowlist; a 429 requires waiting for the provider’s
`Retry-After` interval. A failed refresh preserves the last eligible snapshot,
but API-derived Top Tracks are unpublished after 72 hours without a successful
refresh and deleted after 30 days. Disconnect deletes credentials, tokens,
snapshots, OAuth state, sync history, fallback, and publication approval.

Spotify is deliberately excluded from the local-to-production transfer.
Deploy code normally, then authorize and review the separate production
application in production Studio.

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

The server stores the complete public library with rounded playtime so its
totals and distribution are accurate. The public endpoint sends only one
bounded gallery page plus no more than eight top-played and eight recent games.
It excludes exact minutes, presence, friends, bans, achievements, inventories,
real name, location, remote artwork URLs, and raw provider payloads. Official
game icons are reduced to host-free references and served through the bounded
same-origin artwork endpoint. If Game details becomes
private, a refresh immediately unpublishes the Steam stream. Retry 429 responses
later rather than repeatedly refreshing.

## Strava

Strava uses neither an API credential nor a custom API visualization.

1. Follow Strava’s [official embed instructions](https://support.strava.com/en-us/articles/15402053-sharing-your-activities-and-routes-with-a-strava-embed).
2. In Studio’s Move panel, enter the public athlete URL, such as
   `https://www.strava.com/athletes/37597587`.
3. If Strava offers a recent profile feed or weekly summary, paste its complete
   generated iframe. Keep the tokenized URL exactly as Strava generated it.
4. Select **Save Strava settings**. Studio makes one anonymous, no-redirect
   health check and records whether the iframe is currently frameable.
5. Open Move on `/play`. If the check passed, choose to load third-party
   content; otherwise verify the prominent athlete-profile link.
Studio never executes pasted markup. It recognizes only exact generated
`www.strava.com/athletes/.../latest-rides/...`, `activity-summary`, numeric
`strava-embeds.com` activity, or route embed paths. Private-share query parameters, unrelated
paths, non-HTTPS URLs, URL credentials, ports, fragments, and unrecognized
iframe attributes are rejected. If a profile feed redirects to sign-in or
blocks framing, the widget remains visible only to the owner for recovery and
Play uses the public profile-link fallback. Replacing it requires no deployment.

The public site does not fetch, copy, aggregate, or custom-visualize Strava API
data. The official iframe remains the only Strava display surface.

## Routes, retention, and recovery

| Purpose | Route | Owner request |
| --- | --- | --- |
| Start MyAnimeList OAuth | `POST /api/studio/connectors/myanimelist/oauth/start` | `{ "clientId": "…", "clientSecret": "…" }`, or `{}` to reauthorize |
| Finish MyAnimeList OAuth | `GET /api/connectors/myanimelist/oauth/callback` | Provider redirect only |
| Start Spotify OAuth | `POST /api/studio/connectors/spotify/oauth/start` | `{ "clientId": "…", "clientSecret": "…" }`, or `{}` to reauthorize |
| Finish Spotify OAuth | `GET /api/connectors/spotify/oauth/callback` | Provider redirect only |
| Review Spotify display | `GET /api/studio/connectors/spotify/config` | No body |
| Save Spotify display | `PUT /api/studio/connectors/spotify/config` | `{ "publishTopTracks": false, "fallbackEmbed": "optional official URL" }`; publishing also requires explicit acknowledgement |
| Save/replace Hardcover | `POST /api/studio/connectors/hardcover/credentials` | `{ "secret": "…" }` |
| Save/replace Steam | `POST /api/studio/connectors/steam/credentials` | `{ "apiKey": "…", "steamId64": "…" }` |
| Refresh an API stream | `POST /api/studio/connectors/[provider]/refresh` | No body |
| Read a public API stream | `GET /api/connectors/[provider]` | No owner credential |
| Save/replace Strava | `PUT /api/studio/connectors/strava/config` | `{ "profileUrl": "…", "embed": "optional iframe" }` |
| Read public Strava config | `GET /api/connectors/strava` | No owner credential |
| Disconnect API stream | `DELETE /api/studio/connectors/[provider]/credentials` | No body |
| Disconnect Strava | `DELETE /api/studio/connectors/strava/config` | No body |
| Issue one-time promotion code | `POST /api/studio/play-promotion/start` | No body; production only |
| Stage local provider settings | `POST /api/studio/play-promotion/send` | `{ "transferCode": "…" }`; loopback only |
| Review promotion queue | `GET /api/studio/play-promotion` | No body; production only |
| Validate and apply promotion | `POST /api/studio/play-promotion/[id]/apply` | No body; production only |

Every production write requires same-origin access, a verified Cloudflare Access
session, and an exact email allowlist match. Local development uses only the
constrained loopback owner. API credentials
use AES-256-GCM encryption with provider-bound associated data. OAuth state is
single-use, owner-bound, encrypted, and expires after ten minutes.
Promotion codes also expire after ten minutes. A staged encrypted payload has
a 30-minute review window, is cleared on the next hourly retention pass after
expiry, and its transaction row is deleted within 24 hours of creation.

A transient provider failure preserves the latest known-good eligible snapshot.
Disconnect is different: it deletes that provider’s credentials, snapshots,
pending OAuth state, sync history, and provider-specific audit history, then
unpublishes the stream.

Do not paste credentials into source files, deployment variables intended for
browser code, D1 consoles, screenshots, issues, or chat. Rotate
`CONNECTOR_ENCRYPTION_KEY` only as part of a planned full credential reset;
existing ciphertext cannot be decrypted with a different key.
