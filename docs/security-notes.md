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
- OAuth transaction data is removed within 24 hours of expiry, synchronization
  history after 90 days, and audit history after 365 days. Disconnect still
  deletes provider-specific credentials and history immediately.
- `npm run security:audit` fails on any runtime advisory or any high/critical
  full-tree advisory. The remaining development-only moderate advisories are
  inherited through Drizzle Kit’s retired esbuild loader; Drizzle Kit is never
  shipped in the Worker runtime and `npm audit --omit=dev` must remain clean.
