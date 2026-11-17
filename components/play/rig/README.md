# Guitar rig and collection

The public `/play/rig` page logs Anish’s collection and the **revision 07 build plan**, not a claim that the assembled board has been delivered. Its guitar-only and guitar + tape views reuse the same seven base sounds. Native links select a bank, preset and deck through validated GET parameters; the complete inventory remains available without JavaScript.

## Music corner

`RigScene.tsx` renders an interactive SVG room illustration from the same inventory
and active preset. `RigIllustrations.tsx` owns silhouettes with shared path geometry
in `lib/rig-artwork.ts`; `lib/rig-scene.ts` owns
bounded `scene=home|tape|portable` and `guitar=fgn|duo` selections and the port-level
audio routes. `rigHref` preserves these alongside bank, deck and preset. Native
links and a text route/index work without JavaScript and at small sizes. The
illustration is an editorial view, not another millimetre layout or product photo.
Do not infer finishes or fit from its decorative coordinates.

- Home: guitar → board → G3S output 2 → Orange front input.
- Tape: G3S output 1 → OPUS internally; board G → OP-1 line in; headphones on OP-1.
- Portable: the same input path, with OP-1 output → EP-35 stereo line in. The
  EP-35 battery does not power the board. This remains a mains-powered board rig.
- Blue dashed control is G3S → H4MIDI → C2MIDI → OP-1 only in guitar + tape mode.
  EP-127's dotted path is wireless control of EP-35, never audio or a G3S loop.

