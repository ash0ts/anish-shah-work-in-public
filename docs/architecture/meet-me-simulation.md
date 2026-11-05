# 4N1SH: conversation and evidence

4N1SH is a fictional companion, not Anish or his representative. The owner
preview is a playable media console: cartridges, optical discs, and cases
load software, curricula, research, and talks from the visible archive.
The current checkpoint is an **authored visual slice**, not live AI dialogue.
Approve its desktop/mobile interaction before completing generative replies.
Production remains disabled. There is no score, assessment, or idle loop.

## Presentation boundary

React server-renders six reviewed objects and a complete, collapsed archive.
Without JavaScript they are ordinary project links. XState owns two reader slots,
loading, replacement, ejection, opening, documented connections, messenger context, the journal,
and the optional open → connect → ask trail. Opening and connecting never spend
a model call. In this slice, submitting a question also stays entirely local.

`MediaConsole.tsx` supplies a CSS-3D cartridge carousel and tactile reader console.
The native range dial and Previous/Next buttons browse the same bounded selection.
Tapping a cartridge or a reader and dragging into a reader dispatch the same
ID-only load action. The same project cannot occupy both slots. Ejecting or
replacing a cartridge clears the prior connection. Patch uses the loaded pair,
independently of messenger context. Pointer cancellation, second touches, resize,
visibility changes, and lost capture cancel a drag without loading anything.
Screen scans, reader lights, and companion reactions follow deliberate input;
there is no idle loop or initial automatic animation.

`workspace.ts` projects only active visible Work records. `personal-internet.ts`
intersects exact topic/source IDs; it does not infer affiliation or causality.
Hidden records cannot enter the initial objects, search, counts, or connections.
The manifest owns the small starting selection, not new project facts.

Desktop permits two artifact windows and one messenger or journal. Anime.js
bounds draggable headers inside the workspace; ordinary close, reset-position,
select, and ask buttons provide alternatives. Mobile uses one active Explore,
Chat, or Journal surface and never shrinks desktop windows. Back/Forward store
only interface IDs; transcript text stays in memory. Escape restores focus.
Still presentation, reduced motion, forced colors, and hidden documents stop
decorative feedback. Play never preloads this route's art or model code.

### Artwork provenance and budgets

The approved visual direction uses silver hardware, translucent cobalt, optical
media, and acid-lime controls. `ObjectSprite.tsx` selects one of four materials
from `media-atlas-v1.webp`; `companion-cobalt-v1.webp` supplies the original blue
companion. Both are AI-generated original artwork, not product screenshots or
borrowed game assets. Labels, buttons, project facts, and chat remain semantic
HTML. CSS supplies depth and brief interaction feedback, not idle animation.

Both images are inventoried in the public-content attestation. Together they
are capped at 250 KiB; the material atlas is at most 1024px wide and the companion
480px. Re-encode transparent PNG inputs with
`node scripts/simulation/encode-workspace-assets.mjs <atlas.png> <companion.png>`.
The encoder preserves proportions and alpha and strips source metadata. The
superseded monochrome scenes, SVG toys, and yellow companion have no consumers
and are removed. No new runtime dependency, Canvas, physics engine, or remote art loads.
Measure the route chunk and asset bytes from the same candidate build used by
browser checks; preserve those results in the PR review notes.

## Grounding and truth

The deterministic catalog uses the active visible Work archive, public metrics
with full qualifiers, Sources links, and approved About text. Hidden work and
linked metrics are omitted. Search selects at most eight candidates; the prompt
ceiling is 24,000 bytes. Oversized context falls back without truncating
qualifiers. Travel, private corroboration, account IDs, artwork URLs, raw provider
payloads, and unapproved collections are excluded.

The retained backend currently lets Google select up to three evidence IDs. It cannot supply prose, URLs,
metrics, qualifiers, or new facts. The server resolves those IDs against a fresh
catalog after the request. Unsupported or malformed output returns archive
results. Previous visible cards are pruned on every completed turn. This
extractive endpoint is not called by the new visual slice. After visual approval,
natural dialogue requires a versioned turn contract, bounded browser-held
context, sourced answer sections, server-owned links/metrics/qualifiers,
allowlisted UI suggestions, and grounded-answer evaluation. Schema/citation
validation alone must not be described as factual validation.

