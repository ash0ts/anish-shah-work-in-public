import { DoubleSide, MeshBasicMaterial } from "three";

/** Shared invisible interaction surface; visible materials come from the GLB. */
export const ROOM_BASIC_MATERIALS = Object.freeze({
  invisible: new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }),
});