The owner confirmed EP-127 ownership. EP-35 remains optional until explicitly
confirmed; both have verified Equipboard product matches. Keep that distinction in
art labels, collection rows and exports. Technical sources checked 2026-11-16:
[EP-35 guide](https://teenage.engineering/guides/ep-35) and
[EP-127 guide](https://teenage.engineering/guides/ep-127).

## Ownership and authoring

| Source | Owns |
| --- | --- |
| `content/play/gear.v1.json` | Stable identity, model confirmation, ownership status, placement, loop, physical planning coordinates, power allocation, catalog match |
| `content/play/rig-programs.v1.json` | Proposed loop combinations and OP-1 playback CC assignments |
| `content/copy/pages/play.md` | All public explanations, status labels, preset names and item notes |
| `lib/gear-model.ts` | Exact public field allowlist, structural validation and bounded query selection |
| `scripts/gear/exports.mjs` | Deterministic projection to public JSON and a spreadsheet-safe checklist |

The collection photos and explicit owner statements establish owned items. The Schmidt order establishes the board as incoming. Inclusion in the finished field guide establishes a planned position, **not a completed purchase**. Keep GENX14, GENX4LC, G3S, OPUS, Galea, ParaEQ and MIDI hardware planned until the owner confirms receipt. Canvas Power 6 and RC-1 remain owned off-board gear. The photo’s unconfirmed treadle and dial controllers remain one unresolved record, not three guessed products. Hosta is deferred.

Preserve the stable `tuner-unconfirmed` and `harmonic-tremolo-unconfirmed` IDs; their confirmed display models are now Landlord FX Lock In and JHS 3 Series Harmonic Trem. Do not change URLs or IDs just to tidy their names.

Footprints copy the revision 07 plan in millimetres. Some dimensions and all plug clearances remain provisional. This illustration is not an installation template. The supplied GENX14 adapter is tracked as part of that system, not a separate recommended purchase. The proposed H4 current-combining arrangement still requires installer and GigRig approval.

## Public data interface

`GET /data/gear.v1.json` is a static, versioned, read-only JSON feed containing:

- `manifest`: validated public records and build geometry;
- `catalog`: validated missing-entry resolutions and public product sources;
- `notes`: public copy keyed by stable item ID;
- `programs`: the two-bank program facts;
- `programLabels`: copy-deck names for those controls.

There are no provider calls or authentication requirements on public reads. This is the website’s feed, **not an Equipboard API**. Consumers can use ordinary `fetch('/data/gear.v1.json')`; the rig itself uses the same checked-in sources during server rendering. Publication follows a reviewed repository change.

After changing facts or notes:

```sh
npm run copy:generate
npm run gear:export
npm run gear:check
npm run test:gear
```

Commit the sources and all three generated files in `public/data/`. `test:content` includes drift checks. Never put serial numbers, prices, receipts, addresses, account credentials or private acquisition notes in these files. The parser rejects extra fields at each level; private inventory should be a separate owner-only system, not hidden JSON keys in a public record.

## Equipboard account workflow

No documented public member-collection API or supported bulk import/export was
located in the November 16, 2026 review. This implementation does not log in, scrape,
post products, save account items, or claim a completed sync. Your actual profile
URL is not configured yet. `Save` on an Equipboard item is separate from its global
catalog entry and does not itself prove that you own the item.

1. Download `/data/equipboard-checklist.tsv` or run
   `node scripts/gear/equipboard-checklist.mjs`. Follow the status and stable ID on
   each row. This TSV is a checklist, not an Equipboard import format.
2. Open confirmed catalog URLs and save the owned gear. Keep planned items on a
   wishlist; an order is not receipt. The Duo-Sonic uses the general model-family
   entry: do not invent a year or create a duplicate for a tentative finish.
3. Open `/data/equipboard-catalog-requests.md` for ready-to-paste requests and
   manufacturer sources. Search again first. Use the
   [new-item form](https://equipboard.com/items/new); if it refuses the source or
   your account lacks permission, use the
   [item-request forum](https://equipboard.com/forums/general/topics/post-your-item-add-requests-here).
   The [FAQ](https://equipboard.com/about/faq) explains supported-store limits,
   duplicate rules and saving gear. Forum moderation controls whether an entry
   is accepted; a drafted request is not a submitted or approved product.
4. `content/play/equipboard-catalog.v1.json` covers every unmatched inventory row:
   `request` for a known product, `identify` for uncertain identity, `component`
   for the supplied adapter. Request the standard Schmidt Socket Plate, then put
   its custom port choices in your setup notes. Keep the included adapter with
   GENX14 on Equipboard and retain its separate engineering record here.
5. When a new entry is approved, verify the returned URL, set `catalogUrl` in the
   manifest and remove its unmatched-plan row in the same change. Regenerate all
   three downloads. No automatic substitute or guessed catalog slug is accepted.

### The two guitars

`fgn-dark-odyssey` records the owner's six-string FGN with Fishman Fluence Moderns
installed. The name is owner-reported; its manufacturer code is unknown. Do not
silently replace it with an Iliad or Mythic based on a search result. The old
`fishman-fluence` record was an inventory mistake, not a separately owned pickup
set. Its legacy fragment is retained on the FGN record, but reconciliation will
flag that old ID for review rather than map an external pickup entry to a guitar.

`fender-duo-sonic` is owned and uses a family-level catalog match. Its year is null,
and Desert Sand is a tentative finish. Do not choose 2016, 2017 or 2019 arbitrarily.
The Walrus supply remains owned under the stable `canvas-power-6` ID, but its exact
label needs checking; the current manufacturer range did not establish that name.

### Compare your Equipboard collection

Use Node 24. No additional package or account credentials are needed by this CLI.
Replace the example profile with your actual public URL:

```sh
npm run gear:reconcile -- init --profile https://equipboard.com/users/YOUR_NAME
```

This creates an empty, partial snapshot at `work/gear/equipboard-snapshot.json`.
It deliberately does not copy local inventory into an alleged remote collection.
Populate `items` only from entries you have actually checked on your profile:

```json
{
  "version": 1,
  "profileUrl": "https://equipboard.com/users/YOUR_NAME",
  "capturedAt": "2026-11-16",
  "source": "owner-reviewed",
  "complete": false,
  "items": [
    {
      "catalogUrl": "https://equipboard.com/items/boss-ns-2-noise-suppressor-pedal",
      "status": "owned"
    }
  ]
}
```

Use the actual observation date. `status` is `owned`, `wishlist`, or `saved` when
Equipboard's UI does not establish the distinction. Set `complete` true only after
reviewing all pages and relevant collection/wishlist views. Never ingest
recommendations, artist-use lists or reviews as your own inventory. If a new
catalog URL has no local match, an optional `localId` proposes the association;
it cannot approve it or overwrite an existing link.

```sh
npm run gear:reconcile -- compare work/gear/equipboard-snapshot.json --profile https://equipboard.com/users/YOUR_NAME
```

Read `work/gear/equipboard-review.json`. The command never modifies the manifest,
Equipboard, or public downloads. It checks the account, input size, dates,
canonical URLs and duplicate IDs/URLs. Private or unknown keys are rejected.
Repeated comparisons of the same inputs produce the same report. Failed input
validation preserves the previous report. `baseDigest` binds the report to the
manifest and catalog plan; rerun after either changes.

| Finding | Next action |
| --- | --- |
| `match` | Observed status agrees with the local state; a separate catalog-candidate finding still needs review |
| `status-conflict` | Resolve with the owner's latest confirmation; never auto-promote a wishlisted/ordered item to owned |
| `saved-status-unknown` | Clarify owned versus wishlist; a generic Save is insufficient |
| `catalog-candidate` / `identity-review` | Verify product identity and approve its local association before editing sources |
| `catalog-conflict` / `ambiguous-local-match` | Resolve conflicting IDs, duplicate local units or catalog merges explicitly |
| `external-only` / `unknown-local-id` | Review whether to add an item; do not guess a similar model |
| `legacy-id-review` | Resolve a corrected identity; do not convert the old pickup entry into a guitar silently |
| `not-observed` / `not-seen-in-partial` | Check completeness or add to Equipboard if wanted; absence never means sold or deleted |
| `catalog-request` / `catalog-identify` / `catalog-component` | Follow the generated missing-item packet |

`work/` is ignored and never deployed. Keep credentials, raw account exports,
serials and receipts out of commits. Only review-approved facts enter the public
manifest and copy deck. A future official API or permitted export adapter should
produce this same bounded snapshot format, run once on owner request, and stage
this report. It must not fetch on public requests or auto-publish changes. Current
manual comparison does not need a hosted connector or new Studio credentials.

## Signal and control invariants

- Guitar → NS-2 INPUT; NS-2 SEND → G3S IN. Loops 2–6 are drive voices, loop 7 is compression, loop 8 is the NS-2 suppression return/output. Loop 1 is spare.
- G3S loop 8 SEND → NS-2 RETURN; NS-2 OUTPUT → loop 8 RETURN. Loops 9–12 follow it. The detector and suppression stage are one physical NS-2.
- The tuner uses G3S AUX. It is not an audio loop or a series effect.
- G3S regular output 1 → OPUS input internally. Isolated output 2 → Orange front input; the Crush 20RT has no effects loop.
- OPUS DI → XLR C; PHONES → TRS G; balanced mono LINE → H; AUX input ← J. G feeds headphones **or** OP-1 line input. When recording on OP-1, headphones monitor from OP-1.
- OPUS USB is editor/firmware only, not USB audio. Recording to a computer needs OP-1 USB audio or an audio interface connected to OPUS analog output.
- G3S MIDI OUT → H4 IN1; H4 OUT1 → F → C2MIDI Pro → OP-1 field USB host. H4 OUT2 → OPUS supplied MIDI adapter. OP-1 uses channels 1–4; OPUS uses channel 16.
- Guitar-only bank has 14 normal presets and no OP-1 commands. Guitar + tape has seven identical base sounds and seven momentary CC commands. These do not include a documented incoming record/overdub command. Test hardware mappings on the installed firmware.

Primary references from the reviewed guide: [G3/G3S manual](https://cdn.shopify.com/s/files/1/0756/7638/5564/files/G32026.pdf), [OP-1 field guide](https://teenage.engineering/guides/op-1), [OPUS manual](https://wiki.two-notes.com/doku.php?id=opus%3Aopus_user_s_manual), [OPUS USB limitation](https://helpdesk.two-notes.com/portal/en/kb/articles/does-the-usb-port-of-my-torpedo-device-transmit-any-audio-signal), [GENX14](https://shop.thegigrig.com/products/gen-x-14), [GENX4LC](https://shop.thegigrig.com/products/genx4lc).

## Play integration and validation

The semantic Play directory has an original guitar-and-board glyph linking to this page. It remains outside the seven-object 3D room contract. Adding a physical room prop requires the pinned Blender author/export pipeline, hit proxy, approach pose, poster renders, asset budgets and browser captures together; this change does not claim to have done that work.

Unit checks validate ownership, routing, query bounds, copy completeness, privacy and export drift. Public browser tests cover bank/deck changes, detail access and downloads without JavaScript, plus existing responsive and accessibility checks. Full build/typecheck/browser evidence must come from an environment with repository dependencies; syntax transformation alone is not that evidence.
