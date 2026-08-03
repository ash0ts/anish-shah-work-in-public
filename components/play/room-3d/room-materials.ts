import {
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";

import { ROOM_PALETTE as color } from "./room-palette.ts";

export const ROOM_MATERIALS = Object.freeze({
  shell: new MeshStandardMaterial({ color: color.shell, roughness: 0.82 }),
  shellLight: new MeshStandardMaterial({ color: color.shellLight, roughness: 0.82 }),
  coral: new MeshStandardMaterial({ color: color.coral, roughness: 0.82 }),
  mint: new MeshStandardMaterial({ color: color.mint, roughness: 0.82 }),
  violet: new MeshStandardMaterial({ color: color.violet, roughness: 0.82 }),
  violetGlass: new MeshStandardMaterial({
    color: color.violet,
    opacity: 0.72,
    roughness: 0.76,
    transparent: true,
  }),
  graphite: new MeshStandardMaterial({ color: color.graphite, roughness: 0.82 }),
  graphiteSoft: new MeshStandardMaterial({ color: color.graphiteSoft, roughness: 0.82 }),
  amber: new MeshStandardMaterial({ color: color.amber, roughness: 0.76 }),
  amberGlow: new MeshStandardMaterial({
    color: color.amber,
    emissive: color.amber,
    emissiveIntensity: 0.72,
    roughness: 0.72,
  }),
  wood: new MeshStandardMaterial({ color: color.wood, roughness: 0.86 }),
  woodLight: new MeshStandardMaterial({ color: color.woodLight, roughness: 0.86 }),
  beige: new MeshStandardMaterial({ color: color.beige, roughness: 0.82 }),
  beigeDark: new MeshStandardMaterial({ color: color.beigeDark, roughness: 0.82 }),
  paper: new MeshStandardMaterial({ color: color.paper, roughness: 0.88 }),
  screen: new MeshStandardMaterial({ color: color.screen, roughness: 0.68 }),
  screenAnime: new MeshStandardMaterial({
    color: "#5a4765",
    emissive: color.anime,
    emissiveIntensity: 0.26,
    roughness: 0.65,
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
  workBlueGlow: new MeshStandardMaterial({
    color: color.workBlue,
    emissive: color.workBlue,
    emissiveIntensity: 0.85,
    roughness: 0.68,
  }),
  instanceColor: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.84 }),
});

export type RoomMaterialKey = keyof typeof ROOM_MATERIALS;

export const ROOM_BASIC_MATERIALS = Object.freeze({
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
