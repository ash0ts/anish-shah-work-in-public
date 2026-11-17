import type { GearManifest } from "../types/gear.ts";

export type CatalogPlan = {
  version: 1;
  checkedAt: string;
  unmatched: {
    id: string;
    resolution: "request" | "identify" | "component";
    title?: string;
    category: string;
    sourceUrls: string[];
    parentId?: string;
  }[];
};
export type EquipboardSnapshot = {
  version: 1;
  profileUrl: string;
  capturedAt: string;
  source: "owner-reviewed";
  complete: boolean;
  items: {
    catalogUrl: string;
    status: "owned" | "wishlist" | "saved";
    localId?: string;
  }[];
};
export type GearFinding = {
  code: "match" | "status-conflict" | "saved-status-unknown" | "identity-review" |
    "catalog-candidate" | "catalog-conflict" | "external-only" | "unknown-local-id" |
    "legacy-id-review" | "ambiguous-local-match" | "not-observed" | "not-seen-in-partial" |
    "catalog-request" | "catalog-identify" | "catalog-component";
  localId?: string;
  catalogUrl?: string;
  localStatus?: string;
  observedStatus?: string;
};

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected collection object");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new Error("Unexpected collection field");
  return result;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error("Invalid collection text");
}
function day(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Invalid collection date");
}
export function equipboardUrl(value: unknown, kind: "users" | "items"): string {
  text(value);
  const url = new URL(value);
  if (url.origin !== "https://equipboard.com" || url.username || url.password || url.search || url.hash || !new RegExp(`^/${kind}/[a-zA-Z0-9_-]+/?$`).test(url.pathname)) throw new Error("Invalid Equipboard URL");
  return url.href.replace(/\/$/u, "");
}

export function parseCatalogPlan(input: unknown, manifest: GearManifest): CatalogPlan {
  const root = object(input, ["version", "checkedAt", "unmatched"]);
  if (root.version !== 1 || !Array.isArray(root.unmatched) || root.unmatched.length > 200) throw new Error("Invalid catalog plan");
  day(root.checkedAt);
  const missing = new Set(manifest.items.filter(i => !i.catalogUrl).map(i => i.id));
  for (const value of root.unmatched) {
    const item = object(value, ["id", "resolution", "title", "category", "sourceUrls", "parentId"]);
    text(item.id); text(item.category);
    if (!missing.delete(item.id) || !["request", "identify", "component"].includes(item.resolution as string)) throw new Error("Unknown, duplicate or already matched catalog item");
    if (!Array.isArray(item.sourceUrls) || item.sourceUrls.length > 5) throw new Error("Invalid catalog sources");
    for (const source of item.sourceUrls) {
      text(source); const url = new URL(source);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) throw new Error("Invalid catalog source URL");
    }
    if (item.resolution === "request") {
      text(item.title);
      if (!item.sourceUrls.length) throw new Error("Catalog request needs a product source");
    } else if (item.title !== undefined) throw new Error("Unexpected request title");
    if (item.resolution === "component") {
      if (item.parentId === item.id || !manifest.items.some(i => i.id === item.parentId)) throw new Error("Invalid component parent");
    } else if (item.parentId !== undefined) throw new Error("Unexpected component parent");
  }
  if (missing.size) throw new Error("Every unmatched item needs a catalog resolution");
  return structuredClone(input) as CatalogPlan;
}

