# Architecture and trust boundaries

## Runtime shape

One Vinext application is deployed as an owner-controlled Cloudflare Worker.
Static assets and server-rendered pages share the public origin. D1 stores only
sanitized publication/editorial state, encrypted connector credentials,
bounded public snapshots, owner-authored Travel state, Simulation session and
approval state, OAuth/promotion transactions, sync history, and audits. KV
stores versioned sanitized publication snapshots for verified last-known-good
fallback. Private R2 holds processed, metadata-free Travel masters; its keys
are never a public interface.

```text
anonymous visitor ──> public HTML and GET connector projections
                            │
                            └──> publication-aware artwork proxy

owner ──> Cloudflare Access ──> Worker JWT verification ──> email allowlist
                                                        └──> Studio + writes

owner Studio Refresh ──> provider API ──> exact projector ──> D1 snapshot
anonymous visitor ──> active D1 snapshot ──> public JSON

owner ──> protected Travel Desk ──> strip metadata ──> private R2 master
                                          │
                                          └──> atomic D1/KV atlas snapshot

visitor ──> published photo id + digest ──> snapshot authorization ──> variant
```

Access is not the sole authorization decision. The Worker validates signature,
issuer, audience, expiry, and identity, discards spoofable identity headers,
and then applies the exact owner allowlist.

## Presentation and content ownership

- `content/public/` supplies sanitized facts, stable IDs, relations, metrics,
  evidence, and structural groupings.
- `content/copy/` supplies declared plain-text presentation fields.
- D1 supplies published visibility, ordering, caveats, owner-approved metric
  wording, and operational connector state.
- `CONTENT_VERSION` identifies canonical public data.
- `COPY_VERSION` identifies the copy sources plus their parser and field contract.

See [Content and state](./content-and-state.md) for precedence and failure
behavior and [Copywriting](../copywriting.md) for the freelancer-safe surface.

## My Room boundary

My Room, 2001 is the authoritative Play experience. `/play` reads no connector
or Travel data and renders a semantic seven-object directory. Each direct route
loads only its provider or sanitized Travel publication. Room R3F is isolated
under `components/play/room-3d/**`; the full globe is isolated under
`components/play/travel/**`. Both remain semantic HTML first and never own
content or navigation. See
[My Room architecture](./my-room-2001.md).

## Code ownership boundaries

- `app/` and `components/` own routes, semantic rendering, and progressive enhancement.
- `components/play/room-3d/` and `components/play/travel/` are the only permitted Three.js runtime boundaries.
- `lib/server/` owns auth, encryption, provider projection, publication policy,
  Travel publication/media authorization, Simulation state, D1 repositories,
  and write authorization.
- `worker/` owns headers, origin/tier enforcement, rate limits, Access injection,
  redacted observability, retention, and cleanup. Scheduled work never
  synchronizes provider collections.
- `content/` owns private-safe curation, generated public data, and the copy deck.
- `drizzle/` is forward-only schema history.
- `scripts/` owns deterministic generation, validation, preview, staging, and release evidence.
- `public/assets/travel/geography/` contains deterministic Natural Earth-derived
  country IDs and bounded admin-1 geometry; it contains no owner Travel data.

## Four isolated tiers

| Tier | Durable state | Provider access | Public indexing |
| --- | --- | --- | --- |
| Local | Local D1 and local-only secrets | Real, with local registrations | No |
| PR preview | None; sanitized content + synthetic fixtures | None | No |
| Staging | Dedicated D1/KV/R2/secrets/Access/apps/Gateway | Real, staging-only | No |
| Production | Production D1/KV/R2/secrets/Access/apps/Gateway | Real, production-only | Yes |

Code may move between tiers; credentials, tokens, snapshots, D1 rows, KV
envelopes, encryption keys, and publication approval do not. The private OpenAI
Sites deployment is a separate reference/recovery environment, not one of the
four promotion tiers and not a public rollback.

See [Staging and previews](../operations/staging-and-previews.md),
[Production release](../operations/release.md), and
[Incidents](../operations/incidents.md).
