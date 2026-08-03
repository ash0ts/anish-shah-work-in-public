# Repository contract

- Use `$maintain-anish-site` for every investigation or change in this repository.
- For visual or interaction changes, also use `frontend-design`; it remains the sole creative/design skill for this site.
- Do not use Field Notes, film, video-story, Remotion, canvas-film, technical-analysis-animation, autoplay, or scroll hijacking. Three.js is allowed only inside the explicitly requested, intent-gated `/play` room runtime under `components/play/room-3d/**`; it remains prohibited for Home, Work, Sources, Studio, and archive navigation.
- Treat `content/public/anish-content.public.v1.json` as generated deployable content, not a hand-edited source. Raw CSV/Markdown inputs and `content/private` must remain outside deployed assets and public output.
- New owner mutations use `/api/studio/**`; public connector routes are read-only except tightly bounded OAuth callbacks and retained compatibility redirects.
- Keep local and production state isolated. Never copy local D1, encryption keys, MyAnimeList OAuth material, or Spotify OAuth material into production.
- Public production is the owner-controlled Cloudflare Worker and D1 deployment. The existing Sites deployment stays private as a reference/recovery environment; do not request workspace-admin changes, expose a bypass, proxy it publicly, or weaken access controls.
- Remote migrations, deployments, Access changes, and secret rotation require an explicit user request.
- Preserve semantic server-rendered HTML, keyboard access, visible focus, reduced-motion behavior, and no-JavaScript fallbacks.

## Project creative direction

- The Work archive is one ruled, typographic Bodies of Work index: four editorial buckets connect enduring work to its public forms without cards or a second duplicate index.
- Keep the complete Work archive two-dimensional and server rendered. Its temporal overview is a semantic four-line-by-year color calendar with exact counts and links into the same body folds. Do not use a separate plot, Three.js, or WebGL for archive navigation.
- Preserve an editorial, inspectable HTML experience when JavaScript or motion is unavailable.
- Treat the six semantic `/play/<object>` routes and object directory as authoritative. The low-poly room is optional enhancement: it may not own provider content, preload connectors, or make any collection unreachable without WebGL.
