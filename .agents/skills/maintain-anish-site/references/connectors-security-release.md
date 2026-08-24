# Connectors, Security, Environments, and Release

## Provider Model

- MyAnimeList and Spotify use owner-only OAuth 2 with separate applications per live environment.
- Discogs uses OAuth 1.0a HMAC-SHA1, server nonces/timestamps, owner-bound request transactions, exact callbacks, and separate applications. Its text-first catalog is eligible for an owner-triggered refresh after four hours and normally becomes unavailable after six.
- Hardcover uses an owner API token. Steam uses API key plus SteamID64 and a truthful storage-country gate.
- Strava stores a validated public profile and optional official embed separately from the generic connector repository.
- Every provider publishes through an exact runtime projector. No raw payload, standalone account identifier, credential, or arbitrary remote artwork URL enters public JSON.
- Provider artwork resolves only host-free allowlisted keys from a currently published snapshot.
- Collection synchronization is manual-only: exactly one explicit Studio Refresh may call a provider data API. Public reads, OAuth callbacks, credential saves, and cron are pure with respect to provider collections.

Travel is an owner-authored publication, not a provider connector. Drafts and exact
media authorization records live in D1, sanitized versioned snapshots use D1/KV,
and metadata-free masters/derivatives live in a tier-isolated private R2 bucket.
Verify a photo against the active snapshot before reading a derivative; unpublish
must make every media URL fail on its next request. Exact GPS, source filenames,
raw uploads, and R2 keys never enter public contracts or logs.

## Owner Write Pattern

Owner JSON writes reject cross-origin requests, verify Access plus exact owner allowlist, parse a bounded body, reject unknown fields, and return sanitized `private, no-store` responses. New mutations live under `/api/studio/**`.

OAuth callbacks are public only because providers must reach them. Require exact environment callback, encrypted owner binding, ten-minute expiry, single use, replay protection, safe fixed redirects, proactive token refresh, and sanitized failure states. Never log URL/query data, identities, codes, verifiers, signatures, tokens, or provider payloads.

OAuth completion and credential saves establish a connection but do not fetch a
collection. Studio derives one provider-local next action from connection,
authorization, permission, snapshot, and provider publication state. The
routine lifecycle is **Connect → Allow public use → Sync → Show**; only the
explicit Sync/Refresh action may fetch a generic connector collection. Strava
is checked only by Studio save or Verify; its public read never performs a
remote health request.

## Four-Tier Isolation

- Local: loopback-only owner fallback, local D1/secrets, no hosted identity assumptions.
- PR preview: synthetic sanitized fixtures, no D1/KV/R2/Studio/OAuth/provider network/AI Gateway/cron/secrets, Access-protected and globally noindexed.
- Staging: dedicated Worker, D1, KV, R2, rate limits, Access audience, secrets, callbacks, provider registrations, and Simulation Gateway. It never imports production state.
- Production: apex-only host, production D1/KV/R2/Access/secrets, separate Simulation Gateway, and exact-SHA release guard.
- Private Sites deployment: reference/recovery only; it is not a production rollback target.

Local promotion may transfer only reviewed, explicitly portable provider setup over HTTPS. It never transfers snapshots, encryption keys, OAuth-provider credentials/tokens, or publication approvals. No staging/production transfer exists.

## Canonical Runbooks

- `docs/operations/bootstrap.md` owns one-time Cloudflare resources, durable
  secrets, and initial schema activation.
- `docs/operations/staging.md` owns repeatable candidate planning,
  checkpointing, acceptance, and RC tagging.
- `docs/operations/previews.md` owns synthetic preview isolation, deployment,
  review evidence, and cleanup.
- `docs/operations/release.md` owns the repeatable exact-SHA production train
  and immutable attestation.
- `docs/operations/rollback.md` and `docs/operations/incidents.md` own recovery
  and containment. Never reconstruct those procedures from this compact
  policy reference.
- `docs/play-connections.md` owns provider setup, manual refresh, publication,
  and provider-specific recovery.

## Publication, Retention, and Disconnect

- D1 commits validated publication state; versioned `PUBLICATION_CACHE` KV advances only after D1 succeeds. If both are unavailable/invalid in production, return a noindexed `503`, never the checked-in bundle.
- A failed, rate-limited, malformed, or rejected synchronization never changes
  the active snapshot pointer. Preserve the stored last-known-good snapshot;
  accepted Spotify and Steam snapshots have no age-based deletion or cutoff.
- Every configured connector uses the owner-only publication approval register.
  References are encrypted; both `public_display` and
  `retain_last_known_good` are required after atomic activation. Missing or
  expired approvals withhold public display without deleting private data.
- Studio never exposes those two scopes as independent choices. The owner
  records one private reference, approval date, and optional expiry; the server
  applies both fixed scopes. `report_only` to `required` remains one atomic
  rollout transition presented as **Finish permission setup**, available only
  when every configured provider is ready.
- Approved connector snapshots have no age-based deletion or public cutoff.
  Public output exposes only freshness and the actual update time; required
  mode withholds missing or expired approvals without deleting private state.
