# Security maintenance notes

> Checked-in dependency and workflow state in this document was last reviewed
> on **2026-10-22**. GitHub billing, feature availability, and live repository
> settings are mutable account state; recheck them in GitHub before relying on
> them for a release or collaborator-access decision.

- Public responses receive a request-specific nonce CSP, HSTS on HTTPS,
  anti-framing, MIME sniffing protection, a strict referrer policy, and a
  restrictive Permissions Policy.
- Cloudflare Access JWTs are verified against the team JWKS with exact issuer
  and audience checks. Forwarded identity headers are stripped before a
  verified internal identity is added.
- Owner writes and artwork reads use short-lived HMAC request buckets. The
  bucket store never contains a raw IP address. `RATE_LIMIT_SALT` is required
  in production.
- API writes are stream-counted before routing. Normal mutations are limited to
  16 KiB; the one-time Play promotion import is limited to 64 KiB.
- Hourly retention removes OAuth transaction data no later than 24 hours after
  expiry, clears expired staged promotion credentials on the next hourly pass,
  deletes promotion transactions within 24 hours of creation, synchronization
  history no later than 90 days, and audit history no later than 365 days.
  Accepted connector snapshots have no age-based deletion. Explicit disconnect
  or account replacement still deletes provider-specific credentials,
  snapshots, approvals, and history immediately.
- `npm run security:audit` fails on any runtime advisory or any high/critical
  full-tree advisory. The remaining development-only moderate advisories are
  inherited through Drizzle Kit’s retired esbuild loader; Drizzle Kit is never
  shipped in the Worker runtime and `npm audit --omit=dev` must remain clean.
- Vinext declares `image-size@2.0.2`, whose archived upstream has unpatched
  infinite-loop advisories for ICNS, HEIF/AVIF, and JXL. The lockfile replaces
  it with `vendor/image-size-safe`, a bounded, dependency-free metadata reader
  for the checked-in PNG, JPEG, GIF, WebP, SVG, BMP, and ICO formats used by
  the build. Vulnerable formats fail closed and focused tests enforce that
  boundary. This is a reviewed local replacement, not an ignored advisory.
- The lockfile resolves `js-yaml` to the official `4.3.2` release, retaining
  the linear ordered-map duplicate check and fixing empty-merge resource
  accounting. Registry integrity is pinned in `package-lock.json`.
- October's dependency repair keeps Next on 16.x, React/RSC on 19.2.x, and
  Vite on 8.x. Patched Sharp, Undici, URI/YAML/glob utilities, source-map, and
  browser-compatibility data are resolved in the lockfile. Do not substitute
  an npm-suggested framework downgrade or relax the audit gate.
- `braces` has no upstream fix for
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  as of the review date. Build/lint consumers use the MIT-licensed local
  `vendor/braces-bounded` patch. It enforces a non-overridable depth limit in
  parsing and every recursive walker, including supplied ASTs and parent
  chains. Its README records upstream integrity, original file hashes, the
  precise delta, and the removal criterion. Security tests run malicious
  patterns in a timeout-bounded subprocess and verify ordinary downstream
  glob behavior. This replaces vulnerable code; it is not an audit exception.
- GitHub's Dependency Review action requires GitHub Advanced Security for a
  private repository, which is not enabled for this project. CI therefore runs
  `npm run security:audit` on every change, blocking all runtime advisories and
  all high/critical full-tree advisories. Dependabot separately proposes weekly
  npm and GitHub Actions updates; reviewers must inspect the corresponding
  `package-lock.json` changes. These controls are the private-repository
  fallback, not a full replacement for GitHub Advanced Security. Reinstate the
  Dependency Review workflow if GitHub Advanced Security is enabled later.
- CodeQL runs the extended JavaScript/TypeScript security suite in CI, excludes
  generated public data and test fixtures, logs every SARIF finding, and fails
  on high/critical security findings. Because code scanning storage is not
  enabled for this private repository, the workflow deliberately keeps results
  inside the job instead of attempting an unsupported GitHub Security upload.
  Enable the standard upload when GitHub Advanced Security is available.