Collection summaries require separate encrypted Google-processing permission
for each provider. Public-display and retired Anthropic approvals do not count.
Permissions bind to the current connection revision; expired, disabled, replaced,
or undecryptable records fail closed. Strava and Travel are not eligible.

## Studio setup

1. Run `npm run setup:local` and `npm run db:local:migrate`.
2. Start `npm run dev:simulation`; open local Studio.
3. Save the Gemini key. Only a stored-state flag is returned.
4. Test connection. One synthetic request says READY; no archive or visitor
   material enters this request.
5. Enable owner preview. This changes only the private conversation setting.
6. Optionally record collection-processing permission under Advanced / recovery.

No key is needed to review the current workspace. Its messenger is explicitly
labelled **Authored demo · no AI requests** even when a key is already stored.
The existing setup/test endpoints are retained, not automatically invoked.

The pinned model is `gemini-3.6-flash`, through `@ai-sdk/google` directly from
the Worker. There is no Gateway requirement or claimed Gateway DLP protection.
Adapter 4.0.35 matches AI SDK 7.0.50's provider contract; upgrade them together.

Key and permission references use the existing AES-GCM settings store with
provider-, origin-, and environment-bound context. Neither plaintext nor
encrypted values enter public responses, logs, health, exports, or bundles.
Replacing a key resets its test and enable flags. Concurrent tests reserve a
revision before making a paid request.

## Session and request lifecycle

Owner APIs require exact owner identity, same origin, rate limits, bounded
bodies, exact schemas, and If-Match for existing-state mutations. Preview APIs
and production conversation access fail closed. The opaque host-only, Secure,
HttpOnly, SameSite=Strict cookie is HMAC-addressed in D1.

Sessions expire after one hour. Each permits twenty model calls; the shared daily
budget is one hundred, including connection tests. Questions are limited to 800
characters. One in-flight turn holds a fifteen-second lease around a ten-second
provider deadline. No tools or automatic provider retries. Input screening
rejects common secrets, personal identifiers, and injection patterns; it is not
exhaustive DLP.

A request ID is reserved before spending budget. Replays cannot spend again,
including after interrupted responses. Revision conflicts require recovery.
D1 stores only scene/source IDs, counters, replay IDs, and expiry—not questions,
generated prose, or transcripts. The browser retains at most four recent turns
in memory, reset on reload. Scheduled cleanup removes expired sessions and budget
records older than ninety days; it never deletes connector snapshots.

## Failure and activation boundary

No key, an outage, invalid output, a deadline, exhausted budget, or missing
permission leaves archive search and authored discoveries usable. Old campaign
sessions require restart. Applied migration 0006 and historical approval rows
are preserved; no migration or data transfer is required.

Only `disabled` and `conversation-v2` are runtime modes. Production always
selects disabled; no public sitemap entry. Synthetic previews use an immutable
authored catalog with no database, Studio, or model requests. Local and
separately configured isolated staging can use the exact owner identity.

Public activation needs a separate review of audience eligibility, supported
regions, paid-service configuration, disclosures, collection permission, and
abuse controls. A checkbox is insufficient. Mutable official references:
[Gemini terms](https://aistudio.google.com/docs/terms) and
[model catalog](https://aistudio.google.com/docs/models), reviewed 2026-11-04.
A live synthetic test is still required for the owner's actual account and region.

## Verification and removal inventory

Run `node --test tests/conversation-security.test.mjs tests/conversation-ui.test.mjs`,
then `npm run browser:simulation:existing` using the existing build. Cover
no-JavaScript sources, discoveries, setup, replay, hidden/revoked evidence,
expiry, budgets, outage, key isolation, keyboard, zoom, and responsive overflow.

Removed: Action/Tactical arenas, combat/scoring controller, campaign dossier and
client, Anthropic transport/local launcher, old approval UI/API, and obsolete
tests. Phaser and the Anthropic adapter have no runtime consumers and are removed.
Shared audio, migrations, immutable releases, connector state, and Travel remain.
Historical release parsers may recognize old names for audit compatibility;
those records do not authorize new activation.
