# Play connections: owner setup

The Play page publishes sanitized snapshots for MyAnimeList, Hardcover, and
Steam. Strava is different: it stays on Strava and loads its official embed
only after a visitor chooses to do so.

## 1. Prepare and test the protected Studio

Local and production Studio are deliberately separate environments:

| | Local Studio | Production Studio |
| --- | --- | --- |
| Identity | Development-only localhost owner | Sign in with ChatGPT + owner allowlist |
| Database | Project-local D1 under `.wrangler/state` | Sites-managed D1 |
| Encryption | Disposable local-only key | Existing production key; never rotate during setup |
| Provider credentials | Enter for testing only | Re-enter over the deployed HTTPS Studio |
| Propagation | Nothing is copied automatically | A refresh publishes a sanitized production snapshot |

### Test locally

1. In the project directory, install dependencies and create an ignored local
   environment file if one does not already exist:

   ```bash
   npm install
   test -f .env.local || cp .env.example .env.local
   openssl rand -base64 32
   ```

2. Put the generated value in `.env.local` as
   `CONNECTOR_ENCRYPTION_KEY`. Configure the remaining local gates:

   ```dotenv
   OWNER_EMAILS=your-owner-email@example.com
   LOCAL_OWNER_EMAIL=your-owner-email@example.com
   CONNECTOR_ENCRYPTION_KEY=<new local-only key>
   STEAM_DATA_STORAGE_COUNTRIES=United States
   SITE_URL=http://localhost:3000
   ```

   Use the actual Steam storage country. `LOCAL_OWNER_EMAIL` must exactly match
   an address in `OWNER_EMAILS`. It is accepted only during development from
   `localhost`, `127.0.0.1`, or `[::1]`; never add it to Sites.
3. Create or update the isolated local database, then start the site:

   ```bash
   npm run dev:studio
   ```

   `dev:studio` applies pending migrations, then starts the site. Its migration
   wrapper always includes Wrangler’s `--local` flag, uses a placeholder
   database identity, and stores state under `.wrangler/state`. It cannot
   mutate the Sites production database.
4. Open `/studio` on the exact localhost URL printed by the development
   server. The page must show **Local sandbox** before you enter a credential.
5. For each provider, use **Connect → Refresh now → confirm Current**. These
   calls reach the real provider, but the encrypted credential and resulting
   snapshot remain in the local D1 sandbox.

Saving or replacing a credential does not publish a snapshot by itself.

### Promote a tested connection safely

Local credentials and D1 rows never propagate—and should never be copied—to
production. Promote the site in this order:

1. Run `npm test`, then deploy the validated code and intended non-secret
   configuration through Sites.
2. Keep the existing production `CONNECTOR_ENCRYPTION_KEY`. Do not replace it
   with the local key; doing so would make existing production credentials
   unreadable.
3. Configure production gates such as `OWNER_EMAILS`,
   `STEAM_DATA_STORAGE_COUNTRIES`, profile URLs, and the Strava embed through
   Sites. Do not configure `LOCAL_OWNER_EMAIL` in production.
4. Open the
   [production HTTPS Studio](https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site/studio)
   and sign in with the allowlisted ChatGPT account.
5. Paste the provider credential again into the production connector card,
   choose **Connect** or **Replace credential**, then choose **Refresh now**.
   Confirm **Current** and inspect `/play`.

This split is the security boundary: code and allowlisted configuration deploy;
secrets are entered directly into the environment that will store them.

## 2. MyAnimeList

