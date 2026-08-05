# Security and privacy reporting

> Policy last reviewed: **2026-08-05**. Reverify the supported-environment
> statements after any hosting, Access, production-origin, or recovery change.

## Reporting

Report a suspected security, privacy, or accessibility issue privately through
[Anish Shah on LinkedIn](https://www.linkedin.com/in/anish-shah). Do not put
credentials, OAuth codes, provider payloads, private source material, or
sensitive personal data in an issue or PR.

This personal repository has no public bug-bounty program and makes no
response-time guarantee. A useful report includes the affected surface,
non-sensitive reproduction steps, observed behavior, and potential impact.

## Supported environment

Only the currently deployed Cloudflare Worker at
`https://anish-shah-is.online` is supported production. Staging and PR previews
are Access-protected, isolated, and unindexed. The private OpenAI Sites
deployment is a reference/recovery environment, not public production or a
rollback target.

Security fixes flow through a reviewed PR, exact-SHA validation, isolated
staging where needed, and the guarded production runbook. Never weaken Access
or enable a private fallback to recover availability.

## Threat model

Assets in scope include:

- provider credentials, OAuth state, and owner write authority;
- unpublished editorial state and sanitized connector snapshots;
- private Travel drafts and metadata-free masters, approximate public geography, and active-snapshot media authorization;
- Simulation sessions, budgets, provider approvals, and the non-retention boundary for visitor/model text;
- D1/KV publication integrity;
- the boundary between private source material and public content; and
- the plain-text copy deck as untrusted contributor input.

Assume anonymous clients can send arbitrary headers, paths, query strings,
bodies, artwork or Travel-media keys, callbacks, hostile image containers,
oversized/chunked uploads, prompt injection, and request volume. Primary threats are forged
identity, cross-origin owner writes, OAuth disclosure or replay, unsafe provider
or copywriter input reaching public output, arbitrary artwork or R2 proxying,
EXIF/GPS disclosure, image polyglots and pixel bombs, stale cached photos after
unpublication, unsafe model output, XSS, framing, publication fallback restoring
hidden records, dependency compromise, and accidental secret/private-data commits.

Cloudflare Access is the edge gate, not the only authorization check. The
Worker validates Access JWT signature, issuer, audience, expiry, and identity;
application code then applies the exact `OWNER_EMAILS` allowlist. D1 is the
active publication authority. KV may serve only a validated, versioned,
sanitized last-known-good publication. Production returns a noindexed `503`
instead of restoring the checked-in static bundle when both are unavailable.

Provider, Cloudflare control-plane, and third-party availability compromise are
outside the repository’s control, but still require containment and revocation
through the incident runbook.

## Credential and environment handling

- Run the local bootstrap in [Testing](./docs/testing.md); it creates only
  missing local connector-encryption, rate-limit, and Simulation session-HMAC
  values, never prints or overwrites them, and locks `.env.local` to owner-only
  permissions.
- Enter provider credentials through the protected Studio. API secrets and
  OAuth tokens are encrypted before D1 storage.
- Never send secrets through GitHub, CI output, browser storage, screenshots,
  chat, or copy-deck files.
- Local, staging, and production OAuth applications and state are separate.
- The bounded local-to-production promotion flow can transfer only Hardcover,
  Steam, and validated Strava settings. It uses a single-use ten-minute code,
  exact production-origin binding, bounded/throttled no-cookie server-to-server
  import, owner review through Access-protected Studio, and a thirty-minute
  staged-payload window. The import route intentionally does not depend on an
  Access browser cookie; the unguessable code and encrypted staged transaction
  are its authentication. MyAnimeList, Spotify, and Discogs OAuth material,
  snapshots, and publication approval never transfer.
- Preview Workers have no D1, KV, provider network, OAuth, Studio, cron,
  encryption, or write capability.
- The production connector encryption key is durable state. Loss requires
  reconnecting providers; suspected compromise requires revocation and a
  planned credential reset.
- Production Travel media stays in the private `TRAVEL_MEDIA` R2 bucket. Never
  copy masters between local, staging, and production, expose R2 object keys,
  or use a public bucket/domain. Unpublishing is the immediate access-control
  response; verified deletion of derived media and draft state is the follow-up.

Follow [Incidents](./docs/operations/incidents.md) for containment,
[Rollback](./docs/operations/rollback.md) for Worker or D1 recovery, and
[Security notes](./docs/security-notes.md) for implementation controls.
