# Claims, Evidence, and Protected Language

Use this reference whenever wording contains a number, date, organization, role, outcome, source, provider state, consent statement, or policy implication.

## Claim rules

- Render facts from sanitized canonical content or an approved D1 presentation field. Never invent, estimate, sum, round, or reinterpret a claim in copy.
- Keep value, period, scope, attribution, qualifier, and source together.
- Distinguish personal contribution, program outcome, and company outcome.
- Use **enrollments**, not unique learners.
- Use **same-day account creation**, not conversion.
- Use **pipeline supported** or **associated pipeline**, not ARR, revenue generated, closed revenue, or personal attribution.
- Use provider-defined language such as Spotify-calculated affinity instead of play counts or “most played.”
- Do not turn correlation, reach, registration, attendance, or usage into causality.
- When a required limit makes the sentence unwieldy, change the presentation through an engineering request; do not delete the limit.

Metric values, labels, qualifiers, periods, scope, attribution, display permissions, and evidence IDs are protected. A copywriter may propose new wording but may not change these fields.

## Work facts

Treat dates, organizations, roles, product capabilities, artifact relationships, event instances, and group membership as factual data.

- A deck field marked `fact_check` may restate those facts for presentation.
- Verify it against the sanitized canonical record and flag the exact clause for owner review.
- Do not change stable IDs, slugs, aliases, routes, ordering, visibility, or relationships to make wording fit.
- Do not use a title-only match as evidence that two records are the same work.

## Sources

Immutable evidence includes source title, publisher, URL, evidence type, date, access class, relation, and association with a claim or work.

- Never “improve” a source title in the canonical record.
- Use source kinds consistently: Web page, Video, Code, Profile, Method note.
- Use `View source` or a provider-specific equivalent for actions.
- A sparse short citation label is allowed only when a registered fact-check field stores it and the exact source title remains available in accessible detail.
- Never expose internal evidence, local paths, private names, provider payloads, or owner-only notes.

## Privacy, security, and providers

The following wording is protected because changing prose can change the product or legal meaning:

- Collection coverage, freshness windows, stale and unavailable behavior, synchronization status, and disconnect consequences.
- Consent and iframe-loading behavior.
- Provider attribution, non-affiliation, API-policy, and retention language.
- OAuth, authentication, encryption, deletion, incident, contact, and data-processing disclosures.
- Error codes, recovery instructions, buttons that cause mutations, and Studio operational states.

Do not rewrite these through the copy deck unless an existing protected field and owner-approved implementation explicitly allow it. Request an engineering or owner-policy change instead.

## Escalation format

For any protected proposal, record:

1. Affected route and current language.
2. Reader problem.
3. Proposed language.
4. Factual or policy source that supports it.
5. Whether behavior, payload, accessibility, or legal review must change.
6. Acceptance criteria.

Do not implement the proposal until its owning system is changed and validated.
