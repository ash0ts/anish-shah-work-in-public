# Operational observability

The release configuration records one explicitly redacted custom event for
every dynamic Worker response and runs an hourly retention cron. Cloudflare
invocation logs are disabled because they include request URLs. True static
asset hits served before the Worker may be untraced; every request that reaches
the Worker, including asset misses and image optimization, is traced. Dynamic
events contain only a random request ID, release SHA prefix, method, coarse
route class, response status, and coarse duration bucket.
They never contain hosts, paths, URLs, query strings, identities, tokens, OAuth
codes, state, headers, exceptions, or provider payloads.

Every dynamic response returns the same correlation value in `x-request-id`.
Use that value to locate its bounded event; do not add request data to make an
incident easier to search.

The owner-only `GET /api/studio/health` endpoint reports only release SHA,
content version, copy version, canonical-origin readiness, migration state, retention
heartbeat, and sanitized connector status. It is protected by Access and the
exact owner allowlist and is always `private, no-store`.

## After every release

- Confirm anonymous 2xx responses for public pages, robots, sitemap, and public
  connector envelopes.
- Confirm Studio requires Access and a non-owner is denied.
- Confirm `/api/studio/health` matches the deployed SHA, `CONTENT_VERSION`, and
  `COPY_VERSION`, and has
  a current retention heartbeat.
- Inspect Studio connector health and refresh configured providers.
- Confirm the release commit, Worker version, content version, copy version, D1 bookmark, and
  smoke-test time are recorded under `releases/`.

## Logs and cron

Use Cloudflare's current dashboard or Wrangler tail without adding request
bodies, full URLs, OAuth query strings, Access assertions, identities, or
connector payloads to custom events:

```bash
npx --no-install wrangler tail anish-shah-work-in-public
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
