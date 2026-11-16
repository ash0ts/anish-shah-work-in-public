# Guitar rig and collection

The public `/play/rig` page logs Anish’s collection and the **revision 07 build plan**, not a claim that the assembled board has been delivered. Its guitar-only and guitar + tape views reuse the same seven base sounds. Native links select a bank, preset and deck through validated GET parameters; the complete inventory remains available without JavaScript.

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

Commit the sources and both generated files in `public/data/`. `test:content` includes drift checks. Never put serial numbers, prices, receipts, addresses, account credentials or private acquisition notes in these files. The parser rejects extra fields at each level; private inventory should be a separate owner-only system, not hidden JSON keys in a public record.

## Equipboard account workflow

No documented public member-collection API was located during the November 2026 review, and this environment does not have an authenticated Equipboard session. **No profile mutation or import has occurred.** The TSV is a manual checklist, not a supported bulk-import format.

1. Run `node scripts/gear/equipboard-checklist.mjs` to write `dist/equipboard-import-checklist.tsv`, or download the public copy.
2. Open each confirmed catalog URL. Add owned products to the personal collection; keep planned gear on the wishlist. Verify ordered gear has arrived before marking it owned.
3. For rows without catalog matches, search the provided brand/model. Check duplicates before proposing a new product. Do not invent an exact model for unresolved records.
4. Record the actual public profile URL under `profile.equipboardProfileUrl`. The validator accepts only `https://equipboard.com/users/<name>` URLs.
5. Copy future owner-confirmed status changes back to the manifest, regenerate and review. No automatic two-way synchronization is claimed.

The [Equipboard FAQ](https://equipboard.com/about/faq) documents saving items to a personal collection and adding missing products. Catalog links in the manifest were matched to item pages, not used to infer ownership. No artist endorsement, rating or price data is imported.

If an official API or authorized export becomes available, implement an **owner-triggered** adapter that maps it into `GearManifest`, rejects private/unknown fields, stages a diff and retains the last reviewed snapshot on failure. Do not add request-time scraping, cookies, browser-session extraction, background provider refreshes or automatic public publication.

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
