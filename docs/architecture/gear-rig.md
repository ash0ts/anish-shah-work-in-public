# Gear rig and Equipboard boundary

## Decision

The checked-in `content/play/gear.v1.json` file is the public, reviewable source of truth for the rig screen. It contains no serial numbers, receipts, purchase prices, addresses, or private notes.

Equipboard is an external catalog and profile link, not a runtime dependency. No documented public member-collection API is assumed, and the public route does not scrape Equipboard or make provider reads.

## Populate Equipboard

1. Run `node scripts/gear/equipboard-checklist.mjs`.
2. Use the generated TSV as a checklist while adding products to the Equipboard collection.
3. Replace each “Model to confirm” record after inspecting the pedal.
4. Add the public Equipboard profile URL to `profile.equipboardProfileUrl`.
5. Keep serials and receipts out of this manifest. If owner-only inventory is added later, store it behind Studio authorization.

## Future official API or export

If Equipboard offers an authorized export or member API later, add an owner-triggered adapter that normalizes records into the same `GearManifest` shape and writes a sanitized snapshot. Public reads must continue to use only the reviewed snapshot; they must never fetch the provider on request.

```ts
interface GearCollectionSource {
  readCollection(): Promise<GearManifest>;
}

class CheckedInGearSource implements GearCollectionSource {
  async readCollection() {
    return publicGearManifest();
  }
}

// Future only, with documented authorization and terms:
class EquipboardExportSource implements GearCollectionSource {
  async readCollection() {
    const exported = await readOwnerAuthorizedExport();
    return normalizeAndStripPrivateFields(exported);
  }
}
```

## Play integration

`/play/rig` is a semantic, server-rendered workbench linked from the Play directory. It deliberately remains outside the room's seven-object 3D contract until the Blender authoring pipeline adds an original guitar-and-pedalboard prop, hit proxy, approach pose, poster renders, manifest budgets, and browser captures together.
