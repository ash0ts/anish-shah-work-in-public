# Protected Boundaries

The copy deck cannot directly alter:

- Metric values, labels, qualifiers, periods, scope, attribution, sources, or evidence.
- Home signal compact limits, metric/icon IDs, bucket/illustration IDs, and ordering
  in `content/presentation/home-overview.v2.json`.
- IDs, slugs, aliases, URLs, relations, WorkGroup membership, ordering, visibility, or featured state.
- Event dates, source titles, bibliography records, or canonical provider data.
- Privacy, retention, deletion, consent, security, OAuth, legal, or provider-attribution language.
- Connector coverage literals, public payloads, sync/error states, button behavior, routes, or programmatic accessible names.
- Generated content/copy modules, schemas, attestations, private inputs, migration reports, snapshots, or D1/KV state.
- Credentials, environment files, Studio, connectors, migrations, CI workflows, Cloudflare configuration, or deployment scripts.
- Travel trip facts, dates, place labels, geography precision, captions, tags, photo safety decisions, media retention, or publication state.
- Simulation disclosure, factual cards, model/provider policy, system prompts, safety rules, budgets, session behavior, authored fallback, or provider approvals.

Do not soften, round, aggregate, or newly infer a number to make a sentence read better. Do not turn supported pipeline into revenue, enrollments into unique people, appearances into unique works, or association into personal causation.

If protected wording is inaccurate or awkward, propose:

1. The exact problem.
2. The intended audience understanding.
3. Suggested wording clearly labeled as a proposal.
4. The fact/source that needs owner review.
5. Any desired visual or implementation change.

Place that proposal in the PR implementation-request section or a linked issue. Do not encode it into an unrelated editable field.
