# Incident and credential recovery

## First response

1. Record UTC time, affected route/provider, deployed Worker version, and the
   last known-good release record. Do not paste secrets or raw provider data.
2. Contain only the affected surface. Keep public pages available when safe and
   leave Cloudflare Access fail-closed.
3. Preserve relevant Cloudflare logs and D1 bookmarks within their retention
   windows.
4. Rotate or revoke only after identifying which credential class is affected.

## Common cases

### Provider token or API key

Revoke it at the provider, disconnect that provider in Studio, confirm its
credentials/snapshots/history are removed, then reconnect and republish after a
clean refresh. Database deletion alone does not revoke a provider token.

### Provider outage or rate limit

Do not retry through public traffic, cron, or repeated Studio clicks. Read the
sanitized Studio result and honor any provider `Retry-After` time. A failed
manual refresh must leave the active last-known-good snapshot unchanged; first
confirm that pointer before investigating credentials. Reauthorize only for an
explicit authorization failure, not for `429`, transport, `5xx`, malformed, or
public-projector errors.

For Discogs, the normal public catalog expires six hours after its last
successful refresh. Older stale display is permitted only when the owner-only
provider-permission record is enabled, current, and independently verified;
never fabricate, expose, or silently extend that approval during an incident.
Strava remote health may be checked only with Studio **Verify now** or while
saving its configuration.

### Connector encryption key

If the key is lost, existing credentials cannot be recovered; disconnect or
delete encrypted credential state and reauthorize every provider. If compromise
is suspected, revoke provider credentials first, remove encrypted credential
and pending OAuth state, replace the Cloudflare secret, and reconnect. There is
no routine in-place key rotation; treat this as a planned full credential reset.

### Rate-limit salt

Replace the Cloudflare secret and verify protected writes, OAuth callbacks,
promotion import, and artwork requests. Salt rotation invalidates only ephemeral
bucket identity, not connector credentials.

### Simulation Gateway, BYOK alias, or session key

Contain a simulation-only incident by promoting a known disabled Worker version
or preparing a guarded disabled release; keep Work and Play online. Revoke the
affected Gateway token or stored Anthropic key in that environment only, then
replace the Gateway token/alias or `SIMULATION_SESSION_HMAC_KEY` as appropriate.
Never copy the staging credential into production or enable Gateway payload
logging to investigate. A session-key rotation invalidates existing opaque
simulation sessions; retention can remove their unusable HMAC rows. It does not
require connector disconnection, provider-approval deletion, D1 restore, or a
Play publication change.

If spend or daily-call limits are exhausted without credential compromise,
leave the authored fallback active, inspect only aggregate Gateway and owner
health counters, and correct the limit or request pattern through a reviewed
release. Do not replay uncertain model calls.

### Simulation provider approval

Disable or remove the affected provider approval through owner-only Studio.
This removes that provider from model context without deleting its public Play
snapshot. A changed provider list or approval digest invalidates any pending
simulation activation plan; generate a new plan rather than editing evidence.

### Cloudflare Access

Never bypass Access to recover Studio. Verify the application destination,
issuer/team domain, audience, login method, owner email policy, and Worker
allowlist independently. An authenticated non-owner must remain denied.

### D1 corruption or accidental publication

Stop owner writes, capture the current bookmark, and prefer audited record-level
repair. Use the [D1 restore procedure](./rollback.md) only when record repair is
insufficient. Consider whether restore would reintroduce deleted provider data.

### D1 or publication-cache outage

If D1 reads fail, verify that public routes are serving the validated current KV
version and that Studio health is degraded. If D1 and KV are both unavailable
or invalid, preserve the noindexed `503`; do not enable the static bundle as a
production fallback. Restore D1 first, verify its active publication hash, then
republish through Studio to stage a new immutable KV version and advance the
pointer.

### Travel photo, location, or private-master exposure

Unpublish the affected trip in Travel Desk first. Public media resolution checks
the active Travel snapshot before edge cache lookup, so unpublication removes
the trip, its places, and all associated photo responses together. Confirm the
public atlas, trip route, and each known media URL no longer resolve. Do not
publish a replacement while containment is in progress.

Preserve only non-sensitive identifiers needed for the incident record. Never
copy the original photo, EXIF, GPS, R2 key, or signed request into an issue or
log. Delete affected stripped masters and temporary objects through the audited
Travel workflow, verify the D1 photo/upload rows and publication snapshot no
longer reference them, run orphan cleanup, and republish only after captions,
alt text, precision, and safety review. Exact GPS should never exist in D1 or
permanent R2; if it appears, treat that as a boundary failure and widen the
review to every object produced by the same processing path.

For a takedown request, use the LinkedIn contact in `SECURITY.md`, unpublish the
whole trip immediately, then complete deletion and document the result
privately. Do not wait for a normal code release.

### Travel R2 or Images outage

Keep the atlas text and semantic geography available only when the active
snapshot remains valid; unavailable media should return the neutral bounded
response, never an arbitrary R2 object or remote proxy. Disable new uploads and
publishing until `TRAVEL_MEDIA`, `IMAGES`, cleanup heartbeat, and publication
checks recover. Do not substitute the staging bucket, make the production
bucket public, or copy media across environments. Worker rollback does not
restore or remove R2 objects, so reconcile D1/KV publication and private media
state independently.

## Closeout

After containment, document scope, root cause, timeline, affected records,
revocations, rollback/restore coordinates, validation, and preventive action.
Communicate privately through the contact in `SECURITY.md` when personal data or
credentials may have been exposed.
