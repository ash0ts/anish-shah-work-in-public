/**
 * Public music-corner objects. Identity and interaction only: ownership, model,
 * configuration and catalog URLs continue to belong to the gear manifest.
 * Illustration keys select literal renderers, never dynamic import paths.
 */
export const RIG_OBJECT_CONTRACT = [
  { id: "fgn", gearId: "fgn-dark-odyssey", kind: "guitar", illustration: "fgn", action: { kind: "select-guitar", guitar: "fgn" } },
  { id: "duo", gearId: "fender-duo-sonic", kind: "guitar", illustration: "duo", action: { kind: "select-guitar", guitar: "duo" } },
  { id: "board", gearId: "schmidt-sa550xdm", kind: "pedalboard", illustration: "board", action: { kind: "inspect-board", anchor: "workbench" } },
  { id: "orange", gearId: "orange-crush-20rt", kind: "amplifier", illustration: "orange", action: { kind: "inspect-gear" } },
  { id: "op1", gearId: "op1-field", kind: "recorder", illustration: "op1", action: { kind: "inspect-gear" } },
  { id: "ep35", gearId: "te-ep35", kind: "amplifier", illustration: "ep35", action: { kind: "inspect-gear" } },
  { id: "ep127", gearId: "te-ep127", kind: "controller", illustration: "ep127", action: { kind: "inspect-gear" } },
] as const;

export type RigObject = (typeof RIG_OBJECT_CONTRACT)[number];
export type RigObjectId = RigObject["id"];
export type RigGuitarId = Extract<RigObject, { kind: "guitar" }>["id"];

export const RIG_OBJECT_BY_ID = Object.fromEntries(
  RIG_OBJECT_CONTRACT.map(object => [object.id, object]),
) as { readonly [Id in RigObjectId]: Extract<RigObject, { id: Id }> };

export function rigObject(value: unknown): RigObject | null {
  return typeof value === "string" && Object.hasOwn(RIG_OBJECT_BY_ID, value)
    ? RIG_OBJECT_BY_ID[value as RigObjectId] : null;
}
