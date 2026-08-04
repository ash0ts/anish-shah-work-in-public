# Connectors, Security, Environments, and Release

## Provider Model

- MyAnimeList and Spotify use owner-only OAuth 2 with separate applications per live environment.
- Discogs uses OAuth 1.0a HMAC-SHA1, server nonces/timestamps, owner-bound request transactions, exact callbacks, and separate applications. Its text-first catalog refreshes after four hours and becomes unavailable after six.
- Hardcover uses an owner API token. Steam uses API key plus SteamID64 and a truthful storage-country gate.
- Strava stores a validated public profile and optional official embed separately from the generic connector repository.
- Every provider publishes through an exact runtime projector. No raw payload, standalone account identifier, credential, or arbitrary remote artwork URL enters public JSON.
- Provider artwork resolves only host-free allowlisted keys from a currently published snapshot.

Travel is an owner-authored publication, not a provider connector. Drafts and exact
media authorization records live in D1, sanitized versioned snapshots use D1/KV,
and metadata-free masters/derivatives live in a tier-isolated private R2 bucket.
Verify a photo against the active snapshot before reading a derivative; unpublish
must make every media URL fail on its next request. Exact GPS, source filenames,
raw uploads, and R2 keys never enter public contracts or logs.

## Owner Write Pattern

Owner JSON writes reject cross-origin requests, verify Access plus exact owner allowlist, parse a bounded body, reject unknown fields, and return sanitized `private, no-store` responses. New mutations live under `/api/studio/**`.

OAuth callbacks are public only because providers must reach them. Require exact environment callback, encrypted owner binding, ten-minute expiry, single use, replay protection, safe fixed redirects, proactive token refresh, and sanitized failure states. Never log URL/query data, identities, codes, verifiers, signatures, tokens, or provider payloads.

## Four-Tier Isolation

- Local: loopback-only owner fallback, local D1/secrets, no hosted identity assumptions.
- PR preview: synthetic sanitized fixtures, no D1/KV/R2/Studio/OAuth/provider network/AI Gateway/cron/secrets, Access-protected and globally noindexed.
- Staging: dedicated Worker, D1, KV, R2, rate limits, Access audience, secrets, callbacks, provider registrations, and Simulation Gateway. It never imports production state.
- Production: apex-only host, production D1/KV/R2/Access/secrets, separate Simulation Gateway, and exact-SHA release guard.
- Private Sites deployment: reference/recovery only; it is not a production rollback target.

Local promotion may transfer only reviewed, explicitly portable provider setup over HTTPS. It never transfers snapshots, encryption keys, OAuth-provider credentials/tokens, or publication approvals. No staging/production transfer exists.

## Publication, Retention, and Disconnect

- D1 commits validated publication state; versioned `PUBLICATION_CACHE` KV advances only after D1 succeeds. If both are unavailable/invalid in production, return a noindexed `503`, never the checked-in bundle.
- Preserve last-known-good connector data only within provider-specific windows.
- Disconnect deletes provider credentials/config, snapshots, pending OAuth state, sync history, and provider audit records, then unpublishes.
- Third-party frames remain consent-gated and CSP allowlists exact.
- Update Privacy and tests whenever retrieval, storage, retention, disclosure, or deletion changes.
- Travel whole-trip publication is atomic. Planned/current trips are month-level,
  country/region-only, and photo-free; completed trips may use owner-approved
  0.1-degree approximate-city points and reviewed photos.

## Release Boundary

Hosted mutations require explicit authorization. The guarded production contract requires exact successful URLs for Validate, Gitleaks, CodeQL, and Browser Quality at the candidate SHA. Record `RELEASE_VERSION`, `TRAVEL_ATLAS_MODE`, `SIMULATION_EXPERIENCE_MODE`, `SIMULATION_AI_MODE`, `CONTENT_VERSION`, and `COPY_VERSION` in the release plan and attestation. My Room is unconditional; no hosted Classic/Play-mode flag remains.

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
