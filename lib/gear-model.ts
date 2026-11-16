import type { GearManifest, GearItem, RigPrograms } from "../types/gear.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected gear record");
  return value as Record<string, unknown>;
}
function keys(value: unknown, allowed: string[]): Record<string, unknown> {
  const object = record(value);
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw new Error(`Unexpected gear field: ${key}`);
  return object;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 250 || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error("Invalid gear text");
}
function member(value: unknown, values: readonly unknown[]) {
  if (!values.includes(value)) throw new Error(`Unexpected gear value: ${String(value)}`);
}
function number(value: unknown, min: number, max: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid gear number");
}
function catalogUrl(value: unknown, kind: "items" | "users") {
  if (value === null) return;
  text(value);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "equipboard.com" || url.port || url.username || url.password || url.search || url.hash || !new RegExp(`^/${kind}/[a-zA-Z0-9_-]+/?$`).test(url.pathname)) throw new Error("Invalid Equipboard URL");
}

/** Reject unknown keys instead of ever passing private export fields through to the web. */
export function parseGearManifest(input: unknown): GearManifest {
  const root = keys(input, ["version", "updatedAt", "profile", "build", "items"]);
  if (root.version !== 1 || typeof root.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(root.updatedAt)) throw new Error("Invalid gear version/date");
  const profile = keys(root.profile, ["displayName", "equipboardProfileUrl"]);
  text(profile.displayName); catalogUrl(profile.equipboardProfileUrl, "users");
  const build = keys(root.build, ["id", "revision", "state", "widthMm", "depthMm", "spareLoops"]);
  text(build.id); text(build.revision); member(build.state, ["planned"]);
  number(build.widthMm, 1, 2000); number(build.depthMm, 1, 2000);
  if (!Array.isArray(build.spareLoops)) throw new Error("Missing spare loops");
  for (const loop of build.spareLoops) { number(loop, 1, 12); if (!Number.isInteger(loop)) throw new Error("Invalid loop"); }
  if (!Array.isArray(root.items) || root.items.length > 200) throw new Error("Invalid gear inventory");
  const ids = new Set<string>(), loops = new Set<number>();
  for (const value of root.items) {
    const item = keys(value, ["id", "brand", "model", "kind", "status", "placement", "modelConfirmed", "provenance", "catalogUrl", "catalogQuery", "noteKey", "loop", "power", "footprint"]);
    for (const key of ["id", "brand", "model", "kind", "catalogQuery", "noteKey"]) text(item[key]);
    const id = item.id as string;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) throw new Error("Invalid/duplicate gear ID");
    ids.add(id);
    member(item.status, ["owned", "incoming", "planned", "optional"]);
    member(item.placement, ["upper", "lower", "both", "external", "offboard", "chassis"]);
    member(item.provenance, ["owner-confirmed", "collection-photo", "build-plan"]);
    if (typeof item.modelConfirmed !== "boolean" || item.noteKey !== `rig-note-${id}`) throw new Error("Invalid model or copy reference");
    catalogUrl(item.catalogUrl, "items");
    if (item.loop !== undefined) {
      number(item.loop, 1, 12);
      if (!Number.isInteger(item.loop) || loops.has(item.loop) || build.spareLoops.includes(item.loop)) throw new Error("Invalid/duplicate assigned loop");
      loops.add(item.loop);
    }
    if (item.power !== undefined) {
      const power = keys(item.power, ["allocation", "volts"]); text(power.allocation); member(power.volts, [9, 12, 18, 24]);
    }
    if (item.footprint !== undefined) {
      const f = keys(item.footprint, ["x", "y", "w", "h", "rotation", "color", "knobs", "switches", "dimensions"]);
      for (const k of ["x", "y", "w", "h"]) number(f[k], 0, 2000);
      member(f.rotation, [0, 90]); member(f.dimensions, ["published", "provisional", "planning"]);
      text(f.color); if (!/^#[0-9a-f]{6}$/i.test(f.color)) throw new Error("Invalid pedal color");
      for (const k of ["knobs", "switches"]) { number(f[k], 0, 14); if (!Number.isInteger(f[k])) throw new Error("Invalid controls"); }
      const width = f.rotation === 90 ? f.h as number : f.w as number;
      const height = f.rotation === 90 ? f.w as number : f.h as number;
      if ((f.x as number) + width > build.widthMm || (f.y as number) + height > build.depthMm) throw new Error("Footprint exceeds board");
    }
  }
  return structuredClone(input) as GearManifest;
}

export function parseRigPrograms(input: unknown, manifest: GearManifest): RigPrograms {
  const root = keys(input, ["version", "presets", "op1Commands"]);
  if (root.version !== 1 || !Array.isArray(root.presets) || root.presets.length !== 14 || !Array.isArray(root.op1Commands) || root.op1Commands.length !== 7) throw new Error("Invalid banks");
  const loops = new Set(manifest.items.map(item => item.loop).filter(Boolean));
  root.presets.forEach((value, index) => {
    const p = keys(value, ["slot", "labelKey", "loops"]);
    if (p.slot !== index + 1 || p.labelKey !== `rig-preset-${index + 1}` || !Array.isArray(p.loops) || new Set(p.loops).size !== p.loops.length || p.loops.some(loop => !loops.has(loop))) throw new Error("Invalid preset");
  });
  root.op1Commands.forEach((value, index) => {
    const c = keys(value, ["slot", "labelKey", "channel", "cc", "press", "release"]);
    if (c.slot !== index + 8 || c.labelKey !== `rig-command-${index + 8}` || c.channel !== 1 || c.press !== 127 || c.release !== 0) throw new Error("Invalid command");
    number(c.cc, 0, 127); if (!Number.isInteger(c.cc)) throw new Error("Invalid CC");
  });
  return structuredClone(input) as RigPrograms;
}

export function selectRigView(query: Record<string, string | string[] | undefined>) {
  const bank = query.bank === "2" ? 2 : 1;
  const max = bank === 2 ? 7 : 14;
  const slot = typeof query.preset === "string" && /^\d{1,2}$/.test(query.preset) ? Number(query.preset) : 1;
  return { bank, preset: slot >= 1 && slot <= max ? slot : 1, deck: query.deck === "lower" ? "lower" as const : "upper" as const };
}
export function loopItems(items: readonly GearItem[]): GearItem[] {
  return items.filter(item => item.loop !== undefined).toSorted((a, b) => a.loop! - b.loop!);
}
