# Architecture and trust boundaries

## Runtime shape

The public origin is one Cloudflare Worker built from the Vinext application.
Static assets and server-rendered pages share that origin. D1 stores sanitized
public/editorial records, encrypted connector credentials, bounded public
snapshots, OAuth transactions, synchronization history, and audit records.

```text
anonymous visitor ──> public pages and GET connector projections
                            │
                            └──> publication-aware artwork proxy

owner ──> Cloudflare Access ──> Worker JWT verification ──> email allowlist
                                                        └──> /studio + writes

Worker ──> provider APIs ──> sanitize ──> D1 snapshot ──> public projection
```

Cloudflare Access is the edge gate, not the sole authorization decision. The
Worker verifies issuer, audience, signature, expiry, and authenticated email,
then application code applies the exact `OWNER_EMAILS` allowlist. Forwarded
identity headers are discarded before verified identity is injected.

## Code ownership boundaries

- `app/` and `components/` own route composition and progressive enhancement.
- `lib/server/` owns authentication, encryption, connector normalization,
  publication policy, D1 repositories, and write authorization.
- `worker/` owns edge headers, request limits, throttling, Access verification,
  and scheduled retention.
- `content/public/` is the only deployable canonical content projection.
- `drizzle/` is the forward-only production schema history.
- `scripts/` owns deterministic generation, validation, and release evidence.

Changes crossing `worker/`, `lib/server/`, `drizzle/`, public-content generation,
or release automation require explicit owner review through `CODEOWNERS`.

## Environment boundary

Localhost uses a project-local D1 sandbox and a loopback-only development owner.
Production uses Cloudflare Access, a separate D1 database, durable production
encryption, and separate OAuth applications. Deployments move code and reviewed
non-secret settings. MyAnimeList and Spotify always require production OAuth;
the bounded promotion flow can stage only the explicitly supported portable
provider settings.

The private Sites deployment uses a different hosting/authentication context. It
is useful for recovery comparison but is not capable of serving as the public
production rollback.

See [content and state](./content-and-state.md), [release](../operations/release.md),
and [incidents](../operations/incidents.md).
