# Worker rollback and D1 recovery

## Choose the smallest recovery

- **Code or asset regression, compatible schema:** roll back only the Worker.
- **Bad editorial publication:** restore through audited Studio publication
  controls; do not restore the whole database.
- **Corrupt or incompatible D1 state:** stop owner writes, capture the current
  bookmark, assess provider-token consequences, then perform D1 Time Travel.
- **Provider compromise:** follow the incident runbook; a database restore is
  not credential revocation.

The private Sites environment is not a public rollback target.

## Worker rollback

Use the previous version recorded in the checked-in release record. During an
incomplete release that has not yet produced a final record, use the previous
version captured in the unchanged `dist/release-plan.json`:

- If the candidate is still staged at 0% and the prior version is at 100%, stop
  the release. Public traffic is already on the prior version; do not promote
  the candidate merely to roll it back.
- If the candidate has reached 100%, run the rollback command below with the
  recorded prior version.

```bash
npx wrangler rollback '<previous-version-id>' \
  --config dist/server/wrangler.public.json
```

Immediately repeat logged-out public checks and owner/non-owner Access checks.
Record the rollback time, reason, resulting version, and validation evidence.
An unused or stale release-checkpoint marker does not authorize a later deploy:
the guarded release flow also binds it to the exact SHA, content version,
current publication, and release-plan preparation time.

## D1 Time Travel

D1 restore is destructive operational work. Confirm the exact production
database, capture a new bookmark representing the pre-restore state, and verify
that the target bookmark belongs to the intended release. Then follow
Cloudflare's current Time Travel confirmation flow:

```bash
npx wrangler d1 time-travel info DB --config dist/server/wrangler.public.json
npx wrangler d1 time-travel restore DB \
  --bookmark='<recorded-pre-migration-bookmark>' \
  --config dist/server/wrangler.public.json
```

After restore, apply only the migrations expected by the selected Worker and
repeat full smoke tests. Restoring D1 can resurrect credentials or data deleted
after the bookmark. Revoke affected provider tokens and reconnect rather than
assuming restored encrypted rows are safe.

## Prevention

Worker rollback does not roll back D1. Keep migrations backward compatible
through the rollback window and separate destructive contract migrations into a
later release.
