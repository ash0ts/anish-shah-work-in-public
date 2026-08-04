# Architecture and trust boundaries

## Runtime shape

One Vinext application is deployed as an owner-controlled Cloudflare Worker.
Static assets and server-rendered pages share the public origin. D1 stores only
sanitized publication/editorial state, encrypted connector credentials,
bounded public snapshots, OAuth/promotion transactions, sync history, and
audits. KV stores versioned sanitized publication snapshots for verified
last-known-good fallback.

```text
anonymous visitor ──> public HTML and GET connector projections
                            │
                            └──> publication-aware artwork proxy

owner ──> Cloudflare Access ──> Worker JWT verification ──> email allowlist
                                                        └──> Studio + writes

provider API ──> exact normalization/projector ──> D1 snapshot ──> public JSON
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
data and renders a semantic six-object directory. Each direct object route
loads only its associated provider. The optional Three/R3F runtime is isolated
under `components/play/room-3d/**`, requested only after explicit room entry and
capability checks, and never owns content or navigation. See
[My Room architecture](./my-room-2001.md).

## Code ownership boundaries

- `app/` and `components/` own routes, semantic rendering, and progressive enhancement.
- `components/play/room-3d/` is the only permitted Three.js runtime boundary.
- `lib/server/` owns auth, encryption, provider projection, publication policy,
  D1 repositories, and write authorization.
- `worker/` owns headers, origin/tier enforcement, rate limits, Access injection,
  redacted observability, retention, and scheduled Discogs refresh.
- `content/` owns private-safe curation, generated public data, and the copy deck.
- `drizzle/` is forward-only schema history.
- `scripts/` owns deterministic generation, validation, preview, staging, and release evidence.

## Four isolated tiers

| Tier | Durable state | Provider access | Public indexing |
| --- | --- | --- | --- |
| Local | Local D1 and local-only secrets | Real, with local registrations | No |
| PR preview | None; sanitized content + synthetic fixtures | None | No |
| Staging | Dedicated D1/KV/secrets/Access/apps | Real, staging-only | No |
| Production | Production D1/KV/secrets/Access/apps | Real, production-only | Yes |

Code may move between tiers; credentials, tokens, snapshots, D1 rows, KV
envelopes, encryption keys, and publication approval do not. The private OpenAI
Sites deployment is a separate reference/recovery environment, not one of the
four promotion tiers and not a public rollback.

See [Staging and previews](../operations/staging-and-previews.md),
[Production release](../operations/release.md), and
[Incidents](../operations/incidents.md).
