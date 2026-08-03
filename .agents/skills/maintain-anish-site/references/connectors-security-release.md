# Connectors, Security, and Release

## Provider Model

- MyAnimeList and Spotify use owner-only OAuth with separate local and production applications.
- Hardcover uses an owner API token.
- Steam uses a Web API key plus SteamID64 and requires a truthful storage-country setting.
- Strava stores a validated public profile and optional official embed through `lib/server/strava-config.ts`; it is not part of the generic `ConnectorProvider` repository.
- Public connector JSON must pass the provider-specific allowlist in `lib/server/connectors/public-payload-policy.ts`.
- Provider artwork uses host-free stored references resolved by the publication-aware artwork endpoint. Never expose or accept an arbitrary remote image proxy.

## Owner Write Pattern

For a JSON owner mutation:

1. Reject cross-origin writes with `rejectCrossOriginWrite(request)`.
2. Authorize the verified owner with `authorizeOwnerApi()`.
3. Read JSON with `readBoundedJsonBody()` and an endpoint-specific byte limit.
4. Validate an exact object shape and reject unknown or secret-bearing public fields.
5. Return `private, no-store` and sanitized errors.

Create canonical mutations under `/api/studio/**`. Existing `/api/connectors/**` credential, refresh, OAuth-start, and Strava-config routes are compatibility redirects; do not use them in new client code.

OAuth callbacks remain public because providers must reach them. Bind each callback to encrypted, owner-bound, single-use state with a ten-minute expiry, exact redirect URI, replay protection, fixed safe Studio redirects, token refresh/rotation, and sanitized failure states. Never include codes or tokens in logs, audit details, redirects, or client bundles.

## Local and Production Isolation

- Local Studio runs on loopback with local D1 and a local-only encryption key.
- Production Studio requires a verified Cloudflare Access JWT and an exact match in `OWNER_EMAILS`.
- Never set `LOCAL_OWNER_EMAIL` in hosted environments.
- Never copy local D1 state or replace the production encryption key.
- The one-time promotion flow may transfer reviewed Hardcover, Steam, and Strava setup over HTTPS. It never transfers snapshots, local encryption, MyAnimeList credentials/tokens, Spotify credentials/tokens, or Spotify publication approval.
- Reauthorize MyAnimeList and Spotify separately in production against their exact production callbacks.

## Publication and Deletion

- Publish only sanitized snapshots and retain the provider-specific bounded history.
- Direct production commits the active publication in D1 and advances a
  versioned `PUBLICATION_CACHE` KV pointer only after D1 succeeds. Invalid or
  unavailable D1 and KV state returns a noindexed `503`, never the full static
  bundle.
- Preserve last-known-good data only within its documented stale/publication window.
- Disconnect must delete credentials or configuration, snapshots, pending OAuth state, sync history, and provider-specific audit records, then unpublish the stream.
- Keep third-party frames consent-gated and CSP allowlists exact.
- Update public Privacy copy and tests when retrieval, storage, retention, disclosure, or deletion behavior changes.

## Cloudflare Release Boundary

Public production is the owner-controlled Cloudflare Worker with D1 and the
versioned `PUBLICATION_CACHE` KV fallback. The existing Sites deployment stays
private as a reference/recovery environment. Do not request workspace-admin
access, expose a bypass token, proxy Sites publicly, or weaken either access
policy.

Deployment is an explicit external mutation. Perform it only when directly requested and follow `docs/operations/release.md`:

1. Start from a reviewed clean source state.
2. Run the complete validation gate.
3. Prepare the generated Worker config without `LOCAL_OWNER_EMAIL` or embedded secrets, run the final bundle scan, and write the deterministic deployable-artifact manifest.
4. Preserve the production encryption key; set secrets separately.
5. Require every guarded mutation to recheck the exact `dist/client` and `dist/server` artifact set; apply only planned new migrations and stage the candidate at 0%.
6. Verify health, D1/KV publication, and the release marker through the candidate version override before promotion.
7. Smoke-test public pages logged out, protected owner routes logged out, and owner Studio while authenticated.
8. Roll back the Worker version on failure; restore D1 separately only with explicit confirmation. Do not weaken Access or change the private Sites environment.
