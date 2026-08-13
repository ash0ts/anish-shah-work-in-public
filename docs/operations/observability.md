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
content version, copy version, canonical-origin readiness, migration state,
retention heartbeat, sanitized connector status, and bounded simulation health.
Simulation health contains campaign/AI/provider/model settings, configured
state, coarse fallback rate, daily count/cap, last successful generation time,
approved provider names, and a one-way approval-state digest. It contains no
approval references, prompts, responses, visitor identifiers, free text, model
payloads, or provider collection data. The endpoint is protected by Access and
the exact owner allowlist and is always `private, no-store`.

## After every release

- Confirm anonymous 2xx responses for public pages, robots, sitemap, and public
  connector envelopes.
- Confirm Studio requires Access and a non-owner is denied.
- Confirm `/api/studio/health` matches the deployed SHA, `CONTENT_VERSION`, and
  `COPY_VERSION`, and has
  a current retention heartbeat.
- In `coming-soon` mode, confirm owner health reports the mode as unconfigured
  and that model-call/session counters do not change from public visits. Stored
  owner approvals may remain in D1, but the release plan carries none and the
  placeholder cannot use them. When the campaign is enabled, confirm Gateway readiness, the planned provider
  names/digest, and the configured daily model ceiling. Investigate fallback
  rate changes without adding prompt or response logging.
- Inspect Studio connector health. Refresh a configured provider only when the
  owner deliberately intends to synchronize it; neither observation nor public
  traffic performs that action.
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
health signals. The hourly cron performs retention and cleanup only; it never
calls a provider collection API. Strava remote health checks occur only on
Studio save or **Verify now**.
Simulation budget counters and the coarse fallback bucket are the primary model
health signals. Cloudflare AI Gateway prompt/response logging and response
caching remain disabled; do not enable them during debugging. Use request IDs,
safe status codes, authored-fallback counters, DLP/Guardrail events, and
Gateway aggregate cost/latency instead.

## Escalation conditions

- repeated 5xx responses or public rendering failures
- Studio unexpectedly public or owner unexpectedly denied
- connector display without an active required publication approval, or
  Discogs saved-snapshot display without `retain_last_known_good`
- retention heartbeat older than three hours
- sudden artwork proxy rejection/rate-limit spikes
- D1 migration mismatch or failed publication reconciliation
- simulation Gateway unexpectedly unconfigured while `campaign-v1` is active,
  approval digest drift, daily cap exhaustion, or sustained elevated/high
  authored fallback

Follow [incidents](./incidents.md) for containment. External alerts remain a
future operational improvement; do not expose provider identities or secrets to
add them.