1. Create or open an API client in the
   [MyAnimeList developer portal](https://myanimelist.net/apiconfig).
2. Complete MyAnimeList’s OAuth authorization-code flow outside this site and
   obtain the owner access token. This project intentionally has no public
   OAuth callback and does not store a refresh token.
3. In Studio, paste the access token into MyAnimeList and select **Connect**.
   A bare token or a value prefixed with `Bearer` is accepted.
4. Select **Refresh now**. Optionally set
   `MYANIMELIST_PROFILE_URL=https://myanimelist.net/profile/<owner>` so the
   public snapshot links to the owner profile.
5. When Studio reports an expired credential, obtain a current access token,
   choose **Replace credential**, and refresh again. Renewal is manual.

The public snapshot can include up to the 500 most recently updated list
entries, reduced to watch-state counts, genres, eras, and a short recent list.

## 3. Hardcover

1. Copy the owner token from
   [Hardcover account → API](https://hardcover.app/account/api).
2. Paste the token into Studio with or without the `Bearer` prefix. The server
   normalizes it to `Bearer <token>` before encryption and before every
   provider request.
3. Select **Connect**, then **Refresh now**. Optionally set
   `HARDCOVER_PROFILE_URL=https://hardcover.app/@<owner>`.
4. If Hardcover returns 401, copy a current token, choose
   **Replace credential**, and refresh again.

The public snapshot uses at most the 250 most recently updated books and
publishes reading-state counts plus a short recent list. Raw provider payloads
and credentials never enter the public response.

## 4. Steam

1. Read the [Steam Web API documentation](https://steamcommunity.com/dev) and
   create an owner key at [Register a Steam Web API key](https://steamcommunity.com/dev/apikey).
2. Find the owner’s 17-digit SteamID64. Steam’s
   [account-link help](https://help.steampowered.com/en/faqs/view/2816-BE67-5B69-0FEC)
   explains where account details are shown.
3. In Steam privacy settings, set both the profile and **Game details** to
   Public. The key is 32 hexadecimal characters; SteamID64 is 17 digits.
4. Confirm `STEAM_DATA_STORAGE_COUNTRIES` is truthful, then enter both fields
   in Studio, select **Connect**, and select **Refresh now**.

Steam publishes rounded library totals and at most eight top-played and eight
recent games. It excludes exact minutes, presence, friends, bans,
achievements, inventories, real name, location, artwork, and the raw payload.
Only the latest two sanitized snapshots are retained, and a public snapshot
expires after 72 hours. If Game details becomes private, refresh immediately
unpublishes the Steam stream. Disconnecting Steam deletes its encrypted
credential, snapshots, and Steam-specific sync history.

## 5. Strava

Strava has no Studio credential and this site does not ingest Strava API data.

1. Follow Strava’s
   [official activity and route embed guide](https://support.strava.com/en-us/articles/15402053-sharing-your-activities-and-routes-with-a-strava-embed).
2. Copy the current `https://strava-embeds.com/...` iframe source into
   `NEXT_PUBLIC_STRAVA_EMBED_URL`. Other hosts and legacy embed formats are
   rejected.
3. Redeploy. The Play page still withholds all third-party content until the
   visitor selects Move and chooses **Load public Strava activity**.

## API and retention reference

| Purpose | Route | Owner request body |
| --- | --- | --- |
| Read a public snapshot | `GET /api/connectors/[provider]` | None |
| Save or replace MyAnimeList/Hardcover | `POST /api/connectors/[provider]/credentials` | `{ "secret": "…" }` |
| Save or replace Steam | `POST /api/connectors/steam/credentials` | `{ "apiKey": "…", "steamId64": "…" }` |
| Refresh now | `POST /api/connectors/[provider]/refresh` | None |
| Disconnect | `DELETE /api/connectors/[provider]/credentials` | None |

Every write route requires Sign in with ChatGPT, the exact owner allowlist,
and a same-origin request. Credentials use AES-256-GCM with provider-bound
associated data. MyAnimeList and Hardcover preserve the last successful public
snapshot if a refresh fails or the credential is removed. Steam uses the
stricter 72-hour, visibility, and deletion rules above.

Public requests can trigger a stale refresh, but never more than once per
12-hour refresh window. Provider failure does not replace a known-good
snapshot.

## Rotation and recovery

- Rotate `CONNECTOR_ENCRYPTION_KEY` only with a planned credential reset:
  existing ciphertext cannot be decrypted with a new key. Replace every
  provider credential after rotation.
- Use **Replace credential** rather than disconnecting when only a token or key
  changed.
- For rate limits, wait and retry; repeated manual refreshes do not bypass
  provider limits.
- Never paste credentials into source files, D1 consoles, screenshots, issue
  trackers, or browser-visible environment variables.
