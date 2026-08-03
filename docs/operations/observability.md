# Operational observability

The release configuration enables sampled, explicitly redacted custom Worker
events and an hourly retention cron. Cloudflare invocation logs are disabled
because they include request URLs; custom events contain only method, coarse
route class, and status and never URLs, query strings, identities, tokens,
OAuth codes, state, or provider payloads.

The owner-only `GET /api/studio/health` endpoint reports only release SHA,
content version, migration state, retention heartbeat, and sanitized connector
status. It is protected by Access and the exact owner allowlist and is always
`private, no-store`.

## After every release

- Confirm anonymous 2xx responses for public pages, robots, sitemap, and public
  connector envelopes.
- Confirm Studio requires Access and a non-owner is denied.
- Confirm `/api/studio/health` matches the deployed SHA/content version and has
  a current retention heartbeat.
- Inspect Studio connector health and refresh configured providers.
- Confirm the release commit, Worker version, content version, D1 bookmark, and
  smoke-test time are recorded under `releases/`.

## Logs and cron

Use Cloudflare's current dashboard or Wrangler tail without adding request
bodies, full URLs, OAuth query strings, Access assertions, identities, or
connector payloads to custom events:

```bash
npx wrangler tail anish-shah-work-in-public
```

The scheduled retention handler should run hourly at minute `17`. Investigate a
heartbeat older than three hours before the 24-hour OAuth-transaction retention
maximum is threatened.
Connector synchronization history and Studio status are the primary provider
health signals.

## Escalation conditions

- repeated 5xx responses or public rendering failures
- Studio unexpectedly public or owner unexpectedly denied
- connector snapshots beyond their permitted stale window
- retention heartbeat older than three hours
- sudden artwork proxy rejection/rate-limit spikes
- D1 migration mismatch or failed publication reconciliation

Follow [incidents](./incidents.md) for containment. External alerts remain a
future operational improvement; do not expose provider identities or secrets to
add them.
