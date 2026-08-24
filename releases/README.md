# Release records

Production releases use a two-phase checkpoint:

1. `npm run release:plan` writes ignored `dist/release-plan.json` before any
   production mutation. It binds the clean, exact-evidence-validated commit to
   the prior Worker version, pre-migration D1 Time Travel bookmark, reviewed migration
   list and checksums, the exact-commit evidence mode, `RELEASE_VERSION`, public
   content version, and exact
   sanitized bundle hash, plus a deterministic manifest of the exact ignored
   `dist/client` and `dist/server` bytes Wrangler will upload. The plan also requires `HEAD` to match its configured
   upstream. Separately, it records the protected D1/KV publication checkpoint
   and whether the staged application projector must publish a new snapshot.
   A prior Worker version is mandatory because every candidate is staged at 0%
   while the prior version remains at 100%.

   Normal evidence records four successful GitHub Actions run URLs for
   Validate, Gitleaks, CodeQL, and Browser Quality. The explicit owner-local
   fallback records one safe receipt digest for locally executed Validate,
   Gitleaks, and Browser Quality plus the exact successful CodeQL run URL from
   a disposable owner runner. It never invents URLs for local checks, and the
   ignored receipt is re-hashed through the guarded release.
2. `npm run release:attest` consumes that unchanged plan after deployment and
   writes one immutable JSON record in this directory. It adds the deployed
   Worker version, the final verified release-publication hash and marker time,
   a re-verification of the exact deployable artifact set,
   and requires exactly these successful production smoke checks:
   `public_routes`, `studio_access`, `non_owner_denial`,
   `connector_galleries`, `oauth_callbacks`, `security_headers`, `owner_health`,
   `canonical_apex`, `www_redirect`, `workers_dev_disabled`,
   `preview_urls_disabled`, `request_id_header`, `access_destinations`, and
   `simulation_experience`, plus the six connector-backed room-route checks.
   Releases with Travel enabled additionally require `play_travel`.

Before 100% promotion, the Access-authenticated browser checkpoint verifies the
staged Worker's health, conditionally runs the audited application projector,
verifies the current D1/KV publication, and writes an owner-only D1 release
marker. The guarded deploy validates that marker against the exact SHA, content
version, current publication, and plan time. Direct/manual D1 or KV seeding is
never part of the release process.

The ignored plan is a release-machine checkpoint and is not committed. A final
record is checked-in operational evidence, not deployment configuration. It
contains no credentials or provider payloads.

`RELEASE_VERSION` is exact SemVer and is required to equal the candidate's
`package.json` version. It is bound through Worker configuration, owner health,
the release checkpoint, the ignored release plan, and schema `1.6` immutable
attestations.

Release-candidate tags use SemVer prerelease names such as `v2.0.0-rc.1` and
identify one immutable staged SHA. A fix produces the next RC number; never move
or overwrite an existing tag or attestation. Tag `v2.0.0` only from the exact
authorized final SHA after the draft `release/2.0.0 → main` PR is merged and
production acceptance succeeds.

Do not hand-edit a plan, attest a failed or partial smoke run, or edit/overwrite
an existing release record. Produce a new validated release instead. The full
zero-traffic checkpoint and guarded-promotion sequence is documented in
[the production release runbook](../docs/operations/release.md).
