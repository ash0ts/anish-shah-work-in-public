# Documentation authority map

Use this page to find the single maintained authority for each concern. When a
detail appears elsewhere, the authority below wins. Current deployed feature
modes and release coordinates come from the immutable records governed by
`releases/README.md`, not from architecture prose.

Every entry is classified as `Concept`, `How-to`, `Reference`, or `Runbook`.

## Orient and contribute

| Audience / task | Type | Canonical authority | Update trigger |
| --- | --- | --- | --- |
| Everyone starting in the repository | Concept | [Root README](../README.md) | Public surfaces, quick setup, or non-negotiable boundaries change |
| Contributors preparing a change | How-to | [Contributing](../CONTRIBUTING.md) | Review lanes, contribution scope, or required handoff changes |
| Engineers learning the system | Concept | [Architecture overview](./architecture/overview.md) | Runtime shape or major ownership boundary changes |
| Engineers locating implementation paths | Reference | [Codebase tour](./architecture/codebase-tour.md) | Entry points, request flow, or common change paths move |

## Build and maintain product surfaces

| Audience / task | Type | Canonical authority | Update trigger |
| --- | --- | --- | --- |
| Engineers changing publication state | Concept | [Content and state](./architecture/content-and-state.md) | Git, D1, KV, projector, or fallback ownership changes |
| Engineers changing My Room | Concept | [My Room architecture](./architecture/my-room-2001.md) | Seven-object contract, semantic routes, or enhancement boundary changes |
| Engineers changing the campaign | Concept | [Simulation architecture](./architecture/meet-me-simulation.md) | Feature modes, sessions, AI, privacy, or authored fallback changes |
| Travel authors and engineers | Runbook | [Travel atlas](./travel-atlas.md) | Authoring, geography, publication, media, or globe behavior changes |
| Local developers and reviewers | How-to | [Testing](./testing.md) | Fresh-clone setup, local servers, validation selection, or browser gates change |
| Owner configuring Play providers | Runbook | [Play connections](./play-connections.md) | Provider registration, refresh, publication, retention, or recovery changes |
| Copy contributors and reviewers | How-to | [Copywriting](./copywriting.md) | Copy-deck workflow, protected wording, or copy validation changes |
| Audio producers and engineers | How-to | [Experience audio](./audio-production.md) | Gesture-gated cue behavior or replacement-asset requirements change |
| Owner regenerating canonical content | How-to | [Content pipeline](../content/README.md) | Private inputs, curation, public generation, or attestation changes |
| Copy contributors editing deck files | Reference | [Copy deck README](../content/copy/README.md) | Allowed Markdown structure or copy-only lane changes |

## Operate and secure hosted environments

| Audience / task | Type | Canonical authority | Update trigger |
| --- | --- | --- | --- |
| Security reporters and maintainers | Reference | [Security policy](../SECURITY.md) | Reporting, supported environments, threat model, or credential rules change |
| Security maintainers reviewing controls | Reference | [Security notes](./security-notes.md) | Implemented controls, dependency advisories, or GitHub security capability changes |
| Owner provisioning hosted resources | Runbook | [Infrastructure bootstrap](./operations/bootstrap.md) | One-time/recovery resources, durable secrets, or first-schema activation changes |
| Owner validating a live candidate | Runbook | [Staging releases](./operations/staging.md) | Candidate preparation, checkpointing, acceptance, or RC tagging changes |
| Reviewers using synthetic deployments | Runbook | [PR previews](./operations/previews.md) | Preview isolation, lifecycle, cleanup, fixture, or visual-evidence changes |
| Owner promoting production | Runbook | [Production release](./operations/release.md) | Exact-SHA planning, migration, checkpoint, smoke, or attestation changes |
| Owner recovering service | Runbook | [Rollback](./operations/rollback.md) | Worker or D1 recovery mechanisms and decision boundaries change |
| Owner containing an incident | Runbook | [Incidents](./operations/incidents.md) | Diagnosis, containment, evidence, or recovery requirements change |
| Maintainers reading runtime signals | Reference | [Observability](./operations/observability.md) | Request tracing, health, retention, or alert signals change |
| Owner supplying release evidence capacity | Runbook | [Runner and local-evidence README](../.github/runner/README.md) | Workflow capacity, local receipt, image pins, registration, CA handling, or destruction changes |
| Reviewers recording a deployment | Reference | [Release records](../releases/README.md) | Immutable attestation fields or required smoke-set derivation changes |

## Maintenance rule

Keep recurring procedures in their canonical runbook. Put one-time provisioning
and first-schema activation in the bootstrap guide. Apart from the root
README's intentional minimal quick start, do not duplicate command blocks
across overview documents; link to the authority instead. When external
provider policy, dependency state, or GitHub/Cloudflare capability is recorded,
include a visible last-verified date and recheck it before relying on the fact.
