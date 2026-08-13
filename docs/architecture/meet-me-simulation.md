# Meet Me: 4N1SH simulation

`/simulation` is a progressive-enhancement narrative game built from the
site's sanitized publication. `4N1SH` is a stylized public-model character,
not an impersonation of Anish and not a source of new factual claims.

## Experience boundary

- When the feature is exposed, `/play` presents `REVEAL THE SIMULATION` as a
  normal semantic link. A cancellable Anime.js/R3F handoff may enhance that
  navigation. Disabled mode renders no link or transition.
- The server renders the disclosure, campaign setup, dossier, evidence links,
  Tactical mode, and a complete no-JavaScript foundation.
- Phaser is imported only after the visitor selects Action mode. Its Canvas is
  `aria-hidden`; React owns dialogue, facts, actions, progress, and status.
- Tactical mode consumes the same encounter manifest and ending contract
  without downloading Phaser.
- XState owns campaign transitions, pending AI turns, cancellation, retries,
  and completion. SessionStorage contains only safe campaign IDs and scores.
- Tone.js is imported only after `SOUND ON`. Missing sound never blocks a route
  or action.

Game-oriented Canvas, Phaser, XState, and pixel effects are restricted to
`app/simulation/**` and `components/simulation/**`. Shared Web Audio is
restricted to `components/experience-audio/**`.

## Trust boundaries

The checked-in `content/presentation/simulation.v1.json` manifest contains only
curated statements, public IDs, internal routes, scene definitions, and
authored fallbacks. At request time the server resolves those IDs against the
active D1/KV publication. Hidden records, missing evidence, and unapproved
metrics disappear instead of falling back to the checked-in public bundle in
hosted production.

Generated text never supplies a fact card. The model may choose only
allowlisted entity IDs; the server renders exact statements, qualifiers,
links, and evidence from the validated dossier. Model output is rejected when
it contains unknown fields or IDs, markup, links, control characters, numeric
claims, unsupported enums, or excessive text.

Play-provider data is eligible for the model only when its protected approval
record is enabled, unexpired, and includes both `game_display` and
`llm_context`. Approval references remain owner-only. An absent approval leaves
the public Play doorway available but removes provider data from model context.
For an approved Act III doorway, the server inspects the complete current
sanitized snapshot and deterministically reduces it to at most twelve items,
six facets, and 2,400 prompt characters. This bounded projection prevents a
collection from dominating the turn while preserving deterministic coverage;
raw payloads, artwork keys, profiles, and provider identifiers never enter the
prompt.

## Session and retention model

