# Security maintenance notes

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
  history no later than 90 days, audit history no later than 365 days, and
  Spotify metadata no later than 30 days. Disconnect still deletes
  provider-specific credentials and history immediately.
- `npm run security:audit` fails on any runtime advisory or any high/critical
  full-tree advisory. The remaining development-only moderate advisories are
  inherited through Drizzle Kit’s retired esbuild loader; Drizzle Kit is never
  shipped in the Worker runtime and `npm audit --omit=dev` must remain clean.
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
