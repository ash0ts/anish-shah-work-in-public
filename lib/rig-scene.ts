import type { selectRigView } from "./gear-model.ts";

export type RigView = ReturnType<typeof selectRigView>;
export type RigSceneState = { scene: "home" | "tape" | "portable"; guitar: "fgn" | "duo" };
export const sceneGuitars = { fgn: "fgn-dark-odyssey", duo: "fender-duo-sonic" } as const;
export const sceneModes = ["home", "tape", "portable"] as const;

export function selectRigScene(query: Record<string, string | string[] | undefined>): RigSceneState {
  return {
    scene: query.scene === "tape" || query.scene === "portable" ? query.scene : "home",
    guitar: query.guitar === "duo" ? "duo" : "fgn",
  };
}

/** Keep scene, bank, deck and preset selections through every native navigation. */
export function rigHref(view: RigView, scene: RigSceneState, change: Partial<RigView & RigSceneState> = {}, anchor = "music-corner") {
  const v = { ...view, ...scene, ...change };
  const bank = v.bank === 2 ? 2 : 1;
  const preset = Math.min(v.preset, bank === 2 ? 7 : 14);
  const params = new URLSearchParams({ bank: String(bank), preset: String(preset), deck: v.deck, scene: v.scene, guitar: v.guitar });
  return `/play/rig?${params}#${anchor}`;
}

/** Port-level facts are separate from the illustration's decorative geometry. */
export function sceneRoute(state: RigSceneState) {
  const guitar = sceneGuitars[state.guitar];
  if (state.scene === "home") return [
    { id: "guitar-board", from: guitar, to: "schmidt-sa550xdm", fromPort: "OUT", toPort: "A / NS-2 IN", internal: false },
    { id: "board-orange", from: "gigrig-g3s", to: "orange-crush-20rt", fromPort: "OUT 2 / B", toPort: "IN", internal: false },
  ];
  return [
    { id: "guitar-board", from: guitar, to: "schmidt-sa550xdm", fromPort: "OUT", toPort: "A / NS-2 IN", internal: false },
    { id: "board-opus", from: "gigrig-g3s", to: "two-notes-opus", fromPort: "OUT 1", toPort: "IN", internal: true },
    { id: "opus-op1", from: "two-notes-opus", to: "op1-field", fromPort: "PHONES / G", toPort: "LINE IN", internal: false },
    state.scene === "tape"
      ? { id: "op1-phones", from: "op1-field", to: "headphones", fromPort: "OUT", toPort: "3.5 mm TRS", internal: false }
      : { id: "op1-ep35", from: "op1-field", to: "te-ep35", fromPort: "OUT", toPort: "LINE IN / 3.5 mm TRS", internal: false },
  ];
}
