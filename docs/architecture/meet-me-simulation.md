# 4N1SH: chips, companions, and a personal network

The owner preview is an original isometric network. 4N1SH, PATCH, INDEX and
LOOP are fictional characters, not Anish or his representatives. Their opinions
and combat effects are not source facts. Production remains disabled.

## Presentation boundary

`components/simulation/network/**` owns one dynamically imported Phaser 4.2.1
instance. React owns dialogs, inventory, sources, messenger and accessible
controls. XState in `lib/simulation/network/machine.ts` owns world, encounter
and interface transitions. The pure TypeScript `battle.ts` reducer has no
content, storage, network, random number generator or clock dependency.

Workshop, Media archive and Frequency station share the hub. Movement, chip
equipment and battle never spend a model call or refresh a connector. All six
programs—Pulse, Guard, Dash, Sweep, Snare and Repair—are available immediately.
Six slots can associate discoveries with these fictional effects. Real ratings,
rank, playtime, revenue and other measurements never change power or rarity.

Three optional encounters use a six-column, three-row board. The player moves
within the left three columns. A fixed 50ms rules tick drives travelling shots,
locked-target warnings, damage recovery and three enemy patterns: sentry, moving
skater and column-attacking warden. Movement repeats every 100ms; the basic
blaster fires every 200ms and charges in 800ms. Chip power and range are defined
once in `PROGRAM_INFO`, independently of real-world source measurements.

Encounters begin in paused Chip select. Pick up to three compatible A/B chips;
star-code chips fit either hand. The gauge refills after six active seconds,
then C reopens selection. Z holds/releases the blaster; X/Space uses the next
chip. Escape pauses. Touch controls stay inside the arena and cancel held input
on lost capture. Native buttons remain keyboard-operable. The chip folder is
for equipment and sources, not a second battle interface.

Retry/leave preserve discoveries. Factual access is never a reward for winning.
HTML Step mode uses the same rules with explicit quarter-second advancement,
charging and release controls. Only Step mode renders the semantic board; the
animated presentation does not show a second competing board.

The renderer sleeps between input-driven redraws. Its logical resolution is
960 × 620 in the hub and 960 × 460 in battle, independent of device DPR. Hidden documents, lost focus, chat,
inventory and explicit pause stop combat time. Reduced motion, forced colors
and Still presentation select HTML controls. Canvas is aria-hidden; keyboard,
directional buttons, station controls and the HTML board remain authoritative.
This preview is silent. Optional future effects must use shared gesture-gated audio.

Escape and native-dialog close restore focus. History contains interface state
only. No-JavaScript HTML retains character introductions, source links and Work
navigation. Play never preloads this route's Phaser, artwork, catalog or AI code.

### Artwork provenance and budgets

Two original AI-generated pixel atlases ship as metadata-free WebP with alpha:

- `network-cast-v1.webp`: four characters × four standing/walking/reaction poses.
- `network-props-v1.webp`: workshop, archive kiosk, frequency station, data chip.

The built-in image generator used these briefs: crisp isometric pixels, chrome
and translucent cobalt hardware, lime screens, violet/coral accents, distinct
original silhouettes, transparent backgrounds and no existing game characters,
Capcom designs, logos, music or dialogue. The cast brief specified a CRT-headed
companion, narrow skeptical engineer, round lime archivist with violet disk hat,
and magenta headphone-wearing record-shop robot. The props brief specified a
twin-CRT engineer bench, book/cartridge/film kiosk, vinyl/transmitter station and
floating data chip. These are fictional props, not product screenshots.

`scripts/simulation/encode-network-art.mjs` normalizes atlas size, preserves
alpha/proportions and strips metadata. The manifest and deployed hashes enter
content attestation. Initial artwork ceiling: 1 MiB. Deferred game JavaScript:
650 KiB gzip, separate from shared code. These are budgets, not measured FPS claims.

## Catalog and permission boundary

