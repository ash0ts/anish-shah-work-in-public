# Operational observability

The release configuration records one explicitly redacted custom event for
every dynamic Worker response and runs an hourly retention cron. Cloudflare
invocation logs are disabled because they include request URLs. True static
asset hits served before the Worker may be untraced; every request that reaches
the Worker, including asset misses and image optimization, is traced. Dynamic
events contain only a random request ID, release SHA prefix, method, coarse
route class, response status, and coarse duration bucket.
These custom events never contain hosts, paths, URLs, query strings, identities, tokens, OAuth
codes, state, headers, exceptions, or provider payloads.

This is not a guarantee about Cloudflare platform logs. Exception records can
still include request URLs when invocation logging is disabled. Treat platform
logs and exports as sensitive, restrict access, and do not paste them into PRs.
The Worker rejects unsupported Server Actions before framework decoding to
avoid unnecessary exception records; useful error monitoring remains enabled.
Unknown HTTP methods are reduced to `OTHER` in custom events.

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
`worker_maintenance_complete` is emitted only after connector, Simulation, and
Travel maintenance all succeed. It contains only the event name and release
prefix; a failure emits `worker_scheduled_failure` instead. An absence monitor
must check a three-hour window, not merely alert on explicit failures.
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

Follow [incidents](./incidents.md) for containment. Configure notifications for
CPU-limit failures, five or more server failures in ten minutes, and no successful
maintenance event for three hours. Deduplicate repeat notifications hourly.
Record actual account-side configuration in the release review; documentation
alone does not establish that a monitor is active.

## Spending and field performance

Workers Paid is the intended tier. Additional-usage notifications at $1 and $5
are Workers-only alerts, not total-account caps; they must not automatically
disable service. Monitor D1, R2, Images, and other product charges separately.
The generated production Worker has a 5,000 ms CPU ceiling and filtered Work
requests have a separate 120/minute salted-client limit. Do not increase these
limits to conceal repeated failures.

The request limiter is approximate and per Cloudflare location, not a global
hard billing cap. A deployment's **100% traffic** badge is a traffic allocation,
not resource saturation. Compare CPU-limit outcomes, actual usage, and the
relevant billing window rather than inferring a leak from that badge.

### Use the paid tier deliberately

Keep first-party hashed assets on the native assets binding; do not route every
asset through Worker code. Keep D1 authoritative and use its Time Travel bookmark
before a release. Do not add cross-request HTML/publication caching to spend an
included allowance: immediate visibility and revocation remain requirements.

Workers Builds currently includes 6,000 minutes/month on Paid (last verified
2026-11-16). Pilot it only as an isolated, non-promoting validation job, with an
explicitly reviewed repository connection and no production credentials. Measure
installation, build, browser compatibility, artifact export, and total duration
before changing CI. A custom build service is not a replacement for exact-SHA
security evidence or the guarded owner checkpoint. Keep the existing runner
fallback until equivalent evidence and artifact reuse are demonstrated.

Keep redacted logs at the shortest useful retention. Recheck Observability's
announced December 1, 2026 pricing transition before enabling additional ingestion
or retention; Workers, storage, Images, and other product allowances are separate.
No additional subscription is required merely to use Workers Paid well.

References (last verified 2026-11-16):
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Builds limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/),
[static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
[Observability pricing](https://developers.cloudflare.com/observability/pricing/),
and [rate-limit semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Compare CPU failures, 5xx responses, filtered-page crawl volume, and spend after
24 hours and seven days. Review search coverage and real-user performance after
28 days. Field targets are p75 LCP ≤2.5 s, INP ≤200 ms, and CLS ≤0.1. Laboratory
scores are separate evidence; low traffic means insufficient field data.

## Web Analytics: disabled pending privacy compatibility

Last verified: 2026-11-15. The official Cloudflare beacon (2026.10.1;
SHA-256 `637381256384554e1cc3309a62fb238a51b83e7f10b2a56d8ba15dbc73ca762e`)
failed the approved boundary even with `spa:false`: a late beacon after a
public-to-Studio transition contained `/studio`, and a public landing from
Studio included that private referrer path. Query values were stripped, but
private-route transmission still fails the policy. Analytics remains disabled;
neither CSP nor automatic injection is enabled to accommodate it.

Reproduce with `npm run analytics:privacy:probe`. This manual, network-dependent
diagnostic downloads only the official script. All browser traffic is intercepted
and fulfilled locally; it uses a synthetic origin, a dummy token, and synthetic
canaries. No visitor telemetry reaches Cloudflare. Do not add this vendor-network
probe as a PR gate. A future integration requires passing tests for landing
URLs, referrers, query-bearing routes, callbacks, late events, and SPA transitions,
then a reviewed production-only, nonce-bound integration. `spa:false` by itself
does not meet those requirements.

Official references (last verified 2026-11-15):
[Workers spending controls](https://developers.cloudflare.com/workers/platform/spend-management/),
[Web Analytics SPA controls](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/),
and [beacon payload](https://developers.cloudflare.com/speed/observatory/rum-beacon/).