/** This is our review format, not a claim of an official Equipboard export API. */
export function parseEquipboardSnapshot(input: unknown, expectedProfile: string): EquipboardSnapshot {
  const root = object(input, ["version", "profileUrl", "capturedAt", "source", "complete", "items"]);
  if (root.version !== 1 || root.source !== "owner-reviewed" || typeof root.complete !== "boolean" || !Array.isArray(root.items) || root.items.length > 1000) throw new Error("Invalid collection snapshot");
  const profileUrl = equipboardUrl(root.profileUrl, "users");
  if (profileUrl !== equipboardUrl(expectedProfile, "users")) throw new Error("Equipboard profile mismatch");
  day(root.capturedAt);
  const urls = new Set<string>(), ids = new Set<string>();
  const items = root.items.map(value => {
    const item = object(value, ["catalogUrl", "status", "localId"]);
    const catalogUrl = equipboardUrl(item.catalogUrl, "items");
    if (urls.has(catalogUrl)) throw new Error("Duplicate snapshot catalog URL");
    urls.add(catalogUrl);
    if (!["owned", "wishlist", "saved"].includes(item.status as string)) throw new Error("Invalid observed collection status");
    if (item.localId !== undefined) {
      text(item.localId);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.localId) || ids.has(item.localId)) throw new Error("Invalid/duplicate snapshot local ID");
      ids.add(item.localId);
    }
    return { ...item, catalogUrl } as EquipboardSnapshot["items"][number];
  });
  return { ...root, profileUrl, items } as EquipboardSnapshot;
}

/** Exact URL or explicit ID only; never fuzzy-match models or apply ownership changes. */
export function reconcileGear(manifest: GearManifest, snapshot: EquipboardSnapshot, plan: CatalogPlan) {
  const findings: GearFinding[] = [];
  const observed = new Set<string>();
  for (const external of snapshot.items) {
    const byUrl = manifest.items.filter(i => i.catalogUrl && equipboardUrl(i.catalogUrl, "items") === external.catalogUrl);
    const byId = external.localId ? manifest.items.find(i => i.id === external.localId) : undefined;
    if (external.localId && !byId) {
      const legacy = manifest.items.find(i => i.legacyIds?.includes(external.localId!));
      findings.push({ code: legacy ? "legacy-id-review" : "unknown-local-id", localId: external.localId, catalogUrl: external.catalogUrl });
      continue;
    }
    if (!byId && byUrl.length > 1) {
      findings.push({ code: "ambiguous-local-match", catalogUrl: external.catalogUrl });
      continue;
    }
    const local = byId ?? byUrl[0];
    if (!local) { findings.push({ code: "external-only", catalogUrl: external.catalogUrl, observedStatus: external.status }); continue; }
    observed.add(local.id);
    const detail = { localId: local.id, catalogUrl: external.catalogUrl, localStatus: local.status, observedStatus: external.status };
    if ((local.catalogUrl && equipboardUrl(local.catalogUrl, "items") !== external.catalogUrl) || byUrl.some(i => i.id !== local.id)) {
      findings.push({ code: "catalog-conflict", ...detail }); continue;
    }
    if (!local.catalogUrl) {
      findings.push({ code: local.modelConfirmed ? "catalog-candidate" : "identity-review", ...detail });
    }
    const expected = local.status === "owned" ? "owned" : "wishlist";
    findings.push({ code: external.status === "saved" ? "saved-status-unknown" : external.status !== expected ? "status-conflict" : "match", ...detail });
  }
  for (const local of manifest.items) {
    if (observed.has(local.id)) continue;
    if (local.catalogUrl) findings.push({ code: snapshot.complete ? "not-observed" : "not-seen-in-partial", localId: local.id, catalogUrl: local.catalogUrl, localStatus: local.status });
    else {
      const resolution = plan.unmatched.find(i => i.id === local.id)!;
      findings.push({ code: `catalog-${resolution.resolution}` as GearFinding["code"], localId: local.id, localStatus: local.status });
    }
  }
  findings.sort((a, b) => `${a.code}/${a.localId ?? a.catalogUrl}`.localeCompare(`${b.code}/${b.localId ?? b.catalogUrl}`, "en"));
  return { version: 1, mode: "review-only", profileUrl: snapshot.profileUrl, capturedAt: snapshot.capturedAt, complete: snapshot.complete, empty: snapshot.items.length === 0, findings };
}