- **Make private** disables public display without deleting connector state;
  **Restore public access** reenables an unexpired stored record; **Renew
  permission** updates dates and may replace its encrypted reference.
  Disconnect remains destructive. Spotify and Discogs content-publication
  acknowledgements remain separate from provider permission.
- Disconnect deletes provider credentials/config, snapshots, pending OAuth state, sync history, and provider audit records, then unpublishes.
- Third-party frames remain consent-gated and CSP allowlists exact.
- Update Privacy and tests whenever retrieval, storage, retention, disclosure, or deletion changes.
- Travel whole-trip publication is atomic. Planned/current trips are month-level,
  country/region-only, and photo-free; completed trips may use owner-approved
  0.1-degree approximate-city points and reviewed photos.

## Release Boundary

Hosted mutations require explicit authorization. The normal guarded production
contract requires exact successful URLs for Validate, Gitleaks, CodeQL, and
Browser Quality at the candidate SHA. When GitHub-hosted minutes or artifact
storage are unavailable, an explicitly confirmed owner-local mode may supply
Validate, Gitleaks, and Browser Quality through a permission-restricted,
self-digested owner attestation bound to the clean pushed `origin/main` SHA and
one immutable build. CodeQL remains an exact successful run of the pinned
GitHub action on the verified one-time AMD64 owner runner. A local receipt is
not a waiver: every named
check must pass, the release guards must re-hash the receipt and artifact, and
the candidate must still pass the 0%-traffic browser checkpoint. Record the
evidence mode and receipt digest alongside `RELEASE_VERSION`,
`TRAVEL_ATLAS_MODE`, `SIMULATION_EXPERIENCE_MODE`, `SIMULATION_AI_MODE`,
`CONTENT_VERSION`, and `COPY_VERSION` in the release plan and attestation. My
Room is unconditional; no hosted Classic/Play-mode flag remains.

`RELEASE_VERSION` is exact SemVer and must equal `package.json`. Generated
preview/staging/production configuration, owner health, release checkpoints,
plans, commands, and attestations all fail closed on a missing or mismatched
version.

Ordinary release-code changes run `npm run validate`. Only a clean, pushed, approved candidate with required exact-SHA evidence runs `npm run validate:release`, release planning, upload, staging, or deployment.

An explicit request to stage a named release candidate authorizes only the enumerated staging train for that exact SHA: guarded plan, listed additive migrations, immutable upload, staging traffic change, bootstrap, checkpoint, smoke checks, and rollback if acceptance fails. It never authorizes production traffic, production migrations, secret rotation, provider reauthorization, or copying production state. Stop before any mutation whose resource, migration list, evidence URL, or prior-version checkpoint differs from the approved plan.

## Simulation Gateway Incident Response

For suspected prompt/response logging, caching, or data-loss-prevention failure:

1. Diagnose read-only first: verify the configured staging or production Gateway, payload-logging state, cache state, DLP/Guardrails, model alias, budgets, and sanitized application health. Do not retrieve or reproduce prompt bodies.
2. Contain by disabling `SIMULATION_EXPERIENCE_MODE` or selecting authored-only behavior through an explicitly authorized hosted configuration change. Do not silently switch providers or weaken the fallback.
3. Preserve only sanitized evidence: request IDs, release SHA, coarse time window, configuration-state booleans, affected call count, and provider response class. Never copy captured prompts, responses, visitor text, Access assertions, or identifiers into issues, logs, or release artifacts.
4. If a provider or Gateway retained payloads, use its owner console and documented deletion controls after explicit authorization; record only the deletion request/reference and completion state.
5. Add a behavior-level regression test for the causal code or configuration contract, run Simulation backend/privacy, rendered, bundle, and browser gates, and require fresh exact-SHA release evidence before reenabling live mode.

Investigation authority is not mutation authority. Changing Gateway logging, provider keys, budgets, secrets, or hosted feature state remains a separately auditable owner action.

Before an authorized release:

1. Pin the exact source SHA and reuse one hashed, immutable `dist` through rendered/browser/Lighthouse/bundle tests and planning.
2. Record the current Worker version and D1 Time Travel bookmark.
3. Apply only reviewed additive migrations, reconcile the exact trigger
   configuration, and stage the candidate at 0% while the prior version remains
   at 100%.
4. Require Cloudflare deployment status to report the exact candidate-at-0 and
   prior-at-100 split. For a fresh staging database, invoke only the guarded
   staging maintenance bootstrap through the version override so the general
   retention heartbeat exists before checkpointing.
5. Exercise the exact candidate through the Worker-version override. Verify
   D1/KV publication, `RELEASE_VERSION`, `CONTENT_VERSION`, `COPY_VERSION`,
   canonical origin, My Room, `/play` plus all seven object routes, Travel media
   authorization/publication/cleanup, Simulation mode and approval digest,
   owner health, Access, and connectors. Record the guarded checkpoint receipt.
6. Promote only when a fresh status read matches the checkpointed deployment;
   then require candidate-only 100% traffic before running the registry-derived
   smoke set from the canonical runbook. Never retry an uncertain deployment
   write automatically.
7. Roll back Worker code separately from D1. Restore D1 only when proven causal and explicitly confirmed.