The browser receives a 256-bit opaque `__Host-anish_simulation` cookie with
`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, and a one-hour lifetime. D1
stores only its HMAC, revision, safe state IDs and enums, bounded counters,
request IDs, a generation lease, a safe last-response projection, and expiry.
That projection is exact-validated before reuse and contains only the bounded
character line, allowlisted IDs, trusted fact cards/actions, and public session
state needed to return an idempotent retry.

Exactly two optional messages are accepted per campaign. Input is normalized
and limited to 280 graphemes. Links, contact information, common credential
shapes, and control characters are rejected before a model call. Raw visitor
text, prompts, and raw provider responses are processed in memory and never stored
in D1, KV, audit history, logs, analytics, or sessionStorage. Completion,
reset, and explicit exit delete the active session. Scheduled retention removes
expired or abandoned state no later than two hours after expiry.

Revision checks, unique request IDs, a short generation lease, per-source
one-way rate limiting, four model calls per campaign, twelve campaign turns,
and a daily global budget bound cost and replay. An uncertain provider request
is never retried automatically.

## AI transport

Hosted live mode uses Claude Sonnet 5 through an authenticated Cloudflare AI Gateway
and the AI SDK provider abstraction. Provider credentials are stored in the
Gateway through BYOK; the Worker receives only its own environment-specific
Gateway coordinates, run token, optional BYOK alias, and model selection.

Required hosted Worker secrets/configuration are environment-specific and are
entered with Wrangler against that tier's generated configuration:

```text
SIMULATION_SESSION_HMAC_KEY
SIMULATION_GATEWAY_ACCOUNT_ID
SIMULATION_GATEWAY_ID
SIMULATION_GATEWAY_TOKEN
SIMULATION_GATEWAY_BYOK_ALIAS
SIMULATION_DAILY_MODEL_LIMIT=500
```

The authenticated Gateway must have prompt/response logging and response
caching disabled globally. Configure DLP, content Guardrails, and a hard spend
limit independently in staging and production. Each request also asks the
Gateway not to collect logs or payloads, skips cache, permits one Gateway
attempt, and uses a bounded timeout. The Worker sends short, nonstreaming,
schema-constrained requests with an eight-second application deadline and never
retries an uncertain provider call. Claude Sonnet 5 must not receive non-default
`temperature`, `top_p`, or `top_k` values.

In hosted environments, the Anthropic API key exists only in Gateway BYOK
storage. The Worker receives a
Gateway token and alias, not the provider key. Gateway IDs, tokens, aliases,
session keys, budgets, and approval state are different in staging and
production and never appear in release plans or checked-in configuration.

Local development also has an explicit `direct-local` smoke-test transport.
The guarded launcher reads `ANTHROPIC_API_KEY` from an owner-only file and binds
it only to the loopback development Worker for that process lifetime. The key
is never written to local configuration or persistence. Runtime policy accepts
this transport only for the exact loopback development origin. Hosted tiers,
production mode, other app ports, and non-loopback origins reject it. Direct
local results verify model/schema compatibility only; all hosted Gateway
controls are still tested on isolated staging before release.

Cloudflare references:

- [AI SDK integration](https://developers.cloudflare.com/ai-gateway/integrations/vercel-ai-sdk/)
- [Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
- [Stored provider keys](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)

## Environment matrix

The experience gate has three exact states:

- `disabled` hides the Play ingress, returns 404 from the route and APIs, and
  omits the route from the sitemap.
- `coming-soon` keeps the semantic Play ingress and serves a server-rendered,
  noindexed placeholder. It creates no session, reads no publication dossier,
  loads no campaign client, invokes no rate limiter, and keeps every Simulation
  API at 404.
- `campaign-v1` enables the complete dossier, session, Action/Tactical, and
  model-or-authored-fallback contract.

| Tier | Experience | AI | Persistence |
| --- | --- | --- | --- |
| Local | `campaign-v1` by default in development | deterministic fixture unless explicitly configured | local D1 only |
| PR preview | `disabled` | authored-only | no route, client bundle, D1, KV, secrets, or provider calls |
| Staging | `coming-soon` for doorway review or `campaign-v1` for campaign acceptance | authored-only while coming soon; live for the campaign | isolated staging D1, limits, keys, and approvals |
| Production | `disabled` or `coming-soon` until campaign activation | authored-only outside the campaign; live when activated | production D1 and distinct limits/keys |

Hosted production and staging reject fixture mode. Neither `disabled` nor
`coming-soon` accepts campaign approval evidence or live AI configuration.
Preview cannot access Studio or mutation APIs.

The v2.2 preview, staging, and production candidate uses `disabled` with
`authored-only`. It retains this dormant source and protected owner state while
serving no Play ingress, sitemap entry, route/API response, or Simulation
client bundle.

## Source map

```text
content/presentation/simulation.v1.json     campaign and factual allowlist
components/simulation/**                    semantic UI, Tactical, lazy Action
lib/server/simulation/**                    policy, validation, sessions, model
app/api/simulation/**                       public session and turn endpoints
app/api/studio/simulation/**                protected provider approvals
components/experience-audio/**              consent-gated shared sound runtime
content/presentation/experience-audio.v1.json procedural/replaceable cue slots
drizzle/0006_public_model_simulation.sql     additive state tables
```

## Validation and release

Run the repository maintenance classifier, `npm run validate`, and
`npm run validate:browser`. A `coming-soon` candidate must prove the route is
200 and noindexed, its APIs are 404, and no dossier, session, model, Phaser, or
Tone code is loaded. A `campaign-v1` candidate must complete both Action and
Tactical campaigns, exercise authored fallback under a full model outage, and
confirm that no Phaser or Tone chunk loads before the corresponding explicit
gesture. A disabled candidate must prove that Play has no ingress, the route
and APIs return 404, the sitemap omits the route, and Play loads no Simulation
chunk.

Production activation is a separate guarded release with
`SIMULATION_EXPERIENCE_MODE=campaign-v1` and `SIMULATION_AI_MODE=live`. Record a
fresh D1 Time Travel bookmark, the exact validated SHA, Gateway logging/spend
controls, the approval-state digest, and both mode completions. Rollback either
sets the experience to `disabled` or promotes the prior Worker version; it does
not restore D1 or alter Play connector credentials.
