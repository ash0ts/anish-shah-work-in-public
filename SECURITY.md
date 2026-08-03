# Security and privacy reporting

## Reporting

Report suspected security, privacy, or accessibility issues privately through
[Anish Shah on LinkedIn](https://www.linkedin.com/in/anish-shah). Do not include
credentials, OAuth codes, provider payloads, private source material, or
sensitive personal data in a public issue.

This private, personal repository has no public bug-bounty program and makes no
response-time guarantee. A useful report includes the affected URL or component,
the observed behavior, reproducible steps using non-sensitive test data, and the
potential impact.

## Supported production

Only the currently deployed Cloudflare Worker version is supported. The private
OpenAI Sites deployment is a recovery/reference environment, not a public
production fallback. Security fixes are applied to `main`, validated on the
exact commit, and released through the owner runbook.

## Threat model

Assets in scope are provider credentials and OAuth state, owner identity and
write authority, unpublished editorial state, sanitized connector snapshots,
and the boundary separating private source material from public content. The
site assumes anonymous visitors and malicious clients can send arbitrary
headers, query strings, request bodies, artwork keys, OAuth callbacks, and high
request volumes.

Primary threats are forged Access/Sites identity, owner-route authorization or
cross-origin bypass, token or OAuth-state disclosure through logs and redirects,
unsafe provider payloads reaching D1 or public JSON, arbitrary artwork proxying,
XSS or framing, publication fallback that restores hidden records, dependency
compromise, and accidental secret/private-content commits. Cloudflare Access is
the first owner boundary; JWT verification plus the exact-email allowlist is the
second. D1 is the active publication authority, versioned KV is sanitized
last-known-good state, and provider responses remain untrusted until projected
through exact schemas.

Provider-side account compromise, Cloudflare control-plane compromise, and the
availability or policy of third-party services are outside this repository's
control. Those events still require containment, revocation, and disclosure
decisions through the incident runbook; they are not reasons to weaken Access or
publish private fallback data.

## Credential handling

- Provider credentials and OAuth tokens are entered only through protected
  Studio and encrypted before D1 storage.
- Production secrets stay in Cloudflare; local secrets stay in ignored,
  permission-restricted configuration.
- Never send secrets through GitHub, CI output, browser storage, screenshots,
  or issue text. The sole cross-environment exception is the explicit
  local-to-production promotion flow: the loopback server sends the narrowly
  supported Hardcover/Steam credentials directly to the Access-protected
  production endpoint over HTTPS; the browser never receives them, production
  encrypts them immediately, and an unapplied staged payload expires after 30
  minutes and is removed by hourly retention.
- The production connector encryption key is durable state. Loss requires
  reconnecting providers; suspected compromise requires revocation and a
  planned credential reset.

Maintainers should follow [the incident runbook](./docs/operations/incidents.md)
for containment, provider revocation, D1 recovery, Access failures, and
post-incident documentation. Implementation controls and accepted dependency
limitations are recorded in [security notes](./docs/security-notes.md).
