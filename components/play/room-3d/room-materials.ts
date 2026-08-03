import {
  DataTexture,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
} from "three";

import { ROOM_PALETTE as color } from "./room-palette.ts";

const toonGradient = new DataTexture(
  new Uint8Array([124, 178, 224, 255]),
  4,
  1,
  RedFormat,
);
toonGradient.magFilter = NearestFilter;
toonGradient.minFilter = NearestFilter;
toonGradient.generateMipmaps = false;
toonGradient.needsUpdate = true;

function toon(materialColor: string) {
  return new MeshToonMaterial({
    color: materialColor,
    gradientMap: toonGradient,
  });
}

export const ROOM_MATERIALS = Object.freeze({
  shell: toon(color.shell),
  shellLight: toon(color.shellLight),
  coral: toon(color.coral),
  mintDark: toon(color.mintDark),
  violet: toon(color.violet),
  violetDark: toon(color.violetDark),
  graphite: toon(color.graphite),
  graphiteSoft: toon(color.graphiteSoft),
  amber: toon(color.amber),
  amberGlow: new MeshToonMaterial({
    color: color.amber,
    emissive: color.amber,
    emissiveIntensity: 0.72,
    gradientMap: toonGradient,
  }),
  wood: toon(color.wood),
  woodLight: toon(color.woodLight),
  beige: toon(color.beige),
  beigeDark: toon(color.beigeDark),
  paper: toon(color.paper),
  screen: new MeshStandardMaterial({ color: color.screen, roughness: 0.68 }),
  screenPhosphor: new MeshStandardMaterial({
    color: "#17464e",
    emissive: color.mint,
    emissiveIntensity: 0.12,
    roughness: 0.68,
  }),
  screenBlue: new MeshStandardMaterial({
    color: "#44547e",
    emissive: color.workBlue,
    emissiveIntensity: 0.42,
    roughness: 0.65,
  }),
  screenMint: new MeshStandardMaterial({
    color: "#356a67",
    emissive: color.mint,
    emissiveIntensity: 0.55,
    roughness: 0.65,
  }),
  workBlueGlow: new MeshToonMaterial({
    color: color.workBlue,
    emissive: color.workBlue,
    emissiveIntensity: 0.85,
    gradientMap: toonGradient,
  }),
  instanceColor: new MeshToonMaterial({
    color: "#ffffff",
    gradientMap: toonGradient,
  }),
});

export type RoomMaterialKey = keyof typeof ROOM_MATERIALS;

export const ROOM_BASIC_MATERIALS = Object.freeze({
  shadow: new MeshBasicMaterial({
    color: "#02050a",
    depthWrite: false,
    opacity: 0.11,
    transparent: true,
  }),
  workBlue: new MeshBasicMaterial({
    color: color.workBlue,
    opacity: 0.92,
    transparent: true,
  }),
  invisible: new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    opacity: 0,
    side: DoubleSide,
    transparent: true,
  }),
});

export const ROOM_MATERIAL_SLOT_COUNT =
  Object.keys(ROOM_MATERIALS).length + Object.keys(ROOM_BASIC_MATERIALS).length;
