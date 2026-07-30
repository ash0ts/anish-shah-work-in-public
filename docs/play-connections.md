# Play connections: owner setup

The Play page publishes sanitized snapshots for MyAnimeList, Hardcover, and
Steam. Strava is different: it stays on Strava and loads its official embed
only after a visitor chooses to do so.

## 1. Prepare the protected Studio

Before saving a provider credential:

1. Provision the Sites D1 binding as `DB` and apply the checked-in migrations
   under `drizzle/`.
2. Set `OWNER_EMAILS` to the exact email address used with Sign in with
   ChatGPT. Authentication without an exact allowlist match cannot read or
   write Studio data.
3. For a brand-new environment only, generate a connector encryption key
   locally:

   ```bash
   openssl rand -base64 32
   ```

   Store the result as `CONNECTOR_ENCRYPTION_KEY` in the deployment
   environment. Never commit it. The existing production site already has
   this key configured: do not rotate or replace it during provider setup,
   because existing encrypted credentials would become unreadable.
4. For Steam, set `STEAM_DATA_STORAGE_COUNTRIES` to the truthful country or
   comma-separated countries where D1 stores the sanitized snapshots, for
   example `United States`. Values such as `global`, `unknown`, or `TBD` fail
   the release gate.
5. Deploy the environment changes, open `/studio`, and confirm the encryption
   and Steam notices are cleared.

The normal owner workflow is **Connect → Refresh now → confirm Current**.
Saving or replacing a credential does not publish a snapshot by itself.

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
