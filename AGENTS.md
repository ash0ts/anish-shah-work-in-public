# Repository contract

- Use `$maintain-anish-site` for every engineering, content-structure, connector, environment, CI, documentation, or release investigation/change in this repository.
- Use `$edit-anish-site-copy` for copy-only work in `content/copy/**`. Copywriters and their LLMs may edit only text beneath existing approved headings; they must never change markers, generated output, facts outside the allowlist, application code, Studio, connectors, security, migrations, workflows, or deployment files.
- Public wording, naming, metadata, WorkGroup presentation, evidence labels, and Play descriptions must use the existing copy deck. Do not bypass it through JSX, generated modules, D1, or canonical data.
- When a copy request needs layout, interaction, hierarchy, a destination, a new field, or protected wording, record it as an implementation request. The owner may adopt it through `$maintain-anish-site`; once code changes, the PR leaves the trusted copy-only lane.
- For visual, interaction, or hierarchy changes, also use `frontend-design`; it remains the sole creative/design skill for this site.
- Do not use Field Notes, film, video-story, Remotion, canvas-film, technical-analysis-animation, autoplay, or scroll hijacking. Three.js is allowed only inside the intent-gated `/play` room runtime under `components/play/room-3d/**` and the Postcard Planet globe under `components/play/travel/**`; it remains prohibited for Home, Work, Sources, Studio, and archive navigation.
- The `/simulation` campaign has one narrow technology exception: Phaser, XState, game-oriented Canvas effects, and pixel-art rendering may be used only under `app/simulation/**` and `components/simulation/**`. Tone.js and Web Audio may be used only behind an explicit user gesture under `components/experience-audio/**`. These dependencies must remain dynamically loaded, must not enter unrelated route bundles, and must preserve semantic DOM, Tactical/no-JavaScript parity, reduced-motion behavior, and silent operation until `SOUND ON`.
- Treat `content/public/anish-content.public.v1.json` as generated deployable content, not a hand-edited source. Raw CSV/Markdown inputs and `content/private` must remain outside deployed assets and public output.
- New owner mutations use `/api/studio/**`; public connector routes are read-only except tightly bounded OAuth callbacks and retained compatibility redirects.
- Keep local, synthetic preview, isolated staging, production, and private Sites-reference state distinct. Only the audited one-time promotion flow may transfer reviewed Hardcover, Steam, and Strava setup from local to production; never move D1/KV data, encryption keys, OAuth material, snapshots, or publication approvals across environments.
- Public production is the owner-controlled Cloudflare Worker and D1 deployment. The existing Sites deployment stays private as a reference/recovery environment; do not request workspace-admin changes, expose a bypass, proxy it publicly, or weaken access controls.
- Remote migrations, deployments, Access changes, and secret rotation require an explicit user request.
- Preserve semantic server-rendered HTML, keyboard access, visible focus, reduced-motion behavior, and no-JavaScript fallbacks.
- Classify committed PR changes with `node .agents/skills/maintain-anish-site/scripts/check-change.mjs --plan --base origin/main`. Ordinary release-code changes run `validate`; production-candidate execution remains separately authorized and exact-SHA guarded.
- Keep `docs/README.md` as the documentation authority map. Documentation
  changes run `npm run docs:check`; subsystem-boundary changes update both the
  human-readable `docs/architecture/codebase-tour.md` and the maintenance
  skill's repository map.
- Metric, source, privacy, provider-policy, route, stable-ID, and programmatic accessibility wording remains owner-guarded. Put desired changes in an implementation request instead of smoothing away a required fact or behavior.
- Treat `content/presentation/home-signal-rails.v1.json` as reviewed, protected
  presentation data. Its metric IDs, compact limits, icon IDs, bucket IDs, and
  topic IDs are not copy-deck fields. Keep it in `COPY_VERSION` and the public
  content attestation whenever its contract changes.
- Travel may use advanced R3F, shaders, geographic interaction, and owner-side image processing only under `components/play/travel/**`, the selection-only globe prop in `components/play/room-3d/**`, and `app/studio/travel/**`. Travel remains semantic HTML first and may not introduce WebGL navigation elsewhere.

## Project creative direction

- Home presents one equal-weight, three-node signal circuit and four line/topic
  rails. Never scale a signal by its value, select a representative project for
  a line, or add a topic/category route; every rail links into the existing
  filtered Work calendar and Project index.
- Keep the complete Work archive two-dimensional and server rendered. Its temporal overview is a semantic four-line-by-year color calendar with exact counts. Calendar, topic, search, organization, and filter selections all reveal the same flat Project index; individual project pages remain lean evidence leaves. Do not use a separate plot, Three.js, or WebGL for archive navigation.
- Preserve an editorial, inspectable HTML experience when JavaScript or motion is unavailable.
- Public narrative uses first person only when authorship, a personal choice, or
  a durable belief matters. The copyable About speaker bio is intentionally
  third person. Keep language technically precise and structured as outcome →
  mechanism → proof → meaning; keep one claim per sentence, limits beside
  numbers, and avoid hype, rhetorical questions, or unsupported causality.
  Prefer concrete actors and verbs, read longer copy aloud, and reserve mild
  personality for Play—not speaker, Privacy, consent, or recovery text.
- Treat the dependency-free closed seven-object contract, semantic `/play/<object>` routes, and object directory as authoritative. Derive routes, controls, focus targets, and smoke paths from that contract while keeping executable screen/provider/scene maps literal and parity-tested. The low-poly room is optional enhancement: it may not own provider or Travel content, preload connectors, geography, or media, or make any collection unreachable without WebGL. There is no Classic Play mode; retain only the permanent legacy `?stream=` redirects.
- The v2.2 public, preview, and staging contract keeps Simulation dormant with
  `SIMULATION_EXPERIENCE_MODE=disabled` and
  `SIMULATION_AI_MODE=authored-only`. Disabled means no Play ingress, sitemap
  entry, public route/API access, or Play-loaded Simulation bundle. Retain the
  source for a separately reviewed future activation.
