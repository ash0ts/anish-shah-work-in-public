# Guitar collection and Equipboard

Use for adding gear, correcting instrument identity, missing catalog entries or
comparing the owner's Equipboard with `/play/rig`. The canonical human runbook is
`components/play/rig/README.md`; do not duplicate it in another document.

## Locate the owner

| Concern | Source |
| --- | --- |
| Identity, ownership, configuration, loops and planned geometry | `content/play/gear.v1.json` |
| Missing catalog products and primary product sources | `content/play/equipboard-catalog.v1.json` |
| Guitar banks and OP-1 commands | `content/play/rig-programs.v1.json` |
| Public notes and UI wording | `content/copy/pages/play.md` and `lib/copy-contract.ts` |
| Strict validation and comparison | `lib/gear-model.ts`, `lib/gear-reconciliation.ts` |
| Generated downloads | `scripts/gear/exports.mjs` → `public/data/` |
| Local snapshot/report | `scripts/gear/reconcile-equipboard.mjs` → ignored `work/gear/` |

## Execute the request

1. Apply the latest explicit owner facts. Preserve stable IDs or document an
   identity correction with a legacy ID. An installed component is not another
   owned purchase: Fishman Fluence Moderns belong to `fgn-dark-odyssey`.
2. Keep unconfirmed SKU, year and finish unknown. `fender-duo-sonic` has a
   family-level catalog match, null year and tentative Desert Sand finish. Do
   not replace the owner-reported FGN model with a plausible search result.
3. Verify a catalog URL by opening the actual item. Search duplicates before
   proposing a new product. For every missing URL, retain `request`, `identify`
   or `component` in the catalog plan. A custom socket configuration is a note
   on the standard product, not a made-up catalog model. A draft is not posted.
4. Reconcile only observed owner-account rows. The runbook gives `init` and
   `compare` commands. Use the actual profile URL; no account is configured by
   default. Never copy the local list into a supposedly fetched snapshot.
5. Match by exact URL or explicit ID, not fuzzy names. Review identity conflicts,
   generic saved status, partial/empty captures and possible new entries. An
   absent item is not deleted/sold. Wishlist, incoming and owned stay distinct.
6. Compare creates a report, not mutations. Re-run against current sources, then
   implement owner-authorized factual changes in the manifest and copy deck.
   When accepting a new catalog URL, remove its unmatched row in the same edit.
7. Regenerate and validate. Never hand-edit exports or commit raw snapshots,
   serials, purchase prices, receipts or credentials. The public page performs
   no provider requests; a future supported fetch/export adapter must feed the
   same bounded review format, preserve the accepted snapshot on failure and
   require an owner-triggered refresh.

## Checks and handoff

Run `npm run copy:generate`, `npm run gear:export`, `npm run gear:check`, and
`npm run test:gear`, plus the maintenance classifier's affected checks. For skill
edits, run structural and maintenance-skill tests. Review the realistic cases in
[intent scenarios](../tests/intent-scenarios.md).

Report separately: corrected inventory; verified catalog matches; requests merely
prepared; account items actually saved; local comparison result; PR/deployment
state. Do not call the website JSON feed an Equipboard API or the checklist an
official bulk import. Do not promise authenticated sync without an implemented,
permitted adapter and an account-level verification.