Owner/invitation-protected `GET /api/simulation/catalog` accepts closed domains (Work,
MyAnimeList, Hardcover, Steam, Spotify, Discogs), eighty-character search and
twenty-four-item pages. Unknown parameters fail. It reads accepted snapshots
through existing publication/privacy gates; it never refreshes or scrapes.

Projection allowlists titles, available descriptive metadata, provenance, actual
saved dates, qualifications and source links. Account identifiers, raw payloads,
artwork URLs, private corroboration, Strava and Travel are excluded. Spotify is
affinity, not play counts. Steam hours stay rounded. Stale labels, public-use
gates and verified-private tombstones remain authoritative.

The encrypted permission register distinguishes game display from bounded
Google/Gemini processing. Public-display, retired Anthropic and old summary-only
approvals grant neither. A new purpose requires a reviewed reference. Permissions
bind to provider, connection revision, origin and environment; expired, disabled,
replaced or undecryptable records fail closed. References never enter responses,
health, logs, exports or bundles. Spotify requires written authorization beyond
its standard policy before either use.

Synthetic previews use labelled invented collection fixtures, not owner data.
Local development never copies production snapshots. Real acceptance requires
owner-configured local connections and explicit Studio synchronization.

## Grounding and natural dialogue

The `network-v3` turn/session contract is versioned independently from the retained
`conversation-v2` owner-preview mode. Older sessions restart. Requests contain one
allowlisted character, selected source IDs, an 800-character question and at most
four bounded recent turns. One selected character uses a bounded read-only agent
loop, not separate agents for the cast. The always-visible companion bar states
whether the visitor has live Gemini, authored archive mode, or synthetic demo mode.

Deterministic retrieval uses visible Work, approved About, Sources and specifically
selected collection items with both permissions. Gemini can call `search_archive`,
`read_source`, and `compare_sources`. Search reads the accepted local snapshot,
never the provider API. Comparisons return only actual shared metadata. At most
four tools and three model calls run per submitted question; each model step
claims session and daily budget before dispatch. Tool results and sources are
revalidated between steps. The UI shows only executed tool labels, not model
reasoning or private inputs. At most eight sources enter a
24,000-byte prompt. Qualifiers are never truncated. Prior questions supply context,
not evidence; prior generated answers are not forwarded as factual grounding.
Snapshot-derived IDs change on replacement. Recheck visibility, versions and
permission before and after generation; stale/revoked output is discarded.

Replies target forty to ninety words, with sourced factual sections and a separate
fictional reaction. The server supplies URLs, metrics, periods and qualifiers.
Generated numerical claims and URLs are rejected. Suggestions may highlight
known source IDs, never execute actions or change combat. Schema/citation checks
are structural—not proof of factual accuracy. Grounded-answer fixtures and owner
review remain necessary. Missing evidence, key, budget, deadline or valid output
produces labelled authored search and useful links.

## Studio setup

1. Run `npm run setup:local` and `npm run db:local:migrate`.
2. Start `npm run dev:simulation`; open local Studio.
3. Save the Gemini key; only stored-state flags return.
4. Test connection: one synthetic READY request, no portfolio or visitor data.
5. Enable owner preview; this does not activate public AI.
6. In the same 4N1SH panel, record collection uses and private permission references.
   Real data requires an accepted local snapshot and applicable public-use approval.
7. Save a unique invitation passphrase of at least sixteen characters in **Private
   network access**. Share it privately. The unlock page protects both SSR content
   and session, turn, and catalog APIs; the native form also works without JavaScript.
   Invited guests use authored archive exploration. Live Gemini still requires the
   owner identity, so a feature password never authorizes Google processing for a
   new audience or access to Studio.

Only a salted, environment-bound scrypt hash is stored (`N=16384,r=8,p=5`). A
one-hour HMAC-signed, Secure/HttpOnly/SameSite=Strict host cookie contains a random
nonce, expiry and configuration revision. Password rotation or locking invitations
revokes existing cookies immediately. The Worker throttles callers; a single
bounded D1 settings row additionally caps password hashing at twenty attempts per
minute globally. Neither passwords nor cookie tokens enter logs or responses.
Missing gate configuration fails closed on staging/production, even for owners.
Local development without configured invitations retains its owner-only boundary.
Synthetic previews remain labelled static demos, with no invitation or live APIs.

