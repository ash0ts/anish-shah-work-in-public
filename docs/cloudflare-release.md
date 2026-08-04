# Compatibility pointer: Cloudflare operations

This filename is retained only for older links. Do not add release instructions
here.

Use the canonical operational runbooks:

- [Production release](./operations/release.md)
- [Staging and PR previews](./operations/staging-and-previews.md)
- [Worker rollback and D1 recovery](./operations/rollback.md)
- [Incident and credential recovery](./operations/incidents.md)
- [Operational observability](./operations/observability.md)
- [Meet Me AI and session architecture](./architecture/meet-me-simulation.md)

Simulation activation is part of the guarded Worker release, not an ad hoc
Cloudflare variable edit. The production plan binds the campaign mode, AI mode,
provider/model, approved provider names, and one-way approval-state digest; see
the production runbook for the exact inputs and staged owner checkpoint.

The private OpenAI Sites deployment is a recovery/reference environment. It is
not an anonymous production rollback target and must remain private.