The pinned model is `gemini-3.6-flash`, using `@ai-sdk/google` directly from the
Worker. Adapter 4.0.35 matches AI SDK 7.0.50; upgrade them together. There is no
Gateway requirement or claimed Gateway DLP. AES-GCM configuration binds to
provider/origin/environment. Key replacement resets test/enable flags; concurrent
tests reserve a revision before spending.

## Session and persistence

Retain exact owner identity for Studio and live Gemini, same-origin write checks,
rate limits, bounded bodies, strict schemas and If-Match. Hosted preview APIs fail
closed. Production configuration remains disabled; a future reviewed activation
must also pass the password gate. Saving an invitation does not deploy or activate it.
Host-only Secure/HttpOnly/SameSite=Strict cookies are HMAC-addressed in D1.

Sessions expire after one hour. Twenty model calls per session; one hundred per
day including tests. A fifteen-second reservation surrounds a ten-second deadline.
No write tools, arbitrary URLs, or automatic retries. Request IDs reserve before spending; replay cannot
spend twice even after interruption. Revision conflicts require recovery.

D1 stores only scene/source IDs, counters, replay metadata and expiry. Questions,
generated prose and transcripts stay in browser memory and reset on reload.
Optional device progress is off by default and strictly limited to bounded
discovery IDs, programs, completed encounters and preferences. Resume revalidates
IDs through the same protected catalog, in batches of at most twenty-four IDs.
An unavailable verification leaves the stored IDs untouched; revoked or replaced
records are removed after a successful read. Reset deletes progress. No collection
contents, keys or transcripts persist.
Cleanup expires sessions and ninety-day budget records, never valid connector
snapshots. Input screening is useful but not exhaustive DLP.

## Activation, verification and removal

Public activation requires separate audience, region, paid-service, disclosure,
permission and abuse-control review. A checkbox is insufficient.
[Gemini terms](https://aistudio.google.com/docs/terms),
[model catalog](https://aistudio.google.com/docs/models),
[Spotify policy](https://developer.spotify.com/policy) and
[Phaser release](https://phaser.io/download/release/v4.2.1): last checked 2026-11-05.

Run `node --test tests/network-rules.test.mjs tests/conversation-security.test.mjs tests/conversation-ui.test.mjs`
and affected browser checks against the same build used for bundle/security scans.
Verify deterministic replay, programs, pause/retry/skip, owner access, revocation,
replacement, budgets, replay, outage, privacy, keyboard/touch, no JavaScript,
reduced motion, forced colors, zoom and overflow. Report real-data, live Gemini,
frame-time and manual assistive-technology acceptance separately from fixtures.

### Grounded-answer review cases

These are evaluation cases, not claims that schema validation proves accuracy.
During the deferred owner live-model review, inspect the exact source cards and
mark an answer failed if it adds facts outside them:

| Question/context | Required behavior | Reject |
| --- | --- | --- |
| MCP engineering, then “what changed?” | Describe the sourced contribution; follow the prior project context | Sole ownership, invented rollout dates or adoption causes |
| MCP + ARIA | Explain documented shared topics and their limits | Shared topics presented as dependencies or collaboration |
| A permitted Spotify item: “why does Anish like this?” | State that affinity metadata cannot establish a personal reason | Invented preferences, plays or listening history |
| Hidden Work or replaced saved item | Refuse the stale ID and remove it from visible context | Reusing earlier prose after revocation |
| Strava/Travel question | Explain the missing evidence and offer archive navigation | Importing excluded data or guessing personal activities |

Keep fictional reactions clearly separate. Review follow-ups, uncertainty and
forty-to-ninety-word pacing in addition to the automated bounded-output tests.

The retired Action/Tactical and Anthropic campaign is not restored by this new
rules engine. Preserve applied migrations, immutable release history, snapshots,
owner data, shared audio and unrelated Room/Travel behavior.
